package pro.periscop.child

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

// v0.60.0 — чистая логика журнала на сервере (DiagConfig.kt).
// Запуск: cd apps/mobile-child/android &&
//   ./gradlew.bat :app:testDebugUnitTest --tests 'pro.periscop.child.*Diag*'
class DiagLogicTest {

    private fun ms(iso: String) = Instant.parse(iso).toEpochMilli()

    // ---------------------------------------------------------------- теги

    @Test
    fun `tags from spec table map to their categories`() {
        assertEquals("audio", DiagCategories.forTag("sound"))
        assertEquals("audio", DiagCategories.forTag("sound_around"))
        assertEquals("audio", DiagCategories.forTag("audio_trampoline"))
        assertEquals("audio", DiagCategories.forTag("signal"))
        assertEquals("location", DiagCategories.forTag("bg"))
        assertEquals("location", DiagCategories.forTag("heartbeat-recv"))
        assertEquals("location", DiagCategories.forTag("svc"))
        assertEquals("realtime", DiagCategories.forTag("realtime"))
        assertEquals("push", DiagCategories.forTag("fcm"))
        assertEquals("push", DiagCategories.forTag("poll"))
        assertEquals("update", DiagCategories.forTag("updates"))
        assertEquals("update", DiagCategories.forTag("post_update_guard"))
        assertEquals("system", DiagCategories.forTag("boot"))
        assertEquals("system", DiagCategories.forTag("crash"))
        assertEquals("system", DiagCategories.forTag("diag"))
    }

    @Test
    fun `dart tags are case insensitive and extra tags are mapped`() {
        assertEquals("audio", DiagCategories.forTag("SoundAround"))
        assertEquals("audio", DiagCategories.forTag("AudioCommandHandler"))
        assertEquals("audio", DiagCategories.forTag("sa_bg"))
        assertEquals("push", DiagCategories.forTag("fcm_registrar"))
        assertEquals("push", DiagCategories.forTag("rustore_push_registrar"))
        assertEquals("push", DiagCategories.forTag("app_control_http"))
        assertEquals("system", DiagCategories.forTag("app_control_scheduler"))
    }

    @Test
    fun `unknown tag falls into other`() {
        assertEquals("other", DiagCategories.forTag("dart"))
        assertEquals("other", DiagCategories.forTag(""))
        assertEquals("other", DiagCategories.forTag("something_new"))
    }

    // -------------------------------------------------------------- конфиг

    @Test
    fun `null or broken json gives defaults`() {
        assertEquals(DiagConfig.DEFAULT, DiagConfig.parse(null))
        assertEquals(DiagConfig.DEFAULT, DiagConfig.parse(""))
        assertEquals(DiagConfig.DEFAULT, DiagConfig.parse("not json"))
        val d = DiagConfig.DEFAULT
        assertEquals(DiagCategories.ALL.toSet(), d.send)
        assertTrue(d.debug.isEmpty())
        assertNull(d.debugUntil)
        assertFalse(d.logcat)
        assertTrue(d.snapshot)
        assertTrue(d.autoUpload)
    }

    @Test
    fun `missing fields take defaults`() {
        val c = DiagConfig.parse("""{"logcat":true}""")
        assertTrue(c.logcat)
        assertEquals(DiagCategories.ALL.toSet(), c.send)
        assertTrue(c.debug.isEmpty())
        assertTrue(c.snapshot)
        assertTrue(c.autoUpload)
    }

    @Test
    fun `unknown categories are dropped, empty send stays empty`() {
        val c = DiagConfig.parse("""{"send":["audio","bogus","REALTIME"],"debug":["x"]}""")
        assertEquals(setOf("audio", "realtime"), c.send)
        assertTrue(c.debug.isEmpty())
        assertTrue(DiagConfig.parse("""{"send":[]}""").send.isEmpty())
    }

    @Test
    fun `explicit null fields take defaults`() {
        val c = DiagConfig.parse("""{"send":null,"snapshot":null,"autoUpload":false,"debugUntil":null}""")
        assertEquals(DiagCategories.ALL.toSet(), c.send)
        assertTrue(c.snapshot)
        assertFalse(c.autoUpload)
        assertNull(c.debugUntilMs)
    }

