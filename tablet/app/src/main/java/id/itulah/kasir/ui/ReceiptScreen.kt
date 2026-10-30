package id.itulah.kasir.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.itulah.kasir.data.Money
import id.itulah.kasir.data.OutboxEntry
import id.itulah.kasir.data.skuDisplay
import id.itulah.kasir.data.ReceiptDocument
import id.itulah.kasir.data.SaleResult
import id.itulah.kasir.data.WhenIt

/**
 * The sale, done — and the paper, on screen.
 *
 * The top is what the cashier needs in the next second: the change to hand
 * over, or, when there is none, what was paid. It comes from the sale itself,
 * so it is there the instant the sale is, before the receipt has been fetched.
 * Under it is the node's own `ReceiptDocument`, the same one the ESC/POS
 * renderer prints from — so what a cashier reads back to a customer over the
 * phone and what came out of the printer cannot drift. Every print after the
 * first is stamped a copy: two identical receipts in a drawer at the end of the
 * day are two sales to whoever counts them.
 *
 * The one blue button starts the next sale; printing is a plain word beside it.
 *
 * # A sale the store server has not taken
 *
 * The cashier has the money, so this screen can be reached before the node has
 * said anything. [pending] is that sale, straight from the outbox: it shows
 * what is true — "Tersimpan di kasir ini" — and no receipt, because a sale the
 * node has not named has no receipt to read and nothing to print against. The
 * moment the node takes it the caller stops passing [pending] and the screen is
 * the ordinary one; if the node refuses it, it says so, in the node's words.
 */
@Composable
fun ReceiptScreen(
    receipt: ReceiptDocument?,
    sale: SaleResult?,
    /// The sale just rung, while the node has not taken it. Null once it has.
    pending: OutboxEntry?,
    /// Its first attempt is still in flight: say "sending", not "saved here".
    settling: Boolean,
    /// The disk is not keeping the outbox; everything owed is only in memory.
    storageProblem: String?,
    hasPrinter: Boolean,
    busy: Boolean,
    onPrint: (copy: Boolean) -> Unit,
    onBack: () -> Unit,
) {
    val change = sale?.changeMinor ?: receipt?.changeMinor ?: 0L
    val total = sale?.totalMinor ?: receipt?.totalMinor
    val how = receipt?.tenders?.map { methodLabel(it.method) }?.distinct()?.joinToString(" + ")

    Box(Modifier.fillMaxSize().background(Soft3), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier
                .widthIn(max = 480.dp)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (pending != null) {
                Pending(pending, settling, storageProblem, onBack)
                return@Column
            }

            if (total == null) {
                Text("Receipt not loaded.", style = Type.meta)
                Spacer(Modifier.height(16.dp))
                PrimaryButton("New sale", onBack, Modifier.fillMaxWidth())
                return@Column
            }

            // `.seal` and `.big`
            Box(
                Modifier.size(56.dp).background(OkBg, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Glyph.CheckBold, null, Modifier.size(26.dp), tint = OkFg)
            }
            Spacer(Modifier.height(10.dp))
            Text(if (change > 0) "Change" else "Paid", style = Type.control.copy(color = Mute))
            Text(
                Money.format(if (change > 0) change else total),
                style = Type.money.copy(fontSize = 44.sp),
                maxLines = 1,
            )
            val meta = listOfNotNull(if (change > 0) Money.format(total) else null, how).joinToString(" · ")
            if (meta.isNotEmpty()) Text(meta, style = Type.meta, textAlign = TextAlign.Center)
            Spacer(Modifier.height(18.dp))

            if (receipt != null) {
                Card(Modifier.fillMaxWidth()) {
                    Text(receipt.shopName, style = Type.cardTitle)
                    Text("No ${receipt.receiptNo}", style = Type.id)
                    Text(WhenIt.local(receipt.completedAt), style = Type.meta)
                    Text("Cashier ${receipt.cashier}", style = Type.meta)
                    if (receipt.stamp != null) {
                        Spacer(Modifier.height(6.dp))
                        Text(receipt.stamp, style = Type.control.copy(color = Bad, fontWeight = FontWeight.Bold))
                    }
                    Divider(Modifier.padding(vertical = 10.dp))
                    receipt.lines.forEach { line ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Column(Modifier.weight(1f).padding(end = 12.dp)) {
                                Text(line.name, style = Type.metric)
                                if (line.skuCode.isNotBlank()) Text(skuDisplay(line.skuCode), style = Type.id)
                                Text(
                                    "${line.quantity} × ${Money.grouped(line.unitPriceMinor)}",
                                    style = Type.meta.copy(color = Mute),
                                )
                            }
                            Text(Money.grouped(line.lineTotalMinor), style = Type.cell)
                        }
                        Spacer(Modifier.height(6.dp))
                    }
                    Divider(Modifier.padding(vertical = 10.dp))
                    KeyValue("Subtotal", Money.grouped(receipt.subtotalMinor))
                    if (receipt.discountMinor > 0) {
                        KeyValue("Discount", "−" + Money.grouped(receipt.discountMinor), tone = OkFg)
                    }
                    KeyValue("Total", Money.format(receipt.totalMinor), strong = true)
                    receipt.tenders.forEach { KeyValue(methodLabel(it.method), Money.grouped(it.amountMinor)) }
                    if (receipt.changeMinor > 0) KeyValue("Change", Money.grouped(receipt.changeMinor))
                }
                Spacer(Modifier.height(16.dp))
            }

            PrimaryButton("New sale", onBack, Modifier.fillMaxWidth())
            if (hasPrinter) {
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    QuietButton("Print", { if (!busy) onPrint(false) })
                    QuietButton("Print copy", { if (!busy) onPrint(true) })
                }
            }
        }
    }
}

