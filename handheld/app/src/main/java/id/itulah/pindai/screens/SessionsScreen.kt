package id.itulah.pindai.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
fun SessionsScreen(vm: SweepViewModel, state: SweepState, onBack: () -> Unit) {
    var chosen by remember { mutableStateOf<SessionBrief?>(null) }
    LaunchedEffect(Unit) { vm.loadSessions() }

    val picked = chosen
    if (picked != null) {
        SessionDetail(
            brief = picked,
            joined = picked.code == state.sessionCode,
            onJoin = { vm.setSessionCode(picked.code); chosen = null; onBack() },
            onBack = { chosen = null },
        )
        return
    }

    Column(Modifier.fillMaxSize().background(Surface.canvas)) {
        LazyColumn(
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(Space.lg),
            verticalArrangement = Arrangement.spacedBy(Space.sm),
        ) {
            item {
                Text(
                    "Sessions are named, not owned. Several handhelds filing under " +
                        "one name are one count — the same tag seen twice is still " +
                        "one garment.",
                    style = Type.caption, color = Ink.text(.74f),
                )
                Spacer(Modifier.height(Space.sm))
            }

            if (state.sessionCode.isNotBlank()) {
                item {
                    PlanetCard {
                        SectionLabel("You are in")
                        Spacer(Modifier.height(Space.xs))
                        Text(state.sessionCode, style = Type.anchor, color = Ink.text())
                        Spacer(Modifier.height(Space.sm))
                        QuietButton("Leave and work alone",
                            onClick = { vm.setSessionCode("") })
                    }
                    Spacer(Modifier.height(Space.sm))
                }
            }

            item { SectionLabel("Active on this node") }

            if (state.sessions.isEmpty()) {
                item {
                    Text(
                        if (state.sessionsLoaded) "Nothing being counted right now."
                        else "Loading…",
                        style = Type.caption, color = Ink.text(.60f),
                    )
                }
            } else {
                items(state.sessions.size, key = { state.sessions[it].code }) { index ->
                    val session = state.sessions[index]
                    SessionListRow(session, joined = session.code == state.sessionCode) {
                        chosen = session
                    }
                }
            }

            item {
                Spacer(Modifier.height(Space.sm))
                QuietButton("Start a new session", onClick = vm::newSessionCode)
            }
        }
    }
}

@Composable
private fun SessionListRow(session: SessionBrief, joined: Boolean, onClick: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = CardShape,
        color = Surface.card,
        border = BorderStroke(1.dp, Ink.border(.04f)),
    ) {
        Row(
            Modifier.padding(horizontal = Space.lg, vertical = Space.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(session.code, style = Type.body, color = Ink.text())
                Text(
                    "${session.tagCount} tags · ${session.deviceCount} readers",
                    style = Type.micro, color = Ink.text(.60f),
                )
            }
            if (joined) StatusDot(Blue, "joined")
            Spacer(Modifier.width(Space.sm))
            Icon(Icons.Outlined.ChevronRight, contentDescription = null,
                modifier = Modifier.size(18.dp), tint = Ink.text(.36f))
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
    Column(Modifier.fillMaxSize().background(Surface.canvas).padding(Space.lg),
        verticalArrangement = Arrangement.spacedBy(Space.md)) {
        PlanetCard {
            SectionLabel("Session")
            Spacer(Modifier.height(Space.xs))
            Text(brief.code, style = Type.anchor, color = Ink.text())
            Spacer(Modifier.height(Space.md))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column {
                    SectionLabel("Tags")
                    RollingNumber(brief.tagCount, Type.hero, Ink.text())
                }
                Column(horizontalAlignment = Alignment.End) {
                    SectionLabel("Readers")
                    RollingNumber(brief.deviceCount, Type.hero, Ink.text())
                }
            }
            brief.lastSeenAt?.let {
                Spacer(Modifier.height(Space.sm))
                Text("last filing $it", style = Type.micro, color = Ink.text(.60f))
            }
        }

        Text(
            "Joining files this handheld's sweeps under this name. Nothing already " +
                "counted is transferred, and nothing is taken over — you simply " +
                "add to the same total.",
            style = Type.caption, color = Ink.text(.74f),
        )

        Spacer(Modifier.weight(1f))
        if (joined) {
            Text("Already joined", style = Type.body, color = Ink.text(.60f))
        } else {
            PrimaryButton("Join ${brief.code}", onClick = onJoin)
        }
        QuietButton("Back", onClick = onBack)
    }
}
