package id.itulah.pindai

import android.os.Bundle
import android.os.SystemClock
import android.view.KeyEvent
import android.view.WindowManager
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
import androidx.compose.material.icons.outlined.Science
import androidx.compose.material.icons.outlined.Verified
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import id.itulah.pindai.core.Reader
import id.itulah.pindai.core.Trigger
import id.itulah.pindai.data.CatalogStore
import id.itulah.pindai.data.ConfigStore
import id.itulah.pindai.data.NodeRole
import id.itulah.pindai.screens.*
import id.itulah.pindai.ui.kit.Chip
import id.itulah.pindai.ui.theme.*
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {

    /** The process's one radio. See [sharedReader]. */
    private val reader = sharedReader
    // Reader shutdown can wait for a vendor UART call and must not hold the
    // activity's main thread. Reader operations are synchronized in Reader, so
    // this teardown cannot free the module while a ViewModel operation uses it.
    private val readerLifecycle = Executors.newSingleThreadExecutor { task ->
        Thread(task, "reader-lifecycle").apply { isDaemon = true }
    }
    private lateinit var store: ConfigStore

    /** Set by the sweep screen while it is on top; the trigger belongs to it. */
    @Volatile var onTrigger: (() -> Unit)? = null

    /** Set by Setelan while it is waiting for somebody to pull the trigger. */
    @Volatile var onLearnKey: ((Int) -> Unit)? = null

    private var lastTriggerAt = 0L

    /** The radio is open. The splash holds until this, see [Splash]. */
    var readerReady by mutableStateOf(false)
        private set

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        alive++
        SweepViewModel.appContext = applicationContext
        store = ConfigStore(applicationContext)
        val catalogStore = sharedCatalog ?: CatalogStore(applicationContext).also { sharedCatalog = it }

        // Open the UART before the first pixel, not after the first frame.
        //
        // The vendor's `init()` costs about a second on this module and it is
        // paid once — after it, a pull of the trigger reaches a live antenna in
        // twenty milliseconds. That second used to start only once Compose had
        // finished composing, which put it squarely in the window where an
        // operator opens the app and immediately squeezes. Started here it runs
        // beside the UI coming up, on a thread that is not the one drawing, and
        // is finished before anybody can reach the trigger.
        //
        // It opens the radio and does not read: a handheld that inventories the
        // office because somebody launched an app is worse than a slow one.
        readerLifecycle.execute {
            runCatching {
                // The same recipe is applied before the first open on every device.
                reader.useProductionRecipe()
                reader.init(applicationContext)
            }
            runOnUiThread { readerReady = true }
        }

        setContent {
            ItulahTheme {
                Box(Modifier.fillMaxSize()) {
                    Shell(this@MainActivity, reader, store, catalogStore)
                    Splash(ready = readerReady)
                }
            }
        }
    }

    /**
     * The trigger, intercepted before anything else can have it.
     *
     * `dispatchKeyEvent` rather than `onKeyDown`: a focused text field consumes
     * keys before the activity ever sees them, and the one place an operator is
     * most likely to pull the trigger by reflex is the screen they just typed a
     * session code into.
     *
     * Both DOWN and UP are swallowed for a key we claim. Letting the UP through
     * is how a keycode that some firmware also maps to a character arrives in
     * the field the operator was standing in.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val learner = onLearnKey
        if (learner != null && event.action == KeyEvent.ACTION_DOWN &&
            event.repeatCount == 0 && !Trigger.isReserved(event.keyCode)
        ) {
            learner(event.keyCode)
            return true
        }
        if (!Trigger.matches(event.keyCode, store.load().triggerKeyCode)) {
            return super.dispatchKeyEvent(event)
        }
        val now = SystemClock.uptimeMillis()
        if (Trigger.isFreshPull(event, lastTriggerAt, now)) {
            lastTriggerAt = now
            onTrigger?.invoke()
        }
        return true
    }

    override fun onDestroy() {
        alive--
        // Only a real exit lets go of the radio, and only the last one. A
        // configuration change destroys this activity while its view model —
        // and any sweep in it — carries on into the next, and closing the
        // module here closed it under that sweep. A relaunch can also create
        // the next activity before this one is destroyed, so a finishing
        // activity that is not the last one alive leaves the module open.
        if (isFinishing && alive == 0) readerLifecycle.execute { reader.close() }
        readerLifecycle.shutdown()
        // The database is not closed at all. It belongs to the process, the
        // view model can still be writing to it — a sweep's last record and
        // spool are allowed to finish as the activity goes — and SQLite gives
        // its handle back when the process ends.
        super.onDestroy()
    }

    private companion object {
        /**
         * One radio for the process, not one per activity.
         *
         * Each activity used to make its own Reader and close it in onDestroy,
         * while the view model — which outlives a configuration change — kept
         * the FIRST activity's. After a font change or a dark-mode switch the
         * screen and the sweep were driving two objects over one module, and
         * the old activity's close freed the module under a reader that still
         * believed it was open. The vendor's own instance is one per process
         * anyway; this makes ours match it.
         */
        val sharedReader = Reader()

        /** One database helper for the process, for the same reason. */
        var sharedCatalog: CatalogStore? = null

        /** How many of these activities are alive; see [onDestroy]. */
        var alive = 0
    }
}

