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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.itulah.kasir.data.Config
import kotlin.math.roundToInt

/**
 * Commissioning, and the one control that is not commissioning.
 *
 * Which node this tablet belongs to and which terminal it is are set once and
 * never again — one APK serves every counter, because where a tablet stands is
 * a deployment fact and not a code fact. The terminal id matters more than it
 * looks: the database enforces one open shift per terminal, so two tablets
 * sharing an id means the second cashier of the evening is simply refused.
 *
 * Reader power is the opposite kind of setting. It is a floor decision, it is
 * expected to move, and the figure shown is the one the module reported back
 * after the change — not the one the finger asked for.
 */
@Composable
fun SetupScreen(
    config: Config,
    readerAvailable: Boolean,
    readerPower: Int?,
    onPower: (Int) -> Unit,
    onSave: (Config) -> Unit,
    onCancel: (() -> Unit)?,
) {
    var node by remember { mutableStateOf(config.nodeUrl.ifBlank { "http://" }) }
    var terminal by remember { mutableStateOf(config.terminalId) }
    var printer by remember { mutableStateOf(config.printerHost) }
    var port by remember { mutableStateOf(config.printerPort.toString()) }
    var paper by remember { mutableStateOf(config.paper) }
    var power by remember { mutableStateOf((if (config.readerPower <= 0) 12 else config.readerPower).toFloat()) }

    Box(Modifier.fillMaxSize().background(Soft3), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 560.dp).verticalScroll(rememberScrollState()).padding(20.dp),
        ) {
            Text("Kasir", style = Type.hero.copy(fontSize = 24.sp, letterSpacing = (-0.6).sp))
            Text(
                "Satu APK melayani setiap konter. Konter mana yang ini adalah " +
                    "fakta pemasangan, bukan fakta kode.",
                fontSize = 13.sp,
                color = Mute,
            )
            Spacer(Modifier.height(14.dp))

            Card(Modifier.fillMaxWidth()) {
                SectionLabel("Node")
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    node, { node = it.trim() },
                    label = { Text("URL node toko") },
                    placeholder = { Text("http://100.x.y.z:8081") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    terminal, { terminal = it.trim() },
                    label = { Text("ID terminal") },
                    placeholder = { Text("till-01") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "Satu terminal, satu laci. Dua tablet dengan ID sama akan " +
                        "saling mengira uang yang lain adalah miliknya.",
                    fontSize = 11.sp,
                    color = Mute,
                )
            }

            Spacer(Modifier.height(12.dp))
            Card(Modifier.fillMaxWidth()) {
                SectionLabel("Printer struk")
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        printer, { printer = it.trim() },
                        label = { Text("Host") },
                        singleLine = true,
                        modifier = Modifier.weight(2f),
                    )
                    OutlinedTextField(
                        port, { port = it.filter { c -> c.isDigit() } },
                        label = { Text("Port") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ChoiceTile("58mm", selected = paper == "NARROW", onClick = { paper = "NARROW" }, modifier = Modifier.weight(1f), height = 46.dp)
                    ChoiceTile("80mm", selected = paper == "WIDE", onClick = { paper = "WIDE" }, modifier = Modifier.weight(1f), height = 46.dp)
                }
                Text(
                    "Node yang mencetak, bukan tablet — node yang satu jaringan " +
                        "dengan printer.",
                    fontSize = 11.sp,
                    color = Mute,
                )
            }

            Spacer(Modifier.height(12.dp))
            Card(Modifier.fillMaxWidth()) {
                SectionLabel("Pembaca")
                Spacer(Modifier.height(8.dp))
                if (!readerAvailable) {
                    Text(
                        "Tidak ada pembaca UHF terpasang. Kasir tetap berjualan " +
                            "dengan pemindai keyboard.",
                        fontSize = 13.sp,
                        color = Mute,
                    )
                } else {
                    Text(
                        "${readerPower ?: power.roundToInt()} dBm",
                        fontSize = 18.sp,
                    )
                    Slider(
                        value = power,
                        onValueChange = { power = it },
                        valueRange = 5f..30f,
                        steps = 24,
                        onValueChangeFinished = { onPower(power.roundToInt()) },
                    )
                    Text(
                        "Konter itu jarak dekat: bajunya ada di depan kasir. " +
                            "Di 30 dBm, rak di belakang konter ikut masuk keranjang — " +
                            "dan keranjang yang kelebihan tetap terlihat seperti keranjang.",
                        fontSize = 11.sp,
                        color = Mute,
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PrimaryButton(
                    "Simpan",
                    {
                        onSave(
                            config.copy(
                                nodeUrl = node.trimEnd('/'),
                                terminalId = terminal,
                                printerHost = printer,
                                printerPort = port.toIntOrNull() ?: 9100,
                                paper = paper,
                            ),
                        )
                    },
                    Modifier.weight(1f),
                    enabled = node.length > "http://".length && terminal.isNotBlank(),
                )
                if (onCancel != null) GhostButton("Batal", onCancel, Modifier.weight(1f))
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
