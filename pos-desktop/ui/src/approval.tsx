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
import { Icon } from "@/icons"
import { PinPad } from "@/pinpad"
import { Sheet } from "@/screens/dialogs"
import { seatNow } from "@/seat"
import { supervisorByFinger, supervisorByPin, useSession } from "@/session"

export type Approved = { readonly username: string; readonly approvalId: string }

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
  const [stepUp, setStepUp] = useState<api.StepUp | null>(null)
  const [mode, setMode] = useState<"quick" | "password">("quick")
  const [username, setUsername] = useState("")
  // Held in refs and emptied the moment the node has answered, the same way
  // `returns.tsx` holds a supervisor's PIN.
  const pin = useRef("")
  const [password, setPassword] = useState("")
  const [, redraw] = useState(0)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // One key per sheet: a retry after a dropped line is the same approval.
  const key = useRef(newKey())

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

  const setPin = (next: string) => {
    pin.current = next
    redraw((count) => count + 1)
  }

  /// Write the approval down on the node, spending the supervisor's proof.
  async function record(supervisor: api.Supervisor): Promise<void> {
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
      setProblem(reply.problem ?? "Persetujuan tidak tercatat di node.")
      return
    }
    onApproved({
      username: reply.body.approved_by,
      approvalId: reply.body.approval_id,
    })
  }

  async function withPin() {
    if (username.trim() === "" || pin.current === "") {
      setProblem("Isi kode supervisor dan PIN.")
      return
    }
    setBusy(true)
    setProblem(null)
    const answer = await supervisorByPin(username.trim(), pin.current)
    setPin("")
    if (answer.authorization === null) {
      setBusy(false)
      setProblem(answer.problem ?? "PIN ditolak.")
      return
    }
    await record({
      username: answer.username ?? username.trim(),
      authorization: answer.authorization,
    })
    setBusy(false)
  }

  async function withFinger() {
    setBusy(true)
    setProblem(null)
    const answer = await supervisorByFinger()
    if (answer.authorization === null) {
      setBusy(false)
      setProblem(answer.problem ?? "Sidik jari ditolak.")
      return
    }
    await record({
      username: answer.username ?? "",
      authorization: answer.authorization,
    })
    setBusy(false)
  }

  async function withPassword() {
    if (username.trim() === "" || password === "") {
      setProblem("Isi kode supervisor dan kata sandi.")
      return
    }
    setBusy(true)
    setProblem(null)
    const typed = password
    setPassword("")
    await record({ username: username.trim(), password: typed })
    setBusy(false)
  }

  // Finger and PIN grants both travel the pairing channel (`signedEdge`),
  // which only the desktop shell can sign — see `edition.ts` — so on the web
  // a supervisor always types a password, and this screen never offers the
  // quick way or a switch onto it.
  const quick = !isWeb && mode === "quick" && stepUp !== "NONE"
  const submit = () =>
    void (quick
      ? stepUp === "FINGERPRINT"
        ? withFinger()
        : withPin()
      : withPassword())

  return (
    <Sheet
      title="Persetujuan kepala toko"
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button
            className="btn primary"
            disabled={busy || stepUp === null}
            onClick={submit}
          >
            {quick && stepUp === "FINGERPRINT" && <Icon name="finger" />}
            {busy
              ? "Memeriksa…"
              : quick && stepUp === "FINGERPRINT"
                ? "Pindai sidik jari"
                : "Setujui"}
          </button>
        </>
      }
    >
      <div className="approval-what">
        <span className="seal warn">
          <Icon name="lock" />
        </span>
        <div>
          <strong>{request.title}</strong>
          <p>{request.detail}</p>
        </div>
      </div>

      {stepUp === null && <p className="muted">Memuat…</p>}

      {!isWeb && stepUp !== null && stepUp !== "NONE" && (
        <div className="segmented" role="radiogroup" aria-label="Cara menyetujui">
          <button
            type="button"
            role="radio"
            aria-checked={mode === "quick"}
            aria-pressed={mode === "quick"}
            onClick={() => setMode("quick")}
          >
            {stepUp === "FINGERPRINT" ? "Sidik jari" : "PIN"}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "password"}
            aria-pressed={mode === "password"}
            onClick={() => setMode("password")}
          >
            Kata sandi
          </button>
        </div>
      )}

      {stepUp !== null && !(quick && stepUp === "FINGERPRINT") && (
        <form
          className="rows"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <label className="field">
            Kode supervisor
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </label>
          {quick ? (
            <PinPad
              value={pin.current}
              onChange={setPin}
              onSubmit={submit}
              disabled={busy}
            />
          ) : (
            <label className="field">
              Kata sandi
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="off"
              />
            </label>
          )}
        </form>
      )}

      {problem !== null && <p className="error">{problem}</p>}
    </Sheet>
  )
}
