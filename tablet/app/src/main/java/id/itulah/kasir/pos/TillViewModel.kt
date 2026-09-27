package id.itulah.kasir.pos

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import id.itulah.kasir.core.Epc
import id.itulah.kasir.core.Perf
import id.itulah.kasir.data.Api
import id.itulah.kasir.data.ApiError
import id.itulah.kasir.data.CatalogRow
import id.itulah.kasir.data.Config
import id.itulah.kasir.data.ConfigStore
import id.itulah.kasir.data.Quote
import id.itulah.kasir.data.ReceiptDocument
import id.itulah.kasir.data.SaleResult
import id.itulah.kasir.data.ShiftReport
import id.itulah.kasir.data.Supervisor
import id.itulah.kasir.data.Tender
import id.itulah.kasir.data.PaymentMethod
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** One garment in the basket. Keyed by its tag, because that is what a unit is. */
data class BasketLine(
    val epc: String,
    val skuCode: String,
    val name: String,
    val unitPriceMinor: Long,
    val basePriceMinor: Long,
) {
    val isMarkedDown: Boolean get() = basePriceMinor > unitPriceMinor
}

/** A basket set aside. Named by when it was parked, which is how a counter
 *  refers to it: "the one from ten minutes ago". */
data class HeldBasket(val id: String, val lines: List<BasketLine>, val at: String)

/** Something to say to the cashier, and how loudly. */
data class Note(val bad: Boolean, val text: String)

data class ReaderState(
    val available: Boolean = false,
    val connected: Boolean = false,
    val scanning: Boolean = false,
    val power: Int? = null,
    /// Why it is not reading, in the reader's own words.
    ///
    /// Carried to the screen rather than logged, because "no reader" and "the
    /// module refused to open" are different problems with different people to
    /// call, and a counter that shows the same red dot for both sends everyone
    /// to look at the cable.
    val detail: String? = null,
)

data class TillState(
    val cashier: String = "",
    /// How many product names this till has learned so far.
    ///
    /// Not "is the book loaded" any more: there is no book. The till asks the
    /// node about the SKUs it actually meets and remembers the answers, so this
    /// climbs through a shift and never has to reach the size of the range.
    val namesKnown: Int = 0,
    /// A name search, answered by the node. Null when nobody has asked.
    val lookup: List<CatalogRow>? = null,
    val searching: Boolean = false,
    val lines: List<BasketLine> = emptyList(),
    /// The node's answer for the basket as it now stands, or null while the
    /// screen is showing its own preview. Never the source of the charge —
    /// that is whatever the sale returns.
    val quote: Quote? = null,
    val quoting: Boolean = false,
    val shift: ShiftReport? = null,
    val busy: Boolean = false,
    val note: Note? = null,
    val reader: ReaderState = ReaderState(),
    val lastSale: SaleResult? = null,
    val receipt: ReceiptDocument? = null,
    /// The node stopped believing this till is who it says it is.
    ///
    /// Surfaced as state rather than swallowed as one more red note, because
    /// every other thing on the screen is downstream of it: an expired session
    /// shows as an empty price book, a missing shift and a total that will not
    /// price — three separate-looking faults with one cause. A till that keeps
    /// taking scans on a dead session is a till that will fail at the moment
    /// money is taken, in front of the customer.
    val signedOut: Boolean = false,
    /// Baskets parked so the next customer can be served.
    ///
    /// Local, and deliberately so. A held basket is a list of tags nobody has
    /// paid for; putting it on the node would invent a transaction that does
    /// not exist, which is the server-side cart this till was built to avoid.
    /// It lives as long as the app does, which is as long as the shift.
    val held: List<HeldBasket> = emptyList(),
    /// Finance's payment methods (cloud Mode of Payment master), read at
    /// sign-in and whenever a shift opens. Starts as — and falls back to — the
    /// till's own four tiles, so a master that cannot be read never stops a sale.
    val paymentMethods: List<PaymentMethod> = PaymentMethod.FALLBACK,
) {
    /**
     * What the screen shows while the node has not answered yet.
     *
     * Summed from the resident book, which is a preview and says so: it knows
     * markdowns, because those are published prices, and it cannot know a
     * whole-basket promotion, because those are decided by the engine. The
     * cashier is never shown this as the figure to charge — the black button
     * asks the node first.
     */
    val previewMinor: Long get() = lines.sumOf { it.unitPriceMinor }

    /** The figure to show. The node's when it has spoken, ours until then. */
    val totalMinor: Long get() = quote?.totalMinor ?: previewMinor
}

