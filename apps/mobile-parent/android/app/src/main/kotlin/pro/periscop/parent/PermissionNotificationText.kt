package pro.periscop.parent

object PermissionNotificationText {
    const val TITLE = "Отключены разрешения ребёнка"
    fun notificationId(alertId: String?, childId: String?): Int =
        ("permission:" + (alertId?.takeIf { it.isNotBlank() } ?: childId ?: "unknown")).hashCode()
    fun body(childName: String?, labels: String?): String {
        val name = childName?.takeIf { it.isNotBlank() } ?: "Ребёнок"
        val what = labels?.takeIf { it.isNotBlank() } ?: "необходимые разрешения"
        return "$name: отключено $what. Откройте приложение ребёнка и восстановите разрешения."
    }
}
