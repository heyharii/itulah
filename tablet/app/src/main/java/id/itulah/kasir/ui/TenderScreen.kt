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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.itulah.kasir.data.Money
import id.itulah.kasir.data.Tender
import id.itulah.kasir.pos.BasketLine

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
 *
 * # Three things this screen does that the desk cannot
 *
 * **It carries the basket with it.** The desk is gone the moment money is being
 * taken, so the column on the right lists what is being paid for, grouped by
 * garment. Without it the only way to answer "what am I paying for?" is to
 * cancel out of the payment.
 *
 * **It counts the change into notes.** The figure is what the drawer owes; the
 * breakdown is what the hand gives. Reading `Rp 84.000` and reaching for notes
 * is where a busy counter short-changes somebody.
 *
 * **One button, never two.** An earlier version offered *Tambah pembayaran*
 * beside *Selesaikan*, and pressing the second one under-tendered made a short
 * sale. Here the single button says what it is about to do with the amount on
 * screen: settle and finish, take part of it, or — once the balance is covered
 * — finish. The change is previewed from what is typed, so the one-tap cash
 * sale stays one tap.
 */
@Composable
fun TenderScreen(
    totalMinor: Long,
    /// What is being paid for. Individual units, as the desk holds them; they
    /// are grouped by garment here because a column 45% wide listing thirty
    /// identical shirts is a column nobody reads.
    lines: List<BasketLine>,
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

    // What the amount on screen would settle to if it were taken now. This is
    // the number the cashier needs *before* the tap, not after it.
    val offered = if (entered > 0) entered else outstanding
    val previewCash = cashTaken + if (method == "CASH") offered else 0
    val previewNonCash = nonCash + if (method == "CASH") 0 else offered
    val previewChange =
        (previewCash - (totalMinor - previewNonCash).coerceAtLeast(0)).coerceAtLeast(0)
    val covered = outstanding == 0L
    val partial = !covered && entered > 0 && entered < outstanding

    Row(Modifier.fillMaxSize().background(Soft)) {
        // ── Left: what the cashier does ──────────────────────────────────
        Column(Modifier.fillMaxHeight().weight(0.55f).padding(16.dp)) {
            if (covered) {
                // Nothing here can still be filled in, and a row of live-looking
                // controls that no longer change anything is the part of a till
                // that gets tapped by mistake.
                Settled(change)
            } else {
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
                    Money.format(offered),
                    fontSize = 34.sp,
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = FontFamily.Monospace,
                    color = if (typed.isBlank()) Body else Ink,
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
        }

        Box(Modifier.width(1.dp).fillMaxHeight().background(Hairline))

        // ── Right: what it comes to ──────────────────────────────────────
        // The same column the desk keeps its money in, so the figure a cashier
        // watches does not move across the screen when the payment starts.
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

            Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                SectionLabel("Barang")
                Spacer(Modifier.height(6.dp))
                grouped(lines).forEach { group ->
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 3.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            "${group.count}× ${group.name}",
                            style = Type.cell,
                            modifier = Modifier.weight(1f).padding(end = 10.dp),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(Money.grouped(group.totalMinor), style = Type.cell)
                    }
                }

                if (taken.isNotEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    SectionLabel("Diterima")
                    Spacer(Modifier.height(2.dp))
                    taken.forEach { tender ->
                        KeyValue(tender.method, Money.grouped(tender.amountMinor))
                    }
                }
            }

            Divider(Modifier.padding(vertical = 8.dp))
            KeyValue("Kurang", Money.format(outstanding), tone = if (outstanding > 0) BadFg else OkFg)
            if (change > 0) {
                KeyValue("Kembali", Money.format(change), strong = true, tone = OkFg)
                Notes(change)
            } else if (previewChange > 0) {
                // Not yet owed — but it is what this tap will owe, and the
                // cashier is already counting notes while the customer waits.
                KeyValue("Kembali nanti", Money.format(previewChange), tone = Body)
            }

            Spacer(Modifier.height(10.dp))
            PrimaryButton(
                text = when {
                    covered -> "Selesaikan"
                    partial -> "Bayar sebagian ${Money.grouped(entered)}"
                    else -> "Bayar ${Money.grouped(offered)} & selesaikan"
                },
                onClick = {
                    when {
                        // Everything is already covered by what was recorded.
                        covered -> onConfirm(taken)
                        // Part of it, in this method: record and stay, because
                        // the rest still has to be taken somehow.
                        partial -> {
                            taken = taken + Tender(method, entered)
                            typed = ""
                        }
                        // The ordinary sale: one tender, and the money is taken
                        // and the sale closed by the same tap.
                        else -> onConfirm(taken + Tender(method, offered))
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = offered > 0 || covered,
                busy = busy,
            )
            Spacer(Modifier.height(8.dp))
            GhostButton("Batal", onCancel, Modifier.fillMaxWidth())
        }
    }
}

/** One garment, however many of its tags are in the basket. */
private data class Group(val name: String, val count: Int, val totalMinor: Long)

private fun grouped(lines: List<BasketLine>): List<Group> =
    lines.groupBy { it.skuCode to it.name }
        .map { (key, units) ->
            Group(key.second, units.size, units.sumOf { it.unitPriceMinor })
        }

/**
 * The balance is covered, and the only thing left is to finish.
 *
 * Said with the change, because that is the number standing between the cashier
 * and the next customer.
 */
@Composable
private fun Settled(change: Long) {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.size(58.dp).background(OkBg, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Check, null, Modifier.size(26.dp), tint = OkFg)
        }
        Spacer(Modifier.height(12.dp))
        Text("Nominal sudah lunas", style = Type.hero)
        Spacer(Modifier.height(6.dp))
        Text(
            if (change > 0) "Kembalian ${Money.format(change)} — rinciannya di kanan."
            else "Tidak ada kembalian.",
            style = Type.meta,
        )
    }
}

/**
 * The change, counted into what the drawer actually holds.
 *
 * Rupiah below 100 is not issued; anything left under it is rounding the sale
 * already settled, so it is not printed as a note nobody can hand over.
 */
@Composable
private fun Notes(change: Long) {
    val denominations = listOf(
        100_000L, 50_000L, 20_000L, 10_000L, 5_000L, 2_000L, 1_000L, 500L, 200L, 100L,
    )
    var rest = change
    val counted = buildList {
        for (note in denominations) {
            val many = rest / note
            if (many > 0) {
                add(many to note)
                rest -= many * note
            }
        }
    }
    if (counted.isEmpty()) return
    Column(Modifier.padding(top = 4.dp)) {
        counted.forEach { (many, note) ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 1.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("$many× ${Money.grouped(note)}", style = Type.pill)
                Text(Money.grouped(many * note), style = Type.pill)
            }
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
