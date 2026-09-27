import { useQuery } from "@tanstack/react-query"

import {
  claimsKeys,
  hireKeys,
  leaveKeys,
  listClaims,
  listCorrections,
  listHireProposals,
  listRuns,
  nextKeys,
  payKeys,
  pendingLeave,
  pendingSwaps,
  punchKeys,
} from "@/lib/queries/people"
import { usePeopleAudience } from "@/screens/people/scope"

/// How many decisions are waiting on the caller — the count on the Overview's
/// sidebar row.
///
/// The same reads, under the same keys, as the Overview screen draws, so the
/// badge and the screen cannot disagree and a visit to one warms the other:
/// leave, attendance corrections and roster swaps to decide, expense claims to
/// sanction, and the hire requests and payroll runs whose next step is the
/// caller's — head office's when a request is proposed or approved and a run
/// is sent, the shop's when a request was sent back.
///
/// Overtime orders nobody has answered are not counted: the answer belongs to
/// the worker, and a badge is a count of the reader's own work.
///
/// `null` until every read that applies has answered, and after any of them
/// fails. A number drawn from half the sources is a number that jumps, and a
/// badge that jumps teaches people to stop reading it.
export function usePeopleWaitingCount(): number | null {
  const employer = usePeopleAudience() === "employer"

  const leave = useQuery({
    queryKey: leaveKeys.pending(),
    queryFn: ({ signal }) => pendingLeave(signal),
  })
  const corrections = useQuery({
    queryKey: punchKeys.corrections(null, true),
    queryFn: ({ signal }) => listCorrections({ pending: true }, signal),
  })
  const swaps = useQuery({
    queryKey: nextKeys.pendingSwaps(),
    queryFn: ({ signal }) => pendingSwaps(signal),
  })
  const claims = useQuery({
    queryKey: claimsKeys.queue(),
    queryFn: ({ signal }) => listClaims({ state: "SUBMITTED" }, signal),
  })
  const hires = useQuery({
    queryKey: hireKeys.list(),
    queryFn: ({ signal }) => listHireProposals(signal),
  })
  /// A run waits on head office alone, so a place never asks.
  const runs = useQuery({
    queryKey: payKeys.runs(),
    queryFn: ({ signal }) => listRuns(signal),
    enabled: employer,
  })

  if (
    leave.data === undefined ||
    corrections.data === undefined ||
    swaps.data === undefined ||
    claims.data === undefined ||
    hires.data === undefined ||
    (employer && runs.data === undefined)
  ) {
    return null
  }

  const hireSteps = hires.data.filter((one) =>
    employer
      ? one.state === "PROPOSED" || one.state === "APPROVED"
      : one.state === "RETURNED"
  ).length
  const runSteps = employer
    ? (runs.data ?? []).filter((one) => one.state === "SUBMITTED").length
    : 0

  return (
    leave.data.length +
    corrections.data.length +
    swaps.data.length +
    claims.data.length +
    hireSteps +
    runSteps
  )
}
