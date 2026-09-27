package id.itulah.kasir.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
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
import id.itulah.kasir.data.PaymentMethod
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
    /// Finance's payment methods (or the till's built-in fallback list).
    methods: List<PaymentMethod> = PaymentMethod.FALLBACK,
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
    // One tile per tender type; a type with several methods (Debit → BCA,
    // Mandiri…) then asks which one. VOUCHER is offered as before and still
    // carries no hold or code from this screen (the tablet's known limitation).
    var type by remember { mutableStateOf("CASH") }
    var pick by remember { mutableStateOf<PaymentMethod?>(null) }
    val groups = methods.ifEmpty { PaymentMethod.FALLBACK }.groupBy { it.tenderType }
    val group = groups[type] ?: groups.values.first()
    val chosen = pick?.takeIf { it in group } ?: group.singleOrNull()
    // What the node calls it (`CASH`, `CARD`, `QRIS`, `EWALLET`, `VOUCHER`).
    val method = (chosen ?: group.first()).wireMethod
    var typed by remember { mutableStateOf("") }
    var taken by remember { mutableStateOf(listOf<Tender>()) }
    // The approval code off the EDC slip or the wallet's screen, pos-desktop's
    // rule: every card, QRIS and e-wallet tender carries one, so the bank
    // reconciliation can find the sale. The keypad types into whichever of
    // the two fields was tapped last.
    var approval by remember { mutableStateOf("") }
    var target by remember { mutableStateOf(Field.AMOUNT) }

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
    val needsApproval = method in APPROVED
    val approvalMissing = needsApproval && approval.length < 4
    val typingApproval = needsApproval && target == Field.APPROVAL
    // "BCA · 884213", as pos-desktop writes it: the receipt prints the
    // reference and not the acquirer.
    fun referenceFor(one: PaymentMethod): String? =
        if (!needsApproval) null else one.acquirer?.let { "$it · $approval" } ?: approval

    // CASH-only shortcuts, pos-desktop's rule: exactly what is owed, then the
    // next note up that a customer is likely to be holding.
    val presets = if (method != "CASH" || outstanding <= 0) emptyList() else
        listOf(
            outstanding,
            ceilTo(outstanding, 50_000),
            ceilTo(outstanding, 100_000),
            500_000L,
        ).filter { it >= outstanding }.distinct()

    // `.pay-page`: the work on the left, the rail with the money on the right.
    Row(
        Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // ── `.pay-main`: what the cashier does ───────────────────────────
        Pane(Modifier.fillMaxHeight().weight(1f)) {
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 22.dp, vertical = 18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Column(
                    Modifier.widthIn(max = 560.dp).fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    if (covered) {
                        // Nothing here can still be filled in, and a row of
                        // live-looking controls that no longer change anything
                        // is the part of a till that gets tapped by mistake.
                        Settled(change)
                    } else {
                        Column {
                            SectionLabel("Metode pembayaran")
                            Spacer(Modifier.height(8.dp))
                            KeyRow(gap = 9.dp) {
                                // Blue, not ink. The accent means *selected* and
                                // nothing else.
                                groups.forEach { (tenderType, members) ->
                                    ChoiceTile(
                                        if (members.size == 1) members[0].name else typeLabel(tenderType),
                                        selected = members === group,
                                        onClick = { type = tenderType; pick = null; approval = ""; target = Field.AMOUNT },
                                        modifier = Modifier.weight(1f),
                                        height = 58.dp,
                                    )
                                }
                            }
                        }

                        if (group.size > 1) {
                            Column {
                                SectionLabel("Bank / mesin EDC")
                                Spacer(Modifier.height(8.dp))
                                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    group.chunked(4).forEach { row ->
                                        KeyRow {
                                            row.forEach { candidate ->
                                                ChoiceTile(
                                                    candidate.name,
                                                    selected = candidate == chosen,
                                                    onClick = { pick = candidate; approval = "" },
                                                    modifier = Modifier.weight(1f),
                                                )
                                            }
                                            repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
                                        }
                                    }
                                }
                            }
                        }

                        Column {
                            SectionLabel("Nominal")
                            Spacer(Modifier.height(8.dp))
                            // `.amount-field`. Drawn, not an input: the keypad is
                            // the only way in, so no IME ever covers it.
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .height(68.dp)
                                    .background(Canvas, RoundedCornerShape(RInner))
                                    .border(
                                        1.dp,
                                        if (!typingApproval && typed.isNotBlank()) Accent else Hairline2,
                                        RoundedCornerShape(RInner),
                                    )
                                    .clickable { target = Field.AMOUNT }
                                    .padding(horizontal = 18.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text("Rp", style = Type.metric.copy(fontSize = 16.sp, color = Faint))
                                Spacer(Modifier.weight(1f))
                                Text(
                                    Money.grouped(offered),
                                    style = Type.money.copy(fontSize = 31.sp, color = if (typed.isBlank()) Body else Ink),
                                )
                            }
                        }

                        if (needsApproval) {
                            Column {
                                SectionLabel("Kode approval")
                                Spacer(Modifier.height(8.dp))
                                // Drawn like the amount, for the same reason: the
                                // keypad is the way in, so no IME covers the till.
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .height(56.dp)
                                        .background(Canvas, RoundedCornerShape(RInner))
                                        .border(
                                            1.dp,
                                            if (typingApproval) Accent else Hairline2,
                                            RoundedCornerShape(RInner),
                                        )
                                        .clickable { target = Field.APPROVAL }
                                        .padding(horizontal = 18.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        approval.ifBlank { "Ketuk, lalu ketik dari struk EDC" },
                                        style = if (approval.isBlank()) Type.meta.copy(color = Faint)
                                        else Type.metric.copy(fontSize = 21.sp, color = Ink, fontFamily = FontFamily.Monospace),
                                    )
                                }
                            }
                        }

                        Keypad(
                            onDigit = {
                                if (typingApproval) {
                                    // Under twelve digits: the node refuses anything
                                    // that could be a card number.
                                    approval = (approval + it).take(MAX_APPROVAL)
                                } else {
                                    typed = (typed + it).trimStart('0')
                                }
                            },
                            onBackspace = {
                                if (typingApproval) approval = approval.dropLast(1) else typed = typed.dropLast(1)
                            },
                        )

                        // Denominations beside the keypad: the note in the
                        // customer's hand is one of a few, and tapping it is one
                        // touch instead of six digits while everyone waits.
                        if (presets.isNotEmpty()) {
                            KeyRow {
                                presets.forEach { value ->
                                    ChoiceTile(
                                        Money.format(value),
                                        selected = entered == value,
                                        onClick = { typed = value.toString() },
                                        modifier = Modifier.weight(1f),
                                    )
                                }
                                repeat(4 - presets.size) { Spacer(Modifier.weight(1f)) }
                            }
                        }
                    }
                }
            }

            // `.pay-cta` — pinned, so the button is where the thumb left it
            // however far the keypad above had to scroll.
            Column(
                Modifier.fillMaxWidth().padding(start = 22.dp, end = 22.dp, bottom = 18.dp, top = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Column(Modifier.widthIn(max = 560.dp).fillMaxWidth()) {
                if (failure != null) {
                    Notice(failure, bad = true, title = "Pembayaran ditolak")
                    Spacer(Modifier.height(10.dp))
                }
                PrimaryButton(
                    text = when {
                        covered -> "Selesaikan transaksi"
                        chosen == null -> "Pilih bank dulu"
                        approvalMissing -> "Isi kode approval dulu"
                        partial -> "Bayar sebagian ${Money.format(entered)}"
                        else -> "Bayar ${Money.format(offered)} & selesaikan"
                    },
                    onClick = {
                        when {
                            // Everything is already covered by what was recorded.
                            covered -> onConfirm(taken)
                            // Part of it, in this method: record and stay, because
                            // the rest still has to be taken somehow.
                            partial -> chosen?.let {
                                taken = taken + it.tender(entered, referenceFor(it))
                                typed = ""
                                approval = ""
                                target = Field.AMOUNT
                            }
                            // The ordinary sale: one tender, and the money is taken
                            // and the sale closed by the same tap.
                            else -> chosen?.let { onConfirm(taken + it.tender(offered, referenceFor(it))) }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = covered || (offered > 0 && chosen != null && !approvalMissing),
                    busy = busy,
                    height = 66.dp,
                    fontSize = 17.sp,
                )
                }
            }
        }

        // ── `.pay-side`: what it comes to ────────────────────────────────
        // The same side the desk keeps its money on, so the figure a cashier
        // watches does not move across the screen when the payment starts.
        Pane(Modifier.fillMaxHeight().width(320.dp)) {
            // `.pay-back`
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onCancel)
                    .heightIn(min = 52.dp)
                    .padding(horizontal = 18.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("← Kembali ke keranjang", style = Type.control.copy(color = Body))
            }
            Divider()

            // `.pay-summary`
            Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 16.dp)) {
                KeyValue("Item", "${lines.size} unit")
                Spacer(Modifier.height(6.dp))
                Grand("TOTAL", Money.format(totalMinor), size = 24.sp)
            }
            Divider()

            // `.pay-scroll`
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 18.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                SectionLabel("Barang")
                grouped(lines).forEach { group ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(
                            "${group.count}× ${group.name}",
                            style = Type.meta.copy(color = Text),
                            modifier = Modifier.weight(1f).padding(end = 10.dp),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(Money.grouped(group.totalMinor), style = Type.meta.copy(color = Text))
                    }
                }

                if (taken.isNotEmpty()) {
                    Spacer(Modifier.height(4.dp))
                    SectionLabel("Diterima")
                    taken.forEach { tender ->
                        // `.recorded`
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .background(Soft, RoundedCornerShape(RInner))
                                .border(1.dp, Hairline, RoundedCornerShape(RInner))
                                .padding(horizontal = 12.dp, vertical = 11.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(
                                methods.firstOrNull { it.code.isNotBlank() && it.code == tender.paymentMethodCode }?.name
                                    ?: methodLabel(tender.method),
                                style = Type.meta.copy(color = Text),
                            )
                            Text(
                                Money.format(tender.amountMinor),
                                style = Type.meta.copy(color = Ink, fontWeight = FontWeight.SemiBold),
                            )
                        }
                    }
                    if (!covered) {
                        Text("← Boleh ganti metode untuk membayar sisa", style = Type.pill.copy(color = Mute))
                    }
                }
            }

            // `.pay-due`
            Divider()
            Column(
                Modifier.fillMaxWidth().background(Soft).padding(18.dp),
            ) {
                if (covered) {
                    DueLine("Kembalian", Money.format(change), OkFg)
                    if (change > 0) Notes(change)
                } else {
                    DueLine("Sisa", Money.format(outstanding), BadFg)
                    if (previewChange > 0) {
                        // Not yet owed — but it is what this tap will owe, and the
                        // cashier is already counting notes while the customer waits.
                        Spacer(Modifier.height(6.dp))
                        KeyValue("Kembali nanti", Money.format(previewChange), tone = Body)
                    }
                }
            }
        }
    }
}