/**
 * The sale is rung and the money is taken, and the node has not said yes.
 *
 * Three headings, and the cashier reads which one before the next customer
 * steps up: on its way (the first attempt, a few seconds at most), saved here
 * and waiting (the pump sends it again), or refused by the node, which waits
 * for a person. The figure is the same one the done screen leads with — the
 * change to hand over, else what was paid — worked locally from the tenders,
 * because the node has not priced the receipt yet and the customer is standing
 * there.
 */
@Composable
private fun Pending(entry: OutboxEntry, settling: Boolean, storageProblem: String?, onBack: () -> Unit) {
    val refused = entry.refused
    val change = entry.changeMinor
    val heading = when {
        refused -> "Ditolak server toko"
        settling -> "Mengirim ke server toko…"
        else -> "Tersimpan di kasir ini"
    }
    val how = entry.tenders.map { methodLabel(it.method) }.distinct().joinToString(" + ")

    Box(
        Modifier.size(56.dp).background(if (refused) BadBg else WarnBg, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            if (refused) Glyph.Alert else Glyph.Clock,
            null,
            Modifier.size(26.dp),
            tint = if (refused) BadFg else WarnFg,
        )
    }
    Spacer(Modifier.height(10.dp))
    Text(heading, style = Type.hero, textAlign = TextAlign.Center)
    Spacer(Modifier.height(14.dp))
    Text(if (change > 0) "Change" else "Paid", style = Type.control.copy(color = Mute))
    Text(
        Money.format(if (change > 0) change else entry.quotedTotalMinor),
        style = Type.money.copy(fontSize = 44.sp),
        maxLines = 1,
    )
    val meta = listOfNotNull(if (change > 0) Money.format(entry.quotedTotalMinor) else null, how.ifBlank { null })
        .joinToString(" · ")
    if (meta.isNotEmpty()) Text(meta, style = Type.meta, textAlign = TextAlign.Center)
    Spacer(Modifier.height(18.dp))

    if (storageProblem != null) {
        Notice(storageProblem, bad = true, title = "Penyimpanan kasir")
        Spacer(Modifier.height(10.dp))
    }
    when {
        refused -> Notice(
            text = (entry.problem ?: "Server toko menolak penjualan ini tanpa alasan.") +
                "\nPenjualan tetap tersimpan di kasir ini.",
            bad = true,
            title = "Ditolak server toko",
        )
        !settling -> Notice(
            text = "Dikirim otomatis begitu server toko menjawab; struk dicetak setelah terkirim." +
                (entry.problem?.let { "\n$it" } ?: ""),
            warn = true,
        )
    }
    Spacer(Modifier.height(16.dp))
    PrimaryButton("New sale", onBack, Modifier.fillMaxWidth())
}
