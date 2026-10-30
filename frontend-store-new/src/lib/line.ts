import type {
  ChangeProposalView,
  EmployeeSummary,
  PlacementView,
} from "@itulah/contract"

/// The shop's line of report: who reports to whom, as head office has it.
///
/// Pure — no reads, no React — so the chart, the list column and the sheet all
/// ask one object the same questions. Built by `useLine`
/// (`lib/queries/line.ts`) from the team and one placements read per person.
///
/// # What "inside the shop" means
///
/// A placement stores its boss as an employee id. A boss who is on this shop's
/// books is a card in the chart; a boss who is not (head office, an area
/// manager, somebody who has since left) is not, and that person is a **top
/// card**: nothing above them is drawn, and the sheet says *Head Office*. A
/// shop cannot move somebody under a boss it cannot see, so the one place a
/// top card's boss is changed is head office.

/// One person of the shop as the chart draws them.
export interface LineMember {
  readonly id: string
  readonly name: string
  readonly role: string
}

/// A change of boss already sent to head office and not yet decided.
export interface LineWaiting {
  readonly proposalId: string
  /// The boss it asks for, as a name (or as head office spelled it).
  readonly toName: string
}

export const HEAD_OFFICE = "Head Office"

export interface Line {
  /// Everyone on the books here, in name order.
  readonly members: readonly LineMember[]
  readonly member: (id: string) => LineMember | undefined
  /// The boss of `id` when that boss is on this shop's books; `null` when the
  /// boss is outside it (or nobody is recorded).
  readonly boss: (id: string) => string | null
  /// Direct reports of `id`, in name order.
  readonly reports: (id: string) => readonly string[]
  /// The top cards: everyone whose boss is not on this shop's books.
  readonly roots: readonly string[]
  /// `id` and everyone under them, however deep — who may never become their
  /// boss.
  readonly under: (id: string) => ReadonlySet<string>
  /// Whether all of `id`'s direct reports lead nobody: the chart stacks them
  /// under the card instead of fanning them out.
  readonly stacked: (id: string) => boolean
  /// Waiting on head office, if a change of boss has been sent for `id`.
  readonly waiting: (id: string) => LineWaiting | undefined
}

/// The people of the shop as the chart names them, in name order.
export function membersOf(staff: readonly EmployeeSummary[]): LineMember[] {
  return staff
    .map((person) => ({
      id: person.employee_id,
      name: person.full_name ?? person.employee_code,
      role: person.position ?? "No Position",
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

/// The placement in force today: the newest whose first day has come.
/// `rows` arrive newest first; an ISO date compares as text.
export function currentPlacement(
  rows: readonly PlacementView[] | undefined,
  today: string,
): PlacementView | undefined {
  return rows?.find((row) => row.effective_from <= today)
}

/// The boss a proposal asks for, as words. The shop files the boss's employee
/// id, so a value that is one of this shop's people reads as their name; any
/// other text is shown as head office wrote it.
export function proposedBossName(
  to: string,
  members: readonly LineMember[],
): string {
  return members.find((one) => one.id === to)?.name ?? to
}

/// Pending change-of-boss proposals, one per person (the newest in the list's
/// order wins if a person somehow has two).
export function pendingBossChanges(
  proposals: readonly ChangeProposalView[] | undefined,
  members: readonly LineMember[],
): Map<string, LineWaiting> {
  const waiting = new Map<string, LineWaiting>()
  for (const proposal of proposals ?? []) {
    if (proposal.state !== "PENDING" || proposal.kind !== "TRANSFER") continue
    const prop = proposal.props.find((one) => one.field === "reports_to")
    if (prop === undefined || waiting.has(proposal.employee_id)) continue
    waiting.set(proposal.employee_id, {
      proposalId: proposal.id,
      toName: proposedBossName(prop.to, members),
    })
  }
  return waiting
}

/// Build the line from the people and their bosses.
///
/// `bossIds` maps a person to the boss id their current placement names, or
/// `null` for none; a person missing from it is treated as having none.
export function makeLine(
  staff: readonly EmployeeSummary[],
  bossIds: ReadonlyMap<string, string | null>,
  waiting: ReadonlyMap<string, LineWaiting>,
): Line {
  const members = membersOf(staff)
  const byId = new Map(members.map((one) => [one.id, one]))

  const named = (id: string): string | null => {
    const wanted = bossIds.get(id) ?? null
    return wanted !== null && wanted !== id && byId.has(wanted) ? wanted : null
  }

  // A loop in the data (A under B under A) would leave nobody on it a top card
  // and draw the shop's chart without them. Walk up from everyone; where a walk
  // meets itself, that person's boss is cut, so they become a top card and the
  // rest still hang under them.
  const cut = new Set<string>()
  for (const one of members) {
    const path = new Set<string>()
    let at: string | null = one.id
    while (at !== null && !path.has(at)) {
      path.add(at)
      at = cut.has(at) ? null : named(at)
    }
    if (at !== null) cut.add(at)
  }
  const boss = (id: string): string | null => (cut.has(id) ? null : named(id))

  const children = new Map<string, string[]>()
  for (const one of members) {
    const above = boss(one.id)
    if (above === null) continue
    children.set(above, [...(children.get(above) ?? []), one.id])
  }
  const reports = (id: string): readonly string[] => children.get(id) ?? []

  const under = (id: string): ReadonlySet<string> => {
    const seen = new Set<string>([id])
    const walk = (at: string) => {
      for (const next of reports(at)) {
        if (seen.has(next)) continue
        seen.add(next)
        walk(next)
      }
    }
    walk(id)
    return seen
  }

  const roots = members
    .filter((one) => boss(one.id) === null)
    .map((one) => one.id)

  return {
    members,
    member: (id) => byId.get(id),
    boss,
    reports,
    roots,
    under,
    stacked: (id) => {
      const kids = reports(id)
      return kids.length > 0 && kids.every((kid) => reports(kid).length === 0)
    },
    waiting: (id) => waiting.get(id),
  }
}

/// Who `id` reports to, in words: the boss's name when they are on this shop's
/// books, otherwise Head Office.
export function bossName(line: Line, id: string): string {
  const above = line.boss(id)
  return above === null
    ? HEAD_OFFICE
    : (line.member(above)?.name ?? HEAD_OFFICE)
}

/// Up to two letters: the first of the first two words.
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => word !== "")
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase()
}
