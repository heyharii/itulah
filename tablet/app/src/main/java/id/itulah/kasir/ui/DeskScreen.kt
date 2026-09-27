package id.itulah.kasir.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.itulah.kasir.data.Config
import id.itulah.kasir.data.Money
import id.itulah.kasir.pos.BasketLine
import id.itulah.kasir.pos.TillState

/**
 * The counter.
 *
 * pos-desktop's sale screen, in the hub's tokens: a white pane on the left
 * with the scan field on top and the function board pinned to its foot, and a
 * white pane on the right with the basket, the total and the one blue button.
 * The board never scrolls and never moves — at four in the afternoon the
 * interface is muscle memory, and a key that shifted position is a key that has
 * to be read again every time.
 *
 * Everything a cashier does forty times an hour is on this screen. Everything
 * they do twice a day is one tap away from it.
 */
@Composable
fun DeskScreen(
    state: TillState,
    config: Config,
    scanFocus: FocusRequester,
    onScan: (String) -> Unit,
    onRemove: (String) -> Unit,
    onClear: () -> Unit,
    onTender: () -> Unit,
    onShift: () -> Unit,
    onReturns: () -> Unit,
    onHold: () -> Unit,
    onResume: (String) -> Unit,
    onLastReceipt: () -> Unit,
    onSetup: () -> Unit,
    onDismissNote: () -> Unit,
) {
    val keyboard = LocalSoftwareKeyboardController.current
    // `.workspace` at pos-desktop's ≤1180px step: 14 between, 16 around.
    Row(
        Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // ── Left: what comes in ──────────────────────────────────────────
        Pane(Modifier.fillMaxHeight().weight(0.44f)) {
            Block(first = true) {
                ScanField(onScan = onScan, focus = scanFocus)
                Spacer(Modifier.height(10.dp))
                Text(
                    "Tag masuk ke keranjang. Barcode dan nama menjawab “ini berapa” — " +
                        "satu barang yang terjual adalah satu tag.",
                    style = Type.pill.copy(color = Mute, lineHeight = 18.sp),
                )
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ReaderIndicator(state)
                    Spacer(Modifier.width(16.dp))
                    StatusDot(Info, "Harga dari node")
                }
            }

            // The middle of the pane is the only part that scrolls: a long
            // price check must never push the board off the bottom.
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                if (state.note != null) {
                    Block {
                        Notice(state.note.text, bad = state.note.bad, onDismiss = onDismissNote)
                    }
                }
                Lookup(state, config)
                if (state.shift == null) {
                    // Not a warning — a shop opens before it sells. But it is the
                    // one thing that will stop the blue button, so it is said
                    // where the eye already is rather than at the moment of refusal.
                    Block {
                        Text("Belum ada shift terbuka di terminal ini.", style = Type.meta.copy(color = Mute))
                    }
                }
            }

            Board(
                state = state,
                onHold = onHold,
                onResume = { state.held.firstOrNull()?.let { onResume(it.id) } },
                onKeyboard = {
                    // The soft keyboard is off by default and summoned here.
                    // A till is driven by a sled or a wedge, both of which type
                    // without an IME — and an IME that opens on its own covers
                    // the basket, which was the first thing found on real
                    // hardware. It is still one tap away for a name search.
                    scanFocus.requestFocus()
                    keyboard?.show()
                },
                onReturns = onReturns,
                onLastReceipt = onLastReceipt,
                onShift = onShift,
                onSetup = onSetup,
            )
        }

        // ── Right: what it comes to ──────────────────────────────────────
        Pane(Modifier.fillMaxHeight().weight(0.56f)) {
            CartHead(state, onClear)
            Basket(state, config, onRemove, Modifier.weight(1f))
            Totals(state)
            if (state.lines.isNotEmpty()) {
                Divider()
                // `.action-bar`: Batal beside the button that takes the money.
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 14.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    GhostButton("Batal", onClear, height = 56.dp)
                    PrimaryButton(
                        text = "Bayar " + Money.format(state.totalMinor),
                        onClick = onTender,
                        modifier = Modifier.weight(1f),
                        enabled = state.shift != null,
                        busy = state.busy,
                        arrangement = Arrangement.Start,
                    )
                }
            }
        }
    }
}

