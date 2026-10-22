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
 */
@Composable
fun ReceiptScreen(
    receipt: ReceiptDocument?,
    sale: SaleResult?,
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
