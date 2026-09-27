package id.itulah.pindai.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import id.itulah.pindai.R
import id.itulah.pindai.ui.theme.Surface
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

/**
 * White glass and the Central mark, breathing, while the radio opens.
 *
 * On Android 12+ the system splash (`values-v31/themes.xml`) shows the same
 * breathing mark from the first touch; this carries it on once Compose draws.
 *
 * It waits for [ready] — the reader's `init()`, the one second in which a pull
 * of the trigger would reach nothing — but never less than [MIN_MS], so a warm
 * start does not flash it, and never more than [MAX_MS], so a module that hangs
 * in the vendor call does not lock the operator out of Settings.
 *
 * It eats taps while it is up: the shell underneath is live, and a tab changed
 * through a splash is a tab changed by accident.
 */
@Composable
fun Splash(ready: Boolean) {
    var minElapsed by remember { mutableStateOf(false) }
    var timedOut by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { delay(MIN_MS); minElapsed = true }
    LaunchedEffect(Unit) { delay(MAX_MS); timedOut = true }
    val visible = !(minElapsed && ready) && !timedOut

    AnimatedVisibility(visible = visible, exit = fadeOut(tween(260))) {
        val pulse = rememberInfiniteTransition(label = "splash")
        val alpha by pulse.animateFloat(
            initialValue = 1f,
            targetValue = .35f,
            animationSpec = infiniteRepeatable(
                tween(700, easing = LinearOutSlowInEasing),
                RepeatMode.Reverse,
            ),
            label = "blink",
        )
        // The system splash centres the mark on the whole display; this box
        // starts under the status bar and stops above the navigation bar. The
        // shift puts the mark back on the display's centre so the hand-over
        // does not nudge it.
        val root = LocalView.current.rootView
        var shift by remember { mutableIntStateOf(0) }
        Box(
            Modifier.fillMaxSize().background(Surface.canvas)
                .onGloballyPositioned { box ->
                    val mid = box.positionInWindow().y + box.size.height / 2f
                    shift = (root.height / 2f - mid).roundToInt()
                }
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) {},
            contentAlignment = Alignment.Center,
        ) {
            // The very drawable the system splash shows, at the size it shows
            // it (288 dp canvas, 120 dp tile), so the two are one picture.
            Image(
                painterResource(R.drawable.splash_mark),
                contentDescription = "Central",
                modifier = Modifier.size(288.dp)
                    .offset { IntOffset(0, shift) }
                    .graphicsLayer { this.alpha = alpha },
            )
        }
    }
}

private const val MIN_MS = 900L
private const val MAX_MS = 4000L
