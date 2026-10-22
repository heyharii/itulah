import { today } from "@/lib/calendar"
import { EMPTY, count, decimal } from "@/lib/format"
import type {
  GaOdometerReading,
  GaOperatingExpenseRow,
} from "@/lib/queries/ga-records"
import { statusTone, statusWord } from "@/lib/words"
import type {
  GaAssetEvent,
  GaContractRow,
  GaMaintenanceTaskRow,
  GaRepairRow,
} from "@itulah/contract"

/// The words and small sums the asset sheet's sections print, kept out of the
/// component files because those export components and react-refresh allows
/// no functions beside them. Pure word-work only.

/// A table head that reads left, for a text column that is not the first
/// (a `MiniTable` head is right-aligned past the first column by default).
export const left = (label: string) => ({ label, align: "left" as const })

/// And one that reads right: an amount.
export const right = (label: string) => ({ label, align: "right" as const })

export function blank(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}

export function specsOf(
  build: { fields: readonly { key: string }[] } | undefined,
  form: Readonly<Record<string, string>>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of build?.fields ?? []) {
    const value = (form[`spec:${field.key}`] ?? "").trim()
    if (value !== "") out[field.key] = value
  }
  return out
}

export function conditionWords(condition: string): string {
  switch (condition) {
    case "PERLU_SERVIS":
      return "Needs service"
    case "RUSAK":
      return "Broken"
    default:
      return "Good"
  }
}

/// Live is the only state an asset can be moved, swapped or disposed of from:
/// a draft nobody has walked the floor for cannot be swapped, and one that
/// already left has no further business with those verbs.
export function isLive(status: string): boolean {
  return status === "REGISTERED" || status === "IN_SERVICE"
}

/// The ONE status in the sheet's head. The register's own lifecycle, in the
/// four words a person says about a thing: it is in use, somebody asked to
/// dispose of it, it was replaced, it is gone.
export function headStatus(status: string): {
  word: string
  tone: "neutral" | "warn" | "done"
} {
  switch (status) {
    case "DRAFT":
      return { word: "Draft", tone: "warn" }
    case "IN_PROGRESS":
      return { word: "In progress", tone: "neutral" }
    case "DISPOSAL_REQUESTED":
      return { word: "Disposal requested", tone: "warn" }
    case "REPLACED":
      return { word: "Replaced", tone: "done" }
    case "DISPOSED":
      return { word: "Disposed", tone: "done" }
    default:
      return { word: "In use", tone: "neutral" }
  }
}

// ── the figures ─────────────────────────────────────────────────────────────

/// The latest odometer reading GA has for the vehicle, and the day it was
/// read (0975): typed, from a fuel receipt, or read at a service. The readings
/// run forward, so the highest is the latest.
export function lastOdometer(
  readings: readonly GaOdometerReading[]
): { km: number; on: string } | null {
  let top: GaOdometerReading | null = null
  for (const row of readings) {
    if (top === null || row.odometer_km > top.odometer_km) top = row
  }
  return top === null ? null : { km: top.odometer_km, on: top.read_on }
}

/// Where a reading came from, in the words of the readings layer.
export function odometerSourceWords(source: string): string {
  switch (source) {
    case "EXPENSE":
      return "Fuel or parts receipt"
    case "SERVICE":
      return "Service"
    default:
      return "Reading"
  }
}

/// Where a kilometre task falls due next: the first multiple of its interval
/// past the odometer. `null` while no reading is known.
export function kmTarget(
  interval: number,
  odometer: number | null
): number | null {
  if (interval <= 0 || odometer === null) return null
  return (Math.floor(odometer / interval) + 1) * interval
}

/// The reading a km task is next due at: the server's `next_due_km` (moved
/// on from the odometer at each service), else the first multiple of its
/// interval past the latest reading.
export function kmDue(
  task: GaMaintenanceTaskRow,
  odometer: number | null
): number | null {
  return task.next_due_km ?? kmTarget(task.interval_value, odometer)
}

/// A task's "Next due" cell: its date, "At 50.000 km" for a distance, or the
/// word for a schedule that is switched off. A km task is late once the latest
/// reading has reached it.
export function taskDue(
  task: GaMaintenanceTaskRow,
  odometer: number | null
): { text: string; late: boolean } {
  if (task.status === "PAUSED") return { text: "Paused", late: false }
  if (task.interval_kind === "KM") {
    const reading = odometer ?? task.odometer_km
    const target = kmDue(task, reading)
    return {
      text:
        target === null
          ? `Every ${count(task.interval_value)} km`
          : `At ${count(target)} km`,
      late: target !== null && reading !== null && reading >= target,
    }
  }
  return task.next_due === null
    ? { text: EMPTY, late: false }
    : { text: task.next_due, late: task.next_due < today() }
}

/// "Every 3 months", "Every 10.000 km".
export function everyWords(kind: string, value: number): string {
  const unit = kind === "DAYS" ? "days" : kind === "MONTHS" ? "months" : "km"
  return `Every ${count(value)} ${unit}`
}

