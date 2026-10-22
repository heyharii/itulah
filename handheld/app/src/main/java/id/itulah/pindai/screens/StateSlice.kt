package id.itulah.pindai.screens

import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.structuralEqualityPolicy

/**
 * One piece of the sweep's state, as a state of its own.
 *
 * # Why no screen takes a [SweepState]
 *
 * The view model publishes ONE immutable [SweepState], and it publishes often:
 * the count five times a second while the radio is live, the filing and outbox
 * figures every two seconds, the catalogue poll, the power reading. A screen
 * handed the value is a screen recomposed by every one of those — a new
 * instance is a changed argument, so nothing under it could skip — and on this
 * hardware a frame costs eighteen milliseconds at best.
 *
 * So screens are handed the [State] itself, which never changes, and each piece
 * of UI picks what it draws:
 *
 * ```
 * val units by state.slice { it.counts.units }
 * ```
 *
 * [pick] runs on every publish, but whoever reads the slice is invalidated only
 * when the result is no longer EQUAL to what it drew — structurally, so a fresh
 * but identical data class is no change. A count update recomposes the figure,
 * not the shell, the tab bar or the rows of a list.
 *
 * Keep [pick] cheap — field reads and small immutable slices, never a sort or a
 * filter over a list — because it runs once per publish for every slice on
 * screen. Anything heavier belongs in a `remember` keyed on the slices it is
 * computed from.
 *
 * # The policy is explicit on purpose
 *
 * Slices are also read inside `LazyColumn` builders, and those builders run
 * inside a derived state of their own. Without a policy, a derived state that
 * recomputes to an EQUAL value still counts as changed one level up — so every
 * publish would rebuild the list and re-run every visible row. With structural
 * equality an unchanged slice is invisible to the list.
 */
@Composable
internal fun <T> State<SweepState>.slice(pick: (SweepState) -> T): State<T> {
    val source = this
    // The newest picker, so one that captures something is never stale. A
    // picker that captures nothing — every one in this app — is the same
    // instance every time, and this costs nothing.
    val picker = rememberUpdatedState(pick)
    return remember(source) {
        derivedStateOf(structuralEqualityPolicy<T>()) { picker.value(source.value) }
    }
}
