package id.itulah.kasir.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.coerceIn
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.itulah.kasir.data.CatalogRow
import id.itulah.kasir.data.Config
import id.itulah.kasir.data.Money
import id.itulah.kasir.data.OutboxEntry
import id.itulah.kasir.data.OutboxView
import id.itulah.kasir.data.WhenIt
import id.itulah.kasir.data.skuDisplay
import id.itulah.kasir.pos.BasketLine
import id.itulah.kasir.pos.ReaderState
import id.itulah.kasir.pos.TillState
import kotlinx.coroutines.delay

/**
 * The counter — `pos-web-options.html`, F · Flipped, header variant 1 (Labels).
 *
 * A toolbar across the top; under it two white cards on the pale ground, the
 * basket on the left and the money on the right. Everything a cashier does
 * forty times an hour is in the toolbar or the left card: the scan field, the
 * basket, Hold, Return. Everything they do twice a day is one menu away — the
 * person chip holds the shift, the last receipt, the device settings and
 * signing out. The right card is the total and the one blue button, and
 * nothing else.
 *
 * Nothing on this screen moves when a tag is scanned. The newest line carries a
 * static marker; the total changes in place. Scans are scanner input, a hundred
 * a day, and motion on each of them is motion nobody looks at.
 *
 * [locked] is the payment dialog being open over this screen: the counter stays
 * in view behind it, but it must not take scans — a tag landing in a basket
 * that is being paid for changes the amount under the customer's hand.
 *
 * The Member, Coupon and Bags rows of the prototype's money card are not here:
 * the till has no member, coupon or bag data path, and a row that opens
 * nothing is worse than no row.
 */
@Composable
fun DeskScreen(
    state: TillState,
    config: Config,
    scanFocus: FocusRequester,
    locked: Boolean,
    onScan: (String) -> Unit,
    onRemove: (String) -> Unit,
    onClear: () -> Unit,
    onTender: () -> Unit,
    onShift: () -> Unit,
    onReturns: () -> Unit,
    onVoid: () -> Unit,
    onHold: () -> Unit,
    onResume: (String) -> Unit,
    onLastReceipt: () -> Unit,
    onSetup: () -> Unit,
    onSignOut: () -> Unit,
    onDismissNote: () -> Unit,
    onDismissLookup: () -> Unit,
) {
    val keyboard = LocalSoftwareKeyboardController.current

    // A menu is a window of its own and takes the focus with it; when it goes,
    // the caret goes back to the scan field, silently — the IME must not open.
    fun refocus() {
        runCatching { scanFocus.requestFocus() }
        keyboard?.hide()
    }

    // The caret comes back when whatever stood over the counter has gone. The
    // field was disabled while it was there, so it is asked for again here —
    // the desk itself never left the screen, and so never had its focus reset.
    LaunchedEffect(locked) {
        if (!locked) {
            refocus()
            // Focused but silent, as at sign-in: the IME must not open.
            delay(120)
            keyboard?.hide()
        }
    }

    Column(Modifier.fillMaxSize()) {
        Toolbar(
            state = state,
            config = config,
            onHold = onHold,
            onResume = onResume,
            onReturns = onReturns,
            onVoid = onVoid,
            onClear = onClear,
            onShift = onShift,
            onLastReceipt = onLastReceipt,
            onSetup = onSetup,
            onSignOut = onSignOut,
            refocus = { refocus() },
        )

        // Tablet landscape: a 40% money card, never narrower than 380 nor
        // wider than 600, with 12 between and 14 around.
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val money = (maxWidth * 0.4f).coerceIn(380.dp, 600.dp)
            Row(
                Modifier
                    .fillMaxSize()
                    .padding(start = 14.dp, top = 12.dp, end = 14.dp, bottom = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                // ── Left: what comes in ──────────────────────────────────
                Pane(Modifier.weight(1f).fillMaxHeight()) {
                    Box(Modifier.fillMaxWidth().padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 12.dp)) {
                        ScanField(
                            onScan = onScan,
                            focus = scanFocus,
                            enabled = !locked,
                            trailing = { ReaderMark(state.reader) },
                        )
                    }
                    // Money the store server has not taken, or refused: never
                    // behind a menu, because it is the first thing a manager
                    // asks about before the drawer is counted.
                    OutboxBanner(state.outbox)
                    val note = state.note
                    if (note != null) {
                        Box(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp)) {
                            Notice(note.text, bad = note.bad, onDismiss = onDismissNote)
                        }
                    }
                    PriceCheck(state, config, onDismissLookup)
                    if (state.lines.isEmpty()) {
                        EmptyBasket(Modifier.weight(1f))
                    } else {
                        Divider()
                        Lines(state.lines, config, onRemove, Modifier.weight(1f))
                    }
                }

                // ── Right: what it comes to ──────────────────────────────
                Pane(Modifier.width(money).fillMaxHeight()) {
                    Spacer(Modifier.weight(1f))
                    Divider()
                    Totals(state, onTender, onShift)
                }
            }
        }
    }
}

