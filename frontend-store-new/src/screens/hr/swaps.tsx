import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { Pill } from "@/components/ui/pill"
import { CENTRAL_KEY_PREFIX } from "@/lib/cloud"
import { decideSwap, hrKeys, readDate, type StoreScope } from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import { Decision, Facts, Fenced, Person } from "@/screens/hr/parts"
import { personName, requestState, usePendingSwaps } from "@/screens/hr/words"
import type { EmployeeList, RosterSwapView } from "@itulah/contract"

/// Shift swaps waiting on the store head — the prototype's *Tukar shift*.
///
/// One list, drawn in two places, because the prototype draws it in two: as
/// the callout over the Roster (a swap is a change to the week somebody is
/// looking at) and under Attendance's "Fixes & swaps" (a swap is one of the
/// things that decides who should have been here). The rows and the decision
/// are the same in both, so they live here once.
///
/// Moved here from the old combined requests screen, which held leave,
/// overtime and swaps in one queue before the menu took the prototype's shape.

export function SwapList({
  scope,
  team,
}: {
  scope: StoreScope
  team: EmployeeList | undefined
}) {
  const swaps = usePendingSwaps(scope)
  const [open, setOpen] = useState<RosterSwapView | null>(null)

  return (
    <>
      {centreState(swaps, {
        loading: "Reading the swap requests…",
        what: "this shop's swap requests",
        render: (queue) => (
          <>
            <Fenced dropped={queue.elsewhere} place={scope.id} />
            <PeopleTable
              rows={queue.rows}
              rowKey={(swap) => swap.id}
              onRowClick={setOpen}
              empty={`Nobody at ${scope.label} is asking to swap a day.`}
              columns={[
                {
                  key: "who",
                  header: "Employee",
                  cell: (swap) => <Person team={team} id={swap.employee_id} />,
                },
                {
                  key: "with",
                  header: "Swap with",
                  card: "meta",
                  cell: (swap) => personName(team, swap.with_employee_id),
                },
                {
                  key: "on",
                  header: "Day",
                  card: "meta",
                  cell: (swap) => readDate(swap.on_date, true),
                },
                {
                  key: "why",
                  header: "Reason",
                  card: "meta",
                  className: "whitespace-normal",
                  cell: (swap) => swap.reason,
                },
                {
                  key: "state",
                  header: "Status",
                  card: "status",
                  cell: (swap) => {
                    const state = requestState(swap.state)
                    return <Pill tone={state.tone}>{state.label}</Pill>
                  },
                },
              ]}
            />
          </>
        ),
      })}
      {open !== null && (
        <SwapSheet
          key={open.id}
          swap={open}
          team={team}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}

/// One swap, and the store head's decision on it. Approving moves both days on
/// the rota in one act at the centre; refusing keeps the ask as the record that
/// somebody looked.
export function SwapSheet({
  swap,
  team,
  onClose,
}: {
  swap: RosterSwapView
  team: EmployeeList | undefined
  onClose: () => void
}) {
  const client = useQueryClient()
  const decide = useMutation({
    mutationFn: (input: { approved: boolean; reason: string }) =>
      decideSwap({ id: swap.id, ...input }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.swaps() })
      // The rota moved too, on approval, and so did what today looks like.
      client.invalidateQueries({
        queryKey: [CENTRAL_KEY_PREFIX, "hr", "roster"],
      })
      client.invalidateQueries({ queryKey: hrKeys.attendance() })
      onClose()
    },
  })
  const state = requestState(swap.state)

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Shift swap"
      title={`${personName(team, swap.employee_id)} ↔ ${personName(team, swap.with_employee_id)}`}
      sub={readDate(swap.on_date, true)}
      status={<Pill tone={state.tone}>{state.label}</Pill>}
      foot={
        swap.state === "PENDING" ? (
          <Decision
            placeholder="Two on the morning shift either way"
            pending={decide.isPending}
            error={decide.error}
            onDecide={(approved, reason) => decide.mutate({ approved, reason })}
          />
        ) : undefined
      }
    >
      <SheetSection title="The ask">
        <Facts
          rows={[
            ["Asked by", swap.requested_by],
            ["Day", readDate(swap.on_date, true)],
            ["Because", swap.reason],
          ]}
        />
      </SheetSection>
      <p className="text-meta text-mute">
        Approved: both people's days are swapped on the rota at once, and the
        attendance sheet follows. Refused: the rota stays as it is.
      </p>
    </PeopleSheet>
  )
}
