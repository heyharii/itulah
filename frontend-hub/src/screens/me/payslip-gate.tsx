import { useState } from "react"

import { Panel } from "@/screens/me/ui/bits"
import { Button } from "@/screens/me/ui/button"
import { Field, Input } from "@/screens/me/ui/field"
import { ApiError } from "@itulah/contract/client"
import {
  type LockState,
  payslipPassword,
  unlockPayslips,
} from "@/screens/me/data/payslip-lock"
import { useSetPayslipPassword } from "@/screens/me/data/queries"

/// Your payslips are locked: the company asks for a password of your own
/// before they open — separate from your login, so a phone left unlocked on
/// the counter does not show what you earn.
///
/// Two forms behind one door. The first time, you choose the password; after
/// that, you type it. It is kept for this tab only, so a reload asks again.
export function PayslipGate({ state }: { state: LockState }) {
  return state === "unset" ? <ChoosePassword /> : <EnterPassword />
}

function EnterPassword() {
  const [typed, setTyped] = useState("")
  // A password already tried and still refused is a wrong one; the first
  // visit has tried nothing and says nothing.
  const tried = payslipPassword() !== null
  return (
    <Panel title="Payslips are locked">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (typed !== "") unlockPayslips(typed)
        }}
      >
        <p className="text-meta text-body">
          Type your payslip password to open them. It is not your login
          password.
        </p>
        <Field label="Payslip password">
          <Input
            type="password"
            autoComplete="current-password"
            value={typed}
            invalid={tried}
            onChange={(event) => setTyped(event.target.value)}
          />
        </Field>
        {tried && (
          <p role="alert" className="text-meta text-bad">
            That password did not open them.
          </p>
        )}
        <p className="text-meta text-mute">
          Forgotten it? Ask HR to reset it, then choose a new one here.
        </p>
        <Button
          type="submit"
          variant="primary"
          size="tap"
          disabled={typed === ""}
        >
          Open payslips
        </Button>
      </form>
    </Panel>
  )
}

function ChoosePassword() {
  return (
    <Panel title="Choose a payslip password">
      <p className="text-meta text-body">
        Your company locks payslips with a password of their own. Choose one —
        you will be asked for it each time you open them on a new page.
      </p>
      <PasswordForm needsCurrent={false} />
    </Panel>
  )
}

/// Change the payslip password, with the current one.
export function ChangePayslipPassword() {
  const [open, setOpen] = useState(false)
  return (
    <Panel title="Payslip password">
      {open ? (
        <PasswordForm needsCurrent onDone={() => setOpen(false)} />
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-meta text-body">
            Your payslips open with a password of their own.
          </p>
          <Button variant="quiet" onClick={() => setOpen(true)}>
            Change
          </Button>
        </div>
      )}
    </Panel>
  )
}

function PasswordForm({
  needsCurrent,
  onDone,
}: {
  needsCurrent: boolean
  onDone?: () => void
}) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [again, setAgain] = useState("")
  const set = useSetPayslipPassword()
  const short = next !== "" && next.length < 6
  const differs = again !== "" && again !== next
  const ready =
    next.length >= 6 && next === again && (!needsCurrent || current !== "")

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready) return
        set.mutate(
          needsCurrent ? { password: next, current } : { password: next },
          { onSuccess: () => onDone?.() }
        )
      }}
    >
      {needsCurrent && (
        <Field label="Current payslip password">
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </Field>
      )}
      <Field
        label="New payslip password"
        problem={short ? "At least 6 characters." : undefined}
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
      </Field>
      <Field
        label="Again"
        problem={differs ? "The two do not match." : undefined}
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(event) => setAgain(event.target.value)}
        />
      </Field>
      {set.error !== null && (
        <p role="alert" className="text-meta text-bad">
          {set.error instanceof ApiError
            ? set.error.message
            : "Could not reach the server."}
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        size="tap"
        disabled={!ready || set.isPending}
      >
        Save password
      </Button>
    </form>
  )
}
