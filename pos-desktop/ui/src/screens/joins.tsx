/// The tills waiting to join this shop, and a supervisor's yes.
///
/// # Where this happens, and why here
///
/// On a till that has already joined. The node lets a new till in on a
/// supervisor's finger or PIN pressed at a till it already trusts — "one tap
/// and a finger" — because that till can sign the claim the finger or PIN
/// earns, and a till that has not joined yet cannot. So this screen lists the
/// waiting tills (`GET /api/v1/devices/joins`), and approving one takes the
/// same one-shot grant a void takes (`supervisorByFinger`,
/// `supervisorByPin`), which the node spends as it lets the till in.
///
/// # What the supervisor must check
///
/// The number. The code is how the supervisor finds the right row; the six
/// digits beside it are derived from the code *and* the new till's key, so a
/// request some other machine on the wifi made shows a different number from
/// the one on the till standing in front of them. The approve button stays
/// off until they say they compared it.
///
/// # Replacing a till
///
/// A till that dies is replaced, not re-numbered: approving the new one "as
/// the replacement for Kasir 2" revokes the old Kasir 2, keeps its row, and
/// gives the new till its name — so the receipts and the cash shifts carry on
/// under the name the shop already uses.
///
/// Not while Kasir 2 still has a shift open. The shift is kept by that name, so
/// the new till would take over a drawer somebody else counted; the node
/// refuses, and this screen says so before anybody presses a finger.

import { useCallback, useEffect, useRef, useState } from "react"

import * as api from "@/api"
import { isWeb } from "@/edition"
import { Icon } from "@/icons"
import { spaced, timeLeft } from "@/joining"
import { PinPad } from "@/pinpad"
import { Sheet } from "@/screens/dialogs"
import { supervisorByFinger, supervisorByPin, useNodeConfig } from "@/session"
import { Topbar } from "@/till"

/// A waiting till is a person standing at a counter; five seconds is as long
/// as they should wait to appear here.
const REFRESH_MS = 5000

