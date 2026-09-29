package pro.periscop.parent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.TimeZone

class GeofenceNotificationTextTest {
    // Москва, UTC+3 без перехода на летнее время.
    private val msk = TimeZone.getTimeZone("Europe/Moscow")

    // 2026-09-28 09:00 МСК.
    private val now = GeofenceNotificationText.parseIsoUtc("2026-09-28T06:00:00.000Z")!!

    private fun body(
        enter: Boolean,
        zone: String?,
        delayed: Boolean,
        recordedAt: String?,
    ) = GeofenceNotificationText.body(
        enter = enter,
        childName = "Тимофей",
        zoneName = zone,
        delayed = delayed,
        recordedAtIso = recordedAt,
        timeZone = msk,
        nowMs = now,
    )

    @Test
    fun `normal enter with zone unchanged`() {
        assertEquals(
            "Тимофей вошёл в зону «Школа».",
            body(true, "Школа", false, "2026-09-28T05:40:00.000Z"),
        )
    }

    @Test
    fun `normal exit with zone unchanged`() {
        assertEquals(
            "Тимофей вышел из зоны «Дом».",
            body(false, "Дом", false, "2026-09-28T04:58:00.000Z"),
        )
    }

    @Test
    fun `normal without zone unchanged`() {
        assertEquals("Тимофей вошёл в одну из геозон.", body(true, null, false, null))
        assertEquals("Тимофей вышел из одной из геозон.", body(false, null, false, null))
    }

    @Test
    fun `delayed enter shows local time of event`() {
        assertEquals(
            "Тимофей вошёл в зону «Школа» в 08:40 — данные пришли с опозданием.",
            body(true, "Школа", true, "2026-09-28T05:40:12.345Z"),
        )
    }

    @Test
    fun `delayed exit shows local time of event`() {
        assertEquals(
            "Тимофей вышел из зоны «Дом» в 07:58 — данные пришли с опозданием.",
            body(false, "Дом", true, "2026-09-28T04:58:00.000Z"),
        )
    }

    @Test
    fun `delayed iso without millis`() {
        assertEquals(
            "Тимофей вошёл в зону «Школа» в 08:40 — данные пришли с опозданием.",
            body(true, "Школа", true, "2026-09-28T05:40:00Z"),
        )
    }

    @Test
    fun `delayed event on previous day shows date`() {
        assertEquals(
            "Тимофей вышел из зоны «Дом» 27.09 в 22:15 — данные пришли с опозданием.",
            body(false, "Дом", true, "2026-09-27T19:15:00.000Z"),
        )
    }

    @Test
    fun `delayed crossing utc midnight is same local day`() {
        // 2026-09-27 21:30 UTC = 2026-09-28 00:30 МСК — сегодня по местному.
        assertEquals(
            "Тимофей вошёл в зону «Дом» в 00:30 — данные пришли с опозданием.",
            body(true, "Дом", true, "2026-09-27T21:30:00.000Z"),
        )
    }

    @Test
    fun `delayed without zone`() {
        assertEquals(
            "Тимофей вошёл в одну из геозон в 08:40 — данные пришли с опозданием.",
            body(true, null, true, "2026-09-28T05:40:00.000Z"),
        )
    }

    @Test
    fun `delayed with bad or missing recordedAt keeps note without time`() {
        assertEquals(
            "Тимофей вошёл в зону «Школа» — данные пришли с опозданием.",
            body(true, "Школа", true, "not-a-date"),
        )
        assertEquals(
            "Тимофей вышел из зоны «Дом» — данные пришли с опозданием.",
            body(false, "Дом", true, null),
        )
    }

    @Test
    fun `missed arrival with deadline`() {
        assertEquals("Аня: не в зоне «Школа»", GeofenceNotificationText.missedTitle("Аня", "Школа"))
        assertEquals(
            "Аня не пришёл(а) в «Школа» к 08:30.",
            GeofenceNotificationText.missedBody("Аня", "Школа", "08:30"),
        )
    }

    @Test
    fun `missed arrival without deadline and zone`() {
        assertEquals("Аня: не в зоне", GeofenceNotificationText.missedTitle("Аня", null))
        assertEquals(
            "Аня не пришёл(а) в зону к сроку.",
            GeofenceNotificationText.missedBody("Аня", null, null),
        )
    }

    @Test
    fun `no data with and without deadline`() {
        assertEquals("Аня: нет данных к сроку", GeofenceNotificationText.noDataTitle("Аня"))
        assertEquals(
            "Телефон не присылал местоположение — не знаем, пришёл(а) ли Аня в «Школа» к 08:30.",
            GeofenceNotificationText.noDataBody("Аня", "Школа", "08:30"),
        )
        assertEquals(
            "Телефон не присылал местоположение — не знаем, пришёл(а) ли Аня в «Школа».",
            GeofenceNotificationText.noDataBody("Аня", "Школа", null),
        )
    }

    @Test
    fun `notification id per child and zone for geofence`() {
        val enterA = GeofenceNotificationText.notificationId("GEOFENCE_ENTER", "c1", "zA")
        val exitA = GeofenceNotificationText.notificationId("GEOFENCE_EXIT", "c1", "zA")
        val enterB = GeofenceNotificationText.notificationId("GEOFENCE_ENTER", "c1", "zB")
        assertEquals("zone:c1:zA".hashCode(), enterA)
        assertEquals(enterA, exitA)
        assertNotEquals(enterA, enterB)
    }

    @Test
    fun `notification id for other types unchanged`() {
        assertEquals("SOS:c1".hashCode(), GeofenceNotificationText.notificationId("SOS", "c1", null))
        assertEquals(
            "GEOFENCE_ENTER:c1".hashCode(),
            GeofenceNotificationText.notificationId("GEOFENCE_ENTER", "c1", null),
        )
    }

    @Test
    fun `parse rejects garbage`() {
        assertNull(GeofenceNotificationText.parseIsoUtc("2026-09-28"))
        assertNull(GeofenceNotificationText.parseIsoUtc(""))
    }
}
