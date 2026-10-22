package id.itulah.kasir.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties

/**
 * The parts every screen here is built from, in Cloud Hub's vocabulary and
 * pos-desktop's shapes.
 *
 * Hairline rings, never shadows — a floating menu or a dialog is the exception,
 * and says so. White panes on the pale ground. One ink at four fixed greys.
 * Blue where something is selected, and on the one button that takes the money.
 * A handful of functions on purpose — a component library larger than the app
 * it dresses is a second thing to maintain.
 *
 * # Motion (Emil Kowalski)
 *
 * Almost none. A press is a 120 ms scale to .97; a menu fades and grows from
 * .97 in 150 ms; a dialog grows from .96 in 200 ms and leaves faster than it
 * came. A scan, a new basket line and a changing total do not move at all — a
 * till takes a hundred of them a day, and each would be one more thing for the
 * eye to follow. The system's "remove animations" setting zeroes the animator
 * duration scale, which Compose reads, so every curve here collapses to a cut
 * when it is on.
 *
 * Each one names the pos-desktop class it draws, so a change to `pos.css` can
 * be followed here by name.
 */

// ── press ───────────────────────────────────────────────────────────────

/** Press feedback: scale to .97 over 120 ms, and back. Nothing else moves. */
@Composable
fun Modifier.pressScale(source: InteractionSource, pressed: Float = 0.97f, millis: Int = 120): Modifier {
    val down by source.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (down) pressed else 1f,
        animationSpec = tween(millis, easing = EaseOutStrong),
        label = "press",
    )
    return graphicsLayer { scaleX = scale; scaleY = scale }
}

/**
 * Something to tap that is not a Material button: scales on press, washes its
 * background for 150 ms, no ripple. [wash] is `--soft-2` on a toolbar and
 * `--soft` in a menu, as the prototype's hover states are.
 */
@Composable
fun Modifier.tappable(
    onClick: () -> Unit,
    enabled: Boolean = true,
    shape: Shape = RoundedCornerShape(RControl),
    wash: Color = Soft2,
    source: MutableInteractionSource = remember { MutableInteractionSource() },
): Modifier {
    val down by source.collectIsPressedAsState()
    val washAlpha by animateFloatAsState(
        targetValue = if (down && enabled) 1f else 0f,
        animationSpec = tween(150),
        label = "wash",
    )
    return this
        .pressScale(source)
        .clip(shape)
        .background(wash.copy(alpha = washAlpha))
        .clickable(
            interactionSource = source,
            indication = null,
            enabled = enabled,
            role = Role.Button,
            onClick = onClick,
        )
}

// ── panes ───────────────────────────────────────────────────────────────

@Composable
fun Card(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .background(Canvas, RoundedCornerShape(RCard))
            .border(1.dp, Hairline, RoundedCornerShape(RCard))
            .padding(14.dp),
        content = content,
    )
}

/**
 * `.pane-left` / `.pane-right` / `.pay-side` — a white column standing on the
 * ground. Unpadded: what is inside it draws its own rules.
 */
@Composable
fun Pane(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .clip(RoundedCornerShape(RCard))
            .background(Canvas)
            .border(1.dp, Hairline, RoundedCornerShape(RCard)),
        content = content,
    )
}

/** `.block` — one section of a pane, ruled off from the one above it. */
@Composable
fun Block(
    modifier: Modifier = Modifier,
    first: Boolean = false,
    padding: PaddingValues = PaddingValues(18.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth()) {
        if (!first) Divider()
        Column(Modifier.fillMaxWidth().padding(padding), content = content)
    }
}

