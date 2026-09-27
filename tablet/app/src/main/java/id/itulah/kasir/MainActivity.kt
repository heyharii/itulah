package id.itulah.kasir

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
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
                TillViewModel(api, store) as T
        })
        val state by till.state.collectAsStateWithLifecycle()

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
            // a tag rather than a thumb. "Papan tik" on the board summons it.
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

        BackHandler(enabled = where != Where.DESK) { where = Where.DESK }

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

        // Every screen stands in the same frame, as it does on pos-desktop.
        // Before sign-in there is no cashier to show and no till to report on.
        val signedIn = where != Where.SETUP && where != Where.LOGIN
        Shell(
            terminalId = config.terminalId.takeIf { it.isNotBlank() },
            cashier = if (signedIn) config.cashier else null,
            // Only from the desk: signing out mid-payment or mid-return would
            // strand whatever was half done on the screen being left.
            onSignOut = if (where == Where.DESK) ({
                store.clearSession()
                config = store.load()
                api.config = config
                loginError = null
                where = Where.LOGIN
            }) else null,
            status = if (signedIn) ({ TillStatus(state) }) else null,
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

            Where.DESK -> DeskScreen(
                state = state,
                config = config,
                scanFocus = scanFocus,
                onScan = till::scan,
                onRemove = till::remove,
                onClear = till::clear,
                onTender = { where = Where.TENDER },
                onShift = { till.refreshShift(); where = Where.SHIFT },
                onReturns = {
                    returning = emptyList()
                    state.lastSale?.let { till.loadReceipt(it.saleId) }
                    where = Where.RETURN
                },
                onHold = till::hold,
                onResume = till::resume,
                onLastReceipt = {
                    state.lastSale?.let { sale ->
                        till.loadReceipt(sale.saleId)
                        where = Where.RECEIPT
                    }
                },
                onSetup = { where = Where.SETUP },
                onDismissNote = till::dismissNote,
            )

            Where.TENDER -> TenderScreen(
                totalMinor = state.totalMinor,
                lines = state.lines,
                methods = state.paymentMethods,
                busy = state.busy,
                failure = state.note?.takeIf { it.bad }?.text,
                onCancel = { where = Where.DESK },
                onConfirm = { tenders ->
                    till.sell(tenders) { sale ->
                        till.loadReceipt(sale.saleId)
                        // Printing is fire-and-forget on purpose: a printer out
                        // of paper must not hold up the next customer, and the
                        // receipt can be reprinted from the sale at any time.
                        if (config.hasPrinter) till.printReceipt(sale.saleId, copy = false)
                        where = Where.RECEIPT
                    }
                },
            )

            Where.SHIFT -> ShiftScreen(
                shift = state.shift,
                busy = state.busy,
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
                            ?: "SKU ${parts.skuCode}"
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

            Where.RECEIPT -> ReceiptScreen(
                receipt = state.receipt,
                hasPrinter = config.hasPrinter,
                busy = state.busy,
                onPrint = { copy -> state.receipt?.let { till.printReceipt(it.saleId, copy) } },
                onBack = { where = Where.DESK },
            )
        }
        }

        // The step-up sits over whatever asked for it, so the cashier can see
        // what they are authorising while they authorise it.
        val asking = approving
        val sale = state.lastSale
        if (asking != null && sale != null) {
            SupervisorSheet(
                what = if (asking == "void") {
                    "Membatalkan seluruh penjualan " +
                        id.itulah.kasir.data.Money.format(sale.totalMinor)
                } else {
                    "Menerima ${returning.size} barang kembali"
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