// ── the toolbar ─────────────────────────────────────────────────────────

private enum class Menu { RETURN, HELD, ME }

/**
 * `.hdr.tbh` — the mark, Hold, Held, Return ▾, and at the far end Cancel sale
 * and the person chip.
 *
 * Everything the old function board held is still reachable and nothing is
 * duplicated: Hold and Held are here, Return and Void sit under Return, and
 * Shift & cash, Last receipt, Device & node and Sign out sit under the person.
 * The keyboard that the board's "Papan tik" summoned is an icon in the scan
 * field.
 *
 * The labels fold to icons only when the bar is narrower than 840 dp, which no
 * landscape tablet is; there the same eight things are still all in one place.
 */
@Composable
private fun Toolbar(
    state: TillState,
    config: Config,
    onHold: () -> Unit,
    onResume: (String) -> Unit,
    onReturns: () -> Unit,
    onVoid: () -> Unit,
    onClear: () -> Unit,
    onShift: () -> Unit,
    onLastReceipt: () -> Unit,
    onSetup: () -> Unit,
    onSignOut: () -> Unit,
    refocus: () -> Unit,
) {
    var menu by remember { mutableStateOf<Menu?>(null) }
    var wasOpen by remember { mutableStateOf(false) }
    LaunchedEffect(menu) {
        if (menu == null && wasOpen) refocus()
        wasOpen = menu != null
    }
    fun pick(action: () -> Unit) {
        menu = null
        action()
    }

    val cashier = config.cashier.ifBlank { "Cashier" }
    val till = config.terminalId.ifBlank { "Till" }

    BoxWithConstraints(Modifier.fillMaxWidth().background(Canvas)) {
        val labels = maxWidth >= 840.dp
        Column {
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .padding(start = 16.dp, end = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BrandMark()
                Spacer(Modifier.width(14.dp))

                ToolButton(
                    "Hold", Glyph.Hold, onHold,
                    enabled = state.lines.isNotEmpty(),
                    showLabel = labels,
                )

                // Held is only there when something is. One held basket comes
                // straight back; with several, they are listed to choose from.
                if (state.held.isNotEmpty()) {
                    Box {
                        ToolButton(
                            "Held", Glyph.Bullets,
                            onClick = {
                                if (state.held.size == 1) onResume(state.held.first().id)
                                else menu = Menu.HELD
                            },
                            count = state.held.size,
                            active = menu == Menu.HELD,
                            showLabel = labels,
                        )
                        if (menu == Menu.HELD) {
                            Popover(onDismiss = { menu = null }, modifier = Modifier.width(300.dp)) {
                                state.held.forEach { basket ->
                                    val worth = basket.lines.sumOf { it.unitPriceMinor }
                                    MenuItem(
                                        label = plural(basket.lines.size, "item") + " · " + basket.at,
                                        onClick = { pick { onResume(basket.id) } },
                                        trailing = if (worth > 0) Money.format(worth) else null,
                                    )
                                }
                            }
                        }
                    }
                }

                Box {
                    ToolButton(
                        "Return", Glyph.Return,
                        onClick = { menu = Menu.RETURN },
                        caret = true,
                        active = menu == Menu.RETURN,
                        showLabel = labels,
                    )
                    if (menu == Menu.RETURN) {
                        Popover(onDismiss = { menu = null }, modifier = Modifier.width(240.dp)) {
                            MenuItem("Return items", { pick(onReturns) }, glyph = Glyph.Return)
                            // Voids the last sale on this till, behind the same
                            // supervisor step-up the return screen asks for.
                            MenuItem(
                                "Void a sale",
                                { pick(onVoid) },
                                glyph = Glyph.Forbidden,
                                enabled = state.lastSale != null,
                            )
                        }
                    }
                }

                Spacer(Modifier.weight(1f))

                if (state.lines.isNotEmpty()) {
                    ToolButton(
                        "Cancel sale", Glyph.Close, onClear,
                        showLabel = labels,
                        tone = BadFg,
                        iconTone = BadFg,
                    )
                }

                // `.me` — the person, and everything that is about the till
                // rather than the sale.
                Box(Modifier.padding(start = 6.dp)) {
                    Row(
                        Modifier
                            .height(Tap)
                            .tappable({ menu = Menu.ME }, shape = RoundedCornerShape(22.dp))
                            .background(if (menu == Menu.ME) Soft2 else Color.Transparent)
                            .padding(start = 6.dp, end = 8.dp)
                            .semantics { contentDescription = "$cashier, $till" },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Avatar(cashier)
                        Icon(Glyph.Down, null, Modifier.size(16.dp), tint = LineIco)
                    }
                    if (menu == Menu.ME) {
                        Popover(onDismiss = { menu = null }, alignEnd = true, modifier = Modifier.width(280.dp)) {
                            Column(Modifier.padding(start = 10.dp, end = 10.dp, top = 8.dp, bottom = 6.dp)) {
                                Text(
                                    cashier,
                                    style = Type.metric.copy(fontWeight = FontWeight.Medium),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    till + " · " + if (state.shift != null) "Shift open" else "No shift",
                                    style = Type.meta.copy(color = Mute),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            MenuSeparator()
                            MenuItem("Shift & cash", { pick(onShift) }, glyph = Glyph.Wallet)
                            MenuItem(
                                "Last receipt",
                                { pick(onLastReceipt) },
                                glyph = Glyph.Print,
                                enabled = state.lastSale != null,
                            )
                            MenuItem("Device & node", { pick(onSetup) }, glyph = Glyph.Rfid)
                            MenuSeparator()
                            MenuItem("Sign out", { pick(onSignOut) }, glyph = Glyph.Lock)
                        }
                    }
                }
            }
            Divider()
        }
    }
}

private fun plural(n: Int, word: String) = "$n $word" + if (n == 1) "" else "s"

// ── the status bar ──────────────────────────────────────────────────────

/** What the status bar says while the till is up. */
@Composable
fun RowScope.TillStatus(state: TillState) {
    // First, so a crowded bar clips the machinery and not the money.
    val outbox = state.outbox
    if (outbox.storageProblem != null) StatusText("Penyimpanan kasir bermasalah", Bad)
    if (outbox.refused > 0) StatusText("${outbox.refused} penjualan ditolak server toko", Bad)
    if (outbox.unsent > 0) StatusText("${outbox.unsent} penjualan menunggu dikirim", Warn)
    if (outbox.unacknowledged == 0) StatusText("Semua penjualan terkirim", Ok)

    val reader = state.reader
    when {
        !reader.available -> StatusText("No reader · keyboard scanner", Mute)
        reader.connected -> StatusText(
            "Reader on" + (reader.power?.let { " · $it dBm" } ?: ""),
            Ok,
        )
        else -> StatusText(reader.detail ?: "Reader not attached", Bad)
    }
    StatusText(
        state.shift?.let { "Shift open · ${it.terminalId}" } ?: "No shift open",
        if (state.shift != null) Ok else Warn,
    )
    StatusText("${state.namesKnown} names known")
}

/**
 * What the store server owes this till an answer about, and what it refused.
 *
 * Nothing at all while the queue is empty. An owed sale is amber and says why
 * the node has not taken it, in the node's own words where it gave any; a
 * refused one is red and carries the sentence it was refused with, because a
 * refusal is a verdict a person has to read. There is no dismiss: it goes when
 * the sale does. A disk that is not keeping the queue is the loudest of the
 * three — everything owed is then only in memory.
 */
@Composable
private fun OutboxBanner(outbox: OutboxView) {
    val refused = outbox.entries.filter { it.refused }
    if (outbox.unsent == 0 && refused.isEmpty() && outbox.storageProblem == null) return
    Column(
        Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        outbox.storageProblem?.let { Notice(it, bad = true, title = "Penyimpanan kasir") }
        if (refused.isNotEmpty()) {
            Notice(
                text = refused.take(3).joinToString("\n") { refusalLine(it) } +
                    if (refused.size > 3) "\n+${refused.size - 3} lagi" else "",
                bad = true,
                title = "${refused.size} penjualan ditolak server toko",
            )
        }
        if (outbox.unsent > 0) {
            Notice(
                text = outbox.entries.firstNotNullOfOrNull { if (it.isOwed) it.problem else null }
                    ?: "Tersimpan di kasir ini, dikirim otomatis begitu server toko menjawab.",
                warn = true,
                title = "${outbox.unsent} penjualan menunggu dikirim",
            )
        }
    }
}

/** When it was rung, what it came to, how many tags — and the node's sentence. */
private fun refusalLine(entry: OutboxEntry): String =
    WhenIt.local(entry.takenAt) + " · " + Money.format(entry.quotedTotalMinor) +
        " · " + entry.epcs.size + " tag" + (entry.problem?.let { " — $it" } ?: "")

/**
 * The reader, as a glyph inside the scan field: green when the antenna is on,
 * red when it should be and is not, grey when this till has none and a wedge
 * scanner does the work. The words are in the status bar.
 */
@Composable
private fun ReaderMark(reader: ReaderState) {
    val (tone, words) = when {
        !reader.available -> LineIco to "No reader"
        reader.connected -> Ok to "Reader on"
        else -> Bad to (reader.detail ?: "Reader not attached")
    }
    Icon(Glyph.Rfid, words, Modifier.padding(horizontal = 8.dp).size(20.dp), tint = tone)
}

// ── the basket ──────────────────────────────────────────────────────────

/** Several tags of one garment, shown as one line. A unit is still its tag. */
private class Pile(val sku: String, val name: String, val units: List<BasketLine>)

/** First-seen order, so a line never jumps when another of its kind is scanned. */
private fun piles(lines: List<BasketLine>): List<Pile> =
    lines.groupBy { it.skuCode }.map { (sku, units) -> Pile(sku, units.first().name, units) }

@Composable
private fun EmptyBasket(modifier: Modifier) {
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text("Ready for a new sale", style = Type.cardTitle.copy(color = Text, fontWeight = FontWeight.Medium))
            Text("Scan the first tag.", style = Type.meta.copy(color = Mute))
        }
    }
}

