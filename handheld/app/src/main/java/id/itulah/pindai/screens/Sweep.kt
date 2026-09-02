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
    SCAN("Scan", "Finish"),
    PACKING("Packing", "Finish · open carton"),
    RECEIVING("Receive", "Finish · receive"),
    COUNT("Stock count", "Finish · submit"),
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

/** One session as it appears in the list of work in progress. */
data class SessionBrief(
    val code: String,
    val tagCount: Int,
    val deviceCount: Int,
    val lastSeenAt: String?,
)

/** One reader's contribution to a shared session. */
data class Helper(val deviceId: String, val tagCount: Int)

/**
 * The combined state of a session several handhelds are working together.
 *
 * [tagCount] counts DISTINCT tags, not sightings: two readers sweeping the same
 * shelf see the same garment, and that is one unit. Counting sightings would
 * inflate the total by exactly the amount of help offered.
 */
data class SharedSession(
    val code: String,
    val tagCount: Int,
    val sightingCount: Int,
    val helpers: List<Helper>,
    val epcs: List<String>,
    val truncated: Boolean,
)

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
    val lines: List<Grouped> = emptyList(),
    val foreignCount: Int = 0,
    val identities: Map<String, Identity> = emptyMap(),
    val resolving: Boolean = false,
    val resolveNote: String? = null,
    val filedCount: Int = 0,
    val filingNote: String? = null,
    val sessionCode: String = "",
    val shared: SharedSession? = null,
    val sharedNote: String? = null,
    val sessions: List<SessionBrief> = emptyList(),
    val sessionsLoaded: Boolean = false,
)

/**
 * The sweep as products rather than tags.
 *
 * Computed when the reader's findings are PUBLISHED, not while the screen
 * draws. Composition must never do O(n log n) work: a continuous sweep
 * re-reads the same tags many times a second, and grouping and sorting on
 * every frame is what turned a fifty-tag rack into visible lag.
 */
