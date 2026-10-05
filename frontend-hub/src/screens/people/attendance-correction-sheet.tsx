import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox, Field, Input, Select } from "@/components/ui/field"
import { Day } from "@/components/ui/day"
import { PickOne, type Choice } from "@/components/ui/pick"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { fileCorrection, punchKeys } from "@/lib/queries/people"

/// File a correction against one person's day.
///
/// A correction states what the reader should have seen — times — and never an
/// outcome; it waits for a second person's decision (the server refuses the
/// same actor). It sits on top of the punches and never over them.
///
/// Leave-covered days (`APPROVED_LEAVE`) are not offered here: that effect
/// needs the leave record named, and the shared client function does not send
/// one. The day is corrected by the person's approved leave instead.
export function FileCorrectionSheet({
  open,
  onClose,
  people,
  defaultDate,
}: {
  open: boolean
  onClose: () => void
  people: readonly Choice[]
  defaultDate: string
}) {
  const client = useQueryClient()
  const [employee, setEmployee] = useState<string | null>(null)
  const [date, setDate] = useState("")
  const [effect, setEffect] = useState("ARRIVAL_AND_DEPARTURE")
  const [arrival, setArrival] = useState("")
  const [departure, setDeparture] = useState("")
  const [nextDay, setNextDay] = useState(false)
  const [reason, setReason] = useState("")

  const needsArrival = effect !== "DEPARTURE"
  const needsDeparture = effect !== "ARRIVAL"
  const shownDate = date === "" ? defaultDate : date

  const reset = () => {
    setEmployee(null)
    setDate("")
    setEffect("ARRIVAL_AND_DEPARTURE")
    setArrival("")
    setDeparture("")
    setNextDay(false)
    setReason("")
  }

  const file = useMutation({
    mutationFn: () =>
      fileCorrection(employee ?? "", {
        businessDate: shownDate,
        effect,
        arrival: needsArrival ? arrival : undefined,
        departure: needsDeparture ? departure : undefined,
        departureDayOffset: needsDeparture && nextDay ? 1 : 0,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: punchKeys.all })
      reset()
      onClose()
    },
  })

  const ready =
    employee !== null &&
    shownDate !== "" &&
    reason.trim() !== "" &&
    (!needsArrival || arrival !== "") &&
    (!needsDeparture || departure !== "")

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          file.reset()
          onClose()
        }
      }}
      title="File a correction"
      caption="Waits for a second person to approve it."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            pending={file.isPending}
            disabled={!ready}
            onClick={() => file.mutate()}
          >
            {file.isPending ? "Filing…" : "File correction"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Employee" required>
          <PickOne
            label="Employee"
            choices={people}
            value={employee}
            onChange={setEmployee}
          />
        </Field>
        <Field label="Day" required>
          <Day value={shownDate} onChange={setDate} clearable={false} />
        </Field>
        <Field label="What was missed" required>
          <Select value={effect} onChange={setEffect}>
            <option value="ARRIVAL_AND_DEPARTURE">Arrival and departure</option>
            <option value="ARRIVAL">Arrival only</option>
            <option value="DEPARTURE">Departure only</option>
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {needsArrival && (
            <Field label="Arrived at" required>
              <Input
                type="time"
                value={arrival}
                onChange={(event) => setArrival(event.target.value)}
              />
            </Field>
          )}
          {needsDeparture && (
            <Field label="Left at" required>
              <Input
                type="time"
                value={departure}
                onChange={(event) => setDeparture(event.target.value)}
              />
            </Field>
          )}
        </div>
        {needsDeparture && (
          <Checkbox
            checked={nextDay}
            onChange={setNextDay}
            label="They left after midnight, on the same shift"
          />
        )}
        <Field
          label="Why"
          hint="Recorded against the correction, and required."
          required
        >
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {file.isError && <Banner tone="bad">{file.error.message}</Banner>}
      </div>
    </Sheet>
  )
}