/// The earliest date among the asset's running tasks; a distance task
/// ("At 50.000 km") stands in only when no task has a date. `date` is an ISO
/// day when the answer is a date, so the caller formats it.
export function nextService(
  tasks: readonly GaMaintenanceTaskRow[],
  odometer: number | null
): { date: string | null; text: string | null; late: boolean } {
  const running = tasks.filter((task) => task.status !== "PAUSED")
  const dated = running
    .filter((task) => task.next_due !== null && task.interval_kind !== "KM")
    .map((task) => task.next_due as string)
    .sort()
  if (dated.length > 0)
    return { date: dated[0], text: null, late: dated[0] < today() }
  const targets = running
    .filter((task) => task.interval_kind === "KM")
    .map((task) => ({
      interval: task.interval_value,
      target: kmDue(task, odometer ?? task.odometer_km),
    }))
  if (targets.length === 0) return { date: null, text: null, late: false }
  const known = targets
    .map((one) => one.target)
    .filter((one): one is number => one !== null)
  if (known.length > 0) {
    const nearest = Math.min(...known)
    return {
      date: null,
      text: `At ${count(nearest)} km`,
      late: odometer !== null && odometer >= nearest,
    }
  }
  return {
    date: null,
    text: `Every ${count(targets[0].interval)} km`,
    late: false,
  }
}

export function openRepairs(repairs: readonly GaRepairRow[]): number {
  return repairs.filter(
    (one) =>
      one.status === "OPEN" ||
      one.status === "APPROVED" ||
      one.status === "IN_PROGRESS"
  ).length
}

/// The end of the soonest contract still running on the asset. One already
/// past is the soonest of all, and is said to be late: it wants renewing now.
export function nextRenewal(contracts: readonly GaContractRow[]): {
  date: string | null
  late: boolean
} {
  const running = contracts
    .filter((one) => one.status === "ACTIVE" && !one.archived)
    .filter((one) => one.ends_on !== null)
    .sort((a, b) => (a.ends_on as string).localeCompare(b.ends_on as string))
  if (running.length === 0) return { date: null, late: false }
  const first = running[0]
  return {
    date: first.ends_on,
    late: first.days_to_end !== null && first.days_to_end < 0,
  }
}

// ── the history ─────────────────────────────────────────────────────────────

/// What one line of the asset's history says. The server writes the reason of
/// the automatic ones (a changed holder, a changed condition) in a sentence of
/// its own, so those are read back into the words the sheet uses; a move keeps
/// the reason the person typed, which stands after the dash.
export function eventLine(
  event: GaAssetEvent,
  siteName: (siteId: string) => string = (siteId) => siteId
): {
  what: string
  sub: string | null
} {
  const typed = (() => {
    const at = event.reason.indexOf(" — ")
    return at < 0 ? null : event.reason.slice(at + 3).trim() || null
  })()
  switch (event.kind) {
    case "REGISTERED":
      return { what: "Registered", sub: typed }
    case "TRANSFER":
      return {
        what: `Moved: ${event.from_site === null ? EMPTY : siteName(event.from_site)} → ${event.to_site === null ? EMPTY : siteName(event.to_site)}`,
        sub: typed,
      }
    case "ASSIGN":
      return {
        // A first holder has nobody before them: no "— →" to read past.
        what:
          event.from_holder === null || event.from_holder === ""
            ? `Given to ${event.to_holder ?? EMPTY}`
            : event.to_holder === null || event.to_holder === ""
              ? `Taken back from ${event.from_holder}`
              : `Holder: ${event.from_holder} → ${event.to_holder}`,
        sub: null,
      }
    case "CONDITION": {
      const read = /dari (\S+) ke (\S+)/.exec(event.reason)
      return {
        what:
          read === null
            ? "Condition changed"
            : `Condition: ${conditionWords(read[1])} → ${conditionWords(read[2])}`,
        sub: null,
      }
    }
    default:
      return { what: event.reason, sub: null }
  }
}

// ── the expenses ────────────────────────────────────────────────────────────

/// "40 L": what was bought. `null` when the expense carries no quantity.
export function expenseQuantity(row: GaOperatingExpenseRow): string | null {
  if (row.quantity === null) return null
  const amount = Number(row.quantity)
  const shown = Number.isFinite(amount) ? decimal(amount, 3) : row.quantity
  return row.unit === null ? shown : `${shown} ${row.unit}`
}

/// "48.210 km": where the odometer stood.
export function expenseOdometer(row: GaOperatingExpenseRow): string | null {
  return row.odometer_km === null ? null : `${count(row.odometer_km)} km`
}

/// "40 L · 48.210 km" — the quiet line under an expense's name. `null` when
/// the expense carries neither.
export function expenseDetail(row: GaOperatingExpenseRow): string | null {
  const parts = [expenseQuantity(row), expenseOdometer(row)].filter(
    (part): part is string => part !== null
  )
  return parts.length === 0 ? null : parts.join(" · ")
}

/// An expense's own status, in the words of its list. The tone is the dot's;
/// Finance's own reading stands after "With Finance" once there is one, and
/// the dot follows it.
export function expenseStatus(row: GaOperatingExpenseRow): {
  word: string
  tone: "neutral" | "info" | "bad" | "ok" | "warn" | "accent"
} {
  if (row.status === "CANCELLED") return { word: "Cancelled", tone: "bad" }
  if (row.status === "SUBMITTED")
    return row.finance_status === null
      ? { word: "With Finance", tone: "info" }
      : {
          word: `With Finance · ${statusWord(row.finance_status)}`,
          tone: statusTone(row.finance_status),
        }
  return { word: "Recorded", tone: "neutral" }
}
