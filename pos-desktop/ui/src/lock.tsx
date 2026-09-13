/// Walking away from an open counter.
///
/// # Why this locks the screen and does not sign anybody out
///
/// A cashier who steps into the stockroom leaves a basket behind, and often a
/// member number and half a payment with it. Signing them out would throw all
/// of that away, and the second time it happened they would simply stop
/// locking — which leaves an open till in a shop where anybody can sell under
/// somebody else's name. So the session stays, the token stays, the basket
/// stays, and coming back costs one password.
///
/// That is also why `LockScreen` is an overlay and not a screen. It is drawn
/// OVER the till rather than instead of it, so the counter behind is never
/// unmounted and there is no state to restore afterwards — nothing was lost to
/// restore. The reference this was written against (`pos-electron`) puts a
/// "Sesi Baru" button next to the PIN field which resets the transaction; that
/// button is deliberately missing here. A lock that can throw away a sale is a
/// lock a cashier learns to avoid.
///
/// # Why it warns before it locks
///
/// A till that blanks mid-sale, with a customer standing there and cash in
/// hand, is worse than a till that never locks at all. So the last thirty
/// seconds of the window are spent saying so out loud: `warningIn` counts them
/// down for whoever is drawing them, and any real activity calls it off.

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"

import { useSession } from "@/session"

/// How much notice the counter gets. Long enough to reach the mouse from the
/// far end of a counter, short enough that it is not a second timeout in its
/// own right.
const WARNING_SECONDS = 30

/// What counts as somebody being here.
///
/// Typed as plain strings rather than `keyof WindowEventMap` because they are
/// only ever fed to `addEventListener`, and the narrower type buys nothing.
const ACTIVITY: readonly string[] = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
  // Not every scan arrives as keystrokes. A reader that hands the field its
  // value, or a wedge burst the WebView delivers as one composition, fires
  // `input` and no `keydown` at all — and a tag landing in the basket is the
  // most certain evidence there is that somebody is standing at this counter.
  "input",
]

export type IdleLock = {
  /// True once the counter has been left alone for the whole window, or once
  /// `lock()` was pressed. Nothing clears it but `stayAwake()`.
  readonly locked: boolean
  /// Seconds left before locking, while the warning is up; null the rest of
  /// the time, and null while locked — there is nothing left to count down to.
  readonly warningIn: number | null
  /// Lock now, without waiting out the clock. What a "Kunci layar" button
  /// calls, and what a cashier presses on their way out.
  readonly lock: () => void
  /// "Somebody is here": drops the warning, clears the lock, restarts the
  /// clock.
  ///
  /// It is the only way back from `locked`, and `LockScreen` deliberately
  /// cannot reach it. The shell calls it after the node has accepted a
  /// password, which is what keeps "unlocked" a thing the node decided rather
  /// than a thing a keypress did.
  readonly stayAwake: () => void
}

