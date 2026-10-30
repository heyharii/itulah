import { count } from "@/lib/format"
import { readDate } from "@/lib/queries/hr"
import { currentTerms } from "@/lib/queries/staff"
import type { Tone } from "@/screens/hr/words"
import type {
  EmployeeList,
  EmployeeSummary,
  HireProposalView,
} from "@itulah/contract"

/// The words on the Staff screen: what a contract says, what a request to head
/// office is called while it waits, how a week's hours are written.
///
/// Apart from the components for the reason `words.ts` gives: a file that
/// exports both cannot be hot-reloaded as a component module.

/// A fixed term ending within this many days is drawn red — the prototype's
/// five weeks, enough to renew or replace somebody before the day.
const SOON_DAYS = 35

/// Whole days from today, or `null` when there is no date. Negative means it
/// has already passed, which a contract list has to be able to say.
export function daysUntil(iso: string | null): number | null {
  if (iso === null) return null
  const then = new Date(`${iso}T00:00:00`).getTime()
  if (Number.isNaN(then)) return null
  const now = new Date()
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime()
  return Math.round((then - midnight) / 86_400_000)
}

/// Whether this person's fixed term is close to its end (or past it).
export function endsSoon(person: EmployeeSummary): boolean {
  const left = daysUntil(person.contract_ends_on)
  return person.contract_kind === "PKWT" && left !== null && left <= SOON_DAYS
}

/// `38 h`, `37,5 h` — the rupiah's own decimal comma, as the rest of the
/// prototype writes a figure. Minutes on the wire, never a fractional hour.
export function hoursText(minutes: number): string {
  return `${count(Math.round(minutes / 6) / 10)} h`
}

/// A contract in a line under a name: `PKWT until 01 May 2027`, or
/// `PKWTT · permanent`. Not through `label()`: PKWT and PKWTT are the Act's
/// own initials.
export function contractLine(
  kind: string | null,
  endsOn: string | null,
): string {
  if (kind === null) return "—"
  if (kind === "PKWT") {
    return endsOn === null ? "PKWT" : `PKWT until ${readDate(endsOn)}`
  }
  return kind === "PKWTT" ? "PKWTT · permanent" : kind
}

/// What a request to head office is called while it waits, and once it has
/// been answered. The prototype's words — *Waiting for HO*, *Declined* — and
/// not the module's Pending / Rejected: the question the store is asking is
/// "has head office answered", and this says it.
///
/// `APPROVED` is not "hired": it is permission to open a record, and the
/// owner decided that a screen must not say more than that.
export function hireState(proposal: HireProposalView): {
  label: string
  tone: Tone
} {
  switch (proposal.state) {
    case "PROPOSED":
      return { label: "Waiting for HO", tone: "warn" }
    case "RETURNED":
      return { label: "Sent back", tone: "warn" }
    case "APPROVED":
    case "FILLED":
      return { label: "Approved", tone: "ok" }
    case "REJECTED":
      return { label: "Declined", tone: "neutral" }
    default:
      return { label: proposal.state, tone: "neutral" }
  }
}

/// The employee number head office gave the person once it opened their
/// record, read off the shop's list. `null` until then.
export function employeeNumber(
  team: EmployeeList | undefined,
  proposal: HireProposalView,
): string | null {
  const id = proposal.employee_ids[0]
  if (id === undefined) return null
  return (
    team?.rows.find((person) => person.employee_id === id)?.employee_code ??
    null
  )
}

/// Head office's reason for sending a request back or declining it.
export function answerOf(proposal: HireProposalView): string | null {
  if (proposal.state !== "RETURNED" && proposal.state !== "REJECTED") {
    return null
  }
  const said = currentTerms(proposal)?.decided_reason?.trim() ?? ""
  return said === "" ? null : said
}

/// Who is on the books: working, or suspended and still employed, in name
/// order. Somebody who has not started, or has left, is not staff — and a
/// person being asked for is not an employee yet.
export function onTheBooks(team: EmployeeList | undefined): EmployeeSummary[] {
  return (team?.rows ?? [])
    .filter(
      (person) => person.status === "ACTIVE" || person.status === "SUSPENDED",
    )
    .sort((left, right) =>
      (left.full_name ?? left.employee_code).localeCompare(
        right.full_name ?? right.employee_code,
      ),
    )
}
