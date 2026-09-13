package id.itulah.pindai

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import id.itulah.pindai.core.Reader
import id.itulah.pindai.data.ConfigStore
import id.itulah.pindai.screens.*
import id.itulah.pindai.ui.kit.Chip
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
    // were in and hands you straight back, so the bar keeps meaning "what am I
    // doing" rather than "where am I".
    var showSessions by remember { mutableStateOf(false) }
    val pushed = showSessions && tab != Tab.SETTINGS

    LaunchedEffect(tab) {
        tab.mode?.let { vm.setMode(it) }
        if (tab == Tab.SETTINGS) vm.releaseReader()
    }

    // One layer, not two rows: the tab bar FLOATS over the content rather than
    // standing under it, and the content runs to the bottom of the glass and
    // fades out beneath it.
    Box(Modifier.fillMaxSize().background(Surface.canvas)) {
        Column(Modifier.fillMaxSize()) {
            AppBar(
                title = if (pushed) "Sessions" else tab.label,
                onBack = if (pushed) ({ showSessions = false }) else null,
            )
            Box(Modifier.weight(1f)) {
                // Direction-aware: moving right in the bar moves content left, so
                // the gesture and the picture agree about which way the app went.
                val forward = tab.ordinal >= previous.ordinal
                AnimatedContent(
                    targetState = tab to showSessions,
                    transitionSpec = {
                        (slideInHorizontally(
                            tween(Motion.page, easing = Motion.easeOut),
                        ) { if (forward) it / 6 else -it / 6 } +
                            fadeIn(tween(Motion.page, easing = Motion.easeOut)))
                            .togetherWith(
                                slideOutHorizontally(
                                    tween(Motion.pop, easing = Motion.easeOut),
                                ) { if (forward) -it / 8 else it / 8 } +
                                    fadeOut(tween(Motion.pop)),
                            )
                    },
                    label = "tab",
                ) { (current, _) ->
                    when {
                        current == Tab.SETTINGS -> SettingsScreen(store, reader, onSaved = {})
                        showSessions -> SessionsScreen(vm, state) { showSessions = false }
                        else -> SweepScreen(vm, state) { showSessions = true }
                    }
                }
            }
        }
        // The list fades out beneath the bar rather than being cut off by it: a
        // last card clipping under the squircles is a scroll cue, and the
        // gradient is what makes it read as one instead of as a bug.
        Box(
            Modifier.fillMaxWidth().height(110.dp).align(Alignment.BottomCenter)
                .background(
                    Brush.verticalGradient(
                        0f to Color.Transparent, 0.7f to Surface.canvas,
                    ),
                ),
        )
        // The one action lives in the shell's foot rather than in the screen,
        // for the same reason the tab bar does: it has to sit ON the fade, and
        // it has to stay still while the four sweep modes slide past behind it.
        if (tab.mode != null && !showSessions) {
            SweepAction(vm, state, Modifier.align(Alignment.BottomCenter))
        }
        TabBar(tab, Modifier.align(Alignment.BottomCenter)) { next ->
            previous = tab; tab = next; showSessions = false
        }
    }
}

/**
 * The app bar: three zones, and no rule under it.
 *
 * Borderless is the part that is easy to get wrong. Content is separated from
 * this bar by whitespace, the way everything in this system is separated, and a
 * line here would be the single most visible way the screen stopped being Cloud
 * Hub. The title is centred at 17/600 and names where you are — which is what
 * pays for the tab bar below carrying no words.
 */
@Composable
private fun AppBar(title: String, onBack: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().background(Surface.canvas).height(60.dp)
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.width(Tap.floor), contentAlignment = Alignment.CenterStart) {
            onBack?.let {
                Chip(onClick = it) {
                    Icon(Icons.Outlined.ArrowBack, contentDescription = "Back",
                        modifier = Modifier.size(18.dp), tint = Ink.lineIco)
                }
            }
        }
        Text(
            title, style = Type.title, color = Ink.ink, textAlign = TextAlign.Center,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(Tap.floor))
    }
}

private val TabSquircle = 54.dp
private val TabGap = 14.dp

/**
 * The floating squircle tab bar.
 *
 * **There is no containing bar.** These are separate squircles floating over the
 * content with 14 dp of nothing between them; a pill, a card or a background
 * behind the row would be a different design system. The live one is a solid
 * accent squircle with a white glyph — the console's selection treatment
 * travelling to a phone — and it is the one glow this system allows.
 *
 * No labels under them. Five destinations named by icon is what the reference
 * draws, a word under each would make the row a bar again, and the app bar above
 * has already said which one you are in.
 *
 * The squircle shrinks on a narrow device rather than the row overflowing: five
 * of them at 54 need 326 dp and this hardware is 360, which is enough until a
 * handheld with a smaller panel turns up.
 */
@Composable
private fun TabBar(selected: Tab, modifier: Modifier = Modifier, onSelect: (Tab) -> Unit) {
    val tabs = Tab.entries
    val width = LocalConfiguration.current.screenWidthDp.dp
    val size = minOf(
        TabSquircle,
        (width - Space.xxl - TabGap * (tabs.size - 1)) / tabs.size,
    )
    val shape = RoundedCornerShape(size / 3)
    Row(
        modifier.fillMaxWidth().padding(bottom = 18.dp),
        horizontalArrangement = Arrangement.spacedBy(TabGap, Alignment.CenterHorizontally),
    ) {
        tabs.forEach { entry ->
            val on = entry == selected
            val source = remember { MutableInteractionSource() }
            Box(
                Modifier
                    .size(size)
                    .then(
                        if (on) {
                            Modifier.shadow(
                                8.dp, shape,
                                ambientColor = Accent, spotColor = Accent,
                            )
                        } else Modifier,
                    )
                    .background(if (on) Accent else Surface.soft3.copy(alpha = .9f), shape)
                    .clickable(interactionSource = source, indication = null) { onSelect(entry) },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    entry.icon, contentDescription = entry.label,
                    modifier = Modifier.size(21.dp),
                    tint = if (on) Surface.onDark else Ink.lineIco,
                )
            }
        }
    }
}
