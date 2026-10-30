package id.itulah.kasir

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.focus.FocusRequester
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import id.itulah.kasir.core.UsbReader
import id.itulah.kasir.data.Api
import id.itulah.kasir.data.Config
import id.itulah.kasir.data.ConfigStore
import id.itulah.kasir.data.Outbox
import id.itulah.kasir.data.skuDisplay
import id.itulah.kasir.pos.TillViewModel
import id.itulah.kasir.ui.DeskScreen
import id.itulah.kasir.ui.ItulahTheme
import id.itulah.kasir.ui.LoginScreen
import id.itulah.kasir.ui.ReceiptScreen
import id.itulah.kasir.ui.ReturnScreen
import id.itulah.kasir.ui.ReturningLine
import id.itulah.kasir.ui.SupervisorSheet
import id.itulah.kasir.ui.SetupScreen
import id.itulah.kasir.ui.ShiftScreen
import id.itulah.kasir.ui.Shell
import id.itulah.kasir.ui.TillStatus
import id.itulah.kasir.ui.TenderScreen
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * The till.
 *
 * One Activity and five destinations, because a counter is not a website: a
 * cashier is on the desk, and everything else is somewhere they went and are
 * coming straight back from. Navigation is a `when` over an enum rather than a
 * router — five screens do not need a graph, and a back stack that could strand
 * somebody two screens from the scan field would be worse than no back stack.
 *
 * See `POS-TABLET-PLAN.md` for why this is native rather than the WebView shell
 * that was started first, and what it takes from `pos-android` (the reader) and
 * `pos-electron` (the shape) without taking their server-side cart.
 */
class MainActivity : ComponentActivity() {

    private enum class Where { SETUP, LOGIN, DESK, TENDER, SHIFT, RECEIPT, RETURN }

    private val store by lazy { ConfigStore(applicationContext) }
    private val reader by lazy { UsbReader(applicationContext) }

    /**
     * Every sale rung on this tablet, written down before it is sent. In the
     * app's private files, which survive the app being killed, the tablet being
     * switched off and the node being unreachable for a week.
     */
    private val outbox by lazy { Outbox(File(filesDir, "outbox-v1.json")) }

    /** Set by the composition while it is up; the app coming back to the front tries the outbox. */
    private var onResumed: (() -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { ItulahTheme { App() } }
    }

    @Composable
    private fun App() {
        var config by remember { mutableStateOf(store.load()) }
        val api = remember { Api(config) }
        val till: TillViewModel = viewModel(factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                TillViewModel(api, store, outbox) as T
        })
        val state by till.state.collectAsStateWithLifecycle()

        // A tablet that was asleep, or in another app, may have the store server
        // back. Whatever is owed goes now rather than at the next 15 s tick.
        DisposableEffect(till) {
            onResumed = till::flushNow
            onDispose { onResumed = null }
        }

        var where by remember {
            mutableStateOf(
                when {
                    !config.isCommissioned -> Where.SETUP
                    config.token.isBlank() -> Where.LOGIN
                    else -> Where.DESK
                },
            )
        }
        var loginError by remember { mutableStateOf<String?>(null) }
        var busy by remember { mutableStateOf(false) }
        var readerPower by remember { mutableStateOf<Int?>(null) }
        // The return in progress, and what it is waiting for a supervisor to
        // authorise. Held here rather than in the view model because a
        // half-built return is a screen's business, not the till's.
        var returning by remember { mutableStateOf(listOf<ReturningLine>()) }
        var refundMethod by remember { mutableStateOf("CASH") }
        var approving by remember { mutableStateOf<String?>(null) }
        var approvalFailure by remember { mutableStateOf<String?>(null) }
        // The BENEFIT tender of the sale being returned, when the receipt
        // carries its sale_ref: that is what "Kembali ke saldo karyawan" needs.
        val benefitTender = state.receipt
            ?.takeIf { it.saleId == state.lastSale?.saleId }
            ?.tenders?.firstOrNull { it.method == "BENEFIT" && !it.reference.isNullOrBlank() }
        val scanFocus = remember { FocusRequester() }

        // The caret belongs in the scan field whenever the desk is showing.
        // A wedge scanner is a keyboard, and a keyboard typing into nothing is
        // a garment that was never rung up.
        val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
        LaunchedEffect(where) {
            if (where != Where.DESK) return@LaunchedEffect
            runCatching { scanFocus.requestFocus() }
            // Focused but silent. The field has to hold the caret so a wedge
            // scanner has somewhere to type, and the IME must not open for it —
            // on a tablet it covers the basket, and the next thing to arrive is
            // a tag rather than a thumb. The keyboard icon in the field summons it.
            kotlinx.coroutines.delay(120)
            keyboard?.hide()
        }