@Composable
private fun Lines(lines: List<BasketLine>, config: Config, onRemove: (String) -> Unit, modifier: Modifier) {
    val grouped = remember(lines) { piles(lines) }
    val newest = lines.lastOrNull()?.epc
    val list = rememberLazyListState()
    var seen by remember { mutableStateOf(lines.size) }
    // A basket that grew below the fold is a basket the cashier cannot see the
    // end of, and the end is where the thing they just scanned lands. A jump,
    // not a glide: nothing here moves for a scan.
    LaunchedEffect(lines.size) {
        if (lines.size > seen) {
            val at = grouped.indexOfFirst { pile -> pile.units.any { it.epc == newest } }
            if (at >= 0) list.scrollToItem(at)
        }
        seen = lines.size
    }
    LazyColumn(modifier.fillMaxWidth(), state = list) {
        // Keyed by the garment: a line never re-binds to a different one when
        // another is removed from the middle.
        itemsIndexed(grouped, key = { _, pile -> pile.sku }) { index, pile ->
            if (index > 0) Divider()
            BasketRow(pile, config, newest = pile.units.any { it.epc == newest }, onRemove = onRemove)
        }
    }
}

/**
 * `.fln` — a garment: its picture, name and SKU, how many, what it costs, and a
 * way to take one off.
 *
 * The newest line wears a static soft-blue wash and a 3 dp marker at its left
 * edge. It does not flash, slide or fade in.
 */
