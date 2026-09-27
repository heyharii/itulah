import {
  AppWindow,
  Armchair,
  Building2,
  Car,
  CircleCheck,
  CircleX,
  Droplets,
  Monitor,
  MoveVertical,
  Paintbrush,
  Snowflake,
  TriangleAlert,
  Zap,
  type LucideIcon,
} from "lucide-react"

import type { Tile } from "@/components/ui/form"
import { count, day } from "@/lib/format"
import type {
  GaInspectionRow,
  GaRepairObject,
  GaRepairRow,
} from "@itulah/contract"

/// The maintenance vocabulary that is NOT a drawing: what each stage is
/// CALLED, which stages a record may move to, what a schedule's interval says,
/// and whether a repair's actual cost has run past its ceiling.
///
/// It lives apart from `parts.tsx` because that file exports components and
/// react-refresh allows no functions beside them — the same split, and the
/// same reason, as `screens/contracts/format.ts`.

// ── repair objects ──────────────────────────────────────────────────────────

/// An icon per repair object (brief §10.2). The wire names the objects and
/// their accounts; the GLYPH is a drawing, and drawings live in the browser.
/// Keyed by the object code the server validates, so an object the list grows
/// simply falls back to the wrench rather than breaking the grid.
const OBJECT_ICONS: Readonly<Record<string, LucideIcon>> = {
  FFE: Armchair,
  SOFTWARE: AppWindow,
  KOMPUTER: Monitor,
  BANGUNAN: Building2,
  STAFF_HOUSE: Building2,
  KENDARAAN: Car,
  AC: Snowflake,
  POWER_PLANT: Zap,
  GENSET_BBM: Droplets,
  CAT: Paintbrush,
  LIFT: MoveVertical,
}

export function repairObjectIcon(code: string): LucideIcon {
  return OBJECT_ICONS[code] ?? Paintbrush
}

/// The composer's cards, straight off the wire. The account code rides as
/// the tile's `tag` — a figure the reader checks against the chart, not
/// prose — for the same reason the contract types' cards carry theirs.
export function repairObjectTiles(
  objects: readonly GaRepairObject[]
): readonly (Tile<string> & { code: string })[] {
  return objects.map((one) => ({
    value: one.code,
    code: one.code,
    label: one.name,
    icon: repairObjectIcon(one.code),
    tag: one.account_code,
  }))
}

// ── stages ──────────────────────────────────────────────────────────────────

/// The repair's state machine, in the words the prototype's pills used. The
/// ends (CLOSED, CANCELLED) read quiet on purpose: a closed repair is not an
/// alarm, it is a fact. The flow arrays are what the move form offers, and
/// they are the same law the server enforces (`repair_may_move`) — the form
/// asks the question the server answers, so the two lists cannot drift.
export const REPAIR_FLOW = [
  "OPEN",
  "APPROVED",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED",
] as const

export function repairStageWords(status: string): string {
  switch (status) {
    case "OPEN":
      return "Open"
    case "APPROVED":
      return "Approved"
    case "IN_PROGRESS":
      return "In progress"
    case "COMPLETED":
      return "Done"
    case "CLOSED":
      return "Closed"
    default:
      return "Cancelled"
  }
}

/// Which stages a repair may move to from here — the legal `to` list, in
/// flow order. CANCELLED is reachable from everywhere but the ends, and the
/// ends offer nothing: a cancelled repair stays a cancelled repair.
export function repairNextStages(status: string): readonly string[] {
  switch (status) {
    case "OPEN":
      return ["APPROVED", "CANCELLED"]
    case "APPROVED":
      return ["IN_PROGRESS", "CANCELLED"]
    case "IN_PROGRESS":
      return ["COMPLETED", "CANCELLED"]
    case "COMPLETED":
      return ["CLOSED"]
    default:
      return []
  }
}

/// The replacement's own line, no exits: a swap runs forward or nowhere.
/// CANCELLED is deliberately absent — a swap that is dropped is simply never
/// moved past PROPOSED, and a second terminal state would dress "did
/// nothing" up as a decision.
export const REPLACEMENT_FLOW = [
  "PROPOSED",
  "APPROVED",
  "PURCHASED",
  "INSTALLED",
  "CLOSED",
] as const

export function replacementStageWords(status: string): string {
  switch (status) {
    case "PROPOSED":
      return "Proposed"
    case "APPROVED":
      return "Approved"
    case "PURCHASED":
      return "Purchased"
    case "INSTALLED":
      return "Installed"
    default:
      return "Done"
  }
}

