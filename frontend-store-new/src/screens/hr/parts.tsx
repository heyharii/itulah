import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { Banner } from "@/components/ui/states"
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
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-soft-2 text-[0.6875rem] font-semibold text-body">
        {initials(name)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-cell font-medium text-ink">{name}</span>
        <span className="truncate text-[0.6875rem] text-mute">{line}</span>
      </span>
    </span>
  )
}

/// Choose one of this shop's people. Only the active ones: a form that offered
/// somebody who has left would be a form whose every submission is refused.
export function PersonPicker({
  team,
  value,
  onChange,
  label = "Who",
  exclude,
}: {
  team: EmployeeList | undefined
  value: string
  onChange: (value: string) => void
  label?: string
  /// People already chosen elsewhere — the other half of a swap, somebody
  /// already on a programme.
  exclude?: readonly string[]
}) {
  const rows = teamRows(team).filter(
    (person) =>
      person.status === "ACTIVE" &&
      !(exclude ?? []).includes(person.employee_id),
  )
  return (
    <Field label={label}>
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
      Head office answered with {dropped} row{dropped === 1 ? "" : "s"} from
      other shops, because this sign-in is not bounded to one. They are not
      shown: this till only ever shows {place}.
    </Banner>
  )
}

/// The decision at the foot of a sheet: why, then yes or no.
///
/// The reason is a field and not an afterthought because the centre refuses a
/// decision without one — a record that says what changed and not why is the
/// half of an audit trail that never helps anybody. Both buttons stay grey
/// until there is one.
export function Decision({
  approveLabel = "Approve",
  rejectLabel = "Refuse",
  placeholder,
  hint = "Head office refuses a decision with no reason on it.",
  pending,
  error,
  onDecide,
  extra,
}: {
  approveLabel?: string
  rejectLabel?: string
  placeholder?: string
  hint?: string
  pending: boolean
  error: unknown
  onDecide: (approve: boolean, reason: string) => void
  /// A third way out, beside the two — a claim's "Send back".
  extra?: (reason: string) => React.ReactNode
}) {
  const [reason, setReason] = useState("")
  const blank = reason.trim() === ""
  return (
    <div className="flex flex-col gap-3">
      <Field label="Why" hint={hint}>
        <Input
          value={reason}
          placeholder={placeholder}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {error !== null && error !== undefined && (
        <Banner tone="bad">{describeCentre(error)}</Banner>
      )}
      {/* `shrink` undoes the button's own `shrink-0`: two or three buttons
          share the row rather than each claiming all of it. */}
      <div className="flex gap-2 [&>button]:min-w-0 [&>button]:flex-1 [&>button]:shrink">
        <Button
          variant="danger"
          disabled={blank || pending}
          onClick={() => onDecide(false, reason)}
        >
          {rejectLabel}
        </Button>
        {extra?.(reason)}
        <Button
          variant="primary"
          disabled={blank || pending}
          onClick={() => onDecide(true, reason)}
        >
          {approveLabel}
        </Button>
      </div>
    </div>
  )
}

/// A form's closing row: what went wrong, then the one button.
export function Submit({
  label,
  pending,
  disabled,
  error,
  onSubmit,
}: {
  label: string
  pending: boolean
  disabled: boolean
  error: unknown
  onSubmit: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {error !== null && error !== undefined && (
        <Banner tone="bad">{describeCentre(error)}</Banner>
      )}
      <Button
        variant="primary"
        block
        disabled={disabled || pending}
        onClick={onSubmit}
      >
        {pending ? "Sending…" : label}
      </Button>
    </div>
  )
}

/// A key/value list inside a sheet — the prototype's `kv()`.
export function Facts({
  rows,
}: {
  rows: readonly (readonly [React.ReactNode, React.ReactNode] | null | false)[]
}) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-cell">
      {rows.map((row, index) =>
        row === null || row === false ? null : (
          <div key={index} className="contents">
            <dt className="text-mute">{row[0]}</dt>
            <dd className="min-w-0 text-ink tabular-nums">{row[1]}</dd>
          </div>
        ),
      )}
    </dl>
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
              ? "rounded-full bg-warn-bg px-2 text-[0.6875rem] leading-5 font-semibold text-warn-fg tabular-nums"
              : "rounded-full bg-soft-2 px-2 text-[0.6875rem] leading-5 font-semibold text-body tabular-nums"
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
