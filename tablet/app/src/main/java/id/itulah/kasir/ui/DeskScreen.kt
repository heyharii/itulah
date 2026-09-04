package id.itulah.kasir.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Text
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
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
 * The pos-electron shape, in this system's tokens: scanning and the function
 * board on the left at 42%, the basket and the one black button on the right.
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
    Row(Modifier.fillMaxSize().background(Soft)) {
        // ── Left: what comes in ──────────────────────────────────────────
        Column(Modifier.fillMaxHeight().weight(0.42f).padding(14.dp)) {
            ScanField(onScan = onScan, focus = scanFocus)

            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                ReaderIndicator(state)
                Spacer(Modifier.width(14.dp))
                StatusDot(Info, "Harga dari node")
            }

            if (state.note != null) {
                Spacer(Modifier.height(8.dp))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(if (state.note.bad) BadBg else OkBg, androidx.compose.foundation.shape.RoundedCornerShape(8.dp))
                        .clickable(onClick = onDismissNote)
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        state.note.text,
                        Modifier.weight(1f),
                        color = if (state.note.bad) Bad else Ok,
                        fontSize = 13.sp,
                    )
                    Icon(Icons.Outlined.Close, null, Modifier.width(16.dp), tint = Mute)
                }
            }

            Spacer(Modifier.height(14.dp))
            // Three by two. Six is what fits without shrinking a target below a
            // thumb, and every one of them is a thing a cashier does mid-sale.
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    GhostButton("Retur", onReturns, Modifier.weight(1f), hint = "F3")
                    GhostButton("Struk", onLastReceipt, Modifier.weight(1f), hint = "F4", enabled = state.lastSale != null)
                    GhostButton("Shift", onShift, Modifier.weight(1f), hint = "F12")
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    GhostButton(
                        if (state.held.isEmpty()) "Tahan" else "Tahan (${state.held.size})",
                        {
                            // One key does both, because a counter with a
                            // parked basket and a full one is the same moment:
                            // serve the next customer, then come back.
                            if (state.lines.isNotEmpty()) onHold()
                            else state.held.firstOrNull()?.let { onResume(it.id) }
                        },
                        Modifier.weight(1f),
                        enabled = state.lines.isNotEmpty() || state.held.isNotEmpty(),
                        hint = state.held.firstOrNull()?.at,
                    )
                    GhostButton(
                        "Kosongkan",
                        onClear,
                        Modifier.weight(1f),
                        enabled = state.lines.isNotEmpty(),
                        tone = BadFg,
                    )
                    // The soft keyboard is off by default and summoned here.
                    // A till is driven by a sled or a wedge, both of which type
                    // without an IME — and an IME that opens on its own covers
                    // the basket, which was the first thing found on real
                    // hardware. It is still one tap away for a name search.
                    GhostButton(
                        "Papan tik",
                        {
                            scanFocus.requestFocus()
                            keyboard?.show()
                        },
                        Modifier.weight(1f),
                        hint = state.cashier.take(12),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    GhostButton("Perangkat", onSetup, Modifier.weight(1f))
                    Spacer(Modifier.weight(2f))
                }
            }

            Spacer(Modifier.height(14.dp))
            Lookup(state, config, onScan)

            Spacer(Modifier.weight(1f))
            if (state.shift == null) {
                // Not a warning — a shop opens before it sells. But it is the
                // one thing that will stop the black button, so it is said
                // where the eye already is rather than at the moment of refusal.
                Text(
                    "Belum ada shift terbuka di terminal ini.",
                    color = Mute,
                    fontSize = 12.sp,
                )
            }
        }

        Box(Modifier.width(1.dp).fillMaxHeight().background(Hairline))

        // ── Right: what it comes to ──────────────────────────────────────
        Column(Modifier.fillMaxHeight().weight(0.58f).background(Soft)) {
            Basket(state, config, onRemove, Modifier.weight(1f))
            Totals(state, onTender)
        }
    }
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

@Composable
private fun Basket(state: TillState, config: Config, onRemove: (String) -> Unit, modifier: Modifier) {
    val listState = rememberLazyListState()
    // A basket that grew below the fold is a basket the cashier cannot see the
    // end of, and the end is where the thing they just scanned lands.
    LaunchedEffect(state.lines.size) {
        if (state.lines.isNotEmpty()) listState.animateScrollToItem(state.lines.lastIndex)
    }

    Column(modifier.padding(horizontal = 14.dp, vertical = 14.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            SectionLabel("Keranjang")
            SectionLabel("${state.lines.size} unit")
        }
        Spacer(Modifier.height(8.dp))
        if (state.lines.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Pindai tag pertama.", color = Mute, fontSize = 14.sp)
            }
            return@Column
        }
        LazyColumn(
            state = listState,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            // Keyed by the tag: a unit is its tag, so a line never re-binds to
            // a different garment when one is removed from the middle.
            items(state.lines, key = { it.epc }) { line -> Line(line, config, onRemove) }
        }
    }
}

