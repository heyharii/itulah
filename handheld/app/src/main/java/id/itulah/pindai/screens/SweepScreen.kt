package id.itulah.pindai.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.itulah.pindai.core.Reader
import id.itulah.pindai.core.ScanCounts
import id.itulah.pindai.core.skuDisplay
import id.itulah.pindai.data.InboundDelivery
import id.itulah.pindai.ui.kit.*
import id.itulah.pindai.ui.theme.*

/** Clearance for the floating action bar, the tab squircles, and their float. */
private val FootClearance = 150.dp
private val ActionFloat = 84.dp

/** A live sweep has no action bar over it, only the tab squircles. */
private val ScanFootClearance = 120.dp

/**
 * Two surfaces, one screen, and never both at once.
 *
 * While the radio is live this is four numbers on a plain background — no list,
 * no rows, no pictures, nothing that recomposes per tag. When it stops, the
 * sweep becomes products.
 *
 * That split is the whole performance story. The old screen appended a product
 * row as tags arrived and fetched a photograph for each one; it measured 27 ms
 * p50 and 28 % janky on this hardware, which is also what Android's own
 * Settings app measures here. Nothing that draws a scrolling list on an MT6765
 * is going to beat that. So the screen that has to be fast stopped being a list.
 *
 * Every part of it reads its own [slice] of the state rather than the whole of
 * it, so a publish recomposes what changed and nothing else: mid-sweep that is
 * the figure, and only the figure.
 */
@Composable
fun SweepScreen(vm: SweepViewModel, state: State<SweepState>, onOpenSessions: () -> Unit) {
    // On the PULL, not on the radio. Opening the UART takes a second or more,
    // and a screen that waits for it looks like a trigger that did nothing —
    // so the operator pulls again and stops the sweep they just started.
    val scanning by state.slice { it.sweeping || it.starting }

    // The two surfaces exchange rather than snap.
    //
    // This was a bare `if`, so letting go of the trigger replaced a screen
    // holding a huge green figure with a screen holding a huge black one, in
    // one frame, with nothing in between. It read as a jolt — the app looked
    // like it had lost its place rather than finished a job.
    //
    // Both surfaces lead with the same number, so the exchange is a settle:
    // the count fades and drops a few pixels into the position the result
    // gives it. Short, because it sits between the operator and the answer.
    AnimatedContent(
        targetState = scanning,
        transitionSpec = {
            (fadeIn(tween(Motion.panel, easing = Motion.easeOut)) +
                slideInVertically(tween(Motion.panel, easing = Motion.easeOut)) { it / 14 })
                .togetherWith(fadeOut(tween(Motion.pop)))
        },
        label = "surface",
    ) { isScanning ->
        if (isScanning) ScanningSurface(state)
        else RestingSurface(vm, state, onOpenSessions)
    }
}

// ---------------------------------------------------------------- scanning

/**
 * What an operator sees while walking an aisle.
 *
 * Deliberately NOT a `LazyColumn`. There is nothing here to scroll, and a lazy
 * list brings a scroll container, a measure pass per item and a recycler along
 * with it — all to hold four pieces of text that change together on a 200 ms
 * tick.
 *
 * And the figure reads the count in a scope of its own ([LiveCount]). This
 * surface reads [ScanFrame], which does not move while tags arrive, so the
 * five-a-second publish recomposes one `Text` and leaves the rest alone.
 */
