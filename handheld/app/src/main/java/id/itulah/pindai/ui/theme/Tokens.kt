package id.itulah.pindai.ui.theme

import android.provider.Settings
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
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
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * Cloud Hub design language — the handheld's expression of it.
 *
 * This app used to carry a design system of its own ("Planet DS v5": one ink at
 * fixed alphas over three greys). It was coherent and it was a second system,
 * which is the one thing a suite of five apps cannot afford — a grey chosen by
 * alpha drifts away from a grey chosen by hex the moment either side is
 * touched, and nobody can see the drift in a diff.
 *
 * So the values below are `frontend-hub/src/styles/index.css`'s, value for
 * value. If this app ever looks a generation behind the console again, diff the
 * two palettes first; that is almost always the whole of it.
 *
 * What is NOT copied from the console is density. The type scale and the touch
 * targets here are `frontend-floor`'s — that app is this language's PHONE
 * expression, worked standing up in an aisle, and this device is the same aisle
 * with a trigger on it. A 32px control is an office control for a mouse.
 *
 * The names are the CSS token names on purpose: `Ink.ink` reads redundantly in
 * Kotlin, and it is worth it, because `--ink` is what the other four apps call
 * it and a rename here would be the start of a second vocabulary.
 */

/** text — four greys in descending emphasis, plus two non-text marks. */
object Ink {
    /** names and figures */
    val ink = Color(0xFF20242C)

    /** ordinary content */
    val text = Color(0xFF394150)

    /** supporting prose, column headings */
    val body = Color(0xFF626B78)

    /** units, counts, anything the eye should skip */
    val mute = Color(0xFF737C89)

    /** micro-caps and other marks that are not read */
    val faint = Color(0xFFB9C0C9)

    /** line icons in chrome */
    val lineIco = Color(0xFF89919D)
}

object Surface {
    val canvas = Color(0xFFFFFFFF)
    val soft = Color(0xFFF8F9FB)

    /** the press wash, a segmented track, the fill behind an input */
    val soft2 = Color(0xFFF0F2F5)
    val soft3 = Color(0xFFF7F8FA)
    val hairline = Color(0xFFE7EAF0)
    val hairline2 = Color(0xFFDCE1E8)
    val hairlineStrong = Color(0xFFC7CED8)
    val dark = Color(0xFF191B20)
    val onDark = Color(0xFFFFFFFF)

    /**
     * Shadows are cast in the ink's own hue, never in neutral grey. A grey drop
     * under a blue-grey card is the one place the eye reliably notices that two
     * palettes are in play.
     */
    val shadow = Color(0xFF18273C)
}

/**
 * Two blues, one job each, and they never swap. ACCENT is selection — the live
 * tab, the joined session, the chosen count. INFO is status, and only ever means
 * in motion. Collapsing them flattens the system.
 */
val Accent = Color(0xFF2563EB)
val AccentBg = Color(0xFFEFF5FF)
val Info = Color(0xFF2F86D8)
val InfoFg = Color(0xFF2C57BF)

/**
 * The one call to action. The same blue as the accent, and a token of its own
 * rather than `Accent` spelled at every call site: the console has moved the CTA
 * off the accent once already, and an app that spells the colour in fourteen
 * places is an app that gets left behind when it moves again.
 */
val Cta = Color(0xFF2563EB)
val CtaFg = Color(0xFFFFFFFF)

/** status — the saturated hue is for dots and meters, the `Fg` for the label. */
val Ok = Color(0xFF36B827)
val OkFg = Color(0xFF15803D)
val Warn = Color(0xFFC9892E)
val WarnFg = Color(0xFFB45309)
val Bad = Color(0xFFD05151)
val BadFg = Color(0xFFBE123C)

/** The 4–24 dp scale. */
object Space {
    val xs = 4.dp; val sm = 8.dp; val md = 12.dp
    val lg = 16.dp; val xl = 20.dp; val xxl = 24.dp
}

/**
 * Geometry, one step tighter than the old kit's.
 *
 * A 16 dp corner reads like a document and a 22 reads like a consumer app; this
 * is a scanner in a warehouse and a scanner should look like equipment.
 * `inner` is the radius of every CONTROL — nothing here is a full pill except a
 * dot, and the floating tab squircle, which is drawn from the frames.
 */
