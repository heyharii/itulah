package id.itulah.pindai.screens

import android.os.Trace
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import id.itulah.pindai.core.Epc
import id.itulah.pindai.core.Reader
import id.itulah.pindai.core.TagRead
import id.itulah.pindai.data.Api
import id.itulah.pindai.data.ConfigStore
import id.itulah.pindai.data.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.security.MessageDigest
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
    /**
     * How many DISTINCT tags this sweep holds — the number, not the tags.
     *
     * The tags themselves stay in the view model. Copying a five-thousand
     * element list into UI state five times a second is work no pixel needed:
     * the screen shows a total, a row per product and a foreign count, and all
     * three are already counted by the time this is read.
     */
    val tagCount: Int = 0,
    val message: String? = null,
    val failed: Boolean = false,
    val readerInfo: String? = null,
    /** dBm as the module last reported it, or 0 while nothing has asked it. */
    val readerPower: Int = 0,
    val powerNote: String? = null,
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
    /** Bearer token for node-served images; the proxy needs inventory read. */
    val imageAuth: String? = null,
    val sessionCode: String = "",
    val shared: SharedSession? = null,
    val sharedNote: String? = null,
    val sessions: List<SessionBrief> = emptyList(),
    val sessionsLoaded: Boolean = false,
)

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

    val state = MutableStateFlow(
        config.load().let { SweepState(sessionCode = it.sessionCode, readerPower = it.readerPower) },
    )
    private val collector = ConcurrentHashMap<String, Seen>()

    /**
     * The sweep as products, kept up to date as tags arrive rather than
     * recomputed from scratch on a timer.
     *
     * Measured on a C5: regrouping five thousand tags cost 90 ms per publish on
     * the main thread, every 200 ms — 68% of frames janked and the median frame
     * took 42 ms. Counting a garment is O(1) work; doing it again for every
     * garment already counted, five times a second, is what made a stock count
     * of a real shop unreadable.
     */
    private val qtyBySku = ConcurrentHashMap<String, Int>()

    /** First-seen rank per SKU, so rows never reshuffle under a moving finger. */
    private val skuRank = ConcurrentHashMap<String, Int>()
    private val ranks = java.util.concurrent.atomic.AtomicInteger(0)
    private val foreign = java.util.concurrent.atomic.AtomicInteger(0)

    /** Tags whose evidence is already on the Edge; never filed twice. */
    private val filed = java.util.Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())
    private var autoJob: kotlinx.coroutines.Job? = null
    private var resolveJob: Job? = null
    private var resolveRequested = false
    private var resolvingSkus: Set<String> = emptySet()
    private var sharedJob: Job? = null
    private var sharedGeneration = 0L
    private var dataGeneration = 0L
    private var sweepOpen = false
    private val operationMutex = Mutex()
    private val publishMutex = Mutex()
    private val filingMutex = Mutex()
    private var filingJob: Job? = null
    private var filingRequested = false
    private var filingRetryAt = 0L
    private var filingBackoffMs = FILING_RETRY_BASE_MS
    private var warmJob: Job? = null
    private val filingClaims = java.util.Collections.newSetFromMap(
        ConcurrentHashMap<String, Boolean>(),
    )
    private val dirty = java.util.concurrent.atomic.AtomicBoolean(false)
    private var sessionId = UUID.randomUUID().toString()

    /** The id every batch of this sweep is filed under — shared when joined. */
    private fun currentSessionId(): String =
        state.value.sessionCode.ifBlank { sessionId }

    private fun settings(): Settings = config.load()

    fun setMode(mode: Mode) {
        if (state.value.busy || (sweepOpen && collector.isNotEmpty())) {
            update { it.copy(message = "finish the current sweep before changing jobs") }
            return
        }
        update { it.copy(mode = mode, message = null, failed = false) }
    }
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
        val wanted = qtyBySku.keys.toSet() - state.value.identities.keys
        if (wanted.isEmpty()) return
        // A slow Edge must not turn the two-second refresh cadence into a stack
        // of identical catalogue queries. The job is deliberately kept separate
        // from auto-filing so a names request can never pause the reader loop.
        if (resolveJob?.isActive == true) {
            // A new tag can arrive while the current request is in flight. Keep
            // one follow-up request queued so stopping immediately after that
            // arrival does not leave its identity permanently unresolved.
            if (wanted.any { it !in resolvingSkus }) resolveRequested = true
            return
        }
        // Ask in batches. Every distinct SKU used to ride in one query string,
        // which is fine for a rack and a URL nobody measured: 255 products
        // already makes it 3 KB, and a DC counting a thousand styles would hand
        // the node a 12 KB GET line and get a 414 back — losing every name at
        // once, at exactly the scale where names matter most.
        val batches = wanted.chunked(200)
        val generation = dataGeneration
        resolvingSkus = wanted
        resolveRequested = false
        resolveJob = viewModelScope.launch {
            try {
                update { it.copy(resolving = true, resolveNote = null) }
                val started = System.currentTimeMillis()
                val result = withContext(Dispatchers.IO) {
                    runCatching {
                        val api = Api(settings)
                        val items = org.json.JSONArray()
                        batches.forEach { batch ->
                            val json = api.get(
                                "/api/v1/catalog/identities?skus=" + batch.joinToString(","),
                            )
                            val page = json.optJSONArray("items") ?: org.json.JSONArray()
                            for (k in 0 until page.length()) items.put(page.getJSONObject(k))
                        }
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
                val token = settings.operatorToken.ifBlank { null }
                if (generation == dataGeneration) {
                    result.onSuccess { found ->
                        update {
                            val merged = it.identities + found
                            it.copy(
                                identities = merged,
                                lines = it.lines.map { row -> row.copy(identity = merged[row.sku]) },
                                imageAuth = token,
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
            } finally {
                val again = resolveRequested
                resolveRequested = false
                resolvingSkus = emptySet()
                resolveJob = null
                if (generation == dataGeneration && again) resolveIdentities()
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
        if (state.value.busy || (sweepOpen && collector.isNotEmpty())) {
            update { it.copy(sharedNote = "finish the current sweep before changing session") }
            return
        }
        val cleaned = code.trim().uppercase().filter { it.isLetterOrDigit() || it == '-' }.take(24)
        // A response for the previous name must never paint the newly selected
        // session. The in-flight request is allowed to finish, but its generation
        // check below drops the stale result and starts the current one after it.
        sharedGeneration++
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
        // Refreshes happen every two seconds during a shared sweep. Keep at most
        // one database/JSON request in flight; if the code changes while it is
        // running, the generation check and completion handoff below fetch the
        // new code once the old request has drained.
        if (sharedJob?.isActive == true) return
        val generation = sharedGeneration
        sharedJob = viewModelScope.launch {
            try {
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
                if (generation == sharedGeneration && state.value.sessionCode == code) {
                    result.onSuccess { session ->
                        update { it.copy(shared = session, sharedNote = null) }
                    }.onFailure { e ->
                        update { it.copy(sharedNote = e.message ?: "session unreadable") }
                    }
                }
            } finally {
                // `setSessionCode` can happen while HttpURLConnection is draining
                // on IO. Once this request is done, hand off exactly one refresh
                // for the current code without ever overlapping requests.
                sharedJob = null
                if (generation != sharedGeneration && state.value.sessionCode.isNotBlank()) {
                    refreshShared()
                }
            }
        }
    }

    /**
     * Turn the antenna up or down, mid-sweep if that is when it is needed.
     *
     * A sweep quietly reading the next aisle has to be corrected NOW, not after
     * somebody finishes and starts again. But moving the power costs the whole
     * module: on this firmware a setPower to an open module goes silently
     * unradiated, so [Reader.setPower] closes and re-opens it — and that
     * measured **seven seconds** on a C5, not the fraction of a second this
     * comment used to claim.
     *
     * Seven seconds of dead antenna is a rack walked past. So the screen says
     * `busy` and stops offering Finish for the duration: this app's whole
     * position is that a screen reading "reading" over a quiet radio is how
     * somebody sweeps an aisle and collects nothing, and a gap we caused
     * ourselves is no different. Nothing is lost — the collector is not the
     * radio — but the person holding it has to know to stand still.
     */
    fun setPower(dbm: Int) {
        if (state.value.busy) return
        val target = dbm.coerceIn(Reader.MIN_POWER, Reader.MAX_POWER)
        // Releasing the finger where the antenna already is must cost nothing.
        // Committing anyway would stop and restart inventory for no change —
        // a hiccup in the middle of an aisle, paid for a tap that meant "yes,
        // that one".
        if (target == state.value.readerPower) return
        viewModelScope.launch {
            operationMutex.withLock {
                if (state.value.busy) return@withLock
                val sweeping = state.value.sweeping
                // Said before the antenna goes down, not after it comes back.
                update {
                    it.copy(busy = true,
                        powerNote = if (sweeping) "moving the antenna · about 7 seconds"
                            else "moving the antenna…")
                }
                // Do not let a power change compete with Finish, lifecycle stop,
                // or another slider release. The vendor UART is single-owner.
                stopAutoFiling()
                val outcome = withContext(Dispatchers.IO) {
                    runCatching {
                        if (sweeping) reader.stop()
                        val applied = reader.setPower(target)
                        val resumed = !sweeping ||
                            reader.start(withTid = false) { read -> absorb(read) }
                        applied to resumed
                    }
                }
                outcome.onSuccess { (applied, resumed) ->
                    val settled = if (applied > 0) applied else target
                    config.saveReaderPower(settled)
                    update {
                        it.copy(
                            readerPower = settled,
                            powerNote = when {
                                !resumed -> "power set · the reader did not resume"
                                applied > 0 -> "module reports $applied dBm"
                                else -> "kept · applies when the reader wakes"
                            },
                            // A sweep whose inventory never came back is over, and
                            // must say so. Leaving the flag up is how somebody
                            // walks an aisle collecting nothing.
                            sweeping = it.sweeping && resumed,
                            failed = it.failed || !resumed,
                            message = if (resumed) it.message
                                else "the reader stopped — start reading again",
                        )
                    }
                    // A sweep that ended by accident still files what it found.
                    // Auto-filing stops with the flag, so without this the last
                    // tick's tags sit in memory until somebody sweeps again — and
                    // the whole point of filing as we go is that nothing waits on
                    // somebody remembering.
                    if (!resumed) fileNewTags()
                    update { it.copy(busy = false) }
                    if (resumed && sweeping) startAutoFiling()
                }.onFailure { e ->
                    update { it.copy(busy = false, powerNote = e.message ?: "the reader refused") }
                }
            }
        }
    }

    fun toggleSweep() {
        if (state.value.busy) return
        if (state.value.sweeping) stopSweep() else startSweep()
    }

    /** Start a new logical sweep without carrying a completed rack forward. */
    private fun beginSweep() {
        clearCollectedData()
        filingRetryAt = 0L
        filingBackoffMs = FILING_RETRY_BASE_MS
        sessionId = UUID.randomUUID().toString()
        sweepOpen = true
        update {
            it.copy(
                tagCount = 0,
                lines = emptyList(),
                foreignCount = 0,
                identities = emptyMap(),
                resolving = false,
                resolveNote = null,
                filedCount = 0,
                filingNote = null,
                message = null,
                failed = false,
            )
        }
    }

    /** Drop only data that belongs to the finished logical sweep. */
    private fun clearCollectedData() {
        dataGeneration++
        resolveJob?.cancel()
        resolveJob = null
        resolveRequested = false
        resolvingSkus = emptySet()
        collector.clear()
        qtyBySku.clear()
        skuRank.clear()
        ranks.set(0)
        foreign.set(0)
        filed.clear()
        filingClaims.clear()
        filingRequested = false
        dirty.set(false)
    }

    private fun hasPendingEvidence(): Boolean =
        collector.values.any { it.epc !in filed }

    /** Stable across a lost response, but unique for the exact session and batch. */
    private fun observationIdempotencyKey(session: String, batch: List<Seen>): String {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(session.toByteArray(Charsets.UTF_8))
        digest.update('\n'.code.toByte())
        batch.asSequence().map { it.epc }.sorted().forEach { epc ->
            digest.update(epc.toByteArray(Charsets.UTF_8))
            digest.update('\n'.code.toByte())
        }
        val hex = digest.digest().joinToString("") { "%02x".format(it) }
        return "hh-rfid-" + hex.take(56)
    }

    private fun startSweep() {
        viewModelScope.launch {
            operationMutex.withLock {
                if (state.value.busy || state.value.sweeping) return@withLock
                if (!sweepOpen) beginSweep()
                update { it.copy(busy = true, message = "Waking the reader…", failed = false) }
                val result = withContext(Dispatchers.IO) {
                    runCatching {
                        // Choose the power BEFORE the module opens, so init applies
                        // it once. Measured on a C5 (E710_V7.10.1): a setPower
                        // issued to an ALREADY-OPEN module reports success and the
                        // getter echoes the new figure, but the antenna goes silent
                        // — 40 reads at 30 dBm became zero at 29, which is not a
                        // thing one decibel can do.
                        settings().readerPower.takeIf { it > 0 }?.let { reader.setPower(it) }
                        val version = reader.init(appContext!!)
                        val started = reader.start(withTid = false) { read -> absorb(read) }
                        if (!started) error("the reader refused to start inventory")
                        version
                    }
                }
                result.onSuccess { version ->
                    update {
                        it.copy(sweeping = true, busy = false,
                            readerInfo = "fw " + version.ifBlank { "?" },
                            readerPower = reader.power().coerceAtLeast(0),
                            message = "Reading…")
                    }
                    startAutoFiling()
                }.onFailure { e ->
                    update { it.copy(busy = false, failed = true, message = e.message ?: "reader unavailable") }
                }
            }
        }
    }

    private fun stopSweep() {
        viewModelScope.launch {
            operationMutex.withLock {
                if (!state.value.sweeping) {
                    withContext(Dispatchers.IO) { runCatching { reader.stop() } }
                    return@withLock
                }
                // Stop the timer first so no more publishes or filing requests are
                // scheduled while the reader is winding down. The collector and its
                // unsent evidence remain untouched.
                update { it.copy(busy = true) }
                stopAutoFiling()
                withContext(Dispatchers.IO) { reader.stop() }
                dirty.set(true)
                publish()
                update { it.copy(sweeping = false, message = "${collector.size} tags read") }
                // Anything the last tick missed goes now, so stopping is a complete
                // act rather than a promise.
                fileNewTags()
                resolveIdentities()
                update { it.copy(busy = false) }
            }
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
        // Warm-up is useful, but a slow or offline node must never hold the
        // 200 ms publish loop hostage. It is deliberately independent work.
        warmJob?.cancel()
        val settings = settings()
        warmJob = if (settings.isConfigured) {
            viewModelScope.launch(Dispatchers.IO) { runCatching { Api(settings).warm() } }
        } else null

        autoJob = viewModelScope.launch {
            var tick = 0
            while (state.value.sweeping) {
                kotlinx.coroutines.delay(200)
                if (!state.value.sweeping) break
                // UI snapshots keep their 200 ms cadence even when an upload or
                // catalogue request is stuck on a slow network.
                publish()
                // Evidence and names travel every ten ticks — two seconds — so
                // the radio is quiet between them.
                if (++tick % 10 == 0) {
                    scheduleFiling()
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

    /** Stop the scheduler but let an in-flight upload drain under its own lock. */
    private suspend fun stopAutoFiling() {
        val job = autoJob
        autoJob = null
        job?.cancelAndJoin()
        warmJob?.cancel()
        warmJob = null
    }

    /** Queue at most one upload and back off when the node is unavailable. */
    private fun scheduleFiling() {
        val settings = settings()
        if (!settings.isConfigured || !hasPendingEvidence()) return
        if (System.currentTimeMillis() < filingRetryAt) return
        if (filingJob?.isActive == true) {
            filingRequested = true
            return
        }
        filingRequested = false
        filingJob = viewModelScope.launch {
            try {
                fileNewTags()
            } finally {
                filingJob = null
                val again = filingRequested
                filingRequested = false
                if (again && state.value.sweeping) scheduleFiling()
            }
        }
    }

    /**
     * File only the evidence not already acknowledged by the Edge.
     *
     * The mutex is intentionally held across the network call. Finish, the
     * lifecycle stop, and the two-second scheduler must see one ordered stream:
     * otherwise Finish can decide that a claimed-but-not-yet-acknowledged tag
     * is already filed. Batches stay within the Edge's 2,000-EPC limit and each
     * one gets a stable key, so a lost response can be retried without a
     * duplicate observation.
     */
    private suspend fun fileNewTags(): Boolean {
        val settings = settings()
        if (!settings.isConfigured) return false
        return filingMutex.withLock {
            var sent = 0
            var failure: Throwable? = null
            while (true) {
                // Batch selection and hashing scale with the collected EPCs.
                // Keep both off the main thread: the reader can have thousands
                // of entries even when the visible list has only a few rows.
                val selection = withContext(Dispatchers.Default) {
                    val fresh = collector.values
                        .asSequence()
                        .filter { it.epc !in filed && it.epc !in filingClaims }
                        .sortedBy { it.epc }
                        .take(MAX_OBSERVATIONS_PER_BATCH)
                        .filter { filingClaims.add(it.epc) }
                        .toList()
                    if (fresh.isEmpty()) null else {
                        val session = currentSessionId()
                        Triple(fresh, session, observationIdempotencyKey(session, fresh))
                    }
                }
                if (selection == null) break
                val (fresh, session, key) = selection
                try {
                    withContext(Dispatchers.IO) {
                        Api(settings).postObservations(
                            fresh.map { it.epc to it.rssi }, session, key,
                        )
                    }
                    fresh.forEach {
                        filingClaims.remove(it.epc)
                        filed.add(it.epc)
                    }
                    sent += fresh.size
                } catch (cancelled: CancellationException) {
                    fresh.forEach { filingClaims.remove(it.epc) }
                    throw cancelled
                } catch (error: Throwable) {
                    fresh.forEach { filingClaims.remove(it.epc) }
                    failure = error
                    update {
                        it.copy(
                            filedCount = filed.size,
                            filingNote = "not filed yet (${error.message ?: "network unavailable"})",
                        )
                    }
                    break
                }
            }

            if (failure != null) {
                filingRetryAt = System.currentTimeMillis() + filingBackoffMs
                filingBackoffMs = (filingBackoffMs * 2).coerceAtMost(FILING_RETRY_MAX_MS)
                false
            } else {
                filingRetryAt = 0L
                filingBackoffMs = FILING_RETRY_BASE_MS
                if (sent > 0) {
                    update {
                        it.copy(filedCount = filed.size,
                            filingNote = "${filed.size} filed")
                    }
                }
                true
            }
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
        if (existing != null) {
            // A tag already counted, seen again. Keep the strongest sighting,
            // but do NOT mark the screen dirty: nothing on it shows RSSI, so a
            // redraw here is a frame spent to change no pixel — and during a
            // sweep this is the overwhelming majority of reads.
            if ((read.rssi ?: -999f) > (existing.rssi ?: -999f)) {
                collector[read.epc] = existing.copy(rssi = read.rssi)
            }
            return
        }
        val parts = Epc.decode(read.epc)
        val fresh = Seen(read.epc, read.rssi, parts?.skuCode, parts?.serial)
        if (collector.putIfAbsent(read.epc, fresh) != null) return
        val sku = parts?.skuCode
        if (sku == null) {
            foreign.incrementAndGet()
        } else {
            qtyBySku.merge(sku, 1) { a, b -> a + b }
            skuRank.putIfAbsent(sku, ranks.getAndIncrement())
        }
        dirty.set(true)
    }

    /** Push what the reader has found, at a pace an eye can follow. */
    private suspend fun publish() {
        // `stopSweep` and the auto-filing timer can reach this at the same time:
        // serialize their dirty check and UI snapshot so an older snapshot cannot
        // overwrite the one taken after the reader stopped.
        publishMutex.withLock {
            if (!dirty.getAndSet(false)) return@withLock
            try {
                val identities = state.value.identities
                // Rows in the order the shop floor met them. Sorting by quantity made
                // two hundred rows change places under the finger every time a number
                // moved, which is both work and a list nobody can read while counting.
                val lines = withContext(Dispatchers.Default) {
                    Trace.beginSection("pindai.publish.snapshot")
                    try {
                        qtyBySku.entries
                            .map { (sku, qty) -> Grouped(sku, qty, identities[sku]) }
                            .sortedBy { skuRank[it.sku] ?: Int.MAX_VALUE }
                    } finally {
                        Trace.endSection()
                    }
                }
                val tags = collector.size
                update { it.copy(tagCount = tags, lines = lines, foreignCount = foreign.get()) }
            } catch (error: Throwable) {
                // The flag is cleared before the Default-dispatch snapshot so a
                // successful publish cannot race a new read. If that snapshot is
                // cancelled (for example while the ViewModel is being stopped),
                // retain the work for the next publish instead of silently losing
                // the final tags from the screen.
                dirty.set(true)
                throw error
            }
        }
    }

    /** File the evidence, then do whatever this mode means on top of it. */
    fun commit() {
        viewModelScope.launch {
            operationMutex.withLock {
                val settings = settings()
                if (!settings.isConfigured) {
                    update { it.copy(failed = true, message = "Settings are incomplete") }
                    return@withLock
                }
                // A read can arrive between the last 200 ms tick and this tap.
                // Take the final UI snapshot before deciding whether there is
                // anything to commit.
                dirty.set(true)
                publish()
                val current = state.value
                if (collector.isEmpty()) {
                    update { it.copy(failed = true, message = "Nothing swept yet") }
                    return@withLock
                }

                update { it.copy(busy = true, message = "Sending…", failed = false) }
                stopAutoFiling()
                if (current.sweeping) withContext(Dispatchers.IO) { reader.stop() }
                // Evidence is already on the Edge — it went as the sweep ran.
                // All that is left is anything the last tick missed, and then
                // the act this mode actually means. Keeping the two apart
                // matters: an observation is a fact, a carton or a receipt is a
                // decision, and a decision that fails must never make the facts
                // look unfiled.
                update { it.copy(sweeping = false) }
                val flushed = fileNewTags()
                val outcome: Result<String?> = if (!flushed) {
                    Result.failure(IllegalStateException("some observations are not filed yet"))
                } else {
                    withContext(Dispatchers.IO) {
                        runCatching {
                            val api = Api(settings)
                            // One snapshot, taken here. The collector is the
                            // tags; UI state carries only their count.
                            val tags = collector.values.toList()
                            when (current.mode) {
                                Mode.SCAN -> null
                                Mode.PACKING -> packing(api, current, tags)
                                Mode.RECEIVING -> receiving(api, tags)
                                Mode.COUNT -> counting(api, current, tags)
                            }
                        }
                    }
                }

                val filedNow = filed.size
                when {
                    !flushed -> update {
                        it.copy(busy = false, sweeping = false, failed = true,
                            message = "some tags are not filed yet: " +
                                (it.filingNote ?: "network unavailable"))
                    }
                    outcome.isFailure -> update {
                        it.copy(busy = false, sweeping = false, failed = true,
                            message = "$filedNow observations FILED · " +
                                (outcome.exceptionOrNull()?.message ?: "next step failed"))
                    }
                    else -> {
                        val text = "$filedNow observations filed" +
                            (outcome.getOrNull()?.let { " · $it" } ?: "")
                        clearCollectedData()
                        sweepOpen = false
                        update { it.copy(busy = false, sweeping = false, failed = false,
                            tagCount = 0, lines = emptyList(), foreignCount = 0,
                            identities = emptyMap(), resolving = false, resolveNote = null,
                            filedCount = 0, filingNote = null,
                            message = text, lastReceipt = text) }
                        refreshShared()
                    }
                }
            }
        }
    }

    /** A carton for one shop, targeted by what the sweep actually found. */
    private fun packing(api: Api, s: SweepState, tags: List<Seen>): String {
        if (s.destination.isBlank()) throw IllegalStateException("name the destination shop first")
        val targets = tags.mapNotNull { it.sku }.groupingBy { it }.eachCount()
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
    private fun receiving(api: Api, tags: List<Seen>): String {
        // One delivery, one request, one movement group. Sending a POST per tag
        // turned an arrival into fifty transactions over shop wifi — slow
        // enough that operators stopped waiting for it, and wrong in the ledger
        // besides, because the goods came off one lorry.
        val lines = org.json.JSONArray()
        var foreign = 0
        tags.forEach { seen ->
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
    private fun counting(api: Api, s: SweepState, tags: List<Seen>): String {
        if (s.countId.isBlank()) throw IllegalStateException("choose a count first")
        val entries = org.json.JSONArray()
        tags.forEach { seen ->
            entries.put(JSONObject().put("epc", seen.epc).put("found_quantity", 1))
        }
        val payload = JSONObject().apply {
            put("entries", entries)
            put("actor_id", "handheld")
            put("idempotency_key", "hh-count-" + sessionId.take(12))
        }
        api.post("/api/v1/dc/official-counts/${s.countId}/entries", payload)
        return "${tags.size} count entries"
    }

    /**
     * Put the radio down when the operator walks off to Setelan.
     *
     * Everything found stays found — this is a pause, not an abandonment. What
     * must not survive is the CLAIM that the reader is still reading: the screen
     * said "reading" over a stopped antenna, the trigger did nothing, and the
     * only way back was Finish. Stopping properly also files whatever the last
     * tick missed, so the walk away is a complete act.
     */
    fun releaseReader() {
        if (state.value.sweeping) {
            stopSweep()
            return
        }
        // Off the main thread even when idle: stop() joins the poll thread and
        // talks to the UART, and neither belongs in a tab change.
        viewModelScope.launch {
            operationMutex.withLock {
                withContext(Dispatchers.IO) { runCatching { reader.stop() } }
            }
        }
    }

    private inline fun update(block: (SweepState) -> SweepState) {
        state.value = block(state.value)
    }

    companion object {
        /** Edge sync accepts at most this many consolidated EPCs per batch. */
        private const val MAX_OBSERVATIONS_PER_BATCH = 2_000
        private const val FILING_RETRY_BASE_MS = 5_000L
        private const val FILING_RETRY_MAX_MS = 60_000L

        /** Set once by the activity; the reader needs a Context to open the UART. */
        @Volatile var appContext: android.content.Context? = null
    }
}
