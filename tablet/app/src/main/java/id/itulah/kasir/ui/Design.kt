package id.itulah.kasir.ui

import androidx.compose.material3.MaterialTheme
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
 * (v0.5). Every value below is copied from there rather than re-derived, so a
 * shade that changes at the centre changes here by the same edit.
 *
 * # Where a till is allowed to differ, and why
 *
 * The hub is read at a desk with a mouse; this is worked standing up, at arm's
 * length, sometimes with a customer waiting. Two consequences, and only two:
 *
 *   - **Targets obey the tap floor.** The design system already names it —
 *     `--spacing-tap: 44px` — for exactly this surface. Nothing interactive is
 *     smaller.
 *   - **Money is bigger than the scale's largest step.** `--text-kpi` is 23;
 *     the figure a cashier reads back across a counter is not a KPI on a
 *     dashboard. Everything else uses the scale unchanged.
 *
 * Nothing else is reinterpreted. The greys, the two blues and their one job
 * each, the hairlines, the radii and the white scrim are the system's.
 */

// ── text: four greys in descending emphasis, plus two non-text marks ────
val Ink = Color(0xFF1D1D1F)
val Text = Color(0xFF46464D)
val Body = Color(0xFF74747B)
val Mute = Color(0xFFA6A6AD)
val Faint = Color(0xFFD3D3D8)
val LineIco = Color(0xFFABACB2)

// ── surfaces ────────────────────────────────────────────────────────────
/** White. Cards sit on it; the page does not. */
val Canvas = Color(0xFFFFFFFF)
val Soft = Color(0xFFF7F7F8)
val Soft2 = Color(0xFFF3F3F5)
val Hairline = Color(0xFFECECEF)
val Hairline2 = Color(0xFFE4E4E8)
val HairlineStrong = Color(0xFFD8D8DE)
val Dark = Color(0xFF1D1D1F)
/**
 * The veil is WHITE.
 *
 * Nothing in this system darkens: a sheet washes the content behind it toward
 * near-white. A black scrim is the single most recognisable way a screen stops
 * being Cloud Hub.
 */
val Scrim = Color(0xB8FFFFFF)
val OnDark = Color(0xFFFFFFFF)

/**
 * Two blues, one job each, and they never swap.
 *
 * INDIGO is selection — the active method, the focused field, the chosen row.
 * SKY is status, and only ever means in motion. Collapsing them flattens the
 * system, which is the fastest way for a screen to stop being Cloud Hub.
 */
val Accent = Color(0xFF3C52F0)
val AccentBg = Color(0xFFE9EBFC)
val Info = Color(0xFF2F86D8)
val InfoBg = Color(0xFFDDEBFA)
val InfoFg = Color(0xFF2C57BF)

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
val OkFg = Color(0xFF1D7A44)
val WarnFg = Color(0xFF92611A)
val BadFg = Color(0xFFB23B3B)

// ── geometry: pills for interactive, 16 for cards, nothing between ──────
val RInner = 9.dp
val RCard = 16.dp
val RShell = 18.dp
val RSheet = 22.dp

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
    val hero = TextStyle(fontFamily = Sans, fontSize = 22.sp, lineHeight = 26.4.sp,
        letterSpacing = (-0.48).sp, fontWeight = FontWeight.Medium, color = Ink)
    val kpi = TextStyle(fontFamily = Sans, fontSize = 23.sp, letterSpacing = (-0.46).sp,
        fontWeight = FontWeight.SemiBold, color = Ink)
    /** The one deliberate departure: the figure read across a counter. */
    val money = TextStyle(fontFamily = Sans, fontSize = 30.sp, letterSpacing = (-0.6).sp,
        fontWeight = FontWeight.SemiBold, color = Ink)
    val metric = TextStyle(fontFamily = Sans, fontSize = 15.sp, color = Ink)
    val cardTitle = TextStyle(fontFamily = Sans, fontSize = 14.sp, letterSpacing = (-0.14).sp,
        fontWeight = FontWeight.Medium, color = Ink)
    val prose = TextStyle(fontFamily = Sans, fontSize = 14.sp, color = Text)
    val nav = TextStyle(fontFamily = Sans, fontSize = 13.sp, color = Text)
    val meta = TextStyle(fontFamily = Sans, fontSize = 13.sp, color = Body)
    val cell = TextStyle(fontFamily = Sans, fontSize = 13.sp, color = Text)
    val section = TextStyle(fontFamily = Sans, fontSize = 12.5.sp, color = Body)
    val eyebrow = TextStyle(fontFamily = Sans, fontSize = 11.sp, letterSpacing = 0.44.sp,
        fontWeight = FontWeight.Medium, color = Mute)
    val pill = TextStyle(fontFamily = Sans, fontSize = 11.sp, color = Body)
    val id = TextStyle(fontFamily = Mono, fontSize = 12.sp, color = Mute)
}

private val scheme = lightColorScheme(
    primary = Accent, onPrimary = OnDark,
    background = Soft, onBackground = Ink,
    surface = Canvas, onSurface = Ink,
    error = Bad, onError = OnDark,
    outline = HairlineStrong, outlineVariant = Hairline,
)

@Composable
fun ItulahTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = scheme,
        typography = Typography(
            headlineSmall = Type.hero,
            titleMedium = Type.cardTitle,
            bodyMedium = Type.prose,
            labelSmall = Type.pill,
        ),
        content = content,
    )
}
