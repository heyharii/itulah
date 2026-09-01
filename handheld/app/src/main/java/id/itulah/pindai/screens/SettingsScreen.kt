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
            Field("URL Edge", settings.baseUrl) { settings = settings.copy(baseUrl = it) }
            Field("Site ID", settings.siteId) { settings = settings.copy(siteId = it) }
            Field("Pool", settings.pool) { settings = settings.copy(pool = it) }
            Spacer(Modifier.height(Space.sm))
            Text("Satu build melayani DC dan toko; mana yang dipakai adalah fakta " +
                "penempatan, bukan fakta kode.",
                style = Type.micro, color = Ink.text(.60f))
        }

        PlanetCard {
            SectionLabel("Identitas perangkat")
            Spacer(Modifier.height(Space.sm))
            Field("Device ID", settings.deviceId) { settings = settings.copy(deviceId = it) }
            Field("Device key", settings.deviceKey, secret = true) {
                settings = settings.copy(deviceKey = it)
            }
            Spacer(Modifier.height(Space.sm))
            Text("Kunci ini menandatangani tiap batch observasi. Ia membuktikan " +
                "READER mana yang membaca — bukan siapa yang memegangnya.",
                style = Type.micro, color = Ink.text(.60f))
        }

        PlanetCard {
            SectionLabel("Operator (opsional)")
            Spacer(Modifier.height(Space.sm))
            Field("Bearer token", settings.operatorToken, secret = true) {
                settings = settings.copy(operatorToken = it)
            }
            Spacer(Modifier.height(Space.sm))
            Text("Untuk atribusi audit dan untuk packing/terima/opname yang " +
                "memang butuh sesi manusia.",
                style = Type.micro, color = Ink.text(.60f))
        }

        status?.let {
            Text(it, style = Type.caption, color = if (failed) Destructive else Success)
        }

        QuietButton("Tes koneksi", enabled = !busy, onClick = {
            busy = true; status = null
            scope.launch {
                val result = withContext(Dispatchers.IO) {
                    runCatching { Api(settings).health() }
                }
                result.onSuccess { json ->
                    failed = false
                    status = "terhubung · " + json.optString("node_role", "?") +
                        " · " + json.optString("database", "?")
                }.onFailure { failed = true; status = it.message ?: "gagal" }
                busy = false
            }
        })

        PrimaryButton("Simpan", enabled = !busy, onClick = {
            store.save(settings); settings = store.load()
            failed = false; status = "tersimpan"; onSaved()
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