@Composable
private fun BasketRow(pile: Pile, config: Config, newest: Boolean, onRemove: (String) -> Unit) {
    val one = pile.units.first()
    val count = pile.units.size
    // A dash until the engine has spoken. The till never prints a figure it
    // worked out itself — that is how a counter starts disagreeing with its
    // own receipt.
    val priced = one.unitPriceMinor > 0
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 60.dp)
            .background(if (newest) AccentBg else Color.Transparent)
            .drawBehind {
                if (newest) {
                    val bar = 3.dp.toPx()
                    val inset = 12.dp.toPx()
                    drawRoundRect(
                        Accent,
                        topLeft = Offset(0f, inset),
                        size = Size(bar, size.height - 2 * inset),
                        cornerRadius = CornerRadius(bar),
                    )
                }
            }
            .padding(start = 14.dp, top = 8.dp, end = 6.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // The picture is the fastest way for a cashier to see that the tag
        // in their hand and the line on the screen are the same garment.
        Thumb(pile.sku, config, 44.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                pile.name,
                style = Type.metric.copy(fontWeight = FontWeight.Medium),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(skuDisplay(pile.sku), style = Type.id, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Text(
            if (count > 1) "× $count" else "",
            modifier = Modifier.width(44.dp),
            style = Type.cell.copy(color = Body),
            textAlign = TextAlign.End,
            maxLines = 1,
        )
        Spacer(Modifier.width(10.dp))
        Column(Modifier.widthIn(min = 112.dp), horizontalAlignment = Alignment.End) {
            Text(
                if (priced) Money.format(pile.units.sumOf { it.unitPriceMinor }) else "—",
                style = Type.cell.copy(color = if (priced) Ink else Mute),
                maxLines = 1,
            )
            if (priced && (count > 1 || one.isMarkedDown)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (one.isMarkedDown) {
                        Text(
                            Money.grouped(one.basePriceMinor),
                            style = Type.meta.copy(color = Mute, textDecoration = TextDecoration.LineThrough),
                            maxLines = 1,
                        )
                    }
                    if (count > 1) {
                        Text(
                            Money.grouped(one.unitPriceMinor) + " each",
                            style = Type.meta.copy(color = Mute),
                            maxLines = 1,
                        )
                    }
                }
            }
        }
        // Takes one unit off, the newest of its kind.
        IconTap(Glyph.Close, "Remove ${pile.name}", { onRemove(pile.units.last().epc) })
    }
}

