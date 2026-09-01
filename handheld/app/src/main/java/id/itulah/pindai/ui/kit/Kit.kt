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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import id.itulah.pindai.ui.theme.*

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
