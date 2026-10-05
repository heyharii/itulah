package id.itulah.kasir.data

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID

/** What the node said when it refused. Carries the sentence, not a stack. */
class ApiError(message: String, val status: Int = 0) : Exception(message)

/**
 * The store-edge node, spoken to directly.
 *
 * One file, `HttpURLConnection`, and `org.json` — the same stack the handheld
 * uses, and for the same reason: this app makes perhaps twenty distinct calls,
 * and a code-generating HTTP framework would be more machinery than the surface
 * it wraps. The endpoints are the `/api/v1/store` family plus `auth/login`; there is no
 * `/pos` prefix because everything a shop does is already `/store`.
 *
 * **Nothing here decides what anything costs.** `quote` previews and `sale`
 * charges, and both are answered by the pricing engine at the node. If they
 * disagree the receipt is right — see `POS-TABLET-PLAN.md` §4.
 */
class Api(@Volatile var config: Config) {

    // ── Session ─────────────────────────────────────────────────────────

    /** Sign a cashier in. Returns the bearer the rest of this app rides on. */
    fun login(username: String, password: String): Pair<String, String> {
        val body = JSONObject().put("username", username).put("password", password)
        val answer = request("/api/v1/auth/login", "POST", body, authenticated = false)
        val token = answer.optString("token")
        if (token.isBlank()) throw ApiError("node menerima login tapi tidak memberi token")
        // Logged because a till that reaches the desk without a bearer looks
        // exactly like a till that is signed in, right up until the first
        // price fails to answer.
        android.util.Log.i(id.itulah.kasir.core.Perf.TAG, "login ok, token ${token.take(8)}…")
        val user = answer.optJSONObject("user")
        return token to (user?.optString("username") ?: username)
    }

    /**
     * Prove a second person, without giving them a session.
     *
     * A supervisor at a till is a step-up, not a login: the cashier stays
     * signed in and the approver is recorded against the one reversal they
     * approved. So this posts nothing and holds nothing — the credentials
     * travel inside the void or return request that needs them, and the node
     * checks them there, in the same transaction that writes the reversal.
     */
    fun me(): JSONObject = request("/api/v1/auth/me", "GET", null)

    // ── The book ────────────────────────────────────────────────────────

    /**
     * Ask about the SKUs actually in somebody's hand.
     *
     * This replaced loading the whole book, and the reason is a measurement,
     * not a preference. On a node with 100,000 SKUs the resident catalogue is
     * **32 MB over 200 requests and 14 seconds** on loopback alone; the ten
     * SKUs of an actual basket are **2 KB in one request and 31 ms**. A till
     * that holds the whole shop in order to price the ten garments in front of
     * it gets slower every time the range grows, and the range only grows.
     *
     * What is lost is the offline price preview. It was worth less than it
     * looked: the sale itself needs the node, so a till with no node cannot
     * complete a transaction anyway — and the figure that is charged has always
     * come from `POST /store/sales`, never from this.
     *
     * The node bounds this at 500 SKUs per call, which is far above any basket.
     */
    fun identities(skuCodes: Collection<String>): List<CatalogRow> {
        if (skuCodes.isEmpty()) return emptyList()
        val joined = skuCodes.joinToString(",")
        val answer = request("/api/v1/catalog/identities?skus=" + enc(joined), "GET", null)
        val items = answer.optJSONArray("items") ?: return emptyList()
        return (0 until items.length()).mapNotNull { index ->
            items.optJSONObject(index)?.let { CatalogRow.fromIdentity(it) }
        }
    }

    /**
     * Find a garment by name or code, at the node.
     *
     * Server-side because the shop's range does not fit on the tablet and
     * should not have to: 100,000 rows answered a name search in 15 ms with the
     * index doing the work. A till that filtered a local list would be fast
     * only while the shop was small.
     */
    fun search(needle: String, limit: Int = 20): List<CatalogRow> {
        if (needle.isBlank()) return emptyList()
        val page = request(
            "/api/v1/store/catalog?limit=$limit&q=" + enc(needle.trim()), "GET", null,
        )
        val items = page.optJSONArray("items") ?: return emptyList()
        return (0 until items.length()).mapNotNull { index ->
            items.optJSONObject(index)?.let { CatalogRow.from(it) }
        }
    }

