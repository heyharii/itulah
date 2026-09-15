package id.itulah.pindai.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import id.itulah.pindai.core.Reader
import id.itulah.pindai.ui.kit.*
import id.itulah.pindai.ui.theme.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import java.util.LinkedHashMap

/**
 * What a sweep screen must leave clear at its foot, so the last card fades under
 * the furniture as a scroll cue rather than being hidden behind it: the floating
 * action bar, the tab squircles below it, and the float each of them sits on.
 */
private val FootClearance = 236.dp

/** Where the action bar floats: clear of the squircles and their own 18 dp. */
private val ActionFloat = 84.dp

/**
 * The sweep, as one list.
 *
 * Everything scrolls in a single [LazyColumn]. An earlier version put the tag
 * list inside a scrolling Column, which is the classic Compose trap: a lazy
 * list nested in a scrollable parent is given unbounded height, so it composes
 * every row at once and recycles nothing. On a rack of fifty tags that is what
 * the floor felt as lag.
 */
@Composable
fun SweepScreen(vm: SweepViewModel, state: SweepState, onOpenSessions: () -> Unit) {
    val lines = state.lines
    val foreign = state.foreignCount
    // Held here rather than inside the hero item: a LazyColumn discards the
    // state of a row it has scrolled past, and a panel that closes itself
    // because somebody looked further down the list is a panel nobody trusts.
    var powerOpen by rememberSaveable { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier.fillMaxSize().background(Surface.canvas),
        contentPadding = PaddingValues(
            start = Space.lg, end = Space.lg, top = Space.sm, bottom = FootClearance,
        ),
        verticalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        item(key = "hero") {
            HeroCount(state, vm, powerOpen) { powerOpen = !powerOpen }
        }
        item(key = "session") { SessionRow(state, onOpenSessions) }
        item(key = "extras") { ModeExtras(vm, state) }

        if (lines.isNotEmpty()) {
            item(key = "header") {
                Row(
                    Modifier.fillMaxWidth().padding(top = Space.md, bottom = Space.xs),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    SectionLabel("${lines.size} products · ${state.tagCount} tags")
                    state.resolveNote?.let {
                        Text(it, style = Type.meta, color = Ink.mute)
                    }
                }
            }
            itemsIndexed(lines) { _, line ->
                ProductRow(line, auth = state.imageAuth)
            }
            if (foreign > 0) {
                item(key = "foreign") {
                    Text(
                        "$foreign tags are not ours — not counted as product",
                        style = Type.meta, color = Ink.mute,
                        modifier = Modifier.padding(top = Space.xs),
                    )
                }
            }
        }
    }
}

/** Product items are one reusable layout type, keyed by SKU so rows keep identity. */
private fun androidx.compose.foundation.lazy.LazyListScope.itemsIndexed(
    lines: List<Grouped>,
    row: @Composable (Int, Grouped) -> Unit,
) = items(
    lines.size,
    key = { lines[it].sku },
    contentType = { "product" },
) { index -> row(index, lines[index]) }

/**
 * One button, two meanings — and it belongs to the shell's foot, not to the
 * list, which is why [id.itulah.pindai.MainActivity] places it over the fade
 * rather than the screen stacking it under one.
 *
 * Reading and finishing are the same gesture from the operator's side — you
 * pull the trigger, you walk the aisle, you are done — so they are one control
 * that changes what it says. Two buttons made you choose between "stop" and
 * "finish" when there was never a difference: stopping without finishing left
 * a sweep hanging with nothing to show for it.
 *
 * The label slides rather than swaps. A word replaced in place at this size
 * reads as a flicker; a word that travels reads as the same button changing
 * its mind, which is what actually happened.
 *
 * The bar carries the count as well, at metric size. The hero card has the
 * figure at full size, but the hero card scrolls away and this does not — and
 * what the thumb is about to file is the one thing that must never be off
 * screen.
 */
