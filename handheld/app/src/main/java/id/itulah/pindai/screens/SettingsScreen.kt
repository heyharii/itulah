package id.itulah.pindai.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import id.itulah.pindai.BuildConfig
import id.itulah.pindai.MainActivity
import id.itulah.pindai.core.Reader
import id.itulah.pindai.core.RadioRecipe
import id.itulah.pindai.data.Api
import id.itulah.pindai.data.ConfigStore
import id.itulah.pindai.ui.kit.*
import id.itulah.pindai.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Clear of the tab squircles and the float they sit on. */
private val FootClearance = 120.dp

/** The fader's whole travel. One instance, so the fader is never handed a "new" range. */
private val PowerRange = Reader.MIN_POWER..Reader.MAX_POWER

/**
 * Setelan.
 *
 * # One card, one scope
 *
 * This is one long column — seven fields and a dozen buttons — and it used to be
 * one composition scope reading the whole [SweepState]: a catalogue poll, an
 * outbox figure or a power reading rebuilt every card and every button on it,
 * and every keystroke in a field did the same. Each card is now a composable of
 * its own that reads only its [slice] of the state, or only its own fields of
 * the form, so a publish redraws the card it is about and a keystroke redraws
 * the card it was typed into. The rest are skipped.
 */
@Composable
fun SettingsScreen(
    activity: MainActivity,
    store: ConfigStore,
    vm: SweepViewModel,
    state: State<SweepState>,
    onSaved: () -> Unit,
) {
    var settings by remember { mutableStateOf(store.load()) }
    var status by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var learning by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    // While this is true the activity hands every key here instead of acting on
    // it. Torn down on the way out, so a screen nobody is looking at cannot
    // swallow the trigger.
    DisposableEffect(learning) {
        activity.onLearnKey = if (learning) {
            { code ->
                store.saveTriggerKeyCode(code)
                settings = settings.copy(triggerKeyCode = code)
                learning = false
            }
        } else null
        onDispose { activity.onLearnKey = null }
    }

    Column(
        Modifier.fillMaxSize().background(Surface.canvas)
            .verticalScroll(rememberScrollState())
            .padding(start = Space.lg, end = Space.lg, top = Space.sm, bottom = FootClearance),
        verticalArrangement = Arrangement.spacedBy(Space.sm),
    ) {

        CatalogueCard(vm, state)

        // The bench's instruments, and only on a bench build. Every control in
        // this card and the next one changes what the radio does or what counts
        // as a product — marriages that turn foreign tags into stock, a "bench
        // mode", sessions and slot counts that hide tags, Selects that leave the
        // module deaf — and in a shop they were one tap away from a count. The
        // view model refuses them in a release too; this keeps them off screen.
        if (BuildConfig.BENCH) BenchRadioCard(vm, state)

        if (BuildConfig.BENCH) BenchFilterCard(vm, state)

        TriggerCard(
            keyCode = settings.triggerKeyCode,
            learning = learning,
            onLearn = { learning = !learning },
        )

        NodeCard(
            baseUrl = settings.baseUrl,
            siteId = settings.siteId,
            pool = settings.pool,
            onBaseUrl = { settings = settings.copy(baseUrl = it) },
            onSiteId = { settings = settings.copy(siteId = it) },
            onPool = { settings = settings.copy(pool = it) },
        )

        DeviceCard(
            deviceId = settings.deviceId,
            deviceKey = settings.deviceKey,
            onDeviceId = { settings = settings.copy(deviceId = it) },
            onDeviceKey = { settings = settings.copy(deviceKey = it) },
        )

        if (BuildConfig.BENCH) ReaderPowerCard(vm, state)
        else HubCard {
            SectionLabel("Reader")
            Spacer(Modifier.height(Space.sm))
            Text("Consistent count · ${RadioRecipe.ID}", style = Type.cell, color = Ink.ink)
            Spacer(Modifier.height(Space.sm))
            Text(RadioRecipe.GUIDANCE, style = Type.meta, color = Ink.mute)
        }

        OperatorCard(
            token = settings.operatorToken,
            state = state,
            onToken = { settings = settings.copy(operatorToken = it) },
        )

        status?.let {
            Text(it, style = Type.cell, color = if (failed) BadFg else OkFg,
                modifier = Modifier.padding(top = Space.xs))
        }

        QuietButton("Test connection", enabled = !busy,
            modifier = Modifier.fillMaxWidth().padding(top = Space.xs), onClick = {
            busy = true; status = null
            scope.launch {
                val result = withContext(Dispatchers.IO) {
                    runCatching { Api(settings).health() }
                }
                result.onSuccess { json ->
                    failed = false
                    status = "connected · " + json.optString("node_role", "?") +
                        " · " + json.optString("database", "?")
                }.onFailure { failed = true; status = it.message ?: "failed" }
                busy = false
            }
        })

        PrimaryButton("Save", enabled = !busy, big = true,
            modifier = Modifier.fillMaxWidth(), onClick = {
            // The power is the fader's, and the fader has already written it
            // down. The form's copy is whatever it was when this screen opened,
            // and saving it here would put the antenna's old figure back.
            store.save(settings.copy(readerPower = store.load().readerPower))
            settings = store.load()
            failed = false; status = "saved"; onSaved()
        })
    }
}

