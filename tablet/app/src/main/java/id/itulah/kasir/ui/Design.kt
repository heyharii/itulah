package id.itulah.kasir.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.itulah.kasir.R

/**
 * Cloud Hub, as this till speaks it.
 *
 * The authority is `frontend-hub/src/styles/index.css`, which is itself the
 * Cloud Hub language authored from `~/Documents/retail/cloud-app/ollama/DESIGN.md`
 * (v0.5), as re-ruled on 2026-09-10: the greys warmed, the accent moved from
 * indigo to a plain blue, the radii tightened a step and the type scale was
 * reset. Every value below is copied from there rather than re-derived, so a
 * shade that changes at the centre changes here by the same edit.
 *
 * The *shape* — topbar, two white panes on the pale ground, the function
 * board, the payment page — is `pos-desktop`'s, so the counter looks the same
 * whether it is a tablet or a desktop till. Where the two disagree on a value
 * the hub wins; `pos-desktop`'s own `body[data-device=tablet]` sizes decide
 * how big a thing is drawn for a thumb.
 *
 * # Where a till is allowed to differ, and why
 *
 * The hub is read at a desk with a mouse; this is worked standing up, at arm's
 * length, sometimes with a customer waiting. Two consequences, and only two:
 *
 *   - **Targets obey the tap floor.** The design system already names it —
 *     `--spacing-tap: 44px` — for exactly this surface. Nothing interactive is
 *     smaller.
 *   - **Money is bigger than the scale's largest step.** `--text-kpi` is 18;
 *     the figure a cashier reads back across a counter is not a KPI on a
 *     dashboard, and pos-desktop sets it at 28.
 *
 * Nothing else is reinterpreted.
 */

// ── text: four greys in descending emphasis, plus two non-text marks ────
// Warm, not cool — each carries a little yellow-green, which is what makes the
// white read as paper rather than as screen.
val Ink = Color(0xFF20242C)
val Text = Color(0xFF394150)
val Body = Color(0xFF626B78)
val Mute = Color(0xFF737C89)
val Faint = Color(0xFFB9C0C9)
val LineIco = Color(0xFF89919D)

// ── surfaces ────────────────────────────────────────────────────────────
/** White. Cards and panes sit on it; the page does not. */
val Canvas = Color(0xFFFFFFFF)
val Soft = Color(0xFFF8F9FB)
val Soft2 = Color(0xFFF0F2F5)
/** The till's ground, behind the two panes — pos-desktop's `#f7f8fa`. */
val Soft3 = Color(0xFFF7F8FA)
val Hairline = Color(0xFFE7EAF0)
val Hairline2 = Color(0xFFDCE1E8)
val HairlineStrong = Color(0xFFC7CED8)
val Dark = Color(0xFF191B20)
val Backdrop = Color(0xFFDFE3EA)
/**
 * The veil is WHITE.
 *
 * Nothing in this system darkens: a sheet washes the content behind it toward
 * near-white. A black scrim is the single most recognisable way a screen stops
 * being Cloud Hub.
 */
val Scrim = Color(0xB8F7F8FA)
val OnDark = Color(0xFFFFFFFF)

/**
 * Two blues, one job each, and they never swap.
 *
 * ACCENT is selection — the active method, the focused field, the chosen row.
 * INFO is status, and only ever means in motion.
 */
val Accent = Color(0xFF2563EB)
val AccentBg = Color(0xFFEFF5FF)
val Info = Color(0xFF2F86D8)
val InfoBg = Color(0xFFDDEBFA)
val InfoFg = Color(0xFF2C57BF)

/**
 * The one thing to press.
 *
 * The hub's `--cta`, which is the same blue pos-desktop's pay button wears.
 * There is one per screen, in the same place, and it is the thing the cashier
 * is about to do.
 */
val Cta = Color(0xFF2563EB)
val CtaHover = Color(0xFF1D4ED8)

// ── status ──────────────────────────────────────────────────────────────
val Ok = Color(0xFF36B827)
val OkBg = Color(0xFFD9F4D2)
val Warn = Color(0xFFC9892E)
val WarnBg = Color(0xFFFAEACD)
val Bad = Color(0xFFD05151)
val BadBg = Color(0xFFFBEAEA)

