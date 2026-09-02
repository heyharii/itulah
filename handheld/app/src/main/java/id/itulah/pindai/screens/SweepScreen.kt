package id.itulah.pindai.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import id.itulah.pindai.ui.kit.*
import id.itulah.pindai.ui.theme.*

@Composable
fun SweepScreen(vm: SweepViewModel, state: SweepState) {
    Column(Modifier.fillMaxSize().background(Surface.canvas)) {
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState())
                .padding(horizontal = Space.lg).padding(top = Space.lg),
            verticalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            HeroCount(state)
            SessionCard(vm, state)
            ModeExtras(vm, state)
            if (state.seen.isNotEmpty()) {
                val lines = state.grouped()
                val unknown = state.seen.count { it.sku == null }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    SectionLabel("${lines.size} products · ${state.seen.size} tags")
                    state.resolveNote?.let {
                        Text(it, style = Type.micro, color = Ink.text(.60f))
                    }
                }
                ProductList(lines, unknown)
            }
            Spacer(Modifier.height(Space.sm))
        }
        Column(
            Modifier.fillMaxWidth().padding(Space.lg),
            verticalArrangement = Arrangement.spacedBy(Space.sm),
        ) {
            QuietButton(
                text = if (state.sweeping) "Stop reading" else "Start reading",
                onClick = vm::toggleSweep,
                enabled = !state.busy,
            )
            PrimaryButton(
                text = state.mode.verb,
                onClick = vm::commit,
                enabled = state.seen.isNotEmpty() && !state.busy,
                loading = state.busy,
            )
        }
    }
}

/**
 * The count is the L5 hero — the one number somebody reads from arm's length
 * while their other hand is holding a garment.
 */
@Composable
private fun HeroCount(state: SweepState) {
    PlanetCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top) {
            Column {
                SectionLabel("Swept")
                AnimatedContent(
                    targetState = state.seen.size,
                    transitionSpec = {
                        (fadeIn(tween(140)) + slideInHorizontally(tween(140)) { it / 4 })
                            .togetherWith(fadeOut(tween(90)) + slideOutHorizontally(tween(90)) { -it / 4 })
                    },
                    label = "count",
                ) { count ->
                    Text("$count", style = Type.hero,
                        color = if (state.sweeping) Success else Ink.text())
                }
            }
            Column(horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(Space.sm)) {
                when {
                    state.busy -> StatusDot(Warning, "busy")
                    state.sweeping -> StatusDot(Success, "reading")
                    state.failed -> StatusDot(Destructive, "failed")
                    else -> StatusDot(Ink.text(.36f), "ready")
                }
                state.readerInfo?.let {
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
 * The shared session: a name several handhelds agree on, and the combined
 * count that follows from it.
 *
 * The card shows the union first because that is the number the floor is
 * working towards; this device's own contribution is a detail underneath it.
 */
@Composable
private fun SessionCard(vm: SweepViewModel, state: SweepState) {
    PlanetCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            SectionLabel("Shared session")
            if (state.sessionCode.isNotBlank()) {
                Text(state.sessionCode, style = Type.emphasis, color = Ink.text())
            }
        }
        Spacer(Modifier.height(Space.sm))
        if (state.sessionCode.isBlank()) {
            Text(
                "Working alone. Open a session so other handhelds can count the same " +
                    "rack — one tag seen by two readers is still one unit.",
                style = Type.caption, color = Ink.text(.74f),
            )
            Spacer(Modifier.height(Space.sm))
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                QuietButton("Open session", onClick = vm::newSessionCode,
                    modifier = Modifier.weight(1f))
            }
            Spacer(Modifier.height(Space.sm))
            // Held locally until submitted: joining on every keystroke would
            // fire a lookup for "S", "S-", "S-K" and land the operator in a
            // session named after half of what they meant to type.
            var typed by remember { mutableStateOf("") }
            OutlinedTextField(
                value = typed,
                onValueChange = { typed = it },
                placeholder = { Text("or type a session code", style = Type.body,
                    color = Ink.text(.36f)) },
                singleLine = true, modifier = Modifier.fillMaxWidth(), shape = ControlShape,
            )
            if (typed.isNotBlank()) {
                Spacer(Modifier.height(Space.sm))
                QuietButton("Join ${typed.trim().uppercase()}",
                    onClick = { vm.setSessionCode(typed); typed = "" })
            }
        } else {
            val shared = state.shared
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom) {
                Column {
                    Text("${shared?.tagCount ?: 0}", style = Type.hero, color = Ink.text())
                    Text("tags in this session", style = Type.caption, color = Ink.text(.60f))
                }
                Column(horizontalAlignment = Alignment.End) {
                    shared?.helpers?.forEach { helper ->
                        Text("${helper.deviceId} · ${helper.tagCount}",
                            style = Type.micro, color = Ink.text(.60f))
                    }
                }
            }
            state.sharedNote?.let {
                Spacer(Modifier.height(Space.xs))
                Text(it, style = Type.micro, color = Destructive)
            }
            if (shared?.truncated == true) {
                Text("list truncated — this session is very large",
                    style = Type.micro, color = Ink.text(.60f))
            }
            Spacer(Modifier.height(Space.sm))
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                QuietButton("Refresh", onClick = vm::refreshShared,
                    modifier = Modifier.weight(1f))
                QuietButton("Leave", onClick = { vm.setSessionCode("") },
                    modifier = Modifier.weight(1f))
            }
        }
    }
}