private fun ceilTo(value: Long, step: Long): Long = ((value + step - 1) / step) * step

/** Which drawn field the keypad types into. */
private enum class Field { AMOUNT, APPROVAL }

/** The tenders that carry an approval code (pos-desktop's `needsReference`,
 *  less the voucher, which this screen still takes without a hold). */
private val APPROVED = setOf("CARD", "QRIS", "EWALLET")

/** Eleven characters at most: twelve digits reads as a card number to the node. */
private const val MAX_APPROVAL = 11

/** The words pos-desktop puts on each method. The wire keeps the codes. */
private fun methodLabel(method: String): String = when (method) {
    "CASH" -> "Tunai"
    "CARD" -> "Kartu"
    "QRIS" -> "QRIS"
    "EWALLET" -> "E-Wallet"
    "VOUCHER" -> "Voucher"
    "OTHER" -> "Lainnya"
    else -> method
}

/** A tile that groups several of Finance's methods, named by its tender type. */
private fun typeLabel(tenderType: String): String = when (tenderType) {
    "DEBIT_CARD" -> "Debit"
    "CREDIT_CARD" -> "Kredit"
    else -> methodLabel(tenderType)
}

/** `.due-line` — Sisa or Kembalian, the number between this customer and the next. */
@Composable
private fun DueLine(label: String, value: String, tone: androidx.compose.ui.graphics.Color) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = Type.cell.copy(color = Body, fontWeight = FontWeight.Medium))
        Text(value, style = Type.money.copy(fontSize = 24.sp, color = tone))
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
        Modifier.fillMaxWidth().padding(vertical = 48.dp),
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
            if (change > 0) "Kembalian ${Money.format(change)} — rincian pecahannya di panel kanan."
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
    Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        SectionLabel("Kembalikan")
        counted.forEach { (many, note) ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 1.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("$many× ${Money.format(note)}", style = Type.pill.copy(color = Body))
                Text(Money.format(many * note), style = Type.pill.copy(color = Body))
            }
        }
    }
}

/** `.numpad` — pos-desktop's order: 7 8 9 on top, the way a till's keys run. */
@Composable
private fun Keypad(onDigit: (String) -> Unit, onBackspace: () -> Unit) {
    val rows = listOf(listOf("7", "8", "9"), listOf("4", "5", "6"), listOf("1", "2", "3"), listOf("⌫", "0", "000"))
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        rows.forEach { row ->
            KeyRow {
                row.forEach { key ->
                    ChoiceTile(
                        key,
                        selected = false,
                        onClick = { if (key == "⌫") onBackspace() else onDigit(key) },
                        modifier = Modifier.weight(1f),
                        height = 56.dp,
                        tone = if (key == "⌫") BadFg else Ink,
                        style = Type.metric.copy(fontSize = 21.sp, fontWeight = FontWeight.Medium),
                    )
                }
            }
        }
    }
}