@Composable
private fun Line(line: BasketLine, config: Config, onRemove: (String) -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // The picture is the fastest way for a cashier to see that the tag
            // in their hand and the line on the screen are the same garment.
            Thumb(line.skuCode, config, 52.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    line.name,
                    style = Type.metric.copy(fontWeight = FontWeight.Medium),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(line.skuCode, style = Type.id)
                    Spacer(Modifier.width(8.dp))
                    // The last six of the tag: enough to tell two of the same
                    // shirt apart on screen, short enough not to crowd a name.
                    Text("…" + line.epc.takeLast(6), style = Type.id)
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                if (line.isMarkedDown) {
                    Text(
                        Money.grouped(line.basePriceMinor),
                        style = Type.pill.copy(textDecoration = TextDecoration.LineThrough),
                    )
                }
                // A dash until the engine has spoken. The till never prints a
                // figure it worked out itself — that is how a counter starts
                // disagreeing with its own receipt.
                Text(
                    if (line.unitPriceMinor > 0) Money.grouped(line.unitPriceMinor) else "—",
                    style = Type.metric.copy(
                        fontFamily = Mono,
                        fontWeight = FontWeight.Medium,
                        color = if (line.unitPriceMinor > 0) Ink else Mute,
                    ),
                )
            }
            Spacer(Modifier.width(8.dp))
            Icon(
                Icons.Outlined.Close,
                "Buang",
                Modifier.width(20.dp).clickable { onRemove(line.epc) },
                tint = Mute,
            )
        }
    }
}

@Composable
private fun Totals(state: TillState, onTender: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Canvas)
            .padding(14.dp),
    ) {
        Divider(Modifier.padding(bottom = 10.dp))

        val quote = state.quote
        if (quote != null && quote.discountMinor > 0) {
            KeyValue("Potongan", "−" + Money.grouped(quote.discountMinor), tone = Ok)
        }
        quote?.promotions?.filter { !it.applied && it.reason != null }?.forEach { promotion ->
            // Why the discount did not come off, before the money is taken
            // rather than after. This is what `POST /store/quote` is for.
            Text("${promotion.name}: ${promotion.reason}", fontSize = 11.sp, color = Mute)
        }

        KeyValue(
            if (state.quoting) "Total (menghitung…)" else if (quote == null) "Total (perkiraan)" else "Total",
            Money.format(state.totalMinor),
            strong = true,
        )
        Spacer(Modifier.height(10.dp))
        PrimaryButton(
            text = "Bayar " + Money.grouped(state.totalMinor),
            onClick = onTender,
            modifier = Modifier.fillMaxWidth(),
            enabled = state.lines.isNotEmpty() && state.shift != null,
            busy = state.busy,
        )
        if (state.shift == null && state.lines.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text("Buka shift dulu — uangnya harus masuk ke laci seseorang.", fontSize = 11.sp, color = Mute)
        }
    }
}

/**
 * The other question a counter answers all day: how much is this.
 *
 * It lives in the left column's spare room rather than behind a modal, because
 * a cashier asked mid-basket should not have to leave the basket. Results come
 * from the node — 15 ms against a hundred thousand rows — so this stays the
 * same speed whatever the range grows to.
 *
 * A result is never a basket line. A name or a barcode identifies a *product*,
 * and the shop has forty of that shirt; only a tag says which one is in the
 * customer's hand.
 */
@Composable
private fun Lookup(state: TillState, config: Config, onScan: (String) -> Unit) {
    if (state.lookup == null && !state.searching) return
    Column {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            SectionLabel(if (state.searching) "Mencari…" else "Cek harga")
            SectionLabel("${state.lookup?.size ?: 0} hasil")
        }
        Spacer(Modifier.height(6.dp))
        state.lookup.orEmpty().take(6).forEach { row ->
            Card(Modifier.fillMaxWidth().padding(bottom = 6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Thumb(row.skuCode, config, 44.dp)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(row.name, style = Type.cardTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(row.skuCode, style = Type.id)
                    }
                    Text(Money.grouped(row.unitPriceMinor), style = Type.metric.copy(fontFamily = Mono))
                }
            }
        }
        if (state.lookup?.isEmpty() == true) {
            Text("Tidak ada yang cocok.", style = Type.meta)
        }
    }
}
