import { useState } from "react"

import { Failure, List, Loading, Panel } from "@/components/bits"
import { StatusPill } from "@/components/status-pill"
import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { dateRange, longDate } from "@/lib/format"
import {
  useDecideCorrection,
  useDecideLeaveRequest,
  useDecideSwap,
  useTeamQueue,
} from "@/lib/hr/queries"

/// The store head's desk, on the phone.
///
/// One place for everything waiting on *this* person's decision — leave,
/// corrections, swaps. Overtime is deliberately absent as a decision: the
/// answer belongs to the person whose evening it is, and it arrives on their
/// own screen. The server bounds every read and every decision here by the
/// caller's own posting; nothing here can decide another shop's anything.
export function Team() {
  const queue = useTeamQueue()
  const decideLeave = useDecideLeaveRequest()
  const decideCorrection = useDecideCorrection()
  const decideSwap = useDecideSwap()

  const reads = [queue.leave, queue.corrections, queue.swaps]
  const leave = queue.leave.data ?? []
  const corrections = queue.corrections.data ?? []
  const swaps = queue.swaps.data ?? []
  const waiting = leave.length + corrections.length + swaps.length
  const failed = reads.find((read) => read.error !== null)?.error

  return (
    <Panel
      title={
        reads.some((read) => read.isPending)
          ? "Waiting on you"
          : `Waiting on you (${waiting})`
      }
    >
      {failed !== undefined && <Failure error={failed} />}
      {reads.every((read) => read.isPending) ? (
        <Loading />
      ) : waiting === 0 && failed === undefined ? (
        <p className="py-6 text-center text-meta text-body">
          Nothing is waiting on you.
        </p>
      ) : (
        <List>
          {leave.map((request) => (
            <Decision
              key={request.id}
              title={request.leave_type_name}
              state={request.state}
              who={request.employee_id}
              detail={`${dateRange(request.from_date, request.to_date)} · ${
                request.chargeable_days === 1
                  ? "1 day"
                  : `${request.chargeable_days} days`
              }`}
              note={request.reason}
              pending={decideLeave.isPending}
              onDecide={(approve, reason) =>
                decideLeave.mutateAsync({
                  employeeId: request.employee_id,
                  requestId: request.id,
                  approve,
                  reason,
                })
              }
            />
          ))}

          {corrections.map((correction) => (
            <Decision
              key={correction.id}
              title="Attendance correction"
              state={correction.state}
              who={correction.employee_id}
              detail={longDate(correction.business_date)}
              note={correction.reason}
              pending={decideCorrection.isPending}
              onDecide={(approve, reason) =>
                decideCorrection.mutateAsync({
                  id: correction.id,
                  approve,
                  reason,
                })
              }
            />
          ))}

          {swaps.map((swap) => (
            <Decision
              key={swap.id}
              title="Day swap"
              state={swap.state}
              who={`${swap.employee_id} ↔ ${swap.with_employee_id}`}
              detail={longDate(swap.on_date)}
              note={swap.reason}
              pending={decideSwap.isPending}
              onDecide={(approve, reason) =>
                decideSwap.mutateAsync({ id: swap.id, approve, reason })
              }
            />
          ))}
        </List>
      )}
    </Panel>
  )
}

/// One row waiting on a decision.
///
/// The reason is asked for both ways: the server records one against every
/// decision, and a refusal nobody explained is one somebody can later
/// characterise however they like.
function Decision({
  title,
  state,
  who,
  detail,
  note,
  pending,
  onDecide,
}: {
  title: string
  state: string
  who: string
  detail: string
  note: string
  pending: boolean
  onDecide: (approve: boolean, reason: string) => Promise<unknown>
}) {
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<unknown>(null)
  const ready = reason.trim() !== "" && !pending

  const decide = (approve: boolean) => {
    onDecide(approve, reason.trim())
      .then(() => setFailed(null))
      .catch((error: unknown) => setFailed(error))
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <p className="text-cell font-medium text-ink">{title}</p>
          <p className="text-meta text-body">{detail}</p>
          <p className="truncate font-mono text-id text-mute">{who}</p>
        </div>
        <StatusPill status={state} className="ml-auto" />
      </div>
      {note !== "" && <p className="text-meta text-text">“{note}”</p>}
      <Field label="Your reason">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {failed !== null && <Failure error={failed} />}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={!ready}
          onClick={() => decide(true)}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={!ready}
          onClick={() => decide(false)}
        >
          Refuse
        </Button>
      </div>
    </div>
  )
}
