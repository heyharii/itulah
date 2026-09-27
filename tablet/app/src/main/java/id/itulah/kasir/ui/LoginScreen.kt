package id.itulah.kasir.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Who is at the till.
 *
 * Not decoration: the node stamps the cashier onto every sale from the bearer,
 * and a reversal needs a second person who is *not* this one. A till running
 * against a node with auth disabled has no identities at all, so voids and
 * returns become impossible there — which is correct, and worth knowing before
 * a customer is standing at the counter with a receipt.
 */
@Composable
fun LoginScreen(
    node: String,
    busy: Boolean,
    error: String?,
    onLogin: (String, String) -> Unit,
    onSetup: () -> Unit,
) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    Box(Modifier.fillMaxSize().background(Soft3), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 420.dp).padding(20.dp)) {
            Text("Masuk", style = Type.hero.copy(fontSize = 24.sp, letterSpacing = (-0.6).sp))
            Text(node, fontSize = 12.sp, color = Mute)
            Spacer(Modifier.height(16.dp))
            Card(Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    username, { username = it.trim() },
                    label = { Text("Nama pengguna") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    password, { password = it },
                    label = { Text("Kata sandi") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(error, color = Bad, fontSize = 13.sp)
                }
                Spacer(Modifier.height(12.dp))
                PrimaryButton(
                    "Masuk",
                    { onLogin(username, password) },
                    Modifier.fillMaxWidth(),
                    enabled = username.isNotBlank() && password.isNotBlank(),
                    busy = busy,
                )
            }
            Spacer(Modifier.height(10.dp))
            GhostButton("Perangkat", onSetup, Modifier.fillMaxWidth())
        }
    }
}
