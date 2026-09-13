import { useState } from "react"

import { useIdleLock, LockScreen } from "@/lock"
import { CustomerScreen } from "@/screens/customer"
import { LoginScreen, SetupScreen } from "@/screens/login"
import { ReturnScreen, VoidScreen } from "@/screens/returns"
import { ShiftScreen } from "@/screens/shift"
import { useSession } from "@/session"
import { Till, Topbar, type Where } from "@/till"

/// The terminal, and the three decisions it makes before anything else.
///
/// Five destinations and a `when` over a union rather than a router: a cashier
/// is on the counter, and everything else is somewhere they went and are coming
/// straight back from. A back stack that could strand somebody two screens from
/// the scan field would be worse than no back stack at all.
///
/// **Am I the shopper's screen?** Decided first and by the URL, because that
/// window must never be able to become a till. It renders one thing and holds
/// no session.
///
/// **Does the node know who is standing here?** Nothing is reachable before it
/// does — not a style choice: the edge refuses every call without a session, so
/// a screen shown before sign-in could only ever display a wall of refusals.
///
/// **Has the counter been left alone?** The lock is a sibling of the till and
/// not a replacement for it, so the basket is still there when somebody comes
/// back. A lock that emptied the counter is a lock cashiers learn not to use.
export function App() {
  // The second window opens at `?display`, which is a thing about the window
  // and not about the session — so it is read before the session is consulted
  // and never inside it.
  if (new URLSearchParams(window.location.search).has("display")) {
    return <CustomerScreen />
  }
  return <Counter />
}

function Counter() {
  const session = useSession()
  const [where, setWhere] = useState<Where>("sale")
  // Ten minutes: long enough to serve somebody slow, short enough that a till
  // left for a cigarette is not an open till.
  const idle = useIdleLock(10)

  if (!session.ready) {
    return (
      <div id="app" data-screen="sale">
        <Topbar />
        <div className="empty">
          <p>Menghubungi node toko…</p>
        </div>
      </div>
    )
  }

  // Pointing this terminal at a node is allowed before signing in: a till that
  // could not be repointed until it had signed in would be unrecoverable the
  // moment it was pointed at the wrong shop.
  if (where === "setup") {
    return <SetupScreen onDone={() => setWhere("sale")} />
  }

  if (session.me === null) {
    return (
      <LoginScreen
        onSignedIn={() => setWhere("sale")}
        onSetup={() => setWhere("setup")}
      />
    )
  }

  const actorId = session.me.username

  const screen =
    where === "shift" ? (
      <ShiftScreen
        actorId={actorId}
        terminalId={session.terminalId}
        onBack={() => setWhere("sale")}
      />
    ) : where === "return" ? (
      <ReturnScreen actorId={actorId} onBack={() => setWhere("sale")} />
    ) : where === "void" ? (
      <VoidScreen actorId={actorId} onBack={() => setWhere("sale")} />
    ) : (
      <Till
        actorId={actorId}
        terminalId={session.terminalId}
        where={where}
        onGo={setWhere}
        onSignOut={() => {
          void session.signOut()
          setWhere("sale")
        }}
      />
    )

  return (
    <>
      {screen}
      {idle.warningIn !== null && !idle.locked && (
        <div id="toast" role="status">
          Layar terkunci dalam {idle.warningIn} detik
          <button
            className="btn ghost"
            style={{ marginLeft: 10, minHeight: 22, padding: "0 8px" }}
            onClick={idle.stayAwake}
          >
            Saya di sini
          </button>
        </div>
      )}
      {idle.locked && (
        <LockScreen
          actorId={actorId}
          onUnlock={async (username, password) => {
            // Unlocking is the node's decision, not this screen's: the same
            // sign-in the counter was opened with. Anything weaker would make
            // the lock a curtain rather than a door.
            const accepted = await session.signIn(username, password)
            if (accepted) idle.stayAwake()
            return accepted
          }}
        />
      )}
    </>
  )
}
