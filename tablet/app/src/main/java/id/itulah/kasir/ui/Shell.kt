package id.itulah.kasir.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The frame every screen stands in: pos-desktop's `.topbar`, the pale ground,
 * and `.statusbar`.
 *
 * The same frame on every screen is the point. A cashier who looks up from a
 * return and sees a different top edge has to work out where they are; one
 * who sees the same brand, the same terminal and their own initials knows.
 */
@Composable
fun Shell(
    terminalId: String?,
    cashier: String?,
    onSignOut: (() -> Unit)? = null,
    status: (@Composable RowScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Soft3)) {
        TopBar(terminalId, cashier, onSignOut)
        Column(Modifier.weight(1f).fillMaxWidth(), content = content)
        StatusBar(status)
    }
}

/** `.topbar` — brand on the left; where, and who, on the right. */
@Composable
private fun TopBar(terminalId: String?, cashier: String?, onSignOut: (() -> Unit)?) {
    Column {
        Row(
            Modifier
                .fillMaxWidth()
                .height(64.dp)
                .padding(horizontal = 24.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // `.brand-mark` — the one blue square that is not a button.
            Box(
                Modifier.size(32.dp).background(Accent, RoundedCornerShape(9.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "i.",
                    style = Type.cell.copy(color = OnDark, fontWeight = FontWeight.Bold, fontSize = 14.sp),
                )
            }
            Spacer(Modifier.width(11.dp))
            Text("itulah", style = Type.cardTitle.copy(fontSize = 16.sp, letterSpacing = (-0.4).sp))
            Spacer(Modifier.width(6.dp))
            Text("kasir", style = Type.meta.copy(color = Mute))

            Spacer(Modifier.weight(1f))

            if (terminalId != null) {
                Badge(terminalId.ifBlank { "Terminal" })
                Spacer(Modifier.width(16.dp))
            }
            if (onSignOut != null) {
                QuietButton("Keluar", onSignOut)
                Spacer(Modifier.width(8.dp))
            }
            if (cashier != null) Avatar(cashier)
        }
        Divider()
    }
}

/** `.avatar` — initials on the hub's one soft ramp. */
@Composable
private fun Avatar(who: String) {
    Box(
        Modifier
            .size(32.dp)
            .background(Brush.linearGradient(listOf(AvatarFrom, AvatarTo)), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            who.ifBlank { "??" }.take(2).uppercase(),
            style = Type.pill.copy(color = Text, fontWeight = FontWeight.SemiBold),
        )
    }
}

/**
 * `.statusbar` — the state of the machinery, never the state of the sale.
 *
 * What goes here is what somebody checks when something feels wrong: is the
 * reader on, is the node answering, is there a shift. It is small and grey
 * because on a good day nobody reads it.
 */
@Composable
private fun StatusBar(status: (@Composable RowScope.() -> Unit)?) {
    Column {
        Divider()
        Row(
            Modifier
                .fillMaxWidth()
                .height(34.dp)
                .padding(horizontal = 24.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            if (status != null) {
                status()
            } else {
                StatusText("Terminal kasir · satu node toko, banyak terminal")
            }
        }
    }
}

/** One fact in the status bar. */
@Composable
fun StatusText(text: String, dot: Color? = null, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        if (dot != null) {
            Box(Modifier.size(7.dp).background(dot, CircleShape))
            Spacer(Modifier.width(7.dp))
        }
        Text(text, style = Type.pill.copy(color = Mute), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