    // ── The basket ──────────────────────────────────────────────────────

    /**
     * Price a basket without selling it.
     *
     * POST because a basket is a body, not because anything is written: no
     * sale, no movement, no coupon usage. This is how a cashier is told *why* a
     * discount did not come off before the money is taken rather than after.
     */
    fun quote(epcs: List<String>, coupons: List<String>, customerId: String?): Quote {
        val body = JSONObject()
            .put("epcs", JSONArray(epcs))
            .put("coupon_codes", JSONArray(coupons))
            .put("customer_id", customerId ?: JSONObject.NULL)
        return Quote.from(request("/api/v1/store/quote", "POST", body))
    }

    /**
     * Take the money. One shot.
     *
     * The whole transaction arrives at once — tags, tenders, coupons, the
     * idempotency key — and the node prices, writes and settles it inside one
     * SQLite transaction. There is no server-side cart to leave half-open on a
     * flaky link, and a retry of this exact key returns the original sale
     * rather than selling the garments twice.
     */
    fun sale(
        epcs: List<String>,
        tenders: List<Tender>,
        coupons: List<String>,
        customerId: String?,
        idempotencyKey: String,
    ): SaleResult {
        val body = JSONObject()
            .put("epcs", JSONArray(epcs))
            .put("tenders", JSONArray().apply { tenders.forEach { put(it.json()) } })
            // Overwritten by the node from the bearer. Sent because the
            // contract requires it, and because a request that travelled
            // through a queue should say who rang it up.
            .put("actor_id", config.cashier)
            .put("coupon_codes", JSONArray(coupons))
            .put("customer_id", customerId ?: JSONObject.NULL)
            .put("idempotency_key", idempotencyKey)
        return SaleResult.from(request("/api/v1/store/sales", "POST", body))
    }

    /**
     * Put a garment on the shop floor, from the stockroom.
     *
     * The node will not sell a unit that is not on the floor — it answers 409
     * with `insufficient quantity at <site>.floor:on_hand`. A customer holding
     * a shirt somebody fetched from the back is an ordinary sale, not an
     * exception, and it needs no supervisor: what actually happened is that the
     * garment moved, so the till records the movement and sells it.
     *
     * The place names carry their bucket. `store-07.warehouse` alone is
     * refused as an unknown place; `store-07.warehouse:on_hand` is the one the
     * ledger knows.
     */
    fun layOnFloor(epc: String, siteId: String): Boolean = runCatching {
        val body = JSONObject()
            .put("epc", epc)
            .put("quantity", 1)
            .put("from", "$siteId.warehouse:on_hand")
            .put("to", "$siteId.floor:on_hand")
            .put("reason", "Diambil dari gudang untuk pelanggan")
            .put("actor_id", config.cashier)
            .put("idempotency_key", "gudang-" + epc)
        request("/api/v1/store/movements", "POST", body)
        true
    }.getOrDefault(false)

    /**
     * The active payment methods Finance keeps in the cloud master (ERPNext
     * Mode of Payment). The node answers a bare array, which [request] wraps
     * as `items`; an object with `items` is read the same way.
     */
    fun paymentMethods(): List<PaymentMethod> {
        val items = request("/api/v1/store/payment-methods", "GET", null).optJSONArray("items")
            ?: return emptyList()
        return (0 until items.length()).mapNotNull { index ->
            items.optJSONObject(index)?.let { PaymentMethod.from(it) }
        }
    }

    // ── The drawer ──────────────────────────────────────────────────────

    /** The shift running at this terminal, or null — which is ordinary. */
    fun activeShift(): ShiftReport? {
        val answer = request("/api/v1/store/shifts/active?terminal_id=" + enc(config.terminalId), "GET", null)
        if (!answer.has("shift_id")) return null
        return ShiftReport.from(answer)
    }

