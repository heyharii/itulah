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
import id.itulah.pindai.ui.kit.*
import id.itulah.pindai.ui.theme.*

/** Clear of the tab squircles. */
private val FootClearance = 120.dp

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
