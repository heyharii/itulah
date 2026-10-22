package id.itulah.pindai.ui.kit

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.graphics.Color
import id.itulah.pindai.ui.theme.LocalMotion
import id.itulah.pindai.ui.theme.Motion

/**
 * A number that rolls rather than blinks.
 *
 * Only the digits that actually changed move: 49 → 50 rolls the units and
 * leaves the tens alone, so the eye tracks the change instead of re-reading
 * the whole figure. A count climbing during a sweep is the one thing on this
 * screen somebody watches continuously, and a value that swaps in place reads
 * as a flicker at the edge of vision.
 *
 * Counting up rolls upward and counting down rolls downward, because a number
 * that always moves the same way stops carrying the direction of travel.
 *
 * # Still while it is live
 *
 * [animate] false draws the figure as plain text. A live sweep publishes its
 * count every 200 ms and every changed digit rolled for 200 ms, so the 140 sp
 * figure on the scanning screen was never at rest: one roll ran into the next
 * and the screen redrew continuously for the whole sweep, on hardware where a
 * frame costs eighteen milliseconds. A number that changes five times a second
 * reads fine standing still; the roll is for a figure that changes at rest.
 */
@Composable
fun RollingNumber(
    value: Int,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
    animate: Boolean = true,
) {
    val motion = LocalMotion.current
    val text = value.toString()
    if (!animate) {
        Text(text, style = style, color = color, modifier = modifier)
        return
    }
    Row(modifier) {
        text.forEachIndexed { index, digit ->
            // Keyed by position from the RIGHT: when a number gains a digit the
            // units column is still the units column, so 99 → 100 does not
            // re-animate every place. The key is what makes that true — without
            // it Compose matches the digits by position from the LEFT, and a
            // new leading digit shifted every column into its neighbour's slot.
            val place = text.length - index
            key(place) {
                AnimatedContent(
                    targetState = digit,
                    transitionSpec = {
                        if (!motion) {
                            fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                        } else {
                            val up = targetState > initialState
                            (slideInVertically(
                                tween(Motion.panel, easing = Motion.easeOut),
                            ) { h -> if (up) h else -h } + fadeIn(tween(Motion.pop)))
                                .togetherWith(
                                    slideOutVertically(
                                        tween(Motion.panel, easing = Motion.easeOut),
                                    ) { h -> if (up) -h else h } + fadeOut(tween(Motion.pop)),
                                )
                        }
                    },
                    label = "digit$place",
                ) { shown ->
                    Text(shown.toString(), style = style, color = color)
                }
            }
        }
    }
}
