package id.itulah.kasir.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.itulah.kasir.data.Money
import id.itulah.kasir.data.ShiftReport

/**
 * The drawer: opening it, feeding it, and counting it.
 *
 * The close is **blind**. What the cashier counted goes up with the request and
 * the expected figure comes back with the answer — a cashier shown the
 * expectation first counts toward it, and then the count has told nobody
 * anything.
 *
 * Only cash is in the drawer. Card and QRIS takings are reported beside it and
 * never added to it: a report that summed them would show a shortage every
 * single evening, for exactly the card takings.
 */
@Composable
fun ShiftScreen(
    shift: ShiftReport?,
    busy: Boolean,
    /// Sales the store server has not taken yet, and sales it refused. The
    /// drawer cannot be closed while either is above nil.
    unsent: Int,
    refused: Int,
    onOpen: (Long) -> Unit,
    onMovement: (kind: String, amountMinor: Long, reason: String) -> Unit,
    onClose: (Long, String?) -> Unit,
    onBack: () -> Unit,
) {
    Column(
        // `.page` / `.page-inner`: a secondary page is a centred column, not
        // the width of the counter.
        Modifier
            .fillMaxSize()
            .background(Soft3)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 22.dp)
            .wrapContentWidth(androidx.compose.ui.Alignment.CenterHorizontally)
            .widthIn(max = 880.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Shift", style = Type.hero.copy(fontSize = 24.sp, letterSpacing = (-0.6).sp))
            GhostButton("Kembali", onBack, Modifier.width(120.dp))
        }
        Spacer(Modifier.height(14.dp))

        if (shift == null) {
            OpenShift(busy, onOpen)
            return@Column
        }

        Card(Modifier.fillMaxWidth()) {
            SectionLabel("Laporan Z · ${shift.terminalId}")
            Spacer(Modifier.height(8.dp))
            KeyValue("Modal awal", Money.grouped(shift.openingFloatMinor))
            KeyValue("Kas masuk/keluar", Money.grouped(shift.cashMovementsMinor))
            if (shift.voidedCount > 0) KeyValue("Dibatalkan", "${shift.voidedCount}", tone = Warn)
            // A cashier is served the report blind and sees none of what the
            // drawer should hold — not the takings, not the expectation. A
            // supervisor signed in on this tablet reads it whole.
            if (!shift.blind) {
                KeyValue("Penjualan (${shift.saleCount})", Money.grouped(shift.salesTotalMinor))
                KeyValue("Tunai", Money.grouped(shift.cashSalesMinor))
                KeyValue("Non-tunai", Money.grouped(shift.nonCashMinor))
                KeyValue("Kembalian keluar", "−" + Money.grouped(shift.changeGivenMinor))
                KeyValue("Retur tunai", "−" + Money.grouped(shift.cashRefundsMinor))
                Divider(Modifier.padding(vertical = 8.dp))
                KeyValue("Seharusnya di laci", Money.format(shift.expectedCashMinor), strong = true)
            }
        }

        Spacer(Modifier.height(12.dp))
        CashMovement(busy, onMovement)
        Spacer(Modifier.height(12.dp))
        CloseShift(busy, unsent, refused, onClose)
    }
}

@Composable
private fun OpenShift(busy: Boolean, onOpen: (Long) -> Unit) {
    var float by remember { mutableStateOf("") }
    Card(Modifier.fillMaxWidth()) {
        SectionLabel("Buka shift")
        Spacer(Modifier.height(6.dp))
        Text(
            "Berapa uang yang ada di laci sekarang. Angka ini yang jadi dasar " +
                "perhitungan sore nanti.",
            fontSize = 13.sp,
            color = Mute,
        )
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
            value = float,
            onValueChange = { float = it.filter { c -> c.isDigit() } },
            label = { Text("Modal awal") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(10.dp))
        PrimaryButton("Buka", { onOpen(Money.parse(float)) }, Modifier.fillMaxWidth(), busy = busy)
    }
}

@Composable
private fun CashMovement(busy: Boolean, onMovement: (String, Long, String) -> Unit) {
    var kind by remember { mutableStateOf("DROP") }
    var amount by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    Card(Modifier.fillMaxWidth()) {
        SectionLabel("Kas masuk / keluar")
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            // Signed at the node: money in is positive, out is negative. The
            // four kinds are the vocabulary the ledger already speaks.
            listOf("DROP", "PAYOUT", "PICKUP", "CORRECTION").forEach { candidate ->
                ChoiceTile(
                    candidate,
                    selected = candidate == kind,
                    onClick = { kind = candidate },
                    modifier = Modifier.weight(1f),
                    height = 46.dp,
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = amount,
            onValueChange = { amount = it.filter { c -> c.isDigit() } },
            label = { Text("Jumlah") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = reason,
            onValueChange = { reason = it },
            label = { Text("Alasan") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(10.dp))
        GhostButton(
            "Catat",
            {
                val value = Money.parse(amount)
                val signed = if (kind == "PAYOUT" || kind == "PICKUP") -value else value
                onMovement(kind, signed, reason)
                amount = ""; reason = ""
            },
            Modifier.fillMaxWidth(),
            enabled = !busy && amount.isNotBlank() && reason.isNotBlank(),
        )
    }
}

@Composable
private fun CloseShift(busy: Boolean, unsent: Int, refused: Int, onClose: (Long, String?) -> Unit) {
    var counted by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    // A sale the store server has not acknowledged belongs to this drawer, and
    // closing fixes what the drawer should hold. Closed first, it would arrive
    // afterwards as cash nobody counted. A refused one does not hold the shift
    // open: this tablet has no way to put it right (the desktop till's
    // "Selesaikan" needs the store head), so it stays listed here and on the
    // desk, and its money shows up as a drawer surplus head office can trace.
    val owed = unsent
    Card(Modifier.fillMaxWidth()) {
        SectionLabel("Tutup shift")
        Spacer(Modifier.height(6.dp))
        if (unsent > 0 || refused > 0) {
            val why = buildList<String> {
                if (unsent > 0) {
                    add(
                        "$unsent penjualan belum terkirim ke server toko — tunggu sampai " +
                            "terkirim sebelum tutup shift.",
                    )
                }
                if (refused > 0) {
                    add(
                        "$refused penjualan ditolak server toko — tetap tersimpan di tablet " +
                            "ini. Uangnya akan terlihat sebagai selisih laci; laporkan ke " +
                            "kepala toko.",
                    )
                }
            }
            Notice(text = why.joinToString("\n"), bad = refused > 0, warn = refused == 0)
            Spacer(Modifier.height(10.dp))
        }
        Text(
            "Hitung laci dulu, baru isi angkanya. Selisihnya muncul setelah " +
                "dikirim — bukan sebelum.",
            fontSize = 13.sp,
            color = Mute,
        )
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
            value = counted,
            onValueChange = { counted = it.filter { c -> c.isDigit() } },
            label = { Text("Hasil hitungan") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = note,
            onValueChange = { note = it },
            label = { Text("Catatan (opsional)") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(10.dp))
        PrimaryButton(
            "Tutup shift",
            { onClose(Money.parse(counted), note.takeIf { it.isNotBlank() }) },
            Modifier.fillMaxWidth(),
            enabled = counted.isNotBlank() && owed == 0,
            busy = busy,
        )
    }
}
