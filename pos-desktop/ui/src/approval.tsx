/// A supervisor's yes, asked for at the counter before a cashier undoes
/// something the shop wants a second person to see.
///
/// # What it proves, and where it is written down
///
/// Nothing is compared here. The supervisor proves themselves to the NODE the
/// same three ways a void accepts (`verify_supervisor` in `src/edge/till.rs`):
///
/// - **PIN** — `POST /api/v1/auth/pin/claim` (purpose `SUPERVISOR`) answers a
///   one-shot grant naming who said yes;
/// - **fingerprint** — the same grant, from a finger the node matched;
/// - **password** — sent once with the approval and checked there.
///
/// The grant (or password) then goes to `POST /api/v1/store/approvals`, which
/// spends it inside the same transaction that writes `till_approval`: the
/// action, what the supervisor was shown, the tags, and their name. Only when
/// that row exists does the till carry out the action. An approval that was
/// asked for and not recorded is an approval that did not happen.
///
/// Kode + PIN rather than PIN alone, because a bare PIN would have to be tried
/// against every supervisor at once — that weakens it and loses who approved.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import * as api from "@/api"
import { isWeb } from "@/edition"
import { seatNow } from "@/seat"
import { NO_FINGER, supervisorByFinger, useSession } from "@/session"
import { useFingerWatch, useScanner } from "@/scanner"
import { Sensor, type Read } from "@/sensor"
import { SIMULATED, SIM_FINGERS, SIM_HEAD, SIM_SECRET, titled } from "@/simulation"
import { sound } from "@/sound"

const UNKNOWN_FINGER = "\u0000unknown"

export type Approved = {
  readonly username: string
  readonly approvalId: string
  /// The person's full name, for the till's "disetujui …": the node's name for
  /// them when it says, else the username with a capital.
  readonly name: string
}

type Ask = {
  readonly action: "EDIT_CART" | "CANCEL_BASKET" | "DROP_HOLD"
  readonly title: string
  /// What the supervisor is shown, and what the node writes down beside
  /// their name — so it is plain text, not markup.
  readonly detail: string
  readonly reason?: string | null
  readonly epcs?: readonly string[]
  readonly amountMinor?: number | null
  readonly onApproved: (by: Approved) => void
  /// The node action itself, when it takes the supervisor's proof directly
  /// (a return): the proof is spent there instead of on `till_approval`.
  /// Answers the node's refusal, or null when it went through.
  readonly perform?: (supervisor: api.Supervisor) => Promise<string | null>
}