@Composable
private fun ScanningSurface(state: State<SweepState>) {
    val frame by state.slice {
        ScanFrame(
            receiving = it.isReceivingDelivery,
            delivery = it.inbound.chosen,
            starting = it.starting,
            clockSuspect = it.clockSuspect,
            unexpected = it.counts.unexpected,
        )
    }
    Column(
        Modifier.fillMaxSize().background(Surface.canvas)
            .padding(horizontal = Space.lg)
            // No action bar floats over this surface, so the figure centres in
            // the whole panel rather than in what a bar left behind.
            .padding(top = Space.xxl, bottom = ScanFootClearance),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Which delivery these tags are going to, and nothing about what it
        // should contain. See ReceivingBanner.
        if (frame.receiving) {
            ReceivingBanner(frame.delivery)
            Spacer(Modifier.height(Space.lg))
        }
        if (frame.starting) Pill(Tone.WARN, "waking the reader") else Pill(Tone.OK, "reading")
        Spacer(Modifier.height(Space.xl))

        Spacer(Modifier.weight(1f))

        // The count, alone.
        //
        // SKU, article and unknown were here and are now on the result screen
        // where they are read rather than glanced at. Three more rolling
        // figures is three more pieces of text remeasured five times a second,
        // and none of them changes what the operator does while walking: they
        // walk until the number stops climbing. What is left is the one figure
        // that answers that, at a size that answers it from arm's length.
        LiveCount(state)

        Spacer(Modifier.weight(1f))

        // Silent unless something is actually wrong. An exception the operator
        // must act on WHILE the carton is open still interrupts — that was
        // never about counters, it was about not learning it after Finish.
        val alarm = when {
            frame.clockSuspect ->
                "device clock is wrong — evidence is saved, filing is paused"
            frame.unexpected > 0 ->
                "${frame.unexpected} unexpected " +
                    if (frame.unexpected == 1) "product" else "products"
            else -> null
        }
        if (alarm != null) {
            Text(
                alarm, style = Type.cell, color = BadFg,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(bottom = Space.xl),
            )
        }
    }
}

/** Everything the scanning surface draws except the figure. Still while tags arrive. */
private data class ScanFrame(
    val receiving: Boolean,
    val delivery: InboundDelivery?,
    val starting: Boolean,
    val clockSuspect: Boolean,
    val unexpected: Int,
)

/**
 * The count, read where it is drawn.
 *
 * Its own composable so that its own scope is the only one a new count
 * invalidates: the surface around it, the shell and the tab bar never hear
 * about the five-a-second publish.
 */
@Composable
private fun LiveCount(state: State<SweepState>) {
    val units by state.slice { it.counts.units }
    val live by state.slice { it.sweeping }
    BigCount(units, live = live)
}

/**
 * The figure, at the only size that matters.
 *
 * Six digits fit at 76 sp on a 360 dp panel; beyond that it steps down rather
 * than wrapping or ellipsising, because a count that lost a digit is worse than
 * a count that got smaller.
 */
@Composable
private fun BigCount(value: Int, live: Boolean) {
    // Sized to the panel, not to a guess.
    //
    // The figure is the only thing on this screen, so it takes the width it can
    // have — and steps down as it gains digits rather than wrapping, being cut,
    // or pushing itself off the edge. A count that lost a digit is worse than a
    // count that got smaller.
    val digits = if (value < 10) 1 else kotlin.math.log10(value.toDouble()).toInt() + 1
    val size = when {
        digits <= 3 -> 140
        digits == 4 -> 112
        digits == 5 -> 90
        digits == 6 -> 76
        else -> 62
    }
    // Remembered per size, not rebuilt per publish.
    //
    // This was `Type.display.copy(...)` inline, which hands every `Text` a
    // brand-new `TextStyle` five times a second. Compose compares styles by
    // identity before it trusts its own text layout cache, so a fresh object
    // meant a full measure and a fresh glyph rasterisation of digits 140sp
    // tall — on every tick, for a figure whose shape had not changed. Measured
    // on a C5 it put frame times in the hundreds of milliseconds.
    val style = remember(size) {
        Type.display.copy(fontSize = size.sp, lineHeight = (size * 1.08f).sp)
    }
    // Green only while the radio is actually open. The figure goes live at the
    // same instant the antenna does, so the colour is a truthful signal rather
    // than decoration: grey means pulled-but-not-reading-yet.
    //
    // And still while it is live: it changes five times a second, and rolling
    // every digit on every change kept a 140 sp figure redrawing for the whole
    // sweep. See [RollingNumber].
    RollingNumber(
        value = value, style = style,
        color = if (live) OkFg else Ink.faint,
        animate = !live,
    )
}

// ----------------------------------------------------------------- resting

/**
 * What the handheld shows when it is not reading: the sweeps it has already
 * done.
 *
 * This used to be a summary card with the last sweep's products under it, which
 * answered a question nobody asks twice and forgot the answer the moment the
 * next sweep started. The first thing an operator wants coming back to a device
 * is what the last count said — and the one before that, because the two
 * together are how you know whether a rack changed.
 */
