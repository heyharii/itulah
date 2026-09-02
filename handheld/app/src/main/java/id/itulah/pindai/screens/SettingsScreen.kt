package id.itulah.pindai.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import id.itulah.pindai.data.Api
import id.itulah.pindai.data.ConfigStore
import id.itulah.pindai.data.Settings
import id.itulah.pindai.ui.kit.*
import id.itulah.pindai.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SettingsScreen(store: ConfigStore, onSaved: () -> Unit) {
    var settings by remember { mutableStateOf(store.load()) }
    var status by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxSize().background(Surface.canvas)
        .verticalScroll(rememberScrollState()).padding(Space.lg),
        verticalArrangement = Arrangement.spacedBy(Space.md)) {

        PlanetCard {
            SectionLabel("Node")
            Spacer(Modifier.height(Space.sm))
            Field("Edge URL", settings.baseUrl) { settings = settings.copy(baseUrl = it) }
            Field("Site ID", settings.siteId) { settings = settings.copy(siteId = it) }
            Field("Pool", settings.pool) { settings = settings.copy(pool = it) }
            Spacer(Modifier.height(Space.sm))
            Text("One build serves a DC and a shop; which one a handheld belongs to is a " +
                "deployment fact, not a code fact.",
                style = Type.micro, color = Ink.text(.60f))
        }

        PlanetCard {
            SectionLabel("Device identity")
            Spacer(Modifier.height(Space.sm))
            Field("Device ID", settings.deviceId) { settings = settings.copy(deviceId = it) }
            Field("Device key", settings.deviceKey, secret = true) {
                settings = settings.copy(deviceKey = it)
            }
            Spacer(Modifier.height(Space.sm))
            Text("This key signs every batch of evidence. It proves WHICH READER read — " +
                "never who was holding it.",
                style = Type.micro, color = Ink.text(.60f))
        }

        PlanetCard {
            SectionLabel("Operator (optional)")
            Spacer(Modifier.height(Space.sm))
            Field("Bearer token", settings.operatorToken, secret = true) {
                settings = settings.copy(operatorToken = it)
            }
            Spacer(Modifier.height(Space.sm))
            Text("For audit attribution, and for packing, receiving and counting, which " +
                "do need a human session.",
                style = Type.micro, color = Ink.text(.60f))
        }

        status?.let {
            Text(it, style = Type.caption, color = if (failed) Destructive else Success)
        }

        QuietButton("Test connection", enabled = !busy, onClick = {
            busy = true; status = null
            scope.launch {
                val result = withContext(Dispatchers.IO) {
                    runCatching { Api(settings).health() }
                }
                result.onSuccess { json ->
                    failed = false
                    status = "connected · " + json.optString("node_role", "?") +
                        " · " + json.optString("database", "?")
                }.onFailure { failed = true; status = it.message ?: "failed" }
                busy = false
            }
        })

        PrimaryButton("Save", enabled = !busy, onClick = {
            store.save(settings); settings = store.load()
            failed = false; status = "saved"; onSaved()
        })
    }
}

@Composable
private fun Field(
    label: String,
    value: String,
    secret: Boolean = false,
    onChange: (String) -> Unit,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label, style = Type.caption) },
        singleLine = true,
        visualTransformation = if (secret) PasswordVisualTransformation() else
            androidx.compose.ui.text.input.VisualTransformation.None,
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        shape = ControlShape,
    )
}