/** Micro-caps. `--text-eyebrow`: 15, +0.04em, uppercase. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text.uppercase(), modifier, style = Type.eyebrow)
}

// ── buttons ─────────────────────────────────────────────────────────────

/**
 * `.btn.pri` — the one blue button on the screen.
 *
 * There is exactly one per screen, always in the same place, always the thing
 * the cashier is about to do. It wears the hub's `--cta`.
 */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
    height: Dp = 56.dp,
    fontSize: TextUnit = 15.sp,
    arrangement: Arrangement.Horizontal = Arrangement.Center,
    trailing: String? = null,
) {
    val source = remember { MutableInteractionSource() }
    Button(
        onClick = onClick,
        modifier = modifier.pressScale(source).heightIn(min = height),
        enabled = enabled && !busy,
        shape = RoundedCornerShape(RControl),
        colors = ButtonDefaults.buttonColors(
            containerColor = Cta,
            contentColor = OnDark,
            disabledContainerColor = Soft2,
            disabledContentColor = Mute,
        ),
        contentPadding = PaddingValues(horizontal = 18.dp),
        interactionSource = source,
    ) {
        Row(
            if (arrangement == Arrangement.Center) Modifier else Modifier.fillMaxWidth(),
            horizontalArrangement = arrangement,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (busy) {
                CircularProgressIndicator(Modifier.size(18.dp), color = Mute, strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
            }
            Text(
                text,
                style = Type.metric.copy(color = Color.Unspecified, fontSize = fontSize, fontWeight = FontWeight.Medium),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (trailing != null) {
                Text(trailing, style = Type.meta.copy(color = Color.Unspecified))
            }
        }
    }
}

/**
 * `.btn` — a second-rank action, on the pages that have not been flipped yet
 * (shift, return, setup). The counter and the payment dialog do not use it:
 * there a real action is the solid blue button and everything else is a
 * toolbar item, an icon, or a menu row.
 *
 * [selected] paints it blue, which is the only thing the accent means here.
 */
@Composable
fun GhostButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    hint: String? = null,
    tone: Color = Ink,
    selected: Boolean = false,
    height: Dp = 46.dp,
) {
    Button(
        onClick = onClick,
        modifier = modifier.heightIn(min = maxOf(height, Tap)),
        enabled = enabled,
        shape = RoundedCornerShape(RControl),
        colors = ButtonDefaults.buttonColors(
            containerColor = if (selected) AccentBg else Canvas,
            contentColor = if (selected) Accent else tone,
            disabledContainerColor = Soft2,
            disabledContentColor = Faint,
        ),
        border = BorderStroke(1.dp, if (selected) Accent else Hairline2),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(text, style = Type.control.copy(color = Color.Unspecified), textAlign = TextAlign.Center)
            if (hint != null) Text(hint, style = Type.pill.copy(color = Mute))
        }
    }
}

/** `.btn.ghost` — no ring, for an action that sits inside a header. */
@Composable
fun QuietButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, tone: Color = Body) {
    Box(
        modifier
            .heightIn(min = Tap)
            .tappable(onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = Type.control.copy(color = tone))
    }
}