/**
 * Readable text on the soft status fills.
 *
 * The saturated hues above are for dots, meters and glyphs; at label size on a
 * tint they fail contrast, which is why the system carries a second, darker
 * value for the words themselves.
 */
val OkFg = Color(0xFF15803D)
val WarnFg = Color(0xFFB45309)
val BadFg = Color(0xFFBE123C)

/** The avatar wash — the system's one soft ramp. */
val AvatarFrom = Color(0xFFE8DEF4)
val AvatarTo = Color(0xFFF8DDE8)

// ── geometry ────────────────────────────────────────────────────────────
val RInner = 7.dp
val RCard = 12.dp
val RShell = 16.dp
val RSheet = 16.dp

/** The touch floor. Named once so a device that argues with it is one edit. */
val Tap = 44.dp

/**
 * The system's two faces, carried in the APK.
 *
 * Not downloadable fonts: this tablet is a Huawei with no Play Services, so a
 * font that has to be fetched is a font that never arrives and a till that
 * silently falls back to whatever the vendor shipped. 220 KB is a cheap way to
 * make the counter and the centre look like one system.
 */
val Sans = FontFamily(Font(R.font.inter_variable))
val Mono = FontFamily(Font(R.font.jetbrains_mono_variable))

/** The scale, from `@theme` in the hub's stylesheet. Sizes are never guessed. */
object Type {
    val hero = TextStyle(fontFamily = Sans, fontSize = 17.sp, lineHeight = 24.sp,
        letterSpacing = (-0.34).sp, fontWeight = FontWeight.SemiBold, color = Ink)
    val kpi = TextStyle(fontFamily = Sans, fontSize = 18.sp, lineHeight = 24.sp,
        letterSpacing = (-0.1).sp, fontWeight = FontWeight.SemiBold, color = Ink)
    /** The one deliberate departure: the figure read across a counter. */
    val money = TextStyle(fontFamily = Sans, fontSize = 28.sp, letterSpacing = (-0.8).sp,
        fontWeight = FontWeight.SemiBold, color = Ink)
    val metric = TextStyle(fontFamily = Sans, fontSize = 15.sp, color = Ink)
    val cardTitle = TextStyle(fontFamily = Sans, fontSize = 15.sp, letterSpacing = (-0.15).sp,
        fontWeight = FontWeight.SemiBold, color = Ink)
    val prose = TextStyle(fontFamily = Sans, fontSize = 14.sp, color = Text)
    val control = TextStyle(fontFamily = Sans, fontSize = 13.sp, lineHeight = 20.sp,
        fontWeight = FontWeight.Medium, color = Ink)
    val nav = TextStyle(fontFamily = Sans, fontSize = 13.sp, color = Text)
    val meta = TextStyle(fontFamily = Sans, fontSize = 12.sp, color = Body)
    val cell = TextStyle(fontFamily = Sans, fontSize = 13.sp, color = Text)
    val section = TextStyle(fontFamily = Sans, fontSize = 13.sp, color = Body)
    val eyebrow = TextStyle(fontFamily = Sans, fontSize = 12.sp, letterSpacing = 0.48.sp,
        fontWeight = FontWeight.Medium, color = Mute)
    val pill = TextStyle(fontFamily = Sans, fontSize = 11.sp, color = Body)
    val id = TextStyle(fontFamily = Mono, fontSize = 12.sp, color = Mute)
}

private val scheme = lightColorScheme(
    primary = Accent, onPrimary = OnDark,
    background = Soft3, onBackground = Ink,
    surface = Canvas, onSurface = Ink,
    error = Bad, onError = OnDark,
    outline = Hairline2, outlineVariant = Hairline,
)

@Composable
fun ItulahTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = scheme,
        typography = Typography(
            headlineSmall = Type.hero,
            titleMedium = Type.cardTitle,
            bodyMedium = Type.prose,
            bodyLarge = Type.prose,
            labelSmall = Type.pill,
        ),
        // Every text field in the app takes `extraSmall`; setting it once is
        // what makes a Material input wear the system's control radius.
        shapes = Shapes(
            extraSmall = RoundedCornerShape(RInner),
            small = RoundedCornerShape(RInner),
            medium = RoundedCornerShape(RCard),
        ),
        content = content,
    )
}
