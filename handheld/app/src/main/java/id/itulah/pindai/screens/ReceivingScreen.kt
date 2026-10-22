package id.itulah.pindai.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.itulah.pindai.data.InboundDelivery
import id.itulah.pindai.data.InboundLine
import id.itulah.pindai.data.InboundReceipt
import id.itulah.pindai.data.InboundResult
import id.itulah.pindai.core.skuDisplay

import id.itulah.pindai.ui.kit.*
import id.itulah.pindai.ui.theme.*
import kotlinx.coroutines.delay
import java.util.Locale

/** Clearance for the floating tab squircles and their float. */
private val FootClearance = 150.dp

/** Enough EPCs to chase a short line by hand; past this the node's report is the tool. */
private const val EPCS_SHOWN = 300

/** Where a shop's receive is. Ordered, so the transition knows which way it went. */
private enum class Stage { LIST, SWEEP, RESULT }

/**
 * Receive, on a shop: choose the lorry, sweep it blind, receive it, then see.
 *
 * # Why the numbers arrive last
 *
 * Nothing on the first two screens says how many of anything the DC sent. A
 * shop that can see "12 expected" while it sweeps stops sweeping at twelve, and
 * files the number it was told rather than the number that came off the lorry.
 * So the list shows which lorry and how many koli — boxes, which the driver's
 * paper already says — and the sweep shows only what the reader heard. The
 * comparison is the node's answer to the receive, and it is shown after the
 * shop has committed to what it found.
 */
@Composable
internal fun ReceivingScreen(vm: SweepViewModel, state: State<SweepState>) {
    val stage by state.slice {
        when {
            it.inbound.receipt != null -> Stage.RESULT
            it.isReceivingDelivery -> Stage.SWEEP
            else -> Stage.LIST
        }
    }
    // Direction-aware, like the tab bar: forward into a delivery slides from
    // the right, Done or Change delivery slides back from the left, so the
    // picture agrees with which way the job moved.
    AnimatedContent(
        targetState = stage,
        transitionSpec = {
            val forward = targetState.ordinal >= initialState.ordinal
            (slideInHorizontally(tween(Motion.page, easing = Motion.easeOut)) {
                if (forward) it / 6 else -it / 6
            } + fadeIn(tween(Motion.page, easing = Motion.easeOut)))
                .togetherWith(fadeOut(tween(Motion.pop)))
        },
        label = "receiving",
    ) { shown ->
        when (shown) {
            Stage.RESULT -> ReceiptStage(vm, state)
            Stage.SWEEP -> DeliverySweep(vm, state)
            Stage.LIST -> DeliveryList(vm, state)
        }
    }
}

/** The receipt, while there is one. Empty while the stage fades out after Done. */
@Composable
private fun ReceiptStage(vm: SweepViewModel, state: State<SweepState>) {
    val receipt by state.slice { it.inbound.receipt }
    receipt?.let { ReceiptView(vm, it) }
}

// ------------------------------------------------------------------- list

