package id.itulah.pindai.screens

import android.os.Trace
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import id.itulah.pindai.core.Epc
import id.itulah.pindai.core.Reader
import id.itulah.pindai.core.ScanCounts
import id.itulah.pindai.core.ScanEngine
import id.itulah.pindai.core.Sounder
import id.itulah.pindai.core.Barcode
import id.itulah.pindai.core.Label
import id.itulah.pindai.core.Gen2State
import id.itulah.pindai.core.Lab
import id.itulah.pindai.core.ScanMetrics
import id.itulah.pindai.core.Tid
import id.itulah.pindai.BuildConfig
import id.itulah.pindai.data.Api
import id.itulah.pindai.data.ApiError
import id.itulah.pindai.data.CatalogMeta
import id.itulah.pindai.data.CatalogStore
import id.itulah.pindai.data.CatalogSync
import id.itulah.pindai.data.ConfigStore
import id.itulah.pindai.data.Inbound
import id.itulah.pindai.data.InboundDelivery
import id.itulah.pindai.data.InboundReceipt
import id.itulah.pindai.data.NodeRole
import id.itulah.pindai.data.ScanIdentity
import id.itulah.pindai.data.SweepRecord
import id.itulah.pindai.data.RadioProfile
import id.itulah.pindai.data.Settings
import id.itulah.pindai.data.SyncOutcome
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

enum class Mode(val title: String, val verb: String) {
    SCAN("Scan", "Finish"),
    PACKING("Packing", "Finish · open carton"),
    RECEIVING("Receive", "Finish · receive"),
    COUNT("Stock count", "Finish · submit"),
}

/** One product line of a finished sweep: what it is, how many, and which units. */
data class ResultLine(
    val skuCode: String,
    val qty: Int,
    val identity: ScanIdentity?,
    val epcs: List<String>,
)

/** What the local product master is, and whether it is moving. */
data class CatalogueStatus(
    val generation: Long = 0,
    val items: Long = 0,
    val syncing: Boolean = false,
    val note: String? = null,
) {
    val isReady: Boolean get() = items > 0
}

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
 * shelf see the same garment, and that is one unit.
 */
data class SharedSession(
    val code: String,
    val tagCount: Int,
    val sightingCount: Int,
    val helpers: List<Helper>,
    val epcs: List<String>,
    val truncated: Boolean,
)

/** Four things out of one database trip. */
private data class Quad<A, B, C, D>(val first: A, val second: B, val third: C, val fourth: D)

/**
 * A shop receiving against the deliveries the centre announced to it.
 *
 * Four screens in one piece of state, in the order an operator meets them: the
 * list of deliveries on their way ([chosen] and [unannounced] both empty), the
 * sweep for one of them, the submit, and the [receipt]. Nothing here ever holds
 * an expected quantity before [receipt] exists — see [Inbound].
 */
data class InboundState(
    val deliveries: List<InboundDelivery> = emptyList(),
    val loaded: Boolean = false,
    val loading: Boolean = false,
    /**
     * Bumped every time a refresh ends, however it ends.
     *
     * The pull-to-refresh spinner stops on this rather than on [loading],
     * because a refresh that is refused before it starts — settings
     * incomplete — never sets [loading] at all, and a spinner waiting for a
     * change that is never coming spins until somebody gives up on the app.
     */
    val refreshes: Int = 0,
    /** Why the list could not be read, in a sentence. */
    val note: String? = null,
    val chosen: InboundDelivery? = null,
    /** The lorry arrived before its announcement; received the old way. */
    val unannounced: Boolean = false,
    val receipt: InboundReceipt? = null,
)

data class SweepState(
    val mode: Mode = Mode.SCAN,
    val sweeping: Boolean = false,
    val busy: Boolean = false,
    /**
     * The four numbers, and nothing else, while the radio is live.
     *
     * Everything the scanning screen draws is in here and it is immutable: the
     * UI never walks a collection, never groups, never sorts. The tags
     * themselves stay in the engine, where one thread owns them.
     */
    val counts: ScanCounts = ScanCounts(),
    /**
     * The trigger has been pulled and the radio is not open yet.
     *
     * A separate flag from [sweeping] because the screen must change on the
     * PULL, not on the radio. Opening the UART takes a second or more on this
     * module, and a handheld that keeps showing the resting screen for that
     * second reads as a handheld that ignored the trigger — so the operator
     * pulls again, which stops the sweep that was just starting.
     */
    val starting: Boolean = false,
    /** Empty until the sweep stops. Product rows do not exist during a scan. */
    val lines: List<ResultLine> = emptyList(),
    val resultReady: Boolean = false,
    val building: Boolean = false,
    val message: String? = null,
    val failed: Boolean = false,
    val readerInfo: String? = null,
    val readerPower: Int = 0,
    val powerNote: String? = null,
    val destination: String = "",
    val countId: String = "",
    val lastReceipt: String? = null,
    val counts_: List<Pair<String, String>> = emptyList(),
    val countsLoaded: Boolean = false,
    val catalogue: CatalogueStatus = CatalogueStatus(),
    val outboxPending: Int = 0,
    val filedCount: Int = 0,
    val filingNote: String? = null,
    /** The device's own clock went backwards; filing cannot succeed until fixed. */
    val clockSuspect: Boolean = false,
    val sessionCode: String = "",
    val shared: SharedSession? = null,
    val sharedNote: String? = null,
    val sessions: List<SessionBrief> = emptyList(),
    val sessionsLoaded: Boolean = false,
    val metrics: ScanMetrics = ScanMetrics(),
    /** Finished sweeps, newest first. The screen an operator comes back to. */
    val history: List<SweepRecord> = emptyList(),
    /** Which recorded sweep is being looked at, if any. */
    val openSweep: Long? = null,
    /**
     * The trigger points the imager at a label instead of the antenna at a tag.
     *
     * One finger, two pieces of hardware, so it has to be one or the other.
     */
    val labelMode: Boolean = false,
    /**
     * What the imager says about the last pull, verbatim.
     *
     * Separate from [labelNote] because they answer different questions. The
     * note is for the operator — "that is not one of our labels". This is for
     * whoever is working out why a trigger pull did nothing at all, and the two
     * failures it separates look identical on a screen without it: a key that
     * never reached the app, and a scan that started and saw nothing. See
     * [Barcode.diagnostics].
     */
    val labelDiag: String = "",
    val labelNote: String? = null,
    /** What the module says about Impinj's Gen2X extensions right now. */
    val gen2: Gen2State = Gen2State(false, false),
    /** Whose silicon the last sweep found, when FastID told us. */
    val chip: Tid.Chip? = null,
    /** The SKU the radio has been told to report, if any. */
    val skuFilter: String = "",
    /** What the module answered when asked for that filter. */
    val filterNote: String? = null,
    /** The radio has been told to ignore every tag that is not ours. */
    val oursOnly: Boolean = false,
    /** The module's own Gen2 parameter block, verbatim. Diagnostic only. */
    val gen2Dump: String = "",
    /** Bench mode: every tag becomes a line, whatever its EPC says. */
    val countEveryTag: Boolean = false,
    /** How many tags have been married to a product on this bench. */
    val aliasCount: Int = 0,
    val aliasNote: String? = null,
    /** What the scan engine itself believes. Diagnostic. */
    val engineBeliefs: String = "",
    /**
     * A handful of EPCs the last sweep could not name, verbatim.
     *
     * Diagnostic, and it exists because a count alone cannot tell a reader that
     * is correctly ignoring foreign tags from one that is returning corrupted
     * bytes. Both look like "not ours". The strings themselves say which.
     */
    val foreignSample: List<String> = emptyList(),
    /** Every distinct EPC of the last sweep, summarised by shape. */
    val epcShapes: String = "",
    /** What the vendor SDK was asked and what it answered, newest last. */
    val sdkCalls: List<String> = emptyList(),
    /**
     * How long tags stayed quiet between reads of themselves.
     *
     * The only instrument that can answer whether Tag Focus is working, and it
     * used to be written to a log file and nowhere else — so anybody judging
     * from the screen saw a duplicate ratio, which this project has already
     * proved cannot answer the question.
     */
    val gaps: id.itulah.pindai.core.ReadGaps = id.itulah.pindai.core.ReadGaps(),
    /** DC or shop. Decides what Receive means; see [isStoreReceiving]. */
    val nodeRole: NodeRole = NodeRole.UNKNOWN,
    val inbound: InboundState = InboundState(),
) {
    /**
     * Receive, on a shop: against an announced delivery, blind.
     *
     * Only on a node that is a STORE. A DC receiving, or a handheld whose node
     * has not said what it is, keeps the Receive tab exactly as it was — the
     * delivery list is a shop's question, and asking a DC for it earns a 404
     * dressed up as an empty list.
     */
    val isStoreReceiving: Boolean
        get() = mode == Mode.RECEIVING && nodeRole == NodeRole.STORE

    /** A delivery has been picked (or declared unannounced) and is being swept. */
    val isReceivingDelivery: Boolean
        get() = isStoreReceiving && (inbound.chosen != null || inbound.unannounced)
}

/**
 * One sweep, four uses.
 *
 * Scanning, packing, receiving and counting differ in what they MEAN, not in
 * how a tag reaches the antenna — so they share one engine and diverge only at
 * the moment of commit. Every one of them files the same RFID observation
 * batch first: the observation is the evidence that these tags were in this
 * place at this time, and it stands whether or not the session that follows
 * succeeds.
 *
 * # What changed, and why
 *
 * The product list used to be maintained while the reader ran, and every
 * product's name came off the network mid-sweep. Neither happens now. A tag's
 * SKU is arithmetic out of its EPC, its article is the SKU's first eight
 * characters, and whether we can name it is a probe against a set held in RAM
 * — so a sweep is four integers until somebody stops it, and it behaves
 * identically with the wifi off.
 */