/** What the catalogue card draws from the state. */
private data class CatalogueView(
    val catalogue: CatalogueStatus,
    val outboxPending: Int,
    val outboxRefused: Int,
)

@Composable
private fun CatalogueCard(vm: SweepViewModel, state: State<SweepState>) {
    val view by state.slice { CatalogueView(it.catalogue, it.outboxPending, it.outboxRefused) }
    val current = view
    val catalogue = current.catalogue
    HubCard {
        SectionLabel("Catalogue")
        Spacer(Modifier.height(Space.md))
        KeyValue("Generation", catalogue.generation.takeIf { it > 0 }?.toString() ?: "—")
        KeyValue("Products", catalogue.items.toString())
        KeyValue("Unsent evidence", current.outboxPending.toString())
        // Refused for good, and kept: out of the way of everything behind
        // it, but a person has to know it is there, and that Save — the
        // place a wrong node or pool is fixed — offers it again.
        if (current.outboxRefused > 0) {
            Spacer(Modifier.height(Space.xs))
            Text(
                "${current.outboxRefused} batches refused by the node · kept on this " +
                    "handheld · Save offers them again",
                style = Type.metric, color = BadFg,
            )
        }
        catalogue.note?.let {
            Spacer(Modifier.height(Space.xs))
            Text(it, style = Type.meta, color = Ink.mute)
        }
        Spacer(Modifier.height(Space.md))
        QuietButton(
            text = if (catalogue.syncing) "Checking…" else "Check for a new catalogue",
            onClick = { vm.refreshCatalogue() },
            enabled = !catalogue.syncing,
        )
        Spacer(Modifier.height(Space.md))
        Text(
            "The catalogue is a whole snapshot with a generation, so this asks one " +
                "question and usually gets \"the one you already have\". Scanning never " +
                "waits for it.",
            style = Type.meta, color = Ink.mute,
        )
    }
}

/**
 * The radio's Gen2X instruments. Bench builds only — see [SettingsScreen].
 *
 * It shows most of the state, so it reads the whole value; but it reads it in
 * a scope of its own, so a publish redraws this card and not the screen.
 */