@Composable
fun SweepAction(vm: SweepViewModel, state: SweepState, modifier: Modifier = Modifier) {
    val reading = state.sweeping
    FloatingBar(modifier.padding(horizontal = Space.lg).padding(bottom = ActionFloat)) {
        Column(Modifier.weight(1f)) {
            Text("${state.tagCount} tags", style = Type.metric, color = Ink.ink)
            Text(
                // Not the mode: the app bar has already said which one this is.
                if (state.lines.isEmpty()) "nothing swept yet"
                else "${state.lines.size} products",
                style = Type.meta, color = Ink.mute,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        AnimatedContent(
            targetState = reading,
            transitionSpec = {
                // Asymmetric on purpose. Starting a sweep is the beginning of
                // something and simply appears; Finish slides in from the right
                // because it ARRIVES — it is the same button having become the
                // end of the job, and the travel is what says so. Sliding both
                // ways would make the pair look like a carousel of two equal
                // options, which is exactly what this stopped being.
                if (targetState) {
                    (slideInHorizontally(
                        tween(Motion.panel, easing = Motion.easeOut),
                    ) { w -> w / 3 } + fadeIn(tween(Motion.pop)))
                        .togetherWith(fadeOut(tween(Motion.press)))
                } else {
                    fadeIn(tween(Motion.hover)) togetherWith fadeOut(tween(90))
                }
            },
            label = "action",
        ) { isReading ->
            if (isReading) {
                PrimaryButton(
                    text = state.mode.verb,
                    onClick = vm::commit,
                    enabled = state.tagCount > 0 && !state.busy,
                    loading = state.busy,
                )
            } else {
                PrimaryButton(
                    text = "Start reading",
                    onClick = vm::toggleSweep,
                    enabled = !state.busy,
                )
            }
        }
    }
}

/**
 * The count is the one number read from arm's length while the other hand is
 * holding a garment, so it is the only thing on this screen at `total` size.
 */
@Composable
private fun HeroCount(
    state: SweepState,
    vm: SweepViewModel,
    powerOpen: Boolean,
    onTogglePower: () -> Unit,
) {
    // With nothing stored and the module never opened, the honest figure is the
    // one Reader would take anyway — it asks for the ceiling first. The read-back
    // replaces it the moment the radio is actually open.
    val settled = state.readerPower.takeIf { it > 0 } ?: Reader.MAX_POWER
    // Re-keyed on the settled value, so a module that lands two dBm short of the
    // request pulls the fader to where the antenna actually is.
    var draft by remember(settled) { mutableIntStateOf(settled) }
    val motion = LocalMotion.current

    HubCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top) {
            Column {
                Text("SWEPT", style = Type.eyebrow, color = Ink.mute)
                Spacer(Modifier.height(Space.xs))
                RollingNumber(
                    value = state.tagCount,
                    style = Type.total,
                    // The figure goes green while the radio is live. It is the
                    // one number on this surface that changes by itself, and
                    // the colour is what says the change is happening now.
                    color = if (state.sweeping) OkFg else Ink.ink,
                )
            }
            Column(horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(Space.sm)) {
                when {
                    state.busy -> Pill(Tone.WARN, "busy")
                    state.sweeping -> Pill(Tone.OK, "reading")
                    state.failed -> Pill(Tone.BAD, "failed")
                    else -> Pill(Tone.NEUTRAL, "ready")
                }
                state.readerInfo?.let {
                    Text(it, style = Type.meta, color = Ink.mute)
                }
                PowerControl(settled, state.readerPower > 0, powerOpen, onTogglePower)
                state.filingNote?.let {
                    Text(it, style = Type.meta, color = Ink.mute)
                }
            }
        }
        state.message?.let {
            Spacer(Modifier.height(Space.md))
            Text(it, style = Type.cell, color = if (state.failed) BadFg else Ink.text)
        }
        AnimatedVisibility(
            visible = powerOpen,
            enter = expandVertically(tween(if (motion) Motion.panel else 0)) +
                fadeIn(tween(if (motion) Motion.pop else 0)),
            exit = shrinkVertically(tween(if (motion) Motion.pop else 0)) +
                fadeOut(tween(if (motion) Motion.press else 0)),
        ) {
            Column {
                Spacer(Modifier.height(Space.md))
                Fader(
                    value = draft,
                    range = Reader.MIN_POWER..Reader.MAX_POWER,
                    onChange = { draft = it },
                    onCommit = { vm.setPower(draft) },
                )
                Spacer(Modifier.height(Space.sm))
                Row(Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("${Reader.MIN_POWER} · this shelf",
                        style = Type.meta, color = Ink.mute)
                    Text("${Reader.MAX_POWER} · the whole aisle",
                        style = Type.meta, color = Ink.mute)
                }
                state.powerNote?.let {
                    Spacer(Modifier.height(Space.xs))
                    Text(it, style = Type.meta, color = Ink.mute)
                }
            }
        }
    }
}

/**
 * The figure that reports the power is the control that changes it.
 *
 * Power is chosen per aisle, not per commissioning, so the sweep screen has to
 * carry it — but it must not cost the count any room. A chevron on the reading
 * already in the corner costs none until somebody wants it, and it puts the
 * control on the number it moves rather than three taps away in Settings.
 */
