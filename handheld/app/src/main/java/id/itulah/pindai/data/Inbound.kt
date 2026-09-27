package id.itulah.pindai.data

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Deliveries the centre has announced to this shop, and what receiving one said.
 *
 * # The count is blind, and that is the whole design
 *
 * A shop that can see "12 expected" while it sweeps stops sweeping at twelve.
 * The number it then files is the number it was told, not the number that came
 * off the lorry, and a short delivery is received as a full one. So nothing in
 * this file carries an expected quantity for a delivery that is still on its
 * way: `result` is null while it is IN_TRANSIT, and the list has no lines. The
 * comparison exists only in the answer to the receive itself, after the shop
 * has committed to what it found.
 */

/** Which kind of node this handheld is pointed at. */
enum class NodeRole {
    UNKNOWN, DC, STORE;

    companion object {
        /**
         * A first guess from the Site ID in Setelan, good enough to draw the
         * right screen before the node has answered.
         *
         * Only a guess. The node's own `/api/v1/health` says `node_role`, and
         * that answer replaces this one the moment it arrives — a shop whose
         * site happens to be called `dc-annex` is still a shop.
         */
        fun fromSiteId(siteId: String): NodeRole {
            val site = siteId.trim().lowercase()
            return when {
                site.startsWith("dc") -> DC
                site.startsWith("store") || site.startsWith("shop") ||
                    site.startsWith("toko") -> STORE
                else -> UNKNOWN
            }
        }

        /** The node's own word, from `/api/v1/health`. */
        fun fromHealth(role: String?): NodeRole = when (role?.trim()?.uppercase()) {
            "DC" -> DC
            "STORE" -> STORE
            else -> UNKNOWN
        }
    }
}

/** What receiving a delivery came to. Only ever present once it is RECEIVED. */
data class InboundResult(
    val expectedUnits: Int,
    val receivedUnits: Int,
    val missingUnits: Int,
    val extraUnits: Int,
)

/** One delivery on its way to this shop, or already received by it. */
data class InboundDelivery(
    val deliveryId: String,
    /** The surat jalan number, when the DC printed one. */
    val shipmentReference: String?,
    val sourceSiteId: String,
    val departedAt: String?,
    val status: String,
    val koliCount: Int,
    val receivedAt: String?,
    val receivedBy: String?,
    /** Null while in transit. See the note at the top of this file. */
    val result: InboundResult?,
) {
    val isReceived: Boolean get() = status.equals("RECEIVED", ignoreCase = true)

    /** What the floor calls it: the paper in the driver's hand, or where it came from. */
    val title: String
        get() = shipmentReference?.takeIf { it.isNotBlank() }
            ?: "Delivery from ${sourceSiteId.ifBlank { "the DC" }}"
}

/** One product of a received delivery: what was sent against what arrived. */
data class InboundLine(
    val skuCode: String,
    val name: String?,
    val expected: Int,
    val received: Int,
    val missing: Int,
    val extra: Int,
    val missingEpcs: List<String>,
    val extraEpcs: List<String>,
) {
    val hasProblem: Boolean get() = missing > 0 || extra > 0
}

/** The node's answer to a receive, or its record of one. */
data class InboundReceipt(
    val delivery: InboundDelivery,
    val lines: List<InboundLine>,
    val skippedEpcs: List<String>,
    /**
     * This is somebody else's receive, not ours.
     *
     * Set when the node answered 409 — the delivery was already received from a
     * different sweep — and the screen is showing what was recorded THEN. The
     * sweep in the operator's hand was not applied, and the screen must say so,
     * or it reads as a receipt for work that did not happen.
     */
    val alreadyReceived: Boolean = false,
)

object Inbound {

    /** The most EPCs one receive will take. Past this the node refuses the body whole. */
    const val MAX_EPCS = 20_000

    /** The only status the shop is asked to choose from. */
    const val IN_TRANSIT = "IN_TRANSIT"