@Composable
private fun BenchRadioCard(vm: SweepViewModel, holder: State<SweepState>) {
    val state = holder.value
    HubCard {
        SectionLabel("Tag silicon · Gen2X")
        Spacer(Modifier.height(Space.md))
        // First control in the card, because it is the one somebody reaches
        // for when the reader has stopped finding things.
        QuietButton("Reset radio to defaults", onClick = { vm.resetRadio() })
        Spacer(Modifier.height(Space.sm))
        KeyValue("Tags married to products", state.aliasCount.toString())
        if (state.engineBeliefs.isNotBlank()) {
            Text("engine: " + state.engineBeliefs, style = Type.id, color = Ink.faint)
        }
        Spacer(Modifier.height(Space.sm))
        Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
            QuietButton("Export EPCs", onClick = { vm.exportEpcs("sweep") })
            QuietButton("Marry detected tags", onClick = { vm.marryDetectedTags() })
            QuietButton("Forget", onClick = { vm.divorceTags() })
        }
        state.aliasNote?.let {
            Spacer(Modifier.height(Space.xs))
            Text(it, style = Type.meta, color = Ink.mute)
        }
        Spacer(Modifier.height(Space.xs))
        Text(
            "Bench only. Nothing is written to any tag, and the evidence filed to " +
                "the Edge still carries the real EPC — this only changes what THIS " +
                "handheld calls them, so a rig full of other people's tags can " +
                "exercise the whole screen.",
            style = Type.meta, color = Ink.mute,
        )
        Spacer(Modifier.height(Space.sm))
        QuietButton(
            text = if (state.countEveryTag) "Bench mode: ON — counting every tag"
                else "Bench mode: off",
            onClick = { vm.setCountEveryTag(!state.countEveryTag) },
        )
        if (state.countEveryTag) {
            Spacer(Modifier.height(Space.xs))
            Text(
                "Every tag is a line, whatever its EPC says. These sweeps are " +
                    "recorded as BENCH and are a count of transponders, not of stock.",
                style = Type.meta, color = WarnFg,
            )
        }
        Spacer(Modifier.height(Space.md))
        KeyValue(
            "Chip",
            state.chip?.let { "${it.vendor} · ${it.model}" }
                ?: "sweep with FastID on to find out",
        )
        KeyValue("Tag Focus", if (state.gen2.tagFocus) "on" else "off")
        KeyValue("FastID", if (state.gen2.fastId) "on" else "off")
        KeyValue(
            "Gen2 session",
            state.gen2.session.takeIf { it >= 0 }?.let { "S$it" } ?: "—",
        )
        // What the last sweep cost the radio, which is the only way to see
        // whether Tag Focus did anything: it does not change what is
        // counted, it changes how much air time was spent counting it.
        // The radio's own figure, not the operator's. See ScanCounts.distinctTags.
        KeyValue("Distinct tags", state.counts.distinctTags.toString())
        KeyValue("Sightings", state.metrics.sightings.toString())
        KeyValue(
            "Duplicates",
            "%d (%.1f%%)".format(
                state.metrics.duplicates,
                state.metrics.dedupRatio * 100,
            ),
        )
        KeyValue("Queue high-water", state.metrics.queueDepth.toString())
        KeyValue("Dropped", state.metrics.dropped.toString())
        if (state.sdkCalls.isNotEmpty()) {
            Spacer(Modifier.height(Space.xs))
            Text("vendor calls (newest last):", style = Type.meta, color = Ink.mute)
            state.sdkCalls.takeLast(6).forEach {
                Text(
                    it, style = Type.id,
                    color = if (it.endsWith("false") || it.contains("THREW")) BadFg else Ink.faint,
                )
            }
        }
        if (state.epcShapes.isNotBlank()) {
            Spacer(Modifier.height(Space.xs))
            Text("EPC shapes:", style = Type.meta, color = Ink.mute)
            Text(state.epcShapes, style = Type.id, color = Ink.faint)
        }
        if (state.foreignSample.isNotEmpty()) {
            Spacer(Modifier.height(Space.xs))
            Text("unnamed EPCs:", style = Type.meta, color = Ink.mute)
            state.foreignSample.forEach {
                Text(it, style = Type.id, color = Ink.faint)
            }
        }
        if (state.gen2Dump.isNotBlank()) {
            Spacer(Modifier.height(Space.xs))
            Text(state.gen2Dump, style = Type.id, color = Ink.faint)
        }
        Spacer(Modifier.height(Space.md))
        Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
            QuietButton(
                text = if (state.gen2.tagFocus) "Tag Focus off" else "Tag Focus on",
                onClick = { vm.setGen2Extensions(!state.gen2.tagFocus, state.gen2.fastId) },
            )
            QuietButton(
                text = if (state.gen2.fastId) "FastID off" else "FastID on",
                onClick = { vm.setGen2Extensions(state.gen2.tagFocus, !state.gen2.fastId) },
            )
        }
        Spacer(Modifier.height(Space.sm))
        Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
            // S3 is here for completeness, not because anything will use
            // it: it behaves like S2 and exists so a third application can
            // have a flag of its own in a building that already has two.
            listOf(0, 1, 2, 3).forEach { session ->
                QuietButton(
                    text = "S$session",
                    onClick = { vm.setSession(session) },
                    enabled = state.gen2.session != session,
                )
            }
        }
        Spacer(Modifier.height(Space.sm))
        Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
            // Labelled in SLOTS, because that is the thing being chosen.
            // "Q=6" read as six for long enough in this project to matter.
            listOf(2 to 4, 4 to 16, 6 to 64).forEach { (exponent, slots) ->
                QuietButton(
                    text = "$slots slots",
                    onClick = { vm.setStartQ(exponent) },
                )
            }
        }
        Spacer(Modifier.height(Space.md))
        Text(
            "The reader in this handheld is an Impinj E710, so half of Gen2X is " +
                "already settled; the other half is whatever chip is on the garment. " +
                "Tag Focus quiets a tag once it has been counted, so the radio stops " +
                "re-reading a rack it has already done. FastID brings the TID back " +
                "with the EPC, which is what names the chip above. A tag that is not " +
                "Impinj simply ignores both and inventories normally.",
            style = Type.meta, color = Ink.mute,
        )
    }
}

