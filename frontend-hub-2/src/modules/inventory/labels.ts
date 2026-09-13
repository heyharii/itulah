import type { Reconciliation } from "@/modules/inventory/wire"

/// This module's vocabulary and its two clocks.
///
/// No JSX, so a column definition can import it without dragging a component
/// graph along — and so Fast Refresh keeps working on `parts.tsx` next door,
/// which a file mixing components with plain functions breaks.
///
/// ## Why every lookup falls back to the raw value
///
/// Not one of these statuses is a generated union: every inventory route
/// answers a `json!()` literal, so `status` arrives as a bare `string` (see
/// `wire.ts`). A value this client has not met is drawn **as itself** rather
/// than dropped or renamed — a row whose state the screen cannot name is still
/// a row somebody has to deal with, and silently showing it as blank is how a
/// new state ships invisible for a quarter.

/// An instant, to the minute.
///
/// `lib/format.ts` has `day()`, which is right for a reporting DATE and wrong
/// here: a movement is an event, two of them an hour apart are two different
/// facts, and a ledger drawn to the day cannot be read in order.
///
/// Kept in this module rather than pushed into `lib/format.ts` because it is
/// the only module with instants on the page, and a shared file two other
/// migrations are editing this week is not the place to put something one
/// module wants.
export function moment(iso: string | null | undefined): string {
  if (!iso) return "—"
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return at.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/// How long ago, in the coarsest unit that is still true.
///
/// Nobody has ever counted 400 hours: past two days this says "17d", because
/// the decision it feeds — is this a mislaid box or a write-off — is made in
/// days and never in hours.
export function since(iso: string | null | undefined): string {
  if (!iso) return "—"
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return "—"
  return age((Date.now() - at) / 3_600_000)
}

/// The same reading from an age the server already computed in hours.
export function age(hours: number | null): string {
  if (hours === null) return "—"
  if (hours < 1) return "just now"
  if (hours < 48) return `${Math.floor(hours)}h`
  return `${Math.floor(hours / 24)}d`
}

/// A signed count, where the sign is the point: a count difference of nought is
/// a match, and `+3` and `−3` are two very different mornings.
///
/// A real minus sign, not a hyphen: in a column of tabular figures the hyphen
/// is half the width and the column stops lining up.
export function signed(value: number): string {
  if (value === 0) return "0"
  return value > 0
    ? `+${value.toLocaleString("id-ID")}`
    : `−${Math.abs(value).toLocaleString("id-ID")}`
}

/// A whole-number percentage from a rate the server sends as a fraction.
///
/// Null is an em dash and never `0%`: a pool that models no loss at all and a
/// pool that lost nothing are different findings.
export function percent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "—"
  return `${(rate * 100).toFixed(rate >= 0.1 ? 0 : 1)}%`
}

/// `SHOUTING_SNAKE` as a sentence: `COUNT_SHORTAGE` → `Count shortage`.
///
/// For the values that are open-ended — a movement cause, a certification
/// reason — where a hand-written map would go stale the first time the server
/// adds one, and the raw value is already readable enough to print.
export function humanise(value: string): string {
  const words = value.replace(/_/g, " ").toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "blue"

// ── counts ─────────────────────────────────────────────────────────────────

/// `DRAFT → ACTIVE → REVIEW → CLOSED`, and nothing else.
const COUNT_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  ACTIVE: { label: "Counting", tone: "info" },
  REVIEW: { label: "In review", tone: "warn" },
  CLOSED: { label: "Closed", tone: "ok" },
}

export function countStatusLabel(status: string): string {
  return COUNT_STATUS[status]?.label ?? humanise(status)
}

export function countStatusTone(status: string): Tone {
  return COUNT_STATUS[status]?.tone ?? "neutral"
}

// ── transfer reconciliation ────────────────────────────────────────────────

/// Attention first, alphabetical never.
///
/// The rank is what the column sorts on while the word is what it draws, so the
/// rows that stop the fleet total being certified are at the top before
/// anybody chooses a sort. A status this list has not met sorts between the two
/// healthy cases and the three that matter — it is not claimed to be either.
const RECONCILIATION: Record<
  string,
  { rank: number; label: string; tone: Tone }
> = {
  STORE_ONLY: { rank: 0, label: "Store only", tone: "bad" },
  CONFLICT: { rank: 1, label: "Conflict", tone: "bad" },
  UNRESOLVED: { rank: 2, label: "Unresolved", tone: "warn" },
  DC_ONLY: { rank: 3, label: "In the air", tone: "info" },
  MATCHED: { rank: 4, label: "Matched", tone: "ok" },
}

export function reconciliationLabel(status: string): string {
  return RECONCILIATION[status]?.label ?? humanise(status)
}

export function reconciliationTone(status: string): Tone {
  return RECONCILIATION[status]?.tone ?? "neutral"
}

export function reconciliationRank(status: string): number {
  return RECONCILIATION[status]?.rank ?? 3.5
}

/// The three states that stop the server certifying a fleet total.
///
/// A tag claimed by a store and by nobody else is either stock that arrived
/// from nowhere or a despatch that was never recorded, and the server cannot
/// tell which — so it declines to add the fleet up at all.
export function blocksCertification(row: Reconciliation): boolean {
  return (
    row.status === "STORE_ONLY" ||
    row.status === "UNRESOLVED" ||
    row.status === "CONFLICT"
  )
}

// ── pools ──────────────────────────────────────────────────────────────────

/// Why this node may not post against a shelf, in one clause.
///
/// Read from `authority.write_policy` rather than derived from the site id.
/// The centre spells the distribution centre `dc` and the box standing in it
/// runs as `dc-01`, so an app that decided writability by looking at the
/// identifier would get exactly one site wrong — the one that matters.
export function writePolicyReason(policy: string): string {
  switch (policy) {
    case "CLOUD_WRITABLE":
      return "This node may post here."
    case "OWNER_NODE_ONLY":
      return "Owned by the node standing in that site; the centre reads it and may not post to it."
    case "SHADOWED_READ_ONLY":
      return "A live node has taken this shelf over. The centre's row is kept for comparison and is left out of the fleet total."
    case "DERIVED_READ_ONLY":
      return "A rollup: the sum of the rows beneath it, so nothing stands in it and nothing may be posted to it."
    default:
      return humanise(policy)
  }
}

/// What a sync status means for the number beside it.
export function syncTone(status: string): Tone {
  switch (status) {
    case "OK":
    case "LOCAL":
      return "neutral"
    case "STALE":
      return "warn"
    case "WAITING":
      return "info"
    default:
      return "neutral"
  }
}
