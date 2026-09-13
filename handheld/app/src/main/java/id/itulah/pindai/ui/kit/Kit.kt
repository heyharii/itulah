package id.itulah.pindai.ui.kit

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import id.itulah.pindai.ui.theme.*
import kotlin.math.roundToInt

/**
 * The composites this language builds out of its tokens: card, pill, button,
 * field, floating bar. Drawn from `prototypes/hub-prototype.html` and from
 * `frontend-floor`'s kit, which is the same drawing sized for a hand.
 */

val CardShape = RoundedCornerShape(Radius.card)
val ControlShape = RoundedCornerShape(Radius.inner)
val SheetShape = RoundedCornerShape(Radius.sheet)

/**
 * White card, one hairline, 12 dp corners, whisper shadow.
 *
 * Cards are lifted by their BORDER, not by shadow — the shadow exists to stop
 * the white-on-white edge disappearing, not to float anything. On a white page
 * the hairline is the card; drop it and there is nothing there.
 *
 * `onPress` makes the whole card the target, and the feedback is the press wash
 * this system specifies: a soft grey fill and a scale of 0.99 over 120 ms.
 * Deliberately quieter than the spring this kit used to have — a card that
 * flinches is a card that looks broken on the tenth press of a shift.
 */
@Composable
fun HubCard(
    modifier: Modifier = Modifier,
    onPress: (() -> Unit)? = null,
    padding: PaddingValues = PaddingValues(Space.lg),
    content: @Composable ColumnScope.() -> Unit,
) {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val fill by animateColorAsState(
        targetValue = if (pressed && onPress != null) Surface.soft2 else Surface.canvas,
        animationSpec = tween(Motion.press, easing = Motion.easeOut),
        label = "press-wash",
    )
    Column(
        modifier
            .fillMaxWidth()
            .pressScale(source)
            .shadow(1.dp, CardShape, ambientColor = Surface.shadow, spotColor = Surface.shadow)
            .background(fill, CardShape)
            .border(1.dp, Surface.hairline, CardShape)
            // Material's ripple is not this system's press feedback; the wash
            // above is, so the indication is switched off rather than restyled.
            .then(
                if (onPress == null) Modifier
                else Modifier.clickable(
                    interactionSource = source, indication = null, onClick = onPress,
                ),
            )
            .padding(padding),
        content = content,
    )
}

/** The press scale. 0.99, and only while a finger is actually down. */
@Composable
private fun Modifier.pressScale(source: MutableInteractionSource): Modifier {
    val pressed by source.collectIsPressedAsState()
    val motion = LocalMotion.current
    val scale by animateFloatAsState(
        targetValue = if (pressed && motion) 0.99f else 1f,
        animationSpec = tween(Motion.press, easing = Motion.easeOut),
        label = "press-scale",
    )
    return this.scale(scale)
}

/**
 * The group label above a run of cards. Whitespace separates and one hairline
 * divides; nothing gets a box around it just for being a group.
 */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text, style = Type.section, color = Ink.mute, modifier = modifier)
}

/**
 * The status pill — one grammar for every state in the app.
 *
 * OUTLINED, not filled. What reads is the coloured TEXT; the hairline only holds
 * it, which is why the border is 30% of the label's own colour and not 100%: a
 * border as strong as its label turns the tag into a BOX, and a box is a
 * container, while a label is a fact about what it sits beside.
 *
 * `ACCENT` means selected — the joined session, the chosen count. `INFO` means
 * in motion. They never swap.
 */
enum class Tone(val fg: Color, val dot: Color) {
    OK(OkFg, Ok),
    WARN(WarnFg, Warn),
    BAD(BadFg, Bad),
    INFO(InfoFg, Info),
    ACCENT(Accent, Accent),
    NEUTRAL(Ink.body, Ink.mute),
}