/** The Select filter. Bench builds only, and in its own scope like [BenchRadioCard]. */
@Composable
private fun BenchFilterCard(vm: SweepViewModel, holder: State<SweepState>) {
    val state = holder.value
    HubCard {
        SectionLabel("Radio filter")
        Spacer(Modifier.height(Space.md))
        QuietButton(
            text = if (state.oursOnly) "Hearing OUR tags only — tap to hear everything"
                else "Ignore tags that are not ours",
            onClick = { vm.setOursOnly(!state.oursOnly) },
        )
        Spacer(Modifier.height(Space.xs))
        Text(
            "Eight bits of Select on the EPC header. A pallet label or a supplier's " +
                "own tag then never answers at all — no air time, no sighting, no " +
                "work here. Safe while counting, because it narrows to everything " +
                "of ours rather than to one product.",
            style = Type.meta, color = Ink.mute,
        )
        Spacer(Modifier.height(Space.md))
        Field("Select probe  pointer/bits/hex", state.skuFilter) { vm.tryRawFilter(it) }
        state.filterNote?.let {
            Spacer(Modifier.height(Space.xs))
            Text(it, style = Type.meta, color = Ink.mute)
        }
        Spacer(Modifier.height(Space.md))
        QuietButton("Clear filter", onClick = { vm.setSkuFilter("") })
        Spacer(Modifier.height(Space.md))
        Text(
            "A Gen2 Select on the first 52 bits of the EPC — the header and the " +
                "eleven SKU digits — so the serial is ignored and the match means " +
                "\"this product, any unit\". A tag that does not match never answers, " +
                "which costs no air time at all. NOTE: this module is already known " +
                "to accept a filter on the WRITE path and then not apply it, so " +
                "acceptance here proves nothing until a sweep shows only one SKU " +
                "coming back.",
            style = Type.meta, color = Ink.mute,
        )
    }
}

