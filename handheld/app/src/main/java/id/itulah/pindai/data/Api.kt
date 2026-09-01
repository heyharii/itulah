package id.itulah.pindai.data

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class ApiError(message: String) : Exception(message)

/**
 * The Edge, spoken to directly.
 *
 * Observations carry a device proof: the reader signs the exact body it is
 * about to send, plus a timestamp and a sequence that only ever climbs. The
 * Edge verifies that before it reads a single EPC, so a replayed or edited
 * batch is refused rather than filed. A human bearer token may ride alongside
 * for attribution, but it never substitutes for the device credential — who
 * carried the reader and which reader it was are different questions.
 */
class Api(private val settings: Settings) {

    private var sequence: Long = System.currentTimeMillis() / 1000

    fun postObservations(reads: List<Pair<String, Float?>>, sessionId: String): JSONObject {
        if (reads.isEmpty()) throw ApiError("tidak ada tag untuk dikirim")
        val observations = JSONArray()
        reads.forEach { (epc, rssi) ->
            observations.put(JSONObject().apply {
                put("epc", epc)
                if (rssi != null) put("rssi", rssi.toDouble())
                put("read_count", 1)
            })
        }
        val body = JSONObject().apply {
            put("site_id", settings.siteId)
            put("pool", settings.pool)
            put("reader_session_id", sessionId)
            put("observed_at", iso8601Now())
            put("idempotency_key", "hh-" + UUID.randomUUID().toString().replace("-", "").take(20))
            put("observations", observations)
        }.toString().toByteArray()

        val timestamp = System.currentTimeMillis() / 1000
        val seq = nextSequence()
        val digest = sha256Hex(body)
        val canonical = "POST\n$OBSERVATION_PATH\n${settings.deviceId}\n$timestamp\n$seq\n$digest"
        val signature = hmacSha256Hex(sha256Hex(settings.deviceKey.toByteArray()), canonical)

        return request(
            path = OBSERVATION_PATH,
            method = "POST",
            body = body,
            headers = mapOf(
                "x-device-id" to settings.deviceId,
                "x-device-timestamp" to timestamp.toString(),
                "x-device-sequence" to seq.toString(),
                "x-device-signature" to signature,
            ),
            withOperator = true,
        )
    }

    fun get(path: String): JSONObject = request(path, "GET", null, emptyMap(), true)

    fun post(path: String, payload: JSONObject): JSONObject =
        request(path, "POST", payload.toString().toByteArray(), emptyMap(), true)

    fun health(): JSONObject = request("/api/v1/health", "GET", null, emptyMap(), false)

    fun login(username: String, password: String): String {
        val body = JSONObject().put("username", username).put("password", password)
        val response = request("/api/v1/auth/login", "POST", body.toString().toByteArray(),
            emptyMap(), false)
        return response.optString("token")
    }

    @Synchronized
    private fun nextSequence(): Long {
        val now = System.currentTimeMillis() / 1000
        sequence = if (now > sequence) now else sequence + 1
        return sequence
    }

    private fun request(
        path: String,
        method: String,
        body: ByteArray?,
        headers: Map<String, String>,
        withOperator: Boolean,
    ): JSONObject {
        val connection = URL(settings.baseUrl + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 15_000
        connection.readTimeout = 40_000
        connection.setRequestProperty("Accept", "application/json")
        if (body != null) connection.setRequestProperty("Content-Type", "application/json")
        headers.forEach { (k, v) -> connection.setRequestProperty(k, v) }
        if (withOperator && settings.operatorToken.isNotBlank()) {
            connection.setRequestProperty("Authorization", "Bearer ${settings.operatorToken}")
        }
        if (body != null) {
            connection.doOutput = true
            connection.outputStream.use { it.write(body) }
        }
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
        connection.disconnect()
        if (code !in 200..299) {
            val reason = runCatching { JSONObject(text).optString("error") }.getOrNull()
            throw ApiError(if (reason.isNullOrBlank()) "HTTP $code" else reason)
        }
        if (text.isBlank()) return JSONObject()
        return runCatching { JSONObject(text) }
            .getOrElse { JSONObject().put("items", JSONArray(text)) }
    }

    private companion object {
        const val OBSERVATION_PATH = "/api/v1/rfid/observations"

        fun sha256Hex(bytes: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(bytes)
                .joinToString("") { String.format(Locale.ROOT, "%02x", it) }

        fun hmacSha256Hex(keyHex: String, message: String): String {
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(keyHex.toByteArray(), "HmacSHA256"))
            return mac.doFinal(message.toByteArray())
                .joinToString("") { String.format(Locale.ROOT, "%02x", it) }
        }

        fun iso8601Now(): String {
            val format = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT)
            format.timeZone = java.util.TimeZone.getTimeZone("UTC")
            return format.format(java.util.Date())
        }
    }
}
