package id.itulah.pindai.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.itulah.pindai.data.StoreCheck
import id.itulah.pindai.data.VerifyStore
import id.itulah.pindai.ui.kit.*
import id.itulah.pindai.ui.theme.*
import kotlinx.coroutines.delay

/** Clearance for the floating tab squircles and their float. */
private val FootClearance = 150.dp

/** Where a verify is. Ordered, so the transition knows which way it went. */
private enum class VerifyStage { LIST, SWEEP }

/**
 * Verify koli, on the Gudang (owner, 25 Oct 2026): choose a store Packed sent,
 * sweep its koli, and Verify — offered only when the read is the same.
 *
 * Unlike a shop's receive this is not blind. The point is to find the koli
 * that is short or the koli of another store before the truck is loaded, so
 * every koli shows how many of its tags were heard.
 */
@Composable
internal fun VerifyScreen(vm: SweepViewModel, state: State<SweepState>) {
    val stage by state.slice { if (it.isVerifyingStore) VerifyStage.SWEEP else VerifyStage.LIST }
    AnimatedContent(
        targetState = stage,
        transitionSpec = {
            val forward = targetState.ordinal >= initialState.ordinal
            (slideInHorizontally(tween(Motion.page, easing = Motion.easeOut)) {
                if (forward) it / 6 else -it / 6
            } + fadeIn(tween(Motion.page, easing = Motion.easeOut)))
                .togetherWith(fadeOut(tween(Motion.pop)))
        },
        label = "verify",
    ) { shown ->
        when (shown) {
            VerifyStage.SWEEP -> StoreSweep(vm, state)
            VerifyStage.LIST -> StoreList(vm, state)
        }
    }
}

// ------------------------------------------------------------------- list