/** `.ib` — an icon on its own, forty-four to touch and twenty to see. */
@Composable
fun IconTap(
    glyph: ImageVector,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tone: Color = LineIco,
    size: Dp = Tap,
    iconSize: Dp = 20.dp,
    enabled: Boolean = true,
) {
    Box(
        modifier
            .size(size)
            .alpha(if (enabled) 1f else 0.4f)
            .tappable(onClick, enabled, RoundedCornerShape(RField)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(glyph, description, Modifier.size(iconSize), tint = tone)
    }
}

/** `.badge` on a toolbar item — the count, in the one solid blue. */
@Composable
fun CountBadge(count: Int, modifier: Modifier = Modifier) {
    Box(
        modifier
            .heightIn(min = 22.dp)
            .widthIn(min = 22.dp)
            .background(Accent, RoundedCornerShape(11.dp))
            .padding(horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "$count",
            style = Type.pill.copy(color = OnDark, fontWeight = FontWeight.SemiBold, lineHeight = 18.sp),
        )
    }
}

/**
 * `.tb` — one item of the header toolbar: an icon, its label, and where it is
 * a menu a caret. With [showLabel] false it folds to the icon alone (the label
 * stays as its description).
 */
@Composable
fun ToolButton(
    label: String,
    glyph: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    showLabel: Boolean = true,
    caret: Boolean = false,
    active: Boolean = false,
    count: Int = 0,
    tone: Color = Text,
    iconTone: Color = LineIco,
) {
    Row(
        modifier
            .height(Tap)
            .alpha(if (enabled) 1f else 0.4f)
            .tappable(onClick, enabled)
            .background(if (active) Soft2 else Color.Transparent)
            .padding(horizontal = if (showLabel) 12.dp else 10.dp)
            .semantics { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(glyph, null, Modifier.size(19.dp), tint = iconTone)
        if (showLabel) {
            Text(label, style = Type.control.copy(color = tone), maxLines = 1)
        }
        if (count > 0) CountBadge(count)
        if (caret) Icon(Glyph.Down, null, Modifier.size(16.dp).offset(x = (-2).dp), tint = iconTone)
    }
}

/** "Dian Pratama" is DP; one word gives its first two letters. */
fun initialsOf(name: String): String {
    val parts = name.trim().split(Regex("[\\s._-]+")).filter { it.isNotEmpty() }
    return when {
        parts.size >= 2 -> "${parts[0].first()}${parts[1].first()}"
        parts.size == 1 -> parts[0].take(2)
        else -> "?"
    }.uppercase()
}

/** `.av` — initials on `--soft-2`. */
@Composable
fun Avatar(name: String, modifier: Modifier = Modifier, size: Dp = 32.dp) {
    Box(
        modifier.size(size).background(Soft2, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initialsOf(name),
            style = Type.control.copy(color = Body, fontWeight = FontWeight.SemiBold, lineHeight = 18.sp),
            maxLines = 1,
        )
    }
}

/**
 * `.brand svg` — the Central mark: a black tile, a white "c" and the one blue
 * dot. Drawn on the prototype's 32-unit grid so it is the same mark at any size.
 */
@Composable
fun BrandMark(modifier: Modifier = Modifier, size: Dp = 30.dp) {
    Canvas(modifier.size(size)) {
        val u = this.size.minDimension / 32f
        drawRoundRect(
            Color(0xFF111214),
            size = Size(32f * u, 32f * u),
            cornerRadius = CornerRadius(7.5f * u),
        )
        drawRoundRect(
            Color.White.copy(alpha = 0.10f),
            topLeft = Offset(0.5f * u, 0.5f * u),
            size = Size(31f * u, 31f * u),
            cornerRadius = CornerRadius(7f * u),
            style = Stroke(width = 1f * u),
        )
        // The "c": a circle of 6.5 centred at (13.42, 16), open to the right
        // between ±42.6°, which is the prototype's arc between (18.2, 11.6)
        // and (18.2, 20.4).
        val r = 6.5f * u
        drawArc(
            Color.White,
            startAngle = 42.6f,
            sweepAngle = 274.8f,
            useCenter = false,
            topLeft = Offset(13.42f * u - r, 16f * u - r),
            size = Size(2 * r, 2 * r),
            style = Stroke(width = 3.6f * u, cap = StrokeCap.Round),
        )
        drawCircle(Accent, radius = 2.2f * u, center = Offset(23.4f * u, 16f * u))
    }
}

// ── menus ───────────────────────────────────────────────────────────────

/**
 * `.pop` — a menu hung under the button that opened it.
 *
 * Place it inside the same `Box` as its button, so it hangs from that button's
 * edge: [anchorHeight] is how far down the button reaches. It fades and grows
 * from .97 in 150 ms, out of the corner it hangs from, and leaves at once —
 * choosing a row is the end of the conversation, not something to watch.
 * Tapping outside, or Back, dismisses it.
 */
@Composable
fun Popover(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    alignEnd: Boolean = false,
    anchorHeight: Dp = Tap,
    content: @Composable ColumnScope.() -> Unit,
) {
    val gap = with(LocalDensity.current) { (anchorHeight + 6.dp).roundToPx() }
    Popup(
        alignment = if (alignEnd) Alignment.TopEnd else Alignment.TopStart,
        offset = IntOffset(0, gap),
        onDismissRequest = onDismiss,
        properties = PopupProperties(focusable = true),
    ) {
        val enter = remember { Animatable(0f) }
        LaunchedEffect(Unit) { enter.animateTo(1f, tween(150, easing = EaseOutStrong)) }
        val shape = RoundedCornerShape(RCard)
        Column(
            modifier
                .graphicsLayer {
                    alpha = enter.value
                    scaleX = 0.97f + 0.03f * enter.value
                    scaleY = scaleX
                    transformOrigin = TransformOrigin(if (alignEnd) 1f else 0f, 0f)
                }
                .background(Canvas, shape)
                // No shadow here, so the ring is one step darker than a card's
                // to hold the menu apart from the white under it.
                .border(1.dp, Hairline2, shape)
                .padding(6.dp),
            content = content,
        )
    }
}

/** `.pop button` — one row of a menu. */
@Composable
fun MenuItem(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    glyph: ImageVector? = null,
    enabled: Boolean = true,
    trailing: String? = null,
    tone: Color = Ink,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = Tap)
            .alpha(if (enabled) 1f else 0.4f)
            .tappable(onClick, enabled, wash = Soft)
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (glyph != null) Icon(glyph, null, Modifier.size(20.dp), tint = if (tone == Ink) LineIco else tone)
        Text(
            label,
            style = Type.metric.copy(color = tone),
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (trailing != null) Text(trailing, style = Type.meta.copy(color = Mute), maxLines = 1)
    }
}

/** `.pop .sep` */
@Composable
fun MenuSeparator() {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 6.dp)
            .height(1.dp)
            .background(Hairline),
    )
}