@Composable
fun Pill(tone: Tone, label: String, modifier: Modifier = Modifier, withDot: Boolean = true) {
    Row(
        modifier
            .height(25.dp)
            .background(Surface.canvas, ControlShape)
            .border(
                1.dp,
                if (tone == Tone.NEUTRAL) Surface.hairline2 else tone.fg.copy(alpha = .30f),
                ControlShape,
            )
            .padding(horizontal = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (withDot) Box(Modifier.size(5.dp).background(tone.dot, CircleShape))
        Text(label, style = Type.pill, color = tone.fg)
    }
}

/**
 * The one filled call to action, and there is at most one per screen.
 *
 * `big` is the action a screen exists for — pull the trigger, finish the sweep —
 * at 56 dp, hit without being looked at. Everything else clears the 44 dp touch
 * floor; there is deliberately no small size, because a small size would get
 * used for looking tidier in a card.
 *
 * Disabled is drawn GREY rather than dimmed. Fading the old black CTA worked by
 * accident — black at 45% is grey — but fading this blue gives a pale lavender
 * bar that reads perfectly well as a light blue button, and the button it
 * happens to is the 56 dp one at the foot of a sweep.
 */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    big: Boolean = false,
) {
    val source = remember { MutableInteractionSource() }
    Button(
        onClick = onClick,
        modifier = modifier
            .heightIn(min = if (big) Tap.action else Tap.floor)
            .pressScale(source),
        enabled = enabled && !loading,
        shape = ControlShape,
        interactionSource = source,
        contentPadding = PaddingValues(horizontal = if (big) Space.xxl else Space.lg),
        elevation = null,
        colors = ButtonDefaults.buttonColors(
            containerColor = Cta, contentColor = CtaFg,
            disabledContainerColor = Surface.soft2, disabledContentColor = Ink.mute,
        ),
    ) {
        if (loading) {
            CircularProgressIndicator(Modifier.size(18.dp), color = CtaFg, strokeWidth = 2.dp)
            Spacer(Modifier.width(Space.sm))
        }
        Text(text, style = if (big) Type.action else Type.control)
    }
}

/** The quiet one: a hairline, a white ground, and the whisper shadow. */
@Composable
fun QuietButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    big: Boolean = false,
) {
    val source = remember { MutableInteractionSource() }
    OutlinedButton(
        onClick = onClick,
        modifier = modifier
            .heightIn(min = if (big) Tap.action else Tap.floor)
            .pressScale(source),
        enabled = enabled,
        shape = ControlShape,
        interactionSource = source,
        contentPadding = PaddingValues(horizontal = if (big) Space.xxl else Space.lg),
        border = BorderStroke(
            1.dp, if (enabled) Surface.hairline2 else Color.Transparent,
        ),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = Surface.canvas, contentColor = Ink.text,
            disabledContainerColor = Surface.soft2, disabledContentColor = Ink.mute,
        ),
    ) { Text(text, style = if (big) Type.action else Type.control) }
}

/**
 * The frosted icon chip: a 44 dp white square with a hairline and a soft shadow,
 * carrying one pale line icon. The app bar's left and right zones are made of
 * it, and its target is set by the bar's height rather than by what is in it.
 */
@Composable
fun Chip(onClick: () -> Unit, modifier: Modifier = Modifier, glyph: @Composable () -> Unit) {
    val source = remember { MutableInteractionSource() }
    Box(
        modifier
            .size(Tap.floor)
            .pressScale(source)
            .shadow(1.dp, ControlShape, ambientColor = Surface.shadow, spotColor = Surface.shadow)
            .background(Surface.canvas, ControlShape)
            .border(1.dp, Surface.hairline2, ControlShape)
            .clickable(interactionSource = source, indication = null, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { glyph() }
}

/**
 * A labelled input, and the one place a field's chrome is described.
 *
 * Not a Material text field. Material draws a floating label, its own outline
 * and its own focus behaviour, and the three together are the most recognisable
 * way a screen stops being Cloud Hub — so the field is drawn here: a `soft-2`
 * fill, no border until it is focused, and the accent for the focus itself.
 * 48 dp, because a field on this surface is aimed at with a gloved thumb.
 */
@Composable
fun HubField(
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    secret: Boolean = false,
    hint: String? = null,
) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        label?.let { Text(it, style = Type.meta.copy(fontWeight = FontWeight.Medium),
            color = Ink.text) }
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            interactionSource = source,
            textStyle = Type.action.copy(color = Ink.ink),
            cursorBrush = SolidColor(Accent),
            visualTransformation =
                if (secret) PasswordVisualTransformation() else VisualTransformation.None,
            modifier = Modifier
                .fillMaxWidth()
                .height(Tap.field)
                .background(Surface.soft2, ControlShape)
                .border(1.dp, if (focused) Accent else Color.Transparent, ControlShape),
        ) { field ->
            Box(
                Modifier.fillMaxSize().padding(horizontal = Space.lg),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (value.isEmpty() && placeholder != null) {
                    Text(placeholder, style = Type.action, color = Ink.mute)
                }
                field()
            }
        }
        hint?.let { Text(it, style = Type.meta, color = Ink.mute) }
    }
}