export function WaitingTillsScreen({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<readonly api.PendingJoin[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [open, setOpen] = useState<api.PendingJoin | null>(null)
  const [note, setNote] = useState<{ bad: boolean; text: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    const reply = await api.pendingJoins()
    if (!reply.ok) {
      setProblem(reply.problem)
      setItems((before) => before ?? [])
      return
    }
    setProblem(null)
    setItems(reply.body?.items ?? [])
  }, [])

  useEffect(() => {
    void load()
    const refresh = window.setInterval(() => void load(), REFRESH_MS)
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      window.clearInterval(refresh)
      window.clearInterval(tick)
    }
  }, [load])

  async function refuse(join: api.PendingJoin) {
    if (
      !window.confirm(
        `Refuse the till with code ${join.code}? It discards its key and ` +
          "has to ask again.",
      )
    ) {
      return
    }
    const reply = await api.refuseJoin(join.join_id)
    setNote(
      reply.ok
        ? { bad: false, text: `The till with code ${join.code} was refused.` }
        : { bad: true, text: reply.problem ?? "The node did not accept this refusal." },
    )
    void load()
  }

  return (
    <div id="app" data-screen="sale">
      <Topbar />
      <main className="page">
        <div className="page-inner" style={{ maxWidth: 720 }}>
          <div className="page-head">
            <div>
              <h1>Tills waiting for approval</h1>
              <p>
                New tills in this store asking to join. Match the code and the
                verification number with that till's screen before approving.
              </p>
            </div>
            <button className="btn ghost" type="button" onClick={onBack}>
              <Icon name="back" />
              Back
            </button>
          </div>

          {problem !== null && <div className="notice warn">{problem}</div>}
          {note !== null && <p className={note.bad ? "error" : "muted"}>{note.text}</p>}

          {items === null && <p className="muted">Loading…</p>}

          {items !== null && items.length === 0 && (
            <div className="empty">
              <Icon name="plug" />
              <h3>No tills waiting</h3>
              <p>
                On the new till, open Settings and choose Join the node. The
                request shows up here within a few seconds.
              </p>
            </div>
          )}

          {items !== null && items.length > 0 && (
            <div className="rows">
              {items.map((join) => {
                const left = timeLeft(join.expires_at, now)
                const machine = join.machine ?? null
                return (
                  <div className="row-item" key={join.join_id}>
                    <span className="seal warn" style={{ width: 44, height: 44 }}>
                      <Icon name="plug" />
                    </span>
                    <span className="grow">
                      <h3 className="num" style={{ fontSize: 18, letterSpacing: 2 }}>
                        {join.code}
                        <span className="muted" style={{ fontSize: 13, letterSpacing: 1, marginLeft: 12 }}>
                          number {spaced(join.verification)}
                        </span>
                      </h3>
                      <p>
                        {machine?.hostname !== undefined && machine.hostname !== ""
                          ? machine.hostname
                          : "Unnamed computer"}
                        {machine?.os !== undefined && machine.os !== "" ? ` · ${machine.os}` : ""}
                        {machine?.version !== undefined && machine.version !== ""
                          ? ` · app ${machine.version}`
                          : ""}
                        {left !== null ? ` · valid for ${left} more` : " · expired"}
                      </p>
                    </span>
                    <button className="btn" type="button" onClick={() => void refuse(join)}>
                      Refuse
                    </button>
                    <button
                      className="btn primary"
                      type="button"
                      disabled={left === null}
                      onClick={() => {
                        setNote(null)
                        setOpen(join)
                      }}
                    >
                      Check and approve
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {open !== null && (
        <ApproveSheet
          join={open}
          onClose={() => setOpen(null)}
          onApproved={(approved) => {
            setOpen(null)
            setNote({
              bad: false,
              text:
                `Code ${open.code} joined as ${approved.label}` +
                (approved.replaced_terminal_id !== null
                  ? ", replacing the old till (the old till is revoked)."
                  : ".") +
                ` Approved by ${approved.approved_by}.`,
            })
            void load()
          }}
        />
      )}
    </div>
  )
}

type Till = { readonly id: string; readonly label: string; readonly status: string }

/// An open shift on the till being replaced, as the approval sheet warns of it.
type OpenShift = { readonly openedAt: string | null; readonly openedBy: string | null }

/// Whether a till still has its drawer open, by either name a shift can carry:
/// the label a joined till opens shifts under, or the node's id for a till
/// paired before joining existed. `null` when neither has one, or when the
/// node would not say — the node checks again when the approval is sent.
async function openShiftOf(till: Till): Promise<OpenShift | null> {
  for (const name of [till.label, till.id]) {
    const reply = await api.activeShiftOf(name)
    const shift = reply.ok ? reply.body : null
    if (shift !== null && shift !== undefined && (shift.shift_id ?? "") !== "") {
      return { openedAt: shift.opened_at ?? null, openedBy: shift.opened_by ?? null }
    }
  }
  return null
}

function whenOpened(openedAt: string | null): string {
  if (openedAt === null) return ""
  const at = new Date(openedAt)
  return Number.isNaN(at.getTime())
    ? openedAt
    : at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
}

function ApproveSheet({
  join,
  onClose,
  onApproved,
}: {
  join: api.PendingJoin
  onClose: () => void
  onApproved: (approved: api.ApprovedTill) => void
}) {
  const { config } = useNodeConfig()
  const [compared, setCompared] = useState(false)
  const [joinAs, setJoinAs] = useState<"new" | "replace">("new")
  const [label, setLabel] = useState("")
  const [replaces, setReplaces] = useState("")
  const [tills, setTills] = useState<readonly Till[] | null>(null)
  const [stepUp, setStepUp] = useState<api.StepUp | null>(null)
  // Web never gets the quick way — see `edition.ts` — so it starts, and
  // stays, on the account it is already signed in with; the switcher below
  // that would offer the other one is not drawn there either.
  const [how, setHow] = useState<"quick" | "session">(isWeb ? "session" : "quick")
  const [username, setUsername] = useState("")
  // Held in a ref and emptied the moment the node has answered, as
  // `approval.tsx` holds a supervisor's PIN.
  const pin = useRef("")
  const [, redraw] = useState(0)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  /// The shift still open on the till chosen for replacing, if any.
  const [openShift, setOpenShift] = useState<OpenShift | null>(null)

  const replaced = (tills ?? []).find((till) => till.id === replaces) ?? null

  useEffect(() => {
    setOpenShift(null)
    if (joinAs !== "replace" || replaced === null) return
    let alive = true
    void (async () => {
      const open = await openShiftOf(replaced)
      if (alive) setOpenShift(open)
    })()
    return () => {
      alive = false
    }
  }, [joinAs, replaced])

  useEffect(() => {
    let alive = true
    void (async () => {
      const [methods, listed] = await Promise.all([api.authMethods(), api.devices()])
      if (!alive) return
      const answer = methods.ok ? (methods.body?.till_step_up ?? "NONE") : "NONE"
      setStepUp(answer)
      if (answer === "NONE") setHow("session")
      setTills(
        listed.ok
          ? (listed.body?.items ?? [])
              .filter((one) => one.kind === "TILL" && one.status !== "REVOKED")
              // This till cannot be replaced from itself.
              .filter((one) => one.device_id !== config?.pairing_id)
              .map((one) => ({ id: one.device_id, label: one.label, status: one.status }))
          : [],
      )
    })()
    return () => {
      alive = false
    }
  }, [config?.pairing_id])

  const setPin = (next: string) => {
    pin.current = next
    redraw((count) => count + 1)
  }

  async function approveWith(authorization: string | null) {
    const reply = await api.approveJoin(join.join_id, {
      authorization,
      label: joinAs === "new" && label.trim() !== "" ? label.trim() : null,
      replaces_terminal_id: joinAs === "replace" ? replaces : null,
    })
    if (!reply.ok) {
      setProblem(reply.problem ?? "The node refused this approval.")
      return
    }
    onApproved(reply.body)
  }

  async function approve() {
    setBusy(true)
    setProblem(null)
    if (how === "session") {
      await approveWith(null)
      setBusy(false)
      return
    }
    if (stepUp === "FINGERPRINT") {
      const answer = await supervisorByFinger()
      if (answer.authorization === null) {
        setBusy(false)
        setProblem(answer.problem ?? "Fingerprint refused.")
        return
      }
      await approveWith(answer.authorization)
      setBusy(false)
      return
    }
    if (username.trim() === "" || pin.current === "") {
      setBusy(false)
      setProblem("Enter the supervisor code and PIN.")
      return
    }
    const answer = await supervisorByPin(username.trim(), pin.current)
    setPin("")
    if (answer.authorization === null) {
      setBusy(false)
      setProblem(answer.problem ?? "PIN refused.")
      return
    }
    await approveWith(answer.authorization)
    setBusy(false)
  }

  const quick = how === "quick" && stepUp !== null && stepUp !== "NONE"
  const blocked = joinAs === "replace" && openShift !== null
  const ready =
    compared &&
    !busy &&
    !blocked &&
    stepUp !== null &&
    (joinAs === "new" || replaces !== "")

  return (
    <Sheet
      title="Approve new till"
      onClose={onClose}
      foot={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={!ready}
            onClick={() => void approve()}
          >
            {quick && stepUp === "FINGERPRINT" && <Icon name="finger" />}
            {busy
              ? "Checking…"
              : quick && stepUp === "FINGERPRINT"
                ? "Scan fingerprint and approve"
                : "Approve"}
          </button>
        </>
      }
    >
      <div className="approval-what">
        <span className="seal warn">
          <Icon name="lock" />
        </span>
        <div>
          <strong className="num" style={{ fontSize: 18, letterSpacing: 2 }}>
            {join.code}
          </strong>
          <p>
            Verification number{" "}
            <strong className="num" style={{ display: "inline", fontSize: 18, letterSpacing: 1 }}>
              {spaced(join.verification)}
            </strong>
          </p>
        </div>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={compared}
          onChange={(event) => setCompared(event.target.checked)}
        />
        This number is exactly the one shown on the new till's screen
      </label>
      <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>
        If it differs, do not approve: the request came from another computer.
      </p>

      <div className="segmented" role="radiogroup" aria-label="This new till joins as">
        <button
          type="button"
          role="radio"
          aria-checked={joinAs === "new"}
          aria-pressed={joinAs === "new"}
          onClick={() => setJoinAs("new")}
        >
          New till
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={joinAs === "replace"}
          aria-pressed={joinAs === "replace"}
          disabled={tills !== null && tills.length === 0}
          onClick={() => setJoinAs("replace")}
        >
          Replaces an old till
        </button>
      </div>

      {joinAs === "new" ? (
        <label className="field">
          Till name
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Leave empty for the next number (Kasir N)"
            autoComplete="off"
          />
        </label>
      ) : (
        <label className="field">
          Till being replaced — the new till takes its name, the old one is revoked
          <select value={replaces} onChange={(event) => setReplaces(event.target.value)}>
            <option value="">Choose a till…</option>
            {(tills ?? []).map((till) => (
              <option key={till.id} value={till.id}>
                {till.label}
                {till.status !== "ACTIVE" ? ` (${till.status.toLowerCase()})` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {blocked && replaced !== null && (
        <div className="notice warn">
          <strong>{replaced.label}</strong> still has an open cash shift
          {openShift?.openedAt ? ` since ${whenOpened(openShift.openedAt)}` : ""}
          {openShift?.openedBy ? ` (opened by ${openShift.openedBy})` : ""}.
          The replacement takes the same name, so that shift has to be finished
          first — on {replaced.label}, or from the Shift menu on this till if{" "}
          {replaced.label} can no longer be used. Then approve again.
        </div>
      )}

      {stepUp === null && <p className="muted">Loading…</p>}

      {!isWeb && stepUp !== null && (
        <div className="segmented" role="radiogroup" aria-label="How to approve">
          {stepUp !== "NONE" && (
            <button
              type="button"
              role="radio"
              aria-checked={how === "quick"}
              aria-pressed={how === "quick"}
              onClick={() => setHow("quick")}
            >
              {stepUp === "FINGERPRINT" ? "Supervisor fingerprint" : "Supervisor PIN"}
            </button>
          )}
          <button
            type="button"
            role="radio"
            aria-checked={how === "session"}
            aria-pressed={how === "session"}
            onClick={() => setHow("session")}
          >
            The signed-in account
          </button>
        </div>
      )}

      {how === "session" && (
        <p className="muted" style={{ fontSize: 12 }}>
          The node accepts an approval without a fingerprint or PIN only from an
          Admin account (or a supervisor, for the store's first till).
        </p>
      )}

      {quick && stepUp === "PIN" && (
        <form
          className="rows"
          onSubmit={(event) => {
            event.preventDefault()
            if (ready) void approve()
          }}
        >
          <label className="field">
            Supervisor code
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <PinPad
            value={pin.current}
            onChange={setPin}
            onSubmit={() => {
              if (ready) void approve()
            }}
            disabled={busy}
          />
        </form>
      )}

      {problem !== null && <p className="error">{problem}</p>}
    </Sheet>
  )
}
