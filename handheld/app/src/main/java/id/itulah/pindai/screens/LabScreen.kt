package id.itulah.pindai.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import id.itulah.pindai.core.Knobs
import id.itulah.pindai.core.StartMode
import id.itulah.pindai.ui.kit.*
import id.itulah.pindai.ui.theme.*

/** Clear of the tab squircles. */
private val FootClearance = 120.dp

/** Where the mid-sweep test moves the antenna: below full power, so the fall shows. */
private val DYNAMIC_DBM = listOf(15, 20, 25)

/** The raw power writes, with option byte 00. */
private val RAW_DBM = listOf(20, 25, 30)

/**
 * The bench, on its own screen.
 *
 * # Why this is not in Setelan
 *
 * It was, and that is what stopped the research. Setelan had grown to hold the
 * node, the device identity, the operator token, reader power, the catalogue,
 * the trigger, the marriage, the filter and every Gen2X control — and a screen
 * that long cannot be driven. Every experiment this evening failed at the same
 * place: a control scrolled out of reach, a tap that silently missed, and a
 * measurement of a radio that had been told nothing.
 *
 * So the instrument gets its own bench, short enough that every control is one
 * scroll away and each one sits next to the number it changes.
 */
@Composable
fun LabScreen(vm: SweepViewModel, holder: State<SweepState>) {
    // The bench reads nearly everything, so it takes the whole value — but in
    // its own scope, so the shell around it does not recompose with it.
    val state = holder.value
    Column(
        Modifier.fillMaxSize().background(Surface.canvas)
            .verticalScroll(rememberScrollState())
            .padding(start = Space.lg, end = Space.lg, top = Space.sm, bottom = FootClearance),
        verticalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        HubCard {
            SectionLabel("What the last sweep found")
            Spacer(Modifier.height(Space.md))
            KeyValue("Distinct tags", state.counts.distinctTags.toString())
            KeyValue("Products", state.counts.units.toString())
            KeyValue("Malformed reads", state.counts.malformed.toString())
            KeyValue("Sightings", state.metrics.sightings.toString())
            KeyValue(
                "Duplicates",
                "%d (%.1f%%)".format(state.metrics.duplicates, state.metrics.dedupRatio * 100),
            )
            // The figure that actually answers "is the tag going quiet": how
            // long between one read of a garment and the next read of THAT
            // garment. A duplicate ratio flattens this away.
            KeyValue(
                "Gap between re-reads",
                if (state.gaps.samples == 0L) "—"
                else "%.0f ms mean · %d ms max".format(state.gaps.meanMs, state.gaps.maxMs),
            )
            KeyValue("Gaps over 500 ms", state.gaps.over500ms.toString())
            if (state.epcShapes.isNotBlank()) {
                Spacer(Modifier.height(Space.xs))
                Text(state.epcShapes, style = Type.id, color = Ink.faint)
            }
        }

        HubCard {
            SectionLabel("Radio")
            Spacer(Modifier.height(Space.md))
            KeyValue("Chip", state.chip?.let { "${it.vendor} · ${it.model}" } ?: "—")
            KeyValue("Tag Focus", if (state.gen2.tagFocus) "ON" else "off")
            KeyValue("FastID", if (state.gen2.fastId) "ON" else "off")
            KeyValue("Session", state.gen2.session.takeIf { it >= 0 }?.let { "S$it" } ?: "—")
            Spacer(Modifier.height(Space.md))
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                QuietButton(
                    if (state.gen2.tagFocus) "Focus OFF" else "Focus ON",
                    onClick = { vm.setGen2Extensions(!state.gen2.tagFocus, state.gen2.fastId) },
                )
                QuietButton(
                    if (state.gen2.fastId) "FastID OFF" else "FastID ON",
                    onClick = { vm.setGen2Extensions(state.gen2.tagFocus, !state.gen2.fastId) },
                )
            }
            Spacer(Modifier.height(Space.sm))
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                listOf(0, 1, 2, 3).forEach { s ->
                    QuietButton("S$s", onClick = { vm.setSession(s) }, enabled = state.gen2.session != s)
                }
            }
            Spacer(Modifier.height(Space.sm))
            QuietButton("Reset radio", onClick = { vm.resetRadio() })
            if (state.gen2Dump.isNotBlank()) {
                Spacer(Modifier.height(Space.xs))
                Text(state.gen2Dump, style = Type.id, color = Ink.faint)
            }
        }

        // The SDK's knobs, as reverse engineering found them. None of them is
        // saved, and none touches the floor's profile.
        val knobs = state.knobs
        val atRest = !state.sweeping && !state.starting && !state.busy && !knobs.running

        HubCard {
            SectionLabel("Start frame")
            Spacer(Modifier.height(Space.md))
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                StartMode.entries.forEach { mode ->
                    QuietButton(
                        mode.label, onClick = { vm.setStartMode(mode) },
                        enabled = atRest && knobs.startMode != mode,
                    )
                }
            }
            KeyValue("Next start", knobs.startMode.frame, mono = true)
            knobs.frames?.let { f ->
                KeyValue(
                    "Frames · ${f.mode.label}",
                    if (f.frames == 0L) "0 · start unproven" else f.frames.toString(),
                )
                KeyValue("Stronger than −25 dBm", f.strong.toString())
                if (f.mode != StartMode.NORMAL) {
                    KeyValue("With phase or freq", f.extras.toString())
                    KeyValue("Last phase", f.lastPhase.takeIf { it != 0 }?.toString())
                    KeyValue(
                        "Last frequency",
                        f.lastFrequencyMhz.takeIf { it != 0f }?.let { "%.3f MHz".format(it) },
                    )
                }
            }
            knobs.drops?.let {
                Spacer(Modifier.height(Space.xs))
                Text(it, style = Type.id, color = Ink.body)
            }
            Spacer(Modifier.height(Space.sm))
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                // The trigger is not armed on this tab, so the bench starts
                // its own round.
                QuietButton(
                    if (state.sweeping) "Stop sweep" else "Start sweep",
                    onClick = { vm.toggleSweep() },
                    enabled = !state.busy && !state.starting,
                )
                QuietButton("Count drops", onClick = { vm.countDrops() }, enabled = atRest)
            }
            Spacer(Modifier.height(Space.xs))
            Text(
                "Dropped ≈ okcnt − frames − 1 · logcat tag DeviceAPI, line UHF_StopGet: okcnt=…",
                style = Type.meta, color = Ink.mute,
            )
        }

        HubCard {
            SectionLabel("Power mid-sweep")
            Spacer(Modifier.height(Space.md))
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                DYNAMIC_DBM.forEach { dbm ->
                    QuietButton(
                        "$dbm dBm", onClick = { vm.dynamicPowerTest(dbm) },
                        enabled = state.sweeping && !state.busy && !knobs.running,
                    )
                }
            }
            if (knobs.running && state.sweeping) {
                Spacer(Modifier.height(Space.xs))
                Text("listening · about 7 s", style = Type.meta, color = Ink.mute)
            }
            if (knobs.dynamic.isNotEmpty()) {
                Spacer(Modifier.height(Space.xs))
                knobs.dynamic.forEach { Text(it, style = Type.id, color = Ink.body) }
            }
        }

        HubCard {
            SectionLabel("Module at rest")
            Spacer(Modifier.height(Space.md))
            knobs.readout?.let { r ->
                KeyValue("Region", Knobs.regionName(r.region))
                KeyValue("Fast inventory", r.fastInventory?.toString())
                // Status 0 is the native call succeeding, not a status byte.
                KeyValue(
                    "Work · wait",
                    if (r.pwmStatus == 0) "${r.pwmWorkMs} · ${r.pwmWaitMs} ms" else "failed (${r.pwmStatus})",
                )
                KeyValue("Temperature", r.temperature.takeIf { it != -1 }?.let { "$it °C" })
                KeyValue("Hardware", r.hardware)
                KeyValue("Power read-back", r.power.takeIf { it > 0 }?.let { "$it dBm" })
                Spacer(Modifier.height(Space.sm))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                QuietButton("Read", onClick = { vm.readModule() }, enabled = atRest)
                QuietButton("Re-open", onClick = { vm.reopenReader() }, enabled = atRest)
            }
            Spacer(Modifier.height(Space.sm))
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                RAW_DBM.forEach { dbm ->
                    QuietButton("Raw $dbm", onClick = { vm.rawPower(dbm) }, enabled = atRest)
                }
            }
            knobs.raw?.let {
                Spacer(Modifier.height(Space.xs))
                Text(it, style = Type.id, color = Ink.body)
            }
            Spacer(Modifier.height(Space.sm))
            QuietButton(
                if (knobs.ignorePowerOff) "UHF_POWER_OFF ignored" else "UHF_POWER_OFF obeyed",
                onClick = { vm.setIgnorePowerOff(!knobs.ignorePowerOff) },
                enabled = !knobs.running,
            )
            KeyValue(
                "Power-off receiver",
                when (knobs.powerOffReceiver) {
                    true -> "registered"
                    false -> "unregistered"
                    null -> null
                },
            )
            knobs.note?.let {
                Spacer(Modifier.height(Space.xs))
                Text(it, style = Type.meta, color = Ink.mute)
            }
        }

        HubCard {
            SectionLabel("Select filter")
            Spacer(Modifier.height(Space.md))
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                QuietButton("Aim ptr 32", onClick = { vm.probeFilterOnFirstTag(32) })
                QuietButton("Aim ptr 0", onClick = { vm.probeFilterOnFirstTag(0) })
            }
            Spacer(Modifier.height(Space.sm))
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                QuietButton(
                    if (state.oursOnly) "A0 filter ON" else "A0 filter",
                    onClick = { vm.setOursOnly(!state.oursOnly) },
                )
                QuietButton("Clear", onClick = { vm.setOursOnly(false) })
            }
            state.filterNote?.let {
                Spacer(Modifier.height(Space.xs))
                Text(it, style = Type.meta, color = Ink.mute)
            }
        }

        HubCard {
            SectionLabel("Vendor calls")
            Spacer(Modifier.height(Space.sm))
            if (state.sdkCalls.isEmpty()) {
                Text("nothing asked yet", style = Type.meta, color = Ink.mute)
            } else {
                // Refusals in red. Every setter in this SDK returns a boolean
                // and the code used to throw it away — which is how a mask one
                // nibble short of a whole byte was refused before it reached the
                // radio, while the app went on measuring as if a filter were in
                // force.
                state.sdkCalls.takeLast(8).forEach {
                    Text(
                        it, style = Type.id,
                        color = when {
                            it.contains("THREW") -> BadFg
                            it.endsWith("false") -> BadFg
                            else -> Ink.body
                        },
                    )
                }
            }
        }

        HubCard {
            SectionLabel("Bench")
            Spacer(Modifier.height(Space.md))
            KeyValue("Tags married", state.aliasCount.toString())
            Spacer(Modifier.height(Space.sm))
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                QuietButton("Marry", onClick = { vm.marryDetectedTags() })
                QuietButton("Forget", onClick = { vm.divorceTags() })
                QuietButton("Export", onClick = { vm.exportEpcs("sweep") })
            }
            state.aliasNote?.let {
                Spacer(Modifier.height(Space.xs))
                Text(it, style = Type.meta, color = Ink.mute)
            }
        }
    }
}