/**
 * The counter, as a state machine.
 *
 * # Why the basket is local and the price is not
 *
 * Every tag scanned is added to a list in memory and drawn immediately — no
 * network on the path between a cashier waving a garment and seeing it appear,
 * because that path is walked forty times a minute and a round trip on shop
 * wifi is a fifth of a second. The authoritative price is asked for
 * **debounced**, after the scanning stops.
 *
 * That is the whole difference from `~/Documents/retail/pos-android`, which
 * posts `pos/txn/{id}/item` per garment: a ten-item basket there is ten round
 * trips and ten chances to leave a half-open transaction on a server. Here it
 * is one quote and one sale.
 */
class TillViewModel(private val api: Api, private val store: ConfigStore) : ViewModel() {

    private val _state = MutableStateFlow(TillState())
    val state: StateFlow<TillState> = _state.asStateFlow()

    private var quoteJob: Job? = null
    private var searchJob: Job? = null

    fun start(config: Config) {
        api.config = config
        // A fresh session clears the flag that sent the last one home. Without
        // this it stays true for the life of the process: the till signs in
        // again, works, and then never notices the *next* expiry, because the
        // effect watching it sees no change.
        _state.update {
            it.copy(cashier = config.cashier, namesKnown = names.size, signedOut = false)
        }
        viewModelScope.launch {
            withContext(Dispatchers.IO) { api.warm() }
            refreshShift()
            refreshPaymentMethods()
        }
    }

    /**
     * Ask the node for Finance's payment methods. A failure, or an answer with
     * nothing the till can take, keeps whatever is shown now — the last good
     * list, or the built-in fallback — and is only logged.
     */
    fun refreshPaymentMethods() {
        viewModelScope.launch {
            val outcome = runCatching { withContext(Dispatchers.IO) { api.paymentMethods() } }
            val usable = outcome.getOrNull()?.let { PaymentMethod.forTill(it) }
            if (usable == null) {
                android.util.Log.w(
                    Perf.TAG,
                    "payment methods unavailable (${outcome.exceptionOrNull()?.message ?: "empty list"}); keeping current list",
                )
                return@launch
            }
            _state.update { it.copy(paymentMethods = usable) }
        }
    }

    // ── What things are ────────────────────────────────────────────────

