package id.itulah.kasir.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.itulah.kasir.data.Supervisor

/**
 * A second pair of eyes, at the counter.
 *
 * # Why a PIN and not a fingerprint
 *
 * By ruling. The reader on this tablet reads garments, not people, and a second
 * biometric device at a till is one more thing to fail on a Saturday.
 *
 * # Why this is a step-up and not a login
 *
 * The cashier stays signed in. The supervisor's credentials travel inside the
 * one request they are authorising and are checked by the node in the same
 * transaction that writes the reversal — nothing is stored here, and no session
 * is issued. A reversal nobody signed is a reversal nobody can be asked about.
 *
 * The node refuses with **one message for every kind of failure**, so a wrong
 * PIN and an unknown name look identical. That is deliberate: told apart, this
 * screen would be a way to find out who in the shop can authorise a void.
 *
 * The PIN is the supervisor's password, and the node requires at least eight
 * characters — so this is an eight-digit PIN, not four.
 */
@Composable
fun SupervisorSheet(
    what: String,
    busy: Boolean,
    failure: String?,
    onCancel: () -> Unit,
    onApprove: (Supervisor) -> Unit,
) {
    var username by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }

    Box(
        Modifier.fillMaxSize().background(Scrim),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .widthIn(max = 460.dp)
                .background(Canvas, RoundedCornerShape(RSheet))
                .padding(24.dp),
        ) {
            Text("Supervisor approval", style = Type.hero)
            Text(what, style = Type.meta)
            Spacer(Modifier.height(16.dp))

            OutlinedTextField(
                value = username,
                onValueChange = { username = it.trim() },
                label = { Text("Supervisor name", style = Type.meta) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(RInner),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Accent, unfocusedBorderColor = Hairline2,
                    focusedContainerColor = Canvas, unfocusedContainerColor = Canvas,
                ),
            )
            Spacer(Modifier.height(12.dp))
            // Masked as dots on screen, because a PIN typed at a counter is
            // typed with a customer standing on the other side of it.
            Text(
                if (pin.isEmpty()) "PIN" else "•".repeat(pin.length),
                style = Type.money.copy(fontSize = 24.sp, color = if (pin.isEmpty()) Mute else Ink),
            )
            Spacer(Modifier.height(10.dp))
            Keypad(
                onDigit = { if (pin.length < 12) pin += it },
                onBackspace = { pin = pin.dropLast(1) },
            )

            if (failure != null) {
                Spacer(Modifier.height(10.dp))
                Text(failure, style = Type.meta.copy(color = BadFg))
            }

            Spacer(Modifier.height(16.dp))
            PrimaryButton(
                "Approve",
                { onApprove(Supervisor(username, pin)) },
                Modifier.fillMaxWidth(),
                enabled = username.isNotBlank() && pin.length >= 8,
                busy = busy,
            )
            Spacer(Modifier.height(8.dp))
            QuietButton("Cancel", onCancel, Modifier.fillMaxWidth())
            if (pin.isNotEmpty() && pin.length < 8) {
                Spacer(Modifier.height(6.dp))
                Text("The supervisor PIN is at least 8 digits.", style = Type.pill)
            }
        }
    }
}

@Composable
private fun Keypad(onDigit: (String) -> Unit, onBackspace: () -> Unit) {
    val rows = listOf(
        listOf("1", "2", "3"), listOf("4", "5", "6"),
        listOf("7", "8", "9"), listOf("", "0", "⌫"),
    )
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        rows.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { key ->
                    if (key.isEmpty()) {
                        Spacer(Modifier.weight(1f))
                    } else {
                        GhostButton(
                            key,
                            { if (key == "⌫") onBackspace() else onDigit(key) },
                            Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}
