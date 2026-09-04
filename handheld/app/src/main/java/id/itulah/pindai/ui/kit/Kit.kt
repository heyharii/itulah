package id.itulah.pindai.ui.kit

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import id.itulah.pindai.ui.theme.*
import kotlin.math.roundToInt

val CardShape = RoundedCornerShape(12.dp)
val ControlShape = RoundedCornerShape(8.dp)

/** A card is a hairline ring, never a shadow. Elevation is for things that float. */
@Composable
fun PlanetCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = CardShape,
        color = Surface.card,
        border = BorderStroke(1.dp, Ink.border(.04f)),
    ) { Column(Modifier.padding(Space.lg), content = content) }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text, style = Type.caption, color = Ink.text(.60f), modifier = modifier)
}

/**
 * Press gives a small spring-scale and a 6% ink tint — the beUI "weighted spring"
 * idea kept to the one place a finger actually lands. Gloved hands on a warehouse
 * floor need the feedback; nothing else on screen moves.
 */
@Composable
private fun Modifier.pressSpring(source: MutableInteractionSource): Modifier {
    val pressed by source.collectIsPressedAsState()
    val motion = LocalMotion.current
    val scale by animateFloatAsState(
        targetValue = if (pressed && motion) 0.97f else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessMediumLow),
        label = "press",
    )
    return this.scale(scale)
}

@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    val source = remember { MutableInteractionSource() }
    Button(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().heightIn(min = 48.dp).pressSpring(source),
        enabled = enabled && !loading,
        shape = ControlShape,
        interactionSource = source,
        colors = ButtonDefaults.buttonColors(containerColor = Blue, contentColor = Color.White,
            disabledContainerColor = Ink.fill(.08f), disabledContentColor = Ink.text(.36f)),
    ) {
        if (loading) {
            CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
            Spacer(Modifier.width(Space.sm))
        }
        Text(text, style = Type.emphasis)
    }
}

@Composable
fun QuietButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val source = remember { MutableInteractionSource() }
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().heightIn(min = 48.dp).pressSpring(source),
        enabled = enabled,
        shape = ControlShape,
        interactionSource = source,
        border = BorderStroke(1.dp, Ink.border(.08f)),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = Ink.text(),
            disabledContentColor = Ink.text(.36f)),
    ) { Text(text, style = Type.emphasis) }
}

/** Status is a quiet dot and a word. Filled badges shout; data should not. */
@Composable
fun StatusDot(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
        Box(Modifier.size(8.dp).clip(RoundedCornerShape(4.dp)).background(color))
        Text(label, style = Type.caption, color = Ink.text(.74f))
    }
}

