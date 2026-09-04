package id.itulah.pindai.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import id.itulah.pindai.core.Reader
import id.itulah.pindai.data.Api
import id.itulah.pindai.data.ConfigStore
import id.itulah.pindai.data.Settings
import id.itulah.pindai.ui.kit.*
import id.itulah.pindai.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SettingsScreen(store: ConfigStore, reader: Reader, onSaved: () -> Unit) {
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

        ReaderPowerCard(store, reader) { settings = settings.copy(readerPower = it) }

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

/**
 * How far this reader shouts.
 *
 * The only setting on this screen that is not a deployment fact, and the only
 * one anybody comes back for. Thirty dBm reaches the back of a rack — and, in a
 * shop, the rack on the other side of the wall, which is how a floor count
 * quietly acquires the stockroom and nobody ever finds out. Turning it down is
 * how you make the sweep mean the aisle you are standing in.
 *
 * The figure shown is what the MODULE reported after the change, never the
 * number the finger asked for. `setPower` answers true for values this firmware
 * then settles elsewhere, and the whole point of a control like this is that the
 * person holding it knows what the antenna is actually doing.
 */
@Composable
private fun ReaderPowerCard(store: ConfigStore, reader: Reader, onApplied: (Int) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val stored = remember { store.load().readerPower }
    var power by remember { mutableIntStateOf(stored.takeIf { it > 0 } ?: Reader.MAX_POWER) }
    var note by remember { mutableStateOf<String?>(null) }
    var asleep by remember { mutableStateOf(true) }
    // Moving the power closes and re-opens the module: measured about four
    // seconds here, at rest, against seven mid-sweep where a running inventory
    // has to be stopped and started too. Without a word on screen those are
    // four seconds of nothing happening, and the honest reading of nothing
    // happening is that the drag did not take — so the next thing somebody does
    // is drag again, and queue a second re-open behind the first.
    var applying by remember { mutableStateOf(false) }

    // Opening the module is not sweeping it: this powers the UART so the figure
    // below can be a reading rather than a guess, and the radio stays quiet
    // until somebody pulls the trigger. Entering this tab has already stopped
    // any sweep, so the getter is being asked at rest — which is the only time
    // this firmware answers it honestly.
    LaunchedEffect(Unit) {
        val outcome = withContext(Dispatchers.IO) {
            runCatching {
                reader.init(context)
                if (stored > 0) reader.setPower(stored) else reader.power()
            }
        }
        outcome.onSuccess { dbm ->
            if (dbm > 0) {
                asleep = false
                power = dbm
                note = "module reports $dbm dBm"
                onApplied(dbm)
            }
        }.onFailure { note = it.message ?: "reader unavailable" }
    }

    PlanetCard {
        SectionLabel("Reader power")
        Spacer(Modifier.height(Space.sm))
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Bottom,
        ) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text("$power", style = Type.hero, color = Ink.text())
                Spacer(Modifier.width(Space.xs))
                Text("dBm", style = Type.caption, color = Ink.text(.60f),
                    modifier = Modifier.padding(bottom = 5.dp))
            }
            note?.let {
                Text(it, style = Type.micro,
                    color = Ink.text(if (applying) .74f else if (asleep) .36f else .60f),
                    modifier = Modifier.padding(bottom = 4.dp))
            }
        }
        Spacer(Modifier.height(Space.md))
        Fader(
            value = power,
            range = Reader.MIN_POWER..Reader.MAX_POWER,
            onChange = { power = it },
            onCommit = {
                val asked = power
                if (applying) return@Fader
                applying = true
                note = "moving the antenna · about 4 seconds"
                scope.launch {
                    val got = withContext(Dispatchers.IO) { reader.setPower(asked) }
                    // A closed module keeps the choice and applies it when it
                    // wakes, so the setting is never lost — it is only not yet
                    // proven, and the caption says which of the two this is.
                    if (got > 0) {
                        asleep = false
                        power = got
                        note = "module reports $got dBm"
                    } else {
                        asleep = true
                        note = "reader asleep · applies at the next sweep"
                    }
                    store.saveReaderPower(power)
                    onApplied(power)
                    applying = false
                }
            },
        )
        Spacer(Modifier.height(Space.sm))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("${Reader.MIN_POWER} · the shelf in front of you",
                style = Type.micro, color = Ink.text(.60f))
            Text("${Reader.MAX_POWER} · the whole aisle",
                style = Type.micro, color = Ink.text(.60f))
        }
        Spacer(Modifier.height(Space.sm))
        Text("Full power reads the back of a rack, and through a wall. A count " +
            "that quietly includes the next room is wrong in the one way nobody " +
            "checks — so this belongs to the job, not to the device.",
            style = Type.micro, color = Ink.text(.60f))
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