    /**
     * A key that names this delivery AND this exact set of tags, and nothing else.
     *
     * The node answers a repeated key with the answer it already gave, so a
     * receive whose response was lost on shop wifi can simply be sent again and
     * is counted once. That only works if a retry produces the SAME key, which
     * is why the EPCs are sorted and upper-cased first: the order the radio
     * happened to hear them in is not part of what was received.
     *
     * The delivery is in it too. Two deliveries swept to the same set of tags —
     * a lorry received against the wrong surat jalan and then the right one —
     * are two different requests, and must not collide.
     */
    fun receiveKey(deliveryId: String, epcs: Collection<String>): String {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(deliveryId.trim().toByteArray(Charsets.UTF_8))
        digest.update('\n'.code.toByte())
        epcs.asSequence().map { it.trim().uppercase() }.distinct().sorted().forEach {
            digest.update(it.toByteArray(Charsets.UTF_8))
            digest.update('\n'.code.toByte())
        }
        return "hh-inbound-" + digest.digest().joinToString("") { "%02x".format(it) }.take(48)
    }

    /**
     * Problems first, and the worst problem first.
     *
     * The shop reads this screen to find out what to chase, and a delivery of
     * two hundred products with three short lines is three lines worth reading.
     * They go to the top, largest discrepancy first; everything that matched
     * follows, by name, where it is out of the way and still findable.
     */
    fun problemsFirst(lines: List<InboundLine>): List<InboundLine> =
        lines.sortedWith(
            compareByDescending<InboundLine> { it.hasProblem }
                .thenByDescending { it.missing + it.extra }
                .thenBy { (it.name ?: it.skuCode).lowercase() }
                .thenBy { it.skuCode },
        )

    // ---------------------------------------------------------------- parsing

    fun parseDeliveries(json: JSONObject): List<InboundDelivery> {
        val rows = json.optJSONArray("deliveries") ?: return emptyList()
        return (0 until rows.length()).mapNotNull { i ->
            rows.optJSONObject(i)?.let(::parseDelivery)?.takeIf { it.deliveryId.isNotBlank() }
        }
    }

    fun parseDelivery(o: JSONObject): InboundDelivery = InboundDelivery(
        deliveryId = o.text("delivery_id").orEmpty(),
        shipmentReference = o.text("shipment_reference"),
        sourceSiteId = o.text("source_site_id").orEmpty(),
        departedAt = o.text("departed_at"),
        status = o.text("status") ?: IN_TRANSIT,
        koliCount = o.optInt("koli_count", 0),
        receivedAt = o.text("received_at"),
        receivedBy = o.text("received_by"),
        result = o.optJSONObject("result")?.let { r ->
            InboundResult(
                expectedUnits = r.optInt("expected_units", 0),
                receivedUnits = r.optInt("received_units", 0),
                missingUnits = r.optInt("missing_units", 0),
                extraUnits = r.optInt("extra_units", 0),
            )
        },
    )

    /** The answer to a receive, and the detail of a received delivery: one shape. */
    fun parseReceipt(json: JSONObject, alreadyReceived: Boolean = false): InboundReceipt {
        // The detail endpoint might answer with the delivery at the top level
        // rather than under `delivery`. Both are read, so a small difference in
        // how the node wraps it does not become a blank result screen.
        val delivery = parseDelivery(json.optJSONObject("delivery") ?: json)
        val rows = json.optJSONArray("lines") ?: JSONArray()
        val lines = (0 until rows.length()).mapNotNull { i ->
            rows.optJSONObject(i)?.let { l ->
                InboundLine(
                    skuCode = l.text("sku_code").orEmpty(),
                    name = l.text("name"),
                    expected = l.optInt("expected", 0),
                    received = l.optInt("received", 0),
                    missing = l.optInt("missing", 0),
                    extra = l.optInt("extra", 0),
                    missingEpcs = l.optJSONArray("missing_epcs").strings(),
                    extraEpcs = l.optJSONArray("extra_epcs").strings(),
                )
            }
        }
        return InboundReceipt(
            delivery = delivery,
            lines = problemsFirst(lines),
            skippedEpcs = json.optJSONArray("skipped_epcs").strings(),
            alreadyReceived = alreadyReceived,
        )
    }

    /**
     * A string field, or null.
     *
     * Not `optString`: on a JSON `null` that returns the four characters
     * "null", and a delivery titled "null" is exactly the kind of thing that
     * ships because it looked like data.
     */
    private fun JSONObject.text(name: String): String? =
        if (!has(name) || isNull(name)) null else optString(name).takeIf { it.isNotBlank() }

    private fun JSONArray?.strings(): List<String> {
        if (this == null) return emptyList()
        return (0 until length()).mapNotNull { i -> optString(i).takeIf { it.isNotBlank() } }
    }
}