/** What the delivery list draws, and only that. */
private data class DeliveryListView(
    val inbound: InboundState,
    /** Tags already swept and held for whichever delivery is chosen next. */
    val held: Int,
    val sweeping: Boolean,
    val message: String?,
    val failed: Boolean,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DeliveryList(vm: SweepViewModel, state: State<SweepState>) {
    val view by state.slice {
        DeliveryListView(
            inbound = it.inbound,
            held = it.counts.units + it.counts.unknownUnits,
            sweeping = it.sweeping,
            message = it.message,
            failed = it.failed,
        )
    }
    val current = view
    val inbound = current.inbound
    // Material 3 1.3 leaves `refreshing` to the caller; 1.2 kept it inside the
    // pull state, and that API is gone. Same behaviour: on when the pull is
    // released past the threshold, off when a refresh ENDS, however it ended —
    // see InboundState.refreshes for why not by `loading`.
    val pull = rememberPullToRefreshState()
    var refreshing by remember { mutableStateOf(false) }
    LaunchedEffect(inbound.refreshes) { refreshing = false }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            vm.loadInbound()
        },
        modifier = Modifier.fillMaxSize().background(Surface.canvas),
        state = pull,
        indicator = {
            PullToRefreshDefaults.Indicator(
                state = pull,
                isRefreshing = refreshing,
                modifier = Modifier.align(Alignment.TopCenter),
                containerColor = Surface.canvas,
                // In motion, so INFO — not the accent, which means selected.
                color = Info,
            )
        },
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = Space.lg, end = Space.lg, top = Space.sm, bottom = FootClearance,
            ),
            verticalArrangement = Arrangement.spacedBy(Space.sm),
        ) {
            item(key = "head") {
                Column(Modifier.padding(bottom = Space.xs)) {
                    Text("Choose a delivery", style = Type.hero, color = Ink.ink)
                    Spacer(Modifier.height(Space.xs))
                    Text(
                        "Deliveries on their way to this shop. Pull down to check again.",
                        style = Type.meta, color = Ink.mute,
                    )
                }
            }

            val held = current.held
            if (held > 0 && !current.sweeping) {
                item(key = "held") { HeldSweepCard(vm, held) }
            }

            inbound.note?.let { note ->
                item(key = "note") { Text(note, style = Type.cell, color = BadFg) }
            }
            current.message?.let { message ->
                val failed = current.failed
                item(key = "message") {
                    Text(message, style = Type.cell, color = if (failed) BadFg else OkFg)
                }
            }

            if (inbound.deliveries.isEmpty()) {
                item(key = "empty") {
                    Column(
                        Modifier.fillMaxWidth().padding(vertical = 72.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        if (!inbound.loaded || (inbound.loading && inbound.note == null)) {
                            Text("Looking for deliveries…", style = Type.cell, color = Ink.mute)
                        } else {
                            Text(
                                "No delivery is on its way to this shop",
                                style = Type.hero, color = Ink.faint, textAlign = TextAlign.Center,
                            )
                            Spacer(Modifier.height(Space.sm))
                            Text(
                                "A delivery appears here once the DC sends it off. " +
                                    "A lorry that got here first can still be received — " +
                                    "Unannounced delivery, below.",
                                style = Type.meta, color = Ink.mute, textAlign = TextAlign.Center,
                            )
                        }
                    }
                }
            }

            // A bound reference rather than a lambda per row: it is equal to
            // the next one made from the same view model, so an unchanged row
            // is skipped.
            items(inbound.deliveries, key = { it.deliveryId }, contentType = { "delivery" }) { d ->
                DeliveryRow(d, onChoose = vm::chooseDelivery)
            }

            item(key = "refresh") {
                // Pull-to-refresh is a gesture nobody discovers in a glove, so
                // the same thing is also a button.
                QuietButton(
                    text = if (inbound.loading) "Checking…" else "Refresh",
                    onClick = vm::loadInbound,
                    enabled = !inbound.loading,
                    modifier = Modifier.fillMaxWidth().padding(top = Space.xs),
                )
            }

            item(key = "unannounced") {
                Column(Modifier.padding(top = Space.lg)) {
                    SectionLabel("Not on the list?")
                    Spacer(Modifier.height(Space.xs))
                    Text(
                        "A lorry sometimes arrives before its announcement. Receive it " +
                            "without a delivery: the stock is booked in, but nothing is " +
                            "compared against what the DC sent.",
                        style = Type.meta, color = Ink.mute,
                    )
                    Spacer(Modifier.height(Space.sm))
                    QuietButton(
                        "Unannounced delivery", onClick = vm::receiveUnannounced,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

/**
 * One lorry: which paper, from where, when it left, and how many koli.
 *
 * Koli and not units. The driver's surat jalan already says how many boxes,
 * and counting boxes off the tailgate is how a shop knows it has the whole
 * delivery before it sweeps. How many GARMENTS is the question the sweep
 * answers, blind.
 */
@Composable
private fun DeliveryRow(delivery: InboundDelivery, onChoose: (InboundDelivery) -> Unit) {
    HubCard(
        onPress = { onChoose(delivery) },
        padding = PaddingValues(horizontal = Space.lg, vertical = Space.md),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    delivery.title, style = Type.cardTitle, color = Ink.ink,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    deliveryLine(delivery), style = Type.meta, color = Ink.mute,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.width(Space.md))
            Column(horizontalAlignment = Alignment.End) {
                Text("${delivery.koliCount}", style = Type.kpi, color = Ink.ink)
                Text("koli", style = Type.meta, color = Ink.mute)
            }
            Spacer(Modifier.width(Space.sm))
            Icon(
                Icons.Outlined.ChevronRight, contentDescription = null,
                modifier = Modifier.size(18.dp), tint = Ink.faint,
            )
        }
    }
}

/** "from dc-01 · left 26 september 10.12", whichever parts are known. */
private fun deliveryLine(d: InboundDelivery): String = listOfNotNull(
    // The source is already the title when there is no surat jalan number.
    d.sourceSiteId.takeIf { it.isNotBlank() && d.shipmentReference != null }?.let { "from $it" },
    localWhen(d.departedAt)?.let { "left $it" },
).joinToString(" · ").ifBlank { "on its way" }

/** Tags already swept while nobody chose a delivery for them. */
@Composable
private fun HeldSweepCard(vm: SweepViewModel, held: Int) {
    HubCard {
        Text("$held tags already swept", style = Type.cardTitle, color = Ink.ink)
        Spacer(Modifier.height(Space.xs))
        Text(
            "They go with the delivery you choose next. Discard them if they belong " +
                "to none of these.",
            style = Type.meta, color = Ink.mute,
        )
        Spacer(Modifier.height(Space.sm))
        DiscardButton(held, vm::discardSweep)
    }
}

// ------------------------------------------------------------------ sweep

/**
 * The delivery being swept, at rest between pulls.
 *
 * The same tally every other mode shows — products and how many of each were
 * heard — with the delivery it is going to at the top and NO expected number
 * anywhere. The trigger adds to it, pull after pull, until it is received.
 */
@Composable
private fun DeliverySweep(vm: SweepViewModel, state: State<SweepState>) {
    val view by state.slice {
        DeliverySweepView(
            delivery = it.inbound.chosen,
            ours = it.counts.units + it.counts.unknownUnits,
            unknownUnits = it.counts.unknownUnits,
            skus = it.counts.skus,
            articles = it.counts.articles,
            foreign = it.counts.foreign,
            busy = it.busy,
            sweeping = it.sweeping,
            message = it.message,
            failed = it.failed,
            lines = it.lines,
            outboxPending = it.outboxPending,
        )
    }
    val current = view
    val delivery = current.delivery
    val unannounced = delivery == null
    val ours = current.ours
    val figure = remember { Type.display.copy(fontSize = 64.sp, lineHeight = 70.sp) }

    LazyColumn(
        modifier = Modifier.fillMaxSize().background(Surface.canvas),
        contentPadding = PaddingValues(
            start = Space.lg, end = Space.lg, top = Space.sm, bottom = FootClearance,
        ),
        verticalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        item(key = "delivery") {
            HubCard {
                SectionLabel(if (unannounced) "Receiving without a delivery" else "Receiving")
                Spacer(Modifier.height(Space.xs))
                Text(
                    delivery?.title ?: "Unannounced delivery",
                    style = Type.hero, color = Ink.ink,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    if (delivery == null) "Not linked to any surat jalan. Nothing is compared."
                    else deliveryLine(delivery) + " · ${delivery.koliCount} koli",
                    style = Type.meta, color = Ink.mute,
                )
                Spacer(Modifier.height(Space.md))
                QuietButton(
                    "Change delivery", onClick = vm::backToDeliveries,
                    enabled = !current.busy, modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        item(key = "figure") {
            Column(Modifier.padding(top = Space.sm, bottom = Space.xs)) {
                Text("$ours", style = figure, color = Ink.ink)
                Row(horizontalArrangement = Arrangement.spacedBy(Space.xxl)) {
                    Text("${current.skus} sku", style = Type.metric, color = Ink.body)
                    Text("${current.articles} articles", style = Type.metric, color = Ink.body)
                }
                Spacer(Modifier.height(Space.xs))
                Text(
                    if (ours == 0) "Pull the trigger and sweep the koli. Every pull adds to this delivery."
                    else "Every pull adds to this delivery until you receive it.",
                    style = Type.meta, color = Ink.mute,
                )
                if (current.unknownUnits > 0) {
                    Text(
                        "${current.unknownUnits} of them this handheld cannot name" +
                            // The unannounced path is the old receive, which
                            // books in named products only. Say so rather than
                            // let the figure above promise more than it sends.
                            if (unannounced) " — the unannounced path leaves them out"
                            else " — they are received too",
                        style = Type.meta, color = WarnFg,
                    )
                }
                if (current.foreign > 0) {
                    Text(
                        "${current.foreign} tags that are not ours · left out",
                        style = Type.meta, color = Ink.faint,
                    )
                }
            }
        }

        item(key = "finish") {
            PrimaryButton(
                Mode.RECEIVING.verb,
                onClick = if (unannounced) vm::commit else vm::receiveDelivery,
                enabled = ours > 0 && !current.sweeping,
                loading = current.busy,
                big = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        current.message?.let { message ->
            item(key = "message") {
                Text(message, style = Type.cell, color = if (current.failed) BadFg else Ink.mute)
            }
        }

        if (!unannounced) {
            item(key = "blind") {
                Text(
                    "Blind count: what the DC sent is shown after you receive, not before.",
                    style = Type.meta, color = Ink.faint,
                )
            }
        }

        items(current.lines, key = { it.skuCode }, contentType = { "product" }) { line ->
            ProductRow(line.identity?.name, line.skuCode, line.qty)
        }

        if (ours > 0) {
            item(key = "discard") {
                Box(Modifier.padding(top = Space.lg)) { DiscardButton(ours, vm::discardSweep) }
            }
        }
        if (current.outboxPending > 0) {
            item(key = "outbox") {
                Text(
                    "${current.outboxPending} batches of evidence waiting for the node",
                    style = Type.meta, color = Ink.faint,
                )
            }
        }
    }
}

/** What a delivery's sweep draws between pulls, and only that. */
private data class DeliverySweepView(
    /** Null on the unannounced path. */
    val delivery: InboundDelivery?,
    /** Every tag of ours, named or not: what this delivery will receive. */
    val ours: Int,
    val unknownUnits: Int,
    val skus: Int,
    val articles: Int,
    val foreign: Int,
    val busy: Boolean,
    val sweeping: Boolean,
    val message: String?,
    val failed: Boolean,
    val lines: List<ResultLine>,
    val outboxPending: Int,
)

/**
 * Two taps, no dialog.
 *
 * A dialog is a second screen to find a button on, with a garment in the other
 * hand. The first tap arms and says exactly what the second will throw away;
 * left alone it disarms, so a stray brush of the thumb costs nothing.
 */
@Composable
private fun DiscardButton(tags: Int, onDiscard: () -> Unit) {
    var armed by remember(tags) { mutableStateOf(false) }
    LaunchedEffect(armed) {
        if (armed) { delay(4_000); armed = false }
    }
    QuietButton(
        text = if (armed) "Tap again to discard $tags tags" else "Discard this sweep",
        onClick = { if (armed) { armed = false; onDiscard() } else armed = true },
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * The delivery named at the top of the SCANNING surface.
 *
 * Which delivery, and nothing about what it should hold — while the radio is
 * live least of all, because that is when a number to aim at does its damage.
 *
 * Handed the delivery alone, so the count climbing beside it never redraws it.
 * Null is the unannounced path.
 */
@Composable
internal fun ReceivingBanner(delivery: InboundDelivery?) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            delivery?.title ?: "Unannounced delivery",
            style = Type.cardTitle, color = Ink.ink, textAlign = TextAlign.Center,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Text(
            if (delivery == null) "not linked to a surat jalan"
            else "blind count · ${delivery.koliCount} koli",
            style = Type.meta, color = Ink.mute, textAlign = TextAlign.Center,
        )
    }
}

// ----------------------------------------------------------------- result

/**
 * What the delivery came to, now that the shop has committed to its count.
 *
 * Totals first, then the products — problems at the top, worst first, because
 * a delivery of two hundred lines with three short ones is three lines worth
 * reading. A problem row opens to its EPCs: that is what somebody walks the
 * stockroom with when a line is short.
 */
@Composable
private fun ReceiptView(vm: SweepViewModel, receipt: InboundReceipt) {
    var open by remember(receipt) { mutableStateOf<String?>(null) }
    val delivery = receipt.delivery
    val totals = delivery.result ?: InboundResult(
        expectedUnits = receipt.lines.sumOf { it.expected },
        receivedUnits = receipt.lines.sumOf { it.received },
        missingUnits = receipt.lines.sumOf { it.missing },
        extraUnits = receipt.lines.sumOf { it.extra },
    )
    val problems = receipt.lines.count { it.hasProblem }

    LazyColumn(
        modifier = Modifier.fillMaxSize().background(Surface.canvas),
        contentPadding = PaddingValues(
            start = Space.lg, end = Space.lg, top = Space.sm, bottom = FootClearance,
        ),
        verticalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        item(key = "head") {
            Column(Modifier.padding(bottom = Space.xs)) {
                if (receipt.alreadyReceived) Pill(Tone.WARN, "already received")
                else Pill(Tone.OK, "received")
                Spacer(Modifier.height(Space.sm))
                Text(delivery.title, style = Type.hero, color = Ink.ink)
                Text(
                    listOfNotNull(
                        delivery.sourceSiteId.takeIf { it.isNotBlank() }?.let { "from $it" },
                        localWhen(delivery.receivedAt)?.let { "received $it" },
                        delivery.receivedBy?.let { "by $it" },
                    ).joinToString(" · "),
                    style = Type.meta, color = Ink.mute,
                )
            }
        }

        if (receipt.alreadyReceived) {
            item(key = "already") {
                HubCard {
                    Text(
                        "This delivery was already received from a different sweep. What " +
                            "you see is what was recorded then — your sweep was not applied. " +
                            "It is still held on this handheld: choose the right delivery for " +
                            "it, or discard it.",
                        style = Type.cell, color = WarnFg,
                    )
                }
            }
        }

        item(key = "totals") { TotalsCard(totals) }

        item(key = "done") {
            PrimaryButton(
                "Done", onClick = vm::closeReceipt, big = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        if (receipt.skippedEpcs.isNotEmpty()) {
            item(key = "skipped") {
                Text(
                    "${receipt.skippedEpcs.size} tags were skipped by the node — not part " +
                        "of this delivery's products.",
                    style = Type.meta, color = Ink.mute,
                )
            }
        }

        item(key = "section") {
            SectionLabel(
                when {
                    receipt.lines.isEmpty() -> "No product lines"
                    problems == 0 -> "Every product matched"
                    problems == 1 -> "1 product needs a look · tap it for the tags"
                    else -> "$problems products need a look · tap one for the tags"
                },
                Modifier.padding(top = Space.md),
            )
        }

        items(receipt.lines, key = { it.skuCode }, contentType = { "line" }) { line ->
            ReceiptRow(
                line, expanded = open == line.skuCode,
                onToggle = { open = if (open == line.skuCode) null else line.skuCode },
            )
        }
    }
}

/**
 * Four figures, side by side, so none of them is the screen's one number.
 *
 * Missing is red and extra is amber only when they are not zero: a colour on a
 * zero is a colour that means nothing, and the eye learns to skip it.
 */
@Composable
private fun TotalsCard(result: InboundResult) {
    HubCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Figure("Expected", result.expectedUnits, Ink.ink)
            Figure("Received", result.receivedUnits, Ink.ink)
            Figure("Missing", result.missingUnits, if (result.missingUnits > 0) BadFg else Ink.faint)
            Figure("Extra", result.extraUnits, if (result.extraUnits > 0) WarnFg else Ink.faint)
        }
    }
}

@Composable
private fun Figure(label: String, value: Int, color: androidx.compose.ui.graphics.Color) {
    Column {
        SectionLabel(label)
        RollingNumber(value, Type.kpi, color)
    }
}

/** One product: what was sent against what arrived, and — on a problem — which tags. */
@Composable
private fun ReceiptRow(line: InboundLine, expanded: Boolean, onToggle: () -> Unit) {
    HubCard(onPress = if (line.hasProblem) onToggle else null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    line.name ?: "Unknown product",
                    style = Type.cardTitle,
                    color = if (line.name == null) WarnFg else Ink.ink,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                Text(skuDisplay(line.skuCode), style = Type.id, color = Ink.faint)
                Spacer(Modifier.height(Space.xs))
                Text(
                    "expected ${line.expected} · received ${line.received}",
                    style = Type.metric, color = Ink.body,
                )
            }
            Spacer(Modifier.width(Space.sm))
            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(Space.xs),
            ) {
                if (line.missing > 0) Pill(Tone.BAD, "${line.missing} missing")
                if (line.extra > 0) Pill(Tone.WARN, "${line.extra} extra")
                if (!line.hasProblem) Pill(Tone.OK, "matched", withDot = false)
            }
            if (line.hasProblem) {
                Icon(
                    Icons.Outlined.ExpandMore, contentDescription = if (expanded) "Hide tags" else "Show tags",
                    modifier = Modifier.size(18.dp).rotate(if (expanded) 180f else 0f),
                    tint = Ink.lineIco,
                )
            }
        }
        AnimatedVisibility(
            visible = expanded,
            enter = expandVertically(tween(Motion.panel, easing = Motion.easeOut)) +
                fadeIn(tween(Motion.panel)),
            exit = shrinkVertically(tween(Motion.pop, easing = Motion.easeOut)) +
                fadeOut(tween(Motion.pop)),
        ) {
            Column(Modifier.padding(top = Space.md)) {
                EpcList("Missing — sent, not swept", line.missingEpcs, line.missing)
                if (line.missingEpcs.isNotEmpty() && line.extraEpcs.isNotEmpty()) {
                    Spacer(Modifier.height(Space.md))
                }
                EpcList("Extra — swept, not sent", line.extraEpcs, line.extra)
            }
        }
    }
}

@Composable
private fun EpcList(label: String, epcs: List<String>, units: Int) {
    if (epcs.isEmpty()) {
        // The node counted a difference and did not name the tags. Say that,
        // rather than open onto nothing.
        if (units > 0) Text("$label: ${units} · no tags listed", style = Type.meta, color = Ink.mute)
        return
    }
    SectionLabel(label)
    Spacer(Modifier.height(Space.xs))
    epcs.take(EPCS_SHOWN).forEach { Text(it, style = Type.id, color = Ink.text) }
    if (epcs.size > EPCS_SHOWN) {
        Text("and ${epcs.size - EPCS_SHOWN} more", style = Type.meta, color = Ink.mute)
    }
}

/**
 * "26 september 10.12", in the handheld's own timezone.
 *
 * `java.time` rather than the fixed pattern the history uses, because these
 * come from the node rather than from this app, and a node is entitled to send
 * fractional seconds or an offset — either of which the fixed pattern refuses,
 * and a refusal there would print the raw ISO string on the floor.
 */
internal fun localWhen(iso: String?): String? {
    if (iso.isNullOrBlank()) return null
    val instant = runCatching { java.time.OffsetDateTime.parse(iso).toInstant() }.getOrNull()
        ?: runCatching { java.time.Instant.parse(iso) }.getOrNull()
        ?: runCatching {
            // No zone at all: the ledger's clock is UTC.
            java.time.LocalDateTime.parse(iso).toInstant(java.time.ZoneOffset.UTC)
        }.getOrNull()
        ?: return iso.take(16).replace('T', ' ')
    val local = instant.atZone(java.time.ZoneId.systemDefault())
    return "${local.dayOfMonth} ${DAYS[local.monthValue - 1]} " +
        String.format(Locale.ROOT, "%02d.%02d", local.hour, local.minute)
}