    /**
     * Names this till has learned, kept for the life of the process.
     *
     * A shop sells the same garments over and over, so the second customer of
     * the morning holding the same shirt costs nothing. Bounded because a till
     * runs all day: at 4,000 entries the oldest are dropped, which is still far
     * more than a counter meets in a shift and a fraction of a 100,000-SKU
     * range.
     */
    private val names = object : LinkedHashMap<String, CatalogRow>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, CatalogRow>) =
            size > NAME_CACHE
    }

    /**
     * Learn the names of whatever is in the basket but not yet known.
     *
     * One request for the whole basket, not one per garment, and only for the
     * SKUs this till has never met. Runs alongside the quote rather than before
     * it: what a thing costs and what it is called are different questions with
     * different authorities, and the money must not wait on the label.
     */
    private suspend fun learnNames(skus: Collection<String>) {
        val unknown = skus.filterNot { names.containsKey(it) }.distinct()
        if (unknown.isEmpty()) return
        val started = android.os.SystemClock.elapsedRealtime()
        val rows = runCatching { withContext(Dispatchers.IO) { api.identities(unknown) } }
            .onFailure(::noticeAuth)
            .getOrElse { return }
        rows.forEach { names[it.skuCode] = it }
        Perf.mark("names", android.os.SystemClock.elapsedRealtime() - started, "${unknown.size} sku")
        _state.update { current ->
            current.copy(
                namesKnown = names.size,
                lines = current.lines.map { line ->
                    names[line.skuCode]?.let { line.copy(name = it.name) } ?: line
                },
            )
        }
    }

    /** Find a garment at the node. The range does not fit here and need not. */
    fun search(needle: String) {
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            _state.update { it.copy(searching = true) }
            val started = android.os.SystemClock.elapsedRealtime()
            val rows = runCatching { withContext(Dispatchers.IO) { api.search(needle) } }
                .onFailure(::noticeAuth)
                .getOrDefault(emptyList())
            Perf.mark("search", android.os.SystemClock.elapsedRealtime() - started, needle)
            _state.update { it.copy(lookup = rows, searching = false) }
        }
    }

    fun clearLookup() = _state.update { it.copy(lookup = null) }

    // ── Scanning ────────────────────────────────────────────────────────

    /**
     * One code, from wherever it came.
     *
     * The antenna and the wedge keyboard land here together, so there is one
     * place that decides what a code means and one place that refuses a tag
     * already in the basket. An EPC is a unit and can be sold; a barcode names
     * a product, and the shop has forty of that shirt — so it answers "how much
     * is this" and cannot go into a basket.
     */
    fun scan(raw: String) = Perf.time("scan") {
        val value = raw.trim().uppercase()
        if (value.isEmpty()) return@time

        val parts = Epc.decode(value)
        if (parts != null) {
            addTag(value, parts.skuCode)
            return@time
        }

        // Not a tag. A barcode or a name identifies a *product*, and the shop
        // has forty of that shirt — so it answers "how much is this" and can
        // never go into a basket. Answered by the node, because the range does
        // not live here.
        search(value.removePrefix("R1:").removePrefix("8"))
    }

    private fun addTag(epc: String, skuCode: String) {
        val current = _state.value
        if (current.lines.any { it.epc == epc }) {
            // Not an error the cashier caused: with a pad reader the same tag
            // is re-read many times a second, and the sled has already filtered
            // its own batch. Saying nothing is right here.
            return
        }
        val known = names[skuCode]
        val line = BasketLine(
            epc = epc,
            skuCode = skuCode,
            name = known?.name ?: "SKU $skuCode",
            // Zero until the node answers. Deliberately not filled from any
            // local figure: the only price this till may show is the one the
            // engine returns, and the line renders "…" rather than a number it
            // guessed.
            unitPriceMinor = 0,
            basePriceMinor = 0,
        )
        _state.update { it.copy(lines = it.lines + line, quote = null, note = null) }
        scheduleQuote()
    }

    fun remove(epc: String) {
        _state.update { it.copy(lines = it.lines.filterNot { line -> line.epc == epc }, quote = null) }
        scheduleQuote()
    }

    /** Park the basket and clear the counter for the next customer. */
    fun hold() {
        val current = _state.value
        if (current.lines.isEmpty()) return
        val stamp = java.text.SimpleDateFormat("HH:mm", java.util.Locale.ROOT)
            .format(java.util.Date())
        quoteJob?.cancel()
        _state.update {
            it.copy(
                held = it.held + HeldBasket(Api.key(), it.lines, stamp),
                lines = emptyList(),
                quote = null,
                note = Note(false, "Keranjang ditahan ($stamp)"),
            )
        }
    }

    /**
     * Bring a parked basket back.
     *
     * Whatever is on the counter now is parked in its place rather than thrown
     * away — a cashier who resumes the wrong one has not lost the right one.
     */
    fun resume(id: String) {
        val current = _state.value
        val basket = current.held.firstOrNull { it.id == id } ?: return
        val stamp = java.text.SimpleDateFormat("HH:mm", java.util.Locale.ROOT)
            .format(java.util.Date())
        _state.update {
            it.copy(
                lines = basket.lines,
                quote = null,
                held = it.held.filterNot { held -> held.id == id } +
                    if (current.lines.isEmpty()) emptyList()
                    else listOf(HeldBasket(Api.key(), current.lines, stamp)),
            )
        }
        scheduleQuote()
    }

    fun dropHeld(id: String) =
        _state.update { it.copy(held = it.held.filterNot { held -> held.id == id }) }

    fun clear() {
        quoteJob?.cancel()
        _state.update { it.copy(lines = emptyList(), quote = null, note = null) }
    }

    /**
     * Ask the node what this basket costs, once the scanning has paused.
     *
     * A cashier waving six garments over a pad produces six state changes in
     * under a second. Quoting each one would be six round trips whose first
     * five answers are already wrong by the time they land, and on a busy
     * evening they queue behind each other. So the ask is debounced and the
     * previous one is cancelled outright.
     */
    private fun scheduleQuote() {
        quoteJob?.cancel()
        if (_state.value.lines.isEmpty()) {
            _state.update { it.copy(quoting = false) }
            return
        }
        quoteJob = viewModelScope.launch {
            delay(QUOTE_DEBOUNCE_MS)
            val epcs = _state.value.lines.map { it.epc }
            _state.update { it.copy(quoting = true) }
            val skus = _state.value.lines.map { it.skuCode }
            // Names and money asked for together, so a basket costs one pause
            // rather than two.
            val naming = launch { learnNames(skus) }
            val asked = android.os.SystemClock.elapsedRealtime()
            val quoted = runCatching {
                withContext(Dispatchers.IO) { api.quote(epcs, emptyList(), null) }
            }
            Perf.mark("quote", android.os.SystemClock.elapsedRealtime() - asked, "${epcs.size} unit")
            naming.join()
            // The basket may have moved on while this was in flight. Answering
            // a basket that no longer exists would put a total on screen that
            // belongs to nothing.
            if (_state.value.lines.map { it.epc } != epcs) return@launch
            _state.update { current ->
                quoted.fold(
                    onSuccess = { quote ->
                        // The engine's per-SKU answer is what a line shows.
                        // Nothing else is allowed to: a line priced from a
                        // local table is how a counter ends up disagreeing
                        // with its own receipt.
                        val priced = quote.lines.associateBy { it.skuCode }
                        current.copy(
                            quote = quote,
                            quoting = false,
                            lines = current.lines.map { line ->
                                priced[line.skuCode]?.let {
                                    line.copy(
                                        unitPriceMinor = it.unitPriceMinor,
                                        basePriceMinor = it.basePriceMinor,
                                    )
                                } ?: line
                            },
                        )
                    },
                    onFailure = { error ->
                        noticeAuth(error)
                        current.copy(
                            quoting = false,
                            // Not fatal: the preview stands, and the sale will
                            // be priced by the node anyway. Said quietly so a
                            // cashier is not stopped by a network blip.
                            note = Note(true, "Harga resmi belum terjawab: ${reason(error)}"),
                        )
                    },
                )
            }
        }
    }

    // ── Money ───────────────────────────────────────────────────────────

    /**
     * Take the money.
     *
     * The idempotency key is minted here, where the intent is formed, and held
     * across retries — a till that generated a fresh key on retry would sell
     * the same garments twice the first time a socket timed out after the node
     * had already written the sale.
     */
    fun sell(tenders: List<Tender>, onDone: (SaleResult) -> Unit) {
        val current = _state.value
        if (current.lines.isEmpty() || current.busy) return
        val epcs = current.lines.map { it.epc }
        val idempotency = Api.key()
        _state.update { it.copy(busy = true, note = null) }
        viewModelScope.launch {
            val rang = android.os.SystemClock.elapsedRealtime()
            var result = runCatching {
                withContext(Dispatchers.IO) { api.sale(epcs, tenders, emptyList(), null, idempotency) }
            }

            // Sold from the stockroom.
            //
            // The node refuses a unit that is not on the shop floor. That is
            // not an exception at a counter — somebody fetched it from the
            // back — and by ruling it needs no supervisor. So the till files
            // the movement that actually happened and asks again, ONCE, with
            // the same idempotency key: a retry that minted a fresh key would
            // sell the garments twice the first time a socket timed out after
            // the node had already written the sale.
            val refusal = result.exceptionOrNull() as? ApiError
            if (refusal?.status == 409 && refusal.message?.contains("floor") == true) {
                val laid = withContext(Dispatchers.IO) {
                    epcs.count { api.layOnFloor(it, siteOf(_state.value)) }
                }
                if (laid > 0) {
                    _state.update { it.copy(note = Note(false, "$laid barang digelar dari gudang")) }
                    result = runCatching {
                        withContext(Dispatchers.IO) {
                            api.sale(epcs, tenders, emptyList(), null, idempotency)
                        }
                    }
                }
            }
            Perf.mark("sale", android.os.SystemClock.elapsedRealtime() - rang, "${epcs.size} unit")
            result.fold(
                onSuccess = { sale ->
                    _state.update {
                        it.copy(busy = false, lines = emptyList(), quote = null, lastSale = sale, note = null)
                    }
                    refreshShift()
                    onDone(sale)
                },
                onFailure = { error ->
                    noticeAuth(error)
                    _state.update { it.copy(busy = false, note = Note(true, reason(error))) }
                },
            )
        }
    }

    // ── The drawer ──────────────────────────────────────────────────────

    fun refreshShift() {
        viewModelScope.launch {
            val outcome = runCatching { withContext(Dispatchers.IO) { api.activeShift() } }
            outcome.exceptionOrNull()?.let(::noticeAuth)
            _state.update { it.copy(shift = outcome.getOrNull()) }
        }
    }

    fun openShift(floatMinor: Long, onDone: () -> Unit = {}) = run("membuka shift") {
        val shift = api.openShift(floatMinor)
        _state.update { it.copy(shift = shift) }
        refreshPaymentMethods()
        onDone()
    }

    fun cashMovement(kind: String, amountMinor: Long, reason: String, supervisor: Supervisor?) =
        run("mencatat kas") {
            val shift = _state.value.shift ?: throw ApiError("belum ada shift terbuka")
            api.cashMovement(shift.shiftId, kind, amountMinor, reason, supervisor)
            _state.update { it.copy(shift = api.shiftReport(shift.shiftId)) }
        }

    fun closeShift(declaredMinor: Long, note: String?, onDone: (ShiftReport) -> Unit) =
        run("menutup shift") {
            val shift = _state.value.shift ?: throw ApiError("belum ada shift terbuka")
            val closed = api.closeShift(shift.shiftId, declaredMinor, note)
            _state.update { it.copy(shift = null) }
            onDone(closed)
        }

    // ── The paper ───────────────────────────────────────────────────────

    fun loadReceipt(saleId: String) = run("mengambil struk") {
        _state.update { it.copy(receipt = api.receipt(saleId)) }
    }

    fun printReceipt(saleId: String, copy: Boolean) = run("mencetak struk") {
        api.printReceipt(saleId, copy)
        _state.update { it.copy(note = Note(false, if (copy) "Salinan tercetak" else "Struk tercetak")) }
    }

    // ── Reversals ───────────────────────────────────────────────────────

    fun voidSale(saleId: String, reason: String, supervisor: Supervisor, onDone: () -> Unit) =
        run("membatalkan penjualan") {
            api.voidSale(saleId, reason, supervisor)
            refreshShift()
            onDone()
        }

    fun returnSale(
        saleId: String,
        lines: List<id.itulah.kasir.data.ReturnLine>,
        refundMethod: String,
        reason: String,
        supervisor: Supervisor,
        onDone: () -> Unit,
    ) = run("memproses retur") {
        api.returnSale(saleId, lines, refundMethod, reason, supervisor)
        refreshShift()
        onDone()
    }

    // ── The reader ──────────────────────────────────────────────────────

    fun readerStatus(
        connected: Boolean,
        scanning: Boolean,
        power: Int?,
        available: Boolean,
        detail: String? = null,
    ) {
        _state.update {
            it.copy(
                reader = ReaderState(
                    available, connected, scanning, power ?: it.reader.power, detail,
                ),
            )
        }
    }

    fun dismissNote() = _state.update { it.copy(note = null) }

    fun say(note: Note?) = _state.update { it.copy(note = note) }

    private fun run(what: String, block: suspend () -> Unit): Job {
        _state.update { it.copy(busy = true) }
        return viewModelScope.launch {
            runCatching { withContext(Dispatchers.IO) { block() } }
                .fold(
                    onSuccess = { _state.update { it.copy(busy = false) } },
                    onFailure = { error ->
                        noticeAuth(error)
                        _state.update { it.copy(busy = false, note = Note(true, "Gagal $what: ${reason(error)}")) }
                    },
                )
        }
    }

    /**
     * Which shop this till stands in, as the pool names spell it.
     *
     * Read off the shift rather than configured twice: the terminal already
     * belongs to a site, and a second copy of that fact is a second thing that
     * can be wrong.
     */
    private fun siteOf(state: TillState): String =
        state.shift?.terminalId?.substringBefore('.')?.takeIf { it.startsWith("store") }
            ?: DEFAULT_SITE

    private fun reason(error: Throwable): String =
        error.message?.takeIf { it.isNotBlank() } ?: error::class.java.simpleName

    /**
     * Notice a session that has stopped being one.
     *
     * Any 401 from any call means the same thing and has the same answer: send
     * the cashier back to the sign-in screen. Checked in one place so a new
     * endpoint cannot forget to.
     */
    private fun noticeAuth(error: Throwable) {
        if ((error as? ApiError)?.status == 401) {
            _state.update { it.copy(signedOut = true) }
        }
    }

    private companion object {
        /**
         * How long the scanning has to stop before the node is asked.
         *
         * Long enough that a burst of tags from a pad is one question, short
         * enough that a cashier who scans one thing and reaches for the card
         * machine already has the real total. Measured against the sled: a
         * six-garment sweep lands inside 400ms.
         */
        const val QUOTE_DEBOUNCE_MS = 250L

        /** Names held at once. A shift meets a few hundred; this is headroom. */
        const val NAME_CACHE = 4_000

        /** Used only until a shift names the site. Dev nodes are store-07. */
        const val DEFAULT_SITE = "store-07"
    }
}