object Radius {
    val card = 12.dp
    val inner = 7.dp
    val shell = 16.dp
    val sheet = 16.dp
}

/**
 * The touch floor. DESIGN.md puts a hard 44 dp under every target, and on this
 * surface the thumb is usually in a glove with the other hand on a garment.
 * `action` is the one thing a screen exists to do — big enough to hit without
 * looking at it.
 */
object Tap {
    val floor = 44.dp
    val action = 56.dp
    val field = 48.dp
}

private const val Tnum = "tnum"

/**
 * The type scale, named — `frontend-floor`'s, which is the console's one step up
 * for a screen read at arm's length. Never write a raw sp size in a screen.
 */
object Type {
    /** The one figure a screen is about. Exactly one per screen. */
    val total = TextStyle(fontSize = 32.sp, lineHeight = 35.sp, fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.025).em, fontFeatureSettings = Tnum)

    /** A screen title inside the content, not the bar. */
    val hero = TextStyle(fontSize = 22.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.022).em)

    /** The app bar, and the only place this size appears. */
    val title = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.015).em)

    /** A quantity beside its label — a row's count, a session's tags. */
    val kpi = TextStyle(fontSize = 21.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.02).em, fontFeatureSettings = Tnum)

    val cardTitle = TextStyle(fontSize = 14.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.01).em)
    val metric = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium,
        fontFeatureSettings = Tnum)

    /** Prose. */
    val body = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal)

    /** Record-card body — a row's name, a list's content. */
    val cell = TextStyle(fontSize = 13.5f.sp, lineHeight = 19.sp, fontWeight = FontWeight.Normal)

    /** A control's label, and the one action's larger one. */
    val control = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium)
    val action = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium)

    /** Micro-caps: the label over the one figure a screen is about. */
    val eyebrow = TextStyle(fontSize = 10.sp, lineHeight = 13.sp, fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.04.em)

    /** The group label above a run of cards. */
    val section = TextStyle(fontSize = 12.5f.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium)

    /** Supporting lines under a name, notes, hints. */
    val meta = TextStyle(fontSize = 12.5f.sp, lineHeight = 17.sp, fontWeight = FontWeight.Normal,
        fontFeatureSettings = Tnum)

    val pill = TextStyle(fontSize = 11.5f.sp, lineHeight = 14.sp, fontWeight = FontWeight.Medium)

    /** Mono ids — an EPC, a SKU. One step up from the console's, for a thumb. */
    val id = TextStyle(fontSize = 12.5f.sp, lineHeight = 16.sp, fontFamily = FontFamily.Monospace,
        fontFeatureSettings = Tnum)
}

/**
 * Two curves and five timing bands, carried from the console so the apps do not
 * drift on timing the way they drifted on colour.
 *
 * Frequency decides the budget: a press happens a thousand times a shift and has
 * to feel instant; a panel happens rarely and is allowed to explain the space it
 * came from.
 */
object Motion {
    val easeOut: Easing = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)
    val easeInOut: Easing = CubicBezierEasing(0.77f, 0f, 0.175f, 1f)

    const val press = 120
    const val hover = 120
    const val pop = 160
    const val panel = 200
    const val page = 180
    const val sheet = 280
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
        // Material's slots are filled so that anything reaching for them lands
        // inside this palette rather than on Material's purple. Nothing in this
        // app is meant to ask for them: the kit spells the token it wants.
        colorScheme = lightColorScheme(
            primary = Cta,
            onPrimary = CtaFg,
            background = Surface.canvas,
            onBackground = Ink.ink,
            surface = Surface.canvas,
            onSurface = Ink.ink,
            surfaceVariant = Surface.soft2,
            onSurfaceVariant = Ink.body,
            outline = Surface.hairline2,
            outlineVariant = Surface.hairline,
            error = Bad,
        ),
        typography = Typography(
            bodyLarge = Type.body, bodyMedium = Type.cell, bodySmall = Type.meta,
            titleLarge = Type.hero, titleMedium = Type.title, labelSmall = Type.pill,
        ),
    ) {
        CompositionLocalProvider(LocalMotion provides motionOn, content = content)
    }
}
