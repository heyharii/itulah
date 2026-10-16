import type { QueryClient } from "@tanstack/react-query"

import { warmQuery, type PrefetchMap } from "@/lib/prefetch"
import {
  adjustmentsQuery,
  applicantsQuery,
  attendanceTodayQuery,
  awaitingOvertimeQuery,
  changeProposalsQuery,
  claimsQuery,
  correctionsQuery,
  hireProposalsQuery,
  isoDay,
  lifecycleTasksQuery,
  monthBefore,
  payComponentsQuery,
  pendingLeaveQuery,
  pendingSwapsQuery,
  periodQuery,
  punchReadinessQuery,
  relayedUnit,
  relayReady,
  rosterQuery,
  rulesQuery,
  shiftsQuery,
  staffingPlansQuery,
  storeTasksQuery,
  teamQuery,
} from "@/lib/queries/hr"
import { payMonths } from "@/lib/queries/payroll"
import { daysBefore, daysOfWeek, mondayOf } from "@/lib/queries/schedule"
import { weekOf } from "@/lib/queries/staff"

/// What each People screen asks first, before it is open (`lib/prefetch.ts`).
/// The options are the screens' own (`lib/queries/hr.ts`).
///
/// Every one of these is answered by head office through the node's relay, so
/// none is warmed while idle (there is no `warm` here): a read nobody asked
/// for would spend the shop's one line to the centre.
///
/// A screen opens behind the gate (`workspace.tsx`): somebody the node can
/// relay for, and a reach that names exactly one unit. The prefetchers ask the
/// same questions of the same cache and stop quietly where the gate would stop.
/// Per-person reads (a leave history, a month of attendance, a uniform ledger)
/// are left to the screen: they depend on who the team is, scale with
/// headcount, and the screens draw a cell as a dash until each one lands.

/// Ask for something that needs no unit — only somebody this node can relay
/// for. Answered from the cache, so it starts at once and does not wait for
/// the reach.
function relayed(client: QueryClient, ask: () => Promise<unknown>) {
  return relayReady(client) ? ask() : undefined
}

/// Ask for this shop's reads, once the reach has said which unit it is. The
/// team always comes with them: it is how a card names a person.
async function inUnit(
  client: QueryClient,
  ask?: (unit: string) => Promise<unknown>,
) {
  const unit = await relayedUnit(client)
  if (unit === null) return
  await Promise.all([warmQuery(client, teamQuery(unit)), ask?.(unit)])
}

export const prefetch: PrefetchMap = {
  // Today: every read its figures and its lists are made of.
  "/hr/overview": (client) => {
    const now = new Date()
    const today = isoDay(now)
    const lastMonth = monthBefore(now)
    return Promise.all([
      relayed(client, () => warmQuery(client, storeTasksQuery())),
      inUnit(client, (unit) =>
        Promise.all([
          warmQuery(client, rosterQuery(unit, today, today)),
          warmQuery(client, attendanceTodayQuery(unit, today)),
          warmQuery(client, pendingLeaveQuery(unit)),
          warmQuery(client, correctionsQuery(unit, true)),
          warmQuery(client, pendingSwapsQuery(unit)),
          warmQuery(client, claimsQuery(unit)),
          warmQuery(client, periodQuery(unit, lastMonth)),
          warmQuery(client, applicantsQuery(unit)),
        ]),
      ),
    ])
  },

  // Staff: the list, the requests to head office, and this week's rota for the
  // hours column.
  "/hr/directory": (client) => {
    const week = weekOf(new Date())
    return inUnit(client, (unit) =>
      Promise.all([
        warmQuery(client, hireProposalsQuery(unit)),
        warmQuery(client, rosterQuery(unit, week.from, week.to)),
      ]),
    )
  },

  // Schedule: this week and the one before it ("Same as last week"). The week
  // is in the address bar, and only this week's is the default.
  "/hr/roster": (client, { search }) => {
    const from = isoDay(mondayOf(new Date()))
    if (typeof search.week === "string" && search.week !== from) return
    const to = daysOfWeek(from)[6] as string
    const before = daysBefore(from)
    return Promise.all([
      relayed(client, () => warmQuery(client, shiftsQuery())),
      inUnit(client, (unit) =>
        Promise.all([
          warmQuery(client, rosterQuery(unit, from, to)),
          warmQuery(
            client,
            rosterQuery(unit, before[0] as string, before[6] as string),
          ),
          warmQuery(client, pendingSwapsQuery(unit)),
        ]),
      ),
    ])
  },

  // Requests: To approve — the leave queue and the swap queue.
  "/hr/leave": (client) =>
    inUnit(client, (unit) =>
      Promise.all([
        warmQuery(client, pendingLeaveQuery(unit)),
        warmQuery(client, pendingSwapsQuery(unit)),
      ]),
    ),

  // Attendance: the day tab — pending fixes and swaps for the count, and
  // today's rota and derived day.
  "/hr/attendance": (client) => {
    const today = isoDay(new Date())
    return inUnit(client, (unit) =>
      Promise.all([
        warmQuery(client, correctionsQuery(unit, true)),
        warmQuery(client, pendingSwapsQuery(unit)),
        warmQuery(client, rosterQuery(unit, today, today)),
        warmQuery(client, attendanceTodayQuery(unit, today)),
      ]),
    )
  },

  // Overtime: the queue and the rules it is paid under.
  "/hr/overtime": (client) =>
    Promise.all([
      relayed(client, () => warmQuery(client, rulesQuery("overtime"))),
      inUnit(client, (unit) => warmQuery(client, awaitingOvertimeQuery(unit))),
    ]),

  // Recruitment: the headcount plan, what has been asked for, the candidates.
  "/hr/recruitment": (client) =>
    inUnit(client, (unit) =>
      Promise.all([
        warmQuery(client, staffingPlansQuery(unit)),
        warmQuery(client, hireProposalsQuery(unit)),
        warmQuery(client, applicantsQuery(unit)),
      ]),
    ),

  // Onboarding and exit: the checklist rows.
  "/hr/lifecycle": (client) =>
    Promise.all([
      relayed(client, () => warmQuery(client, lifecycleTasksQuery())),
      inUnit(client),
    ]),

  // Payroll: this month's one-offs and the components they are filed under.
  "/hr/pay": (client) => {
    const month = payMonths(new Date()).at(-1)
    if (month === undefined) return
    return Promise.all([
      relayed(client, () => warmQuery(client, payComponentsQuery())),
      inUnit(client, (unit) =>
        warmQuery(client, adjustmentsQuery(unit, month)),
      ),
    ])
  },

  // Period close: it opens on last month.
  "/hr/payroll": (client) => {
    const month = monthBefore(new Date())
    return inUnit(client, (unit) =>
      Promise.all([
        warmQuery(client, periodQuery(unit, month)),
        warmQuery(client, punchReadinessQuery(unit, month)),
      ]),
    )
  },

  // Expenses: Claims — the list and the limits printed over it.
  "/hr/expenses": (client) =>
    Promise.all([
      relayed(client, () => warmQuery(client, rulesQuery("claim"))),
      inUnit(client, (unit) => warmQuery(client, claimsQuery(unit))),
    ]),

  // Benefits: both rule groups are read as it opens, whichever tab is shown.
  "/hr/benefits": (client) =>
    Promise.all([
      relayed(client, () => warmQuery(client, rulesQuery("benefit"))),
      relayed(client, () => warmQuery(client, rulesQuery("statutory"))),
      inUnit(client),
    ]),

  // Employment changes: Proposals.
  "/hr/changes": (client) =>
    inUnit(client, (unit) => warmQuery(client, changeProposalsQuery(unit))),
}
