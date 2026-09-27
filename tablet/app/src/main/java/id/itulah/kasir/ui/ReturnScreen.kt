package id.itulah.kasir.ui

import androidx.compose.foundation.background
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.itulah.kasir.data.Config
import id.itulah.kasir.data.Money
import id.itulah.kasir.data.ReturnLine
import id.itulah.kasir.data.Tender
import id.itulah.kasir.pos.TillState

/** One garment the customer is handing back, as the cashier has scanned it. */
data class ReturningLine(
    val epc: String,
    val skuCode: String,
    val name: String,
    val disposition: String = ReturnLine.RESALEABLE,
)

/**
 * Taking it back.
 *
 * # Why the garments are scanned rather than ticked off a list
 *
 * A receipt says a shirt was sold; it does not say *which* shirt. The shop has
 * forty of that style and the ledger tracks units, so a return that guessed
 * would leave one unit sold forever and put a different one back on the rail.
 * The tag decides, exactly as it did on the way out.
 *
 * # What needs a supervisor and what does not
 *
 * Both a return and a void do — they move money the other way, and a reversal
 * nobody signed is a reversal nobody can be asked about. Selling from the
 * stockroom does not, by ruling: that is an ordinary sale where somebody walked
 * to the back.
 */
@Composable
fun ReturnScreen(
    state: TillState,
    config: Config,
    lines: List<ReturningLine>,
    refundMethod: String,
    busy: Boolean,
    onScan: (String) -> Unit,
    onDisposition: (String, String) -> Unit,
    onRemove: (String) -> Unit,
    onRefundMethod: (String) -> Unit,
    onSubmit: () -> Unit,
    onVoidWhole: () -> Unit,
    onBack: () -> Unit,
) {
    val sale = state.lastSale
    val refund = lines.sumOf { line ->
        state.receipt?.lines?.firstOrNull { it.skuCode == line.skuCode }?.lineTotalMinor ?: 0L
    }

    // The desk's two panes, so a return reads as the same counter.
    Row(
        Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Pane(Modifier.fillMaxHeight().weight(0.44f)) {
        Column(Modifier.fillMaxSize().padding(18.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Retur", style = Type.hero)
                GhostButton("Kembali", onBack, Modifier.width(130.dp))
            }
            Spacer(Modifier.height(10.dp))

            if (sale == null) {
                Card(Modifier.fillMaxWidth()) {
                    Text(
                        "Belum ada penjualan di kasir ini untuk diretur. Struk yang " +
                            "dibawa pulang pelanggan lain belum bisa dicari dari sini.",
                        style = Type.prose,
                    )
                }
                return@Column
            }

            Card(Modifier.fillMaxWidth()) {
                SectionLabel("Penjualan terakhir")
                Spacer(Modifier.height(6.dp))
                KeyValue("Struk", state.receipt?.receiptNo ?: "—")
                KeyValue("Nilai", Money.format(sale.totalMinor))
            }

            Spacer(Modifier.height(12.dp))
            SectionLabel("Pindai barang yang kembali")
            Spacer(Modifier.height(6.dp))
            ScanField(onScan = onScan, placeholder = "Pindai tag barang yang diretur")

            Spacer(Modifier.height(14.dp))
            SectionLabel("Uang dikembalikan lewat")
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                // Not assumed from the original sale: a card sale refunded in
                // cash happens every day.
                // Never a voucher: the node refuses paying one back out.
                Tender.METHODS.filter { it != "OTHER" && it != "VOUCHER" }.forEach { method ->
                    ChoiceTile(
                        when (method) {
                            "CASH" -> "Tunai"; "CARD" -> "Kartu"; "EWALLET" -> "E-Wallet"; "VOUCHER" -> "Voucher"; else -> method
                        },
                        selected = method == refundMethod,
                        onClick = { onRefundMethod(method) },
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            Spacer(Modifier.weight(1f))
            GhostButton(
                "Batalkan seluruh penjualan",
                onVoidWhole,
                Modifier.fillMaxWidth(),
                tone = BadFg,
            )
        }
        }

        Pane(Modifier.fillMaxHeight().weight(0.56f)) {
            Column(Modifier.weight(1f).padding(18.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    SectionLabel("Barang kembali")
                    SectionLabel("${lines.size} unit")
                }
                Spacer(Modifier.height(8.dp))
                if (lines.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("Pindai barang pertama.", style = Type.meta)
                    }
                } else {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(lines, key = { it.epc }) { line ->
                            Card(Modifier.fillMaxWidth()) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Thumb(line.skuCode, config, 44.dp)
                                    Spacer(Modifier.width(10.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            line.name,
                                            style = Type.cardTitle,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                        Text("…" + line.epc.takeLast(6), style = Type.id)
                                    }
                                    GhostButton(
                                        "Layak jual",
                                        { onDisposition(line.epc, ReturnLine.RESALEABLE) },
                                        Modifier.width(120.dp),
                                        selected = line.disposition == ReturnLine.RESALEABLE,
                                    )
                                    Spacer(Modifier.width(6.dp))
                                    GhostButton(
                                        "Rusak",
                                        { onDisposition(line.epc, ReturnLine.DAMAGED) },
                                        Modifier.width(96.dp),
                                        selected = line.disposition == ReturnLine.DAMAGED,
                                        tone = BadFg,
                                    )
                                    Spacer(Modifier.width(6.dp))
                                    GhostButton("Buang", { onRemove(line.epc) }, Modifier.width(96.dp))
                                }
                            }
                        }
                    }
                }
            }

            Divider()
            Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 16.dp)) {
                Grand("DIKEMBALIKAN", Money.format(refund), size = 24.sp)
                Spacer(Modifier.height(10.dp))
                PrimaryButton(
                    "Proses retur",
                    onSubmit,
                    Modifier.fillMaxWidth(),
                    enabled = lines.isNotEmpty(),
                    busy = busy,
                )
                Text(
                    "Butuh persetujuan supervisor. Barang rusak masuk pool reject, " +
                        "bukan kembali ke rak.",
                    style = Type.pill,
                )
            }
        }
    }
}