@Composable
private fun RestingSurface(vm: SweepViewModel, state: State<SweepState>, onOpenSessions: () -> Unit) {
    val surface by state.slice {
        when {
            it.isStoreReceiving -> Resting.RECEIVING
            it.openSweep != null -> Resting.DETAIL
            else -> Resting.HISTORY
        }
    }
    when (surface) {
        // A shop's Receive is a different job with its own screens: which
        // delivery, its sweep, and what it came to. See ReceivingScreen.
        Resting.RECEIVING -> ReceivingScreen(vm, state)
        Resting.DETAIL -> SweepDetail(vm, state)
        Resting.HISTORY -> History(vm, state)
    }
}

/** Which of the three resting screens is up. */
private enum class Resting { RECEIVING, DETAIL, HISTORY }

/**
 * The history list.
 *
 * Nothing here reads the state while composing. The list of sweeps is read
 * inside the `LazyColumn` builder, so a new sweep rebuilds the list and any
 * other publish does not reach it at all; the rows above and below it read
 * their own slices.
 */
@Composable
private fun History(vm: SweepViewModel, state: State<SweepState>) {
    val history by state.slice { it.history }
    LazyColumn(
        modifier = Modifier.fillMaxSize().background(Surface.canvas),
        contentPadding = PaddingValues(
            start = Space.lg, end = Space.lg, top = Space.sm, bottom = FootClearance,
        ),
        verticalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        item(key = "label") { LabelModeRow(vm, state) }
        item(key = "extras") { ModeExtras(vm, state) }

        if (history.isEmpty()) {
            item(key = "empty") {
                Column(
                    Modifier.fillMaxWidth().padding(top = 120.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("No sweeps yet", style = Type.hero, color = Ink.faint)
                    Spacer(Modifier.height(Space.sm))
                    Text(
                        "Pull the trigger to count a rack.",
                        style = Type.meta, color = Ink.mute,
                    )
                }
            }
        }

        // The view model's own functions, not lambdas: a bound reference is
        // equal to the next one made from the same view model, so a row whose
        // record has not changed is skipped rather than recomposed.
        items(history, key = { it.id }, contentType = { "sweep" }) { record ->
            HistoryCard(record, onOpen = vm::openSweep, onPin = vm::togglePin)
        }

        item(key = "foot") { StatusFoot(state) }
    }
}

/**
 * One past sweep: when, and how many.
 *
 * The figure is what the row is for, so it is the biggest thing on it. The time
 * is what tells two otherwise identical counts apart.
 */
@Composable
private fun HistoryCard(
    record: id.itulah.pindai.data.SweepRecord,
    onOpen: (Long) -> Unit,
    onPin: (Long) -> Unit,
) {
    // Worked out once per record, not on every composition of the row. This
    // used to build three date formatters and a calendar each time a row was
    // composed — every row, every time the list was scrolled back into view.
    val at = remember(record.endedAt) { sweepWhen(record.endedAt) }
    // The card is the target. It used to carry a second `clickable` on top of
    // its own, which never fired (the card's consumes the press first) and
    // cost every row a gesture detector and a ripple of its own.
    HubCard(onPress = { onOpen(record.id) }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(at.day, style = Type.cardTitle, color = Ink.ink)
                Text(
                    at.clock +
                        (if (record.mode != "SCAN") " · " + record.mode.lowercase() else ""),
                    style = Type.meta, color = Ink.mute,
                )
            }
            // The pin is its own target, not a long press. A long press on a
            // handheld held one-handed while walking is a gesture that fires by
            // accident and never fires on purpose.
            Box(
                Modifier.size(Tap.floor).clickable { onPin(record.id) },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (record.pinned) androidx.compose.material.icons.Icons.Filled.PushPin
                    else androidx.compose.material.icons.Icons.Outlined.PushPin,
                    contentDescription = if (record.pinned) "Unpin" else "Pin",
                    modifier = Modifier.size(18.dp),
                    tint = if (record.pinned) Accent else Ink.faint,
                )
            }
            Text("${record.units}", style = Type.total, color = Ink.ink)
        }
    }
}

/**
 * Which piece of hardware the trigger is pointed at.
 *
 * Off by default: an RFID sweep is the job, and a label is what you fall back
 * to when a tag will not answer. Switching is deliberate and it says what it
 * costs — one finger cannot work two radios.
 */
