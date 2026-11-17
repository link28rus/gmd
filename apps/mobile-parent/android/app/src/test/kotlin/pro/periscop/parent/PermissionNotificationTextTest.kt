package pro.periscop.parent

import org.junit.Assert.*
import org.junit.Test

class PermissionNotificationTextTest {
    @Test fun `перечисляет функции и предлагает восстановление`() {
        assertEquals("Тимофей: отключено Микрофон, Геолокация. Откройте приложение ребёнка и восстановите разрешения.",
            PermissionNotificationText.body("Тимофей", "Микрофон, Геолокация"))
    }
    @Test fun `без полей текст остаётся понятным`() {
        assertTrue(PermissionNotificationText.body(null, null).contains("разрешения"))
    }
    @Test fun `отзывы одного ребёнка не заменяют друг друга а повтор события имеет тот же id`() {
        assertNotEquals(PermissionNotificationText.notificationId("alert-a", "child"),
            PermissionNotificationText.notificationId("alert-b", "child"))
        assertEquals(PermissionNotificationText.notificationId("alert-a", "child"),
            PermissionNotificationText.notificationId("alert-a", "child"))
    }
}
