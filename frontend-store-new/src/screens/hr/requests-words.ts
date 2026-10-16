import { dateText } from "@/lib/format"
import { APPROVED_REASON, type RequestItem } from "@/lib/queries/requests"
import { personName } from "@/screens/hr/words"
import type { EmployeeList, LeaveRequestView } from "@itulah/contract"

/// The words on a request card, worked out from what the centre sent.
///
/// The prototype's card says five things and no more: what kind of request it
/// is and whose, how much and for when, why, and when it was asked. No shift
/// pattern, no balance — a store head deciding a day off needs to know the
/// person, the days and the reason, and everything else is a second screen's
/// answer. This file is that sentence, built once for leave and for swaps.
///
/// Apart from `requests-card.tsx` because that one exports components, and a
/// file that exports both cannot be hot-reloaded as a component module.

/// How a kind of request is tinted: leave is blue, sick leave red, a swap
/// violet. The colour tells the kind before the word is read.
export type RequestKind = "leave" | "sick" | "swap"

/// How a card ended, once it has: the stamp's word, who stamped it, and what
/// they said.
export interface Outcome {
  readonly word: "approved" | "declined" | "withdrawn"
  /// The stamp's second line: the decider's first name, or "Head office" for
  /// a login the shop's list does not hold. `null` for a withdrawal — nobody
  /// decided it.
  readonly by: string | null
  readonly note: string | null
}

export interface RequestFacts {
  readonly kind: RequestKind
  /// "Annual leave", "Sick leave", "Shift swap" — head office's own name for
  /// the kind of leave.
  readonly type: string
  /// The person the request is for, by full name.
  readonly who: string
  /// How much: "3 days", "with Putri Lestari".
  readonly total: string
  /// For when. Two parts for a span, so a narrow card breaks between the
  /// dates and not in the middle of one.
  readonly when: readonly string[]
  readonly why: string
  readonly evidence: { readonly label: string; readonly value: string } | null
  /// "Asked 10 Oct, 19:20". A swap carries no time it was asked, so none.
  readonly asked: string | null
  /// Present once the request has been answered.
  readonly outcome: Outcome | null
}

const SICK = /sick|sakit/i

/// `Thu 15 Oct`, or with the year: `Thu 15 Oct 2026`. Built from parts because
/// `en-GB` puts a comma after the weekday when asked for the lot at once.
function dayWord(iso: string, withYear: boolean): string {
  const parsed = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return iso
  const weekday = dateText(parsed, { weekday: "short" })
  const options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" }
  if (withYear) options.year = "numeric"
  return `${weekday} ${dateText(parsed, options)}`
}

/// `10 Oct, 19:20` — a moment as the prototype writes one under a card: no
/// year (a request is about now), 24-hour, in this device's own timezone.
export function shortMoment(iso: string): string | null {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return null
  const date = dateText(parsed, { day: "2-digit", month: "short" })
  const time = dateText(parsed, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  return `${date}, ${time}`
}

/// `Asked 10 Oct, 19:20`.
function askedLine(iso: string): string | null {
  const when = shortMoment(iso)
  return when === null ? null : `Asked ${when}`
}

/// "1 day", "2.5 days".
function daysWord(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`
}

/// The stamp's second line. The list holds this shop's people; a login it does
/// not know is head office.
function deciderName(
  team: EmployeeList | undefined,
  login: string | null,
): string | null {
  if (login === null) return null
  const row = team?.rows.find((person) => person.username === login)
  const first = row?.full_name?.trim().split(/\s+/)[0]
  return first === undefined || first === "" ? "Head office" : first
}

function leaveOutcome(
  request: LeaveRequestView,
  team: EmployeeList | undefined,
): Outcome | null {
  if (request.state === "PENDING") return null
  const word =
    request.state === "APPROVED"
      ? "approved"
      : request.state === "REJECTED"
        ? "declined"
        : "withdrawn"
  const said = request.decision_reason?.trim() ?? ""
  return {
    word,
    by: word === "withdrawn" ? null : deciderName(team, request.decided_by),
    // "Approved" is what a tap on Approve records; saying it again under a
    // stamp that says it is noise.
    note:
      said === "" || said.toLowerCase() === APPROVED_REASON.toLowerCase()
        ? null
        : said,
  }
}

/// The card for one request, in words.
export function requestFacts(
  item: RequestItem,
  team: EmployeeList | undefined,
): RequestFacts {
  if (item.kind === "swap") {
    const { swap } = item
    return {
      kind: "swap",
      type: "Shift swap",
      who: personName(team, swap.employee_id),
      total: `with ${personName(team, swap.with_employee_id)}`,
      when: [dayWord(swap.on_date, true)],
      why: swap.reason,
      evidence: null,
      asked: null,
      outcome: null,
    }
  }

  const { request } = item
  const sick = SICK.test(`${request.leave_type} ${request.leave_type_name}`)
  const evidence = request.evidence?.trim() ?? ""
  return {
    kind: sick ? "sick" : "leave",
    type: request.leave_type_name,
    who: personName(team, request.employee_id),
    total: daysWord(request.chargeable_days),
    when:
      request.from_date === request.to_date
        ? [dayWord(request.from_date, true)]
        : [
            `${dayWord(request.from_date, false)} –`,
            dayWord(request.to_date, true),
          ],
    why: request.reason,
    evidence:
      evidence === ""
        ? null
        : { label: sick ? "Doctor’s note" : "Evidence", value: evidence },
    asked: askedLine(request.created_at),
    outcome: leaveOutcome(request, team),
  }
}
