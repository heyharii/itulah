package id.itulah.kasir.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The parts every screen here is built from, in Cloud Hub's vocabulary.
 *
 * Hairline rings, never shadows. White cards on the soft ground. One ink at
 * four fixed greys. Indigo only where something is selected. A handful of
 * functions on purpose — a component library larger than the app it dresses is
 * a second thing to maintain.
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

/** Micro-caps. `--text-eyebrow`: 11, +0.04em, uppercase. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text.uppercase(), modifier, style = Type.eyebrow)
}

/**
 * The one dark button on the screen.
 *
 * There is exactly one per screen, always in the same place, always the thing
 * the cashier is about to do. Dark rather than indigo: indigo means *selected*
 * in this system, and a permanently-indigo button would say the till has one
 * thing permanently chosen.
 */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
) {
    Button(
        onClick = onClick,
        modifier = modifier.heightIn(min = 56.dp),
        enabled = enabled && !busy,
        shape = RoundedCornerShape(RInner),
        colors = ButtonDefaults.buttonColors(
            containerColor = Dark,
            contentColor = OnDark,
            disabledContainerColor = Soft2,
            disabledContentColor = Mute,
        ),
    ) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(18.dp), color = OnDark, strokeWidth = 2.dp)
            Spacer(Modifier.width(10.dp))
        }
        Text(text, style = Type.metric.copy(color = Color.Unspecified, fontWeight = FontWeight.Medium))
    }
}

/**
 * A key on the function board, or any second-rank action.
 *
 * [selected] paints it indigo, which is the only thing indigo means here.
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
) {
    Button(
        onClick = onClick,
        modifier = modifier.heightIn(min = Tap + 16.dp),
        enabled = enabled,
        shape = RoundedCornerShape(RInner),
        colors = ButtonDefaults.buttonColors(
            containerColor = if (selected) AccentBg else Canvas,
            contentColor = if (selected) Accent else tone,
            disabledContainerColor = Canvas,
            disabledContentColor = Faint,
        ),
        border = BorderStroke(1.dp, if (selected) Accent.copy(alpha = 0.35f) else Hairline),
        contentPadding = PaddingValues(8.dp),
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(text, style = Type.nav.copy(color = Color.Unspecified, fontWeight = FontWeight.Medium))
            if (hint != null) Text(hint, style = Type.pill.copy(color = Mute))
        }
    }
}

/**
 * Where the caret lives all day.
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
    placeholder: String = "Pindai tag, atau ketik nama",
) {
    var text by remember { mutableStateOf("") }
    val keyboard = LocalSoftwareKeyboardController.current

    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        modifier = modifier.fillMaxWidth().focusRequester(focus),
        placeholder = { Text(placeholder, style = Type.prose.copy(color = Mute)) },
        singleLine = true,
        textStyle = Type.metric.copy(fontFamily = Mono, fontSize = 18.sp),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = {
            val value = text
            text = ""
            if (value.isNotBlank()) onScan(value)
            // The caret goes straight back where it was. Compose drops focus on
            // the Done action, so without this the second garment of every
            // basket types into nothing — found by scanning six tags and
            // getting one.
            focus.requestFocus()
            keyboard?.hide()
        }),
        shape = RoundedCornerShape(RInner),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Accent,
            unfocusedBorderColor = Hairline2,
            focusedContainerColor = Canvas,
            unfocusedContainerColor = Canvas,
            cursorColor = Accent,
        ),
    )
}

@Composable
fun StatusDot(color: Color, label: String, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(7.dp).background(color, CircleShape))
        Spacer(Modifier.width(7.dp))
        Text(label, style = Type.meta)
    }
}

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

@Composable
fun Divider(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(Hairline))
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
