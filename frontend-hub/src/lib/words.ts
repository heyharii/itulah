/// The words a status is called by, and the tint it wears — one vocabulary for
/// the whole app (decisions D2/D5, 6 Oct 2026).
///
/// The same state used to have as many names as there were authors: a switched
/// off supplier was "Non-active", an article "Cancelled", a term "Inactive", an
/// asset "Retired". They mean different things, and this file says which:
///
///   Active ....... on. Master data that is in use; Marketing's "Live".
///   Inactive ..... master data switched off — articles, terms, suppliers, users.
///   Cancelled .... a DOCUMENT ended before it was done — PO, voucher, order.
///   Closed ....... finished and sealed — a period, a count, a return.
///   Retired ...... assets only.
///   Pending · Approved · Rejected · Withdrawn ... an approval, and only that.
///
/// A screen draws these with `Status` (dot and word) in a list or a card, and
/// with one `Pill` in the head of a record sheet (D3).

/// What a missing value looks like, everywhere. A dash, not "n/a", "none",
/// "–" or a blank: a screen that has to say something *about* the absence
/// ("Never bought") writes that sentence itself.
export const EMPTY = "—"

/// How a state is tinted. `info` is sky and only ever means in motion; `accent`
/// means selected. They never swap.
export type Tone = "ok" | "warn" | "bad" | "info" | "accent" | "neutral"

/// The nine words.
export const STATUS = {
  active: "Active",
  inactive: "Inactive",
  cancelled: "Cancelled",
  closed: "Closed",
  retired: "Retired",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
} as const

export type StatusKey = keyof typeof STATUS
export type StatusWord = (typeof STATUS)[StatusKey]

/// Which tint each of them wears.
export const STATUS_TONE: Readonly<Record<StatusKey, Tone>> = {
  active: "ok",
  inactive: "neutral",
  cancelled: "bad",
  closed: "ok",
  retired: "neutral",
  pending: "warn",
  approved: "ok",
  rejected: "bad",
  withdrawn: "neutral",
}

/// An approval's four states, as the server writes them. The human-resources
/// screens spelled these "Waiting on a decision", "Refused", "Declined" and
/// "Taken back"; they are Pending, Approved, Rejected and Withdrawn.
export const APPROVAL_WORD = {
  PENDING: STATUS.pending,
  APPROVED: STATUS.approved,
  REJECTED: STATUS.rejected,
  WITHDRAWN: STATUS.withdrawn,
} as const

export function approvalWord(code: string): string {
  return (
    (APPROVAL_WORD as Readonly<Record<string, string>>)[code] ?? label(code)
  )
}

/// Other names for the nine, so a code or an older word lands on the right one.
/// "Suspended", "Blocked" and "Stopped" are deliberately NOT here: for a user
/// or a member they are the same switch as Inactive, but for an employee
/// "Suspended" is a different fact, and only the screen knows which it is.
const ALIASES: Readonly<Record<string, StatusKey>> = {
  active: "active",
  live: "active",
  inactive: "inactive",
  non_active: "inactive",
  nonactive: "inactive",
  deactivated: "inactive",
  disabled: "inactive",
  switched_off: "inactive",
  cancelled: "cancelled",
  canceled: "cancelled",
  closed: "closed",
  retired: "retired",
  pending: "pending",
  waiting: "pending",
  approved: "approved",
  rejected: "rejected",
  refused: "rejected",
  declined: "rejected",
  withdrawn: "withdrawn",
  taken_back: "withdrawn",
}

function keyOf(code: string | null | undefined): StatusKey | undefined {
  if (!code) return undefined
  return ALIASES[
    code
      .toLowerCase()
      .trim()
      .replace(/[\s-]+/g, "_")
  ]
}

/// A state's word: the canonical one when the code is one of the nine (or an
/// older name for one), otherwise the code made readable (`label`).
export function statusWord(code: string | null | undefined): string {
  const key = keyOf(code)
  return key === undefined ? label(code) : STATUS[key]
}

/// A state's tint: the canonical one for the nine, otherwise the retail
/// taxonomy (`toneFor`).
export function statusTone(code: string | null | undefined): Tone {
  const key = keyOf(code)
  return key === undefined ? toneFor(code) : STATUS_TONE[key]
}

/// The retail status taxonomy, one mapping for the whole app.
///
/// Payment: Paid→ok · Pending→warn · Shipped/Processing→info · Cancelled→bad.
/// Stock: In stock→ok · Low→warn · Out→bad.
/// Logistics: Completed→ok · In transit→info · Awaiting/Delayed→warn.
///
/// Keeping it here rather than per screen is what stops the same word being
/// amber on one list and green on the next.
const tones: Readonly<Record<string, Tone>> = {
  paid: "ok",
  completed: "ok",
  complete: "ok",
  closed: "ok",
  received: "ok",
  active: "ok",
  posted: "ok",
  approved: "ok",
  settled: "ok",
  in_stock: "ok",

  // A purchase order's derived lifecycle. `active` is already "ok" above, and
  // wrongly so for an order nobody has delivered against — but it is shared
  // with half the estate, so the two that matter are named here instead.
  partially_received: "warn",
  fully_received: "ok",

  pending: "warn",
  awaiting: "warn",
  draft: "warn",
  delayed: "warn",
  low: "warn",
  partial: "warn",
  submitted: "warn",
  proposed: "warn",

  issued: "info",
  shipped: "info",
  processing: "info",
  in_transit: "info",
  receiving: "info",
  open: "info",

  cancelled: "bad",
  canceled: "bad",
  rejected: "bad",
  failed: "bad",
  void: "bad",
  out: "bad",
  exception: "bad",
}

export function toneFor(status: string | null | undefined): Tone {
  if (!status) return "neutral"
  return tones[status.toLowerCase().replace(/[\s-]/g, "_")] ?? "neutral"
}

/// `PARTIALLY_RECEIVED` → `Partially received`. The server shouts its enums;
/// the screen does not have to.
export function label(status: string | null | undefined): string {
  if (!status) return EMPTY
  const words = status.toLowerCase().replace(/[_-]+/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/// Where a carton has got to, as the node derives it (`Koli.position`,
/// `Shipment.position`). Positions are computed from containment and never
/// stored, so a box cannot claim to be on a truck it was never loaded onto —
/// and the tones follow the two-blue rule: **on the road is sky**, everything
/// still standing in this building is not.
const positions: Readonly<Record<string, Tone>> = {
  packed: "neutral",
  shipment: "warn",
  loaded: "warn",
  in_transit: "info",
  delivered: "ok",
  open: "warn",
  sealed: "ok",
}

export function positionTone(position: string | null | undefined): Tone {
  if (!position) return "neutral"
  return (
    positions[position.toLowerCase().replace(/[\s-]/g, "_")] ??
    toneFor(position)
  )
}