    fun openShift(openingFloatMinor: Long): ShiftReport {
        val body = JSONObject()
            .put("terminal_id", config.terminalId)
            .put("opening_float_minor", openingFloatMinor)
            .put("actor_id", config.cashier)
            .put("idempotency_key", key())
        return ShiftReport.from(request("/api/v1/store/shifts", "POST", body))
    }

    fun shiftReport(shiftId: String): ShiftReport =
        ShiftReport.from(request("/api/v1/store/shifts/${enc(shiftId)}", "GET", null))

    /**
     * Money in or out of the drawer between sales.
     *
     * Signed: in is positive, out is negative. A magnitude plus a direction
     * column is the same number written twice, and the two disagree the first
     * time somebody writes a negative payout.
     */
    fun cashMovement(
        shiftId: String,
        kind: String,
        amountMinor: Long,
        reason: String,
        supervisor: Supervisor?,
    ): JSONObject {
        val body = JSONObject()
            .put("kind", kind)
            .put("amount_minor", amountMinor)
            .put("reason", reason)
            .put("actor_id", config.cashier)
            .put("supervisor", supervisor?.json() ?: JSONObject.NULL)
            .put("idempotency_key", key())
        return request("/api/v1/store/shifts/${enc(shiftId)}/movements", "POST", body)
    }

    /**
     * The blind close.
     *
     * What the cashier counted goes up with the request; the expected figure
     * comes back with the answer. A cashier shown the expectation first counts
     * toward it, and then the count means nothing.
     */
    fun closeShift(shiftId: String, declaredCashMinor: Long, note: String?): ShiftReport {
        val body = JSONObject()
            .put("declared_cash_minor", declaredCashMinor)
            .put("note", note ?: JSONObject.NULL)
            .put("actor_id", config.cashier)
            .put("idempotency_key", key())
        return ShiftReport.from(request("/api/v1/store/shifts/${enc(shiftId)}/close", "POST", body))
    }

    // ── Employee benefit balance ────────────────────────────────────────

    /** Whose code this is and what they have left. Does not use the code up. */
    fun benefitLookup(code: String): BenefitHolder =
        BenefitHolder.from(request("/api/v1/store/benefit/lookup", "POST", JSONObject().put("code", code)))

    /** Spend from the balance and use the code up; one spend per `saleRef`. */
    fun benefitSpend(code: String, saleRef: String, amountMinor: Long, basketHasPromotion: Boolean): BenefitHolder {
        val body = JSONObject()
            .put("code", code)
            .put("sale_ref", saleRef)
            .put("amount_minor", amountMinor)
            .put("basket_has_promotion", basketHasPromotion)
        return BenefitHolder.from(request("/api/v1/store/benefit/spend", "POST", body))
    }

    /** Put it back (cancelled payment, or a return). Answers the new balance. */
    fun benefitReturn(saleRef: String, amountMinor: Long, reason: String): Long {
        val body = JSONObject()
            .put("sale_ref", saleRef)
            .put("amount_minor", amountMinor)
            .put("reason", reason)
        // The node answers a bare number, which [request] hands back as `value`.
        return request("/api/v1/store/benefit/return", "POST", body).optString("value").toLongOrNull() ?: 0L
    }

    // ── Taking it back ──────────────────────────────────────────────────

    fun voidSale(saleId: String, reason: String, supervisor: Supervisor): JSONObject {
        val body = JSONObject()
            .put("reason", reason)
            .put("supervisor", supervisor.json())
            .put("actor_id", config.cashier)
            .put("idempotency_key", key())
        return request("/api/v1/store/sales/${enc(saleId)}/void", "POST", body)
    }

    fun returnSale(
        saleId: String,
        lines: List<ReturnLine>,
        refundMethod: String,
        reason: String,
        supervisor: Supervisor,
    ): JSONObject {
        val body = JSONObject()
            .put("sale_id", saleId)
            .put("lines", JSONArray().apply { lines.forEach { put(it.json()) } })
            .put("refund_method", refundMethod)
            .put("refund_reference", JSONObject.NULL)
            .put("reason", reason)
            .put("supervisor", supervisor.json())
            .put("actor_id", config.cashier)
            .put("idempotency_key", key())
        return request("/api/v1/store/returns", "POST", body)
    }