    @Test
    fun `debug without debugUntil is active forever`() {
        val c = DiagConfig.parse("""{"debug":["audio"],"debugUntil":null}""")
        assertTrue(c.isDebugActive("audio", ms("2099-01-01T00:00:00Z")))
        assertFalse(c.isDebugActive("location", ms("2026-01-01T00:00:00Z")))
    }

    @Test
    fun `debug is active strictly before debugUntil`() {
        val c = DiagConfig.parse("""{"debug":["audio","realtime"],"debugUntil":"2026-09-29T12:00:00.000Z"}""")
        assertEquals(ms("2026-09-29T12:00:00Z"), c.debugUntilMs)
        assertTrue(c.isDebugActive("audio", ms("2026-09-29T11:59:59Z")))
        assertTrue(c.isDebugActive("realtime", ms("2026-09-29T11:59:59Z")))
        assertFalse(c.isDebugActive("audio", ms("2026-09-29T12:00:00Z")))
        assertFalse(c.isDebugActive("audio", ms("2026-09-29T13:00:00Z")))
    }

    @Test
    fun `debugUntil with offset is parsed`() {
        val c = DiagConfig.parse("""{"debug":["audio"],"debugUntil":"2026-09-29T15:00:00+03:00"}""")
        assertEquals(ms("2026-09-29T12:00:00Z"), c.debugUntilMs)
    }

    @Test
    fun `unreadable debugUntil turns debug off`() {
        val c = DiagConfig.parse("""{"debug":["audio"],"debugUntil":"завтра"}""")
        assertEquals(0L, c.debugUntilMs)
        assertFalse(c.isDebugActive("audio", ms("2026-09-29T12:00:00Z")))
    }

    @Test
    fun `toJson round trip keeps config`() {
        val c = DiagConfig.parse(
            """{"send":["push","audio"],"debug":["audio"],"debugUntil":"2026-09-29T12:00:00.000Z",""" +
                """"logcat":true,"snapshot":false,"autoUpload":false}""",
        )
        assertEquals(c, DiagConfig.parse(c.toJson()))
        assertEquals(DiagConfig.DEFAULT, DiagConfig.parse(DiagConfig.DEFAULT.toJson()))
    }

    // -------------------------------------------------------------- фильтр

    private val sample = listOf(
        "09-29 10:00:00.000 I [sound] onStartCommand mode=stream",
        "09-29 10:00:00.100 D [sound] stream: exception class=java.lang.SecurityException",
        "09-29 10:00:00.200 I [bg] onLocation OK",
        "09-29 10:00:00.300 I [crash] uncaught in thread 'main': java.lang.IllegalStateException: boom",
        "\tat pro.periscop.child.Foo.bar(Foo.kt:1)",
        "\tat pro.periscop.child.Foo.baz(Foo.kt:2)",
        "09-29 10:00:00.400 I [realtime] connected",
        "10:00:00.500 [SoundAround] old format line",
        "09-29 10:00:00.600 I [dart] something",
    ).joinToString("\n", postfix = "\n")

    @Test
    fun `all categories returns text unchanged`() {
        assertEquals(sample, DiagLogFilter.filter(sample, DiagCategories.ALL.toSet()))
    }

    @Test
    fun `empty send returns nothing`() {
        assertEquals("", DiagLogFilter.filter(sample, emptySet()))
    }

    @Test
    fun `filter keeps only selected categories incl old format`() {
        val out = DiagLogFilter.filter(sample, setOf("audio"))
        assertEquals(
            listOf(
                "09-29 10:00:00.000 I [sound] onStartCommand mode=stream",
                "09-29 10:00:00.100 D [sound] stream: exception class=java.lang.SecurityException",
                "10:00:00.500 [SoundAround] old format line",
            ).joinToString("\n", postfix = "\n"),
            out,
        )
    }

