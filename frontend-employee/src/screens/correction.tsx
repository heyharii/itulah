import { useNavigate, useParams } from "@tanstack/react-router"
import { useForm, useStore } from "@tanstack/react-form"
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
import { longDate, punchClock } from "@/lib/format"
import { useAttendance, useRequestCorrection } from "@/lib/hr/queries"

/// A recorded punch time as an `<input type="time">` value, or empty.
///
/// The wire form is `2026-09-14 08:32`, sometimes with a `+1` for a reading
/// after midnight. An input cannot hold the `+1`, so a day like that comes
/// through as the clock alone and the person restates it — which is right:
/// correcting an overnight shift is exactly the case where the time somebody
/// means should be the time somebody typed.
function clockField(at: string | null | undefined): string {
  if (at === null || at === undefined) {
    return ""
  }
  const clock = punchClock(at)
  return /^\d{2}:\d{2}$/.test(clock) ? clock : ""
}

/// What is wrong with the claim, in the order somebody would notice it.
function complaint(value: {
  claimedIn: string
  claimedOut: string
  reason: string
}): string | null {
  if (value.reason.trim() === "") {
    return "Say what happened."
  }
  if (value.claimedIn === "" && value.claimedOut === "") {
    return "Give at least one time."
  }
  return null
}

/// "I was here, the clock says otherwise."
///
/// The day is in the URL rather than picked in the form. You arrive here from
/// the row you are disputing, and a date field would let somebody file a fix
/// against a day they never looked at.
export function Correction() {
  const { date } = useParams({ from: "/attendance/correction/$date" })
  const navigate = useNavigate()
  const days = useAttendance()
  const request = useRequestCorrection()

  const day = (days.data?.days ?? []).find(
    (candidate) => candidate.date === date
  )
  const [tried, setTried] = useState(false)

  const form = useForm({
    // Prefilled from what was actually recorded, so the common case — a missing
    // clock-out at the end of a normal shift — is one field and a sentence.
    //
    // The end that IS recorded is prefilled and the missing one is left blank,
    // rather than filled from the rostered shift. A time the server would have
    // called the plan is not a claim about what happened, and a form that put
    // "18:00" in the box would be asking somebody to sign for a figure this
    // screen invented.
    defaultValues: {
      claimedIn: clockField(day?.arrival),
      claimedOut: clockField(day?.departure),
      reason: "",
    },
    onSubmit: async ({ value }) => {
      if (complaint(value) !== null) {
        return
      }
      await request.mutateAsync({
        date,
        claimed_in: value.claimedIn === "" ? null : value.claimedIn,
        claimed_out: value.claimedOut === "" ? null : value.claimedOut,
        reason: value.reason.trim(),
      })
      await navigate({ to: "/attendance" })
    },
  })

  const problem = useStore(form.store, (state) => complaint(state.values))

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        setTried(true)
        void form.handleSubmit()
      }}
      className="flex flex-col gap-4"
    >
      <Panel title={longDate(date)}>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <form.Field name="claimedIn">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Started</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="time"
                    className="h-11 text-base md:text-sm"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="claimedOut">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Finished</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="time"
                    className="h-11 text-base md:text-sm"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>
          </div>
          <form.Field name="reason">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>What happened</FieldLabel>
                <Textarea
                  id={field.name}
                  name={field.name}
                  rows={3}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="e.g. the kiosk was down when I finished."
                  required
                />
              </Field>
            )}
          </form.Field>
          <FieldDescription>
            Your manager decides this. Nothing is changed until they do.
          </FieldDescription>
          {request.error !== null && <Failure error={request.error} />}
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="h-11"
              onClick={() => void navigate({ to: "/attendance" })}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="lg"
              className="h-11"
              disabled={request.isPending}
            >
              {request.isPending ? "Sending…" : "Send"}
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
