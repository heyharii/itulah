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
                    SectionLabel("${lines.size} produk · ${state.seen.size} tag")
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
                text = if (state.sweeping) "Berhenti membaca" else "Mulai membaca",
                onClick = vm::toggleSweep,
                enabled = !state.busy,
            )
            PrimaryButton(
                text = state.mode.verb,
                onClick = vm::commit,
                enabled = state.seen.isNotEmpty() && !state.busy,
                loading = state.busy,
            )
            if (state.seen.isNotEmpty()) {
                TextButton(onClick = vm::clear, modifier = Modifier.fillMaxWidth()) {
                    Text("Kosongkan", style = Type.body, color = Ink.text(.60f))
                }
            }
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
                SectionLabel("Terbaca")
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
                    state.busy -> StatusDot(Warning, "sibuk")
                    state.sweeping -> StatusDot(Success, "membaca")
                    state.failed -> StatusDot(Destructive, "gagal")
                    else -> StatusDot(Ink.text(.36f), "siap")
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
            SectionLabel("Sesi bersama")
            if (state.sessionCode.isNotBlank()) {
                Text(state.sessionCode, style = Type.emphasis, color = Ink.text())
            }
        }
        Spacer(Modifier.height(Space.sm))
        if (state.sessionCode.isBlank()) {
            Text(
                "Sendirian. Buat sesi agar handheld lain bisa ikut menghitung " +
                    "rak yang sama — tag yang sama terbaca dua reader tetap satu unit.",
                style = Type.caption, color = Ink.text(.74f),
            )
            Spacer(Modifier.height(Space.sm))
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                QuietButton("Buat sesi", onClick = vm::newSessionCode,
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
                placeholder = { Text("atau ketik kode sesi", style = Type.body,
                    color = Ink.text(.36f)) },
                singleLine = true, modifier = Modifier.fillMaxWidth(), shape = ControlShape,
            )
            if (typed.isNotBlank()) {
                Spacer(Modifier.height(Space.sm))
                QuietButton("Gabung ${typed.trim().uppercase()}",
                    onClick = { vm.setSessionCode(typed); typed = "" })
            }
        } else {
            val shared = state.shared
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom) {
                Column {
                    Text("${shared?.tagCount ?: 0}", style = Type.hero, color = Ink.text())
                    Text("tag di sesi ini", style = Type.caption, color = Ink.text(.60f))
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
                Text("daftar dipotong — sesi ini sudah sangat besar",
                    style = Type.micro, color = Ink.text(.60f))
            }
            Spacer(Modifier.height(Space.sm))
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                QuietButton("Segarkan", onClick = vm::refreshShared,
                    modifier = Modifier.weight(1f))
                QuietButton("Keluar", onClick = { vm.setSessionCode("") },
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
            SectionLabel("Toko tujuan")
            Spacer(Modifier.height(Space.sm))
            OutlinedTextField(
                value = state.destination, onValueChange = vm::setDestination,
                placeholder = { Text("store-07", style = Type.body, color = Ink.text(.36f)) },
                singleLine = true, modifier = Modifier.fillMaxWidth(), shape = ControlShape,
            )
            Spacer(Modifier.height(Space.sm))
            Text("Target koli diambil dari SKU yang tersapu, bukan diketik — " +
                "target yang disunting agar cocok bukan target.",
                style = Type.micro, color = Ink.text(.60f))
        }
        Mode.RECEIVING -> PlanetCard {
            SectionLabel("Penerimaan toko")
            Spacer(Modifier.height(Space.sm))
            Text("Tiap tag masuk sebagai satu unit di gudang toko ini. " +
                "Tag tanpa SKU kita dilewati dan dilaporkan.",
                style = Type.caption, color = Ink.text(.74f))
        }
        Mode.COUNT -> PlanetCard {
            LaunchedEffect(Unit) { vm.loadCounts() }
            SectionLabel("Official Count di node ini")
            Spacer(Modifier.height(Space.sm))
            when {
                !state.countsLoaded ->
                    Text("Memuat…", style = Type.caption, color = Ink.text(.60f))
                state.counts.isEmpty() -> Text(
                    "Belum ada count aktif. Sapuan tetap terkirim sebagai observasi — " +
                        "bukti bahwa tag ini ada di sini, dan itu berlaku dengan atau " +
                        "tanpa count.",
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
                        if (id == state.countId) StatusDot(Blue, "dipilih")
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
                        "$unknownTags tag bukan milik kita — tidak dihitung sebagai produk",
                        style = Type.micro, color = Ink.text(.60f),
                        modifier = Modifier.padding(horizontal = Space.lg, vertical = Space.md),
                    )
                }
            }
        }
    }
}

/** A thumbnail fetched once and kept; failures simply leave the tile empty. */
@Composable
private fun RemoteThumb(url: String) {
    var bitmap by remember(url) {
        mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null)
    }
    LaunchedEffect(url) {
        bitmap = withContext(Dispatchers.IO) {
            runCatching {
                java.net.URL(url).openStream().use { stream ->
                    android.graphics.BitmapFactory.decodeStream(stream)
                }?.asImageBitmap()
            }.getOrNull()
        }
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
                            Text(seen.sku ?: "tag lain",
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
