import { useCallback, useEffect, useState } from "react"

import { myShifts } from "@/api"
import { isWeb } from "@/edition"
import { useIdleLock, LockScreen } from "@/lock"
import { CustomerScreen } from "@/screens/customer"
import { JoinScreen } from "@/screens/join"
import { WaitingTillsScreen } from "@/screens/joins"
import { LoginScreen, SetupScreen } from "@/screens/login"
import { PeripheralsScreen } from "@/screens/peripherals"
import { RedeemScreen } from "@/screens/redeem"
import { ReturnScreen, VoidScreen } from "@/screens/returns"
import { ShiftGate, ShiftScreen } from "@/screens/shift"
import { holdSeat, seatNow, type Seat } from "@/seat"
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
/// **Whose drawer is this?** A till is a seat, picked by whoever signs in
/// (`ShiftGate`), and the seat can be taken by somebody else at any time. The
/// counter therefore asks the node every half minute whether the shift it is
/// selling on is still the person's own, and the moment it is not, it stops
/// selling and puts the person back at the picker — with the basket still under
/// it, since that is this machine's and not the seat's.
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
  // Whether this sign-in has been past the shift check. A counter opens with a
  // drawer: straight after signing in, a terminal with no open shift asks for
  // the float first (`ShiftGate`), then shows the till.
  const [shiftChecked, setShiftChecked] = useState(false)
  // Non-null while the person has lost the seat they were selling at: the
  // sentence the picker opens with. The till stays mounted underneath, hidden,
  // so the basket is waiting when they hold a seat again.
  const [lost, setLost] = useState<string | null>(null)
  const shiftReady = useCallback((seat: Seat) => {
    holdSeat(seat)
    setLost(null)
    setShiftChecked(true)
  }, [])

  // Nobody signed in means nobody holds a seat — including when the session
  // ends some way other than the sign-out button, which would otherwise let the
  // next person straight past the gate on the last one's drawer.
  const signedIn = session.me !== null
  useEffect(() => {
    if (!signedIn) {
      holdSeat(null)
      setShiftChecked(false)
      setLost(null)
    }
  }, [signedIn])

  const seatLost = useCallback((by: string | null) => {
    const seat = seatNow()
    if (seat === null) return
    holdSeat(null)
    setLost(
      `${seat.label} sudah diambil alih${by !== null ? ` oleh ${by}` : ""} — pilih kasir lagi.`,
    )
    setWhere("sale")
  }, [])

  // Taken-over detection. "Cannot tell" is not "taken": a node that does not
  // answer leaves the till selling, because the outbox exists for exactly that
  // and a wifi blip must not throw a cashier off their drawer.
  const watching = shiftChecked && signedIn
  useEffect(() => {
    if (!watching) return
    const timer = window.setInterval(() => {
      const seat = seatNow()
      if (seat === null) return
      void myShifts().then((reply) => {
        if (!reply.ok) return
        const open = reply.body.open
        if (open !== null && open.shift_id === seat.shift_id) return
        // Closed from the shift screen in the meantime: not taken, just done.
        if (seatNow()?.shift_id !== seat.shift_id) return
        const by =
          reply.body.uncounted.find((one) => one.shift_id === seat.shift_id)
            ?.taken_over_by ?? null
        seatLost(by)
      })
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [watching, seatLost])

  if (!session.ready) {
    return (
      <div id="app" data-screen="sale">
        <Topbar />
        <div className="empty">
          <p>Menghubungkan…</p>
        </div>
      </div>
    )
  }

  // Pointing this terminal at a node is allowed before signing in: a till that
  // could not be repointed until it had signed in would be unrecoverable the
  // moment it was pointed at the wrong shop. The same goes for what is plugged
  // into it — the person installing a counter is rarely a person with an
  // account at that shop yet.
  //
  // Joining is the first thing a new till does, and it needs nobody signed in:
  // the till asks, and a supervisor answers from a till that already belongs.
  if (session.me === null) {
    if (where === "setup") {
      return (
        <SetupScreen
          onDone={() => setWhere("sale")}
          // Peripherals and joining are shell-only — see `edition.ts` — so a
          // web till never gets a way to reach either screen in the first
          // place.
          onPeripherals={isWeb ? undefined : () => setWhere("peripherals")}
          onJoin={isWeb ? undefined : () => setWhere("join")}
        />
      )
    }
    if (where === "peripherals") {
      return <PeripheralsScreen onBack={() => setWhere("setup")} />
    }
    if (where === "join") {
      return (
        <JoinScreen
          onDone={() => setWhere("sale")}
          onPeripherals={() => setWhere("peripherals")}
        />
      )
    }
  }

  if (session.me === null) {
    return (
      <LoginScreen
        onSignedIn={() => setWhere("sale")}
        onSetup={() => setWhere("setup")}
        onJoin={isWeb ? undefined : () => setWhere("join")}
      />
    )
  }

  const actorId = session.me.username

  const gate = (
    <ShiftGate
      actorId={actorId}
      notice={lost}
      onReady={shiftReady}
      onSignOut={() => {
        void session.signOut()
        setWhere("sale")
      }}
    />
  )

  if (!shiftChecked) return gate

  const screen =
    where === "setup" ? (
      <SetupScreen
        onDone={() => setWhere("sale")}
        onPeripherals={isWeb ? undefined : () => setWhere("peripherals")}
        onJoin={isWeb ? undefined : () => setWhere("join")}
        onJoins={isWeb ? undefined : () => setWhere("joins")}
      />
    ) : where === "peripherals" ? (
      <PeripheralsScreen onBack={() => setWhere("setup")} />
    ) : where === "joins" ? (
      <WaitingTillsScreen onBack={() => setWhere("setup")} />
    ) : where === "join" ? (
      <JoinScreen
        onDone={() => setWhere("sale")}
        onPeripherals={() => setWhere("peripherals")}
      />
    ) : where === "sale" || where === "payment" ? null : where === "shift" ? (
      <ShiftScreen
        actorId={actorId}
        onBack={() => setWhere("sale")}
        // The shift is over the moment the node says so; the person stays on
        // the count until they choose to go, and then it is the picker they
        // return to.
        onClosed={() => holdSeat(null)}
        onLeave={() => {
          setShiftChecked(false)
          setWhere("sale")
        }}
      />
    ) : where === "return" ? (
      <ReturnScreen actorId={actorId} onBack={() => setWhere("sale")} />
    ) : where === "void" ? (
      <VoidScreen actorId={actorId} onBack={() => setWhere("sale")} />
    ) : where === "redeem" ? (
      <RedeemScreen actorId={actorId} onBack={() => setWhere("sale")} />
    ) : null

  return (
    <>
      {/* Keep the counter mounted while a cashier opens a utility screen. Its
          basket, coupon and identified member belong to this sale and must be
          waiting when the cashier returns. `display: contents` adds no layout
          wrapper while the till is visible; when hidden, it cannot steal focus
          or receive input from the utility screen. */}
      <div
        style={{
          display:
            lost === null && (where === "sale" || where === "payment")
              ? "contents"
              : "none",
        }}
      >
        <Till
          actorId={actorId}
          terminalId={session.terminalId}
          where={where}
          onGo={setWhere}
          onSignOut={() => {
            void session.signOut()
            setShiftChecked(false)
            setWhere("sale")
          }}
          onLock={idle.lock}
          onSeatLost={seatLost}
        />
      </div>
      {lost !== null ? gate : screen}
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
          // A PIN is claimed over the pairing channel (`claimPin` →
          // `signedEdge`), and only the desktop shell holds the secret that
          // signs it. Web leaves this undefined and `LockScreen` draws no pad.
          onUnlockPin={
            isWeb
              ? undefined
              : async (username, pin) => {
                  // The same rule, by the staging road: the node checks the
                  // PIN itself and issues the same session, and the shell
                  // relays nothing but its yes or no.
                  const refusal = await session.signInWithPin(username, pin)
                  if (refusal !== null) return false
                  idle.stayAwake()
                  return true
                }
          }
        />
      )}
    </>
  )
}
