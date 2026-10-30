package id.itulah.pindai.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * Verify koli, on the Gudang (owner, 25 Oct 2026): Packed in Central sends a
 * store, this handheld reads every packed koli of it, and Verify is offered
 * only when the read is the same — every tag of that store's koli, none of
 * another store's. Optional: a store goes on its trip verified or not.
 */

/** One packed koli of a store waiting to be read. */
data class VerifyKoli(
    val koliId: String,
    val number: String,
    val total: Int,
)

/** A store Packed sent to the handheld. */
data class VerifyStore(
    val storeId: String,
    val code: String,
    val name: String,
    val requestedBy: String,
    val requestedAt: String?,
    val total: Int,
    val koli: List<VerifyKoli>,
)

/** One koli against the sweep. */
data class KoliRead(
    val koliId: String,
    val number: String,
    val total: Int,
    val read: Int,
) {
    val complete: Boolean get() = total > 0 && read == total
}

/** Tags of another store's packed koli, heard in this sweep. */
data class WrongKoli(
    val number: String,
    val storeCode: String,
    val tags: Int,
)

/** What Central made of the sweep against the chosen store. */
data class StoreCheck(
    val storeId: String,
    val matches: Boolean,
    val total: Int,
    val read: Int,
    val koli: List<KoliRead>,
    val wrong: List<WrongKoli>,
)

object Verify {
    const val REQUESTS_PATH = "/api/v1/dc/koli-rfid/requests"

    fun parseStores(json: JSONObject): List<VerifyStore> {
        val rows = json.optJSONArray("items") ?: return emptyList()
        return (0 until rows.length()).mapNotNull { i ->
            rows.optJSONObject(i)?.let(::parseStore)?.takeIf { it.storeId.isNotBlank() }
        }
    }

    private fun parseStore(o: JSONObject): VerifyStore {
        val koli = o.optJSONArray("koli") ?: JSONArray()
        return VerifyStore(
            storeId = o.text("store_id").orEmpty(),
            code = o.text("store_code") ?: o.text("store_id").orEmpty(),
            name = o.text("store_name") ?: o.text("store_code").orEmpty(),
            requestedBy = o.text("requested_by").orEmpty(),
            requestedAt = o.text("requested_at"),
            total = o.optInt("total", 0),
            koli = (0 until koli.length()).mapNotNull { i ->
                koli.optJSONObject(i)?.let { k ->
                    VerifyKoli(
                        koliId = k.text("koli_id").orEmpty(),
                        number = k.text("koli_number").orEmpty(),
                        total = k.optInt("total", 0),
                    )
                }
            },
        )
    }

    fun parseCheck(json: JSONObject): StoreCheck {
        val koli = json.optJSONArray("koli") ?: JSONArray()
        val wrong = json.optJSONArray("wrong_store") ?: JSONArray()
        return StoreCheck(
            storeId = json.text("store_id").orEmpty(),
            matches = json.optBoolean("matches", false),
            total = json.optInt("total", 0),
            read = json.optInt("read", 0),
            koli = (0 until koli.length()).mapNotNull { i ->
                koli.optJSONObject(i)?.let { k ->
                    KoliRead(
                        koliId = k.text("koli_id").orEmpty(),
                        number = k.text("koli_number").orEmpty(),
                        total = k.optInt("total", 0),
                        read = k.optInt("read", 0),
                    )
                }
            },
            wrong = (0 until wrong.length()).mapNotNull { i ->
                wrong.optJSONObject(i)?.let { w ->
                    WrongKoli(
                        number = w.text("koli_number").orEmpty(),
                        storeCode = w.text("store_code").orEmpty(),
                        tags = w.optInt("tags", 0),
                    )
                }
            },
        )
    }

    /** The EPCs of a sweep, as one body. */
    fun epcBody(epcs: List<String>): JSONObject =
        JSONObject().put("epcs", JSONArray().apply { epcs.forEach { put(it) } })

    /** A string field, or null. See Inbound's `text` for why not `optString`. */
    private fun JSONObject.text(name: String): String? =
        if (!has(name) || isNull(name)) null else optString(name).takeIf { it.isNotBlank() }
}