internal fun regroup(seen: List<Seen>, identities: Map<String, Identity>): List<Grouped> =
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

    val state = MutableStateFlow(SweepState(sessionCode = config.load().sessionCode))
    private val collector = ConcurrentHashMap<String, Seen>()

    /** Tags whose evidence is already on the Edge; never filed twice. */
    private val filed = java.util.Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())
    private var autoJob: kotlinx.coroutines.Job? = null
    private val dirty = java.util.concurrent.atomic.AtomicBoolean(false)
    private var sessionId = UUID.randomUUID().toString()

    /** The id every batch of this sweep is filed under — shared when joined. */
    private fun currentSessionId(): String =
        state.value.sessionCode.ifBlank { sessionId }

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
                            // Point at the node, not at the object store. The
                            // store's own domain is redirected to a block page
                            // by Indonesian ISPs, so a handheld on shop wifi
                            // gets a notice where a JPEG should be; the node is
                            // not on that network and is already trusted here.
                            imageUrl = if (row.optString("image_url").isNotBlank()) {
                                settings.baseUrl + "/api/v1/catalog/image?sku=" + sku
                            } else null,
                            basePriceMinor = if (row.isNull("base_price_minor")) null
                                else row.optLong("base_price_minor"),
                        )
                    }
                }
            }
            val elapsed = System.currentTimeMillis() - started
            result.onSuccess { found ->
                update {
                    val merged = it.identities + found
                    it.copy(
                        identities = merged,
                        lines = regroup(it.seen, merged),
                        resolving = false,
                        resolveNote = "${found.size}/${wanted.size} named · ${elapsed} ms",
                    )
                }
            }.onFailure { e ->
                // Not fatal and not hidden: the sweep is still complete and
                // still sendable, it just has no names on it yet.
                update {
                    it.copy(resolving = false,
                        resolveNote = "names unavailable here (${e.message})")
                }
            }
        }
    }

    /**
     * Join a session by name, or leave it.
     *
     * A shared session needs no coordinator and no lock — only agreement on a
     * name. Each reader keeps signing its own batches under its own key; what
     * makes them one count is that they all file under this string.
     *
     * The code is short and typable on purpose: it is read aloud across a
     * warehouse floor, not copied between machines.
     */
    fun setSessionCode(code: String) {
        val cleaned = code.trim().uppercase().filter { it.isLetterOrDigit() || it == '-' }.take(24)
        config.save(config.load().copy(sessionCode = cleaned))
        update { it.copy(sessionCode = cleaned, shared = null, sharedNote = null) }
        if (cleaned.isNotBlank()) refreshShared()
    }

    /**
     * Begin a session by naming one.
     *
     * Nothing is reserved: the name starts existing when the first batch is
     * filed under it. The alphabet drops O/0 and I/1 because these codes are
     * read aloud across a floor, and "S-I0K" is an argument waiting to happen.
     */
    fun newSessionCode() {
        val alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        val code = (1..6).map { alphabet.random() }.joinToString("")
        setSessionCode("S-$code")
        loadSessions()
    }

    /** Work in progress on this node, so somebody arriving can choose. */
    fun loadSessions() {
        val settings = settings()
        if (!settings.isConfigured) {
            update { it.copy(sessionsLoaded = true) }
            return
        }
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val json = Api(settings).get("/api/v1/rfid/sessions")
                    val items = json.optJSONArray("items") ?: org.json.JSONArray()
                    (0 until items.length()).map { i ->
                        val row = items.getJSONObject(i)
                        SessionBrief(
                            code = row.optString("reader_session_id"),
                            tagCount = row.optInt("tag_count"),
                            deviceCount = row.optInt("device_count"),
                            lastSeenAt = row.optString("last_seen_at").ifBlank { null },
                        )
                    }
                }
            }
            result.onSuccess { list ->
                update { it.copy(sessions = list, sessionsLoaded = true) }
            }.onFailure {
                update { it.copy(sessions = emptyList(), sessionsLoaded = true) }
            }
        }
    }

    /** What everyone in this session has found so far. */
    fun refreshShared() {
        val settings = settings()
        val code = state.value.sessionCode
        if (!settings.isConfigured || code.isBlank()) return
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val json = Api(settings).get("/api/v1/rfid/sessions/" + code)
                    val devices = json.optJSONArray("devices") ?: org.json.JSONArray()
                    val epcArray = json.optJSONArray("epcs") ?: org.json.JSONArray()
                    SharedSession(
                        code = code,
                        tagCount = json.optInt("tag_count"),
                        sightingCount = json.optInt("sighting_count"),
                        helpers = (0 until devices.length()).map { i ->
                            val row = devices.getJSONObject(i)
                            Helper(row.optString("device_id"), row.optInt("tag_count"))
                        },
                        epcs = (0 until epcArray.length()).map { i -> epcArray.getString(i) },
                        truncated = json.optBoolean("truncated"),
                    )
                }
            }
            result.onSuccess { session ->
                update { it.copy(shared = session, sharedNote = null) }
            }.onFailure { e ->
                update { it.copy(sharedNote = e.message ?: "session unreadable") }
            }
        }
    }

    fun toggleSweep() {
        if (state.value.sweeping) stopSweep() else startSweep()
    }

    private fun startSweep() {
        viewModelScope.launch {
            update { it.copy(busy = true, message = "Waking the reader…", failed = false) }
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val version = reader.init(appContext!!)
                    val started = reader.start(withTid = false) { read -> absorb(read) }
                    if (!started) error("the reader refused to start inventory")
                    version
                }
            }
            result.onSuccess { version ->
                update {
                    it.copy(sweeping = true, busy = false,
                        readerInfo = "fw $version · ${reader.power()} dBm",
                        message = "Reading…")
                }
                startAutoFiling()
            }.onFailure { e ->
                update { it.copy(busy = false, failed = true, message = e.message ?: "reader unavailable") }
            }
        }
    }

    private fun stopSweep() {
        viewModelScope.launch {
            withContext(Dispatchers.IO) { reader.stop() }
            autoJob?.cancel()
            autoJob = null
            dirty.set(true)
            publish()
            update { it.copy(sweeping = false, message = "${collector.size} tags read") }
            // Anything the last tick missed goes now, so stopping is a complete
            // act rather than a promise.
            fileNewTags()
            resolveIdentities()
        }
    }

    /**
     * File evidence as it is found, rather than at the end.
     *
     * A sweep can end in ways nobody chose: a flat battery on the top step of a
     * ladder, an app killed behind a locked screen, a walk out of wifi range.
     * Holding an hour of counting in memory until somebody remembers a button
     * means all of it is one accident away from never having happened. Filing
     * as we go also means the people sharing this session see the aisle fill in
     * while it is being walked, not twenty minutes later.
     *
     * Only NEW tags travel each tick, so the cost is proportional to what was
     * just found and not to how long the sweep has run.
     */
    private fun startAutoFiling() {
        autoJob?.cancel()
        autoJob = viewModelScope.launch {
            // Open the socket while the operator is still pulling the trigger,
            // so the first real batch does not also pay for the handshake.
            val settings = settings()
            if (settings.isConfigured) {
                withContext(Dispatchers.IO) { runCatching { Api(settings).warm() } }
            }
            var tick = 0
            while (state.value.sweeping) {
                kotlinx.coroutines.delay(200)
                publish()
                // Evidence and names travel every ten ticks — two seconds — so
                // the radio is quiet between them.
                if (++tick % 10 == 0) {
                    fileNewTags()
                    resolveIdentities()
                    // The point of a shared session is watching the aisle fill
                    // in while it is walked. Refreshing only on join and on
                    // finish meant the card sat at "shared session" for the
                    // whole sweep — the number arrived when it was no longer
                    // any use to the person deciding which rack to take next.
                    if (state.value.sessionCode.isNotBlank()) refreshShared()
                }
            }
        }
    }

    private suspend fun fileNewTags() {
        val settings = settings()
        if (!settings.isConfigured) return
        val fresh = collector.values.filter { filed.add(it.epc) }
        if (fresh.isEmpty()) return
        val started = System.currentTimeMillis()
        val outcome = withContext(Dispatchers.IO) {
            runCatching {
                Api(settings).postObservations(
                    fresh.map { it.epc to it.rssi }, currentSessionId(),
                )
            }
        }
        val elapsed = System.currentTimeMillis() - started
        outcome.onSuccess {
            update {
                it.copy(filedCount = filed.size,
                    filingNote = "${filed.size} filed · ${elapsed} ms")
            }
        }.onFailure { e ->
            // Put them back: unfiled evidence must stay unfiled, or a dropped
            // batch becomes a tag nobody ever files.
            fresh.forEach { filed.remove(it.epc) }
            update { it.copy(filingNote = "not filed yet (${e.message})") }
        }
    }

    /**
     * Called from the reader's own thread, many times a second.
     *
     * It does the least possible: keep the strongest sighting of each tag and
     * return. Publishing to the UI is somebody else's job on a timer, because a
     * continuous sweep re-reads the same tags constantly and pushing state on
     * every read asks Compose to redraw hundreds of times a second for a number
     * that changed once.
     */
    private fun absorb(read: TagRead) {
        val existing = collector[read.epc]
        if (existing == null || (read.rssi ?: -999f) > (existing.rssi ?: -999f)) {
            val parts = Epc.decode(read.epc)
            collector[read.epc] = Seen(read.epc, read.rssi, parts?.skuCode, parts?.serial)
            dirty.set(true)
        }
    }

    /** Push what the reader has found, at a pace an eye can follow. */
    private fun publish() {
        if (!dirty.getAndSet(false)) return
        val seen = collector.values.sortedBy { it.epc }
        update {
            it.copy(
                seen = seen,
                lines = regroup(seen, it.identities),
                foreignCount = seen.count { s -> s.sku == null },
            )
        }
    }

    /** File the evidence, then do whatever this mode means on top of it. */
    fun commit() {
        val current = state.value
        val settings = settings()
        if (!settings.isConfigured) {
            update { it.copy(failed = true, message = "Settings are incomplete") }; return
        }
        if (current.seen.isEmpty()) {
            update { it.copy(failed = true, message = "Nothing swept yet") }; return
        }
        viewModelScope.launch {
            update { it.copy(busy = true, message = "Sending…", failed = false) }
            if (current.sweeping) withContext(Dispatchers.IO) { reader.stop() }
            // Evidence is already on the Edge — it went as the sweep ran. All
            // that is left is anything the last tick missed, and then the act
            // this mode actually means. Keeping the two apart matters: an
            // observation is a fact, a carton or a receipt is a decision, and a
            // decision that fails must never make the facts look unfiled.
            val flushed = runCatching { fileNewTags() }
            val outcome = withContext(Dispatchers.IO) {
                runCatching {
                    val api = Api(settings)
                    when (current.mode) {
                        Mode.SCAN -> null
                        Mode.PACKING -> packing(api, current)
                        Mode.RECEIVING -> receiving(api, current)
                        Mode.COUNT -> counting(api, current)
                    }
                }
            }
            val filedNow = filed.size
            when {
                flushed.isFailure -> update {
                    it.copy(busy = false, sweeping = false, failed = true,
                        message = "some tags are not filed yet: " +
                            (flushed.exceptionOrNull()?.message ?: "unknown"))
                }
                outcome.isFailure -> update {
                    it.copy(busy = false, sweeping = false, failed = true,
                        message = "$filedNow observations FILED · " +
                            (outcome.exceptionOrNull()?.message ?: "next step failed"))
                }
                else -> {
                    val text = "$filedNow observations filed" +
                        (outcome.getOrNull()?.let { " · $it" } ?: "")
                    update { it.copy(busy = false, sweeping = false, failed = false,
                        message = text, lastReceipt = text) }
                    refreshShared()
                }
            }
        }
    }

    /** A carton for one shop, targeted by what the sweep actually found. */
    private fun packing(api: Api, s: SweepState): String {
        if (s.destination.isBlank()) throw IllegalStateException("name the destination shop first")
        val targets = s.seen.mapNotNull { it.sku }.groupingBy { it }.eachCount()
        if (targets.isEmpty()) throw IllegalStateException("no tags of ours in this sweep")
        val payload = JSONObject().apply {
            put("destination_store_id", s.destination)
            put("target", org.json.JSONArray().apply {
                targets.forEach { (sku, qty) ->
                    put(JSONObject().put("sku_code", sku).put("target_qty", qty))
                }
            })
            put("actor_id", "handheld")
            put("note", "opened from a handheld sweep")
        }
        val response = api.post("/api/v1/dc/packing-boxes", payload)
        // The id lives on the nested session; a box only becomes a koli when it
        // is sealed, so `koli_id` is legitimately null at this point.
        val id = response.optJSONObject("session")?.optString("session_id").orEmpty()
        return "carton ${id.take(8).ifBlank { "?" }} · ${targets.size} SKUs"
    }

    /** Each tag arrives at the shop as its own unit. */
    private fun receiving(api: Api, s: SweepState): String {
        // One delivery, one request, one movement group. Sending a POST per tag
        // turned an arrival into fifty transactions over shop wifi — slow
        // enough that operators stopped waiting for it, and wrong in the ledger
        // besides, because the goods came off one lorry.
        val lines = org.json.JSONArray()
        var foreign = 0
        s.seen.forEach { seen ->
            val sku = seen.sku
            if (sku == null) {
                foreign++
                return@forEach
            }
            lines.put(
                JSONObject()
                    .put("epc", seen.epc)
                    .put("sku_code", sku)
                    .put("unit_price_minor", 0),
            )
        }
        if (lines.length() == 0) {
            throw IllegalStateException("no tags of ours in this sweep")
        }
        val payload = JSONObject().apply {
            put("lines", lines)
            put("actor_id", "handheld")
            // Keyed by the sweep, so a retry after a lost response receives the
            // same delivery once rather than twice.
            put("idempotency_key", "hh-recv-" + currentSessionId().take(40))
        }
        api.post("/api/v1/store/receive-batch", payload)
        // A tag that is not ours is reported, never silently dropped: the
        // difference between "not our merchandise" and "the server said no"
        // is the difference between a shrug and an investigation.
        return "${lines.length()} received" +
            if (foreign > 0) ", $foreign not ours" else ""
    }

    /** Entries against an Official Count the centre already opened. */
    private fun counting(api: Api, s: SweepState): String {
        if (s.countId.isBlank()) throw IllegalStateException("choose a count first")
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
        return "${s.seen.size} count entries"
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
