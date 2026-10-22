package id.itulah.kasir.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.itulah.kasir.data.BenefitHolder
import id.itulah.kasir.data.Money
import id.itulah.kasir.data.PaymentMethod
import id.itulah.kasir.data.Tender
import id.itulah.kasir.pos.BenefitHold
import kotlinx.coroutines.launch

/**
 * How it was paid for — `pos-web-options.html`, F · Pay 5.
 *
 * A dialog standing over the counter, not a page of its own: the basket stays
 * in view behind it, and closing it is one tap. Two columns, and the line
 * between them is the point. The **left** column is what the cashier does —
 * which method, how much, the one fixed slot, the keypad, the one blue button.
 * The **right** column, on the soft grey, is only the money: what is due, or,
 * once part of it has been taken, the ledger of what came in. Total and
 * methods are never mixed in one column.
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
 * **One slot, one height.** Cash puts Exact and three quick amounts in it; a
 * card puts the bank and the approval code; QRIS and the rest a reference. The
 * slot is 52 dp whatever it holds, so switching method never moves the keypad
 * under a thumb that was already on its way to it.
 *
 * **One button, never two.** An earlier version offered *Tambah pembayaran*
 * beside *Selesaikan*, and pressing the second one under-tendered made a short
 * sale. Here the single button says what it is about to do with the amount on
 * screen: settle and finish, take part of it, or — once the balance is covered
 * — finish. The change is previewed from what is typed, so the one-tap cash
 * sale stays one tap.
 *
 * Motion: the dialog fades and grows from .96 in 200 ms, and leaves in 130 —
 * faster than it came, because closing is the end of a conversation. Nothing
 * else on it moves; a press is a 100–120 ms scale to .97.
 */
