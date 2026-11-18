package pro.periscop.child

/** Версионные правила отдельно от Android API для проверки границ 28/29+. */
object PermissionSnapshot {
    fun normalize(sdk: Int, values: Map<String, Boolean?>): Map<String, Boolean?> {
        val state = linkedMapOf<String, Boolean?>(
            "accessibility" to values["accessibility"],
            "deviceAdmin" to values["deviceAdmin"],
            "overlay" to values["overlay"],
            "notifications" to values["notifications"],
            "locationForeground" to values["locationForeground"],
            "locationBackground" to values["locationBackground"],
            "batteryUnrestricted" to values["batteryUnrestricted"],
            "usageStats" to values["usageStats"],
            "microphone" to values["microphone"],
            "activityRecognition" to values["activityRecognition"],
            "installPackages" to values["installPackages"],
        )
        if (sdk < 29) {
            state["locationBackground"] = state["locationForeground"]
            state["activityRecognition"] = true
        }
        if (state["locationForeground"] == false) state["locationBackground"] = false
        return state
    }
}