/** What the status bar says while the till is up. */
@Composable
fun androidx.compose.foundation.layout.RowScope.TillStatus(state: TillState) {
    val reader = state.reader
    when {
        !reader.available -> StatusText("Tanpa pembaca · pemindai keyboard", Mute)
        reader.connected -> StatusText(
            "Pembaca aktif" + (reader.power?.let { " · $it dBm" } ?: ""),
            Ok,
        )
        else -> StatusText(reader.detail ?: "Pembaca tidak terpasang", Bad)
    }
    StatusText(
        state.shift?.let { "Shift terbuka · ${it.terminalId}" } ?: "Belum ada shift",
        if (state.shift != null) Ok else Warn,
    )
    StatusText("${state.namesKnown} nama dikenal")
    Spacer(Modifier.weight(1f))
    StatusText("Terminal kasir · satu node toko, banyak terminal")
}

@Composable
private fun ReaderIndicator(state: TillState) {
    val reader = state.reader
    when {
        !reader.available -> StatusDot(Mute, "Tanpa pembaca")
        reader.connected -> StatusDot(
            Ok,
            "Pembaca aktif" + (reader.power?.let { " · $it dBm" } ?: ""),
        )
        else -> StatusDot(Bad, reader.detail ?: "Pembaca tidak terpasang")
    }
}

/**
 * `.utility` — the function board, pinned to the foot of the left pane.
 *
 * Laid out on pos-desktop's four-column grid, in its order, so a cashier
 * who works both tills reaches for the same place on each.
 */
@Composable
private fun Board(
    state: TillState,
    onHold: () -> Unit,
    onResume: () -> Unit,
    onKeyboard: () -> Unit,
    onReturns: () -> Unit,
    onLastReceipt: () -> Unit,
    onShift: () -> Unit,
    onSetup: () -> Unit,
) {
    Divider()
    Column(
        Modifier.fillMaxWidth().background(Soft).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        KeyRow {
            UtilButton("Tahan", onHold, Modifier.weight(1f), enabled = state.lines.isNotEmpty())
            // Resuming parks whatever is on the counter in its place, so this
            // is safe with a basket up — nothing is thrown away.
            UtilButton(
                "Ditahan",
                onResume,
                Modifier.weight(1f),
                enabled = state.held.isNotEmpty(),
                count = state.held.size,
            )
            UtilButton("Papan tik", onKeyboard, Modifier.weight(1f))
            Spacer(Modifier.weight(1f))
        }
        KeyRow {
            UtilButton("Retur", onReturns, Modifier.weight(1f))
            UtilButton("Struk terakhir", onLastReceipt, Modifier.weight(1f), enabled = state.lastSale != null)
            UtilButton("Shift & kas", onShift, Modifier.weight(1f), strong = true)
            UtilButton("Perangkat & node", onSetup, Modifier.weight(1f))
        }
    }
}

/** `.cart-head` — Keranjang, how many units, and the way to empty it. */
@Composable
private fun CartHead(state: TillState, onClear: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(start = 18.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Keranjang", style = Type.cardTitle.copy(fontSize = 14.sp))
        Spacer(Modifier.width(9.dp))
        Badge("${state.lines.size} unit")
        Spacer(Modifier.weight(1f))
        if (state.lines.isNotEmpty()) {
            QuietButton("Kosongkan", onClear, tone = BadFg)
        } else {
            Spacer(Modifier.height(Tap))
        }
    }
    Divider()
}

@Composable
private fun Basket(state: TillState, config: Config, onRemove: (String) -> Unit, modifier: Modifier) {
    val listState = rememberLazyListState()
    // A basket that grew below the fold is a basket the cashier cannot see the
    // end of, and the end is where the thing they just scanned lands.
    LaunchedEffect(state.lines.size) {
        if (state.lines.isNotEmpty()) listState.animateScrollToItem(state.lines.lastIndex)
    }

    if (state.lines.isEmpty()) {
        // `.empty`
        Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Belum ada barang di konter", style = Type.cardTitle.copy(color = Text))
                Spacer(Modifier.height(8.dp))
                Text(
                    "Pindai tag pertama untuk memulai. Setiap tag yang terbaca menjadi satu unit.",
                    style = Type.meta.copy(color = Mute, lineHeight = 20.sp),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.widthIn(max = 300.dp),
                )
            }
        }
        return
    }
    LazyColumn(modifier.fillMaxWidth(), state = listState) {
        // Keyed by the tag: a unit is its tag, so a line never re-binds to
        // a different garment when one is removed from the middle.
        itemsIndexed(state.lines, key = { _, line -> line.epc }) { index, line ->
            if (index > 0) Divider()
            Line(line, config, onRemove)
        }
    }
}