/// Count idle time, warn, then lock.
///
/// `minutes` is the whole window, warning included: at five minutes the
/// warning goes up at four and a half. Zero or less means this counter does
/// not lock itself at all — a till that is never out of sight is allowed to
/// say so — and `lock()` still works, because locking on purpose and locking
/// on a timer are not the same decision.
export function useIdleLock(minutes: number): IdleLock {
  const [locked, setLocked] = useState(false)
  const [warningIn, setWarningIn] = useState<number | null>(null)
  const lastSeen = useRef(Date.now())

  const idleMs = minutes > 0 ? minutes * 60_000 : 0
  // A window of under a minute would otherwise start its warning before its
  // clock, so the warning never takes more than half of what there is.
  const warnMs = Math.min(WARNING_SECONDS * 1000, idleMs / 2)

  const lock = useCallback(() => {
    setWarningIn(null)
    setLocked(true)
  }, [])

  const stayAwake = useCallback(() => {
    lastSeen.current = Date.now()
    setWarningIn(null)
    setLocked(false)
  }, [])

  // Activity only ever writes down a time. It cannot clear `locked`, and that
  // is the whole point: with the lock up, a hand on the mouse or a tag on the
  // reader must not open the counter — only a password may.
  //
  // Captured at the window so that a screen swallowing its own keystrokes
  // cannot also swallow the evidence that somebody is at the counter, and
  // passive so that pointermove costs nothing to listen to.
  useEffect(() => {
    const seen = () => {
      lastSeen.current = Date.now()
    }
    for (const kind of ACTIVITY) {
      window.addEventListener(kind, seen, { passive: true, capture: true })
    }
    return () => {
      for (const kind of ACTIVITY) {
        window.removeEventListener(kind, seen, { capture: true })
      }
    }
  }, [])

  // One tick a second that reads the clock, rather than a pair of timers
  // restarted on every event.
  //
  // A counter throws off thousands of pointermoves a minute and rescheduling
  // timeouts on each of them is work for nothing. Reading `Date.now()` also
  // survives what timers do not: a lid closed for an hour suspends and
  // throttles intervals, and a till that woke up and granted itself a fresh
  // five minutes would be a till that was left open all night.
  useEffect(() => {
    if (idleMs <= 0 || locked) {
      setWarningIn(null)
      return
    }
    const tick = () => {
      const left = idleMs - (Date.now() - lastSeen.current)
      if (left <= 0) {
        setWarningIn(null)
        setLocked(true)
        return
      }
      setWarningIn(left <= warnMs ? Math.ceil(left / 1000) : null)
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [idleMs, warnMs, locked])

  return { locked, warningIn, lock, stayAwake }
}

/// The counter, locked, with the sale still underneath it.
///
/// There is no way out of this card but a password: no close button, no
/// backdrop to click through, no Escape. The overlay covers the viewport, so
/// the till behind cannot be clicked; and because that till is still mounted
/// and still listening, every keystroke that does not belong to this card is
/// swallowed before it can reach it.
///
/// `onUnlock` answers yes or no and nothing else. The reason a refusal
/// happened belongs to the node, is already in the session store in the node's
/// own words, and anything invented here could only disagree with it.
export function LockScreen({
  actorId,
  onUnlock,
}: {
  actorId: string
  onUnlock: (username: string, password: string) => Promise<boolean>
}) {
  const { problem } = useSession()
  // Whoever walked away is nearly always whoever comes back, so their name is
  // already in the field. It stays editable: a supervisor opening the counter
  // signs in as themselves, and a till only one person could unlock is a till
  // that strands a basket the moment that person goes home.
  const [username, setUsername] = useState(actorId)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const card = useRef<HTMLFormElement>(null)
  const field = useRef<HTMLInputElement>(null)

  // Nothing behind this card may be typed at, tabbed into, or clicked.
  //
  // The till is still mounted and its shortcuts are still bound, so without
  // this a locked counter could still be paid off with F10 — and it would be
  // paid off from inside this very password field, which is a field, which is
  // exactly where `shortcuts.ts` lets a function key through. So no keystroke
  // goes further than this card, whichever half of the screen it was aimed at.
  //
  // Taken in the CAPTURE phase at the window, which runs before anything
  // listening in the bubble phase — `shortcuts.ts` binds there for this reason
  // — and `focusin` puts focus back whenever a Tab or a stray click gets out,
  // so there is no way to arrive at the till's fields underneath either.
  useEffect(() => {
    const swallow = (event: KeyboardEvent) => {
      // Keys aimed at this card keep their default action, because that is the
      // password being typed and Enter submitting the form. They are only
      // stopped from travelling, which costs this card nothing: it is two
      // fields and a button, and it listens for no key of its own.
      if (card.current?.contains(event.target as Node) !== true) {
        event.preventDefault()
      }
      event.stopPropagation()
    }
    const keepFocus = (event: FocusEvent) => {
      if (card.current?.contains(event.target as Node) === true) return
      field.current?.focus()
    }
    window.addEventListener("keydown", swallow, true)
    document.addEventListener("focusin", keepFocus)
    // The same call that holds focus here also places it to begin with, so the
    // password can be typed the moment the card appears.
    field.current?.focus()
    return () => {
      window.removeEventListener("keydown", swallow, true)
      document.removeEventListener("focusin", keepFocus)
    }
  }, [])

  async function unlock(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setTried(true)
    const accepted = await onUnlock(username, password)
    setBusy(false)
    // Dropped whichever way the node answered, exactly as the sign-in screen
    // does it: a counter is a shared machine, and the next person to stand at
    // it is not the one who typed.
    setPassword("")
    if (!accepted) field.current?.focus()
  }

  return (
    <div className="overlay">
      <form
        ref={card}
        className="overlay-card"
        onSubmit={(event) => void unlock(event)}
      >
        <span className="label">Konter terkunci</span>
        <h3>Masuk lagi untuk melanjutkan</h3>
        <p className="muted">
          Sesi atas nama <strong>{actorId}</strong>.
        </p>

        <div className="notice" style={{ width: "100%", textAlign: "left" }}>
          Keranjang, kupon dan nomor member di belakang layar ini tidak
          disentuh. Mengunci berarti seseorang menjauh dari konter, bukan
          transaksinya selesai.
        </div>

        <label className="field" style={{ width: "100%", textAlign: "left" }}>
          Nama pengguna
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="off"
            aria-label="Nama pengguna"
          />
        </label>

        <label className="field" style={{ width: "100%", textAlign: "left" }}>
          Kata sandi
          <input
            ref={field}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
            aria-label="Kata sandi"
          />
        </label>

        {/* Only after somebody has actually tried. The session store keeps the
            last refusal it saw, and a problem left over from before the screen
            locked would read as though this password had just been rejected. */}
        {tried && problem !== null && (
          <p className="error" style={{ width: "100%", textAlign: "left" }}>
            {problem}
          </p>
        )}

        <button
          className="btn primary"
          style={{ width: "100%" }}
          type="submit"
          disabled={busy || username === "" || password === ""}
        >
          {busy ? "Memeriksa…" : "Buka konter"}
        </button>

        <p className="muted" style={{ fontSize: 11.5 }}>
          Tidak ada jalan lain dari layar ini — <kbd>Esc</kbd> pun tidak. Kalau
          sandinya bukan milik Anda, panggil yang tadi berdiri di sini.
        </p>
      </form>
    </div>
  )
}
