package id.itulah.kasir.pos

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import id.itulah.kasir.core.Epc
import id.itulah.kasir.core.Perf
import id.itulah.kasir.data.Api
import id.itulah.kasir.data.ApiError
import id.itulah.kasir.data.BenefitHolder
import id.itulah.kasir.data.CatalogRow
import id.itulah.kasir.data.Config
import id.itulah.kasir.data.ConfigStore
import id.itulah.kasir.data.NO_SALE_ID
import id.itulah.kasir.data.Outbox
import id.itulah.kasir.data.OutboxEntry
import id.itulah.kasir.data.OutboxView
import id.itulah.kasir.data.SaleDraft
import id.itulah.kasir.data.skuDisplay
import id.itulah.kasir.data.Quote
import id.itulah.kasir.data.ReceiptDocument
import id.itulah.kasir.data.SaleResult
import id.itulah.kasir.data.ShiftReport
import id.itulah.kasir.data.Supervisor
import id.itulah.kasir.data.Tender
import id.itulah.kasir.data.PaymentMethod
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

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
    /// The site this node owns, as the node's own identity named it. Null
    /// until the node has answered; a null site files no floor movement.
    val site: String? = null,
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
    /// Benefit balance already spent against this basket, not yet sold. Held
    /// here so leaving the payment screen cannot lose track of money that has
    /// left the employee's balance.
    val benefit: BenefitHold? = null,
    /// The outbox as the screens read it: what is owed, what the node refused,
    /// and whether the disk is keeping it. Fed from the outbox itself, so a sale
    /// that lands (or is refused) late changes the screen without anyone asking.
    val outbox: OutboxView = OutboxView(),
    /// The sale just rung at this counter, by its outbox name: what the receipt
    /// screen is about. Null once the cashier has moved on, and when that screen
    /// was opened for the last receipt instead.
    val rungId: String? = null,
    /// The sale in [rungId] is on its first attempt at the node. Until that
    /// attempt answers, or has had its few seconds, the screen says "sending"
    /// rather than "saved here" — so the ordinary case never flashes a worry.
    val settlingId: String? = null,
) {
    /** The sale just rung, as the outbox now holds it. */
    val rungEntry: OutboxEntry? get() = rungId?.let { id -> outbox.entries.firstOrNull { it.localId == id } }

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
/** Rupiah spent from an employee's benefit balance for the basket whose sale_ref this is. */
data class BenefitHold(val saleRef: String, val amountMinor: Long)

class TillViewModel(
    private val api: Api,
    private val store: ConfigStore,
    private val outbox: Outbox,
) : ViewModel() {

    private val _state = MutableStateFlow(TillState(outbox = outbox.view.value))
    val state: StateFlow<TillState> = _state.asStateFlow()

    private var quoteJob: Job? = null
    private var searchJob: Job? = null

    /// One pass over the outbox at a time. A caller that asks while a pass is
    /// running waits its turn rather than joining it, so no sale is ever sent by
    /// two passes at once.
    private val flushLock = Mutex()

    /// A sale is being written down. Separate from `busy`, which other work
    /// (a receipt, a print) also sets and clears: this is the one flag that
    /// stands between a double tap and two sales.
    private var ringing = false

    init {
        viewModelScope.launch {
            outbox.view.collect { view -> _state.update { it.copy(outbox = view) } }
        }
        // Every 15 s, while anything is owed. A tick that finds a pass already
        // running does nothing: a node that answers slowly must not collect a
        // line of passes behind it.
        viewModelScope.launch {
            while (true) {
                delay(PUMP_MS)
                if (outbox.view.value.unsent > 0 && !flushLock.isLocked) flush()
            }
        }
    }

    fun start(config: Config) {
        api.config = config
        // A fresh session clears the flag that sent the last one home. Without
        // this it stays true for the life of the process: the till signs in
        // again, works, and then never notices the *next* expiry, because the
        // effect watching it sees no change.
        _state.update {
            it.copy(
                cashier = config.cashier,
                namesKnown = names.size,
                signedOut = false,
                site = config.siteId.takeIf { id -> id.isNotBlank() },
            )
        }
        viewModelScope.launch {
            withContext(Dispatchers.IO) { api.warm() }
            rememberSite()
            refreshShift()
            refreshPaymentMethods()
            // Whatever was rung and not sent before the app last stopped, or
            // before the session lapsed.
            flush()
        }
    }

    /**
     * Learn which shop this node owns, from the node itself.
     *
     * Persisted so a later start that cannot reach the node still knows, and
     * refreshed every start in case the tablet was re-pointed. A failure keeps
     * whatever is already known; a till that has never been told files no
     * floor movement rather than a guessed one.
     */
    private suspend fun rememberSite() {
        val answer = runCatching {
            withContext(Dispatchers.IO) { api.nodeIdentity() }
        }.getOrNull() ?: return
        val site = answer.optString("site_id").takeIf { it.isNotBlank() } ?: return
        store.saveSite(site)
        _state.update { it.copy(site = site) }
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
            name = known?.name ?: "SKU ${skuDisplay(skuCode)}",
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
        releaseBenefit()
        _state.update { it.copy(lines = emptyList(), quote = null, note = null) }
    }

    // ── Employee benefit balance ────────────────────────────────────────

    /// The sale_ref for this basket: minted once, kept until the basket is sold
    /// or its benefit spend is given back. The node allows one spend per ref,
    /// so a retry of the same spend is safe and a new basket gets a new one.
    private var basketRef: String? = null
    private fun saleRef(): String = basketRef ?: Api.key().also { basketRef = it }

    /// "Pusat tidak terjangkau" for anything that is not the node answering no.
    private fun benefitReason(error: Throwable): String {
        val status = (error as? ApiError)?.status
        return if (error !is ApiError || status == 0 || (status != null && status >= 500))
            "Pusat tidak terjangkau — pakai cara bayar lain."
        else reason(error)
    }

    fun benefitLookup(code: String, onDone: (Result<BenefitHolder>) -> Unit) {
        viewModelScope.launch {
            val outcome = runCatching { withContext(Dispatchers.IO) { api.benefitLookup(code) } }
            outcome.exceptionOrNull()?.let(::noticeAuth)
            onDone(outcome.mapFailure { ApiError(benefitReason(it)) })
        }
    }

    fun benefitSpend(code: String, amountMinor: Long, onDone: (Result<BenefitHolder>, String) -> Unit) {
        val promo = _state.value.quote?.promotions?.any { it.applied } == true
        val ref = saleRef()
        viewModelScope.launch {
            val outcome = runCatching {
                withContext(Dispatchers.IO) { api.benefitSpend(code, ref, amountMinor, promo) }
            }
            outcome.exceptionOrNull()?.let(::noticeAuth)
            outcome.onSuccess { _state.update { it.copy(benefit = BenefitHold(ref, amountMinor)) } }
            onDone(outcome.mapFailure { ApiError(benefitReason(it)) }, ref)
        }
    }

    /// Give the spent balance back (tender removed, or the payment abandoned).
    /// If head office cannot be reached the hold stays, so it is not forgotten.
    fun releaseBenefit(onDone: (Boolean) -> Unit = {}) {
        val hold = _state.value.benefit ?: return onDone(true)
        viewModelScope.launch {
            val outcome = runCatching {
                withContext(Dispatchers.IO) { api.benefitReturn(hold.saleRef, hold.amountMinor, "dibatalkan di kasir") }
            }
            outcome.fold(
                onSuccess = {
                    // The ref is spent; a later spend on this basket needs a new one.
                    basketRef = null
                    _state.update { it.copy(benefit = null) }
                    onDone(true)
                },
                onFailure = { error ->
                    noticeAuth(error)
                    _state.update {
                        it.copy(note = Note(true, "Saldo karyawan belum kembali: ${benefitReason(error)}"))
                    }
                    onDone(false)
                },
            )
        }
    }

    /// Return money to the balance for a sold basket; the ref comes off the receipt.
    fun benefitRefund(saleRef: String, amountMinor: Long, onDone: (Result<Unit>) -> Unit) {
        viewModelScope.launch {
            val outcome = runCatching {
                withContext(Dispatchers.IO) { api.benefitReturn(saleRef, amountMinor, "retur"); Unit }
            }
            outcome.exceptionOrNull()?.let(::noticeAuth)
            onDone(outcome.mapFailure { ApiError(benefitReason(it)) })
        }
    }

    private inline fun <T> Result<T>.mapFailure(map: (Throwable) -> Throwable): Result<T> =
        exceptionOrNull()?.let { Result.failure(map(it)) } ?: this

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
     * The sale is written down first, with its idempotency key, and only then is
     * anything sent (see [Outbox]). Between "the cashier pressed Pay" and "the
     * node answered" the cash is already in the till and the garment in the
     * customer's bag: if the wifi drops there, the sale has to exist somewhere
     * that survives this app being killed. So the basket clears the moment the
     * write is done, the cashier is on the receipt screen at once, and getting
     * the sale to the node is the outbox's job from there — see [flush].
     *
     * [onSaved] is called as soon as the sale is on this tablet, not when the
     * node has it. The first attempt then has [FIRST_ATTEMPT_MS] to answer, so
     * the ordinary case still ends in a receipt that prints, and a node that is
     * slow does not hold the counter: after that the screen says "Tersimpan di
     * kasir ini" and the pump keeps trying.
     */
    fun sell(tenders: List<Tender>, autoPrint: Boolean, onSaved: () -> Unit) {
        val current = _state.value
        if (current.lines.isEmpty() || current.busy || ringing) return
        // The node prices the sale. A till that has not heard that price must not
        // write down money it cannot name: that would be a sale the node refuses
        // and a record kept for ever. A node that goes quiet AFTER pricing is the
        // case the outbox exists for, and gets through here.
        val quote = current.quote
        if (quote == null || !quote.hasPriceBook) {
            _state.update {
                it.copy(note = Note(true, "Harga resmi belum terjawab — tunggu sebentar, lalu bayar lagi."))
            }
            return
        }
        val total = current.totalMinor
        val draft = SaleDraft(
            epcs = current.lines.map { it.epc },
            tenders = tenders,
            // Who rang it, as it stands now: a sale sent after a sign-out is
            // still this person's.
            actorId = api.config.cashier,
            quotedTotalMinor = total,
            changeMinor = changeOf(tenders, total),
        )
        ringing = true
        _state.update { it.copy(busy = true, note = null) }
        viewModelScope.launch {
            val saved = try {
                withContext(Dispatchers.IO) { runCatching { outbox.enqueue(draft) } }
            } finally {
                ringing = false
            }
            val written = saved.getOrNull()
            if (written == null) {
                // Not written, so not sold: the basket stays and nothing was
                // sent. Said where the cashier is looking, in the payment dialog.
                val why = saved.exceptionOrNull()?.let { reason(it) } ?: "tidak diketahui"
                _state.update {
                    it.copy(
                        busy = false,
                        note = Note(
                            true,
                            "Penjualan belum tercatat di kasir ini, jadi belum dikirim ($why). " +
                                "Keranjang tetap — coba bayar lagi.",
                        ),
                    )
                }
                return@launch
            }

            // From here the sale exists. The balance spent on it travels in its
            // tenders, so nothing is given back if this screen is closed.
            val id = written.entry.localId
            quoteJob?.cancel()
            basketRef = null
            _state.update {
                it.copy(
                    busy = false, lines = emptyList(), quote = null, quoting = false,
                    benefit = null, rungId = id, settlingId = id,
                    // Not left to the collector: the receipt screen opens on the
                    // next line and looks the sale up here.
                    outbox = outbox.view.value,
                    // The disk said no. The sale is safe in memory and will go
                    // out now if it can; what is lost is surviving a restart,
                    // and the cashier is told so rather than left to find out.
                    note = if (written.durable) null else Note(
                        true,
                        "Penjualan belum tersimpan di penyimpanan kasir — jangan matikan " +
                            "aplikasi sampai terkirim.",
                    ),
                )
            }
            onSaved()

            val first = viewModelScope.async { flush() }
            withTimeoutOrNull(FIRST_ATTEMPT_MS) { first.await() }
            _state.update { if (it.settlingId == id) it.copy(settlingId = null) else it }

            // The paper only when the node has named the sale, and only for the
            // attempt the cashier waited on: a sale that lands minutes later
            // must not pop the drawer in front of the next customer.
            val named = outbox.entry(id)?.saleId
            if (autoPrint && named != null && named != NO_SALE_ID) printReceipt(named, copy = false)
        }
    }

    /**
     * Cash to hand back, worked the way the payment dialog works it: change
     * comes out of the cash tendered, and only after the non-cash has covered
     * what it covers. The node's figure replaces this on the receipt.
     */
    private fun changeOf(tenders: List<Tender>, totalMinor: Long): Long {
        val cash = tenders.filter { it.method == "CASH" }.sumOf { it.amountMinor }
        val rest = tenders.sumOf { it.amountMinor } - cash
        return (cash - (totalMinor - rest).coerceAtLeast(0)).coerceAtLeast(0)
    }

    /** The receipt screen is no longer about the sale just rung. */
    fun forgetRung() = _state.update { it.copy(rungId = null, settlingId = null) }

    // ── The outbox ──────────────────────────────────────────────────────

    /** Send what is owed, if anything is, without anyone waiting for it. */
    fun flushNow() {
        if (outbox.view.value.unsent == 0) return
        viewModelScope.launch { flush() }
    }

    /**
     * One pass over everything owed: oldest first, one at a time, each under the
     * key it was rung with.
     *
     * A pass is queued behind one already running, not beside it. In order,
     * because a day's takings read back in the order they were rung is a day a
     * manager can follow; one at a time, because the node behind the counter is
     * a single writer. It never throws: whatever goes wrong inside it is the
     * sale's problem, written on the sale, and the sale stays.
     */
    private suspend fun flush() {
        withContext(Dispatchers.IO) {
            flushLock.withLock {
                try {
                    pass()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    android.util.Log.w(Perf.TAG, "outbox pass failed: ${e.message}")
                }
            }
        }
    }

    private sealed interface Verdict {
        /** The node took it. */
        data class Taken(val sale: SaleResult) : Verdict

        /** The node read it and said no, in these words. It will say the same tomorrow. */
        data class Refused(val words: String) : Verdict

        /** Nobody can say whether it landed, or the node is not ready for it. */
        data class Silent(val words: String) : Verdict
    }

    private suspend fun pass() {
        // No session, nothing to send it with. The sale waits, and goes the
        // moment somebody signs in (`start`).
        if (api.config.token.isBlank()) return
        var took = false
        try {
            while (true) {
                val next = outbox.nextOwed() ?: return
                val asked = android.os.SystemClock.elapsedRealtime()
                val verdict = deliver(next)
                Perf.mark("sale", android.os.SystemClock.elapsedRealtime() - asked, "${next.epcs.size} unit")
                when (verdict) {
                    is Verdict.Taken -> {
                        took = true
                        // Told to the screens first, then to the outbox: the
                        // receipt screen flips to "done" the moment the outbox
                        // says so, and must find the sale already here. A kill
                        // in between only means the same key is sent again.
                        taken(next, verdict.sale)
                        outbox.accept(next.localId, verdict.sale.saleId)
                    }
                    // This sale's answer, written down. The pass carries on: a
                    // refusal of one says nothing about the next.
                    is Verdict.Refused -> outbox.refuse(next.localId, verdict.words)
                    // If the node cannot be reached for this sale it cannot be
                    // reached for the next, and forty attempts against a
                    // rebooting switch only cost a battery. Stop; the pump comes
                    // back in 15 s.
                    is Verdict.Silent -> {
                        outbox.defer(next.localId, verdict.words)
                        return
                    }
                }
            }
        } finally {
            if (took) refreshShift()
        }
    }

    /**
     * One sale, delivered or not.
     *
     * # Sold from the stockroom
     *
     * The node refuses a unit that is not on the shop floor. That is not an
     * exception at a counter — somebody fetched it from the back — and by ruling
     * it needs no supervisor. So the till files the movement that actually
     * happened and asks again, ONCE, with the SAME idempotency key: a retry that
     * minted a fresh key would sell the garments twice the first time a socket
     * timed out after the node had already written the sale. It works the same
     * for a sale that has been waiting in the outbox since the wifi dropped.
     */
    private suspend fun deliver(entry: OutboxEntry): Verdict {
        var result = attempt(entry)

        val refusal = result.exceptionOrNull() as? ApiError
        if (refusal?.status == 409 && refusal.message?.contains("floor") == true) {
            if (siteOf(_state.value) == null) rememberSite()
            val site = siteOf(_state.value)
            if (site == null) {
                // The node has not said which shop this is. Moving stock anyway
                // would file it against somebody else's floor. Not a refusal of
                // the sale — the sale stays owed and is asked again once the
                // node has answered who it is.
                return Verdict.Silent(
                    "Node belum menyebut sitenya — gudangkan ulang dan coba lagi " +
                        "setelah koneksi ke node tersedia",
                )
            }
            val laid = entry.epcs.count { api.layOnFloor(it, site) }
            if (laid > 0) {
                _state.update { it.copy(note = Note(false, "$laid barang digelar dari gudang")) }
                result = attempt(entry)
            }
        }
        return verdictOf(result)
    }

    /** One attempt, under the key this sale was rung with. */
    private fun attempt(entry: OutboxEntry): Result<SaleResult> = runCatching {
        api.sale(
            entry.epcs, entry.tenders, entry.couponCodes, entry.customerId,
            entry.idempotencyKey, entry.actorId, entry.takenAt,
        )
    }

    /**
     * Whether this was the node answering *about this sale*.
     *
     * A 4xx it reasoned about — a tag it has never seen, tenders that do not
     * cover the basket — is a verdict, and retrying only buries the sentence a
     * person needs to read. Three are not verdicts and are excluded on purpose:
     * 401 is a lapsed session (the sale is perfectly good, the tablet has to
     * sign in again — and throwing away takings because a token expired would be
     * the worst failure on this list); 408 and 429 are the node saying "not now"
     * without having looked at the sale. Everything from 500 up is the node
     * broken rather than the node judging.
     */
    private fun verdictOf(result: Result<SaleResult>): Verdict {
        result.getOrNull()?.let { return Verdict.Taken(it) }
        val error = result.exceptionOrNull() ?: return Verdict.Silent("Server toko belum menjawab.")
        noticeAuth(error)
        val status = (error as? ApiError)?.status ?: 0
        return when {
            status in 400..499 && status != 401 && status != 408 && status != 429 ->
                Verdict.Refused(reason(error))
            status == 401 -> Verdict.Silent("Sesi habis — masuk lagi, penjualan ini akan terkirim.")
            error is ApiError && status != 0 ->
                Verdict.Silent("Server toko belum menerima (HTTP $status): ${reason(error)}")
            else -> Verdict.Silent("Server toko belum menjawab: ${reason(error)}")
        }
    }

    /** The node has this sale: it becomes the last sale, and the screen waiting on it reads its receipt. */
    private fun taken(entry: OutboxEntry, sale: SaleResult) {
        // A 2xx that named nothing is accepted (the outbox stops sending it) but
        // there is nothing to read a receipt or a void against.
        if (sale.saleId.isBlank()) return
        _state.update { it.copy(lastSale = sale) }
        if (_state.value.rungId == entry.localId) loadReceipt(sale.saleId)
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
            // A sale the node has not acknowledged belongs to this drawer, and
            // closing fixes what the drawer should hold. Closed first, it would
            // arrive afterwards as cash nobody counted. The shift screen does not
            // offer the button either; this is the lock behind that door.
            val out = outbox.view.value
            if (out.unsent > 0) {
                throw ApiError("${out.unsent} penjualan belum terkirim ke server toko")
            }
            // A refused sale does not block: see `CloseShift` for why.
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
     * Which shop this till stands in, as the node itself named it.
     *
     * Learned from the node's identity at start, not inferred from a terminal
     * id: a name that does not spell its shop used to fall through to a
     * default and file a floor movement against whichever shop that default
     * named. Null means unknown, and unknown files nothing.
     */
    private fun siteOf(state: TillState): String? =
        state.site?.takeIf { it.isNotBlank() }

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

        /** How often the outbox is tried again while anything is owed. */
        const val PUMP_MS = 15_000L

        /**
         * How long the cashier waits for the node to take a sale just rung.
         * Long enough that an ordinary answer (and a stockroom tag moved to the
         * floor on the way) still lands on the receipt that prints; short enough
         * that a node that hangs does not hold a customer at the counter. The
         * sale is already safe on this tablet, so nothing depends on the wait.
         */
        const val FIRST_ATTEMPT_MS = 5_000L
    }
}