/** What the store list draws, and only that. */
private data class StoreListView(
    val verify: VerifyState,
    /** Tags already swept and held for whichever store is chosen next. */
    val held: Int,
    val sweeping: Boolean,
    val message: String?,
    val failed: Boolean,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StoreList(vm: SweepViewModel, state: State<SweepState>) {
    val view by state.slice {
        StoreListView(
            verify = it.verify,
            held = it.counts.units + it.counts.unknownUnits,
            sweeping = it.sweeping,
            message = it.message,
            failed = it.failed,
        )
    }
    val current = view
    val verify = current.verify
    val pull = rememberPullToRefreshState()
    var refreshing by remember { mutableStateOf(false) }
    LaunchedEffect(verify.refreshes) { refreshing = false }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            vm.loadVerifyStores()
        },
        modifier = Modifier.fillMaxSize().background(Surface.canvas),
        state = pull,
        indicator = {
            PullToRefreshDefaults.Indicator(
                state = pull,
                isRefreshing = refreshing,
                modifier = Modifier.align(Alignment.TopCenter),
                containerColor = Surface.canvas,
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
                Text(
                    "Choose a store", style = Type.hero, color = Ink.ink,
                    modifier = Modifier.padding(bottom = Space.xs),
                )
            }

            verify.done?.let { done ->
                item(key = "done") {
                    HubCard(onPress = vm::closeVerifyDone) {
                        Text(done, style = Type.cardTitle, color = OkFg)
                    }
                }
            }

            val held = current.held
            if (held > 0 && !current.sweeping) {
                item(key = "held") {
                    HubCard {
                        Text("$held tags already swept", style = Type.cardTitle, color = Ink.ink)
                        Spacer(Modifier.height(Space.sm))
                        DiscardSweep(held, vm::discardSweep)
                    }
                }
            }

            verify.note?.let { note ->
                item(key = "note") { Text(note, style = Type.cell, color = BadFg) }
            }
            current.message?.let { message ->
                val failed = current.failed
                item(key = "message") {
                    Text(message, style = Type.cell, color = if (failed) BadFg else OkFg)
                }
            }

            if (verify.stores.isEmpty()) {
                item(key = "empty") {
                    Box(
                        Modifier.fillMaxWidth().padding(vertical = 72.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (!verify.loaded || (verify.loading && verify.note == null)) {
                            Text("Looking for stores…", style = Type.cell, color = Ink.mute)
                        } else {
                            Text(
                                "No store waiting", style = Type.hero, color = Ink.faint,
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                }
            }

            items(verify.stores, key = { it.storeId }, contentType = { "store" }) { store ->
                StoreRow(store, onChoose = vm::chooseVerifyStore)
            }

            item(key = "refresh") {
                // Pull-to-refresh is a gesture nobody discovers in a glove.
                QuietButton(
                    text = if (verify.loading) "Checking…" else "Refresh",
                    onClick = vm::loadVerifyStores,
                    enabled = !verify.loading,
                    modifier = Modifier.fillMaxWidth().padding(top = Space.xs),
                )
            }
        }
    }
}

/** One store: its name, how many koli, and how many tags they hold. */
@Composable
private fun StoreRow(store: VerifyStore, onChoose: (VerifyStore) -> Unit) {
    HubCard(
        onPress = { onChoose(store) },
        padding = PaddingValues(horizontal = Space.lg, vertical = Space.md),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    store.name, style = Type.cardTitle, color = Ink.ink,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    storeLine(store), style = Type.meta, color = Ink.mute,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.width(Space.md))
            Column(horizontalAlignment = Alignment.End) {
                Text("${store.koli.size}", style = Type.kpi, color = Ink.ink)
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

/** "KMG · 312 tags · sent by hari 25 october 10.12", whichever parts are known. */
private fun storeLine(store: VerifyStore): String = listOfNotNull(
    store.code.takeIf { it.isNotBlank() && it != store.name },
    "${store.total} tags",
    store.requestedBy.takeIf { it.isNotBlank() }?.let { by ->
        "sent by $by" + (localWhen(store.requestedAt)?.let { " $it" } ?: "")
    },
).joinToString(" · ")

// ------------------------------------------------------------------ sweep

/** What a store's sweep draws between pulls, and only that. */
private data class StoreSweepView(
    val store: VerifyStore?,
    val ours: Int,
    val check: StoreCheck?,
    val checking: Boolean,
    val busy: Boolean,
    val sweeping: Boolean,
    val message: String?,
    val failed: Boolean,
)

/**
 * The store being verified, at rest between pulls.
 *
 * Each pull adds to the sweep and Central answers when the trigger is let go:
 * how many tags of each koli were heard, and whose koli a stray tag belongs to.
 * Verify lights only on an answer that is the same.
 */
@Composable
private fun StoreSweep(vm: SweepViewModel, state: State<SweepState>) {
    val view by state.slice {
        StoreSweepView(
            store = it.verify.chosen,
            ours = it.counts.units + it.counts.unknownUnits,
            check = it.verify.check,
            checking = it.verify.checking,
            busy = it.busy,
            sweeping = it.sweeping,
            message = it.message,
            failed = it.failed,
        )
    }
    val current = view
    val store = current.store ?: return
    val check = current.check
    val figure = remember { Type.display.copy(fontSize = 64.sp, lineHeight = 70.sp) }

    LazyColumn(
        modifier = Modifier.fillMaxSize().background(Surface.canvas),
        contentPadding = PaddingValues(
            start = Space.lg, end = Space.lg, top = Space.sm, bottom = FootClearance,
        ),
        verticalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        item(key = "store") {
            HubCard {
                SectionLabel("Verifying")
                Spacer(Modifier.height(Space.xs))
                Text(
                    store.name, style = Type.hero, color = Ink.ink,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    listOfNotNull(
                        store.code.takeIf { it.isNotBlank() && it != store.name },
                        "${store.koli.size} koli",
                        "${store.total} tags",
                    ).joinToString(" · "),
                    style = Type.meta, color = Ink.mute,
                )
                Spacer(Modifier.height(Space.md))
                QuietButton(
                    "Change store", onClick = vm::backToVerifyStores,
                    enabled = !current.busy, modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        item(key = "figure") {
            Column(Modifier.padding(top = Space.sm, bottom = Space.xs)) {
                if (check != null) {
                    Text(
                        "${check.read} / ${check.total}", style = figure,
                        color = if (check.matches) OkFg else Ink.ink,
                    )
                } else {
                    Text("${current.ours}", style = figure, color = Ink.ink)
                }
                Text(
                    when {
                        current.checking -> "Checking…"
                        check?.matches == true -> "Same"
                        check != null -> "Not the same"
                        current.ours == 0 -> "Pull the trigger and sweep the koli"
                        else -> "tags swept"
                    },
                    style = Type.metric,
                    color = when {
                        check?.matches == true -> OkFg
                        check != null && !current.checking -> WarnFg
                        else -> Ink.body
                    },
                )
            }
        }

        item(key = "verify") {
            PrimaryButton(
                Mode.VERIFY.verb,
                onClick = vm::verifyStore,
                enabled = check?.matches == true && !current.sweeping && !current.checking,
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

        // Every koli of the store, with what the last answer heard of it.
        item(key = "koli-label") {
            SectionLabel("Koli", Modifier.padding(top = Space.sm))
        }
        if (check != null) {
            items(check.koli, key = { "k" + it.koliId }, contentType = { "koli" }) { koli ->
                KoliLine(
                    koli.number, "${koli.read} / ${koli.total}",
                    if (koli.complete) OkFg else WarnFg,
                )
            }
        } else {
            items(store.koli, key = { "k" + it.koliId }, contentType = { "koli" }) { koli ->
                KoliLine(koli.number, "${koli.total}", Ink.body)
            }
        }

        // A tag of another store's koli is a koli in the wrong pile.
        if (check != null && check.wrong.isNotEmpty()) {
            item(key = "wrong-label") {
                SectionLabel("Other stores' koli", Modifier.padding(top = Space.sm))
            }
            items(check.wrong, key = { "w" + it.number }, contentType = { "wrong" }) { wrong ->
                KoliLine("${wrong.number} · ${wrong.storeCode}", "${wrong.tags} tags", BadFg)
            }
        }

        if (current.ours > 0) {
            item(key = "discard") {
                Box(Modifier.padding(top = Space.lg)) { DiscardSweep(current.ours, vm::discardSweep) }
            }
        }
    }
}

/** One koli: its number, and a figure in the colour of how it stands. */
@Composable
private fun KoliLine(label: String, figure: String, tone: Color) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = Space.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label, style = Type.cell, color = Ink.ink,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(Space.md))
        Text(figure, style = Type.metric, color = tone)
    }
}

/**
 * The store named at the top of the SCANNING surface.
 *
 * Handed the store alone, so the count climbing beside it never redraws it.
 */
@Composable
internal fun VerifyBanner(store: VerifyStore) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            store.name, style = Type.cardTitle, color = Ink.ink, textAlign = TextAlign.Center,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Text(
            "verifying · ${store.koli.size} koli · ${store.total} tags",
            style = Type.meta, color = Ink.mute, textAlign = TextAlign.Center,
        )
    }
}

/** Two taps, no dialog — as on Receive: the first arms, left alone it disarms. */
@Composable
private fun DiscardSweep(tags: Int, onDiscard: () -> Unit) {
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
