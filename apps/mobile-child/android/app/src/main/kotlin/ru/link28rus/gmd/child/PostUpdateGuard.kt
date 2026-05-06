package ru.link28rus.gmd.child

import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build

/**
 * v0.51 (задача #61) — детект первого запуска после автообновления APK.
 *
 * Проблема: на HyperOS / MIUI / некоторых других OEM при обновлении из
 * sideload-источника (наш `/api/public/updates/mobile-child/latest` →
 * PackageInstaller через ACTION_VIEW) система деактивирует:
 *   - AccessibilityService (GmdAccessibilityService) — нужен для блокировки apps
 *   - Device Admin (ChildDeviceAdminReceiver) — нужен для защиты от удаления
 *
 * Это **известное поведение OS** (особенно MIUI 14+ с Restricted Settings),
 * технически предотвратить из приложения нельзя без размещения в RuStore.
 *
 * UX-обход: при первом запуске после смены versionCode выставляем flag
 * `post_update_pending=true` в SharedPreferences. Dart-side читает его через
 * MethodChannel `consumePostUpdateFlag` (one-shot consume), и если хоть одно
 * critical permission слетело — показывает active modal «Восстановить
 * разрешения» вместо пассивной надежды на то что ребёнок заметит баннеры.
 *
 * Контекст в задаче (`.taskmaster/tasks.json:#61`) и lesson #22 в
 * `CLAUDE.md` (taskmaster update_task → прямой Edit).
 */
object PostUpdateGuard {

    private const val PREFS_NAME = "gmd_post_update"
    private const val KEY_LAST_VERSION_CODE = "last_seen_version_code"
    private const val KEY_LAST_VERSION_NAME = "last_seen_version_name"
    private const val KEY_PENDING = "post_update_pending"
    private const val KEY_PENDING_FROM_VERSION_NAME = "pending_from_version_name"
    private const val KEY_PENDING_TO_VERSION_NAME = "pending_to_version_name"
    private const val TAG = "post_update_guard"

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /**
     * Текущий versionCode из PackageInfo. На API 28+ читается из
     * `longVersionCode`, иначе из deprecated `versionCode`.
     */
    private fun currentVersionCode(ctx: Context): Long = try {
        val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ctx.packageManager.getPackageInfo(
                ctx.packageName,
                PackageManager.PackageInfoFlags.of(0L),
            )
        } else {
            @Suppress("DEPRECATION")
            ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }
    } catch (e: Throwable) {
        DiagLog.write(ctx, TAG, "currentVersionCode failed: ${e.message}")
        -1L
    }

    private fun currentVersionName(ctx: Context): String = try {
        val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ctx.packageManager.getPackageInfo(
                ctx.packageName,
                PackageManager.PackageInfoFlags.of(0L),
            )
        } else {
            @Suppress("DEPRECATION")
            ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        }
        info.versionName ?: ""
    } catch (e: Throwable) {
        ""
    }

    /**
     * Вызывается в `MainActivity.onCreate` (и из любых других entry-point'ов
     * native-кода если они стартуют процесс — `BootReceiver`, `MyFirebaseMessagingService`).
     *
     * Логика:
     *   - Первый запуск (нет saved versionCode) → запоминаем текущий, НЕ
     *     ставим pending (это не обновление, это install).
     *   - Saved == current → ничего не делаем, обычный запуск.
     *   - Saved != current → это первый запуск после обновления:
     *     ставим pending=true и обновляем saved.
     *
     * Идемпотентен: повторный вызов в той же версии не сбрасывает pending
     * (Dart должен явно его consume'ить).
     */
    fun recordCurrentVersion(ctx: Context) {
        val current = currentVersionCode(ctx)
        if (current < 0) {
            // PackageManager не дал инфу — не трогаем prefs.
            return
        }
        val p = prefs(ctx)
        val saved = p.getLong(KEY_LAST_VERSION_CODE, -1L)
        val currentName = currentVersionName(ctx)
        if (saved < 0L) {
            // Первый запуск (или старые builds которые не писали этот ключ).
            // НЕ ставим pending — пользователь только что установил, разрешения
            // даются через onboarding wizard, post-update flow тут не нужен.
            p.edit()
                .putLong(KEY_LAST_VERSION_CODE, current)
                .putString(KEY_LAST_VERSION_NAME, currentName)
                .apply()
            DiagLog.write(
                ctx,
                TAG,
                "recordCurrentVersion: first install detected (code=$current, name=$currentName)",
            )
            return
        }
        if (saved == current) {
            // Обычный запуск той же версии — ничего не меняем.
            return
        }
        // Обновление: код различается → ставим pending. Сохраняем «from→to»
        // для UI/DiagLog, но Dart их пока не использует (зарезервировано).
        val savedName = p.getString(KEY_LAST_VERSION_NAME, "") ?: ""
        p.edit()
            .putLong(KEY_LAST_VERSION_CODE, current)
            .putString(KEY_LAST_VERSION_NAME, currentName)
            .putBoolean(KEY_PENDING, true)
            .putString(KEY_PENDING_FROM_VERSION_NAME, savedName)
            .putString(KEY_PENDING_TO_VERSION_NAME, currentName)
            .apply()
        DiagLog.write(
            ctx,
            TAG,
            "recordCurrentVersion: UPGRADE detected $savedName ($saved) → $currentName ($current); pending=true",
        )
    }

    /**
     * Dart-side вызывает один раз при init home-экрана. Возвращает map с
     * информацией если pending был выставлен, иначе null. Сразу сбрасывает
     * флаг — это **one-shot** consume.
     *
     * Мы намеренно дёргаем флаг даже если permissions ОК. Dart-side решает
     * стоит ли показывать модал по результату собственного check'а.
     */
    fun consumePending(ctx: Context): Map<String, Any?>? {
        val p = prefs(ctx)
        val pending = p.getBoolean(KEY_PENDING, false)
        if (!pending) return null
        val from = p.getString(KEY_PENDING_FROM_VERSION_NAME, "") ?: ""
        val to = p.getString(KEY_PENDING_TO_VERSION_NAME, "") ?: ""
        p.edit()
            .putBoolean(KEY_PENDING, false)
            .remove(KEY_PENDING_FROM_VERSION_NAME)
            .remove(KEY_PENDING_TO_VERSION_NAME)
            .apply()
        DiagLog.write(ctx, TAG, "consumePending: $from → $to (cleared)")
        return mapOf(
            "fromVersionName" to from,
            "toVersionName" to to,
        )
    }
}
