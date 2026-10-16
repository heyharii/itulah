import { useState } from "react"

import { Button } from "@/components/ui/button"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { useDoneLeave, useWaitingRequests } from "@/lib/queries/requests"
import type { StoreScope } from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import { Fenced } from "@/screens/hr/parts"
import { RefusedBanner } from "@/screens/hr/refused"
import { DoneCard, WaitingCard } from "@/screens/hr/requests-card"
import { useTeam } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type { EmployeeList } from "@itulah/contract"

/// Requests — what the store head is asked to say yes or no to: leave and
/// shift swaps, the prototype's *Requests* (11 Oct 2026).
///
/// Two tabs, **To approve** and **Done**, and one full-width card per request
/// (`requests-card.tsx`). The card carries the five facts the owner wants and
/// nothing else.
///
/// The screen makes nothing of its own: there is no "new request" here. An
/// employee asks for leave from their own phone; a request the store files on
/// somebody's behalf is one the person who filed it may not decide (the
/// centre keeps the filer and the decider apart), so it would wait for
/// somebody else rather than for the store head at the counter.
///
/// # What it deliberately is not
///
/// Not overtime — a manager orders overtime and the employee consents, so
/// there is no approval to give (the Overtime screen). Not balances or the
/// holiday calendar — a person's balance is on their Staff sheet, and the
/// calendar is the Schedule's. And no "permit": the kinds of leave are head
/// office's list, and this screen shows whichever of them was asked for.
export function HrLeave() {
  return <HrWorkspace>{(scope) => <Requests scope={scope} />}</HrWorkspace>
}

type Tab = "waiting" | "done"

function Requests({ scope }: { scope: StoreScope }) {
  const [tab, setTab] = useState<Tab>("waiting")
  const team = useTeam(scope)
  const waiting = useWaitingRequests(scope)

  const leaveCount = waiting.items.filter((item) => item.kind === "leave").length
  const swapCount = waiting.items.length - leaveCount

  return (
    <>
      <StatStrip>
        <Stat
          label="To approve"
          value={waiting.leave.isPending ? "—" : waiting.items.length}
          tone={waiting.items.length > 0 ? "warn" : undefined}
        />
        <Stat
          label="Leave"
          value={waiting.leave.isPending ? "—" : leaveCount}
        />
        <Stat
          label="Shift swaps"
          value={waiting.swaps.isPending ? "—" : swapCount}
        />
      </StatStrip>
      <PeopleTabs
        value={tab}
        onChange={setTab}
        tabs={[
          {
            value: "waiting",
            label: "To approve",
            count: waiting.items.length,
          },
          { value: "done", label: "Done" },
        ]}
      />
      {centreState(team, {
        loading: "Reading this shop's people…",
        what: "this shop's people",
        render: (list) =>
          tab === "waiting" ? (
            <ToApprove scope={scope} team={list} waiting={waiting} />
          ) : (
            <Done team={list} />
          ),
      })}
    </>
  )
}

function ToApprove({
  scope,
  team,
  waiting,
}: {
  scope: StoreScope
  team: EmployeeList
  waiting: ReturnType<typeof useWaitingRequests>
}) {
  return centreState(waiting.leave, {
    loading: "Reading the requests…",
    what: "this shop's leave requests",
    render: () => (
      <>
        <Fenced dropped={waiting.elsewhere} place={scope.unit_id} />
        {/* Swaps are read apart from leave: a login that may decide one and
            not the other still has the one. */}
        {waiting.swaps.isError && (
          <RefusedBanner error={waiting.swaps.error} what="shift swaps" />
        )}
        {waiting.items.length === 0 ? (
          <EmptyState>Nothing to approve.</EmptyState>
        ) : (
          <div>
            {waiting.items.map((item) => (
              <WaitingCard key={item.key} item={item} team={team} />
            ))}
          </div>
        )}
      </>
    ),
  })
}

/// How many answered requests are drawn before "Show earlier".
const PAGE = 20

function Done({ team }: { team: EmployeeList }) {
  const done = useDoneLeave(team.rows)
  const [shown, setShown] = useState(PAGE)

  if (done.reading)
    return <LoadingState>Reading what was answered…</LoadingState>

  return (
    <>
      {done.refused !== undefined && (
        <RefusedBanner error={done.refused} what="leave history" />
      )}
      {done.items.length === 0 ? (
        <EmptyState>Nothing has been answered yet.</EmptyState>
      ) : (
        <div>
          {done.items.slice(0, shown).map((item) => (
            <DoneCard key={item.key} item={item} team={team} />
          ))}
          {done.items.length > shown && (
            <div className="flex justify-center pt-1">
              <Button onClick={() => setShown((was) => was + PAGE)}>
                Show earlier
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
