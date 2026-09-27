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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.itulah.kasir.data.Money
import id.itulah.kasir.data.WhenIt
import id.itulah.kasir.data.ReceiptDocument

/**
 * The paper, on screen.
 *
 * Rendered from the node's own `ReceiptDocument`, the same one the ESC/POS
 * renderer prints from — so what a cashier reads back to a customer over the
 * phone and what came out of the printer cannot drift. Every print after the
 * first is stamped a copy: two identical receipts in a drawer at the end of the
 * day are two sales to whoever counts them.
 */
@Composable
fun ReceiptScreen(
    receipt: ReceiptDocument?,
    hasPrinter: Boolean,
    busy: Boolean,
    onPrint: (copy: Boolean) -> Unit,
    onBack: () -> Unit,
) {
    Box(Modifier.fillMaxSize().background(Soft3), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 460.dp).verticalScroll(rememberScrollState()).padding(16.dp),
        ) {
            if (receipt == null) {
                Text("Struk belum dimuat.", color = Mute)
                Spacer(Modifier.height(12.dp))
                GhostButton("Kembali", onBack, Modifier.fillMaxWidth())
                return@Column
            }

            Card(Modifier.fillMaxWidth()) {
                Text(receipt.shopName, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                Text("No ${receipt.receiptNo}", fontSize = 12.sp, color = Mute, fontFamily = Mono)
                Text(WhenIt.local(receipt.completedAt), fontSize = 11.sp, color = Mute)
                Text("Kasir ${receipt.cashier}", fontSize = 11.sp, color = Mute)
                if (receipt.stamp != null) {
                    Spacer(Modifier.height(6.dp))
                    Text(receipt.stamp, fontSize = 14.sp, color = Bad, fontWeight = FontWeight.Bold)
                }
                Divider(Modifier.padding(vertical = 10.dp))
                receipt.lines.forEach { line ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column(Modifier.weight(1f)) {
                            Text(line.name, fontSize = 13.sp)
                            Text(
                                "${line.quantity} × ${Money.grouped(line.unitPriceMinor)}",
                                fontSize = 11.sp,
                                color = Mute,
                            )
                        }
                        Text(
                            Money.grouped(line.lineTotalMinor),
                            fontSize = 13.sp,
                            fontFamily = Mono,
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                }
                Divider(Modifier.padding(vertical = 10.dp))
                KeyValue("Subtotal", Money.grouped(receipt.subtotalMinor))
                if (receipt.discountMinor > 0) {
                    KeyValue("Potongan", "−" + Money.grouped(receipt.discountMinor), tone = Ok)
                }
                KeyValue("Total", Money.format(receipt.totalMinor), strong = true)
                receipt.tenders.forEach { KeyValue(it.method, Money.grouped(it.amountMinor)) }
                if (receipt.changeMinor > 0) KeyValue("Kembali", Money.grouped(receipt.changeMinor))
            }

            Spacer(Modifier.height(12.dp))
            PrimaryButton(
                if (hasPrinter) "Cetak" else "Printer belum diatur",
                { onPrint(false) },
                Modifier.fillMaxWidth(),
                enabled = hasPrinter,
                busy = busy,
            )
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GhostButton("Cetak salinan", { onPrint(true) }, Modifier.weight(1f), enabled = hasPrinter)
                GhostButton("Kembali", onBack, Modifier.weight(1f))
            }
        }
    }
}
