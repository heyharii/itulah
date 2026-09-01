package id.itulah.pindai.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import id.itulah.pindai.core.Epc
import id.itulah.pindai.core.Reader
import id.itulah.pindai.core.TagRead
import id.itulah.pindai.data.Api
import id.itulah.pindai.data.ConfigStore
import id.itulah.pindai.data.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

enum class Mode(val title: String, val verb: String) {
    SCAN("Pindai", "Kirim observasi"),
    PACKING("Packing", "Buat koli"),
    RECEIVING("Terima", "Terima barang"),
    COUNT("Stock Opname", "Kirim hitungan"),
}

data class Seen(val epc: String, val rssi: Float?, val sku: String?, val serial: Long?)

/** What a SKU is, as the node knows it. Absent until the lookup answers. */
data class Identity(
    val sku: String,
    val name: String,
    val articleCode: String?,
    val imageUrl: String?,
    val basePriceMinor: Long?,
)

/** One product line of a sweep: what it is, and how many of it are here. */
data class Grouped(val sku: String, val qty: Int, val identity: Identity?)

data class SweepState(
    val mode: Mode = Mode.SCAN,
    val sweeping: Boolean = false,
    val busy: Boolean = false,
    val seen: List<Seen> = emptyList(),
    val message: String? = null,
    val failed: Boolean = false,
    val readerInfo: String? = null,
    val destination: String = "",
    val countId: String = "",
    val lastReceipt: String? = null,
    val counts: List<Pair<String, String>> = emptyList(),
    val countsLoaded: Boolean = false,
    val identities: Map<String, Identity> = emptyMap(),
    val resolving: Boolean = false,
    val resolveNote: String? = null,
)

/**
 * The sweep as products rather than tags.
 *
 * This is pure local arithmetic over what is already in memory — grouping 49
 * tags into a dozen lines costs nothing and needs no network, because the SKU
 * is carried inside the EPC itself.
 */
fun SweepState.grouped(): List<Grouped> =
    seen.mapNotNull { it.sku }
        .groupingBy { it }
        .eachCount()
        .map { (sku, qty) -> Grouped(sku, qty, identities[sku]) }
        .sortedWith(compareByDescending<Grouped> { it.qty }.thenBy { it.sku })

/**
 * One sweep, four uses.
 *
 * Scanning, packing, receiving and counting differ in what they MEAN, not in how
 * a tag reaches the antenna — so they share the collector and diverge only at
 * the moment of commit. Every one of them files the same RFID observation batch
 * first: the observation is the evidence that these tags were in this place at
 * this time, and it stands whether or not the session that follows succeeds.
 */
