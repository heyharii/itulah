package id.itulah.kasir.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/**
 * The counter's icons — the very paths `pos-web-options.html` draws (`IC`).
 *
 * Copied as path data rather than mapped onto a Material icon of roughly the
 * same shape, so the till and the web counter carry one set of glyphs: a 24
 * grid, a 1.7 stroke, round caps and joins, no fill. Each is black here and is
 * tinted by `Icon(tint = …)`.
 */
object Glyph {
    private fun icon(name: String, vararg paths: String, stroke: Float = 1.7f): ImageVector =
        ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
            paths.forEach { d ->
                addPath(
                    pathData = addPathNodes(d),
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = stroke,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }.build()

    val Scan by lazy {
        icon("scan", "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10")
    }
    val Close by lazy { icon("x", "M6 6l12 12M18 6 6 18") }
    val Hold by lazy { icon("hold", "M9 6v12M15 6v12") }
    val Bullets by lazy { icon("list", "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01") }
    val Return by lazy { icon("return", "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3") }
    val Forbidden by lazy { icon("void", "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8") }
    val Lock by lazy { icon("lock", "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3") }
    val Check by lazy { icon("check", "M5 12.5l4.5 4.5L19 7.5") }
    /** The seal on a settled payment: the same tick, drawn heavier. */
    val CheckBold by lazy { icon("check-bold", "M5 12.5l4.5 4.5L19 7.5", stroke = 2.2f) }
    val Down by lazy { icon("down", "M6 9l6 6 6-6") }
    val Rfid by lazy { icon("rfid", "M5 11a7 7 0 0 1 14 0M8 11a4 4 0 0 1 8 0M12 11v9") }
    val Print by lazy { icon("print", "M7 9V4h10v5M7 17H5v-6h14v6h-2M7 14h10v6H7z") }
    val Del by lazy { icon("del", "M9 6h11v12H9l-5-6zM13 10l4 4M17 10l-4 4") }
    val Wallet by lazy {
        icon("wallet", "M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3M4 7.5V17a2 2 0 0 0 2 2h14V8H6.5A2.5 2.5 0 0 1 4 5.5M16 13.5h.01")
    }
    val Cash by lazy { icon("cash", "M3 7h18v10H3zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6.5 10v4M17.5 10v4") }
    val Card by lazy { icon("card", "M3 6h18v12H3zM3 10h18M7 14.5h3") }
    val Qr by lazy { icon("qr", "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 18h2") }
    val Voucher by lazy { icon("voucher", "M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4zM14 6v12") }
    val User by lazy { icon("user", "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0") }
    val More by lazy { icon("more", "M5 12h.01M12 12h.01M19 12h.01", stroke = 3f) }

    /** Not in the prototype's set: a sale saved on this till and not yet with the store server. */
    val Clock by lazy { icon("clock", "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2") }

    /** Not in the prototype's set: a sale the store server refused. */
    val Alert by lazy {
        icon("alert", "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v5M12 16.5h.01")
    }

    /** Not in the prototype's set (the web counter has no soft keyboard to summon). */
    val Keyboard by lazy {
        icon(
            "keyboard",
            "M4 6.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z",
            "M7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M8 14h8",
        )
    }
}
