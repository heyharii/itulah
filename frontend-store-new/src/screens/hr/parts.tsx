import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { SheetFoot } from "@/components/ui/people-sheet"
import { Fact, Facts as KitFacts } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { dateText } from "@/lib/format"
import { describeCentre } from "@/screens/hr/centre"
import { teamRows, type Tone } from "@/screens/hr/words"
import type { EmployeeList } from "@itulah/contract"

/// The small things every People screen draws the same way: a person in a
/// cell, the decision at the foot of a sheet, the picker of this shop's
/// people, the facts in a sheet. One copy each, so the fourteen screens read
/// as one module rather than fourteen dialects. The words and the shared
/// reads — what a state is called, who works here — are in `words.ts`.

/// `Siti Rahma` → `SR`. The prototype's avatar: two letters are enough to tell
/// a dozen people apart, and a photo is a thing this system does not hold.
function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "")
  const first = words[0]?.[0] ?? "?"
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : ""
  return `${first}${last}`.toUpperCase()
}

/// A person, as a table cell or a card title: the initials, the name, and a
/// line of who they are here.
///
/// Somebody not on the list — posted away mid-month, or a row whose name the
/// list does not carry yet — is still drawn, under their id: a row that
/// vanished because its name could not be found would be a row quietly lost.
export function Person({
  team,
  id,
  sub,
}: {
  team: EmployeeList | undefined
  id: string
  /// Overrides the second line.
  sub?: React.ReactNode
}) {
  const row = team?.rows.find((person) => person.employee_id === id)
  const name = row?.full_name ?? row?.employee_code ?? id
  const line =
    sub ??
    (row === undefined
      ? "not on this shop's list"
      : [row.position, row.employee_code].filter(Boolean).join(" · "))
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-soft-2 text-[0.875rem] font-semibold text-body">
        {initials(name)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-cell font-medium text-ink">{name}</span>
        <span className="truncate text-meta text-mute">{line}</span>
      </span>
    </span>
  )
}

/// A person as the head of a lead-figure card: their FULL name over their role
/// — never a login, never a code on its own. Spread it into a `PeopleCard`:
///
///     card={(row) => ({ ...personCard(team, row.employee_id), lead: …, foot: … })}
///
/// Somebody not on the list is still drawn, under their id (see `Person`).
export function personCard(
  team: EmployeeList | undefined,
  id: string,
  /// More lines under the role, 14px grey: "Swap with Dewi Lestari".
  extra: readonly React.ReactNode[] = [],
): { title: string; lines: readonly React.ReactNode[] } {
  const row = team?.rows.find((person) => person.employee_id === id)
  const name = row?.full_name ?? row?.employee_code ?? id
  const role = row === undefined ? undefined : (row.position ?? undefined)
  return { title: name, lines: [role, ...extra] }
}

/// A date as a card's lead figure: the day and month large, the year under it
/// ("06 Oct" over "2026") — the hub's `CardDate`.
export function dateLead(
  iso: string | null | undefined,
  /// What the date is, said before the year: "until".
  caption?: string,
): { figure: string; caption?: string; muted?: boolean } {
  if (iso === null || iso === undefined || iso === "")
    return { figure: "—", muted: true }
  const parsed = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return { figure: iso, muted: true }
  const year = String(parsed.getFullYear())
  return {
    figure: dateText(parsed, { day: "2-digit", month: "short" }),
    caption: caption === undefined ? year : `${caption} ${year}`,
  }
}

/// Choose one of this shop's people. Only the active ones: a form that offered
/// somebody who has left would be a form whose every submission is refused.
export function PersonPicker({
  team,
  value,
  onChange,
  label = "Who",
  exclude,
  required,
}: {
  team: EmployeeList | undefined
  value: string
  onChange: (value: string) => void
  label?: string
  /// People already chosen elsewhere — the other half of a swap, somebody
  /// already on a programme.
  exclude?: readonly string[]
  /// Marks the question as one the form cannot be sent without.
  required?: boolean
}) {
  const rows = teamRows(team).filter(
    (person) =>
      person.status === "ACTIVE" &&
      !(exclude ?? []).includes(person.employee_id),
  )
  return (
    <Field label={label} required={required}>
      <Select value={value} onChange={onChange} aria-label={label}>
        <option value="">Choose a person…</option>
        {rows.map((person) => (
          <option key={person.employee_id} value={person.employee_id}>
            {person.full_name ?? person.employee_code}
            {person.position === null ? "" : ` · ${person.position}`}
          </option>
        ))}
      </Select>
    </Field>
  )
}

/// Said out loud when the head-office session reaches further than this shop.
///
/// The queues that take no place bound themselves by the caller's own posting,
/// so a session that reaches everywhere is answered for the whole fleet and
/// narrowed in this browser. Zero is the normal answer and draws nothing.
export function Fenced({ dropped, place }: { dropped: number; place: string }) {
  if (dropped === 0) return null
  return (
    <Banner tone="warn" className="mb-4">
      {dropped} row{dropped === 1 ? "" : "s"} from other shops hidden. Showing{" "}
      {place} only.
    </Banner>
  )
}

