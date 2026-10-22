package id.itulah.pindai.data

/** What one attempt at staying current did. */
sealed class SyncOutcome {
    /** The node holds the generation we hold. Nothing moved, nothing was sent. */
    data class UpToDate(val generation: Long, val items: Long) : SyncOutcome()
    data class Updated(val generation: Long, val items: Int, val millis: Long) : SyncOutcome()

    /** The node has never been given a catalogue. Not our fault and not an error. */
    object NodeHasNone : SyncOutcome()

    /** The catalogue moved while we were reading it. Try again, keep the old one. */
    object Torn : SyncOutcome()
    data class Failed(val reason: String) : SyncOutcome()
}

/**
 * Keeping the handheld's product master current, by asking one small question.
 *
 * # Why there is no delta here
 *
 * Because there is no delta to ask for. A catalogue in this fleet is a whole
 * snapshot with a generation: the centre hashes the entire product list, and
 * when that hash moves it publishes everything again to every node, which
 * stages the chunks and swaps them in one piece. Nothing anywhere records that
 * *this* SKU changed.
 *
 * So the handheld does the same thing at its own scale. It asks which
 * generation the node holds — one row, a few dozen bytes, and the usual answer
 * is "the one you already have". Only when the answer differs does anything
 * travel, and then all of it travels.
 *
 * At the size this estate actually is — five hundred articles, three to five
 * thousand SKUs — a whole catalogue is under a second. A delta protocol would
 * buy nothing and would have to invent tombstones to stay correct. If the day
 * comes when the catalogue is big enough to hurt, the thing that hurts first is
 * the centre republishing it to every node on every edit, not this.
 */
class CatalogSync(private val store: CatalogStore) {

    fun nodeKey(settings: Settings): String = settings.baseUrl + "|" + settings.siteId

    fun localMeta(settings: Settings): CatalogMeta? = store.meta(nodeKey(settings))

    /**
     * Bring the local copy up to the node's generation, or leave it entirely
     * alone.
     *
     * Blocking; call it from IO. [onPulling] is called, on this thread, only
     * when the generation differs and the whole catalogue is about to travel —
     * the one moment worth telling a screen about.
     */
    fun refresh(settings: Settings, onPulling: () -> Unit = {}): SyncOutcome {
        if (!settings.isConfigured) return SyncOutcome.Failed("settings are incomplete")
        val key = nodeKey(settings)
        val api = Api(settings, connectTimeoutMs = CONNECT_MS)
        val began = System.currentTimeMillis()

        val head = runCatching { api.catalogSnapshot() }
            .getOrElse { return SyncOutcome.Failed(it.message ?: "node unreachable") }
        val generation = head.optLong("generation")
        val hash = head.optString("content_hash")
        if (generation <= 0L) return SyncOutcome.NodeHasNone

        val local = store.meta(key)
        if (local != null && local.generation == generation && local.contentHash == hash) {
            return SyncOutcome.UpToDate(generation, local.itemCount)
        }

        onPulling()
        val rows = ArrayList<CatalogRow>(4096)
        var after: String? = null
        while (true) {
            val page = runCatching { api.catalogItems(after, PAGE) }
                .getOrElse { return SyncOutcome.Failed(it.message ?: "catalogue unreadable") }
            // Every page says which generation it was read at. A catalogue that
            // moves mid-pull would otherwise leave us holding the first half of
            // one and the second half of another — a torn snapshot that passes
            // every check and names some products wrongly. The edge refuses a
            // half-applied catalogue for the same reason; so do we.
            if (page.optLong("generation") != generation) return SyncOutcome.Torn
            val items = page.optJSONArray("items") ?: org.json.JSONArray()
            for (i in 0 until items.length()) {
                val row = items.getJSONObject(i)
                val sku = row.optString("sku_code")
                if (sku.isBlank()) continue
                rows.add(
                    CatalogRow(
                        skuCode = sku,
                        name = row.optString("name").ifBlank { sku },
                        articleCode = row.optString("article_code").ifBlank { null },
                        divisionCode = row.optString("division_code").ifBlank { null },
                        barcode = row.optString("barcode").ifBlank { null },
                        basePriceMinor = if (row.isNull("base_price_minor")) null
                            else row.optLong("base_price_minor"),
                        active = row.optBoolean("active", true),
                    ),
                )
            }
            val next = page.opt("next_cursor")
            val cursor = if (next == null || next === org.json.JSONObject.NULL) null
                else next.toString().ifBlank { null }
            if (cursor == null || items.length() == 0) break
            after = cursor
        }

        store.replaceAll(key, generation, hash, rows, Api.iso8601())
        return SyncOutcome.Updated(generation, rows.size, System.currentTimeMillis() - began)
    }

    private companion object {
        /**
         * A thousand rows a page. The edge caps at two thousand; half of that
         * keeps one page comfortably inside a shop-wifi round trip, so a pull
         * that fails fails cheaply and resumes from the cursor rather than the
         * beginning.
         */
        const val PAGE = 1_000

        /**
         * An Edge on the same LAN answers in milliseconds. Four seconds is
         * already generous, and the alternative — the default fifteen — is
         * fifteen seconds of "checking" on a handheld that was never going to
         * reach it. Scanning does not wait for this either way; the operator's
         * reading of the screen does.
         */
        const val CONNECT_MS = 4_000
    }
}
