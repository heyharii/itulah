package id.itulah.kasir.core

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import id.itulah.kasir.data.Config
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * The garment's photograph, at the size a counter actually shows it.
 *
 * # Why the tablet downsamples
 *
 * The node serves the centre's master image — 1166×1750 and 154 KB for the one
 * measured here — because that is the picture that exists; it has no resizer.
 * Decoded whole, a ten-item basket would hold 80 MB of bitmaps for ten
 * thumbnails 56dp wide. `inSampleSize` decodes at a power-of-two fraction, so
 * the same file becomes ~150×220 and about 130 KB of pixels.
 *
 * # Why the bytes are still worth paying for
 *
 * The transfer is not: 154 KB per garment over shop wifi is real. But the node
 * caches each URL for the life of its process (315 ms cold, **7.5 ms warm** on
 * the node measured here), and this cache holds the decoded result, so the
 * second customer with the same shirt costs nothing at either end. The proper
 * fix is a resized variant at the node; until that exists this is the honest
 * shape of the cost, and it stays off the path that takes the money — a photo
 * that never arrives must not stop a sale.
 */
object Photos {
    private const val CACHE_BYTES = 24 * 1024 * 1024

    /** Decoded thumbnails. Bounded by bytes, not by count, because a bitmap's
     *  size is the thing that matters to a device with a shift to get through. */
    private val cache = object : LruCache<String, ImageBitmap>(CACHE_BYTES) {
        override fun sizeOf(key: String, value: ImageBitmap) = value.width * value.height * 4
    }

    /** SKUs the node has already said it has no picture for. Asked once. */
    private val missing = java.util.Collections.synchronizedSet(mutableSetOf<String>())

    fun cached(sku: String): ImageBitmap? = cache.get(sku)

    fun known(sku: String): Boolean = missing.contains(sku)

    /**
     * Fetch and decode, on a background thread. Returns null when there is no
     * picture — which is ordinary, not an error: plenty of a range has never
     * been photographed.
     */
    fun load(config: Config, sku: String, targetPx: Int): ImageBitmap? {
        cache.get(sku)?.let { return it }
        if (missing.contains(sku)) return null
        if (config.nodeUrl.isBlank() || config.token.isBlank()) return null

        val bytes = runCatching { fetch(config, sku) }.getOrNull()
        if (bytes == null) {
            missing.add(sku)
            return null
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= targetPx) sample *= 2
        val decoded = BitmapFactory.decodeByteArray(
            bytes, 0, bytes.size,
            BitmapFactory.Options().apply { inSampleSize = sample },
        ) ?: run { missing.add(sku); return null }
        val image = decoded.asImageBitmap()
        cache.put(sku, image)
        return image
    }

    private fun fetch(config: Config, sku: String): ByteArray? {
        val url = config.nodeUrl + "/api/v1/catalog/image?sku=" + URLEncoder.encode(sku, "UTF-8")
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 6_000
        connection.readTimeout = 15_000
        connection.setRequestProperty("Authorization", "Bearer ${config.token}")
        connection.setRequestProperty("Connection", "keep-alive")
        if (connection.responseCode !in 200..299) {
            connection.errorStream?.use { it.readBytes() }
            return null
        }
        val out = ByteArrayOutputStream()
        connection.inputStream.use { it.copyTo(out) }
        return out.toByteArray()
    }
}