// ── choices, badges, notices ────────────────────────────────────────────

/**
 * `.method` / `.presets button` — one of a few mutually exclusive choices,
 * laid out as tiles. Selected is blue; nothing else is.
 */
@Composable
fun ChoiceTile(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    height: Dp = 54.dp,
    tone: Color = Text,
    style: androidx.compose.ui.text.TextStyle = Type.control,
) {
    Box(
        modifier
            .heightIn(min = height)
            .clip(RoundedCornerShape(RControl))
            .background(if (selected) AccentBg else Canvas)
            .border(1.dp, if (selected) Accent else Hairline2, RoundedCornerShape(RControl))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = style.copy(color = if (selected) Accent else tone), textAlign = TextAlign.Center)
    }
}

enum class Tone { PLAIN, OK, WARN, BAD }

/** `.badge` — a fact about the thing beside it, with a dot unless plain. */
@Composable
fun Badge(text: String, tone: Tone = Tone.PLAIN, modifier: Modifier = Modifier) {
    val (bg, fg) = when (tone) {
        Tone.PLAIN -> Soft2 to Body
        Tone.OK -> OkBg to OkFg
        Tone.WARN -> WarnBg to WarnFg
        Tone.BAD -> BadBg to BadFg
    }
    Row(
        modifier
            .background(bg, RoundedCornerShape(5.dp))
            .padding(horizontal = 8.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (tone != Tone.PLAIN) {
            Box(Modifier.size(5.dp).background(fg, CircleShape))
            Spacer(Modifier.width(6.dp))
        }
        Text(text, style = Type.pill.copy(color = fg))
    }
}

/**
 * `.notice` — something the till wants said, in the column where the eye
 * already is. Tapping it dismisses it.
 */
@Composable
fun Notice(text: String, bad: Boolean = false, onDismiss: (() -> Unit)? = null, title: String? = null) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(RField))
            .background(if (bad) BadBg else AccentBg)
            .let { if (onDismiss != null) it.clickable(onClick = onDismiss) else it }
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        val tone = if (bad) BadFg else InfoFg
        if (title != null) Text(title, style = Type.cell.copy(color = tone, fontWeight = FontWeight.SemiBold))
        Text(text, style = Type.cell.copy(color = tone, lineHeight = 20.sp))
    }
}

// ── the scan field ──────────────────────────────────────────────────────

/**
 * `.scan` — where the caret lives all day.
 *
 * A wedge scanner is a keyboard that types fast and presses Enter, so this must
 * never lose focus — and the soft keyboard must not open for it, because on a
 * tablet it covers the basket. The keyboard is one icon inside the field: for a
 * name typed by hand, the IME's own Done submits it.
 *
 * [trailing] is whatever the screen wants to say at the right of the field —
 * the counter puts the reader's state there. [enabled] false (a dialog is open
 * over the counter) takes the caret away, so a scan cannot land in a basket
 * that is being paid for.
 */
