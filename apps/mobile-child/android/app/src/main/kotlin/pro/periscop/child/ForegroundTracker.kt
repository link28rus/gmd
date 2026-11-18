package pro.periscop.child

/** Собственное окно блокировки и автоматический HOME не заменяют ограниченное приложение. */
class ForegroundTracker(private val own: String) {
    var packageName: String? = null
        private set
    fun observe(pkg: String, windowClass: String?, overlayVisible: Boolean, home: Boolean) {
        val ownActivity = windowClass == "$own.MainActivity" || windowClass == "$own.MicWakeActivity"
        if(overlayVisible && (home || (pkg == own && !ownActivity))) return
        packageName = pkg
    }
    fun clear() { packageName = null }
}