        LaunchedEffect(config.token) {
            if (config.token.isNotBlank()) {
                api.config = config
                till.start(config)
            }
        }

        // The sled follows the desk: attached while selling, silent otherwise.
        LaunchedEffect(where, config.token) {
            if (where == Where.DESK && config.token.isNotBlank()) {
                reader.setListener(object : UsbReader.Listener {
                    override fun onTag(epc: String) = till.scan(epc)
                    override fun onStatus(connected: Boolean, scanning: Boolean, power: Int?, detail: String?) {
                        readerPower = power ?: readerPower
                        till.readerStatus(connected, scanning, power, reader.isSupported, detail)
                    }
                    override fun onFieldCleared() = Unit
                })
                withContext(Dispatchers.IO) {
                    reader.watchForAttach()
                    // Opens the module and starts the antenna as one act — see
                    // UsbReader.open. Calling startInventory here would race the
                    // open and lose.
                    reader.connect(config.readerPower)
                }
            } else {
                withContext(Dispatchers.IO) { reader.stopInventory() }
            }
        }

        BackHandler(enabled = where != Where.DESK) {
            // Leaving the payment screen abandons the payment: give back any
            // employee balance already spent on this basket.
            if (where == Where.TENDER) till.releaseBenefit()
            // The sale just rung stays in the outbox whatever the screen does.
            if (where == Where.RECEIPT) till.forgetRung()
            where = Where.DESK
        }

        // A session the node no longer honours takes the cashier back to the
        // sign-in screen, once, with the reason on it. Everything downstream —
        // the price book, the shift, the total — is broken until this is, and
        // showing three separate red notes for one cause sends somebody to
        // check the network.
        LaunchedEffect(state.signedOut) {
            if (state.signedOut && where != Where.LOGIN) {
                store.clearSession()
                config = store.load()
                api.config = config
                loginError = "Sesi habis. Masuk lagi."
                where = Where.LOGIN
            }
        }

        // Signing out, from the desk's person menu. Only the desk offers it:
        // signing out mid-payment or mid-return would strand whatever was half
        // done on the screen being left.
        val signOut = {
            store.clearSession()
            config = store.load()
            api.config = config
            loginError = null
            where = Where.LOGIN
        }