private enum class Tab(val label: String, val icon: ImageVector, val mode: Mode?) {
    SCAN("Scan", Icons.Outlined.QrCodeScanner, Mode.SCAN),
    PACKING("Packing", Icons.Outlined.Inventory2, Mode.PACKING),
    RECEIVING("Receive", Icons.Outlined.MoveToInbox, Mode.RECEIVING),
    COUNT("Count", Icons.Outlined.Checklist, Mode.COUNT),
    // Verify koli (owner, 25 Oct 2026): the stores Packed sends. A Gudang's
    // job, so only a handheld at the Gudang shows it. See VerifyScreen.
    VERIFY("Verify", Icons.Outlined.Verified, Mode.VERIFY),
    // The bench gets a tab of its own, because an instrument that cannot be
    // reached is an instrument that does not exist. See LabScreen.
    LAB("Lab", Icons.Outlined.Science, null),
    SETTINGS("Settings", Icons.Outlined.Settings, null),
}

@Composable
private fun Shell(
    activity: MainActivity,
    reader: Reader,
    store: ConfigStore,
    catalog: CatalogStore,
) {
    val vm: SweepViewModel = viewModel(factory = object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            SweepViewModel(reader, store, catalog) as T
    })
    // The State, not its value.
    //
    // Read here, the value made the shell — app bar, tab bar, page transition —
    // recompose on every publish, five times a second while the radio is live,
    // and handed every screen a new object so nothing under them could skip.
    // The shell reads one derived flag below; each screen picks what it draws.
    // See [slice].
    val state = vm.state.collectAsStateWithLifecycle()
    val lifecycleOwner = LocalLifecycleOwner.current

    // The local catalogue is opened once, and scanning is available the moment
    // it is. Whether the node has a newer one is a separate question asked in
    // the background, and its answer changes a line of text.
    LaunchedEffect(Unit) { vm.openCatalogue() }
    var tab by remember { mutableStateOf(Tab.SCAN) }
    var previous by remember { mutableStateOf(Tab.SCAN) }
    // Sessions is a detour, not a destination: it opens over whatever mode you
    // were in and hands you straight back, so the bar keeps meaning "what am I
    // doing" rather than "where am I".
    var showSessions by remember { mutableStateOf(false) }
    val pushed = showSessions && tab != Tab.SETTINGS

    DisposableEffect(lifecycleOwner, vm) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                // The catalogue poll runs only while somebody can see it.
                Lifecycle.Event.ON_START -> vm.setForeground(true)
                Lifecycle.Event.ON_STOP -> {
                    vm.setForeground(false)
                    vm.releaseReader()
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // The screen stays on while the radio is live, or about to be.
    //
    // A sweep is latched — one pull starts it, the next stops it — so nothing
    // touches the screen in between, and the screen timeout was what ended it:
    // a dark screen stops this activity, and a stopped activity stops the sweep
    // (above). (The vendor SDK does not let go of the module at screen-off in
    // this build: its screen receiver never registers. See Reader.) Cleared the
    // moment the sweep is over, so a handheld left on a shelf still sleeps.
    //
    // The only part of the state the shell reads, and it changes twice a sweep.
    val live = state.slice { it.sweeping || it.starting }.value
    DisposableEffect(live) {
        if (!live) return@DisposableEffect onDispose {}
        val window = activity.window
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose { window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }

    // Which node this is decides whether Verify is offered. Asked on every tab
    // change because Setelan can repoint the handheld; the answer is cached
    // per node, so asking again costs nothing when nothing moved.
    val atGudang = state.slice { it.nodeRole == NodeRole.DC }.value

    LaunchedEffect(tab) {
        vm.resolveNodeRole()
        tab.mode?.let { mode ->
            // A refused switch puts the bar back on the job that is still open.
            // A delivery half swept keeps its sweep across pulls, so "finish
            // this first" is now a real answer — and a lit squircle for a job
            // the screen is not showing would contradict it.
            if (!vm.setMode(mode)) {
                Tab.entries.firstOrNull { it.mode == vm.state.value.mode }?.let { tab = it }
            }
        }
        if (tab == Tab.SETTINGS) vm.releaseReader()
    }

    // The trigger belongs to whichever sweep mode is on top, and to nothing
    // else. In Setelan it is a key being taught, and over the session list it
    // would start a sweep the operator cannot see.
    val armed = tab.mode != null && !showSessions
    DisposableEffect(armed, vm) {
        activity.onTrigger = if (armed) ({ vm.toggleSweep() }) else null
        onDispose { activity.onTrigger = null }
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
                        current == Tab.LAB && BuildConfig.BENCH -> LabScreen(vm, state)
                        current == Tab.SETTINGS ->
                            SettingsScreen(
                                activity, store, vm, state,
                                // Pointing a handheld at a different node is
                                // exactly when its catalogue is wrong — and when
                                // evidence the old node refused may be accepted
                                // at last — so both are checked on Save rather
                                // than left for the next launch to notice.
                                onSaved = { vm.settingsSaved() },
                            )
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
        // Nothing floats over any sweep screen.
        //
        // The trigger is a physical button; a count and a product total on the
        // glass duplicate what the screen above already says, and a Finish
        // button is a step that already happened — the sweep records itself the
        // moment the trigger is released.
        //
        // Packing, receiving and counting DO have a step after the sweep, and
        // they have lost their control with this. That action belongs on the
        // sweep's own result, where it can say what it is about; putting it
        // back as furniture over every screen is not the answer.

        TabBar(tab, atGudang, Modifier.align(Alignment.BottomCenter)) { next ->
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
private fun TabBar(
    selected: Tab,
    atGudang: Boolean,
    modifier: Modifier = Modifier,
    onSelect: (Tab) -> Unit,
) {
    // The Lab is a bench instrument: it retunes the radio mid-shift and can
    // make foreign tags count as stock. It does not appear on a shop floor.
    // Nor does Verify, which reads koli before they leave the Gudang.
    val tabs = Tab.entries.filter {
        (BuildConfig.BENCH || it != Tab.LAB) && (atGudang || it != Tab.VERIFY || it == selected)
    }
    val width = LocalConfiguration.current.screenWidthDp.dp
    val size = minOf(
        TabSquircle,
        (width - Space.xxl - TabGap * (tabs.size - 1)) / tabs.size,
    )
    val shape = RoundedCornerShape(size / 3)
    Row(
        modifier.fillMaxWidth().padding(bottom = 8.dp),
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
