package ru.link28rus.gmd.child

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

/**
 * v0.40 (Phase 6.x) — auto-update mobile-child.
 *
 * Native helpers для проверки REQUEST_INSTALL_PACKAGES special access и
 * запуска системного диалога установки APK через ACTION_VIEW + FileProvider.
 *
 * Поток:
 *   1. UpdateChecker (Dart) → fetch /api/public/updates/mobile-child/latest
 *   2. Если version новее — Dio качает APK в getExternalCacheDir/updates/<file>.apk
 *   3. Channel.invokeMethod('installApk', {path}) → этот класс
 *   4. Если canRequestInstall == false → openInstallSourceSettings → user grant
 *   5. installApk → Intent(VIEW) → системный installer
 *
 * **Permission `REQUEST_INSTALL_PACKAGES`:**
 *   - Это special access (Settings → Установка из неизвестных источников),
 *     не runtime-permission. Грантится на наш package, не глобально.
 *   - Без него Intent.ACTION_VIEW с APK uri показывает системный диалог
 *     «Запретить установку», а не наш installer.
 *
 * **FileProvider authority:** `${packageName}.fileprovider` (см. AndroidManifest).
 * Пути: `external-cache-path/updates/` (контролируем сами через DiagLog).
 */
object InstallerNative {

    private const val TAG = "installer"

    /**
     * Может ли наш app запустить системный installer для APK?
     *
     * На Android 7 (Nougat) и ниже — всегда true (REQUEST_INSTALL_PACKAGES
     * не существовало).
     * На Android 8+ — `PackageManager.canRequestPackageInstalls()`.
     *
     * Если false — UI должен направить пользователя в settings через
     * [openInstallSourceSettings].
     */
    fun canRequestInstall(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        return ctx.packageManager.canRequestPackageInstalls()
    }

    /**
     * Открыть Settings → Установка из неизвестных источников → наш app.
     *
     * `package:<our>` URI — Android открывает уже на нашем app в списке.
     * После grant'а пользователь возвращается → UI lifecycle resume → повторно
     * проверяет [canRequestInstall] → запускает [installApk].
     *
     * На Android < 8 — fallback в общий `ACTION_SECURITY_SETTINGS` (там
     * исторически был тумблер «Unknown sources»).
     */
    fun openInstallSourceSettings(ctx: Context) {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${ctx.packageName}"),
            )
        } else {
            @Suppress("DEPRECATION")
            Intent(Settings.ACTION_SECURITY_SETTINGS)
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            ctx.startActivity(intent)
        } catch (e: Throwable) {
            DiagLog.write(ctx, TAG, "openInstallSourceSettings failed: ${e.message}")
            // Fallback: общий settings, пользователь сам найдёт.
            try {
                ctx.startActivity(
                    Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } catch (_: Throwable) { /* nothing else to do */ }
        }
    }

    /**
     * Запустить системный installer для скачанного APK.
     *
     * @param filePath абсолютный путь к APK. Должен лежать в одной из директорий,
     *                 описанных в `res/xml/file_provider_paths.xml`
     *                 (рекомендуется `getExternalCacheDir()/updates/`).
     *
     * Если файл не существует или canRequestInstall == false — возвращает false
     * (UI должен показать ошибку или отправить в settings).
     */
    fun installApk(ctx: Context, filePath: String): Boolean {
        val file = File(filePath)
        if (!file.exists()) {
            DiagLog.write(ctx, TAG, "installApk: file not found: $filePath")
            return false
        }
        if (!canRequestInstall(ctx)) {
            DiagLog.write(ctx, TAG, "installApk: REQUEST_INSTALL_PACKAGES not granted")
            return false
        }
        val authority = "${ctx.packageName}.fileprovider"
        val uri: Uri = try {
            FileProvider.getUriForFile(ctx, authority, file)
        } catch (e: Throwable) {
            DiagLog.write(
                ctx,
                TAG,
                "installApk: FileProvider.getUriForFile failed (${e.javaClass.simpleName}: ${e.message}). " +
                    "Проверь file_provider_paths.xml — путь должен быть external-cache.",
            )
            return false
        }
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            ctx.startActivity(intent)
            DiagLog.write(ctx, TAG, "installApk: launched system installer for $filePath (${file.length()} bytes)")
            true
        } catch (e: Throwable) {
            DiagLog.write(ctx, TAG, "installApk: startActivity failed: ${e.message}")
            false
        }
    }

    /**
     * Очистить cache directory `updates/` (вызвать после успешного installer'а
     * или перед новой загрузкой). Идемпотентно.
     */
    fun cleanupCache(ctx: Context) {
        val dir = File(ctx.externalCacheDir, "updates")
        if (!dir.exists()) return
        try {
            dir.listFiles()?.forEach { it.delete() }
            DiagLog.write(ctx, TAG, "cleanupCache: cleared ${dir.absolutePath}")
        } catch (e: Throwable) {
            DiagLog.write(ctx, TAG, "cleanupCache failed: ${e.message}")
        }
    }
}