/// A decision on a request: the one grammar of every approval sheet (audit D5).
///
///   body    a required **Reason** field (the centre refuses a decision with no
///           reason on it — a record that says what changed and not why is the
///           half of an audit trail that never helps anybody), then the error
///           banner when the write was refused
///   footer  `[ Reject ]  [ Approve ]` — Reject (danger) on the left, Approve
///           (primary) on the right, on EVERY width; both stay grey until there
///           is a reason
///
/// A hook rather than a component because its two halves live in two places of
/// the sheet:
///
///     const decision = useDecision({ pending, error, onDecide })
///     <PeopleSheet foot={waiting ? decision.footer : undefined}>
///       …the facts…
///       {waiting && decision.field}
///     </PeopleSheet>
///
/// The words are canonical — Pending / Approved / Rejected / Withdrawn; never
/// "Refuse", "Decline" or "Take back".
export function useDecision({
  approveLabel = "Approve",
  rejectLabel = "Reject",
  placeholder,
  pending,
  error,
  onDecide,
  extra,
}: {
  approveLabel?: string
  rejectLabel?: string
  placeholder?: string
  pending: boolean
  error: unknown
  onDecide: (approve: boolean, reason: string) => void
  /// A third way out, between the two — a claim's "Send back".
  extra?: (reason: string) => React.ReactNode
}): { reason: string; field: React.ReactNode; footer: React.ReactNode } {
  const [reason, setReason] = useState("")
  const blank = reason.trim() === ""
  return {
    reason,
    field: (
      <div className="mt-6 flex flex-col gap-3">
        <Field label="Reason" required>
          <Input
            value={reason}
            placeholder={placeholder}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {error !== null && error !== undefined && (
          <Banner tone="bad">{describeCentre(error)}</Banner>
        )}
      </div>
    ),
    footer: (
      <SheetFoot>
        <Button
          variant="danger"
          disabled={blank}
          pending={pending}
          onClick={() => onDecide(false, reason)}
        >
          {rejectLabel}
        </Button>
        {extra?.(reason)}
        <Button
          variant="primary"
          disabled={blank}
          pending={pending}
          onClick={() => onDecide(true, reason)}
        >
          {approveLabel}
        </Button>
      </SheetFoot>
    ),
  }
}

/// A form's foot: what went wrong, then `[ Cancel ] [ Create … ]` — the one
/// filled button on the right. Goes in a `PeopleSheet`'s `foot`.
///
/// The words are the audit's D4: a new record is **Create {thing}**, an edit
/// **Save changes**; **Submit** is only for sending something for approval.
/// While the write is on its way the label is the present participle
/// ("Creating…").
export function Submit({
  label,
  pendingLabel,
  pending,
  disabled,
  error,
  onSubmit,
  onCancel,
}: {
  label: string
  /// What the button says while the write is on its way: "Creating…".
  pendingLabel?: string
  pending: boolean
  disabled: boolean
  error: unknown
  onSubmit: () => void
  /// Shows a quiet Cancel to the left of the button.
  onCancel?: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {error !== null && error !== undefined && (
        <Banner tone="bad">{describeCentre(error)}</Banner>
      )}
      <SheetFoot>
        {onCancel !== undefined && (
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          pending={pending}
          disabled={disabled}
          onClick={onSubmit}
        >
          {pending ? (pendingLabel ?? "Saving…") : label}
        </Button>
      </SheetFoot>
    </div>
  )
}

/// A record's facts, label over value, two to a row — the kit's `Facts`
/// (`components/ui/sheet.tsx`) behind the `[term, value]` pairs these screens
/// were written with. A pair that is `false`/`null` is left out; a long value
/// (or a third `true`) takes the whole row. Never a disabled input.
export function Facts({
  rows,
}: {
  rows: readonly (
    readonly [React.ReactNode, React.ReactNode, boolean?] | null | false
  )[]
}) {
  return (
    <KitFacts>
      {rows.map((row, index) =>
        row === null || row === false ? null : (
          <Fact
            key={index}
            term={row[0]}
            wide={
              row[2] === true ||
              (typeof row[1] === "string" && row[1].length > 28)
            }
          >
            {row[1]}
          </Fact>
        ),
      )}
    </KitFacts>
  )
}

/// The prototype's section heading on a page: a label, and how many rows in it
/// are waiting.
export function Heading({
  children,
  count,
  tone = "warn",
  action,
}: {
  children: React.ReactNode
  count?: number
  tone?: Tone
  action?: React.ReactNode
}) {
  return (
    <div className="mt-6 mb-2.5 flex min-h-6 items-center gap-2 first:mt-0">
      <h2 className="text-section font-semibold text-ink">{children}</h2>
      {count !== undefined && (
        <span
          className={
            tone === "warn" && count > 0
              ? "rounded-full bg-warn-bg px-2 text-meta leading-5 font-semibold text-warn-fg tabular-nums"
              : "rounded-full bg-soft-2 px-2 text-meta leading-5 font-semibold text-body tabular-nums"
          }
        >
          {count}
        </span>
      )}
      <span className="flex-1" />
      {action}
    </div>
  )
}