        // Every screen stands in the same frame, as it does on pos-desktop.
        // Before sign-in there is no cashier to show and no till to report on.
        // The counter (and the payment dialog over it) draws its own toolbar, so
        // the plain bar is for every other page.
        val signedIn = where != Where.SETUP && where != Where.LOGIN
        Shell(
            terminalId = config.terminalId.takeIf { it.isNotBlank() },
            cashier = if (signedIn) config.cashier else null,
            status = if (signedIn) ({ TillStatus(state) }) else null,
            bar = where != Where.DESK && where != Where.TENDER,
        ) {
        when (where) {
            Where.SETUP -> SetupScreen(
                config = config,
                readerAvailable = reader.isSupported,
                readerPower = readerPower,
                onPower = { dbm ->
                    store.savePower(dbm)
                    config = store.load()
                    CoroutineScope(Dispatchers.IO).launch { readerPower = reader.applyPower(dbm) }
                },
                onSave = { updated ->
                    store.saveCounter(
                        updated.nodeUrl, updated.terminalId,
                        updated.printerHost, updated.printerPort, updated.paper,
                    )
                    config = store.load()
                    api.config = config
                    where = if (config.token.isBlank()) Where.LOGIN else Where.DESK
                },
                onCancel = if (config.isCommissioned) ({
                    where = if (config.token.isBlank()) Where.LOGIN else Where.DESK
                }) else null,
            )

            Where.LOGIN -> LoginScreen(
                node = config.nodeUrl,
                busy = busy,
                error = loginError,
                onLogin = { username, password ->
                    busy = true
                    loginError = null
                    CoroutineScope(Dispatchers.Main).launch {
                        val outcome = runCatching {
                            withContext(Dispatchers.IO) { api.login(username, password) }
                        }
                        busy = false
                        outcome.fold(
                            onSuccess = { (token, cashier) ->
                                store.saveSession(token, cashier)
                                config = store.load()
                                api.config = config
                                where = Where.DESK
                            },
                            onFailure = { loginError = it.message ?: "gagal masuk" },
                        )
                    }
                },
                onSetup = { where = Where.SETUP },
            )

            // The payment dialog stands over the counter, so the counter stays
            // composed behind it — but locked, so a scan cannot reach it.
            Where.DESK, Where.TENDER -> DeskScreen(
                state = state,
                config = config,
                scanFocus = scanFocus,
                // Over it, the payment dialog or a supervisor's step-up: neither
                // is a moment for a scan to land in the basket.
                locked = where == Where.TENDER || approving != null,
                onScan = till::scan,
                onRemove = till::remove,
                onClear = till::clear,
                onTender = { where = Where.TENDER },
                onShift = { till.refreshShift(); where = Where.SHIFT },
                onReturns = {
                    returning = emptyList()
                    refundMethod = "CASH"
                    state.lastSale?.let { till.loadReceipt(it.saleId) }
                    where = Where.RETURN
                },
                // The same supervisor step-up the return screen's "void the whole
                // sale" opens, over the counter instead of over that screen.
                onVoid = {
                    if (state.lastSale != null) {
                        approvalFailure = null
                        approving = "void"
                    }
                },
                onHold = till::hold,
                onResume = till::resume,
                onLastReceipt = {
                    state.lastSale?.let { sale ->
                        // The last sale the node has, not the one that may still
                        // be on its way.
                        till.forgetRung()
                        till.loadReceipt(sale.saleId)
                        where = Where.RECEIPT
                    }
                },
                onSetup = { where = Where.SETUP },
                onSignOut = signOut,
                onDismissNote = till::dismissNote,
                onDismissLookup = till::clearLookup,
            )

            Where.SHIFT -> ShiftScreen(
                shift = state.shift,
                busy = state.busy,
                unsent = state.outbox.unsent,
                refused = state.outbox.refused,
                onOpen = { float -> till.openShift(float) },
                onMovement = { kind, amount, reason -> till.cashMovement(kind, amount, reason, null) },
                onClose = { declared, note ->
                    till.closeShift(declared, note) { closed ->
                        till.say(
                            id.itulah.kasir.pos.Note(
                                closed.varianceMinor != null && closed.varianceMinor != 0L,
                                "Shift ditutup. Selisih " +
                                    id.itulah.kasir.data.Money.format(closed.varianceMinor ?: 0),
                            ),
                        )
                    }
                    where = Where.DESK
                },
                onBack = { where = Where.DESK },
            )

            Where.RETURN -> ReturnScreen(
                state = state,
                config = config,
                lines = returning,
                refundMethod = refundMethod,
                benefitTender = benefitTender,
                busy = state.busy,
                onScan = { raw ->
                    val value = raw.trim().uppercase()
                    val parts = id.itulah.kasir.core.Epc.decode(value)
                    if (parts == null) {
                        till.say(id.itulah.kasir.pos.Note(true, "Itu bukan tag yang kami kenali."))
                    } else if (returning.any { it.epc == value }) {
                        // Silent: a pad reader re-reads the same tag many times
                        // a second, and the sled already filtered its batch.
                    } else {
                        val name = state.receipt?.lines
                            ?.firstOrNull { it.skuCode == parts.skuCode }?.name
                            ?: "SKU ${skuDisplay(parts.skuCode)}"
                        returning = returning + ReturningLine(value, parts.skuCode, name)
                    }
                },
                onDisposition = { epc, disposition ->
                    returning = returning.map {
                        if (it.epc == epc) it.copy(disposition = disposition) else it
                    }
                },
                onRemove = { epc -> returning = returning.filterNot { it.epc == epc } },
                onRefundMethod = { refundMethod = it },
                onSubmit = { approvalFailure = null; approving = "retur" },
                onVoidWhole = { approvalFailure = null; approving = "void" },
                onBack = { where = Where.DESK },
            )

            Where.RECEIPT -> {
                // The sale just rung, while the store server has not taken it:
                // then there is no receipt, and nothing to print against.
                val rung = state.rungEntry
                val pending = rung?.takeIf { it.saleId == null || it.refused }
                // Which sale's paper this is: the one just rung once the node has
                // named it, else the last sale the node has (the "Last receipt"
                // route, which forgets the rung first).
                val named = rung?.saleId ?: state.lastSale?.saleId
                ReceiptScreen(
                    // Only the receipt of that sale: until it has been fetched,
                    // `state.receipt` is still the one before.
                    receipt = state.receipt?.takeIf { it.saleId == named },
                    sale = state.lastSale?.takeIf { it.saleId == named },
                    pending = pending,
                    settling = rung != null && state.settlingId == rung.localId,
                    storageProblem = state.outbox.storageProblem,
                    hasPrinter = config.hasPrinter,
                    busy = state.busy,
                    // By the sale, not by the loaded receipt: that may still be the
                    // one before while the new one is on its way.
                    onPrint = { copy -> named?.let { till.printReceipt(it, copy) } },
                    onBack = { till.forgetRung(); where = Where.DESK },
                )
            }
        }
        }

