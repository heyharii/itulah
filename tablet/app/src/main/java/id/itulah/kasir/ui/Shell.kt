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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * The frame every screen stands in: the pale ground, a header, and `.statusbar`.
 *
 * The same frame on every screen is the point. A cashier who looks up from a
 * return and sees a different top edge has to work out where they are; one
 * who sees the same mark, the same terminal and their own initials knows.
 *
 * The counter is the one page that brings its own header — the toolbar of
 * Hold, Held, Return and the person menu — so it asks for [bar] false; every
 * other page keeps the plain bar below.
 */
@Composable
fun Shell(
    terminalId: String?,
    cashier: String?,
    onSignOut: (() -> Unit)? = null,
    status: (@Composable RowScope.() -> Unit)? = null,
    bar: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Soft3)) {
        if (bar) TopBar(terminalId, cashier, onSignOut)
        Column(Modifier.weight(1f).fillMaxWidth(), content = content)
        StatusBar(status)
    }
}

/** `.hdr` — the mark on the left; where, and who, on the right. */
@Composable
private fun TopBar(terminalId: String?, cashier: String?, onSignOut: (() -> Unit)?) {
    Column(Modifier.background(Canvas)) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(56.dp)
                .padding(start = 16.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BrandMark()

            Spacer(Modifier.weight(1f))

            if (terminalId != null) {
                Badge(terminalId.ifBlank { "Till" })
                Spacer(Modifier.width(12.dp))
            }
            if (onSignOut != null) {
                QuietButton("Sign out", onSignOut)
                Spacer(Modifier.width(8.dp))
            }
            if (cashier != null) Avatar(cashier)
        }
        Divider()
    }
}

/**
 * `.statusbar` — the state of the machinery, never the state of the sale.
 *
 * What goes here is what somebody checks when something feels wrong: is the
 * reader on, is the node answering, is there a shift. It is quiet because on a
 * good day nobody reads it — quiet by ink, not by size: nothing is below 15.
 */
@Composable
private fun StatusBar(status: (@Composable RowScope.() -> Unit)?) {
    Column(Modifier.background(Canvas)) {
        Divider()
        Row(
            Modifier
                .fillMaxWidth()
                .height(36.dp)
                .padding(horizontal = 20.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            if (status != null) {
                status()
            } else {
                StatusText("Till · one store node, many terminals")
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
