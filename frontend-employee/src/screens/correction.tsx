import { useNavigate, useParams } from "@tanstack/react-router"
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
import { longDate } from "@/lib/format"
import { useAttendance, useRequestCorrection } from "@/lib/hr/queries"

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

  const day = (days.data ?? []).find((candidate) => candidate.date === date)
  // Prefilled from what the clock did record, so the common case — a missing
  // clock-out at the end of a normal shift — is one field and a sentence.
  const [claimedIn, setClaimedIn] = useState(
    day?.first_in === null || day?.first_in === undefined
      ? (day?.scheduled_from ?? "")
      : new Date(day.first_in).toTimeString().slice(0, 5)
  )
  const [claimedOut, setClaimedOut] = useState(
    day?.last_out === null || day?.last_out === undefined
      ? (day?.scheduled_to ?? "")
      : new Date(day.last_out).toTimeString().slice(0, 5)
  )
  const [reason, setReason] = useState("")
  const [tried, setTried] = useState(false)

  const problem =
    reason.trim() === ""
      ? "Say what happened."
      : claimedIn === "" && claimedOut === ""
        ? "Give at least one time."
        : null

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTried(true)
    if (problem !== null) {
      return
    }
    await request.mutateAsync({
      date,
      claimed_in: claimedIn === "" ? null : claimedIn,
      claimed_out: claimedOut === "" ? null : claimedOut,
      reason: reason.trim(),
    })
    await navigate({ to: "/attendance" })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Panel title={longDate(date)}>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="in">Started</FieldLabel>
              <Input
                id="in"
                type="time"
                className="h-11 text-base md:text-sm"
                value={claimedIn}
                onChange={(event) => setClaimedIn(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="out">Finished</FieldLabel>
              <Input
                id="out"
                type="time"
                className="h-11 text-base md:text-sm"
                value={claimedOut}
                onChange={(event) => setClaimedOut(event.target.value)}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="what">What happened</FieldLabel>
            <Textarea
              id="what"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. the kiosk was down when I finished."
              required
            />
          </Field>
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
