package id.itulah.pindai.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import id.itulah.pindai.ui.kit.*
import id.itulah.pindai.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

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

    Column(Modifier.fillMaxSize().background(Surface.canvas)) {
        LazyColumn(
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(Space.lg),
            verticalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            item(key = "hero") { HeroCount(state) }
            item(key = "session") { SessionRow(state, onOpenSessions) }
            item(key = "extras") { ModeExtras(vm, state) }

            if (lines.isNotEmpty()) {
                item(key = "header") {
                    Row(
                        Modifier.fillMaxWidth().padding(top = Space.xs),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        SectionLabel("${lines.size} products · ${state.seen.size} tags")
                        state.resolveNote?.let {
                            Text(it, style = Type.micro, color = Ink.text(.60f))
                        }
                    }
                }
                itemsIndexed(lines) { index, line ->
                    ProductRow(line, first = index == 0, last = index == lines.lastIndex)
                }
                if (foreign > 0) {
                    item(key = "foreign") {
                        Text(
                            "$foreign tags are not ours — not counted as product",
                            style = Type.micro, color = Ink.text(.60f),
                        )
                    }
                }
            }
        }
        BottomActions(vm, state)
    }
}

/** `itemsIndexed` for a plain list, keyed by SKU so rows keep identity. */
private fun androidx.compose.foundation.lazy.LazyListScope.itemsIndexed(
    lines: List<Grouped>,
    row: @Composable (Int, Grouped) -> Unit,
) = items(lines.size, key = { lines[it].sku }) { index -> row(index, lines[index]) }

/**
 * One button, two meanings.
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
 */
@Composable
private fun BottomActions(vm: SweepViewModel, state: SweepState) {
    val reading = state.sweeping
    Column(
        Modifier.fillMaxWidth().background(Surface.canvas).padding(Space.lg),
    ) {
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
                    (slideInHorizontally(tween(220)) { w -> w / 3 } + fadeIn(tween(160)))
                        .togetherWith(fadeOut(tween(110)))
                } else {
                    fadeIn(tween(140)) togetherWith fadeOut(tween(90))
                }
            },
            label = "action",
        ) { isReading ->
            if (isReading) {
                PrimaryButton(
                    text = state.mode.verb,
                    onClick = vm::commit,
                    enabled = state.seen.isNotEmpty() && !state.busy,
                    loading = state.busy,
                )
            } else {
                QuietButton(
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
 * holding a garment, so it is the only thing on screen at hero size.
 */
@Composable
private fun HeroCount(state: SweepState) {
    PlanetCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top) {
            Column {
                SectionLabel("Swept")
                RollingNumber(
                    value = state.seen.size,
                    style = Type.hero,
                    color = if (state.sweeping) Success else Ink.text(),
                )
            }
            Column(horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(Space.xs)) {
                when {
                    state.busy -> StatusDot(Warning, "busy")
                    state.sweeping -> StatusDot(Success, "reading")
                    state.failed -> StatusDot(Destructive, "failed")
                    else -> StatusDot(Ink.text(.36f), "ready")
                }
                state.readerInfo?.let {
                    Text(it, style = Type.micro, color = Ink.text(.60f))
                }
                state.filingNote?.let {
                    Text(it, style = Type.micro, color = Ink.text(.60f))
                }
            }
        }
        state.message?.let {
            Spacer(Modifier.height(Space.sm))
            Text(it, style = Type.caption,
                color = if (state.failed) Destructive else Ink.text(.74f))
        }
    }
}

/**
 * One line, not a card.
 *
 * Working alone is the ordinary case and joining is a deliberate act, so this
 * says where you stand and gets out of the way. The choosing happens on its own
 * screen, where there is room to show what each session already holds.
 */
@Composable
private fun SessionRow(state: SweepState, onOpen: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen),
        shape = CardShape,
        color = Surface.card,
        border = BorderStroke(1.dp, Ink.border(.04f)),
    ) {
        Row(
            Modifier.padding(horizontal = Space.lg, vertical = Space.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                if (state.sessionCode.isBlank()) {
                    Text("Working alone", style = Type.body, color = Ink.text())
                    Text("Join a session to count with other handhelds",
                        style = Type.micro, color = Ink.text(.60f))
                } else {
                    Text(state.sessionCode, style = Type.body, color = Ink.text())
                    Text(
                        state.shared?.let {
                            "${it.tagCount} tags · ${it.helpers.size} readers"
                        } ?: "shared session",
                        style = Type.micro, color = Ink.text(.60f),
                    )
                }
            }
            Icon(Icons.Outlined.ChevronRight, contentDescription = null,
                modifier = Modifier.size(18.dp), tint = Ink.text(.36f))
        }
    }
}

