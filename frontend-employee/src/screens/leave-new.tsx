import { useNavigate } from "@tanstack/react-router"
import { useForm, useStore } from "@tanstack/react-form"
import { useState } from "react"

import { Failure, Panel } from "@/components/bits"
import { Button } from "@/components/ui/button"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import {
  useApplyForLeave,
  useLeaveEntitlements,
  type Entitlement,
} from "@/lib/hr/queries"
import { isoDate } from "@/lib/format"
import { readDays } from "@/lib/hr/days"

/// Calendar days, and labelled as such. The server counts working days
/// against the site's holiday calendar, and a number computed here that
/// disagreed with the decision letter would be worse than no number.
function calendarDays(from: string, to: string): number {
  const first = Date.parse(`${from}T00:00:00`)
  const last = Date.parse(`${to}T00:00:00`)
  return last >= first ? Math.round((last - first) / 86_400_000) + 1 : 0
}

/// What is wrong with the request, in the order somebody would notice it.
///
/// One function rather than a rule per field, because the complaints are about
/// the form as a whole: a span is only too long once a kind of leave has been
/// chosen, and both of those are the same sentence to the person reading it.
function complaint(
  value: { leaveTypeId: string; from: string; to: string; reason: string },
  types: readonly Entitlement[]
): string | null {
  const chosen = types.find((type) => type.code === value.leaveTypeId)
  const span = calendarDays(value.from, value.to)
  if (span === 0) {
    return "The last day cannot be before the first."
  }
  if (value.leaveTypeId === "") {
    return "Choose a kind of leave."
  }
  if (value.reason.trim() === "") {
    return "Say why, so your manager can decide."
  }
  // Only a kind that draws on a balance can be asked for more of than is
  // left. Sick leave has none to run out of, and refusing it here would be
  // this app inventing a limit the law does not have.
  //
  // The check is a courtesy and not the rule: the span counted here is
  // calendar days, and the server charges working days against the holiday
  // calendar — so it will sometimes allow what this warns about, and its
  // answer is the one that counts.
  if (
    chosen !== undefined &&
    chosen.drawsOnBalance &&
    span * 100 > (chosen.remainingCentidays ?? 0)
  ) {
    return `That is more than the ${readDays(chosen.remainingCentidays ?? 0)} you have left.`
  }
  return null
}

/// Asking for leave.
///
/// Native `<select>` and native `<input type="date">` on purpose. A phone
/// answers both with the picker its owner already knows — the iOS wheel, the
/// Android calendar — and a hand-built popover would be a worse version of it
/// that also has to be reached one-handed. This is one of the few places where
/// the platform control is plainly better than the design system's.
export function LeaveNew() {
  const navigate = useNavigate()
  const types = useLeaveEntitlements()
  const apply = useApplyForLeave()

  const today = isoDate(new Date())
  // Set by the first attempt. A button that is disabled until the form is
  // right explains nothing: on a phone the reason it is grey is usually a
  // field that has scrolled off the top of the screen. Not a field, so not the
  // form's business.
  const [tried, setTried] = useState(false)

  const form = useForm({
    defaultValues: {
      leaveTypeId: "",
      from: today,
      to: today,
      reason: "",
    },
    onSubmit: async ({ value }) => {
      if (complaint(value, types.data) !== null) {
        return
      }
      await apply.mutateAsync({
        leave_type: value.leaveTypeId,
        from_date: value.from,
        to_date: value.to,
        reason: value.reason.trim(),
      })
      await navigate({ to: "/leave" })
    },
  })

  // The span and the complaint are read off every keystroke, which is what a
  // subscription to the values is for: a person shortening a range should see
  // the day count follow their thumb rather than after they submit.
  const values = useStore(form.store, (state) => state.values)
  const span = calendarDays(values.from, values.to)
  const problem = complaint(values, types.data)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        setTried(true)
        void form.handleSubmit()
      }}
      className="flex flex-col gap-4"
    >
      <Panel>
        <div className="flex flex-col gap-3.5">
          <form.Field name="leaveTypeId">
            {(field) => {
              const chosen = types.data.find(
                (type) => type.code === field.state.value
              )
              return (
                <Field
                  label="Kind of leave"
                  hint={
                    chosen?.requiresEvidence === true &&
                    "Bring the doctor's note to your manager — this app does not take attachments yet."
                  }
                >
                  <Select
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    {types.data.map((type) => (
                      <option key={type.code} value={type.code}>
                        {type.name}
                        {type.drawsOnBalance &&
                          ` — ${readDays(type.remainingCentidays ?? 0)} left`}
                      </option>
                    ))}
                  </Select>
                </Field>
              )
            }}
          </form.Field>

          {/* Two columns even on the narrowest phone: the pair is read as one
              range, and stacking them puts "to" below the fold on a keyboard
              that is already covering half the screen. */}
          <div className="grid grid-cols-2 gap-3">
            <form.Field name="from">
              {(field) => (
                <Field label="First day">
                  <Input
                    name={field.name}
                    type="date"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.target.value)
                      // Dragging the start past the end is a slip, not an
                      // instruction; carry the end along rather than refusing
                      // it.
                      if (event.target.value > form.getFieldValue("to")) {
                        form.setFieldValue("to", event.target.value)
                      }
                    }}
                    required
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="to">
              {(field) => (
                <Field label="Last day">
                  <Input
                    name={field.name}
                    type="date"
                    min={values.from}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    required
                  />
                </Field>
              )}
            </form.Field>
          </div>

          <form.Field name="reason">
            {(field) => (
              <Field label="Why">
                <Textarea
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Your manager sees this."
                  rows={3}
                  required
                />
              </Field>
            )}
          </form.Field>

          <p className="text-meta text-body">
            {span > 0 &&
              `${span === 1 ? "1 calendar day" : `${span} calendar days`}. Your manager's decision counts working days against the holiday calendar.`}
          </p>

          {apply.error !== null && <Failure error={apply.error} />}

          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button
              type="button"
              variant="quiet"
              size="tap"
              className="md:h-control"
              onClick={() => void navigate({ to: "/leave" })}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="tap"
              className="md:h-control"
              disabled={apply.isPending}
            >
              {apply.isPending ? "Sending…" : "Send request"}
            </Button>
          </div>
          {tried && problem !== null && (
            <p role="alert" className="text-center text-meta text-bad">
              {problem}
            </p>
          )}
        </div>
      </Panel>
    </form>
  )
}
