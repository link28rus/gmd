package pro.periscop.child

import org.junit.Assert.*
import org.junit.Test

class PermissionSnapshotTest {
    @Test fun `на старых Android нет ложного отказа фоновой геолокации и движения`() {
        val state = PermissionSnapshot.normalize(28, mapOf(
            "locationForeground" to true, "locationBackground" to false,
            "activityRecognition" to false, "microphone" to false,
        ))
        assertEquals(true, state["locationBackground"])
        assertEquals(true, state["activityRecognition"])
        assertEquals(false, state["microphone"])
    }
    @Test fun `фон без foreground невозможен даже при выданном background`() {
        for (sdk in listOf(28, 29, 33, 36)) {
            val state = PermissionSnapshot.normalize(sdk, mapOf(
                "locationForeground" to false, "locationBackground" to true,
            ))
            assertEquals(false, state["locationBackground"])
        }
    }
    @Test fun `отключенные функции и неудавшиеся проверки остаются неизвестными`() {
        val state = PermissionSnapshot.normalize(36, mapOf("deviceAdmin" to null))
        assertNull(state["accessibility"])
        assertNull(state["usageStats"])
        assertNull(state["deviceAdmin"])
    }
}