/**
 * The bar that floats above the tab squircles, carrying what a screen is about
 * and the one thing to do about it.
 *
 * A sheet-radius white card with a hairline and the float shadow — not a docked
 * bar with a rule above it. Nothing in this system is separated by a line where
 * whitespace and a shadow will do.
 */
@Composable
fun FloatingBar(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier
            .fillMaxWidth()
            .shadow(12.dp, SheetShape, ambientColor = Surface.shadow, spotColor = Surface.shadow)
            .background(Surface.canvas, SheetShape)
            .border(1.dp, Surface.hairline, SheetShape)
            .padding(horizontal = 14.dp, vertical = Space.md),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.md),
        content = content,
    )
}

/**
 * One key → value line: the reading unit of a summary. Nothing renders it yet —
 * it is here because a summary drawn without it invents its own grammar.
 */
@Composable
fun KeyValue(label: String, value: String?, mono: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = Space.sm),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = Type.cell, color = Ink.mute)
        Text(
            value ?: "—",
            style = if (mono) Type.id else Type.cell.copy(fontWeight = FontWeight.Medium),
            color = if (value == null) Ink.faint else Ink.ink,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * A row that arrives rather than appears, staggered by index and capped so the
 * two-hundredth tag does not wait. Nothing renders it yet: the tag list stopped
 * using it because a recycled row replays the entrance on every scroll.
 */
@Composable
fun StaggeredRow(index: Int, content: @Composable () -> Unit) {
    val motion = LocalMotion.current
    var shown by remember { mutableStateOf(!motion) }
    LaunchedEffect(Unit) { shown = true }
    val delay = index.coerceAtMost(8) * 24
    AnimatedVisibility(
        visible = shown,
        enter = fadeIn(tween(Motion.page, delayMillis = delay, easing = Motion.easeOut)) +
            slideInVertically(
                tween(Motion.page, delayMillis = delay, easing = Motion.easeOut),
            ) { it / 3 },
    ) { content() }
}

private val FaderHeight = 56.dp
private val FaderThumb = 34.dp

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
            .clip(CardShape)
            .background(Surface.soft2)
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
        // A hairline grey, not the accent. A 296x56 dp slab of #2563EB is by a
        // wide margin the loudest thing in this app, and blue here means
        // SELECTED — the joined session, the live tab. The level is data, and
        // data in this system is quiet.
        //
        // The fill ends under the thumb's far edge, so at the bottom of the
        // range it is a nub rather than nothing — a bar with no fill at all
        // reads as a control that is off.
        Box(
            Modifier
                .width(with(LocalDensity.current) { (shown * travel + thumbPx).toDp() })
                .fillMaxHeight()
                .background(Surface.hairline2),
        )
        Box(
            Modifier
                .offset { IntOffset((shown * travel).roundToInt(), 0) }
                .padding(vertical = 4.dp)
                .width(FaderThumb)
                .fillMaxHeight()
                .shadow(1.dp, ControlShape, ambientColor = Surface.shadow,
                    spotColor = Surface.shadow)
                .background(Surface.canvas, ControlShape)
                .border(1.dp, Surface.hairlineStrong, ControlShape),
            contentAlignment = Alignment.Center,
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                repeat(2) {
                    Box(
                        Modifier.width(2.dp).height(16.dp)
                            .background(Surface.hairlineStrong, RoundedCornerShape(1.dp)),
                    )
                }
            }
        }
    }
}
