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

/**
 * A refusal from the Edge, carrying the status that produced it.
 *
 * The code is kept rather than flattened into a message because the difference
 * between "refused" and "refused for THIS reason" decides whether a batch is
 * retried or dropped, and matching on prose would be a string comparison
 * against another team's wording.
 *
 * A 409 was once treated as an acknowledgement here. It is not: since the Edge
 * stopped comparing sequences, a conflict can only mean this key carries
 * different content, and that is a batch nobody has accepted.
 */
class ApiError(message: String, val status: Int = 0) : Exception(message) {
    val isConflict: Boolean get() = status == 409
}

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
class Api(
    private val settings: Settings,
    /**
     * Where the device sequence carries on from.
     *
     * Without this each `Api` restarts the counter from the wall clock, and a
     * drain that sends eight batches leaves the counter eight seconds ahead of
     * it — so the next drain begins behind what the Edge has already accepted
     * and every batch in it comes back refused.
     */
    private val sequenceFloor: () -> Long = { 0L },
    private val onSequence: (Long) -> Unit = {},
    /**
     * How long to wait for a socket that may never answer.
     *
     * Fifteen seconds is right for filing evidence: that batch matters and the
     * caller is a background job nobody is watching. It is wrong for the
     * catalogue check at startup, where an Edge that is simply not there leaves
     * a job hanging for fifteen seconds and the operator reading "checking" for
     * all of it. A question asked on every launch gets a short deadline.
     */
    private val connectTimeoutMs: Int = 15_000,
) {

    private var sequence: Long = maxOf(System.currentTimeMillis() / 1000, sequenceFloor())

    /**
     * Build the exact bytes of one observation batch, once and for all.
     *
     * Separated from sending because those bytes are written to the outbox and
     * then sent — possibly much later, possibly several times. They are never
     * rebuilt: `observed_at` and the idempotency key live INSIDE this body, so
     * a regenerated batch hashes differently and the Edge sees a different
     * request under a key it has already recorded. That is a conflict, not a
     * retry.
     */
    fun buildObservationBody(
        reads: List<Pair<String, Float?>>,
        sessionId: String,
        idempotencyKey: String,
        observedAt: String = iso8601Now(),
    ): ByteArray {
        if (reads.isEmpty()) throw ApiError("tidak ada tag untuk dikirim")
        val observations = JSONArray()
        reads.forEach { (epc, rssi) ->
            observations.put(JSONObject().apply {
                put("epc", epc)
                if (rssi != null) put("rssi", rssi.toDouble())
                put("read_count", 1)
            })
        }
        return JSONObject().apply {
            put("site_id", settings.siteId)
            put("pool", settings.pool)
            put("reader_session_id", sessionId)
            put("observed_at", observedAt)
            put("idempotency_key", idempotencyKey)
            put("observations", observations)
        }.toString().toByteArray()
    }

    /**
     * Send a body that was built earlier, signing it fresh.
     *
     * The proof cannot travel with the body. The Edge checks the signature's
     * timestamp against a 300-second window in BOTH directions, so a batch that
     * waited out an offline spell can never be replayed with the proof it was
     * born with — it has to be signed again, with a new timestamp and a new
     * sequence, over the same unchanged bytes.
     *
     * [withOperator] false leaves the bearer off. The device's own proof is
     * what files the batch; the bearer only says who was holding the reader,
     * and an operator whose sign-in has expired must not be the reason
     * evidence stops reaching the Edge.
     */
    fun postObservationBody(body: ByteArray, withOperator: Boolean = true): JSONObject {
        val timestamp = System.currentTimeMillis() / 1000
        val seq = nextSequence()
        val digest = sha256Hex(body)
        val signature = signObservation(settings.deviceId, settings.deviceKey, timestamp, seq, digest)

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
            withOperator = withOperator,
        )
    }

    fun get(path: String): JSONObject = request(path, "GET", null, emptyMap(), true)

    fun post(path: String, payload: JSONObject): JSONObject =
        request(path, "POST", payload.toString().toByteArray(), emptyMap(), true)

    fun health(): JSONObject = request("/api/v1/health", "GET", null, emptyMap(), false)

    /**
     * Which catalogue this node is holding — one row, a few dozen bytes.
     *
     * This is the whole cost of being up to date on a device that already is,
     * which is the usual case. A catalogue only moves when somebody changes a
     * product, and then every node in the fleet moves together.
     */
    fun catalogSnapshot(): JSONObject = get("/api/v1/catalog/snapshot")

    /** One page of the catalogue, walked by SKU. */
    fun catalogItems(after: String?, limit: Int): JSONObject {
        val query = StringBuilder("/api/v1/catalog/snapshot/items?limit=").append(limit)
        if (!after.isNullOrBlank()) {
            query.append("&after=").append(java.net.URLEncoder.encode(after, "UTF-8"))
        }
        return get(query.toString())
    }

    /**
     * Deliveries announced to this shop. See [Inbound] for why none of them
     * carries a quantity while it is in transit.
     *
     * Operator-authenticated, like every store action: the bearer token rides
     * along from Setelan exactly as it does for packing and counting.
     */
    fun inboundDeliveries(status: String = Inbound.IN_TRANSIT): JSONObject =
        get("/api/v1/store/inbound?status=" + java.net.URLEncoder.encode(status, "UTF-8"))

    /** One delivery, with its lines once it has been received. */
    fun inboundDelivery(deliveryId: String): JSONObject =
        get("/api/v1/store/inbound/" + pathSegment(deliveryId))

    /**
     * Receive one delivery: every tag of ours this sweep found, in ONE request.
     *
     * One, not chunks. The comparison the node answers with is only true over
     * the whole delivery — a first chunk would report everything in the second
     * as missing, and the node closes the delivery on the first receive it
     * accepts. The node takes up to [Inbound.MAX_EPCS], which is more than a
     * lorry carries.
     */
    fun receiveInbound(
        deliveryId: String,
        epcs: List<String>,
        actorId: String,
        idempotencyKey: String,
    ): JSONObject {
        val payload = JSONObject().apply {
            put("epcs", JSONArray().apply { epcs.forEach { put(it) } })
            put("actor_id", actorId)
            put("idempotency_key", idempotencyKey)
        }
        return post("/api/v1/store/inbound/" + pathSegment(deliveryId) + "/receive", payload)
    }

    /** The stores Packed sent to be verified, each with its packed koli. */
    fun verifyStores(): JSONObject = get(Verify.REQUESTS_PATH)

    /** What a sweep comes to against one store. Saved nowhere. */
    fun checkStore(storeId: String, epcs: List<String>): JSONObject =
        post(Verify.REQUESTS_PATH + "/" + pathSegment(storeId) + "/check", Verify.epcBody(epcs))

    /** Verify the store. Central refuses it (409) unless the sweep matches. */
    fun verifyStore(storeId: String, epcs: List<String>): JSONObject =
        post(Verify.REQUESTS_PATH + "/" + pathSegment(storeId) + "/verify", Verify.epcBody(epcs))

    /**
     * Open the socket before anything needs it.
     *
     * The first request of a sweep pays for the connection; every later one
     * rides it. Doing that while the operator is still pulling the trigger
     * moves the cost off the path where anybody is waiting.
     */
    fun warm() {
        runCatching { health() }
    }

    fun login(username: String, password: String): String {
        val body = JSONObject().put("username", username).put("password", password)
        val response = request("/api/v1/auth/login", "POST", body.toString().toByteArray(),
            emptyMap(), false)
        return response.optString("token")
    }

    /** An id as one URL path segment. `URLEncoder` is for queries, hence the `+`. */
    private fun pathSegment(id: String): String =
        java.net.URLEncoder.encode(id.trim(), "UTF-8").replace("+", "%20")

    @Synchronized
    private fun nextSequence(): Long {
        val now = System.currentTimeMillis() / 1000
        sequence = if (now > sequence) now else sequence + 1
        onSequence(sequence)
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
        connection.connectTimeout = connectTimeoutMs
        connection.readTimeout = 40_000
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Connection", "keep-alive")
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
        // Deliberately NOT disconnect(): that tears the socket down, so every
        // call pays a fresh TCP handshake — most of a 200ms round trip on shop
        // wifi. Draining the stream returns the connection to the keep-alive
        // pool instead, and the second request costs a fraction of the first.
        if (code !in 200..299) {
            val reason = runCatching { JSONObject(text).optString("error") }.getOrNull()
            throw ApiError(if (reason.isNullOrBlank()) "HTTP $code" else reason, code)
        }
        if (text.isBlank()) return JSONObject()
        return runCatching { JSONObject(text) }
            .getOrElse { JSONObject().put("items", JSONArray(text)) }
    }

    companion object {
        private const val OBSERVATION_PATH = "/api/v1/rfid/observations"

        /**
         * The device proof, exactly as the Edge recomputes it.
         *
         * Pulled out of the request so it can be pinned to a golden vector.
         * The Edge upper-cases the device id BEFORE it signs, so a handheld
         * commissioned with lower-case text signs something the node will never
         * agree with — and the refusal it gets back says "invalid signature",
         * which sends whoever reads it hunting for a wrong key. The same
         * normalisation is applied here, and the vector in `ApiSigningTest`
         * is what keeps the two from drifting apart again.
         */
        fun signObservation(
            deviceId: String,
            deviceKey: String,
            timestamp: Long,
            sequence: Long,
            bodySha256: String,
        ): String {
            val device = deviceId.trim().uppercase()
            val canonical =
                "POST\n$OBSERVATION_PATH\n$device\n$timestamp\n$sequence\n$bodySha256"
            return hmacSha256Hex(sha256Hex(deviceKey.toByteArray()), canonical)
        }

        /** The SHA-256 of a request body, as the proof carries it. */
        fun bodyDigest(body: ByteArray): String = sha256Hex(body)

        /** One clock format for everything this app writes down. */
        fun iso8601(): String = iso8601Now()

        /** The same clock, moved by whole days — used to age the outbox out. */
        fun iso8601Days(days: Int): String {
            val format = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT)
            format.timeZone = java.util.TimeZone.getTimeZone("UTC")
            return format.format(
                java.util.Date(System.currentTimeMillis() + days * 86_400_000L),
            )
        }

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
