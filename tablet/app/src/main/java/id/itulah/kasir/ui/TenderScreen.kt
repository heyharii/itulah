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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.itulah.kasir.data.Money
import id.itulah.kasir.data.Tender

/**
 * How it was paid for.
 *
 * Multi-tender is not an advanced case: half on a card and half in cash is an
 * ordinary evening, and a till that recorded only one of them would misreport
 * how the money settled — which is the version that reaches the bank
 * reconciliation, weeks later, as a difference nobody can trace.
 *
 * **Only cash produces change.** A 200,000 card against a 150,000 basket leaves
 * 50,000 on the card and nothing in the shopper's hand, so the change line is
 * computed from the cash tendered and not from the total paid.
 */
@Composable
fun TenderScreen(
    totalMinor: Long,
    busy: Boolean,
    /// What went wrong the last time this screen tried to take the money.
    ///
    /// It must be shown HERE. A refusal raised at the moment of payment and
    /// rendered on the screen behind it is a refusal nobody sees: found on real
    /// hardware, where a sale was declined for insufficient stock and the till
    /// simply sat there with the cash drawer shut and the customer waiting.
    failure: String?,
    onCancel: () -> Unit,
    onConfirm: (List<Tender>) -> Unit,
) {
    var method by remember { mutableStateOf("CASH") }
    var typed by remember { mutableStateOf("") }
    var taken by remember { mutableStateOf(listOf<Tender>()) }

    val settled = taken.sumOf { it.amountMinor }
    val outstanding = (totalMinor - settled).coerceAtLeast(0)
    val cashTaken = taken.filter { it.method == "CASH" }.sumOf { it.amountMinor }
    val nonCash = settled - cashTaken
    // Change comes out of the cash, and only after the non-cash has covered
    // what it covers.
    val change = (cashTaken - (totalMinor - nonCash).coerceAtLeast(0)).coerceAtLeast(0)
    val entered = Money.parse(typed)

    Row(Modifier.fillMaxSize().background(Soft)) {
        Column(Modifier.fillMaxHeight().weight(0.55f).padding(16.dp)) {
            SectionLabel("Cara bayar")
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                // Indigo, not ink. In this system indigo means *selected* and
                // nothing else; painting the chosen method black would borrow
                // the one colour reserved for the button that takes the money.
                Tender.METHODS.take(4).forEach { candidate ->
                    GhostButton(
                        candidate,
                        { method = candidate },
                        Modifier.weight(1f),
                        selected = candidate == method,
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            SectionLabel("Jumlah")
            Text(
                if (typed.isBlank()) Money.format(outstanding) else Money.format(entered),
                fontSize = 34.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace,
            )
            Spacer(Modifier.height(10.dp))

            // Denominations rather than a keypad alone: the note in the
            // customer's hand is one of six, and tapping it is one touch
            // instead of six digits at the moment everyone is waiting.
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(50_000L, 100_000L, 150_000L, 200_000L).forEach { note ->
                    GhostButton(
                        Money.grouped(note),
                        { typed = note.toString() },
                        Modifier.weight(1f),
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                GhostButton("Pas", { typed = outstanding.toString() }, Modifier.weight(1f))
                GhostButton("Hapus", { typed = "" }, Modifier.weight(1f))
            }

            Spacer(Modifier.height(10.dp))
            Keypad(onDigit = { typed += it }, onBackspace = { typed = typed.dropLast(1) })
        }

        Box(Modifier.width(1.dp).fillMaxHeight().background(Hairline))

        Column(Modifier.fillMaxHeight().weight(0.45f).padding(16.dp)) {
            if (failure != null) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .background(BadBg, RoundedCornerShape(8.dp))
                        .padding(12.dp),
                ) {
                    Text("Pembayaran ditolak", color = BadFg, fontWeight = FontWeight.Medium, fontSize = 14.sp)
                    Text(failure, style = Type.meta.copy(color = BadFg))
                }
                Spacer(Modifier.height(10.dp))
            }
            KeyValue("Total", Money.format(totalMinor), strong = true)
            Divider(Modifier.padding(vertical = 8.dp))
            taken.forEach { tender ->
                KeyValue(tender.method, Money.grouped(tender.amountMinor))
            }
            if (taken.isNotEmpty()) Divider(Modifier.padding(vertical = 8.dp))
            KeyValue("Kurang", Money.format(outstanding), tone = if (outstanding > 0) BadFg else OkFg)
            if (change > 0) KeyValue("Kembali", Money.format(change), strong = true, tone = OkFg)

            Spacer(Modifier.weight(1f))
            GhostButton(
                "Tambah pembayaran",
                {
                    val amount = if (entered > 0) entered else outstanding
                    if (amount > 0) {
                        taken = taken + Tender(method, amount)
                        typed = ""
                    }
                },
                Modifier.fillMaxWidth(),
                enabled = outstanding > 0 || entered > 0,
            )
            Spacer(Modifier.height(8.dp))
            PrimaryButton(
                text = "Selesaikan",
                onClick = {
                    // The straightforward case never touches the list above: one
                    // tender, typed or implied, and the sale goes.
                    val tenders = if (taken.isEmpty()) {
                        listOf(Tender(method, if (entered > 0) entered else totalMinor))
                    } else if (outstanding > 0 && entered > 0) {
                        taken + Tender(method, entered)
                    } else {
                        taken
                    }
                    onConfirm(tenders)
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = taken.isNotEmpty() || entered > 0 || outstanding == 0L,
                busy = busy,
            )
            Spacer(Modifier.height(8.dp))
            GhostButton("Batal", onCancel, Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun Keypad(onDigit: (String) -> Unit, onBackspace: () -> Unit) {
    val rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("000", "0", "⌫"))
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        rows.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { key ->
                    GhostButton(
                        key,
                        { if (key == "⌫") onBackspace() else onDigit(key) },
                        Modifier.weight(1f),
                    )
                }
            }
        }
    }
}