class SweepViewModel(
    private val reader: Reader,
    private val config: ConfigStore,
) : ViewModel() {

    val state = MutableStateFlow(SweepState())
    private val collector = ConcurrentHashMap<String, Seen>()
    private var sessionId = UUID.randomUUID().toString()

    private fun settings(): Settings = config.load()

    fun setMode(mode: Mode) = update { it.copy(mode = mode, message = null, failed = false) }
    fun setDestination(v: String) = update { it.copy(destination = v.trim()) }
    fun setCountId(v: String) = update { it.copy(countId = v.trim()) }

    /**
     * What Official Count work this DC actually holds.
     *
     * Typing a count id from memory is how somebody files a hundred entries
     * against last month's count. The list is the centre's, read fresh.
     */
    fun loadCounts() {
        val settings = settings()
        if (!settings.isConfigured) return
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val json = Api(settings).get("/api/v1/dc/official-counts")
                    val items = json.optJSONArray("items") ?: org.json.JSONArray()
                    (0 until items.length()).map { i ->
                        val row = items.getJSONObject(i)
                        val id = row.optString("count_id").ifBlank { row.optString("id") }
                        val label = row.optString("kind", "COUNT") + " · " +
                            row.optString("status", "?")
                        id to label
                    }
                }
            }
            result.onSuccess { list ->
                update {
                    it.copy(counts = list, countsLoaded = true,
                        countId = if (it.countId.isBlank() && list.isNotEmpty())
                            list.first().first else it.countId)
                }
            }.onFailure { update { it.copy(countsLoaded = true, counts = emptyList()) } }
        }
    }

    /**
     * Name the distinct SKUs of this sweep in ONE request.
     *
     * Fifty tags on a rack are a dozen products, and the products repeat across
     * sweeps, so the work is bounded twice: by DISTINCT before the call, and by
     * a cache that already holds most of the answer after the first rack. What
     * a tag IS never waits on this — that came out of the EPC locally. This
     * only fills in the human-readable name and the picture.
     */
    fun resolveIdentities() {
        val settings = settings()
        if (!settings.isConfigured) return
        val wanted = state.value.seen.mapNotNull { it.sku }.toSet() - state.value.identities.keys
        if (wanted.isEmpty()) return
        viewModelScope.launch {
            update { it.copy(resolving = true, resolveNote = null) }
            val started = System.currentTimeMillis()
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val json = Api(settings).get(
                        "/api/v1/catalog/identities?skus=" + wanted.joinToString(","),
                    )
                    val items = json.optJSONArray("items") ?: org.json.JSONArray()
                    (0 until items.length()).associate { i ->
                        val row = items.getJSONObject(i)
                        val sku = row.optString("sku_code")
                        sku to Identity(
                            sku = sku,
                            name = row.optString("name", sku),
                            articleCode = row.optString("article_code").ifBlank { null },
                            imageUrl = row.optString("image_url").ifBlank { null },
                            basePriceMinor = if (row.isNull("base_price_minor")) null
                                else row.optLong("base_price_minor"),
                        )
                    }
                }
            }
            val elapsed = System.currentTimeMillis() - started
            result.onSuccess { found ->
                update {
                    it.copy(
                        identities = it.identities + found,
                        resolving = false,
                        resolveNote = "${found.size}/${wanted.size} SKU dikenali · ${elapsed} ms",
                    )
                }
            }.onFailure { e ->
                // Not fatal and not hidden: the sweep is still complete and
                // still sendable, it just has no names on it yet.
                update {
                    it.copy(resolving = false,
                        resolveNote = "nama tak tersedia di node ini (${e.message})")
                }
            }
        }
    }

    fun clear() {
        collector.clear()
        sessionId = UUID.randomUUID().toString()
        update { it.copy(seen = emptyList(), message = null, failed = false, lastReceipt = null) }
    }

    fun toggleSweep() {
        if (state.value.sweeping) stopSweep() else startSweep()
    }

    private fun startSweep() {
        viewModelScope.launch {
            update { it.copy(busy = true, message = "Menyiapkan reader…", failed = false) }
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val version = reader.init(appContext!!)
                    val started = reader.start(withTid = false) { read -> absorb(read) }
                    if (!started) error("reader menolak mulai inventory")
                    version
                }
            }
            result.onSuccess { version ->
                update {
                    it.copy(sweeping = true, busy = false,
                        readerInfo = "fw $version · ${reader.power()} dBm",
                        message = "Membaca…")
                }
            }.onFailure { e ->
                update { it.copy(busy = false, failed = true, message = e.message ?: "reader gagal") }
            }
        }
    }

    private fun stopSweep() {
        viewModelScope.launch {
            withContext(Dispatchers.IO) { reader.stop() }
            update { it.copy(sweeping = false, message = "${collector.size} tag terbaca") }
            resolveIdentities()
        }
    }

    private fun absorb(read: TagRead) {
        val parts = Epc.decode(read.epc)
        val existing = collector[read.epc]
        // Keep the strongest sighting: a tag read six times from three angles is
        // still one tag, and the best signal is the honest one to report.
        if (existing == null || (read.rssi ?: -999f) > (existing.rssi ?: -999f)) {
            collector[read.epc] = Seen(read.epc, read.rssi, parts?.skuCode, parts?.serial)
        }
        update { it.copy(seen = collector.values.sortedBy { s -> s.epc }) }
    }

    /** File the evidence, then do whatever this mode means on top of it. */
    fun commit() {
        val current = state.value
        val settings = settings()
        if (!settings.isConfigured) {
            update { it.copy(failed = true, message = "Setelan belum lengkap") }; return
        }
        if (current.seen.isEmpty()) {
            update { it.copy(failed = true, message = "Belum ada tag") }; return
        }
        viewModelScope.launch {
            update { it.copy(busy = true, message = "Mengirim…", failed = false) }
            if (current.sweeping) withContext(Dispatchers.IO) { reader.stop() }
            // Two steps, reported separately on purpose. The observation is
            // evidence and stands on its own; if the session on top of it fails,
            // saying "gagal" would hide a batch that is already filed and send
            // somebody back to re-sweep a rack for nothing.
            val outcome = withContext(Dispatchers.IO) {
                val api = Api(settings)
                val observed = runCatching {
                    api.postObservations(current.seen.map { it.epc to it.rssi }, sessionId)
                }
                val sighted = observed.getOrNull()
                    ?.optInt("consolidated_sighting_count", current.seen.size)
                val extra = if (sighted == null) null else runCatching {
                    when (current.mode) {
                        Mode.SCAN -> null
                        Mode.PACKING -> packing(api, current)
                        Mode.RECEIVING -> receiving(api, current)
                        Mode.COUNT -> counting(api, current)
                    }
                }
                Triple(sighted, extra, observed.exceptionOrNull())
            }
            val (sighted, extra, observeError) = outcome
            when {
                sighted == null -> update {
                    it.copy(busy = false, sweeping = false, failed = true,
                        message = observeError?.message ?: "observasi gagal")
                }
                extra?.isFailure == true -> update {
                    it.copy(busy = false, sweeping = false, failed = true,
                        message = "$sighted observasi TERKIRIM · " +
                            (extra.exceptionOrNull()?.message ?: "langkah lanjutan gagal"))
                }
                else -> {
                    val text = "$sighted observasi terkirim" +
                        (extra?.getOrNull()?.let { " · $it" } ?: "")
                    update { it.copy(busy = false, sweeping = false, failed = false,
                        message = text, lastReceipt = text) }
                }
            }
        }
    }

    /** A carton for one shop, targeted by what the sweep actually found. */
    private fun packing(api: Api, s: SweepState): String {
        if (s.destination.isBlank()) throw IllegalStateException("isi toko tujuan dulu")
        val targets = s.seen.mapNotNull { it.sku }.groupingBy { it }.eachCount()
        if (targets.isEmpty()) throw IllegalStateException("tak ada tag ber-SKU kita di sapuan ini")
        val payload = JSONObject().apply {
            put("destination_store_id", s.destination)
            put("target", org.json.JSONArray().apply {
                targets.forEach { (sku, qty) ->
                    put(JSONObject().put("sku_code", sku).put("target_qty", qty))
                }
            })
            put("actor_id", "handheld")
            put("note", "dibuat dari sapuan handheld")
        }
        val response = api.post("/api/v1/dc/packing-boxes", payload)
        // The id lives on the nested session; a box only becomes a koli when it
        // is sealed, so `koli_id` is legitimately null at this point.
        val id = response.optJSONObject("session")?.optString("session_id").orEmpty()
        return "sesi ${id.take(8).ifBlank { "?" }} · ${targets.size} SKU"
    }

    /** Each tag arrives at the shop as its own unit. */
    private fun receiving(api: Api, s: SweepState): String {
        var ok = 0
        var skipped = 0
        s.seen.forEach { seen ->
            val sku = seen.sku
            if (sku == null) { skipped++; return@forEach }
            val payload = JSONObject().apply {
                put("epc", seen.epc)
                put("sku_code", sku)
                put("unit_price_minor", 0)
                put("actor_id", "handheld")
                put("idempotency_key", "hh-recv-" + seen.epc)
            }
            runCatching { api.post("/api/v1/store/receive", payload) }
                .onSuccess { ok++ }.onFailure { skipped++ }
        }
        return "$ok diterima" + if (skipped > 0) ", $skipped dilewati" else ""
    }

    /** Entries against an Official Count the centre already opened. */
    private fun counting(api: Api, s: SweepState): String {
        if (s.countId.isBlank()) throw IllegalStateException("pilih count dulu")
        val entries = org.json.JSONArray()
        s.seen.forEach { seen ->
            entries.put(JSONObject().put("epc", seen.epc).put("found_quantity", 1))
        }
        val payload = JSONObject().apply {
            put("entries", entries)
            put("actor_id", "handheld")
            put("idempotency_key", "hh-count-" + sessionId.take(12))
        }
        api.post("/api/v1/dc/official-counts/${s.countId}/entries", payload)
        return "${s.seen.size} entri hitungan"
    }

    fun releaseReader() {
        runCatching { reader.stop() }
    }

    private inline fun update(block: (SweepState) -> SweepState) {
        state.value = block(state.value)
    }

    companion object {
        /** Set once by the activity; the reader needs a Context to open the UART. */
        @Volatile var appContext: android.content.Context? = null
    }
}