/** One key/value line. Value carries the ink; the label steps back. */
@Composable
fun KeyValue(label: String, value: String?, mono: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = Space.xs),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = Type.body, color = Ink.text(.74f))
        Text(
            value ?: "—",
            style = if (mono) Type.mono else Type.bodyNum,
            color = if (value == null) Ink.text(.36f) else Ink.text(),
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * A row that arrives rather than appears. Staggered by index so a sweep that
 * finds twenty tags reads as a sequence, not a flash — but the stagger is capped,
 * because the two-hundredth tag must not wait two seconds to be seen.
 */
@Composable
fun StaggeredRow(index: Int, content: @Composable () -> Unit) {
    val motion = LocalMotion.current
    var shown by remember { mutableStateOf(!motion) }
    LaunchedEffect(Unit) { shown = true }
    AnimatedVisibility(
        visible = shown,
        enter = fadeIn(tween(180, delayMillis = (index.coerceAtMost(8)) * 24)) +
            slideInVertically(tween(180, delayMillis = (index.coerceAtMost(8)) * 24)) { it / 3 },
    ) { content() }
}

private val FaderHeight = 56.dp
private val FaderThumb = 34.dp
private val FaderShape = RoundedCornerShape(16.dp)
private val FaderThumbShape = RoundedCornerShape(11.dp)

/**
 * A fader thick enough to move with a glove on.
 *
 * Nothing else in this app is dragged, and the one thing that is gets dragged in
 * an aisle with the other hand holding a garment. So it is a bar, not a line:
 * the whole 56 dp is the target, the thumb is a block you can see from arm's
 * length, and pressing anywhere brings the value to the finger. A 4 dp track
 * with a dot on it is a control for a mouse.
 *
 * # Two things it deliberately refuses to do
 *
 * **It does not eat the page's scroll.** This sits in a scrolling form, and a
 * bar that claims every touch that lands on it means a thumb dragged downward
 * changes the antenna instead of moving the page. `draggable` on the horizontal
 * axis hands vertical gestures back to the parent, and a tap — a press that
 * never became a drag — is what jumps the value.
 *
 * **It does not buzz.** No haptic detents, for the same reason there is no
 * beeper: a device that talks to the hand is a device somebody silences, and
 * then it cannot talk to the hand at all.
 *
 * The thumb tracks the finger exactly while it is down and springs afterwards,
 * because what settles there is the answer from whatever this fader drives, not
 * the request — and the spring is what makes a value that landed two short read
 * as an answer rather than a glitch.
 */
@Composable
fun Fader(
    value: Int,
    range: IntRange,
    onChange: (Int) -> Unit,
    onCommit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val min = range.first
    val span = (range.last - min).coerceAtLeast(1)
    val motion = LocalMotion.current
    val thumbPx = with(LocalDensity.current) { FaderThumb.toPx() }

    var widthPx by remember { mutableIntStateOf(0) }
    var dragging by remember { mutableStateOf(false) }
    var dragX by remember { mutableFloatStateOf(0f) }
    val travel = (widthPx - thumbPx).coerceAtLeast(1f)

    // The thumb's centre may sit anywhere in the bar, but the block itself has
    // width: it travels between its own edges, never past them.
    fun valueAt(x: Float): Int =
        min + (((x - thumbPx / 2f) / travel).coerceIn(0f, 1f) * span).roundToInt()

    val fraction = ((value - min).toFloat() / span).coerceIn(0f, 1f)
    val eased by animateFloatAsState(
        targetValue = fraction,
        animationSpec = spring(dampingRatio = Spring.DampingRatioNoBouncy,
            stiffness = Spring.StiffnessMediumLow),
        label = "fader",
    )
    val shown = if (dragging || !motion) fraction else eased

    Box(
        modifier
            .fillMaxWidth()
            .height(FaderHeight)
            .onSizeChanged { widthPx = it.width }
            .clip(FaderShape)
            .background(Ink.fill(.06f))
            .semantics {
                stateDescription = value.toString()
                // `steps` counts the stops BETWEEN the ends, so a 5..30 dBm
                // fader has 24 of them, not 25.
                progressBarRangeInfo = ProgressBarRangeInfo(
                    value.toFloat(), min.toFloat()..range.last.toFloat(), span - 1,
                )
            }
            .pointerInput(travel, min, span) {
                detectTapGestures { offset -> onChange(valueAt(offset.x)); onCommit() }
            }
            .draggable(
                orientation = Orientation.Horizontal,
                state = rememberDraggableState { delta ->
                    // Kept inside the bar. An accumulator free to run past the
                    // end banks every millimetre the finger keeps travelling,
                    // and then the value does not move until all of it has been
                    // dragged back — the fader appears stuck at 30 exactly when
                    // somebody is trying to leave it.
                    dragX = (dragX + delta).coerceIn(0f, widthPx.toFloat())
                    onChange(valueAt(dragX))
                },
                onDragStarted = { start ->
                    dragging = true
                    dragX = start.x
                    onChange(valueAt(start.x))
                },
                onDragStopped = { dragging = false; onCommit() },
            ),
    ) {
        // Ink, not blue. A 296x56 dp slab of #2563EB is by a wide margin the
        // loudest thing in this app, and the app has already decided against
        // it: the selected tab travels as Ink.fill(.08f), and blue appears as a
        // dot beside a word, never as a field. The level is data; data is quiet.
        //
        // The fill ends under the thumb's far edge, so at the bottom of the
        // range it is a nub rather than nothing — a bar with no fill at all
        // reads as a control that is off.
        Box(
            Modifier
                .width(with(LocalDensity.current) { (shown * travel + thumbPx).toDp() })
                .fillMaxHeight()
                .background(Ink.fill(.14f)),
        )
        Box(
            Modifier
                .offset { IntOffset((shown * travel).roundToInt(), 0) }
                .padding(vertical = 4.dp)
                .width(FaderThumb)
                .fillMaxHeight()
                .clip(FaderThumbShape)
                .background(Surface.floating)
                .border(1.dp, Ink.border(.20f), FaderThumbShape),
            contentAlignment = Alignment.Center,
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                repeat(2) {
                    Box(
                        Modifier.width(2.dp).height(16.dp)
                            .clip(RoundedCornerShape(1.dp))
                            .background(Ink.border(.20f)),
                    )
                }
            }
        }
    }
}
