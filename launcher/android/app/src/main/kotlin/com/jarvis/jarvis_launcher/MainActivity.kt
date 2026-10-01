package com.jarvis.jarvis_launcher

import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.AdaptiveIconDrawable
import android.graphics.drawable.BitmapDrawable
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.ByteArrayOutputStream

/**
 * The only genuinely native part of the launcher.
 *
 * Everything on the desktop platforms is pure Dart, because those OSes keep
 * their app registry in the filesystem. Android does not — the list of
 * launchable apps lives in PackageManager behind a permission check — so it
 * has to be asked properly.
 *
 * Two things are worth knowing about this file:
 *
 *   1. It queries for launchable activities, not installed packages. A package
 *      with no launcher intent is a service, a provider or a library, and
 *      listing those would fill the index with things that cannot be started.
 *
 *   2. Icons are converted to PNG here rather than passed as drawables,
 *      because a Drawable cannot cross a channel and a Bitmap can be encoded
 *      to bytes that can.
 */
class MainActivity : FlutterActivity() {

    companion object {
        private const val CHANNEL = "com.jarvis.launcher/apps"

        /** Where the encoded icons are written, so the Dart side can read them
         *  back as files. A base64 blob in a method-channel map would work but
         *  would be large and slow for a few hundred icons. */
        private const val ICON_DIR = "app_icons"
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "list" -> result.success(listLaunchableApps())
                    "launch" -> {
                        val id = call.argument<String>("id")
                        if (id == null) {
                            result.error("no_id", "launch called without an id", null)
                        } else {
                            launchPackage(id, result)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    /**
     * Every app the user can actually start.
     *
     * Sorted by label because the Dart side re-sorts on every query anyway, and
     * a stable first paint beats a clever one.
     */
    private fun listLaunchableApps(): List<Map<String, Any?>> {
        val pm = packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)

        val resolved = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.queryIntentActivities(
                intent,
                PackageManager.ResolveInfoFlags.of(0L),
            )
        } else {
            @Suppress("DEPRECATION")
            pm.queryIntentActivities(intent, 0)
        }

        val iconDir = java.io.File(filesDir, ICON_DIR).apply { mkdirs() }

        return resolved
            .mapNotNull { info ->
                val pkg = info.activityInfo?.packageName ?: return@mapNotNull null
                val label = runCatching { info.loadLabel(pm).toString() }
                    .getOrDefault(pkg)

                mapOf(
                    "id" to pkg,
                    "name" to label,
                    "icon" to writeIcon(pm, pkg, iconDir),
                )
            }
            // The same package can resolve more than once — a launcher activity
            // and an alias, most commonly. Deduplicating on the package name is
            // what stops one app appearing twice in the list.
            .distinctBy { it["id"] }
            .sortedBy { it["name"] as String }
    }

    /**
     * Encodes an app's icon to a PNG in the app's private storage.
     *
     * Returns the absolute path, or null if the icon cannot be produced — which
     * is normal and fine, because the Dart side falls back to a monogram.
     */
    private fun writeIcon(pm: PackageManager, pkg: String, iconDir: java.io.File): String? {
        return try {
            val drawable = pm.getApplicationIcon(pkg)
            val bitmap = when (drawable) {
                is BitmapDrawable -> drawable.bitmap
                is AdaptiveIconDrawable -> {
                    // Adaptive icons are vector layers, not bitmaps. They have to
                    // be drawn into one before they can be encoded, and the size
                    // has to be fixed because there is no intrinsic size to ask
                    // for.
                    val size = 192
                    val b = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
                    drawable.setBounds(0, 0, size, size)
                    drawable.draw(Canvas(b))
                    b
                }
                else -> {
                    val w = drawable.intrinsicWidth.coerceAtLeast(1)
                    val h = drawable.intrinsicHeight.coerceAtLeast(1)
                    val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                    drawable.setBounds(0, 0, w, h)
                    drawable.draw(Canvas(b))
                    b
                }
            }

            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            val file = java.io.File(iconDir, "$pkg.png")
            file.writeBytes(out.toByteArray())
            file.absolutePath
        } catch (_: Throwable) {
            // An icon is a nicety. A package with an unreadable icon still
            // deserves to be in the list.
            null
        }
    }

    /**
     * Starts a package by its launcher intent.
     *
     * The package's own launch intent is resolved rather than constructed,
     * because a hand-built `ACTION_MAIN` + `CATEGORY_LAUNCHER` intent is not
     * always what the app expects — some need a specific activity, and the
     * resolver knows which.
     */
    private fun launchPackage(pkg: String, result: MethodChannel.Result) {
        val intent = runCatching {
            packageManager.getLaunchIntentForPackage(pkg)
        }.getOrNull()

        if (intent == null) {
            result.error("no_launcher", "No launch intent for $pkg", null)
            return
        }

        runCatching {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
            result.success(null)
        }.onFailure { e ->
            result.error("launch_failed", e.message, null)
        }
    }
}
