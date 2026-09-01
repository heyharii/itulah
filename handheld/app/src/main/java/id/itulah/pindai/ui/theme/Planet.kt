package id.itulah.pindai.ui.theme

import android.provider.Settings
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Planet DS v5 — the ink-alpha system the rest of the retail suite already speaks.
 *
 * ONE ink per mode, and every grey is that ink at a fixed alpha. There is no
 * second grey to drift: a screen that needs "a slightly lighter line" reaches
 * for a documented alpha, not for a new hex. That is the whole discipline.
 */
object Ink {
    val base = Color(0xFF141414)
    fun text(a: Float = 1f) = base.copy(alpha = a)   // 1f / .74f / .60f / .36f
    fun border(a: Float) = base.copy(alpha = a)      // .20f / .12f / .08f / .04f
    fun fill(a: Float) = base.copy(alpha = a)        // .14f / .08f / .06f / .04f
}

object Surface {
    val chrome = Color(0xFFF3F3F3)   // bottom nav / rail
    val canvas = Color(0xFFF7F7F7)   // page
    val card = Color(0xFFFCFCFC)     // cards
    val floating = Color(0xFFFFFFFF) // sheets, dialogs
}

/** Brand, interaction and selection are one blue. Nothing else may be blue. */
val Blue = Color(0xFF2563EB)
val Success = Color(0xFF16A34A)
val Warning = Color(0xFFD97706)
val Destructive = Color(0xFFDC2626)

/** The 1–24 dp scale. */
object Space {
    val xs = 4.dp; val sm = 8.dp; val md = 12.dp
    val lg = 16.dp; val xl = 20.dp; val xxl = 24.dp
}

/** Numbers that must line up in a column never use proportional figures. */
private const val Tnum = "tnum"

object Type {
    val hero = TextStyle(fontSize = 30.sp, lineHeight = 34.sp, fontWeight = FontWeight.SemiBold,
        fontFeatureSettings = Tnum)
    val anchor = TextStyle(fontSize = 22.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold)
    val emphasis = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium)
    val body = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal)
    val bodyNum = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal,
        fontFeatureSettings = Tnum)
    val caption = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Normal)
    val micro = TextStyle(fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.Normal,
        fontFeatureSettings = Tnum)
    val mono = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontFamily = FontFamily.Monospace)
}

/**
 * Whether this device wants motion at all.
 *
 * Read once from the system animator scale rather than guessed. Someone who has
 * turned animation off on a warehouse handheld has usually done it because the
 * device is slow or because motion makes them ill; either way the answer is not
 * ours to override.
 */
val LocalMotion: ProvidableCompositionLocal<Boolean> = staticCompositionLocalOf { true }

@Composable
fun ItulahTheme(content: @Composable () -> Unit) {
    val context = LocalContext.current
    val motionOn = remember(context) {
        runCatching {
            Settings.Global.getFloat(context.contentResolver,
                Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f
        }.getOrDefault(true)
    }
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Blue,
            onPrimary = Color.White,
            background = Surface.canvas,
            onBackground = Ink.text(),
            surface = Surface.card,
            onSurface = Ink.text(),
            surfaceVariant = Surface.chrome,
            outline = Ink.border(.12f),
            outlineVariant = Ink.border(.04f),
            error = Destructive,
        ),
        typography = Typography(
            bodyLarge = Type.body, bodyMedium = Type.body, bodySmall = Type.caption,
            titleLarge = Type.anchor, titleMedium = Type.emphasis, labelSmall = Type.micro,
        ),
    ) {
        CompositionLocalProvider(LocalMotion provides motionOn, content = content)
    }
}
