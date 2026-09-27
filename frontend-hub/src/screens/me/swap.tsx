import { useState } from "react"

import { Panel } from "@/screens/me/ui/bits"
import { Button } from "@/screens/me/ui/button"
import { Day, Field, Input, Select, TAP } from "@/screens/me/ui/field"
import { longDate } from "@/screens/me/data/format"
import {
  useColleagues,
  useFileSwap,
  useMySwaps,
  useWithdrawSwap,
} from "@/screens/me/data/queries"
import { StatusPill } from "@/screens/me/ui/status-pill"

/// Swap a day with a colleague.
///
/// The request names the person and the day; the store head decides, and the
/// roster moves both ways or not at all. Until it is decided the day is
/// yours, so a pending swap shows as pending rather than as done. The
/// colleague picker lists who else is planned this week at your own place —
/// names and shift words, which is all a swap needs and all it asks for.
export function Swap() {
  const mine = useMySwaps()
  const withdraw = useWithdrawSwap()
  const [onDate, setOnDate] = useState("")
  const [withEmployeeId, setWithEmployeeId] = useState("")
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const file = useFileSwap()
  // Colleagues are read once a date is chosen: the picker answers "who is
  // planned that day and what are they on", not "who exists".
  const colleagues = useColleagues(onDate === "" ? null : onDate)

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Ask for a swap">
        <div className="flex flex-col gap-3">
          <Field label="The day you want to give">
            <Day
              value={onDate}
              onChange={setOnDate}
              label="The day you want to give"
              placeholder="Choose a day"
              clearable={false}
              className={TAP}
            />
          </Field>
          {onDate !== "" && (
            <Field label="Swap with">
              <Select
                value={withEmployeeId}
                onChange={setWithEmployeeId}
                aria-label="Swap with"
                className={TAP}
              >
                <option value="">Choose a colleague…</option>
                {(colleagues.data ?? []).map((colleague) => {
                  const day = colleague.days[0]
                  return (
                    <option
                      key={colleague.employee_id}
                      value={colleague.employee_id}
                    >
                      {colleague.name}
                      {day !== undefined &&
                        ` · ${day.plan.toLowerCase().replace(/_/g, " ")}`}
                    </option>
                  )
                })}
              </Select>
            </Field>
          )}
          <Field label="Why">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {failed !== null && <p className="text-meta text-bad">{failed}</p>}
          <Button
            variant="primary"
            size="tap"
            disabled={
              onDate === "" ||
              withEmployeeId === "" ||
              reason.trim() === "" ||
              file.isPending
            }
            onClick={() =>
              file.mutate(
                { with_employee_id: withEmployeeId, on_date: onDate, reason },
                {
                  onSuccess: () => {
                    setOnDate("")
                    setWithEmployeeId("")
                    setReason("")
                    setFailed(null)
                  },
                  onError: (error: Error) => setFailed(error.message),
                }
              )
            }
          >
            Send to the store head
          </Button>
        </div>
      </Panel>

      <Panel title="My requests">
        <div className="flex flex-col gap-3">
          {(mine.data ?? []).length === 0 ? (
            <p className="text-meta text-mute">
              You have not asked to swap a day.
            </p>
          ) : (
            (mine.data ?? []).map((swap) => (
              <div key={swap.id} className="flex flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-cell font-medium text-ink">
                    {longDate(swap.on_date)}
                  </p>
                  <StatusPill status={swap.state} className="ml-auto" />
                </div>
                <p className="text-meta text-body">{swap.reason}</p>
                {swap.state === "PENDING" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={withdraw.isPending}
                    onClick={() => withdraw.mutate(swap.id)}
                  >
                    Take back
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  )
}