    @Test
    fun `continuation lines follow their record`() {
        val out = DiagLogFilter.filter(sample, setOf("system"))
        assertEquals(
            listOf(
                "09-29 10:00:00.300 I [crash] uncaught in thread 'main': java.lang.IllegalStateException: boom",
                "\tat pro.periscop.child.Foo.bar(Foo.kt:1)",
                "\tat pro.periscop.child.Foo.baz(Foo.kt:2)",
            ).joinToString("\n", postfix = "\n"),
            out,
        )
    }

    @Test
    fun `leading fragment without header counts as other`() {
        val text = "broken tail of a line\n09-29 10:00:00.000 I [bg] x\n"
        assertEquals("broken tail of a line\n", DiagLogFilter.filter(text, setOf("other")))
        assertEquals("09-29 10:00:00.000 I [bg] x\n", DiagLogFilter.filter(text, setOf("location")))
    }

    @Test
    fun `tagOf parses both formats`() {
        assertEquals("sound", DiagLogFilter.tagOf("09-29 10:00:00.000 D [sound] x"))
        assertEquals("bg", DiagLogFilter.tagOf("10:00:00.000 [bg] x"))
        assertNull(DiagLogFilter.tagOf("\tat foo"))
    }

    // ------------------------------------------------------------- лимитер

    private val t0 = ms("2026-09-29T10:00:00Z")
    private val min = 60_000L

    @Test
    fun `first trigger is allowed and recorded`() {
        val d = DiagAutoLimiter.decide(emptyList(), "audio_start_failed", t0)
        assertTrue(d.allowed)
        assertEquals(listOf(DiagAutoLimiter.Entry("audio_start_failed", t0)), d.history)
    }

    @Test
    fun `same trigger within 30 min is blocked, after 30 min allowed`() {
        val h = listOf(DiagAutoLimiter.Entry("audio_start_failed", t0))
        assertFalse(DiagAutoLimiter.decide(h, "audio_start_failed", t0 + 29 * min).allowed)
        assertEquals("trigger_interval", DiagAutoLimiter.decide(h, "audio_start_failed", t0 + 29 * min).reason)
        assertTrue(DiagAutoLimiter.decide(h, "audio_start_failed", t0 + 30 * min).allowed)
    }

    @Test
    fun `other trigger is not blocked by interval`() {
        val h = listOf(DiagAutoLimiter.Entry("audio_start_failed", t0))
        assertTrue(DiagAutoLimiter.decide(h, "crash", t0 + min).allowed)
    }

    @Test
    fun `at most 6 per 24 hours`() {
        val h = (0 until 6).map { DiagAutoLimiter.Entry("t$it", t0 + it * min) }
        val blocked = DiagAutoLimiter.decide(h, "new", t0 + 10 * min)
        assertFalse(blocked.allowed)
        assertEquals("daily_limit", blocked.reason)
        // Через сутки после первой — окно освободилось на одну запись.
        val later = DiagAutoLimiter.decide(h, "new", t0 + 24 * 60 * min)
        assertTrue(later.allowed)
        assertEquals(6, later.history.size)
    }

    @Test
    fun `entries from the future still count (clock moved back)`() {
        val h = listOf(DiagAutoLimiter.Entry("crash", t0 + 10 * min))
        assertFalse(DiagAutoLimiter.decide(h, "crash", t0).allowed)
    }

    @Test
    fun `history encode decode round trip and garbage`() {
        val h = listOf(DiagAutoLimiter.Entry("a", 1L), DiagAutoLimiter.Entry("b", 2L))
        assertEquals(h, DiagAutoLimiter.decode(DiagAutoLimiter.encode(h)))
        assertTrue(DiagAutoLimiter.decode("garbage").isEmpty())
        assertTrue(DiagAutoLimiter.decode(null).isEmpty())
    }

    // ------------------------------------------------------------- обрезка

    @Test
    fun `tailUtf8 keeps tail and never splits a character`() {
        assertEquals("abc", DiagText.tailUtf8("abc", 10))
        assertEquals("cd", DiagText.tailUtf8("abcd", 2))
        // «я» = 2 байта; 3 байта хвоста из "яяя" = полтора символа → один целый.
        assertEquals("я", DiagText.tailUtf8("яяя", 3))
    }
}
