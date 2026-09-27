package id.itulah.kasir.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The parts every screen here is built from, in Cloud Hub's vocabulary and
 * pos-desktop's shapes.
 *
 * Hairline rings, never shadows. White panes on the pale ground. One ink at
 * four fixed greys. Blue where something is selected, and on the one button
 * that takes the money. A handful of functions on purpose — a component
 * library larger than the app it dresses is a second thing to maintain.
 *
 * Each one names the pos-desktop class it draws, so a change to `pos.css` can
 * be followed here by name.
 */

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
 * ground. Unpadded: what is inside it is [Block]s, each drawing its own rule.
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

/** Micro-caps. `--text-eyebrow`: 12, +0.04em, uppercase. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text.uppercase(), modifier, style = Type.eyebrow)
}

/**
 * `.btn.primary` — the one blue button on the screen.
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
    height: androidx.compose.ui.unit.Dp = 56.dp,
    fontSize: androidx.compose.ui.unit.TextUnit = 15.sp,
    arrangement: Arrangement.Horizontal = Arrangement.Center,
    trailing: String? = null,
) {
    Button(
        onClick = onClick,
        modifier = modifier.heightIn(min = height),
        enabled = enabled && !busy,
        shape = RoundedCornerShape(RInner),
        colors = ButtonDefaults.buttonColors(
            containerColor = Cta,
            contentColor = OnDark,
            disabledContainerColor = Soft2,
            disabledContentColor = Mute,
        ),
        contentPadding = PaddingValues(horizontal = 16.dp),
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
            )
            if (trailing != null) {
                Text(trailing, style = Type.meta.copy(color = Color.Unspecified))
            }
        }
    }
}

/**
 * `.btn` — any second-rank action.
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
    height: androidx.compose.ui.unit.Dp = 46.dp,
) {
    Button(
        onClick = onClick,
        modifier = modifier.heightIn(min = maxOf(height, Tap)),
        enabled = enabled,
        shape = RoundedCornerShape(RInner),
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
            Text(text, style = Type.control.copy(color = Color.Unspecified, fontSize = 14.sp), textAlign = TextAlign.Center)
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
            .clip(RoundedCornerShape(RInner))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = Type.control.copy(color = tone))
    }
}

/**
 * `.util` — a key on the function board.
 *
 * Quiet on purpose: the board is muscle memory, not something to read, and a
 * dozen dark labels beside the basket would compete with it. [count] is the
 * blue corner badge pos-desktop draws on "Ditahan".
 */
@Composable
fun UtilButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    strong: Boolean = false,
    count: Int = 0,
    tone: Color = Body,
) {
    Box(modifier) {
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .clip(RoundedCornerShape(RInner))
                .background(if (!enabled) Soft2 else if (strong) Soft else Canvas)
                .border(1.dp, Hairline, RoundedCornerShape(RInner))
                .clickable(enabled = enabled, onClick = onClick)
                .padding(horizontal = 6.dp, vertical = 10.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text,
                style = Type.meta.copy(
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = if (enabled) tone else Faint,
                ),
                textAlign = TextAlign.Center,
            )
        }
        if (count > 0) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(5.dp)
                    .heightIn(min = 18.dp)
                    .widthIn(min = 18.dp)
                    .background(Accent, RoundedCornerShape(9.dp))
                    .padding(horizontal = 5.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("$count", style = Type.pill.copy(color = OnDark, fontWeight = FontWeight.SemiBold, fontSize = 10.sp))
            }
        }
    }
}

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
    height: androidx.compose.ui.unit.Dp = 54.dp,
    tone: Color = Text,
    style: androidx.compose.ui.text.TextStyle = Type.control,
) {
    Box(
        modifier
            .heightIn(min = height)
            .clip(RoundedCornerShape(RInner))
            .background(if (selected) AccentBg else Canvas)
            .border(1.dp, if (selected) Accent else Hairline2, RoundedCornerShape(RInner))
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
            .clip(RoundedCornerShape(RInner))
            .background(if (bad) BadBg else AccentBg)
            .let { if (onDismiss != null) it.clickable(onClick = onDismiss) else it }
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        val tone = if (bad) BadFg else InfoFg
        if (title != null) Text(title, style = Type.cell.copy(color = tone, fontWeight = FontWeight.SemiBold))
        Text(text, style = Type.cell.copy(color = tone, lineHeight = 20.sp))
    }
}

/**
 * `.scan-field` — where the caret lives all day.
 *
 * A wedge scanner is a keyboard that types fast and presses Enter, so this must
 * never lose focus — and the soft keyboard must not open for it, because on a
 * tablet it covers the basket.
 */
@Composable
fun ScanField(
    onScan: (String) -> Unit,
    modifier: Modifier = Modifier,
    focus: FocusRequester = remember { FocusRequester() },
    placeholder: String = "Pindai tag RFID, atau ketik nama / barcode…",
) {
    var text by remember { mutableStateOf("") }
    val keyboard = LocalSoftwareKeyboardController.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()

    fun submit() {
        val value = text
        text = ""
        if (value.isNotBlank()) onScan(value)
        // The caret goes straight back where it was. Compose drops focus on
        // the Done action, so without this the second garment of every
        // basket types into nothing — found by scanning six tags and
        // getting one.
        focus.requestFocus()
        keyboard?.hide()
    }

    Row(
        modifier
            .fillMaxWidth()
            .height(60.dp)
            .background(Canvas, RoundedCornerShape(RInner))
            .border(1.dp, if (focused) Accent else Hairline2, RoundedCornerShape(RInner))
            .padding(start = 16.dp, end = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BasicTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier.weight(1f).focusRequester(focus),
            singleLine = true,
            textStyle = Type.metric.copy(fontSize = 17.sp),
            cursorBrush = SolidColor(Accent),
            interactionSource = interaction,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submit() }),
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (text.isEmpty()) Text(placeholder, style = Type.metric.copy(fontSize = 17.sp, color = Faint))
                    inner()
                }
            },
        )
        Spacer(Modifier.width(8.dp))
        // `.scan-go`: the Enter a thumb can reach, for a name typed by hand.
        Box(
            Modifier
                .size(Tap)
                .clip(RoundedCornerShape(RInner))
                .background(Cta)
                .clickable { submit() },
            contentAlignment = Alignment.Center,
        ) {
            Text("→", style = Type.metric.copy(color = OnDark, fontWeight = FontWeight.Medium))
        }
    }
}

@Composable
fun StatusDot(color: Color, label: String, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(7.dp).background(color, CircleShape))
        Spacer(Modifier.width(7.dp))
        Text(label, style = Type.meta)
    }
}

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
fun Grand(label: String, value: String, modifier: Modifier = Modifier, size: androidx.compose.ui.unit.TextUnit = 28.sp, tone: Color = Ink) {
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
fun KeyRow(gap: androidx.compose.ui.unit.Dp = 8.dp, content: @Composable RowScope.() -> Unit) {
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
fun Thumb(sku: String, config: id.itulah.kasir.data.Config, size: androidx.compose.ui.unit.Dp) {
    val density = androidx.compose.ui.platform.LocalDensity.current
    val targetPx = with(density) { size.roundToPx() }
    var image by remember(sku) {
        mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(
            id.itulah.kasir.core.Photos.cached(sku),
        )
    }
    androidx.compose.runtime.LaunchedEffect(sku) {
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