class SweepViewModel(
    private val reader: Reader,
    private val config: ConfigStore,
    private val catalog: CatalogStore,
) : ViewModel() {

    private val engine = ScanEngine()

    /** What the sweep sounds like. See [Sounder]. */
    private val sounder = Sounder().also { s ->
        engine.onHeard = { isNew -> s.heard(isNew) }
        // Two signals, two questions. `onHeard` is every read the radio did and
        // feeds the bench's density instrument; `onCounted` is a unit that
        // reached the total, and it is what the operator hears.
        engine.onCounted = { s.counted() }
    }

    /**
     * The bench's order book: a file this app reads from its own directory.
     *
     * See [Lab]. It exists because every experiment on this device was losing
     * to the settings screen rather than to the radio.
     */
    private val lab = Lab(appContext?.getExternalFilesDir(null)) { runLabCommand(it) }
    private var labJob: Job? = null
    private val imager = Barcode()
    private val sync = CatalogSync(catalog)

    val state = MutableStateFlow(
        config.load().let {
            SweepState(
                sessionCode = it.sessionCode, readerPower = it.readerPower,
                // The site's name is enough to draw the right Receive screen
                // on the first frame; the node confirms it in [resolveNodeRole].
                nodeRole = NodeRole.fromSiteId(it.siteId),
            )
        },
    )

    private var tickJob: Job? = null
    private var uploadJob: Job? = null
    private var uploadRequested = false
    private var uploadRetryAt = 0L
    private var uploadBackoffMs = UPLOAD_RETRY_BASE_MS
    private var sharedJob: Job? = null
    private var sharedGeneration = 0L
    private var syncJob: Job? = null
    private var catalogPoll: Job? = null
    private var inboundJob: Job? = null
    private var roleJob: Job? = null
    /** Which node the role in state was asked of. A different node is a new question. */
    private var roleAskedOf: String? = null
    /** The node that has itself confirmed the role, as opposed to its Site ID suggesting it. */
    private var roleConfirmedBy: String? = null
    private var sweepOpen = false
    private var pendingCatalogue: Set<String>? = null
    private val operationMutex = Mutex()
    private val spoolMutex = Mutex()
    private var sessionId = UUID.randomUUID().toString()

    private fun currentSessionId(): String = state.value.sessionCode.ifBlank { sessionId }

    private fun settings(): Settings = config.load()

    // ------------------------------------------------------------- catalogue

    /**
     * Open the local catalogue and make scanning available, in that order.
     *
     * The network is not on this path. A device that has any local copy can
     * sweep before it has said a word to the node; the generation check that
     * follows is independent work, and its result changes a line of text.
     */
    fun openCatalogue() {
        viewModelScope.launch {
            val loaded = withContext(Dispatchers.IO) {
                runCatching {
                    val codes = catalog.knownSkuCodes()
                    engine.useCatalogue(codes)
                    // Bench marriages stay on the bench.
                    //
                    // These are rows that say "treat this foreign EPC as that
                    // product" — written during testing so a desk of anonymous
                    // tags could stand in for stock. Loaded on a shop floor they
                    // turn somebody else's pallet label into a garment on a
                    // count sheet, silently and permanently.
                    if (BuildConfig.BENCH) engine.useAliases(catalog.epcAliases())
                    catalog.prune(Api.iso8601Days(-OUTBOX_KEEP_DAYS))
                    val meta = sync.localMeta(settings())
                    Quad(codes.size.toLong(), meta, catalog.pendingCount(), catalog.aliasCount())
                }
            }
            loaded.onSuccess { (items, meta, pending, aliases) ->
                update {
                    it.copy(
                        catalogue = CatalogueStatus(
                            generation = meta?.generation ?: 0,
                            items = items,
                            note = if (items == 0L) "no catalogue yet" else null,
                        ),
                        outboxPending = pending,
                        aliasCount = aliases,
                    )
                }
            }
            warmReader()
            startLab()
            loadHistory()
            refreshCatalogue()
            drainOutbox()
            pollCatalogue()
        }
    }

    /**
     * Ask again every five seconds, for as long as the app is open.
     *
     * The centre publishes a new generation within a minute of head office
     * issuing a setup, and a handheld that only asked at start-up kept the list
     * from before until somebody restarted it — which is exactly what an operator
     * holding a tag the device calls UNKNOWN does not think to do. The ask is one
     * small GET that pulls nothing when the generation has not moved, and
     * [refreshCatalogue] already holds a new list until a sweep ends.
     */
    private fun pollCatalogue() {
        if (catalogPoll?.isActive == true) return
        catalogPoll = viewModelScope.launch {
            while (isActive) {
                delay(CATALOG_POLL_MILLIS)
                refreshCatalogue()
            }
        }
    }

    /**
     * Open the UART before anybody asks for it.
     *
     * Measured on a C5: the vendor's `init()` costs about a second, and it is
     * paid once per open module — a second pull of the trigger reaches a live
     * antenna in twenty milliseconds. Doing that second while the operator is
     * still walking to the rack means the FIRST pull is fast too, which is the
     * one that decides whether this feels like a scanner or like an app.
     *
     * Deliberately opens and does not read. Radiating because an app started is
     * how a handheld on a charging shelf quietly inventories the office.
     */
    private fun warmReader() {
        viewModelScope.launch {
            operationMutex.withLock {
                if (state.value.sweeping || state.value.starting || reader.isReady) return@withLock
                withContext(Dispatchers.IO) {
                    runCatching {
                        val saved = settings()
                        // Load the clip while the operator is still walking to
                        // the rack, not on the first read.
                        appContext?.let { sounder.prepare(it) }
                        saved.readerPower.takeIf { it > 0 }?.let { reader.setPower(it) }
                        val version = reader.init(appContext!!)
                        // Pin the link mode before anything is measured or
                        // counted. The module keeps this setting across a
                        // restart, so not setting it is not a default — it is
                        // inheriting whatever the last session left behind.
                        //
                        // Applied unconditionally, including on a handheld
                        // nobody has ever configured. A missing preference is
                        // not "leave it alone" here — it is "inherit a stranger's
                        // radio", and the defaults ARE the measured profile.
                        if (saved.rfLink >= 0) reader.setRfLink(saved.rfLink)
                        reader.setTarget(RadioProfile.TARGET)
                        reader.setGen2Extensions(
                            saved.tagFocus,
                            RadioProfile.FAST_ID,
                            saved.gen2Session.takeIf { it >= 0 },
                        )
                        version
                    }
                }.onSuccess { version ->
                    val gen2 = withContext(Dispatchers.IO) { reader.gen2State() }
                    val dump = withContext(Dispatchers.IO) { reader.gen2Dump() }
                    update {
                        it.copy(
                            readerInfo = "fw " + version.ifBlank { "?" } + " · ready",
                            gen2 = gen2, gen2Dump = dump,
                        )
                    }
                }
                // A failure here is not reported. Nobody asked for the reader
                // yet, and an error about a radio the operator has not touched
                // is noise; the pull that does ask will say so properly.
            }
        }
    }

    /**
     * Ask the node which generation it holds, and pull only if it differs.
     *
     * A refresh that lands mid-sweep is held until the sweep ends. A count
     * whose UNKNOWN number moved halfway because a catalogue arrived is a count
     * nobody can explain afterwards, and the operator did nothing to cause it.
     */
    fun refreshCatalogue() {
        if (syncJob?.isActive == true) return
        val settings = settings()
        if (!settings.isConfigured) return
        syncJob = viewModelScope.launch {
            update { it.copy(catalogue = it.catalogue.copy(syncing = true)) }
            val outcome = withContext(Dispatchers.IO) { sync.refresh(settings) }
            when (outcome) {
                is SyncOutcome.UpToDate -> update {
                    it.copy(catalogue = it.catalogue.copy(
                        generation = outcome.generation, items = outcome.items,
                        syncing = false, note = null,
                    ))
                }
                is SyncOutcome.Updated -> {
                    val codes = withContext(Dispatchers.IO) { catalog.knownSkuCodes() }
                    if (state.value.sweeping) {
                        // Held, not applied. It goes in when the radio stops.
                        pendingCatalogue = codes
                        update {
                            it.copy(catalogue = it.catalogue.copy(
                                syncing = false,
                                note = "gen ${outcome.generation} ready · applies after this sweep",
                            ))
                        }
                    } else {
                        engine.useCatalogue(codes)
                        update {
                            it.copy(catalogue = CatalogueStatus(
                                generation = outcome.generation,
                                items = outcome.items.toLong(),
                                note = "gen ${outcome.generation} · ${outcome.items} SKUs · ${outcome.millis} ms",
                            ))
                        }
                    }
                }
                SyncOutcome.NodeHasNone -> update {
                    it.copy(catalogue = it.catalogue.copy(
                        syncing = false, note = "the node has no catalogue yet",
                    ))
                }
                SyncOutcome.Torn -> update {
                    it.copy(catalogue = it.catalogue.copy(
                        syncing = false, note = "catalogue moved while reading · will retry",
                    ))
                }
                is SyncOutcome.Failed -> update {
                    it.copy(catalogue = it.catalogue.copy(
                        syncing = false,
                        // Stale and usable beats fresh and absent. Say which.
                        note = if (it.catalogue.isReady) "offline · using gen ${it.catalogue.generation}"
                            else "no catalogue: ${outcome.reason}",
                    ))
                }
            }
            syncJob = null
        }
    }

    // ------------------------------------------------------------------ modes

    /**
     * Change jobs, or say why not. Returns whether the job actually changed, so
     * the tab bar can go back to the job that is still open instead of lighting
     * one the screen is not showing.
     */
    fun setMode(mode: Mode): Boolean {
        // The same job is not a change. Coming back from Setelan to a delivery
        // half swept used to be refused here as "changing jobs" — harmless while
        // every sweep closed itself on release, wrong now that a delivery's
        // sweep stays open across pulls until it is received.
        if (mode == state.value.mode) {
            if (mode == Mode.RECEIVING) enterReceiving()
            return true
        }
        val c = state.value.counts
        if (state.value.busy || (sweepOpen && (c.units > 0 || c.unknownUnits > 0))) {
            update {
                it.copy(
                    message = if (it.isReceivingDelivery)
                        "Receive this delivery or discard the sweep before changing jobs"
                    else "finish the current sweep before changing jobs",
                )
            }
            return false
        }
        // An open sweep with nothing in it belongs to nobody; do not carry it —
        // or its session id — into the next job.
        if (!state.value.sweeping) sweepOpen = false
        update { it.copy(mode = mode, message = null, failed = false) }
        if (mode == Mode.RECEIVING) enterReceiving()
        return true
    }

    // ------------------------------------------------------ store receiving

    /**
     * The Receive tab opened. On a shop that means: which lorries are coming.
     *
     * The node's role is asked every time the tab opens rather than once at
     * launch, because Setelan can repoint the handheld between those two
     * moments — and the answer is cached per node, so asking again costs
     * nothing when nothing moved.
     */
    private fun enterReceiving() {
        resolveNodeRole()
        if (state.value.nodeRole == NodeRole.STORE &&
            state.value.inbound.chosen == null && state.value.inbound.receipt == null
        ) loadInbound()
    }

    /**
     * Ask the node whether it is a DC or a shop.
     *
     * `/api/v1/health` answers without a login and carries `node_role`. The
     * Site ID guess stands until it answers, and stands for good if it never
     * does — an offline shop whose site is called `store-07` is still a shop.
     */
    fun resolveNodeRole() {
        val settings = settings()
        val node = settings.baseUrl + "|" + settings.siteId
        if (node != roleAskedOf) {
            roleAskedOf = node
            roleConfirmedBy = null
            update { it.copy(nodeRole = NodeRole.fromSiteId(settings.siteId)) }
        }
        if (roleConfirmedBy == node || settings.baseUrl.isBlank() || roleJob?.isActive == true) return
        roleJob = viewModelScope.launch {
            val said = withContext(Dispatchers.IO) {
                runCatching {
                    NodeRole.fromHealth(
                        Api(settings, connectTimeoutMs = COMMIT_CONNECT_MS).health()
                            .optString("node_role"),
                    )
                }.getOrNull()
            }
            if (said == null || said == NodeRole.UNKNOWN || roleAskedOf != node) return@launch
            roleConfirmedBy = node
            val was = state.value.nodeRole
            update { it.copy(nodeRole = said) }
            if (said == NodeRole.STORE && was != NodeRole.STORE &&
                state.value.mode == Mode.RECEIVING && !state.value.inbound.loaded
            ) loadInbound()
        }
    }

    /** The deliveries on their way to this shop, read fresh. */
    fun loadInbound() {
        val settings = settings()
        if (!settings.isConfigured) {
            update {
                it.copy(inbound = it.inbound.copy(
                    loaded = true, loading = false, refreshes = it.inbound.refreshes + 1,
                    note = "Settings are incomplete — this handheld does not know which shop it is in.",
                ))
            }
            return
        }
        if (inboundJob?.isActive == true) return
        update { it.copy(inbound = it.inbound.copy(loading = true)) }
        inboundJob = viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    Inbound.parseDeliveries(
                        Api(settings, connectTimeoutMs = COMMIT_CONNECT_MS).inboundDeliveries(),
                    )
                }
            }
            update {
                val inbound = it.inbound.copy(
                    loaded = true, loading = false, refreshes = it.inbound.refreshes + 1,
                )
                it.copy(
                    inbound = result.fold(
                        // Only what is actually on its way. The node is asked
                        // for IN_TRANSIT already; this is the belt to that
                        // brace, because a RECEIVED row here would carry its
                        // result — expected numbers — onto a blind screen.
                        onSuccess = { list ->
                            inbound.copy(deliveries = list.filter { d -> !d.isReceived }, note = null)
                        },
                        // Keep what was on screen. A list that empties itself
                        // because the wifi blinked reads as "nothing is coming".
                        onFailure = { e -> inbound.copy(note = plainReason(e, listing = true)) },
                    ),
                )
            }
        }
    }

    fun chooseDelivery(delivery: InboundDelivery) = update {
        it.copy(
            inbound = it.inbound.copy(chosen = delivery, unannounced = false, receipt = null),
            message = null, failed = false,
        )
    }

    /** A lorry the centre has not announced yet. Received the old way, unlinked. */
    fun receiveUnannounced() = update {
        it.copy(
            inbound = it.inbound.copy(chosen = null, unannounced = true, receipt = null),
            message = null, failed = false,
        )
    }

    /**
     * Back to the list, KEEPING whatever has been swept.
     *
     * The usual reason to come back is that the wrong surat jalan was picked,
     * and the tags in the engine are still exactly the tags on the floor.
     * Throwing them away would send somebody round the koli again for nothing;
     * [discardSweep] is the deliberate way to lose them.
     */
    fun backToDeliveries() {
        if (state.value.sweeping || state.value.busy) return
        update {
            it.copy(
                inbound = it.inbound.copy(chosen = null, unannounced = false),
                message = null, failed = false,
            )
        }
        loadInbound()
    }

    /**
     * Throw away the sweep being held for a delivery.
     *
     * The evidence is spooled FIRST. What the radio saw it saw, and the
     * observation batch stands whether or not a receipt ever follows — that is
     * the premise this app files on. Only the intent to receive is discarded.
     */
    fun discardSweep() {
        viewModelScope.launch {
            operationMutex.withLock {
                if (state.value.sweeping || state.value.busy) return@withLock
                spoolEvidence()
                drainOutbox()
                engine.reset()
                sweepOpen = false
                update {
                    it.copy(
                        counts = ScanCounts(), lines = emptyList(), resultReady = false,
                        failed = false, message = "Sweep discarded · its evidence stays filed",
                    )
                }
            }
        }
    }

    /** Leave the result and go back to the deliveries still on their way. */
    fun closeReceipt() {
        update {
            it.copy(
                inbound = it.inbound.copy(receipt = null, chosen = null, unannounced = false),
                message = null, failed = false,
            )
        }
        loadInbound()
    }

    /**
     * Finish · receive, for an announced delivery.
     *
     * # Evidence first, then the receipt
     *
     * The observation batch is spooled before the receive is attempted, as in
     * every other mode: the tags were in this shop whether or not the node
     * accepts the receipt, and a refused receipt must never make the sweep look
     * unfiled.
     *
     * # One request, and it is safe to repeat
     *
     * Every tag of ours goes in one body, keyed by [Inbound.receiveKey] — the
     * delivery plus the sorted EPCs. If the response is lost, pressing Finish
     * again sends the same key over the same body and the node hands back the
     * answer it already gave. That is why the sweep is kept on every failure:
     * the retry is the same request only if it carries the same tags.
     *
     * # "Ours" is wider than the tally
     *
     * The tally on screen counts products this handheld can NAME. What is sent
     * is every tag whose EPC is ours, named or not: the node knows what it
     * shipped, and a tag left out because this handheld's catalogue is a
     * generation behind would be reported missing — permanently, because a
     * delivery is received once. Foreign tags (somebody else's EPC, a pallet
     * label) are left out, exactly as every other mode leaves them out.
     */
    fun receiveDelivery() {
        viewModelScope.launch {
            operationMutex.withLock {
                val delivery = state.value.inbound.chosen ?: return@withLock
                val settings = settings()
                if (!settings.isConfigured) {
                    update { it.copy(failed = true, message = "Settings are incomplete") }
                    return@withLock
                }
                if (state.value.sweeping) {
                    // A read can arrive between the last tick and this tap.
                    stopTicker()
                    withContext(Dispatchers.IO) { reader.stop() }
                    withContext(Dispatchers.Default) { engine.stop() }
                    update { it.copy(sweeping = false, counts = engine.snapshot()) }
                    buildResult()
                }
                val epcs = engine.allEpcs().filter { Epc.isOurs(it) }.sorted()
                if (epcs.isEmpty()) {
                    update { it.copy(failed = true, message = "Nothing of ours swept yet") }
                    return@withLock
                }
                if (epcs.size > Inbound.MAX_EPCS) {
                    update {
                        it.copy(failed = true,
                            message = "${epcs.size} tags is more than one delivery can take " +
                                "(${Inbound.MAX_EPCS}). Nothing was received.")
                    }
                    return@withLock
                }

                update { it.copy(busy = true, failed = false, message = "Receiving…") }
                spoolEvidence()
                drainOutbox()

                val key = Inbound.receiveKey(delivery.deliveryId, epcs)
                val outcome = withContext(Dispatchers.IO) {
                    runCatching {
                        val api = Api(settings, connectTimeoutMs = COMMIT_CONNECT_MS)
                        // `actor_id` is "handheld", as everywhere else in this
                        // app: the handheld holds a bearer token, not a name,
                        // and the node takes the operator from that token. It
                        // must not vary between attempts either — it is part of
                        // the body the idempotency key vouches for.
                        val answer = api.receiveInbound(delivery.deliveryId, epcs, ACTOR_ID, key)
                        named(Inbound.parseReceipt(answer))
                    }
                }

                outcome.onSuccess { receipt ->
                    val counts = state.value.counts
                    val history = withContext(Dispatchers.IO) {
                        runCatching {
                            catalog.recordSweep(
                                endedAt = Api.iso8601(),
                                mode = Mode.RECEIVING.name,
                                units = counts.units, skus = counts.skus,
                                articles = counts.articles, unknown = counts.unknown,
                                foreign = counts.foreign,
                                lines = state.value.lines.map { it.skuCode to it.qty },
                            )
                            catalog.sweeps()
                        }.getOrNull()
                    }
                    engine.reset()
                    sweepOpen = false
                    val text = "${receipt.delivery.title} received · ${epcs.size} tags"
                    update {
                        it.copy(
                            busy = false, failed = false, message = null,
                            counts = ScanCounts(), lines = emptyList(), resultReady = false,
                            lastReceipt = text, history = history ?: it.history,
                            inbound = it.inbound.copy(
                                receipt = receipt,
                                deliveries = it.inbound.deliveries
                                    .filter { d -> d.deliveryId != delivery.deliveryId },
                            ),
                        )
                    }
                }.onFailure { e ->
                    val conflict = (e as? ApiError)?.isConflict == true
                    // Already received from a different sweep. Show what was
                    // recorded then, marked as such, rather than a bare refusal
                    // — "somebody already did this" is only useful with WHAT
                    // they did.
                    val recorded = if (!conflict) null else withContext(Dispatchers.IO) {
                        runCatching {
                            named(Inbound.parseReceipt(
                                Api(settings, connectTimeoutMs = COMMIT_CONNECT_MS)
                                    .inboundDelivery(delivery.deliveryId),
                                alreadyReceived = true,
                            ))
                        }.getOrNull()?.takeIf { it.delivery.isReceived }
                    }
                    update {
                        it.copy(
                            busy = false,
                            failed = recorded == null,
                            message = if (recorded != null) null else
                                "${epcs.size} tags saved as evidence · " + receiveFailure(e),
                            inbound = if (recorded != null) it.inbound.copy(receipt = recorded)
                                else it.inbound,
                        )
                    }
                }
            }
        }
    }

    /** Name the lines the node sent without a name, from the local catalogue. */
    private fun named(receipt: InboundReceipt): InboundReceipt {
        val nameless = receipt.lines.filter { it.name == null }.map { it.skuCode }
        if (nameless.isEmpty()) return receipt
        val identities = runCatching { catalog.lookup(nameless) }.getOrDefault(emptyMap())
        return receipt.copy(
            lines = Inbound.problemsFirst(
                receipt.lines.map { line ->
                    if (line.name != null) line
                    else line.copy(name = identities[line.skuCode]?.name)
                },
            ),
        )
    }

    /** Why a receive did not happen, in a sentence somebody at a shop door can act on. */
    private fun receiveFailure(e: Throwable): String = when {
        (e as? ApiError)?.isConflict == true ->
            "this delivery was already received from a different sweep. " +
                "Yours was not applied and is still held here."
        e is ApiError && e.status == 404 ->
            "the node no longer knows this delivery. Refresh the list and choose again."
        e is ApiError -> plainReason(e, listing = false)
        else -> "the node could not be reached, so nothing was received. " +
            "Your sweep is kept — try again when the wifi is back."
    }

    /** A refusal or a dead socket, as a sentence rather than a stack trace. */
    private fun plainReason(e: Throwable, listing: Boolean): String = when {
        e is ApiError && e.status == 401 ->
            "the node wants a signed-in operator. Add the bearer token in Settings."
        e is ApiError && e.status == 403 ->
            "this operator is not allowed to receive stock at this shop."
        e is ApiError && e.status == 404 && listing ->
            "this node does not list deliveries yet."
        e is ApiError -> "the node refused: ${e.message}"
        else -> "the node could not be reached. Check the wifi and try again."
    }.replaceFirstChar { if (listing) it.uppercaseChar() else it }

    fun setDestination(v: String) = update { it.copy(destination = v.trim()) }
    fun setCountId(v: String) = update { it.copy(countId = v.trim()) }

    /**
     * Where this node keeps its count work. The Gudang's DC walks it under
     * `/dc/official-counts`; a shop counts its own stock under `/store/counts`,
     * which never tells the sweep what the book expects (owner, 2 Oct 2026).
     */
    private fun countsPath(role: NodeRole): String =
        if (role == NodeRole.STORE) "/api/v1/store/counts" else "/api/v1/dc/official-counts"

    /** What Official Count work this node actually holds. */
    fun loadCounts() {
        val settings = settings()
        if (!settings.isConfigured) return
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val json = Api(settings).get(countsPath(state.value.nodeRole))
                    val items = json.optJSONArray("items") ?: org.json.JSONArray()
                    (0 until items.length()).map { i ->
                        val row = items.getJSONObject(i)
                        val id = row.optString("count_id").ifBlank { row.optString("id") }
                        id to (row.optString("kind", "COUNT") + " · " + row.optString("status", "?"))
                    }
                }
            }
            result.onSuccess { list ->
                update {
                    it.copy(counts_ = list, countsLoaded = true,
                        countId = if (it.countId.isBlank() && list.isNotEmpty())
                            list.first().first else it.countId)
                }
            }.onFailure { update { it.copy(countsLoaded = true, counts_ = emptyList()) } }
        }
    }

    // ------------------------------------------------------------- the sweep

    fun toggleSweep() {
        if (state.value.busy) return
        val s = state.value
        if (!s.sweeping && !s.starting && s.isStoreReceiving) {
            // A shop's sweep belongs to a delivery, so it does not start
            // without one. The alternative — sweep first, choose after — is a
            // sweep that can be received against whatever happens to be at the
            // top of the list, which is how a lorry gets booked in as another.
            val refusal = when {
                s.inbound.receipt != null -> "Tap Done to go back to the deliveries first"
                !s.isReceivingDelivery ->
                    "Choose a delivery first — or Unannounced delivery at the foot of the list"
                // A label carries no EPC, so it cannot be compared against
                // what the DC sent. It would add to the figure on screen and
                // then silently not be part of the receipt.
                s.labelMode -> "A delivery is received by its tags. Switch the trigger back to tags."
                else -> null
            }
            if (refusal != null) {
                update { it.copy(message = refusal, failed = true) }
                return
            }
        }
        if (state.value.labelMode) { scanLabel(); return }
        if (state.value.sweeping) stopSweep() else startSweep()
    }

    /**
     * Point the trigger at the imager instead of the antenna.
     *
     * Not available mid-sweep. The two are different hardware but one finger,
     * and a handheld that silently stopped reading tags because somebody
     * flipped a switch is the failure this app keeps refusing to ship.
     */
    fun setLabelMode(on: Boolean) {
        if (state.value.sweeping || state.value.starting) {
            update { it.copy(labelNote = "stop the sweep first") }
            return
        }
        update { it.copy(labelMode = on, labelNote = null) }
        if (on) {
            viewModelScope.launch(Dispatchers.IO) {
                val opened = imager.init(appContext!!)
                update {
                    if (opened) it.copy(labelDiag = imager.diagnostics())
                    else it.copy(
                        labelMode = false,
                        labelNote = "the imager did not open",
                        labelDiag = imager.diagnostics(),
                    )
                }
            }
        } else {
            viewModelScope.launch(Dispatchers.IO) { imager.close() }
        }
    }

    /**
     * Read one label and add the product it names.
     *
     * A sweep is opened if there is not one already, so scanning labels alone
     * is a way to count a rack whose tags are all dead — which is a real rack,
     * and the reason this exists.
     */
    private fun scanLabel() {
        viewModelScope.launch {
            if (!sweepOpen) { beginSweep(); engine.start() }
            val ok = withContext(Dispatchers.IO) {
                imager.scanOnce { raw ->
                    val sku = Label.toSku(raw)
                    if (sku == null) {
                        update { it.copy(labelNote = "not one of our labels: " + raw.take(24)) }
                    } else {
                        engine.offerLabel(sku)
                        update {
                            it.copy(counts = engine.snapshot(), labelNote = sku)
                        }
                        viewModelScope.launch { buildResult() }
                    }
                }
            }
            // Written on EVERY pull, not only on refusal. A pull that reaches
            // the imager and decodes nothing used to leave the screen exactly
            // as a pull that never arrived did — and that is the difference
            // somebody debugging a dead trigger needs to see.
            update { it.copy(labelDiag = imager.diagnostics()) }
            if (!ok) update { it.copy(labelNote = "the imager refused to scan") }
        }
    }

    private fun beginSweep() {
        engine.reset()
        update { it.copy(openSweep = null) }
        uploadRetryAt = 0L
        uploadBackoffMs = UPLOAD_RETRY_BASE_MS
        sessionId = UUID.randomUUID().toString()
        sweepOpen = true
        update {
            it.copy(
                counts = ScanCounts(), lines = emptyList(), resultReady = false,
                building = false, message = null, failed = false,
                filedCount = 0, filingNote = null, metrics = ScanMetrics(),
            )
        }
    }

    private fun startSweep() {
        viewModelScope.launch {
            operationMutex.withLock {
                if (state.value.busy || state.value.sweeping) return@withLock
                if (!sweepOpen) beginSweep()
                update { it.copy(busy = true, starting = true, failed = false, message = null) }
                val result = withContext(Dispatchers.IO) {
                    runCatching {
                        // Choose the power BEFORE the module opens, so init
                        // applies it once: a setPower issued to an already-open
                        // module reports success while the antenna goes silent.
                        settings().readerPower.takeIf { it > 0 }?.let { reader.setPower(it) }
                        // Timed and shown, because "the reader is slow to wake"
                        // is a complaint nobody can act on and "1 400 ms" is.
                        // The cost is the vendor UART opening, not this app.
                        val openedAt = System.currentTimeMillis()
                        val version = reader.init(appContext!!)
                        val opened = System.currentTimeMillis() - openedAt
                        engine.start()
                        // TID rides along when FastID is on, which is how the
                        // chip identifies itself without a second read.
                        val started = reader.start(withTid = state.value.gen2.fastId) { epc, rssi, tid ->
                            engine.offer(epc, rssi, tid)
                        }
                        if (!started) {
                            engine.stop()
                            error("the reader refused to start inventory")
                        }
                        version to (System.currentTimeMillis() - openedAt) to opened
                    }
                }
                result.onSuccess { (versionAndTotal, opened) ->
                    val (version, total) = versionAndTotal
                    update {
                        it.copy(sweeping = true, busy = false, starting = false,
                            resultReady = false, lines = emptyList(),
                            readerInfo = "fw " + version.ifBlank { "?" } +
                                " · woke in ${opened} ms, live in ${total} ms",
                            readerPower = reader.power().coerceAtLeast(0),
                            message = null)
                    }
                    startTicker()
                }.onFailure { e ->
                    update { it.copy(busy = false, starting = false, failed = true,
                        message = e.message ?: "reader unavailable") }
                }
            }
        }
    }

    /**
     * Stop, drain, count, then say what was found.
     *
     * The order is the whole point. `engine.stop()` does not return until the
     * ring is empty, so the number on screen when the trigger is released is
     * the number that gets filed — tags read in the last few milliseconds are
     * still in flight, and stopping without draining loses exactly the ones
     * somebody was reaching for.
     */
    private fun stopSweep() {
        viewModelScope.launch {
            operationMutex.withLock {
                if (!state.value.sweeping) {
                    withContext(Dispatchers.IO) { runCatching { reader.stop() } }
                    return@withLock
                }
                stopTicker()
                withContext(Dispatchers.IO) { reader.stop() }
                withContext(Dispatchers.Default) { engine.stop() }

                // One trip to the database, and one state change out of it.
                //
                // Naming the products, writing the sweep down and re-reading the
                // history are three queries that used to be three separate
                // dispatches, each ending in its own `update` — so letting go of
                // the trigger produced four or five recompositions of the whole
                // shell, on a device where a frame costs eighteen milliseconds
                // at best. They are one hop now, and the screen changes once:
                // from the counting figure to the result.
                val counts = engine.snapshot()
                // A delivery is swept koli by koli, and every pull adds to it.
                //
                // Everywhere else a release ends the sweep (see below). Here it
                // cannot: ten koli are ten pulls, and closing the sweep on each
                // release would receive the last koli and report the other nine
                // missing. The sweep stays open until Finish · receive or an
                // explicit discard, and it is written to the history once, when
                // it is received — not once per koli as a running total.
                val holding = state.value.isReceivingDelivery
                val finished = withContext(Dispatchers.IO) {
                    val lines = engine.lines()
                    val identities = catalog.lookup(lines.map { it.skuCode })
                    val rows = lines
                        .map { ResultLine(it.skuCode, it.qty, identities[it.skuCode], it.epcs) }
                        .sortedByDescending { it.qty }
                    if (holding) return@withContext Triple(rows, null, state.value.history)
                    val id = runCatching {
                        catalog.recordSweep(
                            endedAt = Api.iso8601(),
                            mode = if (state.value.countEveryTag) "BENCH"
                                else state.value.mode.name,
                            units = counts.units,
                            skus = counts.skus,
                            articles = counts.articles,
                            unknown = counts.unknown,
                            foreign = counts.foreign,
                            lines = rows.map { it.skuCode to it.qty },
                        )
                    }.getOrNull()
                    Triple(rows, id, catalog.sweeps())
                }
                val (rows, sweepId, history) = finished
                // The sweep is OVER, and the next pull starts a new one.
                //
                // This flag used to be cleared by Finish, and Finish is gone —
                // the trigger records the sweep by itself now. Without this the
                // engine never resets, so every sweep after the first added to
                // the last: sightings climbed all session, the tag set only
                // ever grew, and four configurations measured in a row produced
                // four readings of the same accumulating total. Every Gen2X
                // comparison taken before this was invalid for that reason
                // alone. (A delivery being received is the one deliberate
                // exception — `holding`, above.)
                sweepOpen = holding

                update {
                    it.copy(
                        sweeping = false, busy = false, building = false,
                        counts = counts, metrics = engine.metrics(),
                        chip = engine.chip() ?: it.chip,
                        engineBeliefs = engine.beliefs(),
                        sdkCalls = reader.calls(),
                        gaps = engine.gaps(),
                        foreignSample = engine.foreignTags().take(FOREIGN_SAMPLE),
                        epcShapes = engine.epcShapes(),
                        lines = rows, resultReady = true,
                        history = history,
                        // Straight into what was just counted. The question in
                        // the operator's head is "what did I just get", not
                        // "show me every sweep I have ever done".
                        openSweep = sweepId ?: it.openSweep,
                    )
                }

                // Written down every time, not on a button.
                //
                // A bench needs the raw list of what the radio returned, and a
                // button for it is a button that has to be reachable — which is
                // exactly what failed all evening. The file costs a few
                // kilobytes and is always the last sweep.
                exportEpcs("last")

                // Everything below is somebody else's problem, not the
                // operator's: they have their answer on screen already.
                spoolEvidence()
                drainOutbox()
                // A catalogue that arrived mid-sweep goes in now that the sweep
                // it would have disturbed is over.
                pendingCatalogue?.let { codes ->
                    engine.useCatalogue(codes)
                    pendingCatalogue = null
                    update { it.copy(catalogue = it.catalogue.copy(note = null)) }
                }
            }
        }
    }

    /**
     * Turn the sweep into products, once, when it is over.
     *
     * One batched query, not one per tag: twenty thousand units are eight
     * hundred products, and eight hundred products are two `IN` queries against
     * a primary key.
     */
    private suspend fun buildResult() {
        val built = withContext(Dispatchers.Default) {
            Trace.beginSection("pindai.result.build")
            try {
                val lines = engine.lines()
                val identities = catalog.lookup(lines.map { it.skuCode })
                lines.map { ResultLine(it.skuCode, it.qty, identities[it.skuCode], it.epcs) }
                    .sortedByDescending { it.qty }
            } finally {
                Trace.endSection()
            }
        }
        update { it.copy(lines = built, resultReady = true, building = false) }
    }

    /**
     * Watch for a command file, once a second.
     *
     * A second is far slower than anything it drives and costs nothing: the
     * file usually is not there, and `exists()` on a path the app owns is a
     * stat call.
     */
    private fun startLab() {
        if (!lab.enabled || labJob?.isActive == true) return
        lab.log("--- bench ready ---")
        labJob = viewModelScope.launch {
            while (true) {
                kotlinx.coroutines.delay(1_000)
                withContext(Dispatchers.IO) { lab.poll() }
            }
        }
    }

    /**
     * One bench command.
     *
     * Every one of them writes down what the MODULE answered, not what was
     * asked — the whole reason this exists is that a setter's return value was
     * being thrown away while experiments were run against a radio that had
     * refused its orders.
     */
    private fun runLabCommand(raw: String) {
        val parts = raw.trim().split(" ")
        val verb = parts.firstOrNull()?.lowercase().orEmpty()
        val arg = parts.getOrNull(1).orEmpty()
        viewModelScope.launch {
            when (verb) {
                "session" -> {
                    val got = withContext(Dispatchers.IO) { reader.setSession(arg.toIntOrNull() ?: 0) }
                    lab.log("  session now S$got")
                }
                "tagfocus", "fastid" -> {
                    val on = arg.equals("on", true)
                    val st = withContext(Dispatchers.IO) {
                        if (verb == "tagfocus") {
                            // Deliberately does NOT force S1 here. The floor
                            // gets that default; the bench must be able to run
                            // `session 2` then `tagfocus on` and find out what
                            // S2 does with the flag. Forcing it would rewrite
                            // the experiment into the answer we already have —
                            // silently, which is how the first Tag Focus claim
                            // in this project came to be wrong. The session is
                            // printed back on the line below, every time.
                            reader.setGen2Extensions(on, reader.gen2State().fastId)
                        } else {
                            reader.setGen2Extensions(reader.gen2State().tagFocus, on)
                        }
                    }
                    lab.log("  tagFocus=${st.tagFocus} fastId=${st.fastId} session=S${st.session}")
                }
                "filter" -> {
                    val ok = withContext(Dispatchers.IO) {
                        when {
                            arg == "clear" -> reader.setOursOnlyFilter(false)
                            arg == "a0" -> reader.setOursOnlyFilter(true)
                            arg.contains("/") -> {
                                val f = arg.split("/")
                                reader.setRawFilter(
                                    f[0].toIntOrNull() ?: 0,
                                    f.getOrNull(1)?.toIntOrNull() ?: 0,
                                    f.getOrNull(2).orEmpty(),
                                )
                            }
                            arg.startsWith("first") -> {
                                val ptr = arg.removePrefix("first").toIntOrNull() ?: 32
                                val t = engine.allEpcs().firstOrNull { it.startsWith("A1") }
                                if (t == null) false else reader.setRawFilter(ptr, 96, t)
                            }
                            else -> false
                        }
                    }
                    lab.log("  setFilter accepted=$ok")
                }
                "power" -> {
                    // Note this CLOSES and REOPENS the module — see
                    // [Reader.setPower]. Everything restored on the way back up
                    // is restored by [Reader.restoreGen2], which is why the link
                    // mode had to become a tracked setting before this command
                    // could exist: a power curve that silently reset the link
                    // mode halfway would measure two things at once.
                    val got = withContext(Dispatchers.IO) {
                        operationMutex.withLock {
                            if (state.value.sweeping) reader.stop()
                            reader.setPower(arg.toIntOrNull() ?: 0)
                        }
                    }
                    if (got > 0) config.saveReaderPower(got)
                    lab.log("  power now ${got} dBm (asked $arg), rfLink=${reader.rfLink()}")
                }
                "freq" -> {
                    lab.log("  frequencyMode=${withContext(Dispatchers.IO) { reader.frequencyMode() }} (vendor number, unmapped)")
                }
                "epcs" -> {
                    // The EPC list itself, so two sweeps can be intersected by
                    // NAME rather than compared by count. Chip is appended when
                    // this sweep knew it.
                    val chips = engine.chipByEpc()
                    val all = engine.allEpcs()
                    lab.log("  ${all.size} epcs")
                    all.sorted().forEach { epc ->
                        lab.log("  E $epc ${chips[epc] ?: "-"}")
                    }
                }
                "sound" -> {
                    val mode = when (arg.lowercase()) {
                        "off" -> Sounder.Mode.OFF
                        "read", "reads", "every" -> Sounder.Mode.EVERY_READ
                        else -> Sounder.Mode.NEW_TAG
                    }
                    sounder.mode = mode
                    lab.log("  sound=$mode")
                }
                "chips" -> {
                    val chips = engine.chips()
                    if (chips.isEmpty()) {
                        lab.log("  no TIDs — FastID was off for that sweep")
                    } else {
                        chips.forEach { (name, n) -> lab.log("  $n x $name") }
                    }
                }
                "rflink" -> {
                    val got = withContext(Dispatchers.IO) {
                        operationMutex.withLock {
                            if (state.value.sweeping) reader.stop()
                            reader.setRfLink(arg.toIntOrNull() ?: 0)
                        }
                    }
                    if (got >= 0) config.saveRfLink(got)
                    lab.log("  rfLink now $got — " + reader.rfLinkName(got))
                }
                "target" -> {
                    val got = withContext(Dispatchers.IO) {
                        operationMutex.withLock {
                            if (state.value.sweeping) reader.stop()
                            reader.setTarget(arg.toIntOrNull() ?: 0)
                        }
                    }
                    lab.log("  target now " + if (got == 0) "A" else if (got == 1) "B" else "?")
                }
                "decay" -> {
                    // Sweep, rest, sweep — and compare the SECOND against the
                    // FIRST, because what is being asked is how much a rack
                    // still answers after the radio has stopped for a while.
                    //
                    // This is the measurement the earlier one only appeared to
                    // make: back then the tag set was never cleared between
                    // sweeps, so the second always contained the first and
                    // "100 % recovery" was arithmetic rather than evidence.
                    val rest = (arg.toLongOrNull() ?: 5L).coerceIn(1, 120)
                    startSweep(); kotlinx.coroutines.delay(11_500); stopSweep()
                    kotlinx.coroutines.delay(3_000)
                    val first = state.value.counts.distinctTags
                    kotlinx.coroutines.delay(rest * 1_000)
                    startSweep(); kotlinx.coroutines.delay(11_500); stopSweep()
                    kotlinx.coroutines.delay(3_000)
                    val second = state.value.counts.distinctTags
                    val pct = if (first == 0) 0 else second * 100 / first
                    lab.log("  rest=${rest}s ceiling=$first after=$second recovery=$pct%")
                }
                "reset" -> lab.log("  " + withContext(Dispatchers.IO) { reader.resetRadioDefaults() })
                "sweep" -> {
                    val seconds = (arg.toLongOrNull() ?: 10L).coerceIn(1, 120)
                    startSweep()
                    kotlinx.coroutines.delay(1_500 + seconds * 1_000)
                    stopSweep()
                    kotlinx.coroutines.delay(3_000)
                    val c = state.value.counts
                    val m = state.value.metrics
                    lab.log(
                        "  tags=${c.distinctTags} products=${c.units} malformed=${c.malformed}" +
                            " sightings=${m.sightings} dup=${m.duplicates}" +
                            " (%.1f%%)".format(m.dedupRatio * 100),
                    )
                    val g = engine.gaps()
                    lab.log(
                        "  gaps n=${g.samples} mean=%.0fms max=${g.maxMs}ms over500=${g.over500ms}"
                            .format(g.meanMs),
                    )
                    lab.log("  shapes " + engine.epcShapes())
                }
                "state" -> {
                    val st = withContext(Dispatchers.IO) { reader.gen2State() }
                    lab.log("  tagFocus=${st.tagFocus} fastId=${st.fastId} session=S${st.session}")
                    val link = withContext(Dispatchers.IO) { reader.rfLink() }
                    lab.log("  rfLink=$link — " + reader.rfLinkName(link))
                    lab.log("  target=" + state.value.gen2.session.let { "" } +
                        withContext(Dispatchers.IO) { reader.gen2Dump() }
                            .substringAfter("queryTarget=").substringBefore(","))
                    lab.log("  " + withContext(Dispatchers.IO) { reader.gen2Dump() })
                }
                "calls" -> reader.calls().takeLast(10).forEach { lab.log("  $it") }
                "marry" -> { marryDetectedTags(); lab.log("  marrying") }
                "forget" -> { divorceTags(); lab.log("  forgetting") }
                else -> lab.log("  unknown command")
            }
        }
    }

    /** The history list, read fresh. */
    fun loadHistory() {
        viewModelScope.launch {
            val rows = withContext(Dispatchers.IO) {
                runCatching { catalog.sweeps() }.getOrDefault(emptyList())
            }
            update { it.copy(history = rows) }
        }
    }

    /** Open one recorded sweep, naming its products from the local catalogue. */
    fun openSweep(id: Long) {
        viewModelScope.launch {
            val built = withContext(Dispatchers.IO) {
                val stored = catalog.sweepLines(id)
                val identities = catalog.lookup(stored.map { it.first })
                stored.map { (sku, qty) -> ResultLine(sku, qty, identities[sku], emptyList()) }
            }
            update { it.copy(openSweep = id, lines = built, resultReady = true) }
        }
    }

    fun closeSweep() = update { it.copy(openSweep = null) }

    /**
     * Ask the module for Impinj's Gen2X extensions.
     *
     * Tag Focus quiets a tag that has already been inventoried, so the reader
     * stops re-reading the rack it has already counted and spends its air time
     * on the one it has not. FastID brings the TID back with the EPC, which is
     * what lets the app say whose silicon this is.
     *
     * Not while sweeping: both change what the radio is doing mid-round.
     */
    fun setGen2Extensions(
        tagFocus: Boolean,
        fastId: Boolean,
        /**
         * Which session to run the round in, and it is NOT optional in practice.
         *
         * Tag Focus extends the S1 inventoried flag. In S0 there is no flag to
         * extend — measured at 93.1 % duplicates against 92.6 %, inside the
         * noise — so switching it on without the session is switching on a
         * feature that cannot work, and then reporting it as on.
         *
         * Every call site used to omit this, so the one line that set the
         * session never ran and the Settings button handed people a silent
         * feature that was not silent. Turning Tag Focus ON now brings S1 with
         * it, because they were never two settings.
         */
        session: Int? = if (tagFocus) SESSION_FOR_TAG_FOCUS else null,
    ) {
        viewModelScope.launch {
            // Under the SAME lock as starting and stopping.
            //
            // These used to check `sweeping` and then act, which is a race: the
            // check passes, a trigger pull starts inventory, and the setting
            // lands on a running radio. The Lab path skipped even that check.
            // A configuration applied mid-round is a configuration nobody can
            // reason about afterwards — and reasoning about exactly that is
            // what this app spent a night failing to do.
            val applied = operationMutex.withLock {
                if (state.value.sweeping) withContext(Dispatchers.IO) { reader.stop() }
                withContext(Dispatchers.IO) { reader.setGen2Extensions(tagFocus, fastId, session) }
            }
            val dump = withContext(Dispatchers.IO) { reader.gen2Dump() }
            // Written down, so a restart or a night on the charger does not
            // quietly hand the floor a reader nobody told anything.
            config.saveRadio(applied.tagFocus, applied.session)
            update { it.copy(gen2 = applied, gen2Dump = dump, sdkCalls = reader.calls()) }
        }
    }

    /**
     * Tell the radio to report one SKU and ignore the rest.
     *
     * The point of asking the READER rather than filtering what it sends is that
     * a tag which never answers costs nothing — no air time, no sighting, no
     * work on this device. That is the difference between finding one garment
     * among twenty thousand and finding twenty thousand and then looking.
     */
    fun setSkuFilter(sku: String) {
        if (state.value.sweeping || state.value.starting) return
        val cleaned = sku.trim()
        viewModelScope.launch {
            val accepted = withContext(Dispatchers.IO) {
                reader.setSkuFilter(cleaned.ifBlank { null })
            }
            update {
                it.copy(
                    skuFilter = cleaned,
                    filterNote = when {
                        cleaned.isBlank() -> if (accepted) "cleared" else "the module refused to clear it"
                        accepted -> "module accepted · sweep to see whether it HONOURS it"
                        else -> "the module refused the filter"
                    },
                )
            }
        }
    }

    /**
     * Count transponders rather than stock.
     *
     * For a bench whose tags are not ours in writing. See
     * [ScanEngine.countEveryTag] for why this must not leave one.
     */
    fun setCountEveryTag(on: Boolean) {
        if (state.value.sweeping || state.value.starting) return
        engine.countEveryTag = on && BuildConfig.BENCH
        update { it.copy(countEveryTag = on, engineBeliefs = engine.beliefs()) }
    }

    /**
     * Marry every tag the last sweep could not name to a product that exists.
     *
     * A bench fixture. The tags stay exactly as they are — nothing is written to
     * any transponder — and the evidence filed to the Edge still carries the
     * real EPC. What changes is only what THIS handheld calls them, so a rig
     * full of other people's tags can exercise grouping, naming, search and the
     * result screen.
     */
    fun marryDetectedTags() {
        if (state.value.sweeping || state.value.starting) return
        val orphans = engine.foreignTags() + engine.unknownEpcs()
        if (orphans.isEmpty()) {
            update { it.copy(aliasNote = "nothing unnamed in the last sweep") }
            return
        }
        viewModelScope.launch {
            val count = withContext(Dispatchers.IO) {
                val skus = catalog.someSkuCodes(MARRY_SPREAD)
                if (skus.isEmpty()) return@withContext -1
                val n = catalog.marryEpcs(orphans, skus)
                engine.useAliases(catalog.epcAliases())
                n
            }
            update {
                it.copy(
                    aliasCount = withContext(Dispatchers.IO) { catalog.aliasCount() },
                    aliasNote = if (count < 0) "no catalogue to marry them to"
                        else "$count tags married · sweep again",
                    engineBeliefs = engine.beliefs(),
                )
            }
        }
    }

    /**
     * Write the last sweep's EPCs to a file a laptop can read.
     *
     * # Why this exists
     *
     * A histogram tells you the shape of what came back; it cannot tell you
     * WHICH tags a filter removed, or whether the ones it kept are the ones it
     * should have. That needs the list, and a list of two thousand strings does
     * not fit on a screen or through a UI dump.
     *
     * It lands in the app's own external files directory, which `adb pull`
     * reads without any permission and no other app can touch.
     */
    fun exportEpcs(label: String) {
        viewModelScope.launch {
            val epcs = engine.allEpcs()
            val path = withContext(Dispatchers.IO) {
                runCatching {
                    val dir = appContext!!.getExternalFilesDir(null)
                    val file = java.io.File(dir, "epcs-$label.txt")
                    file.writeText(
                        buildString {
                            append("# vendor calls, newest last\n")
                            reader.calls().forEach { append("# ").append(it).append('\n') }
                            append("# ").append(epcs.size).append(" distinct EPCs\n")
                            append(epcs.joinToString("\n"))
                        },
                    )
                    file.absolutePath
                }.getOrNull()
            }
            update {
                it.copy(
                    aliasNote = if (path == null) "export failed"
                        else "${epcs.size} EPCs written to $path",
                )
            }
        }
    }

    /** Forget every marriage; tags go back to being what their EPC says. */
    fun divorceTags() {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                catalog.clearAliases()
                engine.useAliases(emptyMap())
            }
            update { it.copy(aliasCount = 0, aliasNote = "all marriages forgotten") }
        }
    }

    /** Put the radio back to a block that is known to sweep a rack. */
    fun resetRadio() {
        if (state.value.sweeping || state.value.starting) return
        viewModelScope.launch {
            val dump = withContext(Dispatchers.IO) { reader.resetRadioDefaults() }
            val st = withContext(Dispatchers.IO) { reader.gen2State() }
            update { it.copy(gen2 = st, gen2Dump = dump, skuFilter = "", filterNote = null) }
        }
    }

    /** Set the inventory slot count to 2^[exponent]. See [Reader.setStartQ]. */
    fun setStartQ(exponent: Int) {
        if (state.value.sweeping || state.value.starting) return
        viewModelScope.launch {
            withContext(Dispatchers.IO) { reader.setStartQ(exponent) }
            val st = withContext(Dispatchers.IO) { reader.gen2State() }
            val dump = withContext(Dispatchers.IO) { reader.gen2Dump() }
            config.saveRadio(st.tagFocus, st.session)
            update { it.copy(gen2 = st, gen2Dump = dump, sdkCalls = reader.calls()) }
        }
    }

    /**
     * Make the radio deaf to everything that is not ours.
     *
     * Eight bits of Select on the EPC header. See [Reader.setOursOnlyFilter] —
     * unlike the SKU filter this is safe to leave on while counting, because it
     * narrows to the whole estate rather than to one product.
     */
    fun setOursOnly(on: Boolean) {
        if (state.value.sweeping || state.value.starting) return
        viewModelScope.launch {
            val accepted = withContext(Dispatchers.IO) { reader.setOursOnlyFilter(on) }
            update {
                it.copy(
                    oursOnly = on,
                    sdkCalls = reader.calls(),
                    skuFilter = "",
                    filterNote = when {
                        !accepted -> "the module refused it"
                        on -> "accepted · sweep to see whether it HONOURS it"
                        else -> "cleared"
                    },
                )
            }
        }
    }

    /**
     * Try one Select and say whether the module took it.
     *
     * `spec` is "pointer/lengthBits/hex" — a probe, not a feature. See
     * [Reader.setRawFilter] for why this has to be discovered by experiment.
     */
    fun tryRawFilter(spec: String) {
        if (state.value.sweeping || state.value.starting) return
        val parts = spec.trim().split("/")
        if (parts.size != 3) {
            update { it.copy(filterNote = "use pointer/bits/hex") }
            return
        }
        val ptr = parts[0].toIntOrNull()
        val bits = parts[1].toIntOrNull()
        val hex = parts[2].uppercase()
        if (ptr == null || bits == null) {
            update { it.copy(filterNote = "pointer and bits must be numbers") }
            return
        }
        viewModelScope.launch {
            val ok = withContext(Dispatchers.IO) { reader.setRawFilter(ptr, bits, hex) }
            update {
                it.copy(
                    skuFilter = spec,
                    filterNote = if (ok) "accepted ptr=$ptr bits=$bits · sweep to see"
                        else "the module refused it",
                    sdkCalls = reader.calls(),
                )
            }
        }
    }

    /**
     * Filter to ONE tag the last sweep actually saw, and see what comes back.
     *
     * The decisive experiment, and it needs no typing: a Select on a whole EPC
     * that is definitely on the desk can only have one correct answer. One tag
     * back means the filter works and we have learnt what the vendor means by
     * pointer and length. Sixty-four means it is ignored. Zero means the mask
     * lands somewhere else in the bank. Thousands means it corrupts the stream,
     * which is what an 8-bit mask at pointer 32 already did.
     */
    fun probeFilterOnFirstTag(pointer: Int) {
        if (state.value.sweeping || state.value.starting) return
        val target = engine.allEpcs().firstOrNull { it.startsWith("A1") }
            ?: engine.allEpcs().firstOrNull()
        if (target == null) {
            update { it.copy(filterNote = "sweep first — there is no tag to aim at") }
            return
        }
        viewModelScope.launch {
            val ok = withContext(Dispatchers.IO) { reader.setRawFilter(pointer, 96, target) }
            update {
                it.copy(
                    skuFilter = "$pointer/96/$target",
                    filterNote = if (ok) "aimed at ${target.take(12)}… (ptr $pointer)"
                        else "REFUSED by the module",
                    sdkCalls = reader.calls(),
                )
            }
        }
    }

    /** Move the inventory round between Gen2 sessions. See [Reader.setSession]. */
    fun setSession(session: Int) {
        viewModelScope.launch {
            operationMutex.withLock {
                if (state.value.sweeping) withContext(Dispatchers.IO) { reader.stop() }
                withContext(Dispatchers.IO) { reader.setSession(session) }
            }
            // Tag Focus does not survive the move, so neither does the flag.
            //
            // Tag Focus extends how long an inventoried tag holds its flag, and
            // only S1 has a flag that persists at all. Left alone, tapping S0
            // under a lit "Tag Focus: on" used to leave the module holding a
            // setting with nothing to act on — harmless until it was written
            // down, and now it would be restored on every launch. So the
            // combination is not saved, it is not allowed: the radio is told to
            // drop the flag, and the screen says so because it reads back from
            // the module.
            //
            // The bench keeps its raw path — Lab's `session` command drives
            // [Reader.setSession] directly and never comes through here.
            var st = withContext(Dispatchers.IO) { reader.gen2State() }
            if (st.tagFocus && st.session != SESSION_FOR_TAG_FOCUS) {
                st = withContext(Dispatchers.IO) {
                    reader.setGen2Extensions(false, st.fastId)
                }
            }
            val dump = withContext(Dispatchers.IO) { reader.gen2Dump() }
            config.saveRadio(st.tagFocus, st.session)
            update { it.copy(gen2 = st, gen2Dump = dump, sdkCalls = reader.calls()) }
        }
    }

    /** Keep a sweep at the top of the history, or let it go. */
    fun togglePin(id: Long) {
        viewModelScope.launch {
            val current = state.value.history.firstOrNull { it.id == id }?.pinned ?: false
            withContext(Dispatchers.IO) { runCatching { catalog.setPinned(id, !current) } }
            loadHistory()
        }
    }

    /** Publish counts at a pace an eye can follow; file evidence far slower. */
    private fun startTicker() {
        tickJob?.cancel()
        tickJob = viewModelScope.launch {
            var tick = 0
            while (state.value.sweeping) {
                kotlinx.coroutines.delay(PUBLISH_MS)
                if (!state.value.sweeping) break
                // Publish the COUNT, and only the count.
                //
                // This used to carry `metrics` too, and metrics climb with every
                // sighting — so a rack being read at a thousand sightings a
                // second made the state differ on every single tick even when
                // the number on screen had not moved. StateFlow conflates equal
                // values; it was never given the chance. The whole shell
                // recomposed five times a second to redraw a figure that was
                // already right, and on this hardware every one of those frames
                // costs eighteen milliseconds or more.
                //
                // Now an unchanged sweep emits nothing and renders nothing.
                update { it.copy(counts = engine.snapshot()) }
                // Evidence every ten ticks — two seconds — so the radio is quiet
                // between them and the publish cadence never waits on a disk or
                // a network.
                if (++tick % EVIDENCE_EVERY == 0) {
                    // Instrumentation rides the two-second lane, not the
                    // 200 ms one. Nothing on the scanning screen draws it.
                    update { it.copy(metrics = engine.metrics()) }
                    spoolEvidence()
                    drainOutbox()
                    if (state.value.sessionCode.isNotBlank()) refreshShared()
                }
            }
        }
    }

    private suspend fun stopTicker() {
        val job = tickJob
        tickJob = null
        job?.cancelAndJoin()
    }

    // ---------------------------------------------------------------- evidence

    /**
     * Freeze what the worker has found into durable batches.
     *
     * This is deliberately NOT inside the upload path and holds no lock that an
     * upload can hold. The uploader can sit on a socket for forty seconds; if
     * spooling waited behind it, forty seconds of a stock count would have no
     * home but RAM — in exactly the network conditions the spool exists for.
     */
    private suspend fun spoolEvidence() {
        val settings = settings()
        if (!settings.isConfigured) return
        spoolMutex.withLock {
            withContext(Dispatchers.IO) {
                val api = Api(settings)
                while (true) {
                    val batch = engine.takeEvidence(MAX_OBSERVATIONS_PER_BATCH)
                    if (batch.isEmpty()) break
                    val session = currentSessionId()
                    // One timestamp, used for BOTH the key and the body.
                    //
                    // The key used to hash the session and the EPC set alone,
                    // while the body also carried `observed_at` and each RSSI.
                    // In a shared session the code stays the same all day, so
                    // sweeping one rack twice produced an identical key over a
                    // different body — which the Edge refuses, correctly, as a
                    // key already used for another request. The key now covers
                    // what the body covers.
                    val observedAt = Api.iso8601()
                    val key = idempotencyKey(session, observedAt, batch)
                    val ok = runCatching {
                        val body = api.buildObservationBody(batch, session, key, observedAt)
                        catalog.spool(session, key, body, batch.size, observedAt)
                    }
                    if (ok.isFailure) {
                        // Hand it back rather than lose it; the next tick tries
                        // again against a disk that may have stopped complaining.
                        engine.returnEvidence(batch)
                        break
                    }
                }
            }
            update { it.copy(outboxPending = withContext(Dispatchers.IO) { catalog.pendingCount() }) }
        }
    }

    /**
     * Stable across a lost response, and different whenever the body differs.
     *
     * Both halves matter. Stable, so a retry of the SAME bytes is recognised
     * and counted once. Different, so two sweeps that happen to find the same
     * rack under the same session code do not collide — which they did, because
     * the key covered the session and the tags while the body also carried the
     * time and the signal strengths.
     */
    private fun idempotencyKey(
        session: String,
        observedAt: String,
        batch: List<Pair<String, Float?>>,
    ): String {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(session.toByteArray(Charsets.UTF_8))
        digest.update('\n'.code.toByte())
        digest.update(observedAt.toByteArray(Charsets.UTF_8))
        digest.update('\n'.code.toByte())
        batch.asSequence()
            .map { (epc, rssi) -> epc + ':' + (rssi?.toString() ?: "") }
            .sorted()
            .forEach {
                digest.update(it.toByteArray(Charsets.UTF_8))
                digest.update('\n'.code.toByte())
            }
        return "hh-rfid-" + digest.digest().joinToString("") { "%02x".format(it) }.take(56)
    }

    /**
     * Hand the spool to the Edge, oldest first.
     *
     * Each attempt signs the stored bytes FRESH. The signature's timestamp is
     * checked against a five-minute window in both directions, so a batch that
     * waited out an offline spell cannot be replayed with the proof it was born
     * with. That is also why a conflict is an acknowledgement here: under a key
     * derived from the batch's own contents, "this key is taken" can only mean
     * this reader already filed these tags.
     */
    fun drainOutbox() {
        val settings = settings()
        if (!settings.isConfigured) return
        if (System.currentTimeMillis() < uploadRetryAt) return
        if (uploadJob?.isActive == true) { uploadRequested = true; return }
        uploadRequested = false
        uploadJob = viewModelScope.launch {
            try {
                val report = withContext(Dispatchers.IO) { uploadPending(settings) }
                update {
                    it.copy(
                        outboxPending = report.pending,
                        filedCount = report.filed,
                        filingNote = report.note,
                        clockSuspect = report.clockSuspect,
                    )
                }
            } finally {
                uploadJob = null
                val again = uploadRequested
                uploadRequested = false
                if (again) drainOutbox()
            }
        }
    }

    private class UploadReport(
        val pending: Int, val filed: Int, val note: String?, val clockSuspect: Boolean,
    )

    private fun uploadPending(settings: Settings): UploadReport {
        val api = signingApi(settings)
        var sent = 0
        var note: String? = null
        var clockSuspect = false
        while (true) {
            val batches = catalog.pendingBatches(UPLOAD_BATCHES)
            if (batches.isEmpty()) break
            var progressed = false
            for (batch in batches) {
                val outcome = runCatching { api.postObservationBody(batch.body) }
                // A conflict is NOT an acknowledgement. Not any more.
                //
                // It was, and the reasoning was sound at the time: the Edge
                // compared the sequence a batch was signed with, so a
                // legitimate retry — which must be re-signed, because the
                // signature's window is five minutes — came back 409, and
                // treating that as "already filed" was the only way to make
                // progress.
                //
                // That comparison has since been removed at the Edge. A retry
                // of the same frozen body from the same reader now matches on
                // device and digest and is handed the stored response. So the
                // only thing 409 can mean today is that this key carries
                // DIFFERENT content — a batch that was never accepted. Keeping
                // the old branch would delete exactly those and mark their tags
                // as filed: evidence lost, with nothing left to show it.
                val accepted = outcome.isSuccess
                if (accepted) {
                    catalog.acknowledge(batch.id, batch.sessionId, epcsOf(batch.body))
                    sent += batch.epcCount
                    progressed = true
                    config.saveClockWatermark(System.currentTimeMillis() / 1000)
                } else {
                    val error = outcome.exceptionOrNull()
                    note = "not filed yet (${error?.message ?: "network unavailable"})"
                    // A device whose clock went backwards fails TWO independent
                    // checks at the Edge — the signature's skew window and the
                    // sequence that may only climb — and no bookkeeping here can
                    // get around either. Say so, instead of retrying behind a
                    // spinner forever. The evidence stays spooled.
                    if (clockWentBackwards()) {
                        clockSuspect = true
                        note = "device clock is wrong — evidence is saved, filing is paused"
                    }
                    catalog.noteFailure(batch.id, error?.message ?: "unknown")
                    uploadRetryAt = System.currentTimeMillis() + uploadBackoffMs
                    uploadBackoffMs = (uploadBackoffMs * 2).coerceAtMost(UPLOAD_RETRY_MAX_MS)
                    return UploadReport(catalog.pendingCount(), sent, note, clockSuspect)
                }
            }
            if (!progressed) break
        }
        uploadRetryAt = 0L
        uploadBackoffMs = UPLOAD_RETRY_BASE_MS
        return UploadReport(
            catalog.pendingCount(), sent,
            if (sent > 0) "$sent filed" else null, false,
        )
    }

    /** An [Api] whose device sequence carries on from where this device left off. */
    private fun signingApi(settings: Settings, connectTimeoutMs: Int = 15_000) =
        Api(
            settings,
            connectTimeoutMs = connectTimeoutMs,
            sequenceFloor = { config.sequenceWatermark() },
            onSequence = { config.saveSequenceWatermark(it) },
        )

    private fun clockWentBackwards(): Boolean {
        val watermark = config.load().clockWatermark
        return watermark > 0 && System.currentTimeMillis() / 1000 < watermark - CLOCK_SLACK_SECONDS
    }

    /** Read the EPCs back out of a frozen batch, to record them as filed. */
    private fun epcsOf(body: ByteArray): List<String> = runCatching {
        val json = JSONObject(String(body, Charsets.UTF_8))
        val array = json.optJSONArray("observations") ?: return emptyList()
        (0 until array.length()).map { array.getJSONObject(it).optString("epc") }
            .filter { it.isNotBlank() }
    }.getOrDefault(emptyList())

    // ------------------------------------------------------------- the commit

    /** File the evidence, then do whatever this mode means on top of it. */
    fun commit() {
        viewModelScope.launch {
            operationMutex.withLock {
                val settings = settings()
                if (!settings.isConfigured) {
                    update { it.copy(failed = true, message = "Settings are incomplete") }
                    return@withLock
                }
                if (state.value.sweeping) {
                    // A read can arrive between the last tick and this tap.
                    stopTicker()
                    withContext(Dispatchers.IO) { reader.stop() }
                    withContext(Dispatchers.Default) { engine.stop() }
                    update { it.copy(sweeping = false, counts = engine.snapshot()) }
                    buildResult()
                }
                val current = state.value
                if (current.counts.units == 0) {
                    update { it.copy(failed = true, message = "Nothing swept yet") }
                    return@withLock
                }

                update { it.copy(busy = true, message = "Saving…", failed = false) }

                // Durable, not delivered.
                //
                // Finish used to wait for the Edge to acknowledge every batch,
                // and with a node that was not there that meant fifteen seconds
                // of connect timeout before the operator got their screen back
                // — for work that was already safe on disk. That is precisely
                // what the outbox exists to stop being necessary. The evidence
                // is written down here; handing it over is the uploader's job
                // and nobody stands still for it.
                spoolEvidence()
                drainOutbox()

                // Evidence is a fact; a carton, a receipt or a count entry is a
                // decision, and a decision genuinely needs the node. Those fail
                // when it is absent — but they fail in four seconds and say why,
                // and they never make the facts look unfiled.
                val outcome: Result<String?> = withContext(Dispatchers.IO) {
                    runCatching {
                        val api = Api(settings, connectTimeoutMs = COMMIT_CONNECT_MS)
                        when (current.mode) {
                            Mode.SCAN -> null
                            Mode.PACKING -> packing(api, current)
                            Mode.RECEIVING -> receiving(api, current)
                            Mode.COUNT -> counting(api, current)
                        }
                    }
                }

                val units = current.counts.units
                when {
                    outcome.isFailure -> update {
                        it.copy(busy = false, failed = true,
                            message = "$units observations SAVED · " +
                                (outcome.exceptionOrNull()?.message ?: "next step failed"))
                    }
                    else -> {
                        val queued = withContext(Dispatchers.IO) { catalog.pendingCount() }
                        val text = "$units observations saved" +
                            (outcome.getOrNull()?.let { " · $it" } ?: "") +
                            (if (queued > 0) " · $queued batches waiting for the node" else "")
                        engine.reset()
                        sweepOpen = false
                        // An unannounced lorry on a shop is done once it is
                        // received: back to the list, where the sentence above
                        // is shown, rather than to an empty sweep for a delivery
                        // that no longer needs one.
                        val wasUnannounced = current.isStoreReceiving && current.inbound.unannounced
                        update {
                            it.copy(busy = false, failed = false, counts = ScanCounts(),
                                lines = emptyList(), resultReady = false,
                                message = text, lastReceipt = text,
                                inbound = if (wasUnannounced) it.inbound.copy(unannounced = false)
                                    else it.inbound)
                        }
                        if (wasUnannounced) loadInbound()
                        refreshShared()
                    }
                }
            }
        }
    }

    /** A carton for one shop, targeted by what the sweep actually found. */
    private fun packing(api: Api, s: SweepState): String {
        if (s.destination.isBlank()) throw IllegalStateException("name the destination shop first")
        val targets = s.lines.associate { it.skuCode to it.qty }
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
        val id = response.optJSONObject("session")?.optString("session_id").orEmpty()
        return "carton ${id.take(8).ifBlank { "?" }} · ${targets.size} SKUs"
    }

    /** Each tag arrives at the shop as its own unit. */
    private fun receiving(api: Api, s: SweepState): String {
        // One delivery, as few requests as the node will take. A POST per tag
        // turned an arrival into fifty transactions over shop wifi, and was
        // wrong in the ledger besides, because the goods came off one lorry.
        val units = s.lines.flatMap { line -> line.epcs.map { it to line.skuCode } }
        if (units.isEmpty()) throw IllegalStateException("no tags of ours in this sweep")

        // The node refuses more than a thousand lines in one body, and a sweep
        // of a real delivery passes that easily. Chunking here is the
        // difference between a long arrival being received and being refused
        // whole.
        var sent = 0
        units.chunked(RECEIVE_CHUNK).forEachIndexed { index, chunk ->
            val lines = org.json.JSONArray()
            chunk.forEach { (epc, sku) ->
                lines.put(
                    JSONObject().put("epc", epc).put("sku_code", sku)
                        .put("unit_price_minor", 0),
                )
            }
            val payload = JSONObject().apply {
                put("lines", lines)
                put("actor_id", "handheld")
                // Keyed by what is IN the chunk, not by the session.
                //
                // A shared session keeps one code all day, so a key built from
                // it made every delivery of that session collide with the
                // first — the node refused them as the same key over a
                // different payload, and a second lorry could not be received.
                put("idempotency_key", receiveKey(chunk, index))
            }
            api.post("/api/v1/store/receive-batch", payload)
            sent += chunk.size
        }
        val foreign = s.counts.foreign
        return "$sent received" + if (foreign > 0) ", $foreign not ours" else ""
    }

    /** A key that names this exact set of units, and only it. */
    private fun receiveKey(chunk: List<Pair<String, String>>, index: Int): String {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(index.toString().toByteArray(Charsets.UTF_8))
        chunk.map { it.first }.sorted().forEach {
            digest.update(it.toByteArray(Charsets.UTF_8))
            digest.update('\n'.code.toByte())
        }
        return "hh-recv-" + digest.digest().joinToString("") { "%02x".format(it) }.take(40)
    }

    /** Entries against an Official Count the centre already opened. */
    private fun counting(api: Api, s: SweepState): String {
        if (s.countId.isBlank()) throw IllegalStateException("choose a count first")
        // The SKU rides with every entry.
        //
        // `OfficialCountEntryInput` requires it and has no serde default, so a
        // body without it is refused whole — serde rejects the request before a
        // single entry is read, and the node answers 400. This mode has never
        // filed a count entry in its life, and the observation batch going out
        // first is what hid it: the sweep reported itself as filed, because it
        // was, and the count that was supposed to follow never happened.
        val entries = org.json.JSONArray()
        s.lines.forEach { line ->
            line.epcs.forEach { epc ->
                entries.put(
                    JSONObject()
                        .put("epc", epc)
                        .put("sku_code", line.skuCode)
                        .put("found_quantity", 1),
                )
            }
        }
        val payload = JSONObject().apply {
            put("entries", entries)
            put("actor_id", "handheld")
            put("idempotency_key", "hh-count-" + sessionId.take(12))
        }
        api.post("${countsPath(s.nodeRole)}/${s.countId}/entries", payload)
        return "${entries.length()} count entries"
    }

    // ------------------------------------------------------------- sessions

    fun setSessionCode(code: String) {
        if (state.value.busy || (sweepOpen && state.value.counts.units > 0)) {
            update { it.copy(sharedNote = "finish the current sweep before changing session") }
            return
        }
        val cleaned = code.trim().uppercase().filter { it.isLetterOrDigit() || it == '-' }.take(24)
        sharedGeneration++
        config.save(config.load().copy(sessionCode = cleaned))
        update { it.copy(sessionCode = cleaned, shared = null, sharedNote = null) }
        if (cleaned.isNotBlank()) refreshShared()
    }

    /**
     * Begin a session by naming one.
     *
     * The alphabet drops O/0 and I/1 because these codes are read aloud across
     * a floor, and "S-I0K" is an argument waiting to happen.
     */
    fun newSessionCode() {
        val alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        setSessionCode("S-" + (1..6).map { alphabet.random() }.joinToString(""))
        loadSessions()
    }

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
            result.onSuccess { list -> update { it.copy(sessions = list, sessionsLoaded = true) } }
                .onFailure { update { it.copy(sessions = emptyList(), sessionsLoaded = true) } }
        }
    }

    fun refreshShared() {
        val settings = settings()
        val code = state.value.sessionCode
        if (!settings.isConfigured || code.isBlank()) return
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
                sharedJob = null
                if (generation != sharedGeneration && state.value.sessionCode.isNotBlank()) {
                    refreshShared()
                }
            }
        }
    }

    // ---------------------------------------------------------------- power

    /**
     * Turn the antenna up or down, mid-sweep if that is when it is needed.
     *
     * Moving the power costs the whole module: on this firmware a setPower to
     * an open module goes silently unradiated, so [Reader.setPower] closes and
     * re-opens it — and that measured **seven seconds** on a C5. Seven seconds
     * of dead antenna is a rack walked past, so the screen says busy and stops
     * offering Finish for the duration. Nothing is lost — the engine is not the
     * radio — but the person holding it has to know to stand still.
     */
    fun setPower(dbm: Int) {
        if (state.value.busy) return
        val target = dbm.coerceIn(Reader.MIN_POWER, Reader.MAX_POWER)
        if (target == state.value.readerPower) return
        viewModelScope.launch {
            operationMutex.withLock {
                if (state.value.busy) return@withLock
                val sweeping = state.value.sweeping
                update {
                    it.copy(busy = true,
                        powerNote = if (sweeping) "moving the antenna · about 7 seconds"
                            else "moving the antenna…")
                }
                stopTicker()
                val outcome = withContext(Dispatchers.IO) {
                    runCatching {
                        if (sweeping) reader.stop()
                        val applied = reader.setPower(target)
                        val resumed = !sweeping ||
                            reader.start(withTid = state.value.gen2.fastId) { epc, rssi, tid ->
                                engine.offer(epc, rssi, tid)
                            }
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
                            sweeping = it.sweeping && resumed,
                            failed = it.failed || !resumed,
                            message = if (resumed) it.message
                                else "the reader stopped — start reading again",
                        )
                    }
                    if (!resumed) {
                        withContext(Dispatchers.Default) { engine.stop() }
                        spoolEvidence()
                        drainOutbox()
                        buildResult()
                    } else if (sweeping) {
                        startTicker()
                    }
                    update { it.copy(busy = false) }
                }.onFailure { e ->
                    update { it.copy(busy = false, powerNote = e.message ?: "the reader refused") }
                }
            }
        }
    }

    /**
     * Put the radio down when the operator walks off to Setelan.
     *
     * Everything found stays found — this is a pause, not an abandonment. What
     * must not survive is the CLAIM that the reader is still reading.
     */
    fun releaseReader() {
        if (state.value.sweeping) {
            stopSweep()
            return
        }
        viewModelScope.launch {
            operationMutex.withLock {
                withContext(Dispatchers.IO) { runCatching { reader.stop() } }
            }
        }
    }

    override fun onCleared() {
        engine.stop()
        imager.close()
        sounder.release()
        super.onCleared()
    }

    private inline fun update(block: (SweepState) -> SweepState) {
        state.value = block(state.value)
    }

    companion object {
        /** Edge sync accepts at most this many consolidated EPCs per batch. */
        private const val MAX_OBSERVATIONS_PER_BATCH = 2_000
        private const val UPLOAD_RETRY_BASE_MS = 5_000L
        private const val UPLOAD_RETRY_MAX_MS = 60_000L
        private const val UPLOAD_BATCHES = 8
        private const val PUBLISH_MS = 200L
        private const val EVIDENCE_EVERY = 10
        private const val OUTBOX_KEEP_DAYS = 7
        /** Quick enough that a new SKU reaches the device within a publish cycle. */
        private const val CATALOG_POLL_MILLIS = 5_000L
        /** A minute of ordinary clock drift is not a reset RTC. */
        private const val CLOCK_SLACK_SECONDS = 60L

        /**
         * Finish is a person waiting. Four seconds to learn the node is not
         * there, not fifteen — the evidence is already on disk by the time this
         * call is made, so the only thing at stake is the mode's own action.
         */
        private const val COMMIT_CONNECT_MS = 4_000

        /**
         * How many different products a bench spreads its tags across. Enough
         * that the result list has rows to group, sort and scroll.
         */
        private const val MARRY_SPREAD = 60

        /** What `/store/receive-batch` accepts in one body. */
        private const val RECEIVE_CHUNK = 1_000

        /**
         * Who this app says is acting, when it cannot say who.
         *
         * The handheld holds an operator's bearer token and never learns the
         * name behind it; the node reads the operator from the token and
         * records that. So this is the same placeholder every other mode sends.
         */
        private const val ACTOR_ID = "handheld"

        /** The only session Tag Focus can work in. See [setGen2Extensions]. */
        private const val SESSION_FOR_TAG_FOCUS = 1

        /** Enough unnamed EPCs to see a pattern, few enough to read. */
        private const val FOREIGN_SAMPLE = 4

        /** Set once by the activity; the reader needs a Context to open the UART. */
        @Volatile var appContext: android.content.Context? = null
    }
}