/** `.cart-row` — one tag, one unit. */
@Composable
private fun Line(line: BasketLine, config: Config, onRemove: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(start = 18.dp, end = 8.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // The picture is the fastest way for a cashier to see that the tag
        // in their hand and the line on the screen are the same garment.
        Thumb(line.skuCode, config, 44.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(line.skuCode, style = Type.id.copy(fontSize = 11.sp))
            Text(
                line.name,
                style = Type.metric.copy(fontSize = 14.5.sp, fontWeight = FontWeight.Medium, color = Ink),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            // The last eight of the tag: enough to tell two of the same shirt
            // apart on screen, short enough not to crowd a name.
            Text("…" + line.epc.takeLast(8), style = Type.id.copy(fontSize = 11.sp))
        }
        Column(Modifier.width(110.dp), horizontalAlignment = Alignment.End) {
            if (line.isMarkedDown) {
                Text(
                    Money.grouped(line.basePriceMinor),
                    style = Type.pill.copy(color = Mute, textDecoration = TextDecoration.LineThrough),
                )
            }
            // A dash until the engine has spoken. The till never prints a
            // figure it worked out itself — that is how a counter starts
            // disagreeing with its own receipt.
            Text(
                if (line.unitPriceMinor > 0) Money.format(line.unitPriceMinor) else "—",
                style = Type.cell.copy(
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    color = if (line.unitPriceMinor > 0) Ink else Mute,
                ),
            )
        }
        // `.icon-btn`
        Box(
            Modifier
                .size(Tap)
                .clip(RoundedCornerShape(RInner))
                .clickable { onRemove(line.epc) },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Close, "Lepas ${line.name}", Modifier.size(18.dp), tint = LineIco)
        }
    }
}

/** `.totals` — what the node says it comes to, and how sure that is. */
@Composable
private fun Totals(state: TillState) {
    Divider()
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        val quote = state.quote
        if (quote != null && quote.discountMinor > 0) {
            KeyValue("Potongan", "−" + Money.grouped(quote.discountMinor), tone = OkFg)
        }
        quote?.promotions?.filter { !it.applied && it.reason != null }?.forEach { promotion ->
            // Why the discount did not come off, before the money is taken
            // rather than after. This is what `POST /store/quote` is for.
            Text("${promotion.name}: ${promotion.reason}", style = Type.pill.copy(color = Mute))
        }

        Divider(Modifier.padding(top = 4.dp, bottom = 6.dp))
        Grand("TOTAL", Money.format(state.totalMinor))
        Text(
            when {
                state.quoting -> "Menanyakan harga ke node…"
                state.lines.isEmpty() -> "Belum ada yang dihitung"
                quote == null -> "Sementara — node belum menjawab"
                else -> "Dihitung node, promo ikut"
            },
            style = Type.pill.copy(color = Mute),
        )
        if (state.shift == null && state.lines.isNotEmpty()) {
            Text("Buka shift dulu — uangnya harus masuk ke laci seseorang.", style = Type.pill.copy(color = WarnFg))
        }
    }
}

/**
 * The other question a counter answers all day: how much is this.
 *
 * It lives in the left pane's spare room rather than behind a modal, because
 * a cashier asked mid-basket should not have to leave the basket. Results come
 * from the node — 15 ms against a hundred thousand rows — so this stays the
 * same speed whatever the range grows to.
 *
 * A result is never a basket line. A name or a barcode identifies a *product*,
 * and the shop has forty of that shirt; only a tag says which one is in the
 * customer's hand.
 */
@Composable
private fun Lookup(state: TillState, config: Config) {
    if (state.lookup == null && !state.searching) return
    Block {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            SectionLabel(if (state.searching) "Mencari…" else "Cek harga")
            SectionLabel("${state.lookup?.size ?: 0} hasil")
        }
        Spacer(Modifier.height(10.dp))
        // `.pick-list`
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            state.lookup.orEmpty().take(6).forEach { row ->
                Card(Modifier.fillMaxWidth()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Thumb(row.skuCode, config, 40.dp)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                row.name,
                                style = Type.cell.copy(color = Ink, fontWeight = FontWeight.Medium),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(row.skuCode, style = Type.id.copy(fontSize = 11.sp))
                        }
                        Text(
                            Money.format(row.unitPriceMinor),
                            style = Type.cell.copy(color = Ink, fontWeight = FontWeight.SemiBold),
                        )
                    }
                }
            }
        }
        if (state.lookup?.isEmpty() == true) {
            Text("Tidak ada yang cocok.", style = Type.meta)
        }
    }
}
