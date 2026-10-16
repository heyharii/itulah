import { useQuery } from "@tanstack/react-query"

import type { PillProps } from "@/components/ui/pill"
import { pendingSwapsQuery, teamQuery, type StoreScope } from "@/lib/queries/hr"
import type { EmployeeList, EmployeeSummary } from "@itulah/contract"

/// The People screens' shared words and reads — everything in the module that
/// is not a component: who works here, what a state is called, what a day was.
///
/// Apart from `parts.tsx` because that one exports components, and a file that
/// exports both cannot be hot-reloaded as a component module.

export type Tone = NonNullable<PillProps["tone"]>

/// Who works here — the one list every screen names people from.
///
/// The same key the Directory reads, so opening any People screen after it
/// costs no second round trip to head office.
export function useTeam(scope: StoreScope) {
  return useQuery(teamQuery(scope.unit_id))
}

/// The people on the books, active or not, as the list gives them.
export function teamRows(team: EmployeeList | undefined): EmployeeSummary[] {
  return team?.rows ?? []
}

/// The plain name, for a sentence or a sheet title.
export function personName(team: EmployeeList | undefined, id: string): string {
  const row = team?.rows.find((person) => person.employee_id === id)
  return row?.full_name ?? row?.employee_code ?? id
}

/// A person by the LOGIN a record carries ("asked by", "decided by"), as their
/// full name — a login is never shown (owner: employees are always full names).
/// A login the list does not know (head office staff, a retired account) is
/// shown as it is.
export function personByLogin(
  team: EmployeeList | undefined,
  login: string | null | undefined,
): string {
  if (login === null || login === undefined || login === "") return "—"
  const row = team?.rows.find((person) => person.username === login)
  return row?.full_name ?? login
}

/// What a request's state is called — the audit's canonical four (D5):
/// **Pending / Approved / Rejected / Withdrawn**, on every request in this
/// module (leave, expenses, swaps, overtime, changes, hires). Never "Waiting
/// on …", "Refused", "Declined" or "Taken back": who is being waited on is a
/// fact for the sheet's facts, not part of the state's name.
export function requestState(state: string): { label: string; tone: Tone } {
  switch (state) {
    case "PENDING":
      return { label: "Pending", tone: "warn" }
    case "APPROVED":
      return { label: "Approved", tone: "ok" }
    case "REJECTED":
      return { label: "Rejected", tone: "bad" }
    case "WITHDRAWN":
      return { label: "Withdrawn", tone: "neutral" }
    default:
      return { label: state, tone: "neutral" }
  }
}

/// The seven outcome codes a derived day carries, in the words a shop uses.
///
/// `MISSING_PUNCH` is the one that is not a statement about the person — the
/// centre calls it "a question, not a verdict" — so it is the one code that
/// does not wear a colour saying somebody did something wrong. A code this
/// build has not been taught is shown as the server spelled it.
export function outcomeWord(code: string): { label: string; tone: Tone } {
  switch (code) {
    case "ON_TIME":
      return { label: "On time", tone: "ok" }
    case "LATE":
      return { label: "Late", tone: "warn" }
    case "EARLY_LEAVE":
      return { label: "Left early", tone: "warn" }
    case "ABSENT":
      return { label: "Absent", tone: "bad" }
    case "MISSING_PUNCH":
      return { label: "Missing punch", tone: "neutral" }
    case "APPROVED_LEAVE":
      return { label: "On leave", tone: "info" }
    case "AGREED_OVERTIME":
      return { label: "Overtime", tone: "accent" }
    default:
      return { label: code, tone: "neutral" }
  }
}

/// One person's today, in one pill — the prototype's `attState()`.
///
/// Built from the rota and the derived day together, because each knows half:
/// the rota says whether somebody was due in, the derivation says whether
/// anything saw them. **When no punch source has ever reported for this shop,
/// nobody is "not clocked in"** — there was nothing that could have seen them,
/// and a red pill would be a claim that somebody looked.
export function dayStatus(input: {
  plan: string | null
  outcomes: readonly string[]
  arrival: string | null
  connected: boolean
}): { label: string; tone: Tone } {
  if (input.plan === "REST_DAY") return { label: "Day off", tone: "neutral" }
  if (input.plan === "PUBLIC_HOLIDAY") {
    return { label: "Public holiday", tone: "neutral" }
  }
  if (input.outcomes.includes("APPROVED_LEAVE")) {
    return { label: "On leave", tone: "info" }
  }
  if (input.arrival !== null) {
    return input.outcomes.includes("LATE")
      ? { label: "Late", tone: "warn" }
      : { label: "Present", tone: "ok" }
  }
  if (input.plan === null) return { label: "Not rostered", tone: "neutral" }
  if (!input.connected) return { label: "Not assessed", tone: "neutral" }
  return { label: "Not clocked in", tone: "bad" }
}

/// The swaps this shop is waiting on, fenced to this shop.
export function usePendingSwaps(scope: StoreScope) {
  return useQuery(pendingSwapsQuery(scope.unit_id))
}