/// `ask(...)` opens the sheet; the action runs only from `onApproved`.
export function useApproval(): {
  readonly ask: (request: Ask) => void
  readonly sheet: ReactNode
  readonly open: boolean
} {
  const [pending, setPending] = useState<Ask | null>(null)
  const ask = useCallback((request: Ask) => setPending(request), [])
  const sheet =
    pending === null ? null : (
      <ApprovalSheet
        request={pending}
        onClose={() => setPending(null)}
        onApproved={(by) => {
          setPending(null)
          pending.onApproved(by)
        }}
      />
    )
  return { ask, sheet, open: pending !== null }
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `approval-${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

function ApprovalSheet({
  request,
  onClose,
  onApproved,
}: {
  request: Ask
  onClose: () => void
  onApproved: (by: Approved) => void
}) {
  const session = useSession()
  const [, setStepUp] = useState<api.StepUp | null>(null)
  const [, setMode] = useState<"quick" | "password">("quick")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblemState] = useState<string | null>(null)
  const problemRef = useRef<string | null>(null)
  const setProblem = (next: string | null) => {
    problemRef.current = next
    setProblemState(next)
  }
  // One key per sheet: a retry after a dropped line is the same approval.
  const key = useRef(newKey())
  // The card takes the caret, so a key pressed while it is up never types
  // into the till's scan field behind it.
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => {
    card.current?.focus()
  }, [])
  // Full names, best effort: the people this shop's node knows.
  const names = useRef(new Map<string, string>())
  useEffect(() => {
    void api.tillPeople().then((reply) => {
      if (!reply.ok) return
      for (const one of reply.body?.items ?? []) names.current.set(one.username, one.display_name)
    }).catch(() => undefined)
  }, [])
  const fullName = (username: string) =>
    names.current.get(username) ??
    (session.me?.username === username ? session.me?.display_name : undefined) ??
    titled(username)

  useEffect(() => {
    let alive = true
    void (async () => {
      const reply = await api.authMethods()
      if (!alive) return
      const answer = reply.ok ? (reply.body?.till_step_up ?? "NONE") : "NONE"
      setStepUp(answer)
      if (answer === "NONE") setMode("password")
    })()
    return () => {
      alive = false
    }
  }, [])

  /// Write the approval down on the node, spending the supervisor's proof.
  async function record(supervisor: api.Supervisor): Promise<void> {
    if (request.perform !== undefined) {
      const refusedWith = await request.perform(supervisor)
      if (refusedWith !== null) {
        setProblem(refusedWith)
        return
      }
      onApproved({ username: supervisor.username, approvalId: "", name: fullName(supervisor.username) })
      return
    }
    const reply = await api.recordApproval({
      action: request.action,
      // The drawer the approval is about: the seat the cashier holds, and the
      // machine only when they hold none.
      terminal_id: seatNow()?.terminal_id ?? session.terminalId,
      detail: request.detail,
      reason: request.reason ?? null,
      epcs: request.epcs ?? [],
      amount_minor: request.amountMinor ?? null,
      supervisor,
      actor_id: session.me?.username ?? "",
      idempotency_key: key.current,
    })
    if (!reply.ok) {
      // A finger, or a password, that is not a Kepala toko's: said in the
      // till's words, not the node's.
      setProblem(
        reply.status === 401 || reply.status === 403 || reply.status === 422
          ? "Bukan kepala toko"
          : (reply.problem ?? "Persetujuan tidak tercatat di server toko."),
      )
      return
    }
    onApproved({
      username: reply.body.approved_by,
      approvalId: reply.body.approval_id,
      name: fullName(reply.body.approved_by),
    })
  }

  async function withPassword() {
    if (username.trim() === "" || password === "") {
      setProblem("Isi username dan password kepala toko.")
      return
    }
    setBusy(true)
    setProblem(null)
    const typed = password
    setPassword("")
    await record({ username: username.trim(), password: typed })
    setBusy(false)
  }

  // The Kepala toko approves with her finger (owner, 23 Oct 2026: "buat sidik
  // jari juga"), as the prototype's sheet does. With a scanner on this till
  // (the desktop shell has one open) her finger is matched here against the
  // node's roster and the node grants the approval; with none, a rig may
  // simulate it (VITE_SIM_FINGERS): a press on the sensor is the simulated
  // head's finger, sent as her password.
  const scanner = useScanner()
  const realScanner = !isWeb && scanner === true
  const byFinger = realScanner || SIMULATED
  const [read, setRead] = useState<Read>("idle")
  // Approvals are by the Kepala toko's finger only (owner): no password in
  // the UI.
  const usePassword = false

  /// The real scanner: a press on the sensor on screen waits ten seconds for
  /// her finger (`watch` absent); the card listening on its own (`watch`)
  /// shows nothing until a finger lands. Answers whether to go on listening.
  async function byScanner(watch?: string): Promise<boolean> {
    const explicit = watch === undefined
    let placed = false
    const begin = () => {
      placed = true
      setBusy(true)
      setProblem(null)
      setRead("reading")
      sound.read()
    }
    if (explicit) begin()
    const answer = await supervisorByFinger({
      watch,
      waitMs: explicit ? 10_000 : 15_000,
      onPlaced: explicit ? undefined : begin,
    })
    if (answer.problem === NO_FINGER) {
      if (explicit) {
        setBusy(false)
        setRead("idle")
        setProblem(NO_FINGER)
      }
      return true
    }
    if (!placed) {
      setProblem(answer.problem)
      return false
    }
    if (answer.authorization === null) {
      setBusy(false)
      refused("Bukan kepala toko")
      return true
    }
    const before = problemRef.current
    await record({ username: answer.username ?? "", authorization: answer.authorization })
    setBusy(false)
    if (problemRef.current !== before && problemRef.current !== null) {
      refused(problemRef.current)
      return true
    }
    approvedSound()
    return false
  }

  // The card listens to the scanner on its own: she lays her finger on it.
  useFingerWatch(realScanner && !busy && read !== "done", (watch) => byScanner(watch))

  async function press(person?: string) {
    if (busy || read === "reading" || read === "done") return
    if (realScanner && person === undefined) {
      await byScanner()
      return
    }
    setRead("reading")
    sound.read()
    setProblem(null)
    await new Promise((done) => window.setTimeout(done, 980))
    if (person === UNKNOWN_FINGER) {
      refused("Jari tidak dikenali")
      return
    }
    setBusy(true)
    const before = problemRef.current
    await record({ username: person ?? SIM_HEAD, password: SIM_SECRET })
    setBusy(false)
    if (problemRef.current !== before && problemRef.current !== null) {
      refused(problemRef.current)
      return
    }
    approvedSound()
  }
  function refused(text: string) {
    setRead("no")
    sound.no()
    setProblem(text)
    window.setTimeout(() => setRead((state) => (state === "no" ? "idle" : state)), 1700)
  }
  function approvedSound() {
    setRead("done")
    sound.ok()
  }

  // The key that opened this card (an Enter on Batal, say) is still on its
  // way up to the window when the card mounts: it must not press the sensor.
  const openedAt = useRef(performance.now())
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.timeStamp <= openedAt.current) return
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
      } else if (event.key === "Enter" && !usePassword && byFinger) {
        event.preventDefault()
        void press()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const say =
    read === "reading"
      ? "Membaca…"
      : read === "done"
        ? "Disetujui"
        : read === "no"
          ? (problem ?? "Bukan kepala toko")
          : "Tempelkan jari"

  return (
    <div ref={card} tabIndex={-1} style={{ outline: "none" }} className="pdoor papr" role="dialog" aria-modal="true" aria-label="Persetujuan kepala toko">
      <div className="sup">
        <p className="d-ttl">{request.title}</p>
        {request.title !== "Return" && <p className="d-sub" style={{ textAlign: "center" }}>{request.detail}</p>}
        <p className="d-sub" style={{ textAlign: "center" }}>Kepala toko menyetujui dengan jari</p>
        {usePassword || !byFinger ? (
          <form
            className="d-pw"
            style={{ marginTop: 18 }}
            onSubmit={(event) => {
              event.preventDefault()
              void withPassword()
            }}
          >
            <label>
              Username kepala toko
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" spellCheck={false} autoFocus />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" />
            </label>
            {problem !== null && <p className="d-err">{problem}</p>}
            <button className="pd-btn" type="submit" disabled={busy || username === "" || password === ""}>
              <span>{busy ? "Memeriksa…" : "Setujui"}</span>
              <span className="kbd">Enter</span>
            </button>
          </form>
        ) : (
          <>
            <Sensor state={read} onPress={() => void press()} small />
            <p className={`d-say${read === "no" ? " bad" : ""}`} style={read === "done" ? { color: "#1d7a32" } : undefined} aria-live="polite">
              {say}
            </p>
            <p className="d-hint">{read !== "no" && realScanner ? (problem ?? "") : ""}</p>
          </>
        )}
        <div className="sup-foot">
          <button className="d-chip" type="button" onClick={onClose} disabled={busy}>
            Batal<span className="kbd">Esc</span>
          </button>
        </div>
      </div>
      {SIMULATED && !realScanner && !usePassword && (
        <div className="d-sims">
          {SIM_FINGERS.map((person: string) => (
            <button key={person} className="ok" type="button" disabled={busy} onClick={() => void press(person)}>
              Jari {titled(person)}
              {person === SIM_HEAD ? " · Kepala toko" : ""}
            </button>
          ))}
          <button className="bad" type="button" disabled={busy} onClick={() => void press(UNKNOWN_FINGER)}>
            Jari tak dikenal
          </button>
        </div>
      )}
    </div>
  )
}
