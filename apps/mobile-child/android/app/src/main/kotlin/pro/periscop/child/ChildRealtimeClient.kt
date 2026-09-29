package pro.periscop.child

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * v0.57: постоянный канал backend → телефон (WebSocket `<apiBaseUrl>/child/ws`).
 *
 * Зачем: без FCM/RuStore команды доходили только poll'ом вместе с отправкой
 * геолокации (в покое раз в ~90с), и «Звук вокруг» не успевал стартовать
 * до 45-секундного таймаута. Этот канал доставляет команду за доли секунды.
 *
 * Жизненный цикл:
 *   - start() — из LocationForegroundService.onCreate (FGS живёт всегда) и
 *     после saveNativeCreds (claim / запуск UI);
 *   - ensureConnected() — на каждом heartbeat-alarm'е (раз в 90с): поднимает
 *     упавшее соединение и рвёт «тихое» (сервер пингует раз в 45с);
 *   - смена сети (Wi-Fi ↔ мобильная) — немедленное переподключение;
 *   - stop() — когда creds стёрты (escape-mode).
 *
 * Протокол (JSON, поле `op`): сервер шлёт `push {id, data}` и `ping`,
 * телефон отвечает `ack {id}` и `pong`, на серверный `hello` — `hello {appVersion}`.
 * `data` — тот же map, что в FCM, обрабатывается [ChildPushDispatcher].
 */
object ChildRealtimeClient {
    private const val TAG = "realtime"

    // Сервер пингует раз в 45с: тишина дольше двух интервалов = мёртвый сокет.
    private const val STALE_MS = 105_000L
    private const val DISPATCH_WAKE_LOCK_MS = 10_000L
    private val BACKOFF_MS = longArrayOf(1_000, 2_000, 5_000, 10_000, 30_000, 60_000)
    // Токен отозван (ребёнка удалили / переустановили) — не долбим сервер.
    private const val AUTH_FAILED_RETRY_MS = 10 * 60_000L
    private const val CLOSE_AUTH_FAILED = 4401

    private val lock = Any()
    private var appCtx: Context? = null
    private var started = false
    private var socket: WebSocket? = null
    private var connected = false
    private var attempt = 0
    private var lastNetwork: Network? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var dispatchWakeLock: PowerManager.WakeLock? = null

    @Volatile
    private var lastServerMsgAt = 0L

    private val handler: Handler by lazy {
        Handler(HandlerThread("periscop-realtime").apply { start() }.looper)
    }