/** What each mode needs beyond the sweep itself. Scanning needs nothing. */
@Composable
private fun ModeExtras(vm: SweepViewModel, state: SweepState) {
    when (state.mode) {
        Mode.SCAN -> Unit
        Mode.PACKING -> PlanetCard {
            SectionLabel("Destination shop")
            Spacer(Modifier.height(Space.sm))
            OutlinedTextField(
                value = state.destination, onValueChange = vm::setDestination,
                placeholder = { Text("store-07", style = Type.body, color = Ink.text(.36f)) },
                singleLine = true, modifier = Modifier.fillMaxWidth(), shape = ControlShape,
            )
            Spacer(Modifier.height(Space.sm))
            Text("The carton target comes from what was swept, not from typing — " +
                "a target edited to match the sweep is not a target.",
                style = Type.micro, color = Ink.text(.60f))
        }
        Mode.RECEIVING -> PlanetCard {
            SectionLabel("Shop receiving")
            Spacer(Modifier.height(Space.sm))
            Text("Each tag enters as one unit in this shop's stockroom. Tags that " +
                "are not ours are reported, never silently dropped.",
                style = Type.caption, color = Ink.text(.74f))
        }
        Mode.COUNT -> PlanetCard {
            LaunchedEffect(Unit) { vm.loadCounts() }
            SectionLabel("Official counts on this node")
            Spacer(Modifier.height(Space.sm))
            when {
                !state.countsLoaded ->
                    Text("Loading…", style = Type.caption, color = Ink.text(.60f))
                state.counts.isEmpty() -> Text(
                    "No active count. The sweep is still filed as observation — " +
                        "evidence that these tags were here, which holds with or " +
                        "without a count.",
                    style = Type.caption, color = Ink.text(.74f),
                )
                else -> state.counts.forEach { (id, label) ->
                    Row(
                        Modifier.fillMaxWidth().clickable { vm.setCountId(id) }
                            .padding(vertical = Space.sm),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(label, style = Type.body,
                            color = if (id == state.countId) Ink.text() else Ink.text(.74f))
                        if (id == state.countId) StatusDot(Blue, "chosen")
                    }
                }
            }
        }
    }
}

/**
 * One product: a picture, what it is, and how many are in front of you.
 *
 * The quantity rolls when it changes, because during a sweep it is the only
 * number moving and a value that swaps in place reads as a flicker. Rows do NOT
 * animate on entry — a recycled row would replay that animation on every
 * scroll, which is the jitter this list used to have.
 */
@Composable
private fun ProductRow(line: Grouped, first: Boolean, last: Boolean) {
    // No clip() and no per-row Surface. Every clip is a saved layer, and
    // seventeen of them is seventeen layers to compose on a chip whose own
    // system apps do not reach sixty frames. Corners are drawn by the shaped
    // background of the first and last rows only; the ones between are square
    // and nobody has ever noticed.
    Column(
        Modifier.fillMaxWidth().background(
            color = Surface.card,
            shape = when {
                first && last -> CardShape
                first -> RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp)
                last -> RoundedCornerShape(bottomStart = 12.dp, bottomEnd = 12.dp)
                else -> RectangleShape
            },
        ),
    ) {
        if (!first) {
            Box(
                Modifier.fillMaxWidth().padding(start = Space.lg + 44.dp + Space.md)
                    .height(1.dp).background(Ink.border(.04f)),
            )
        }
        Row(
            Modifier.padding(horizontal = Space.lg, vertical = Space.md),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            Box(
                Modifier.size(44.dp).background(Ink.fill(.06f), RoundedCornerShape(8.dp)),
                contentAlignment = Alignment.Center,
            ) {
                val url = line.identity?.imageUrl
                if (url != null) RemoteThumb(url)
            }
            Column(Modifier.weight(1f)) {
                Text(
                    line.identity?.name ?: line.sku,
                    style = Type.body, color = Ink.text(),
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(line.sku, style = Type.mono, color = Ink.text(.60f))
            }
            Text("${line.qty}", style = Type.anchor, color = Ink.text())
        }
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
    private val cache = java.util.concurrent.ConcurrentHashMap<
        String, androidx.compose.ui.graphics.ImageBitmap>()

    fun cached(url: String) = cache[url]

    suspend fun load(url: String): androidx.compose.ui.graphics.ImageBitmap? {
        cache[url]?.let { return it }
        val bitmap = withContext(Dispatchers.IO) {
            runCatching {
                val bytes = java.net.URL(url).openStream().use { it.readBytes() }
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
            }.getOrNull()
        }
        if (bitmap != null) cache[url] = bitmap
        return bitmap
    }
}

@Composable
private fun RemoteThumb(url: String) {
    var bitmap by remember(url) { mutableStateOf(Thumbs.cached(url)) }
    LaunchedEffect(url) { if (bitmap == null) bitmap = Thumbs.load(url) }
    bitmap?.let {
        Image(it, contentDescription = null, modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop)
    }
}