@Composable
private fun TriggerCard(keyCode: Int, learning: Boolean, onLearn: () -> Unit) {
    HubCard {
        SectionLabel("Trigger")
        Spacer(Modifier.height(Space.md))
        KeyValue(
            "Key code",
            keyCode.takeIf { it > 0 }?.toString() ?: "not learned yet",
        )
        Spacer(Modifier.height(Space.md))
        QuietButton(
            text = if (learning) "Pull the trigger now…" else "Learn the trigger",
            onClick = onLearn,
        )
        Spacer(Modifier.height(Space.md))
        Text(
            "Press and release starts reading; press again to stop. The keycode is " +
                "learned rather than assumed because C5 firmware has shipped reporting " +
                "five different numbers for the same button, and a guessed one does " +
                "nothing at all — which on the floor looks exactly like a broken reader.",
            style = Type.meta, color = Ink.mute,
        )
    }
}

@Composable
private fun NodeCard(
    baseUrl: String,
    siteId: String,
    pool: String,
    onBaseUrl: (String) -> Unit,
    onSiteId: (String) -> Unit,
    onPool: (String) -> Unit,
) {
    HubCard {
        SectionLabel("Node")
        Spacer(Modifier.height(Space.md))
        Field("Edge URL", baseUrl, onChange = onBaseUrl)
        Field("Site ID", siteId, onChange = onSiteId)
        Field("Pool", pool, onChange = onPool)
        Spacer(Modifier.height(Space.md))
        Text("One build serves a DC and a shop; which one a handheld belongs to is a " +
            "deployment fact, not a code fact.",
            style = Type.meta, color = Ink.mute)
    }
}

@Composable
private fun DeviceCard(
    deviceId: String,
    deviceKey: String,
    onDeviceId: (String) -> Unit,
    onDeviceKey: (String) -> Unit,
) {
    HubCard {
        SectionLabel("Device identity")
        Spacer(Modifier.height(Space.md))
        Field("Device ID", deviceId, onChange = onDeviceId)
        Field("Device key", deviceKey, secret = true, onChange = onDeviceKey)
        Spacer(Modifier.height(Space.md))
        Text("This key signs every batch of evidence. It proves WHICH READER read — " +
            "never who was holding it.",
            style = Type.meta, color = Ink.mute)
    }
}

@Composable
private fun OperatorCard(token: String, state: State<SweepState>, onToken: (String) -> Unit) {
    val note by state.slice { it.operatorNote }
    HubCard {
        SectionLabel("Operator (optional)")
        Spacer(Modifier.height(Space.md))
        Field("Bearer token", token, secret = true, onChange = onToken)
        // The Edge refused this sign-in while filing. Evidence still goes
        // — under the reader's own proof — so this is a note, not an alarm;
        // the remedy is a fresh token here and Save.
        note?.let {
            Text(it, style = Type.metric, color = WarnFg)
        }
        Spacer(Modifier.height(Space.md))
        Text("For audit attribution, and for packing, receiving and counting, which " +
            "do need a human session.",
            style = Type.meta, color = Ink.mute)
    }
}

/** What the power card draws from the state. */
private data class PowerView(
    val readerPower: Int,
    val busy: Boolean,
    val note: String?,
    val fromModule: Boolean,
)

/**
 * How far this reader shouts.
 *
 * The only setting on this screen that is not a deployment fact, and the only
 * one anybody comes back for. Thirty dBm reaches the back of a rack — and, in a
 * shop, the rack on the other side of the wall, which is how a floor count
 * quietly acquires the stockroom and nobody ever finds out. Turning it down is
 * how you make the sweep mean the aisle you are standing in.
 *
 * The figure shown is what the MODULE reported after the change, never the
 * number the finger asked for. `setPower` answers true for values this firmware
 * then settles elsewhere, and the whole point of a control like this is that the
 * person holding it knows what the antenna is actually doing.
 */