export function replacementNextStage(status: string): string | null {
  const at = REPLACEMENT_FLOW.indexOf(
    status as (typeof REPLACEMENT_FLOW)[number]
  )
  return at >= 0 && at < REPLACEMENT_FLOW.length - 1
    ? REPLACEMENT_FLOW[at + 1]
    : null
}

/// REQUESTED → APPROVED → POSTED, with REJECTED the one fork. POSTED is
/// Finance's word, and it is Finance's act (tahap 6) — GA stops at APPROVED.
export const DISPOSAL_FLOW = ["REQUESTED", "APPROVED", "POSTED"] as const

export function disposalStageWords(status: string): string {
  switch (status) {
    case "REQUESTED":
      return "Submitted"
    case "APPROVED":
      return "Approved"
    case "POSTED":
      return "Posted"
    default:
      return "Rejected"
  }
}

/// Which word a stage wears, whichever flow it belongs to. Shared with the
/// stage line so the pills above and the line below cannot disagree.
export function wordsFor(flow: readonly string[], stage: string): string {
  if (stage === "CANCELLED") return "Cancelled"
  if (stage === "REJECTED") return "Rejected"
  if (flow === DISPOSAL_FLOW) return disposalStageWords(stage)
  if (flow === REPLACEMENT_FLOW) return replacementStageWords(stage)
  return repairStageWords(stage)
}

// ── inspections ─────────────────────────────────────────────────────────────

/// The three results, with the glyph each card wears (brief §10.2: the icon
/// is what the eye finds before it reads the label).
export const INSPECTION_RESULTS = [
  { value: "BAIK", label: "Good", icon: CircleCheck },
  { value: "PERHATIAN", label: "Needs attention", icon: TriangleAlert },
  { value: "RUSAK", label: "Broken", icon: CircleX },
] as const

export function inspectionOf(
  row: GaInspectionRow
): (typeof INSPECTION_RESULTS)[number] {
  return (
    INSPECTION_RESULTS.find((one) => one.value === row.result) ??
    INSPECTION_RESULTS[0]
  )
}

// ── schedule ────────────────────────────────────────────────────────────────

/// "3 months", said the way a schedule says it. The interval and its unit
/// arrive separately because the server computes with them; this joins them
/// for a human.
export function intervalLabel(kind: string, value: number): string {
  const unit = kind === "DAYS" ? "days" : kind === "MONTHS" ? "months" : "km"
  return `every ${count(value)} ${unit}`
}

/// A task's own status, read off its next date — the prototype's three
/// tones: late in bad, inside a week in warn, otherwise the date itself in
/// quiet. Today is the browser's because the schedule is read against the
/// day the reader is standing in; the server's seven-day attention list is
/// the overview's job, on the server's clock.
export function taskState(nextDue: string | null): {
  tone: "bad" | "warn" | "neutral"
  label: string
} {
  if (nextDue === null) {
    // A KM task has no next DATE — km is distance, and distance has no
    // calendar. Saying "overdue" about it would be inventing a fact.
    return { tone: "neutral", label: "follows odometer" }
  }
  const today = new Date().toISOString().slice(0, 10)
  const days = Math.round(
    (Date.parse(`${nextDue}T00:00:00`) - Date.parse(`${today}T00:00:00`)) /
      86_400_000
  )
  if (days < 0) return { tone: "bad", label: `${-days} days overdue` }
  if (days <= 7) return { tone: "warn", label: `in ${days} days` }
  return { tone: "neutral", label: day(nextDue) }
}

// ── money facts ─────────────────────────────────────────────────────────────

/// Whether a repair's actual cost has run past its ceiling — the approved
/// budget when there is one, the estimate when there is not. One rule read
/// twice (the column's red mark and the strip's count), so the two cannot
/// disagree.
export function repairOver(
  row: Pick<
    GaRepairRow,
    "actual_cost_minor" | "estimated_cost_minor" | "approved_budget_minor"
  >
): { over: boolean; cap: number | null; capWord: "budget" | "estimate" } {
  const cap = row.approved_budget_minor ?? row.estimated_cost_minor ?? null
  return {
    over: cap !== null && row.actual_cost_minor > cap,
    cap,
    capWord: row.approved_budget_minor !== null ? "budget" : "estimate",
  }
}

export function disposalMethodWords(method: string): string {
  switch (method) {
    case "SOLD":
      return "Sold"
    case "SCRAPPED":
      return "Scrapped"
    case "DONATED":
      return "Donated"
    default:
      return "Lost"
  }
}