        // Payment is a dialog over the counter, not a page of its own.
        if (where == Where.TENDER) {
            TenderScreen(
                totalMinor = state.totalMinor,
                methods = state.paymentMethods,
                busy = state.busy,
                failure = state.note?.takeIf { it.bad }?.text,
                benefitHeld = state.benefit,
                basketHasPromotion = state.quote?.promotions?.any { it.applied } == true,
                onBenefitLookup = till::benefitLookup,
                onBenefitSpend = till::benefitSpend,
                onBenefitRelease = till::releaseBenefit,
                onCancel = { till.releaseBenefit(); where = Where.DESK },
                onConfirm = { tenders ->
                    // Written down first, sent second: the receipt screen opens
                    // as soon as the sale is on this tablet, whether or not the
                    // store server has answered. Printing is fire-and-forget on
                    // purpose (a printer out of paper must not hold up the next
                    // customer, and the receipt can be reprinted from the sale at
                    // any time) and happens only once the node has named the sale.
                    till.sell(tenders, autoPrint = config.hasPrinter) { where = Where.RECEIPT }
                },
            )
        }

        // The step-up sits over whatever asked for it, so the cashier can see
        // what they are authorising while they authorise it.
        val asking = approving
        val sale = state.lastSale
        if (asking != null && sale != null) {
            SupervisorSheet(
                what = if (asking == "void") {
                    "Void the whole sale of " +
                        id.itulah.kasir.data.Money.format(sale.totalMinor)
                } else {
                    "Accept ${returning.size} items back"
                },
                busy = state.busy,
                failure = approvalFailure,
                onCancel = { approving = null },
                onApprove = { supervisor ->
                    approvalFailure = null
                    if (asking == "void") {
                        till.voidSale(sale.saleId, "Dibatalkan di kasir", supervisor) {
                            approving = null
                            returning = emptyList()
                            where = Where.DESK
                        }
                    } else {
                        val post = {
                            till.returnSale(
                                sale.saleId,
                                returning.map {
                                    id.itulah.kasir.data.ReturnLine(it.epc, it.disposition)
                                },
                                refundMethod,
                                "Retur pelanggan",
                                supervisor,
                            ) {
                                approving = null
                                returning = emptyList()
                                where = Where.DESK
                            }
                        }
                        val benefit = benefitTender
                        if (refundMethod == "BENEFIT" && benefit?.reference != null) {
                            // Put the money back on the balance first, capped at
                            // what that tender paid; only then post the return.
                            val refund = returning.sumOf { line ->
                                state.receipt?.lines?.firstOrNull { it.skuCode == line.skuCode }?.lineTotalMinor ?: 0L
                            }
                            till.benefitRefund(benefit.reference, minOf(refund, benefit.amountMinor)) { outcome ->
                                outcome.fold(
                                    onSuccess = { post() },
                                    onFailure = { approvalFailure = it.message },
                                )
                            }
                        } else {
                            post()
                        }
                    }
                },
            )
        }
        // A refusal keeps the sheet up with the reason on it, rather than
        // dropping the cashier back to a screen that looks like nothing
        // happened.
        LaunchedEffect(state.note) {
            val bad = state.note?.takeIf { it.bad }?.text
            if (approving != null && bad != null) approvalFailure = bad
        }
    }

    override fun onResume() {
        super.onResume()
        onResumed?.invoke()
    }

    override fun onStop() {
        // The antenna is a radio, not a widget. A till behind a locked screen
        // that keeps sweeping is reading a shop nobody is standing in.
        reader.stopInventory()
        super.onStop()
    }

    override fun onDestroy() {
        reader.setListener(null)
        reader.close()
        super.onDestroy()
    }
}