    // ── The paper ───────────────────────────────────────────────────────

    fun receipt(saleId: String): ReceiptDocument =
        ReceiptDocument.from(request("/api/v1/store/sales/${enc(saleId)}/receipt", "GET", null))

    /**
     * Render it and put it on the printer.
     *
     * The node does this, not the tablet: it is the party on the printer's LAN,
     * and a receipt rendered here would be a second implementation of the
     * paper. `copy` stamps every print after the first — two identical receipts
     * in a drawer at the end of the day are two sales to whoever counts them.
     */
    fun printReceipt(saleId: String, copy: Boolean): JSONObject {
        val body = JSONObject()
            .put("printer_host", config.printerHost)
            .put("printer_port", config.printerPort)
            .put("paper", config.paper)
            .put("drawer", if (copy) "NONE" else "PRINTER_PULSE")
            .put("copy", copy)
        return request("/api/v1/store/sales/${enc(saleId)}/receipt", "POST", body)
    }

    fun health(): JSONObject = request("/api/v1/health", "GET", null, authenticated = false)

    /**
     * What node this tablet is talking to, read from the node itself.
     *
     * The site is the node's fact, never the till's inference: a terminal id
     * that does not spell its shop used to send a floor movement to whichever
     * shop a fallback named. Unauthenticated by design — a node answers who it
     * is before anybody signs in, which is also how a till checks it has
     * reached the right shop.
     */
    fun nodeIdentity(): JSONObject =
        request("/api/v1/node/identity", "GET", null, authenticated = false)

    /**
     * Open the socket before anything needs it.
     *
     * The first call of a sale pays for the connection; every later one rides
     * it. Doing that while the cashier is still greeting the customer moves the
     * cost off the path where somebody is waiting.
     */
    fun warm() {
        runCatching { health() }
    }

    // ── The wire ────────────────────────────────────────────────────────

    private fun request(
        path: String,
        method: String,
        body: JSONObject?,
        authenticated: Boolean = true,
    ): JSONObject {
        if (config.nodeUrl.isBlank()) throw ApiError("kasir ini belum diarahkan ke node")
        val connection = URL(config.nodeUrl + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 8_000
        connection.readTimeout = 30_000
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Connection", "keep-alive")
        if (authenticated && config.token.isNotBlank()) {
            // A bearer rather than the cookie a browser would get: two edge
            // nodes name their cookie the same thing, and a tablet that may be
            // pointed at either must not depend on which one wrote it last.
            connection.setRequestProperty("Authorization", "Bearer ${config.token}")
        }
        if (body != null) {
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
        }
        val status = connection.responseCode
        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
        // Deliberately NOT `disconnect()`: that tears the socket down, so every
        // call pays a fresh TCP handshake — most of a round trip on shop wifi.
        // Draining the stream returns the connection to the keep-alive pool.
        if (status !in 200..299) {
            val reason = runCatching { JSONObject(text).optString("error") }.getOrNull()
            throw ApiError(if (reason.isNullOrBlank()) "HTTP $status" else reason, status)
        }
        if (text.isBlank()) return JSONObject()
        return runCatching { JSONObject(text) }
            .getOrElse {
                // A bare array is `items`; a bare number is `value`.
                if (text.trimStart().startsWith("[")) JSONObject().put("items", JSONArray(text))
                else JSONObject().put("value", text.trim())
            }
    }

    private fun enc(value: String) = URLEncoder.encode(value, "UTF-8")

    companion object {
        /**
         * An idempotency key for one attempt at one thing.
         *
         * Generated where the intent is formed, not where the request is sent,
         * so a retry after a timeout carries the SAME key and the node answers
         * with the original sale instead of ringing it twice. Callers that
         * retry must hold on to it.
         */
        fun key(): String = "kasir-" + UUID.randomUUID().toString().replace("-", "").take(24)
    }
}
