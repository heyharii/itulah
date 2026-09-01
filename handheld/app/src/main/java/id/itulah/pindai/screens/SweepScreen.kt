package id.itulah.pindai.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
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
            ModeExtras(vm, state)
            if (state.seen.isNotEmpty()) {
                SectionLabel("${state.seen.size} tag")
                TagList(state)
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