@Composable
private fun PowerControl(value: Int, known: Boolean, open: Boolean, onClick: () -> Unit) {
    val motion = LocalMotion.current
    val source = remember { MutableInteractionSource() }
    val turn by animateFloatAsState(
        targetValue = if (open) 180f else 0f,
        animationSpec = if (motion) {
            spring(dampingRatio = Spring.DampingRatioNoBouncy,
                stiffness = Spring.StiffnessMediumLow)
        } else tween(0),
        label = "chevron",
    )
    Row(
        Modifier.height(32.dp)
            .background(if (open) Surface.soft2 else Surface.canvas, ControlShape)
            .border(1.dp, if (open) Surface.hairline2 else Surface.hairline, ControlShape)
            .clickable(interactionSource = source, indication = null, onClick = onClick)
            .padding(start = 10.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        // Before the module has ever answered there is no reading to show, and
        // inventing one is exactly what this control exists to stop.
        Text(if (known) "$value dBm" else "set power",
            style = Type.meta, color = Ink.text)
        Icon(Icons.Outlined.ExpandMore, contentDescription = null,
            modifier = Modifier.size(14.dp).rotate(turn), tint = Ink.lineIco)
    }
}

/**
 * One line, not a card full of them.
 *
 * Working alone is the ordinary case and joining is a deliberate act, so this
 * says where you stand and gets out of the way. The choosing happens on its own
 * screen, where there is room to show what each session already holds.
 */
@Composable
private fun SessionRow(state: SweepState, onOpen: () -> Unit) {
    HubCard(
        onPress = onOpen,
        padding = PaddingValues(horizontal = Space.lg, vertical = Space.md),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                if (state.sessionCode.isBlank()) {
                    Text("Working alone", style = Type.cardTitle, color = Ink.ink)
                    Text("Join a session to count with other handhelds",
                        style = Type.meta, color = Ink.mute)
                } else {
                    Text(state.sessionCode, style = Type.cardTitle, color = Ink.ink)
                    Text(
                        state.shared?.let {
                            "${it.tagCount} tags · ${it.helpers.size} readers"
                        } ?: "shared session",
                        style = Type.meta, color = Ink.mute,
                    )
                }
            }
            Icon(Icons.Outlined.ChevronRight, contentDescription = null,
                modifier = Modifier.size(18.dp), tint = Ink.faint)
        }
    }
}

/** What each mode needs beyond the sweep itself. Scanning needs nothing. */
@Composable
private fun ModeExtras(vm: SweepViewModel, state: SweepState) {
    when (state.mode) {
        Mode.SCAN -> Unit
        Mode.PACKING -> HubCard {
            HubField(
                value = state.destination,
                onChange = vm::setDestination,
                label = "Destination shop",
                placeholder = "store-07",
                hint = "The carton target comes from what was swept, not from typing — " +
                    "a target edited to match the sweep is not a target.",
            )
        }
        Mode.RECEIVING -> HubCard {
            SectionLabel("Shop receiving")
            Spacer(Modifier.height(Space.sm))
            Text("Each tag enters as one unit in this shop's stockroom. Tags that " +
                "are not ours are reported, never silently dropped.",
                style = Type.cell, color = Ink.text)
        }
        Mode.COUNT -> HubCard {
            LaunchedEffect(Unit) { vm.loadCounts() }
            SectionLabel("Official counts on this node")
            Spacer(Modifier.height(Space.sm))
            when {
                !state.countsLoaded ->
                    Text("Loading…", style = Type.cell, color = Ink.body)
                state.counts.isEmpty() -> Text(
                    "No active count. The sweep is still filed as observation — " +
                        "evidence that these tags were here, which holds with or " +
                        "without a count.",
                    style = Type.cell, color = Ink.text,
                )
                else -> state.counts.forEach { (id, label) ->
                    val chosen = id == state.countId
                    val source = remember(id) { MutableInteractionSource() }
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = Tap.floor)
                            .clickable(interactionSource = source, indication = null) {
                                vm.setCountId(id)
                            },
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(label, style = Type.cell,
                            color = if (chosen) Ink.ink else Ink.text,
                            modifier = Modifier.weight(1f, fill = false),
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (chosen) Pill(Tone.ACCENT, "chosen")
                    }
                }
            }
        }
    }
}

/**
 * One product: a picture, what it is, and how many are in front of you.
 *
 * A list here is a stack of cards, never a table — and each card is drawn by a
 * shaped background and a shaped border rather than by a clip. Every clip is a
 * saved layer, and this chip's own system apps do not reach sixty frames; the
 * one clip left in the row is the photograph, which has to be cut to the tile.
 *
 * The quantity rolls when it changes, because during a sweep it is the only
 * number moving and a value that swaps in place reads as a flicker. Rows do NOT
 * animate on entry — a recycled row would replay that animation on every
 * scroll, which is the jitter this list used to have.
 */
