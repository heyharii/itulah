import { useQuery } from "@tanstack/react-query"
import { useHydrated } from "@tanstack/react-router"

import {
  changeProposalsQuery,
  hrEmployeeKeys,
  listDataRequests,
} from "@/lib/queries/hr-employees"
import {
  claimsKeys,
  hireKeys,
  leaveKeys,
  listClaims,
  listHireProposals,
  listCorrections,
  listRuns,
  nextKeys,
  payKeys,
  pendingLeave,
  pendingSwaps,
  punchKeys,
} from "@/lib/queries/people"
import { usePeopleAudience } from "@/screens/people/scope"

/// Every read behind HR's one inbox (Overview › Requests): leave, attendance
/// corrections and roster swaps to decide, expense claims to sanction, and —
/// head office's alone — payroll runs a place has sent, employment changes
/// and employees' requests to change their own details.
///
/// One hook for the inbox and its badge, so the count on the Overview row is
/// the number of rows the Overview lists and cannot drift from it (an audit of
/// 16 Oct 2026 found the badge counting hire proposals no screen showed; they
/// are rows of the inbox again since, with their own sheet).
///
/// Overtime orders nobody has answered are not here: the answer belongs to
/// the worker, and an inbox is the reader's own work.
export function usePeopleInbox() {
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
  /// A run waits on head office alone, so a place never asks.
  const runs = useQuery({
    queryKey: payKeys.runs(),
    queryFn: ({ signal }) => listRuns(signal),
    enabled: employer,
  })
  /// Changes and detail requests are decided by head office (Changes is its
  /// tab alone), so a place never asks either.
  const changes = useQuery({ ...changeProposalsQuery(), enabled: employer })
  const details = useQuery({
    queryKey: hrEmployeeKeys.dataRequests(false),
    queryFn: ({ signal }) => listDataRequests(false, signal),
    enabled: employer,
  })
  /// A store's request for a new person, decided by head office (owner,
  /// 2026-10-16) — and, once approved, waiting for its account.
  const hires = useQuery({
    queryKey: hireKeys.list(),
    queryFn: ({ signal }) => listHireProposals(signal),
    enabled: employer,
  })

  return {
    employer,
    leave,
    corrections,
    swaps,
    claims,
    runs,
    changes,
    details,
    hires,
    /// Only the rows that are waiting: the runs a place has sent, the
    /// changes and requests still pending. Empty while a read is out.
    waitingRuns: (runs.data ?? []).filter((one) => one.state === "SUBMITTED"),
    waitingChanges: (changes.data ?? []).filter(
      (one) => one.state === "PENDING"
    ),
    waitingDetails: (details.data ?? []).filter(
      (one) => one.state === "PENDING"
    ),
    waitingHires: (hires.data ?? []).filter(
      (one) =>
        one.state === "PROPOSED" ||
        (one.state === "APPROVED" && one.outstanding > 0)
    ),
  }
}

/// How many decisions are waiting on the caller — the count on the Overview's
/// sidebar row, and the rows its inbox lists.
///
/// `null` until the page is hydrated and every read that applies has answered,
/// and after any of them fails. A number drawn from half the sources is a
/// number that jumps, and a badge that jumps teaches people to stop reading it.
export function usePeopleWaitingCount(): number | null {
  // Not before the page is hydrated: these are the reads People's own screens
  // start on the server, so by then the cache may already hold them, and a
  // count drawn from it would be one the server's HTML did not have.
  const hydrated = useHydrated()
  const inbox = usePeopleInbox()

  if (
    !hydrated ||
    inbox.leave.data === undefined ||
    inbox.corrections.data === undefined ||
    inbox.swaps.data === undefined ||
    inbox.claims.data === undefined ||
    (inbox.employer &&
      (inbox.runs.data === undefined ||
        inbox.changes.data === undefined ||
        inbox.details.data === undefined ||
        inbox.hires.data === undefined))
  ) {
    return null
  }

  return (
    inbox.leave.data.length +
    inbox.corrections.data.length +
    inbox.swaps.data.length +
    inbox.claims.data.length +
    inbox.waitingRuns.length +
    inbox.waitingChanges.length +
    inbox.waitingDetails.length +
    inbox.waitingHires.length
  )
}
