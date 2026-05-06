package ru.link28rus.gmd.gmd_parent

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

/**
 * Auto-update mobile-parent. Зеркало InstallerNative у mobile-child:
 * проверка REQUEST_INSTALL_PACKAGES special access + запуск системного
 * установщика APK через ACTION_VIEW + FileProvider.
 *
 * Поток:
 *   1. UpdateController (Dart) → fetch /api/public/updates/mobile-parent/latest
 *   2. Если version новее — Dio качает APK в getExternalCacheDir/updates/<file>.apk
 *   3. Channel.invokeMethod('installApk', {path}) → этот класс
 *   4. Если canRequestInstall == false → openInstallSourceSettings → user grant
 *   5. installApk → Intent(VIEW) → системный installer
 *
 * FileProvider authority: `${applicationId}.fileprovider` (см. AndroidManifest).
 * Пути: external-cache/updates/ (см. res/xml/file_provider_paths.xml).
 */
object InstallerNative {

    private const val TAG = "installer"

    fun canRequestInstall(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        return ctx.packageManager.canRequestPackageInstalls()
    }

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
            try {
                ctx.startActivity(
                    Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } catch (_: Throwable) { /* nothing else to do */ }
        }
    }

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