@Composable
fun ScanField(
    onScan: (String) -> Unit,
    modifier: Modifier = Modifier,
    focus: FocusRequester = remember { FocusRequester() },
    placeholder: String = "Scan a tag or search items",
    enabled: Boolean = true,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    var text by remember { mutableStateOf("") }
    val keyboard = LocalSoftwareKeyboardController.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(RCard)

    fun submit() {
        val value = text
        text = ""
        if (value.isNotBlank()) onScan(value)
        // The caret goes straight back where it was. Compose drops focus on
        // the Done action, so without this the second garment of every
        // basket types into nothing — found by scanning six tags and
        // getting one.
        runCatching { focus.requestFocus() }
        keyboard?.hide()
    }

    Row(
        modifier
            .fillMaxWidth()
            .height(56.dp)
            .drawBehind {
                if (focused) {
                    val ring = 4.dp.toPx()
                    drawRoundRect(
                        FocusRing,
                        topLeft = Offset(-ring, -ring),
                        size = Size(size.width + 2 * ring, size.height + 2 * ring),
                        cornerRadius = CornerRadius(RCard.toPx() + ring),
                    )
                }
            }
            .background(Canvas, shape)
            .border(1.dp, if (focused) Focus else Hairline2, shape)
            .padding(start = 16.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Glyph.Scan, null, Modifier.size(20.dp), tint = LineIco)
        Spacer(Modifier.width(10.dp))
        BasicTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier.weight(1f).focusRequester(focus),
            enabled = enabled,
            singleLine = true,
            textStyle = Type.metric.copy(fontSize = 16.sp),
            cursorBrush = SolidColor(Accent),
            interactionSource = interaction,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submit() }),
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (text.isEmpty()) Text(placeholder, style = Type.metric.copy(fontSize = 16.sp, color = Mute), maxLines = 1)
                    inner()
                }
            },
        )
        trailing?.invoke(this)
        IconTap(
            Glyph.Keyboard,
            "Show keyboard",
            onClick = {
                // The soft keyboard is off by default and summoned here.
                // A till is driven by a sled or a wedge, both of which type
                // without an IME — and an IME that opens on its own covers
                // the basket, which was the first thing found on real
                // hardware. It is still one tap away for a name search.
                runCatching { focus.requestFocus() }
                keyboard?.show()
            },
            enabled = enabled,
        )
    }
}

// ── small parts ─────────────────────────────────────────────────────────

/** `.total-line` — a label and a figure, the figure in tabular digits. */
@Composable
fun KeyValue(label: String, value: String, strong: Boolean = false, tone: Color? = null) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = if (strong) Type.metric else Type.meta)
        Text(
            value,
            style = if (strong) Type.kpi.copy(color = tone ?: Ink)
            else Type.cell.copy(color = tone ?: Text),
        )
    }
}

/** `.grand` — TOTAL, and the figure read back across the counter. */
@Composable
fun Grand(label: String, value: String, modifier: Modifier = Modifier, size: TextUnit = 28.sp, tone: Color = Ink) {
    Row(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(label, style = Type.cell.copy(color = Body, fontWeight = FontWeight.SemiBold))
        Text(value, style = Type.money.copy(fontSize = size, color = tone))
    }
}

@Composable
fun Divider(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(Hairline))
}

/** A row of equal keys, the unit every grid on this till is built from. */
@Composable
fun KeyRow(gap: Dp = 8.dp, content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(gap), content = content)
}

/**
 * A garment's photograph, at thumbnail size.
 *
 * Loaded off the main thread and never awaited: the basket, the total and the
 * button that takes the money all work before any picture arrives, and a shop
 * whose uplink is slow must not have a slow till. A SKU with no photograph —
 * ordinary, most ranges are only partly shot — draws the soft placeholder and
 * is never asked about again.
 */
@Composable
fun Thumb(sku: String, config: id.itulah.kasir.data.Config, size: Dp) {
    val density = LocalDensity.current
    val targetPx = with(density) { size.roundToPx() }
    var image by remember(sku) {
        mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(
            id.itulah.kasir.core.Photos.cached(sku),
        )
    }
    LaunchedEffect(sku) {
        if (image == null) {
            image = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                id.itulah.kasir.core.Photos.load(config, sku, targetPx)
            }
        }
    }
    Box(
        Modifier
            .size(size)
            .background(Soft2, RoundedCornerShape(RInner))
            .border(1.dp, Hairline, RoundedCornerShape(RInner)),
        contentAlignment = Alignment.Center,
    ) {
        val bitmap = image
        if (bitmap != null) {
            androidx.compose.foundation.Image(
                bitmap = bitmap,
                contentDescription = null,
                modifier = Modifier.size(size).clip(RoundedCornerShape(RInner)),
                contentScale = androidx.compose.ui.layout.ContentScale.Crop,
            )
        }
    }
}