    // readTimeout 0: соединение держим бесконечно, живость — по пингам сервера.
    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()
    }

    private val reconnectRunnable = Runnable { connectIfNeeded("backoff") }

    /** v0.60.0: состояние канала для снимка журнала (DiagSnapshot). */
    fun describe(): String {
        val (isStarted, isConnected, hasSocket, att) = synchronized(lock) {
            listOf(started, connected, socket != null, attempt)
        }
        val silent = if (lastServerMsgAt > 0) "${(System.currentTimeMillis() - lastServerMsgAt) / 1000}с" else "-"
        return "подключён=$isConnected (started=$isStarted socket=$hasSocket attempt=$att, " +
            "с последнего сообщения сервера $silent)"
    }

    fun start(ctx: Context) {
        synchronized(lock) {
            appCtx = ctx.applicationContext
            if (!started) {
                started = true
                registerNetworkCallback()
            }
        }
        connectIfNeeded("start")
    }

    /** Новые creds (claim / запуск UI) — переподключаемся со свежим токеном. */
    fun restart(ctx: Context) {
        start(ctx)
        reconnect("creds updated")
    }

    /** Heartbeat-alarm: поднять упавшее соединение и порвать «тихое». */
    fun ensureConnected(ctx: Context) {
        val isStarted: Boolean
        val silentMs: Long
        synchronized(lock) {
            isStarted = started
            silentMs = if (connected) System.currentTimeMillis() - lastServerMsgAt else 0L
        }
        when {
            !isStarted -> start(ctx)
            silentMs > STALE_MS -> reconnect("stale: no server message ${silentMs / 1000}s")
            else -> connectIfNeeded("heartbeat")
        }
    }

    fun stop(ctx: Context) {
        val ws: WebSocket?
        synchronized(lock) {
            started = false
            ws = socket
            socket = null
            connected = false
        }
        handler.removeCallbacks(reconnectRunnable)
        unregisterNetworkCallback(ctx.applicationContext)
        ws?.close(1000, "stop")
        log(ctx.applicationContext, "stopped")
    }

    private fun reconnect(reason: String) {
        appCtx?.let { debug(it, "reconnect requested: $reason") }
        val old: WebSocket?
        synchronized(lock) {
            old = socket
            socket = null
            connected = false
            attempt = 0
        }
        handler.removeCallbacks(reconnectRunnable)
        old?.cancel()
        connectIfNeeded(reason)
    }

    private fun connectIfNeeded(reason: String) {
        val ctx = appCtx ?: return
        synchronized(lock) {
            if (!started || socket != null) return
            val token = NativeCreds.getToken(ctx)
            val base = NativeCreds.getApiBaseUrl(ctx)
            if (token.isNullOrEmpty() || base.isNullOrEmpty()) {
                log(ctx, "no creds — not connecting ($reason)")
                return
            }
            handler.removeCallbacks(reconnectRunnable)
            val request = try {
                // OkHttp сам меняет http(s) на ws(s) при апгрейде.
                Request.Builder()
                    .url("${base.trimEnd('/')}/child/ws")
                    .header("X-Child-Token", token)
                    .build()
            } catch (e: Throwable) {
                log(ctx, "bad apiBaseUrl=$base: ${e.message}")
                return
            }
            log(ctx, "connecting ($reason) attempt=$attempt")
            socket = http.newWebSocket(request, Listener(ctx))
        }
    }

    private fun onDisconnected(ctx: Context, ws: WebSocket, code: Int, reason: String?) {
        val delay: Long
        synchronized(lock) {
            if (ws !== socket) return // старый сокет после reconnect — игнор
            socket = null
            connected = false
            if (!started) return
            delay = if (code == CLOSE_AUTH_FAILED) {
                AUTH_FAILED_RETRY_MS
            } else {
                BACKOFF_MS[attempt.coerceAtMost(BACKOFF_MS.size - 1)]
            }
            attempt++
        }
        log(ctx, "disconnected code=$code reason=$reason — retry in ${delay / 1000}s")
        debug(ctx, "disconnected: attempt=$attempt authFailed=${code == CLOSE_AUTH_FAILED}")
        handler.postDelayed(reconnectRunnable, delay)
    }

    private class Listener(private val ctx: Context) : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            synchronized(lock) {
                if (webSocket !== socket) return
                connected = true
                attempt = 0
            }
            lastServerMsgAt = System.currentTimeMillis()
            log(ctx, "connected")
            debug(ctx, "connected: http=${response.code} protocol=${response.protocol}")
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            lastServerMsgAt = System.currentTimeMillis()
            val msg = try {
                JSONObject(text)
            } catch (_: Throwable) {
                return
            }
            when (msg.optString("op")) {
                // Отвечаем на hello сервера, а не шлём свой в onOpen: сервер
                // слушает сообщения только после проверки токена в БД.
                "hello" -> {
                    webSocket.send(
                        JSONObject().put("op", "hello").put("appVersion", appVersion(ctx)).toString(),
                    )
                    debug(ctx, "hello answered (appVersion=${appVersion(ctx)})")
                }
                "ping" -> webSocket.send("{\"op\":\"pong\"}")
                "push" -> {
                    val id = msg.optString("id")
                    val data = msg.optJSONObject("data") ?: return
                    // ack сразу: сервер ждёт его 3с, дальше обработка — наша забота.
                    webSocket.send(JSONObject().put("op", "ack").put("id", id).toString())
                    val map = HashMap<String, String>()
                    for (key in data.keys()) map[key] = data.optString(key)
                    debug(ctx, "push id=${id.take(8)} type=${map["type"]} acked")
                    holdWakeLock(ctx)
                    ChildPushDispatcher.dispatch(ctx, map, TAG)
                }
                else -> Unit
            }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            onDisconnected(ctx, webSocket, code, reason)
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            onDisconnected(ctx, webSocket, response?.code ?: -1, "${t.javaClass.simpleName}: ${t.message}")
        }
    }

    private fun registerNetworkCallback() {
        val ctx = appCtx ?: return
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                handler.post {
                    debug(ctx, "network available (changed=${lastNetwork != null && lastNetwork != network})")
                    val prev = lastNetwork
                    lastNetwork = network
                    if (prev != null && prev != network) {
                        reconnect("network changed")
                    } else {
                        synchronized(lock) { attempt = 0 }
                        connectIfNeeded("network available")
                    }
                }
            }

            override fun onLost(network: Network) {
                handler.post {
                    if (network != lastNetwork) return@post
                    debug(ctx, "network lost — cancel socket")
                    lastNetwork = null
                    // Сокет был привязан к ушедшей сети — он уже мёртв.
                    val ws = synchronized(lock) { socket }
                    ws?.cancel()
                }
            }
        }
        try {
            cm.registerDefaultNetworkCallback(cb)
            networkCallback = cb
        } catch (e: Throwable) {
            log(ctx, "registerDefaultNetworkCallback failed: ${e.message}")
        }
    }

    private fun unregisterNetworkCallback(ctx: Context) {
        val cb = networkCallback ?: return
        networkCallback = null
        try {
            (ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager)
                .unregisterNetworkCallback(cb)
        } catch (_: Throwable) {
            /* уже снят */
        }
    }

    /** Короткий wake lock, чтобы CPU не уснул между приёмом push'а и стартом сервиса. */
    private fun holdWakeLock(ctx: Context) {
        try {
            val wl = synchronized(lock) {
                dispatchWakeLock ?: (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager)
                    .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "periscop:realtime-dispatch")
                    .apply { setReferenceCounted(false) }
                    .also { dispatchWakeLock = it }
            }
            wl.acquire(DISPATCH_WAKE_LOCK_MS)
        } catch (e: Throwable) {
            log(ctx, "wake lock failed: ${e.message}")
        }
    }

    @Suppress("DEPRECATION")
    private fun appVersion(ctx: Context): String = try {
        ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: ""
    } catch (_: Throwable) {
        ""
    }

    private fun log(ctx: Context, msg: String) = DiagLog.write(ctx, TAG, msg)
    private fun debug(ctx: Context, msg: String) = DiagLog.debug(ctx, TAG, msg)
}