@Composable
fun TenderScreen(
    totalMinor: Long,
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
    /// Employee balance already spent on this basket (survives leaving the screen).
    benefitHeld: BenefitHold?,
    /// "Employee balance" cannot be combined with a promotion.
    basketHasPromotion: Boolean,
    onBenefitLookup: (String, (Result<BenefitHolder>) -> Unit) -> Unit,
    onBenefitSpend: (String, Long, (Result<BenefitHolder>, String) -> Unit) -> Unit,
    /// Give a spent balance back; answers whether head office took it.
    onBenefitRelease: ((Boolean) -> Unit) -> Unit,
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
    var taken by remember {
        mutableStateOf(
            listOfNotNull(
                benefitHeld?.let { hold ->
                    methods.firstOrNull { it.tenderType == "BENEFIT" }?.tender(hold.amountMinor, hold.saleRef)
                        ?: Tender("BENEFIT", hold.amountMinor, hold.saleRef)
                },
            ),
        )
    }
    // Employee balance: the 6-digit code off the employee's phone, then who it is.
    var benefitCode by remember { mutableStateOf("") }
    var holder by remember { mutableStateOf<BenefitHolder?>(null) }
    var benefitBusy by remember { mutableStateOf(false) }
    var benefitError by remember { mutableStateOf<String?>(null) }
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

    val benefitMode = method == "BENEFIT"
    val benefitUsed = taken.any { it.method == "BENEFIT" }
    // Never more than is owed or than the balance holds.
    val spendCap = holder?.let { minOf(outstanding, it.balanceMinor) } ?: 0L
    // Until the code has been looked up, the keypad types the code.
    val typingCode = benefitMode && holder == null

    // What the amount on screen would settle to if it were taken now. This is
    // the number the cashier needs *before* the tap, not after it.
    val offered = if (entered > 0) entered else if (benefitMode && holder != null) spendCap else outstanding
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

    fun labelOf(tender: Tender): String =
        methods.firstOrNull { it.code.isNotBlank() && it.code == tender.paymentMethodCode }
            ?.let { shownName(it) }
            ?: methodLabel(tender.method)

    // ── the dialog's own motion ─────────────────────────────────────────
    val scope = rememberCoroutineScope()
    val shown = remember { Animatable(0f) }
    var closing by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { shown.animateTo(1f, tween(200, easing = EaseOutStrong)) }
    fun close() {
        if (closing) return
        closing = true
        scope.launch {
            shown.animateTo(0f, tween(130, easing = FastOutLinearInEasing))
            onCancel()
        }
    }
    // Back closes the dialog the same way the × does, so it leaves the same way.
    BackHandler { close() }

    val swallow = remember { MutableInteractionSource() }
    val veil = remember { MutableInteractionSource() }
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .drawBehind { drawRect(Dim, alpha = shown.value) }
            // A tap on the veil closes — but not once money has been recorded:
            // those tenders live in this dialog, and a stray tap must not lose
            // a card payment the customer has already made.
            .clickable(interactionSource = veil, indication = null) {
                if (taken.isEmpty() && !busy && !benefitBusy) close()
            }
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        // Tall enough for the keypad at its comfortable size, and no taller
        // than the room there is; below 640 everything steps down together.
        val dialogHeight = minOf(maxHeight, 680.dp)
        val tight = dialogHeight < 640.dp
        val shape = RoundedCornerShape(RSheet)

        Box(
            Modifier
                .widthIn(max = 1040.dp)
                .fillMaxWidth()
                .height(dialogHeight)
                .graphicsLayer {
                    alpha = shown.value
                    scaleX = 0.96f + 0.04f * shown.value
                    scaleY = scaleX
                }
                .shadow(
                    24.dp, shape,
                    ambientColor = Color(0x1418273C),
                    spotColor = Color(0x2918273C),
                )
                .clip(shape)
                .background(Canvas)
                .clickable(interactionSource = swallow, indication = null) { },
        ) {
            Row(Modifier.fillMaxSize()) {
                // ── Left: what the cashier does ──────────────────────────
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    Column(
                        Modifier
                            .weight(1f)
                            .fillMaxWidth()
                            .verticalScroll(rememberScrollState())
                            .padding(start = 28.dp, end = 28.dp, top = if (tight) 20.dp else 28.dp, bottom = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(if (tight) 12.dp else 14.dp),
                    ) {
                        if (covered) {
                            // Nothing here can still be filled in, and a row of
                            // live-looking controls that no longer change anything
                            // is the part of a till that gets tapped by mistake.
                            Settled()
                        } else {
                            MethodSegments(
                                groups = groups.toList(),
                                current = group,
                                blocked = { it == "BENEFIT" && (basketHasPromotion || benefitUsed) },
                                rowHeight = if (tight) 44.dp else 48.dp,
                                onPick = { tenderType ->
                                    type = tenderType; pick = null; approval = ""; target = Field.AMOUNT
                                    benefitCode = ""; holder = null; benefitError = null
                                    if (tenderType == "BENEFIT" || benefitMode) typed = ""
                                },
                            )
                            // Cash is the one method whose slot is spoken for (Exact and
                            // the quick amounts), so a master with several cash modes asks
                            // which one on a line of its own.
                            if (method == "CASH" && group.size > 1) {
                                MemberChoice(
                                    group, chosen,
                                    onPick = { pick = it },
                                    modifier = Modifier.fillMaxWidth(),
                                )
                            }
                            if (groups.containsKey("BENEFIT") && (basketHasPromotion || benefitUsed)) {
                                Text(
                                    if (basketHasPromotion) "Employee balance can't be used with a promotion"
                                    else "Employee balance is already used on this sale",
                                    style = Type.meta.copy(color = Mute),
                                )
                            }

                            if (typingCode) {
                                // Drawn, like the amount: the code is typed on the
                                // keypad below, six digits off the employee's phone.
                                Column {
                                    FieldLabel("Employee code")
                                    Spacer(Modifier.height(8.dp))
                                    Row(
                                        Modifier
                                            .fillMaxWidth()
                                            .height(if (tight) 60.dp else 72.dp)
                                            .field(active = true, radius = RCard)
                                            .padding(horizontal = 18.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Text(
                                            benefitCode.ifBlank { "6 digits" },
                                            style = Type.money.copy(
                                                fontSize = 30.sp,
                                                fontFamily = Mono,
                                                letterSpacing = 2.sp,
                                                color = if (benefitCode.isBlank()) Faint else Ink,
                                            ),
                                            maxLines = 1,
                                        )
                                    }
                                }
                            } else {
                                Column {
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        FieldLabel(if (method == "CASH") "Received" else "Amount")
                                        if (previewChange > 0) {
                                            Text(
                                                "Change " + Money.format(previewChange),
                                                style = Type.cell.copy(color = OkFg, fontWeight = FontWeight.SemiBold),
                                                maxLines = 1,
                                            )
                                        }
                                    }
                                    Spacer(Modifier.height(8.dp))
                                    // `.amt`. Drawn, not an input: the keypad is
                                    // the only way in, so no IME ever covers it.
                                    Row(
                                        Modifier
                                            .fillMaxWidth()
                                            .height(if (tight) 60.dp else 72.dp)
                                            .field(active = !typingApproval, radius = RCard)
                                            .clickable { target = Field.AMOUNT }
                                            .padding(horizontal = 18.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Text("Rp", style = Type.metric.copy(fontSize = 18.sp, color = Mute))
                                        Spacer(Modifier.weight(1f))
                                        Text(
                                            Money.grouped(offered),
                                            style = Type.money.copy(
                                                fontSize = 34.sp,
                                                color = if (typed.isBlank()) Mute else Ink,
                                            ),
                                            maxLines = 1,
                                        )
                                    }
                                }
                            }

                            // `.dl-slot` — fifty-two dp, whatever it holds.
                            Row(
                                Modifier.fillMaxWidth().height(52.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                when {
                                    benefitMode -> {
                                        val who = holder
                                        if (who != null) {
                                            Row(
                                                Modifier
                                                    .weight(1f)
                                                    .height(52.dp)
                                                    .background(Soft, RoundedCornerShape(RField))
                                                    .border(1.dp, Hairline, RoundedCornerShape(RField))
                                                    .padding(horizontal = 14.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                            ) {
                                                Text(
                                                    who.fullName ?: who.employeeCode,
                                                    style = Type.metric.copy(fontWeight = FontWeight.SemiBold),
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis,
                                                    modifier = Modifier.weight(1f).padding(end = 10.dp),
                                                )
                                                Text(
                                                    "Balance " + Money.format(who.balanceMinor),
                                                    style = Type.meta,
                                                    maxLines = 1,
                                                )
                                            }
                                        }
                                    }
                                    method == "CASH" -> {
                                        // Denominations beside the keypad: the note in the
                                        // customer's hand is one of a few, and tapping it is
                                        // one touch instead of six digits while everyone waits.
                                        presets.forEachIndexed { index, value ->
                                            SlotChip(
                                                if (index == 0) "Exact" else Money.grouped(value),
                                                selected = entered == value,
                                                onClick = { typed = value.toString() },
                                                modifier = Modifier.weight(1f),
                                            )
                                        }
                                        repeat(4 - presets.size) { Spacer(Modifier.weight(1f)) }
                                    }
                                    else -> {
                                        if (group.size > 1) {
                                            MemberChoice(
                                                group, chosen,
                                                onPick = { pick = it; approval = "" },
                                                modifier = Modifier.weight(1f),
                                            )
                                        }
                                        if (needsApproval) {
                                            // Drawn like the amount, for the same reason: the
                                            // keypad is the way in, so no IME covers the till.
                                            Row(
                                                Modifier
                                                    .weight(1f)
                                                    .height(52.dp)
                                                    .field(active = typingApproval, radius = RField)
                                                    .clickable { target = Field.APPROVAL }
                                                    .padding(horizontal = 14.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                            ) {
                                                if (approval.isBlank()) {
                                                    Text(
                                                        if (method == "CARD") "Approval code" else "Reference code",
                                                        style = Type.metric.copy(fontSize = 16.sp, color = Mute),
                                                        maxLines = 1,
                                                    )
                                                } else {
                                                    Text(
                                                        approval,
                                                        style = Type.metric.copy(fontSize = 20.sp, fontFamily = Mono),
                                                        maxLines = 1,
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            Numpad(
                                keyHeight = if (tight) 46.dp else 56.dp,
                                gap = if (tight) 6.dp else 8.dp,
                                onDigit = {
                                    if (typingCode) {
                                        benefitCode = (benefitCode + it).take(BENEFIT_CODE_LENGTH)
                                    } else if (typingApproval) {
                                        // Under twelve digits: the node refuses anything
                                        // that could be a card number.
                                        approval = (approval + it).take(MAX_APPROVAL)
                                    } else {
                                        typed = (typed + it).trimStart('0')
                                    }
                                },
                                onBackspace = {
                                    if (typingCode) benefitCode = benefitCode.dropLast(1)
                                    else if (typingApproval) approval = approval.dropLast(1) else typed = typed.dropLast(1)
                                },
                            )
                        }
                    }

                    // `.pay-cta` — pinned, so the button is where the thumb left
                    // it however far the keypad above had to scroll.
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .padding(start = 28.dp, end = 28.dp, top = 8.dp, bottom = if (tight) 20.dp else 28.dp),
                    ) {
                        val balanceFailure = benefitError
                        if (balanceFailure != null) {
                            Notice(balanceFailure, bad = true, title = "Employee balance")
                            Spacer(Modifier.height(10.dp))
                        }
                        if (failure != null) {
                            Notice(failure, bad = true, title = "Payment failed")
                            Spacer(Modifier.height(10.dp))
                        }
                        PrimaryButton(
                            text = when {
                                covered -> "Complete sale"
                                benefitMode && holder == null ->
                                    if (benefitCode.length < BENEFIT_CODE_LENGTH) "Enter the 6-digit code" else "Check code"
                                benefitMode -> "Use balance ${Money.format(offered)}"
                                chosen == null -> "Choose a bank"
                                approvalMissing -> if (method == "CARD") "Enter the approval code" else "Enter the reference code"
                                partial -> "Part payment ${Money.format(entered)}"
                                else -> "Pay ${Money.format(offered)}"
                            },
                            onClick = {
                                when {
                                    // Everything is already covered by what was recorded.
                                    covered -> onConfirm(taken)
                                    // Employee balance: look the code up, then spend; the
                                    // tender joins the others and the rest is paid as usual.
                                    benefitMode && holder == null -> {
                                        benefitBusy = true; benefitError = null
                                        onBenefitLookup(benefitCode) { result ->
                                            benefitBusy = false
                                            result.fold(
                                                onSuccess = { holder = it; typed = "" },
                                                onFailure = { benefitError = it.message },
                                            )
                                        }
                                    }
                                    benefitMode -> {
                                        val amount = offered
                                        benefitBusy = true; benefitError = null
                                        onBenefitSpend(benefitCode, amount) { result, ref ->
                                            benefitBusy = false
                                            result.fold(
                                                onSuccess = {
                                                    taken = taken + (chosen?.tender(amount, ref) ?: Tender("BENEFIT", amount, ref))
                                                    holder = null; benefitCode = ""; typed = ""; type = "CASH"; pick = null
                                                },
                                                onFailure = { benefitError = it.message },
                                            )
                                        }
                                    }
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
                            enabled = !benefitBusy && !closing && (covered || when {
                                benefitMode && holder == null -> benefitCode.length == BENEFIT_CODE_LENGTH
                                benefitMode -> offered in 1..spendCap
                                else -> offered > 0 && chosen != null && !approvalMissing
                            }),
                            busy = busy || benefitBusy,
                            height = if (tight) 56.dp else 60.dp,
                            fontSize = 17.sp,
                            arrangement = Arrangement.Start,
                        )
                    }
                }

                Box(Modifier.width(1.dp).fillMaxHeight().background(Hairline))

                // ── Right: only the money ────────────────────────────────
                Column(
                    Modifier
                        .width(360.dp)
                        .fillMaxHeight()
                        .background(Soft)
                        .verticalScroll(rememberScrollState())
                        .padding(start = 28.dp, end = 28.dp, top = 56.dp, bottom = 28.dp),
                    verticalArrangement = Arrangement.spacedBy(24.dp),
                ) {
                    if (taken.isEmpty()) {
                        // `.dl-due`
                        Column {
                            FieldLabel("Due")
                            Text(
                                Money.format(outstanding),
                                style = Type.money.copy(fontSize = 38.sp),
                                maxLines = 1,
                            )
                        }
                    } else {
                        Ledger(
                            total = totalMinor,
                            taken = taken.map { labelOf(it) to it.amountMinor },
                            covered = covered,
                            outstanding = outstanding,
                            change = change,
                            enabled = !benefitBusy && !closing,
                            onRemove = { index ->
                                val gone = taken[index]
                                if (gone.method == "BENEFIT") {
                                    // Removing it gives the balance back to the employee.
                                    benefitBusy = true; benefitError = null
                                    onBenefitRelease { ok ->
                                        benefitBusy = false
                                        if (ok) taken = taken.filter { it.method != "BENEFIT" }
                                        else benefitError = "The balance could not be returned — try again."
                                    }
                                } else {
                                    taken = taken.filterIndexed { i, _ -> i != index }
                                }
                            },
                        )
                    }
                }
            }

            IconTap(
                Glyph.Close, "Close", { close() },
                Modifier.align(Alignment.TopEnd).padding(12.dp),
            )
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

/** The code on the employee's phone. */
private const val BENEFIT_CODE_LENGTH = 6

/** The words the till puts on each method. The wire keeps the codes. */
internal fun methodLabel(method: String): String = when (method) {
    "CASH" -> "Cash"
    "CARD" -> "Card"
    "QRIS" -> "QRIS"
    "EWALLET" -> "E-Wallet"
    "VOUCHER" -> "Voucher"
    "BENEFIT" -> "Employee balance"
    "OTHER" -> "Other"
    else -> method
}

/** A tile that groups several of Finance's methods, named by its tender type. */
private fun typeLabel(tenderType: String): String = when (tenderType) {
    "DEBIT_CARD" -> "Debit"
    "CREDIT_CARD" -> "Credit"
    else -> methodLabel(tenderType)
}

/** These four are concepts, not brands: the till names them in English whatever
 *  Finance's master calls them. A bank or a wallet keeps its own name. */
private val FIXED_NAMES = setOf("CASH", "CARD", "VOUCHER", "BENEFIT")

private fun shownName(one: PaymentMethod): String =
    if (one.tenderType in FIXED_NAMES) typeLabel(one.tenderType) else one.name

private fun segmentLabel(tenderType: String, members: List<PaymentMethod>): String =
    if (members.size == 1) shownName(members[0]) else typeLabel(tenderType)

private fun glyphFor(tenderType: String): ImageVector = when (tenderType) {
    "CASH" -> Glyph.Cash
    "DEBIT_CARD", "CREDIT_CARD", "CARD" -> Glyph.Card
    "QRIS" -> Glyph.Qr
    "EWALLET" -> Glyph.Wallet
    "VOUCHER" -> Glyph.Voucher
    "BENEFIT" -> Glyph.User
    else -> Glyph.More
}

/**
 * `.amt`, `.dl-in` — a field's frame: white, a hairline, and when it is the one
 * the keypad is typing into, the focus border and its 4 dp ring.
 */
private fun Modifier.field(active: Boolean, radius: Dp): Modifier {
    val shape = RoundedCornerShape(radius)
    return this
        .drawBehind {
            if (active) {
                val ring = 4.dp.toPx()
                drawRoundRect(
                    FocusRing,
                    topLeft = Offset(-ring, -ring),
                    size = Size(size.width + 2 * ring, size.height + 2 * ring),
                    cornerRadius = CornerRadius(radius.toPx() + ring),
                )
            }
        }
        .background(Canvas, shape)
        .border(1.dp, if (active) Focus else Hairline2, shape)
}

/** `.lbl` */
@Composable
private fun FieldLabel(text: String) {
    Text(text, style = Type.control.copy(color = Mute))
}

/**
 * `.mseg.dl-m` — the methods as one segmented control on a soft track.
 *
 * Four or fewer share one row, with their icons; more than four share two, so
 * "Employee balance" still has room to be read. The set is whatever Finance's
 * master hands the till (or the built-in four) and does not change while the
 * dialog is open, so the control never changes height under a thumb.
 */
@Composable
private fun MethodSegments(
    groups: List<Pair<String, List<PaymentMethod>>>,
    current: List<PaymentMethod>,
    blocked: (String) -> Boolean,
    rowHeight: Dp,
    onPick: (String) -> Unit,
) {
    val perRow = if (groups.size <= 4) groups.size else (groups.size + 1) / 2
    val icons = groups.size <= 4
    Column(
        Modifier
            .fillMaxWidth()
            .background(Soft2, RoundedCornerShape(RField))
            .padding(4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        groups.chunked(perRow).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                row.forEach { (tenderType, members) ->
                    Segment(
                        label = segmentLabel(tenderType, members),
                        glyph = if (icons) glyphFor(tenderType) else null,
                        selected = members === current,
                        blocked = blocked(tenderType),
                        height = rowHeight,
                        onClick = { onPick(tenderType) },
                        modifier = Modifier.weight(1f),
                    )
                }
                repeat(perRow - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun Segment(
    label: String,
    glyph: ImageVector?,
    selected: Boolean,
    blocked: Boolean,
    height: Dp,
    onClick: () -> Unit,
    modifier: Modifier,
) {
    val shape = RoundedCornerShape(RControl)
    val source = remember { MutableInteractionSource() }
    Row(
        modifier
            .height(height)
            .pressScale(source)
            .shadow(if (selected) 1.dp else 0.dp, shape)
            .clip(shape)
            .background(if (selected) Canvas else Color.Transparent)
            .clickable(interactionSource = source, indication = null, role = Role.Tab, onClick = onClick)
            .padding(horizontal = 6.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (glyph != null) {
            Icon(glyph, null, Modifier.size(18.dp), tint = if (selected) Ink else LineIco)
            Spacer(Modifier.width(6.dp))
        }
        Text(
            label,
            style = Type.control.copy(color = if (blocked) Faint else if (selected) Ink else Body),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Which of Finance's methods of one type: a bank, an EDC machine, a wallet.
 *
 * Up to four sit side by side in the slot; more would leave no room for the
 * approval code beside them, so they fold into one chip that opens a menu.
 */
@Composable
private fun MemberChoice(
    members: List<PaymentMethod>,
    chosen: PaymentMethod?,
    onPick: (PaymentMethod) -> Unit,
    modifier: Modifier,
) {
    if (members.size <= 4) {
        Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            members.forEach { member ->
                SlotChip(
                    member.name,
                    selected = member == chosen,
                    onClick = { onPick(member) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    } else {
        var menu by remember { mutableStateOf(false) }
        Box(modifier) {
            SlotChip(
                chosen?.name ?: "Choose",
                selected = chosen != null,
                onClick = { menu = true },
                modifier = Modifier.fillMaxWidth(),
                caret = true,
            )
            if (menu) {
                Popover(onDismiss = { menu = false }, anchorHeight = 52.dp, modifier = Modifier.width(260.dp)) {
                    members.forEach { member ->
                        MenuItem(member.name, onClick = { menu = false; onPick(member) })
                    }
                }
            }
        }
    }
}

/** `.dl-slot .chip` — one choice in the slot. Blue only when it is the one chosen. */
@Composable
private fun SlotChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier,
    caret: Boolean = false,
) {
    val shape = RoundedCornerShape(RControl)
    val source = remember { MutableInteractionSource() }
    Row(
        modifier
            .height(52.dp)
            .pressScale(source)
            .clip(shape)
            .background(if (selected) AccentBg else Canvas)
            .border(1.dp, if (selected) Accent else Hairline2, shape)
            .clickable(interactionSource = source, indication = null, role = Role.Button, onClick = onClick)
            .padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = Type.control.copy(color = if (selected) Accent else Text, fontFeatureSettings = "tnum"),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        if (caret) {
            Spacer(Modifier.width(4.dp))
            Icon(Glyph.Down, null, Modifier.size(16.dp), tint = if (selected) Accent else LineIco)
        }
    }
}

/**
 * `.led` — what came in against what was owed.
 *
 * The total, then each payment with its tick and a way to take it back out, then
 * what is still due — or, once the balance is covered, the change, in green,
 * counted into notes.
 */
@Composable
private fun Ledger(
    total: Long,
    taken: List<Pair<String, Long>>,
    covered: Boolean,
    outstanding: Long,
    change: Long,
    enabled: Boolean,
    onRemove: (Int) -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 36.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Total", style = Type.meta, modifier = Modifier.weight(1f))
            Text(Money.format(total), style = Type.cell, maxLines = 1)
            Spacer(Modifier.width(40.dp))
        }
        taken.forEachIndexed { index, (label, amount) ->
            Row(
                Modifier.fillMaxWidth().heightIn(min = 36.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Glyph.Check, null, Modifier.size(16.dp), tint = OkFg)
                Spacer(Modifier.width(8.dp))
                Text(label, style = Type.meta.copy(color = Text), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("−" + Money.format(amount), style = Type.cell.copy(color = OkFg), maxLines = 1)
                Spacer(Modifier.width(8.dp))
                IconTap(
                    Glyph.Close, "Remove $label payment", { onRemove(index) },
                    size = 32.dp, iconSize = 15.dp, enabled = enabled,
                )
            }
        }
        Divider(Modifier.padding(top = 10.dp))
        Spacer(Modifier.height(14.dp))
        Text(
            if (covered) "Change" else "Still due",
            style = Type.metric.copy(color = Body, fontWeight = FontWeight.Medium),
        )
        Text(
            Money.format(if (covered) change else outstanding),
            style = Type.money.copy(fontSize = 34.sp, color = if (covered) OkFg else Ink),
            textAlign = TextAlign.End,
            maxLines = 1,
            modifier = Modifier.fillMaxWidth().padding(end = 40.dp),
        )
        if (covered && change > 0) Notes(change)
    }
}

/**
 * The balance is covered, and the only thing left is to finish. The change, if
 * there is any, is in the ledger on the right.
 */
@Composable
private fun Settled() {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 48.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.size(56.dp).background(OkBg, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Glyph.CheckBold, null, Modifier.size(26.dp), tint = OkFg)
        }
        Text("Paid in full", style = Type.hero)
    }
}

/**
 * The change, counted into what the drawer actually holds.
 *
 * Reading `Rp 84.000` and reaching for notes is where a busy counter
 * short-changes somebody. Rupiah below 100 is not issued; anything left under it
 * is rounding the sale already settled, so it is not printed as a note nobody
 * can hand over.
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
    Column(Modifier.padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        FieldLabel("Give back")
        counted.forEach { (many, note) ->
            Row(
                Modifier.fillMaxWidth().padding(end = 40.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("$many× ${Money.format(note)}", style = Type.cell.copy(color = Body))
                Text(Money.format(many * note), style = Type.cell.copy(color = Body))
            }
        }
    }
}

/** `.np` — pos-desktop's order: 7 8 9 on top, the way a till's keys run. */
@Composable
private fun Numpad(keyHeight: Dp, gap: Dp, onDigit: (String) -> Unit, onBackspace: () -> Unit) {
    val rows = listOf(
        listOf("7", "8", "9"), listOf("4", "5", "6"), listOf("1", "2", "3"), listOf("000", "0", "⌫"),
    )
    Column(verticalArrangement = Arrangement.spacedBy(gap)) {
        rows.forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(gap)) {
                row.forEach { key ->
                    Key(
                        key,
                        keyHeight,
                        Modifier.weight(1f),
                    ) { if (key == "⌫") onBackspace() else onDigit(key) }
                }
            }
        }
    }
}

@Composable
private fun Key(key: String, height: Dp, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(RField)
    val source = remember { MutableInteractionSource() }
    val down by source.collectIsPressedAsState()
    Box(
        modifier
            .height(height)
            .pressScale(source, millis = 100)
            .clip(shape)
            .background(if (down) Soft2 else Soft)
            .border(1.dp, Hairline, shape)
            .clickable(interactionSource = source, indication = null, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (key == "⌫") {
            Icon(Glyph.Del, "Delete one digit", Modifier.size(24.dp), tint = Ink)
        } else {
            Text(
                key,
                style = Type.metric.copy(fontSize = 22.sp, fontWeight = FontWeight.Medium, fontFeatureSettings = "tnum"),
            )
        }
    }
}