/**
 * The other question a counter answers all day: how much is this.
 *
 * It opens inside the basket card rather than behind a modal, because a
 * cashier asked mid-basket should not have to leave the basket. Results come
 * from the node — 15 ms against a hundred thousand rows — so this stays the
 * same speed whatever the range grows to. Close puts the basket back.
 *
 * A result is never a basket line. A name or a barcode identifies a *product*,
 * and the shop has forty of that shirt; only a tag says which one is in the
 * customer's hand.
 */
@Composable
private fun PriceCheck(state: TillState, config: Config, onClose: () -> Unit) {
    if (state.lookup == null && !state.searching) return
    val rows = state.lookup.orEmpty()
    Column(Modifier.fillMaxWidth().background(Soft)) {
        Divider()
        Row(
            Modifier.fillMaxWidth().padding(start = 20.dp, end = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (state.searching) "Searching…" else "Price check",
                style = Type.control,
            )
            if (!state.searching) {
                Spacer(Modifier.width(10.dp))
                Text(plural(rows.size, "result"), style = Type.meta.copy(color = Mute))
            }
            Spacer(Modifier.weight(1f))
            IconTap(Glyph.Close, "Close price check", onClose)
        }
        Column(Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState())) {
            rows.take(6).forEachIndexed { index, row ->
                if (index > 0) Divider()
                PriceRow(row, config)
            }
            if (state.lookup?.isEmpty() == true) {
                Text(
                    "No match",
                    modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 14.dp),
                    style = Type.meta,
                )
            }
        }
    }
}

