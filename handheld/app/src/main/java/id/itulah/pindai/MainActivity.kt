package id.itulah.pindai

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.MoveToInbox
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import id.itulah.pindai.core.Reader
import id.itulah.pindai.data.ConfigStore
import id.itulah.pindai.screens.*
import id.itulah.pindai.ui.theme.*

class MainActivity : ComponentActivity() {

    private val reader = Reader()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        SweepViewModel.appContext = applicationContext
        val store = ConfigStore(applicationContext)
        setContent { ItulahTheme { Shell(reader, store) } }
    }

    override fun onStop() {
        // The antenna is a radio, not a widget: leaving it sweeping behind a
        // locked screen drains the pack and keeps reading a room nobody is in.
        reader.stop()
        super.onStop()
    }

    override fun onDestroy() {
        reader.close()
        super.onDestroy()
    }
}

private enum class Tab(val label: String, val icon: ImageVector, val mode: Mode?) {
    SCAN("Scan", Icons.Outlined.QrCodeScanner, Mode.SCAN),
    PACKING("Packing", Icons.Outlined.Inventory2, Mode.PACKING),
    RECEIVING("Receive", Icons.Outlined.MoveToInbox, Mode.RECEIVING),
    COUNT("Count", Icons.Outlined.Checklist, Mode.COUNT),
    SETTINGS("Settings", Icons.Outlined.Settings, null),
}

@Composable
private fun Shell(reader: Reader, store: ConfigStore) {
    val vm: SweepViewModel = viewModel(factory = object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            SweepViewModel(reader, store) as T
    })
    val state by vm.state.collectAsStateWithLifecycle()
    var tab by remember { mutableStateOf(Tab.SCAN) }
    var previous by remember { mutableStateOf(Tab.SCAN) }
    // Sessions is a detour, not a destination: it opens over whatever mode you
    // were in and hands you straight back, so the rail keeps meaning "what am I
    // doing" rather than "where am I".
    var showSessions by remember { mutableStateOf(false) }

    LaunchedEffect(tab) {
        tab.mode?.let { vm.setMode(it) }
        if (tab == Tab.SETTINGS) vm.releaseReader()
    }

    Column(Modifier.fillMaxSize().background(Surface.canvas)) {
        Header(if (showSessions && tab != Tab.SETTINGS) "Sessions" else tab.label)
        Box(Modifier.weight(1f)) {
            // Direction-aware: moving right in the bar moves content left, so the
            // gesture and the picture agree about which way the app just went.
            val forward = tab.ordinal >= previous.ordinal
            AnimatedContent(
                targetState = tab to showSessions,
                transitionSpec = {
                    val width = 1
                    (slideInHorizontally(tween(220)) { if (forward) it / 6 else -it / 6 } +
                        fadeIn(tween(220)))
                        .togetherWith(
                            slideOutHorizontally(tween(160)) { if (forward) -it / 8 else it / 8 } +
                                fadeOut(tween(160)),
                        )
                },
                label = "tab",
            ) { (current, _) ->
                when {
                    current == Tab.SETTINGS -> SettingsScreen(store, onSaved = {})
                    showSessions -> SessionsScreen(vm, state) { showSessions = false }
                    else -> SweepScreen(vm, state) { showSessions = true }
                }
            }
        }
        BottomBar(tab) { next -> previous = tab; tab = next; showSessions = false }
    }
}

@Composable
private fun Header(title: String) {
    Column(Modifier.fillMaxWidth().background(Surface.chrome)
        .padding(horizontal = Space.lg, vertical = Space.md)) {
        Text(title, style = Type.anchor, color = Ink.text())
        Text("itulah · handheld", style = Type.micro, color = Ink.text(.60f))
    }
}

/**
 * The selected tab is a spring-driven pill that travels, not five pills that
 * blink. One moving object reads as one selection; five states swapping reads
 * as a flicker.
 */
@Composable
private fun BottomBar(selected: Tab, onSelect: (Tab) -> Unit) {
    val tabs = Tab.entries
    val configuration = LocalConfiguration.current
    val slot = (configuration.screenWidthDp.dp - Space.sm * 2) / tabs.size
    val motion = LocalMotion.current
    val offset by animateDpAsState(
        targetValue = Space.sm + slot * selected.ordinal,
        animationSpec = if (motion) {
            spring(dampingRatio = Spring.DampingRatioLowBouncy, stiffness = Spring.StiffnessMediumLow)
        } else tween(0),
        label = "indicator",
    )
    Box(Modifier.fillMaxWidth().background(Surface.chrome)) {
        Box(
            Modifier.padding(top = Space.sm).offset(x = offset)
                .width(slot).height(48.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Ink.fill(.08f)),
        )
        Row(Modifier.fillMaxWidth().padding(horizontal = Space.sm, vertical = Space.sm)) {
            tabs.forEach { entry ->
                val active = entry == selected
                Column(
                    Modifier.width(slot).height(48.dp)
                        .clickable { onSelect(entry) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Icon(entry.icon, contentDescription = entry.label,
                        modifier = Modifier.size(20.dp),
                        tint = if (active) Ink.text() else Ink.text(.60f))
                    Spacer(Modifier.height(2.dp))
                    Text(entry.label, style = Type.micro,
                        color = if (active) Ink.text() else Ink.text(.60f))
                }
            }
        }
    }
}