@Composable
private fun LabelModeRow(vm: SweepViewModel, state: State<SweepState>) {
    val label by state.slice { LabelView(it.labelMode, it.labelNote, it.labelDiag) }
    HubCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                androidx.compose.material.icons.Icons.Outlined.QrCodeScanner,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = if (label.on) Accent else Ink.lineIco,
            )
            Spacer(Modifier.width(Space.md))
            Column(Modifier.weight(1f)) {
                Text(
                    if (label.on) "Trigger reads labels" else "Trigger reads tags",
                    style = Type.cardTitle, color = Ink.ink,
                )
                Text(
                    label.note
                        ?: if (label.on) "QR or barcode · one scan, one unit"
                        else "switch when a tag will not answer",
                    style = Type.meta, color = Ink.mute,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                // What the imager itself reports, shown only in label mode.
                //
                // Without this line a trigger pull is unobservable: a key that
                // never reached the app and a scan that started and saw nothing
                // leave an identical screen, and the floor is left guessing at
                // which. The counter is the discriminator — if "asked" does not
                // move on a pull, the key never arrived.
                if (label.on && label.diag.isNotBlank()) {
                    Text(
                        label.diag,
                        style = Type.meta, color = Ink.lineIco,
                        maxLines = 2, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            QuietButton(
                text = if (label.on) "Tags" else "Labels",
                onClick = { vm.setLabelMode(!label.on) },
            )
        }
    }
}

/** What the trigger row draws: which hardware, and what the imager last said. */
private data class LabelView(val on: Boolean, val note: String?, val diag: String)

/** One recorded sweep, opened: what it found, as a tally. */
@Composable
private fun SweepDetail(vm: SweepViewModel, state: State<SweepState>) {
    val openId by state.slice { it.openSweep }
    val history by state.slice { it.history }
    val lines by state.slice { it.lines }
    var query by rememberSaveable(openId) { mutableStateOf("") }
    val record = remember(history, openId) { history.firstOrNull { it.id == openId } }
    // When it ended, worked out once per record rather than on every pass.
    val stamp = remember(record) {
        record?.let {
            val at = sweepWhen(it.endedAt)
            at.day + " " + at.clock +
                (if (it.unknown > 0) " · ${it.unknown} unknown" else "") +
                (if (it.foreign > 0) " · ${it.foreign} not ours" else "")
        }
    }

    // Filtering runs over this sweep's own lines — hundreds, sometimes a couple
    // of thousand — so it is a RAM filter, not a query.
    val visible = remember(lines, query) {
        if (query.isBlank()) lines else {
            val needle = query.trim().uppercase().replace("·", "")
            lines.filter { line ->
                line.skuCode.contains(needle) ||
                    line.identity?.name?.uppercase()?.contains(needle) == true
            }
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().background(Surface.canvas),
        contentPadding = PaddingValues(
            start = Space.lg, end = Space.lg, top = Space.sm, bottom = FootClearance,
        ),
    ) {
        item(key = "head") {
            Column(Modifier.padding(bottom = Space.md)) {
                QuietButton("Back to history", onClick = vm::closeSweep)
                Spacer(Modifier.height(Space.lg))
                Text(
                    "${record?.units ?: lines.sumOf { it.qty }}",
                    style = DetailFigure,
                    color = Ink.ink,
                )
                Spacer(Modifier.height(Space.sm))
                Row(horizontalArrangement = Arrangement.spacedBy(Space.xxl)) {
                    Text(
                        "${record?.articles ?: 0} articles",
                        style = Type.metric, color = Ink.body,
                    )
                    Text("${lines.size} sku", style = Type.metric, color = Ink.body)
                }
                stamp?.let {
                    Spacer(Modifier.height(Space.xs))
                    Text(it, style = Type.meta, color = Ink.faint)
                }
            }
        }
        item(key = "search") {
            HubField(
                value = query, onChange = { query = it },
                placeholder = "name or SKU",
                modifier = Modifier.padding(bottom = Space.sm),
            )
        }
        items(visible, key = { it.skuCode }, contentType = { "product" }) { line ->
            ProductRow(line.identity?.name, line.skuCode, line.qty)
        }
    }
}

/**
 * The opened sweep's figure. One instance, not a `copy` per composition: a new
 * `TextStyle` object is a text layout Compose cannot reuse. See [BigCount].
 */
private val DetailFigure = Type.display.copy(fontSize = 64.sp, lineHeight = 70.sp)

/** The quiet truth at the foot of the history: what this device knows and owes. */
@Composable
private fun StatusFoot(state: State<SweepState>) {
    val foot by state.slice {
        FootView(
            catalogueReady = it.catalogue.isReady,
            generation = it.catalogue.generation,
            items = it.catalogue.items,
            outboxPending = it.outboxPending,
            outboxRefused = it.outboxRefused,
            message = it.message,
            failed = it.failed,
            clockSuspect = it.clockSuspect,
            operatorNote = it.operatorNote,
        )
    }
    Column(
        Modifier.fillMaxWidth().padding(top = Space.lg),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            buildString {
                append(
                    if (foot.catalogueReady) {
                        "catalogue gen ${foot.generation} · ${foot.items} SKUs"
                    } else "no local catalogue",
                )
                if (foot.outboxPending > 0) append(" · ${foot.outboxPending} unsent")
            },
            style = Type.meta,
            color = if (foot.catalogueReady) Ink.faint else WarnFg,
        )
        foot.message?.let {
            Text(
                it, style = Type.meta, color = if (foot.failed) BadFg else Ink.mute,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = Space.xs),
            )
        }
        if (foot.clockSuspect) {
            Text(
                "device clock is wrong — filing is paused",
                style = Type.meta, color = BadFg,
            )
        }
        // Evidence the node refused for good is kept, not lost, and no longer
        // holds up what came after it — but nobody would know it was there.
        if (foot.outboxRefused > 0) {
            Text(
                "${foot.outboxRefused} batches refused by the node · kept on this handheld",
                style = Type.metric, color = BadFg, textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = Space.xs),
            )
        }
        foot.operatorNote?.let {
            Text(
                it, style = Type.metric, color = WarnFg, textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = Space.xs),
            )
        }
    }
}

