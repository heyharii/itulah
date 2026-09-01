import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"

import { Failure, Panel } from "@/components/bits"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { isoDate } from "@/lib/hr/demo"
import { useApplyForLeave, useLeaveTypes } from "@/lib/hr/queries"

/// Asking for leave.
///
/// Native `<select>` and native `<input type="date">` on purpose. A phone
/// answers both with the picker its owner already knows — the iOS wheel, the
/// Android calendar — and a hand-built popover would be a worse version of it
/// that also has to be reached one-handed. This is one of the few places where
/// the platform control is plainly better than the design system's.
export function LeaveNew() {
  const navigate = useNavigate()
  const types = useLeaveTypes()
  const apply = useApplyForLeave()

  const today = isoDate(new Date())
  const [leaveTypeId, setLeaveTypeId] = useState("")
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [reason, setReason] = useState("")
  // Set by the first attempt. A button that is disabled until the form is
  // right explains nothing: on a phone the reason it is grey is usually a
  // field that has scrolled off the top of the screen.
  const [tried, setTried] = useState(false)

  const chosen = (types.data ?? []).find(
    (type) => type.leave_type_id === leaveTypeId
  )
  // Calendar days, and labelled as such. The server counts working days
  // against the site's holiday calendar, and a number computed here that
  // disagreed with the decision letter would be worse than no number.
  const span =
    Date.parse(`${to}T00:00:00`) >= Date.parse(`${from}T00:00:00`)
      ? Math.round(
          (Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) /
            86_400_000
        ) + 1
      : 0

  const problem =
    span === 0
      ? "The last day cannot be before the first."
      : leaveTypeId === ""
        ? "Choose a kind of leave."
        : reason.trim() === ""
          ? "Say why, so your manager can decide."
          : chosen !== undefined &&
              chosen.entitled_days > 0 &&
              span > chosen.remaining_days
            ? `That is more than the ${chosen.remaining_days} days you have left.`
            : null

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTried(true)
    if (problem !== null) {
      return
    }
    await apply.mutateAsync({
      leave_type_id: leaveTypeId,
      from_date: from,
      to_date: to,
      reason: reason.trim(),
    })
    await navigate({ to: "/leave" })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Panel>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="leave-type">Kind of leave</FieldLabel>
            <select
              id="leave-type"
              value={leaveTypeId}
              onChange={(event) => setLeaveTypeId(event.target.value)}
              // `h-11` and `text-base`: a control under 44px is hard to hit
              // with a thumb, and a font under 16px makes iOS Safari zoom the
              // page the moment it is focused.
              className="h-11 w-full rounded-xl border border-input bg-input/30 px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
              required
            >
              <option value="" disabled>
                Choose…
              </option>
              {(types.data ?? []).map((type) => (
                <option key={type.leave_type_id} value={type.leave_type_id}>
                  {type.name}
                  {type.entitled_days > 0 && ` — ${type.remaining_days} left`}
                  {!type.paid && " (unpaid)"}
                </option>
              ))}
            </select>
            {chosen?.requires_document === true && (
              <FieldDescription>
                Bring the doctor's note to your manager — this app does not take
                attachments yet.
              </FieldDescription>
            )}
          </Field>

          {/* Two columns even on the narrowest phone: the pair is read as one
              range, and stacking them puts "to" below the fold on a keyboard
              that is already covering half the screen. */}
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="from">First day</FieldLabel>
              <Input
                id="from"
                type="date"
                className="h-11 text-base md:text-sm"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value)
                  // Dragging the start past the end is a slip, not an
                  // instruction; carry the end along rather than refusing it.
                  if (event.target.value > to) {
                    setTo(event.target.value)
                  }
                }}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="to">Last day</FieldLabel>
              <Input
                id="to"
                type="date"
                className="h-11 text-base md:text-sm"
                min={from}
                value={to}
                onChange={(event) => setTo(event.target.value)}
                required
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="reason">Why</FieldLabel>
            <Textarea
              id="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Your manager sees this."
              rows={3}
              required
            />
          </Field>

          <p className="text-[13px] text-muted-foreground">
            {span > 0 &&
              `${span === 1 ? "1 calendar day" : `${span} calendar days`}. Your manager's decision counts working days against the holiday calendar.`}
          </p>

          {apply.error !== null && <Failure error={apply.error} />}

          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="h-11"
              onClick={() => void navigate({ to: "/leave" })}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="lg"
              className="h-11"
              disabled={apply.isPending}
            >
              {apply.isPending ? "Sending…" : "Send request"}
            </Button>
          </div>
          {tried && problem !== null && (
            <FieldDescription
              role="alert"
              className="text-center text-destructive"
            >
              {problem}
            </FieldDescription>
          )}
        </FieldGroup>
      </Panel>
    </form>
  )
}