@Composable
private fun ReaderPowerCard(vm: SweepViewModel, state: State<SweepState>) {
    val view by state.slice { PowerView(it.readerPower, it.busy, it.powerNote, it.powerFromModule) }
    val current = view
    // Where the finger has the fader. Whenever the module answers — and no
    // change is under way — it goes back to the module's figure, so what the
    // fader rests on is what the antenna is doing.
    var power by remember { mutableIntStateOf(current.readerPower.takeIf { it > 0 } ?: Reader.MAX_POWER) }
    val modulePower = current.readerPower
    val busy = current.busy
    LaunchedEffect(modulePower, busy) {
        if (!busy) modulePower.takeIf { it > 0 }?.let { power = it }
    }
    // Moving the power closes and re-opens the module: measured about four
    // seconds here, at rest, against seven mid-sweep where a running inventory
    // has to be stopped and started too. Without a word on screen those are
    // four seconds of nothing happening, and the honest reading of nothing
    // happening is that the drag did not take — so the next thing somebody does
    // is drag again, and queue a second re-open behind the first.
    //
    // The work itself is the view model's. It used to run in this screen's
    // own scope and write the choice down only at the end, so leaving the tab
    // mid-change cancelled it: the antenna half moved, and the choice was
    // never kept. See [SweepViewModel.setPower].
    val applying = busy

    // Opening the module is not sweeping it: this powers the UART so the figure
    // below can be a reading rather than a guess, and the radio stays quiet
    // until somebody pulls the trigger. Entering this tab has already stopped
    // any sweep, so the getter is being asked at rest — which is the only time
    // this firmware answers it honestly.
    LaunchedEffect(Unit) { vm.readPower() }

    HubCard {
        SectionLabel("Reader power")
        Spacer(Modifier.height(Space.sm))
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Bottom,
        ) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text("$power", style = Type.total, color = Ink.ink)
                Spacer(Modifier.width(Space.xs))
                Text("dBm", style = Type.meta, color = Ink.mute,
                    modifier = Modifier.padding(bottom = 6.dp))
            }
            current.note?.let {
                Text(it, style = Type.meta,
                    // Three states, three greys: what the module just said, what
                    // it said a while ago, and what nobody has confirmed at all.
                    color = when {
                        applying -> Ink.text
                        !current.fromModule -> Ink.faint
                        else -> Ink.mute
                    },
                    modifier = Modifier.padding(bottom = 5.dp))
            }
        }
        Spacer(Modifier.height(Space.md))
        Fader(
            value = power,
            range = PowerRange,
            onChange = { power = it },
            // The view model writes the choice down first and then moves the
            // antenna, and refuses a second change while one is under way. A
            // closed module keeps the choice and applies it when it wakes, and
            // the caption says which of the two happened.
            onCommit = { vm.setPower(power) },
        )
        Spacer(Modifier.height(Space.sm))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("${Reader.MIN_POWER} · the shelf in front of you",
                style = Type.meta, color = Ink.mute)
            Text("${Reader.MAX_POWER} · the whole aisle",
                style = Type.meta, color = Ink.mute)
        }
        Spacer(Modifier.height(Space.md))
        Text("Full power reads the back of a rack, and through a wall. A count " +
            "that quietly includes the next room is wrong in the one way nobody " +
            "checks — so this belongs to the job, not to the device.",
            style = Type.meta, color = Ink.mute)
    }
}

/** A settings line. The chrome is [HubField]'s; this only names the line. */
@Composable
private fun Field(
    label: String,
    value: String,
    secret: Boolean = false,
    onChange: (String) -> Unit,
) {
    HubField(
        value = value,
        onChange = onChange,
        label = label,
        secret = secret,
        modifier = Modifier.padding(bottom = Space.md),
    )
}