@Composable
private fun PriceRow(row: CatalogRow, config: Config) {
    Row(
        Modifier.fillMaxWidth().padding(start = 20.dp, top = 6.dp, end = 20.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Thumb(row.skuCode, config, 40.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                row.name,
                style = Type.metric.copy(fontWeight = FontWeight.Medium),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(skuDisplay(row.skuCode), style = Type.id, maxLines = 1)
        }
        Text(Money.format(row.unitPriceMinor), style = Type.cell.copy(color = Ink), maxLines = 1)
    }
}

// ── the money ───────────────────────────────────────────────────────────

/**
 * `.f-tot` — what the node says it comes to, and the one button that takes it.
 *
 * Subtotal, then each promotion in green, then the total large enough to read
 * back across a counter. While the node has not priced the basket the total is
 * in the quieter ink: it is the till's own sum until the engine answers, and
 * the figure to charge is never the till's own.
 */
@Composable
private fun Totals(state: TillState, onTender: () -> Unit, onShift: () -> Unit) {
    val quote = state.quote
    val discount = quote?.discountMinor ?: 0L
    val promotions = quote?.promotions.orEmpty()
    val applied = promotions.filter { it.applied && it.benefitMinor > 0 }
    // What the named promotions do not account for, if anything.
    val rest = discount - applied.sumOf { it.benefitMinor }
    val pending = state.lines.isNotEmpty() && quote == null

    Column(Modifier.fillMaxWidth().padding(start = 20.dp, top = 8.dp, end = 20.dp, bottom = 20.dp)) {
        TotalLine("Subtotal · " + plural(state.lines.size, "item"), Money.format(state.totalMinor + discount))
        applied.forEach {
            TotalLine(it.name.ifBlank { "Promotion" }, "−" + Money.format(it.benefitMinor), cut = true)
        }
        if (discount > 0 && (applied.isEmpty() || rest > 0)) {
            TotalLine("Discount", "−" + Money.format(if (applied.isEmpty()) discount else rest), cut = true)
        }
        // Why a discount did not come off, before the money is taken rather
        // than after. This is what `POST /store/quote` is for.
        promotions.filter { !it.applied && it.reason != null }.forEach {
            Text(
                "${it.name}: ${it.reason}",
                style = Type.meta.copy(color = Mute),
                modifier = Modifier.padding(bottom = 4.dp),
            )
        }

        Divider(Modifier.padding(top = 8.dp))
        Row(
            Modifier.fillMaxWidth().padding(top = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Bottom,
        ) {
            Text("Total", style = Type.metric.copy(fontWeight = FontWeight.SemiBold))
            Text(
                Money.format(state.totalMinor),
                style = Type.money.copy(fontSize = 36.sp, color = if (pending) Body else Ink),
                maxLines = 1,
            )
        }

        Spacer(Modifier.height(14.dp))
        if (state.shift == null) {
            // Not a warning — a shop opens before it sells. But it is the one
            // thing that will stop the blue button, so it is said where the eye
            // already is, and tapping it goes where the fix is.
            Box(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = Tap)
                    .tappable(onShift)
                    .padding(horizontal = 4.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                Text("Open a shift to take payment", style = Type.meta.copy(color = WarnFg), maxLines = 1)
            }
        }
        PrimaryButton(
            text = "Pay",
            onClick = onTender,
            modifier = Modifier.fillMaxWidth(),
            enabled = state.shift != null && state.lines.isNotEmpty(),
            busy = state.busy,
            height = 60.dp,
            fontSize = 17.sp,
            arrangement = Arrangement.Start,
        )
    }
}

/** `.tl` — a label and a figure; `cut` turns the figure green. */
@Composable
private fun TotalLine(label: String, value: String, cut: Boolean = false) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 30.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = Type.meta,
            modifier = Modifier.weight(1f).padding(end = 12.dp),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(value, style = Type.cell.copy(color = if (cut) OkFg else Text), maxLines = 1)
    }
}
