import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import {
  currentPlacement,
  makeLine,
  membersOf,
  pendingBossChanges,
  type Line,
} from "@/lib/line"
import {
  changeProposalsQuery,
  hrKeys,
  isoDay,
  placementsQuery,
  proposeReportsTo,
  type StoreScope,
} from "@/lib/queries/hr"
import type { ChangeProposalView, EmployeeSummary } from "@itulah/contract"

/// The shop's line of report, read from head office.
///
/// One placements read per person (`GET /employees/{id}/placements`, newest
/// first — the centre has no one-call "who reports to whom"), all in parallel,
/// each cached under its own key. The proposals already filed are one more read
/// (`GET /change-proposals`, the same key the Changes screen uses) and say who
/// is waiting on head office.
///
/// Three states, because a chart drawn from half the answers is a chart with
/// the wrong people on top:
///
///  - `pending` — at least one person's placement is still coming;
///  - `failed` — at least one was refused or the line is down, and `error` is
///    the first of them (a 403/404 means the centre this shop reaches does not
///    serve placements to a shop yet, and asking again will not change that);
///  - `ready` — everyone answered, and `line` is drawn from it.
export type LineRead =
  | { state: "pending"; line: null; error: null; refetch: () => void }
  | { state: "failed"; line: null; error: unknown; refetch: () => void }
  | { state: "ready"; line: Line; error: null; refetch: () => void }

export function useLine(
  scope: StoreScope,
  staff: readonly EmployeeSummary[],
): LineRead {
  const placements = useQueries({
    queries: staff.map((person) => placementsQuery(person.employee_id)),
  })
  const proposals = useQuery(changeProposalsQuery(scope.unit_id))

  const refetch = () => {
    for (const read of placements) if (read.isError) void read.refetch()
  }

  const failed = placements.find((read) => read.isError)
  if (failed !== undefined) {
    return { state: "failed", line: null, error: failed.error, refetch }
  }
  if (placements.some((read) => read.data === undefined)) {
    return { state: "pending", line: null, error: null, refetch }
  }

  const today = isoDay(new Date())
  const bossIds = new Map<string, string | null>(
    staff.map((person, index) => [
      person.employee_id,
      currentPlacement(placements[index]?.data, today)?.reports_to ?? null,
    ]),
  )
  return {
    state: "ready",
    line: makeLine(
      staff,
      bossIds,
      pendingBossChanges(proposals.data, membersOf(staff)),
    ),
    error: null,
    refetch,
  }
}

/// Send head office a new boss for one person. The shop proposes; head office
/// decides, and nothing about the chart changes until it does — the proposal
/// only shows as *Waiting for HO* on the person's card.
export function useProposeBoss(scope: StoreScope) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      employeeId: string
      bossId: string
      reason: string
    }) =>
      proposeReportsTo({
        employeeId: input.employeeId,
        bossId: input.bossId,
        // A boss is wanted from today; head office may date it otherwise when
        // it decides.
        effectiveOn: isoDay(new Date()),
        reason: input.reason,
      }),
    onSuccess: async (created: ChangeProposalView) => {
      // The card says *Waiting for HO* at once, not after the next read.
      client.setQueryData<ChangeProposalView[]>(
        hrKeys.changes(scope.unit_id),
        (old) => (old === undefined ? old : [created, ...old]),
      )
      await client.invalidateQueries({
        queryKey: hrKeys.changes(scope.unit_id),
      })
    },
  })
}