/**
 * What the foot of the history draws, and only that.
 *
 * The catalogue's own `syncing` flag and its note are deliberately not in here:
 * they move on every catalogue poll and nothing at the foot shows them.
 */
private data class FootView(
    val catalogueReady: Boolean,
    val generation: Long,
    val items: Long,
    val outboxPending: Int,
    val outboxRefused: Int,
    val message: String?,
    val failed: Boolean,
    val clockSuspect: Boolean,
    val operatorNote: String?,
)

internal val DAYS = arrayOf(
    "januari", "februari", "maret", "april", "mei", "juni",
    "juli", "agustus", "september", "oktober", "november", "desember",
)

/** When a sweep ended, as the operator reads it. */
private class SweepWhen(
    /** "22 september", in the reader's own timezone rather than the ledger's. */
    val day: String,
    /** "17.00", likewise local: the clock on the wall the operator was standing at. */
    val clock: String,
)

/**
 * The stamp this app writes (`Api.iso8601`), read back.
 *
 * One formatter per thread for the life of the process, instead of a new one
 * per call: a `SimpleDateFormat` is costly to build and is not safe to share
 * between threads, and composition is not promised to stay on one thread.
 */
private val utcStamp = object : ThreadLocal<java.text.SimpleDateFormat>() {
    override fun initialValue() =
        java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.ROOT).apply {
            timeZone = java.util.TimeZone.getTimeZone("UTC")
        }
}

/**
 * Day and clock in one pass, in the timezone the device is in NOW — read on
 * every call, as the formatters built per call used to, so a handheld whose
 * zone changes is not left on the old one. Callers `remember` the result.
 *
 * What it used to answer for a stamp it cannot read, it still answers: the
 * first ten characters as the day, and no clock.
 */
private fun sweepWhen(iso: String): SweepWhen = runCatching {
    val at = utcStamp.get()!!.parse(iso)!!
    val local = java.time.Instant.ofEpochMilli(at.time).atZone(java.time.ZoneId.systemDefault())
    SweepWhen(
        day = "${local.dayOfMonth} ${DAYS[local.monthValue - 1]}",
        clock = twoDigits(local.hour) + "." + twoDigits(local.minute),
    )
}.getOrElse { SweepWhen(day = iso.take(10), clock = "") }

private fun twoDigits(n: Int): String = if (n < 10) "0$n" else n.toString()