/** What each mode needs beyond the sweep itself. Scan needs nothing. */
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
            Text("The carton target comes from what was swept, not from typing — a " +
                "target edited to match the sweep is not a target.",
                style = Type.micro, color = Ink.text(.60f))
        }
        Mode.RECEIVING -> PlanetCard {
            SectionLabel("Shop receiving")
            Spacer(Modifier.height(Space.sm))
            Text("Each tag enters as one unit in this shop\u0027s stockroom. Tags that " +
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
                    "No active count. The sweep is still filed as observation — evidence " +
                        "that these tags were here, which holds with or without a count.",
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
 * The sweep as products: a picture, a name, and how many are in front of you.
 *
 * Quantity is the L3 column and the only number that repeats down the list, so
 * it carries full ink while everything supporting it steps back. A line whose
 * name has not resolved still shows its SKU and its count — the count is the
 * thing somebody is standing there to learn, and it never depends on the
 * network.
 */
@Composable
private fun ProductList(lines: List<Grouped>, unknownTags: Int) {
    Surface(shape = CardShape, color = Surface.card,
        border = androidx.compose.foundation.BorderStroke(1.dp, Ink.border(.04f)),
        modifier = Modifier.fillMaxWidth().heightIn(max = 360.dp)) {
        LazyColumn {
            items(lines.size) { index ->
                val line = lines[index]
                StaggeredRow(index) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = Space.lg, vertical = Space.md),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Space.md),
                    ) {
                        Box(
                            Modifier.size(44.dp).clip(RoundedCornerShape(8.dp))
                                .background(Ink.fill(.06f)),
                            contentAlignment = Alignment.Center,
                        ) {
                            val url = line.identity?.imageUrl
                            if (url != null) {
                                RemoteThumb(url)
                            } else {
                                Text(line.sku.takeLast(3), style = Type.micro,
                                    color = Ink.text(.36f))
                            }
                        }
                        Column(Modifier.weight(1f)) {
                            Text(
                                line.identity?.name ?: line.sku,
                                style = Type.body,
                                color = Ink.text(),
                                maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                            Text(line.sku, style = Type.mono, color = Ink.text(.60f))
                        }
                        Text("${line.qty}", style = Type.anchor, color = Ink.text())
                    }
                    if (index < lines.lastIndex) {
                        Box(Modifier.fillMaxWidth().padding(horizontal = Space.lg)
                            .height(1.dp).background(Ink.border(.04f)))
                    }
                }
            }
            if (unknownTags > 0) {
                items(1) {
                    Text(
                        "$unknownTags tags are not ours — not counted as product",
                        style = Type.micro, color = Ink.text(.60f),
                        modifier = Modifier.padding(horizontal = Space.lg, vertical = Space.md),
                    )
                }
            }
        }
    }
}

/**
 * Product photographs, fetched once per URL for the life of the process.
 *
 * A rack of fifty tags is a dozen products but only a handful of pictures — a
 * colourway shares one photograph across every size. Without this cache each
 * row fetched its own copy, and because a LazyColumn recycles rows, scrolling
 * back up fetched them all again: most tiles stayed empty while the same three
 * images were downloaded over and over.
 */
private object Thumbs {
    private val cache = java.util.concurrent.ConcurrentHashMap<
        String, androidx.compose.ui.graphics.ImageBitmap>()

    fun cached(url: String) = cache[url]

    /**
     * Fetch once on success; retry on failure.
     *
     * An earlier version blacklisted a URL the first time it failed, to avoid
     * hammering a dead link. On warehouse wifi that is the wrong trade: the
     * ordinary failure is a moment out of range, not a missing file, and one
     * bad second left the picture blank for the rest of the shift. The success
     * cache alone is what stops repeat downloads, and it is enough — a
     * colourway shares one photograph across every size, so a rack of fifty
     * tags is a handful of images.
     */
    suspend fun load(url: String): androidx.compose.ui.graphics.ImageBitmap? {
        cache[url]?.let { return it }
        val bitmap = withContext(Dispatchers.IO) {
            runCatching {
                java.net.URL(url).openStream().use { stream ->
                    android.graphics.BitmapFactory.decodeStream(stream)
                }?.asImageBitmap()
            }.getOrNull()
        }
        if (bitmap != null) cache[url] = bitmap
        return bitmap
    }
}

@Composable
private fun RemoteThumb(url: String) {
    var bitmap by remember(url) {
        mutableStateOf(Thumbs.cached(url))
    }
    LaunchedEffect(url) {
        if (bitmap == null) bitmap = Thumbs.load(url)
    }
    bitmap?.let {
        Image(it, contentDescription = null, modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop)
    }
}

@Composable
private fun TagList(state: SweepState) {
    Surface(shape = CardShape, color = Surface.card,
        border = androidx.compose.foundation.BorderStroke(1.dp, Ink.border(.04f)),
        modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp)) {
        LazyColumn {
            items(state.seen.size) { index ->
                val seen = state.seen[index]
                StaggeredRow(index) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = Space.lg,
                        vertical = Space.md)) {
                        Row(Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(seen.sku ?: "other tag",
                                style = Type.bodyNum,
                                color = if (seen.sku != null) Ink.text() else Ink.text(.36f))
                            Text(seen.rssi?.let { "${it.toInt()}" } ?: "—",
                                style = Type.micro, color = Ink.text(.60f))
                        }
                        Text(seen.epc, style = Type.mono, color = Ink.text(.60f),
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (index < state.seen.lastIndex) {
                        Box(Modifier.fillMaxWidth().padding(horizontal = Space.lg)
                            .height(1.dp).background(Ink.border(.04f)))
                    }
                }
            }
        }
    }
}
