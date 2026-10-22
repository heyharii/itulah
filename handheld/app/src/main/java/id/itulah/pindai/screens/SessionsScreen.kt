package id.itulah.pindai.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import id.itulah.pindai.ui.kit.*
import id.itulah.pindai.ui.theme.*

/** Clear of the tab squircles and the float they sit on. */
private val FootClearance = 120.dp

/**
 * Who is counting what, right now.
 *
 * A session is not created by anybody — it begins existing the moment a reader
 * files under its name. So this is a picture of work in progress, not a
 * registry, and that is exactly what somebody arriving to help needs before
 * deciding whether to join anything at all. Working alone stays the default;
 * joining is a deliberate act with its own screen.
 */
@Composable
fun SessionsScreen(vm: SweepViewModel, state: State<SweepState>, onBack: () -> Unit) {
    // The three things this screen shows, not the whole state: the catalogue
    // poll and the outbox keep publishing behind it.
    val view by state.slice { SessionsView(it.sessionCode, it.sessions, it.sessionsLoaded) }
    val current = view
    var chosen by remember { mutableStateOf<SessionBrief?>(null) }
    LaunchedEffect(Unit) { vm.loadSessions() }

    val picked = chosen
    if (picked != null) {
        SessionDetail(
            brief = picked,
            joined = picked.code == current.joined,
            onJoin = { vm.setSessionCode(picked.code); chosen = null; onBack() },
            onBack = { chosen = null },
        )
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().background(Surface.canvas),
        contentPadding = PaddingValues(
            start = Space.lg, end = Space.lg, top = Space.sm, bottom = FootClearance,
        ),
        verticalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        item {
            Text(
                "Sessions are named, not owned. Several handhelds filing under " +
                    "one name are one count — the same tag seen twice is still " +
                    "one garment.",
                style = Type.cell, color = Ink.body,
                modifier = Modifier.padding(bottom = Space.sm),
            )
        }

        val joinedCode = current.joined
        if (joinedCode.isNotBlank()) {
            item {
                HubCard {
                    SectionLabel("You are in")
                    Spacer(Modifier.height(Space.xs))
                    Text(joinedCode, style = Type.hero, color = Ink.ink)
                    Spacer(Modifier.height(Space.md))
                    QuietButton("Leave and work alone",
                        modifier = Modifier.fillMaxWidth(),
                        onClick = { vm.setSessionCode("") })
                }
            }
        }

        item {
            SectionLabel("Active on this node", Modifier.padding(top = Space.sm))
        }

        val sessions = current.sessions
        if (sessions.isEmpty()) {
            val loaded = current.loaded
            item {
                Text(
                    if (loaded) "Nothing being counted right now."
                    else "Loading…",
                    style = Type.cell, color = Ink.body,
                )
            }
        } else {
            items(sessions.size, key = { sessions[it].code }) { index ->
                val session = sessions[index]
                SessionListRow(session, joined = session.code == joinedCode) {
                    chosen = session
                }
            }
        }

        item {
            QuietButton("Start a new session",
                modifier = Modifier.fillMaxWidth().padding(top = Space.sm),
                onClick = vm::newSessionCode)
        }
    }
}

/** What the session list draws: the session this handheld is in, and the rest. */
private data class SessionsView(
    /** The session code this handheld files under; blank when working alone. */
    val joined: String,
    val sessions: List<SessionBrief>,
    val loaded: Boolean,
)

@Composable
private fun SessionListRow(session: SessionBrief, joined: Boolean, onClick: () -> Unit) {
    HubCard(
        onPress = onClick,
        padding = PaddingValues(horizontal = Space.lg, vertical = Space.md),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(session.code, style = Type.cardTitle, color = Ink.ink)
                Text(
                    "${session.tagCount} tags · ${session.deviceCount} readers",
                    style = Type.meta, color = Ink.mute,
                )
            }
            if (joined) {
                Pill(Tone.ACCENT, "joined")
                Spacer(Modifier.width(Space.sm))
            }
            Icon(Icons.Outlined.ChevronRight, contentDescription = null,
                modifier = Modifier.size(18.dp), tint = Ink.faint)
        }
    }
}

/** One session, with room to show what joining would mean. */
@Composable
private fun SessionDetail(
    brief: SessionBrief,
    joined: Boolean,
    onJoin: () -> Unit,
    onBack: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().background(Surface.canvas)
            .padding(start = Space.lg, end = Space.lg, top = Space.sm, bottom = FootClearance),
        verticalArrangement = Arrangement.spacedBy(Space.md),
    ) {
        HubCard {
            SectionLabel("Session")
            Spacer(Modifier.height(Space.xs))
            Text(brief.code, style = Type.hero, color = Ink.ink)
            Spacer(Modifier.height(Space.lg))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column {
                    // Two figures side by side, so neither is the screen's one
                    // number: `kpi`, not `total`. A screen with two 32 dp
                    // numbers on it has no primary number at all.
                    SectionLabel("Tags")
                    RollingNumber(brief.tagCount, Type.kpi, Ink.ink)
                }
                Column(horizontalAlignment = Alignment.End) {
                    SectionLabel("Readers")
                    RollingNumber(brief.deviceCount, Type.kpi, Ink.ink)
                }
            }
            brief.lastSeenAt?.let {
                Spacer(Modifier.height(Space.sm))
                Text("last filing $it", style = Type.meta, color = Ink.mute)
            }
        }

        Text(
            "Joining files this handheld's sweeps under this name. Nothing already " +
                "counted is transferred, and nothing is taken over — you simply " +
                "add to the same total.",
            style = Type.cell, color = Ink.body,
        )

        Spacer(Modifier.weight(1f))
        if (joined) {
            Text("Already joined", style = Type.cell, color = Ink.mute)
        } else {
            PrimaryButton("Join ${brief.code}", onClick = onJoin,
                modifier = Modifier.fillMaxWidth(), big = true)
        }
        QuietButton("Back", onClick = onBack, modifier = Modifier.fillMaxWidth())
    }
}