/**
 * One product of a sweep: what it is, and how many were found.
 *
 * The quantity is the reason the row exists, so it is the biggest thing on it —
 * the same decision the history list makes about a sweep's total. No
 * photograph: the image proxy was the most expensive thing on the old screen
 * and told an operator nothing the name does not. No expander either; the
 * unit-level EPCs are still collected and still filed as evidence, they are
 * simply not something this screen has to draw.
 *
 * It takes the three things it draws, not the [ResultLine]: a line carries
 * every EPC of its product, so it is not a type Compose can compare, and a row
 * handed one recomposed whenever the list was rebuilt. Three plain values are
 * compared by value, and an unchanged row is skipped. `name` is null when the
 * catalogue does not know the SKU.
 */
@Composable
internal fun ProductRow(name: String?, skuCode: String, qty: Int) {
    HubCard(modifier = Modifier.padding(bottom = Space.sm)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    name ?: "Unknown product",
                    style = Type.cardTitle,
                    color = if (name == null) WarnFg else Ink.ink,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    if (name == null) "${skuDisplay(skuCode)} · not in this catalogue"
                    else skuDisplay(skuCode),
                    style = Type.id, color = Ink.faint,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.width(Space.md))
            Text("$qty", style = Type.total, color = Ink.ink)
        }
    }
}

// ------------------------------------------------------------------ pieces

@Composable
private fun PowerControl(dbm: Int, settled: Boolean, open: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier.clip(RoundedCornerShape(Radius.inner))
            .background(Surface.soft2)
            .clickable(onClick = onToggle)
            .padding(horizontal = Space.sm, vertical = Space.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.xs),
    ) {
        Text(
            if (settled) "$dbm dBm" else "$dbm dBm ·",
            style = Type.meta, color = Ink.text,
        )
        Icon(
            Icons.Outlined.ExpandMore, contentDescription = "Reader power",
            modifier = Modifier.size(14.dp).rotate(if (open) 180f else 0f),
            tint = Ink.lineIco,
        )
    }
}

@Composable
private fun SessionRow(state: SweepState, onOpen: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    HubCard(modifier = Modifier.clickable(interactionSource = source, indication = null, onClick = onOpen)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    state.sessionCode.ifBlank { "Working alone" },
                    style = Type.cardTitle, color = Ink.ink,
                )
                Text(
                    state.shared?.let { "${it.tagCount} tags · ${it.helpers.size} readers" }
                        ?: state.sharedNote
                        ?: "tap to join or start a shared session",
                    style = Type.meta, color = Ink.mute,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            Icon(
                Icons.Outlined.ExpandMore, contentDescription = null,
                modifier = Modifier.size(18.dp).rotate(-90f), tint = Ink.lineIco,
            )
        }
    }
}

@Composable
private fun ModeExtras(vm: SweepViewModel, state: State<SweepState>) {
    val extras by state.slice {
        ExtrasView(it.mode, it.destination, it.counts_, it.countsLoaded, it.countId)
    }
    when (extras.mode) {
        Mode.SCAN -> Unit
        Mode.PACKING -> HubCard {
            HubField(
                value = extras.destination,
                onChange = vm::setDestination,
                label = "Destination shop",
                placeholder = "store-07",
                hint = "The carton target comes from what was swept, not from typing — " +
                    "a target edited to match the sweep is not a target.",
            )
        }
        Mode.RECEIVING -> Unit
        Mode.COUNT -> HubCard {
            // Read once, at the moment this card first appears — as before.
            val loadedWhenShown = extras.countsLoaded
            LaunchedEffect(Unit) { if (!loadedWhenShown) vm.loadCounts() }
            SectionLabel("Official count")
            if (extras.counts.isEmpty()) {
                Text(
                    if (extras.countsLoaded) "no open counts on this node" else "loading…",
                    style = Type.meta, color = Ink.mute,
                )
            } else {
                extras.counts.forEach { (id, label) ->
                    val on = id == extras.countId
                    Row(
                        Modifier.fillMaxWidth()
                            .clickable { vm.setCountId(id) }
                            .padding(vertical = Space.xs),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(label, style = Type.cell, color = if (on) Ink.ink else Ink.body)
                        if (on) Pill(Tone.OK, "chosen", withDot = false)
                    }
                }
            }
        }
    }
}

/** What a mode adds above the history: a destination to type, or a count to choose. */
private data class ExtrasView(
    val mode: Mode,
    val destination: String,
    val counts: List<Pair<String, String>>,
    val countsLoaded: Boolean,
    val countId: String,
)