@Composable
private fun ProductRow(line: Grouped, auth: String?) {
    Row(
        Modifier.fillMaxWidth()
            .background(Surface.canvas, CardShape)
            .border(1.dp, Surface.hairline, CardShape)
            .padding(horizontal = Space.md, vertical = Space.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.md),
    ) {
        Box(
            Modifier.size(44.dp)
                .background(Surface.soft2, ControlShape)
                .border(1.dp, Surface.hairline2, ControlShape),
            contentAlignment = Alignment.Center,
        ) {
            val url = line.identity?.imageUrl
            if (url != null) RemoteThumb(url, auth)
        }
        Column(Modifier.weight(1f)) {
            Text(
                line.identity?.name ?: line.sku,
                style = Type.cardTitle, color = Ink.ink,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(line.sku, style = Type.id, color = Ink.mute)
        }
        Text("${line.qty}", style = Type.kpi, color = Ink.ink)
    }
}

/**
 * Product photographs, decoded small and kept for the life of the process.
 *
 * A colourway shares one photograph across every size, so a rack of fifty tags
 * is a handful of pictures. They are decoded straight down to tile size:
 * holding a 300KB full-resolution JPEG to draw a 44dp square costs memory on a
 * device that has little, and the downscale is what a smooth scroll is made of.
 * A failed fetch retries — on warehouse wifi the ordinary failure is a moment
 * out of range, not a missing file.
 */
private object Thumbs {
    private const val TARGET_PX = 160
    private const val MAX_CACHE_ENTRIES = 64
    private val cache = object : LinkedHashMap<
        String, androidx.compose.ui.graphics.ImageBitmap>(MAX_CACHE_ENTRIES, .75f, true,
    ) {
        override fun removeEldestEntry(
            eldest: MutableMap.MutableEntry<String, androidx.compose.ui.graphics.ImageBitmap>,
        ): Boolean = size > MAX_CACHE_ENTRIES
    }
    // A row can leave and re-enter the viewport while its image is still on the
    // wire. Keep one process-scoped fetch per URL so that a slow connection does
    // not make each new composition download and decode the same JPEG again.
    private val loaderScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val inFlight = java.util.concurrent.ConcurrentHashMap<
        String, Deferred<androidx.compose.ui.graphics.ImageBitmap?>>()

    fun cached(url: String): androidx.compose.ui.graphics.ImageBitmap? =
        synchronized(cache) { cache[url] }

    suspend fun load(url: String, auth: String?): androidx.compose.ui.graphics.ImageBitmap? {
        cached(url)?.let { return it }
        // An auth change must not make a caller join a request that was sent
        // without the now-available bearer token. The cache remains URL keyed:
        // the pixels are the same, while the wire request is not.
        val key = url + "\u0000" + (auth ?: "")
        val request = inFlight.computeIfAbsent(key) {
            loaderScope.async {
                runCatching {
                    // The node serves these behind inventory-read, so the operator
                    // token has to travel with the request. Fetching bare worked
                    // only against a node with authentication switched off, and
                    // would have left every tile blank in a real shop.
                    val connection = java.net.URL(url).openConnection()
                    if (!auth.isNullOrBlank()) {
                        connection.setRequestProperty("Authorization", "Bearer " + auth)
                    }
                    connection.connectTimeout = 10_000
                    connection.readTimeout = 20_000
                    val bytes = connection.getInputStream().use { it.readBytes() }
                    val bounds = android.graphics.BitmapFactory.Options().apply {
                        inJustDecodeBounds = true
                    }
                    android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    var sample = 1
                    while (bounds.outWidth / (sample * 2) >= TARGET_PX) sample *= 2
                    val options = android.graphics.BitmapFactory.Options().apply {
                        inSampleSize = sample
                    }
                    android.graphics.BitmapFactory
                        .decodeByteArray(bytes, 0, bytes.size, options)
                        ?.asImageBitmap()
                }.getOrNull()?.also { bitmap -> synchronized(cache) { cache[url] = bitmap } }
            }
        }
        // The row's coroutine may be cancelled when it leaves the viewport;
        // cleanup belongs to the shared request, so a failed/completed request
        // cannot poison this map indefinitely when its last waiter disappears.
        request.invokeOnCompletion { inFlight.remove(key, request) }
        return request.await()
    }
}

@Composable
private fun RemoteThumb(url: String, auth: String?) {
    var bitmap by remember(url) { mutableStateOf(Thumbs.cached(url)) }
    LaunchedEffect(url, auth) { if (bitmap == null) bitmap = Thumbs.load(url, auth) }
    bitmap?.let {
        Image(it, contentDescription = null,
            modifier = Modifier.fillMaxSize().clip(ControlShape),
            contentScale = ContentScale.Crop)
    }
}
