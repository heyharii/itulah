import { createContext, useCallback, useContext, useMemo, useState } from "react"

import { addDays, dayKey, todayKey, type DayKey } from "@/lib/day"

import {
  EMPLOYEES,
  LOCATIONS,
  setEmployeeRegistry,
  type Employee,
  type EmploymentType,
} from "@/components/hr/data"

/** The three calls Head Office reserves for itself. */
export type RequestKind = "hire" | "exit"
export type RequestStatus = "pending" | "approved" | "declined"

export interface PeopleRequest {
  id: string
  kind: RequestKind
  locationId: string
  /** Who raised it — a store manager, in practice. */
  raisedBy: string
  /** For an exit: the person leaving. For a hire: left empty. */
  employeeId?: string
  /** For a hire: what the store is asking for. */
  role?: string
  reason: string
  status: RequestStatus
  /** Days since it was raised. */
  age: number
  decidedBy?: string
  decisionNote?: string
}

/* ── the people record itself ─────────────────────────────────
 * A store keeps its own team's details current, because it is the one that
 * sees them every day. Head Office still has to agree before the record
 * changes — a name on a payslip and a contract type both cost money. */

export type ChangeKind = "add" | "edit"

/** The fields a store fills in; everything else is derived or Head Office's. */
export interface EmployeeDraft {
  name: string
  role: string
  division: string
  locationId: string
  employmentType: EmploymentType
  contractEndsOn?: DayKey
}

export interface RecordChange {
  id: string
  kind: ChangeKind
  /** Empty for a new joiner. */
  employeeId?: string
  draft: EmployeeDraft
  reason: string
  raisedBy: string
  locationId: string
  status: RequestStatus
  age: number
  decidedBy?: string
  decisionNote?: string
}

/** Only the fields that actually moved, for the diff Head Office reads. */
export function changedFields(before: Employee | undefined, draft: EmployeeDraft) {
  if (!before) return []
  const rows: { field: string; from: string; to: string }[] = []
  const compare = (field: string, from?: string, to?: string) => {
    if ((from ?? "") !== (to ?? "")) rows.push({ field, from: from ?? "—", to: to ?? "—" })
  }
  compare("Name", before.name, draft.name)
  compare("Role", before.role, draft.role)
  compare("Division", before.division, draft.division)
  compare("Location", before.locationId, draft.locationId)
  compare("Employment", before.employmentType, draft.employmentType)
  compare("Contract ends", before.contractEndsOn, draft.contractEndsOn)
  return rows
}

/* ── documents ────────────────────────────────────────────────
 * The store collects them because it is the one that meets the person;
 * Head Office verifies, because it is the one that has to answer for them. */

export type DocKind = "ktp" | "npwp" | "contract" | "bank" | "health"

export const DOC_KIND: Record<DocKind, { label: string; required: boolean; note: string }> = {
  ktp: { label: "KTP", required: true, note: "Identity card" },
  contract: { label: "Contract", required: true, note: "Signed employment agreement" },
  bank: { label: "Bank account", required: true, note: "Where payroll is paid" },
  npwp: { label: "NPWP", required: false, note: "Tax number, if they have one" },
  health: { label: "Health check", required: false, note: "Renewed each year" },
}

export interface EmployeeDoc {
  id: string
  employeeId: string
  kind: DocKind
  fileName: string
  uploadedBy: string
  uploadedOn: DayKey
  status: RequestStatus
  decidedBy?: string
  /** Health checks and some contracts run out. */
  expiresOn?: DayKey
}

export type PayrollStatus = "draft" | "pending" | "released"

export interface PayrollRun {
  id: string
  period: string
  status: PayrollStatus
  /** Gross pay per location, in IDR. */
  byLocation: Record<string, number>
  releasedBy?: string
}

export type ShiftId = string

/**
 * A shift type. Head Office defines these centrally — a store assigns them,
 * but cannot invent its own, so hours stay comparable across locations.
 */
export interface ShiftType {
  id: ShiftId
  label: string
  start: string
  end: string
  hue: string
  /** `off` is the absence of a shift and cannot be removed. */
  locked?: boolean
}

export const DEFAULT_SHIFTS: ShiftType[] = [
  { id: "open", label: "Open", start: "09:00", end: "17:00", hue: "#0086fc" },
  { id: "mid", label: "Mid", start: "11:00", end: "19:00", hue: "#7b5cfa" },
  { id: "close", label: "Close", start: "13:00", end: "21:00", hue: "#ffbb26" },
  { id: "off", label: "Off", start: "", end: "", hue: "var(--ink-4)", locked: true },
]

/** A full day on the floor. Anything a store rosters beyond this is overtime. */
export const STANDARD_DAY = 8

/** Hours a shift covers, crossing midnight if it has to. */
export function shiftHours(shift: ShiftType) {
  if (!shift.start || !shift.end) return 0
  const [sh, sm] = shift.start.split(":").map(Number)
  const [eh, em] = shift.end.split(":").map(Number)
  const minutes = (eh * 60 + em - (sh * 60 + sm) + 24 * 60) % (24 * 60)
  return Math.round((minutes / 60) * 100) / 100
}

export const shiftTime = (shift: ShiftType) =>
  shift.start && shift.end ? `${shift.start}–${shift.end}` : "—"

/** A week per person, indexed Monday to Sunday. */
export type Week = ShiftId[]

/** Weeks are keyed by the Monday they start on. */
export type WeekKey = string

export function mondayOf(offsetWeeks = 0): WeekKey {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const shift = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - shift + offsetWeeks * 7)
  return d.toISOString().slice(0, 10)
}

export function weekLabel(key: WeekKey) {
  const start = new Date(`${key}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date, withMonth: boolean) =>
    d.toLocaleDateString("en-GB", { day: "numeric", ...(withMonth ? { month: "short" } : {}) })
  const sameMonth = start.getMonth() === end.getMonth()
  return `${fmt(start, !sameMonth)} – ${fmt(end, true)}`
}

export const shiftWeek = (key: WeekKey, by: number): WeekKey => {
  const d = new Date(`${key}T00:00:00`)
  d.setDate(d.getDate() + by * 7)
  return d.toISOString().slice(0, 10)
}

/* Day keys are shared with the rest of the app. */
export { addDays, dayKey, todayKey, type DayKey } from "@/lib/day"

/** Monday of the week a date falls in — the roster is keyed by it. */
export const weekOfDay = (key: DayKey): WeekKey => {
  const d = new Date(`${key}T12:00:00`)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return dayKey(d)
}

/** Which slot of the roster row a date is — Monday is 0. */
export const dayIndex = (key: DayKey) => (new Date(`${key}T12:00:00`).getDay() + 6) % 7

export const daysInMonth = (year: number, month: number) =>
  new Date(year, month + 1, 0).getDate()

export function monthDays(year: number, month: number): DayKey[] {
  return Array.from({ length: daysInMonth(year, month) }, (_, i) =>
    dayKey(new Date(year, month, i + 1))
  )
}

/** The seed roster is stable, so a store opens on the same week every time. */
const seedWeek = (employeeId: string): Week =>
  Array.from({ length: 7 }, (_, day) => {
    const n = [...`${employeeId}${day}`].reduce((sum, c) => sum + c.charCodeAt(0), 0)
    return DEFAULT_SHIFTS[n % DEFAULT_SHIFTS.length].id
  })

export interface LeaveRequest {
  id: string
  employeeId: string
  kind: "annual" | "sick" | "unpaid"
  days: number
  startsIn: number
  status: "pending" | "approved" | "declined"
  note?: string
}

/* ── attendance ───────────────────────────────────────────────
 * Nothing here is typed in. A day is Off when the roster says so, Leave when
 * an approved request covers it, and otherwise present, late or absent — all
 * read off the same roster the store built. */

export type DayStatus =
  | "present"
  | "late"
  | "absent"
  | "missing"
  | "leave"
  | "holiday"
  | "off"
  | "scheduled"

export const DAY_STATUS: Record<DayStatus, { label: string; hue: string }> = {
  present: { label: "Present", hue: "var(--grass)" },
  late: { label: "Late", hue: "var(--honey)" },
  absent: { label: "Absent", hue: "var(--ember)" },
  missing: { label: "Missing punch", hue: "var(--sun)" },
  leave: { label: "On leave", hue: "var(--violet)" },
  holiday: { label: "Public holiday", hue: "var(--coral)" },
  off: { label: "Off", hue: "var(--ink-4)" },
  scheduled: { label: "Rostered", hue: "var(--sky)" },
}

/** The day a leave request starts, and every day it covers. */
export function leaveDays(request: LeaveRequest): DayKey[] {
  const start = addDays(todayKey(), request.startsIn - 14)
  return Array.from({ length: request.days }, (_, i) => addDays(start, i))
}

/* ── the calendar ─────────────────────────────────────────────
 * Head Office keeps the public holidays; a store cannot invent a day off.
 * Only the fixed-date national holidays are seeded — the ones that move
 * with the lunar calendar are set by decree each year, so they get typed
 * in rather than guessed. */

export interface Holiday {
  id: string
  date: DayKey
  label: string
}

const FIXED_HOLIDAYS: [month: number, day: number, label: string][] = [
  [0, 1, "Tahun Baru Masehi"],
  [4, 1, "Hari Buruh Internasional"],
  [5, 1, "Hari Lahir Pancasila"],
  [7, 17, "Hari Kemerdekaan RI"],
  [11, 25, "Hari Raya Natal"],
]

const seedHolidays = (): Holiday[] => {
  const year = new Date().getFullYear()
  return [year - 1, year].flatMap((y) =>
    FIXED_HOLIDAYS.map(([month, day, label]) => ({
      id: `hol-${y}-${month}-${day}`,
      date: dayKey(new Date(y, month, day)),
      label,
    }))
  )
}

/* ── clock-in corrections ─────────────────────────────────────
 * A missing punch is the machine not knowing, not a verdict. The store
 * fixes it while it is still preparing payroll; once payroll has gone to
 * Head Office the same fix becomes a request Head Office decides. */

export interface AttendanceFix {
  id: string
  employeeId: string
  date: DayKey
  /** What actually happened that day. */
  claim: "present" | "late" | "absent"
  note: string
  raisedBy: string
  status: RequestStatus
  decidedBy?: string
}

/** When someone clocked in and out, worked back from the day's status. */
export function punchesOn(
  employeeId: string,
  key: DayKey,
  status: DayStatus,
  start: string
): { in: string; out: string } | null {
  if (status !== "present" && status !== "late") return null
  const [hour, minute] = start.split(":").map(Number)
  const drift = dayNoise(employeeId, key) % 12
  const inMinutes =
    hour * 60 + minute + (status === "late" ? 14 + Math.round(drift * 2) : Math.round(drift) - 6)
  const outMinutes = inMinutes + 8 * 60 + Math.round(drift)
  const clock = (total: number) =>
    `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
  return { in: clock(inMinutes), out: clock(outMinutes) }
}

/** Stable per-person, per-day noise — the same day always reads the same. */
const dayNoise = (employeeId: string, key: DayKey) => {
  let hash = 2166136261
  for (const char of `${employeeId}:${key}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  }
  return ((hash >>> 0) % 1000) / 10
}

/** Days present, late and absent this month. */
export interface AttendanceRecord {
  present: number
  late: number
  absent: number
}

/* ── payroll ──────────────────────────────────────────────────
 * Head Office writes the components — what earns, what deducts, and on
 * what basis. The system then works a payslip out of roster and attendance
 * data, so a store prepares payroll rather than types it. The only thing a
 * store enters by hand is a component Head Office marked as manual. */

export type ComponentBasis =
  | "fixed"
  | "percent-of-base"
  | "per-present-day"
  | "per-overtime-hour"
  | "per-late-day"
  | "per-absent-day"
  | "per-unpaid-leave-day"
  | "manual"

export const BASIS_LABEL: Record<ComponentBasis, string> = {
  fixed: "Flat, every month",
  "percent-of-base": "Percent of base",
  "per-present-day": "Per day present",
  "per-overtime-hour": "Per overtime hour",
  "per-late-day": "Per day late",
  "per-absent-day": "Per day absent",
  "per-unpaid-leave-day": "Per day of unpaid leave",
  manual: "Entered by the store",
}

export interface PayrollComponent {
  id: string
  label: string
  kind: "earning" | "deduction"
  basis: ComponentBasis
  /** Rupiah for every basis except percent-of-base, which is percent points. */
  rate: number
  /** Empty means it applies to everyone. */
  appliesTo: EmploymentType[]
}

export const BASE_BY_TYPE: Record<EmploymentType, number> = {
  permanent: 8_200_000,
  contract: 6_800_000,
  "part-time": 4_500_000,
  intern: 3_200_000,
}

export const baseFor = (employee: Employee) => BASE_BY_TYPE[employee.employmentType]

export const DEFAULT_PAY_COMPONENTS: PayrollComponent[] = [
  { id: "pc-meal", label: "Meal allowance", kind: "earning", basis: "per-present-day", rate: 25_000, appliesTo: [] },
  { id: "pc-transport", label: "Transport allowance", kind: "earning", basis: "fixed", rate: 400_000, appliesTo: ["permanent", "contract"] },
  { id: "pc-overtime", label: "Overtime", kind: "earning", basis: "per-overtime-hour", rate: 35_000, appliesTo: [] },
  { id: "pc-incentive", label: "Sales incentive", kind: "earning", basis: "manual", rate: 0, appliesTo: [] },
  { id: "pc-bpjs", label: "BPJS Kesehatan", kind: "deduction", basis: "percent-of-base", rate: 1, appliesTo: ["permanent", "contract"] },
  { id: "pc-late", label: "Late", kind: "deduction", basis: "per-late-day", rate: 50_000, appliesTo: [] },
  { id: "pc-absent", label: "Unexcused absence", kind: "deduction", basis: "per-absent-day", rate: 200_000, appliesTo: [] },
  { id: "pc-unpaid", label: "Unpaid leave", kind: "deduction", basis: "per-unpaid-leave-day", rate: 320_000, appliesTo: [] },
  { id: "pc-uniform", label: "Uniform replacement", kind: "deduction", basis: "manual", rate: 0, appliesTo: [] },
]

/** A manual line a store enters against a component Head Office allows. */
export interface ManualLine {
  id: string
  employeeId: string
  componentId: string
  amount: number
  note?: string
  raisedBy: string
}

export interface PayslipLine {
  id: string
  label: string
  kind: "earning" | "deduction"
  amount: number
  /** How the number was arrived at — "18 days × Rp 25.000". */
  detail?: string
  manual?: boolean
}

export interface Payslip {
  employeeId: string
  base: number
  lines: PayslipLine[]
  earnings: number
  deductions: number
  net: number
}

/** Everything but the manual lines falls straight out of the month's data. */
export function computePayslip(
  employee: Employee,
  attendance: AttendanceRecord,
  /** Overtime hours the roster actually asked for this month. */
  overtimeHours: number,
  /** Days of approved unpaid leave falling in this month. */
  unpaidDays: number,
  components: PayrollComponent[],
  manual: ManualLine[]
): Payslip {
  const base = baseFor(employee)
  const lines: PayslipLine[] = []

  for (const component of components) {
    if (component.appliesTo.length && !component.appliesTo.includes(employee.employmentType)) {
      continue
    }

    if (component.basis === "manual") {
      for (const line of manual.filter((m) => m.componentId === component.id)) {
        lines.push({
          id: line.id,
          label: component.label,
          kind: component.kind,
          amount: line.amount,
          detail: line.note,
          manual: true,
        })
      }
      continue
    }

    const units =
      component.basis === "per-present-day"
        ? attendance.present
        : component.basis === "per-overtime-hour"
          ? Math.round(overtimeHours)
          : component.basis === "per-late-day"
            ? attendance.late
            : component.basis === "per-absent-day"
              ? attendance.absent
              : component.basis === "per-unpaid-leave-day"
                ? unpaidDays
                : 1

    if (units === 0) continue

    const amount =
      component.basis === "percent-of-base"
        ? Math.round((base * component.rate) / 100)
        : component.rate * units

    if (amount === 0) continue

    lines.push({
      id: `${employee.id}-${component.id}`,
      label: component.label,
      kind: component.kind,
      amount,
      detail:
        component.basis === "fixed"
          ? undefined
          : component.basis === "percent-of-base"
            ? `${component.rate}% of base`
            : `${units} × ${rupiah(component.rate)}`,
    })
  }

  const earnings =
    base + lines.filter((l) => l.kind === "earning").reduce((sum, l) => sum + l.amount, 0)
  const deductions = lines.filter((l) => l.kind === "deduction").reduce((sum, l) => sum + l.amount, 0)

  return { employeeId: employee.id, base, lines, earnings, deductions, net: earnings - deductions }
}

/* ── who has handed payroll in ───────────────────────────────── */

export type SubmissionStatus = "draft" | "submitted" | "returned" | "approved"

export interface PayrollSubmission {
  runId: string
  locationId: string
  status: SubmissionStatus
  submittedBy?: string
  /** Why Head Office sent it back. */
  note?: string
  decidedBy?: string
}

export const submissionKey = (runId: string, locationId: string) => `${runId}:${locationId}`

/* ── staff discount ───────────────────────────────────────────
 * Head Office sets the rate and the yearly ceiling, and is the only
 * one who can reset a balance or suspend a card. Stores watch. */

export interface DiscountPolicy {
  /** Percent off the ticket price. */
  rate: number
  /** How much a person may save in a year, in rupiah. */
  quota: number
}

export interface DiscountUse {
  id: string
  employeeId: string
  item: string
  /** Where it was rung up. */
  locationId: string
  daysAgo: number
  ticket: number
  saved: number
}

export const DEFAULT_DISCOUNT: DiscountPolicy = { rate: 25, quota: 4_000_000 }

/** Annual entitlement everyone starts the year with. */
export const LEAVE_ENTITLEMENT = 12

const pick = (predicate: (e: Employee) => boolean) => EMPLOYEES.filter(predicate)

const leadOf = (locationId: string) =>
  EMPLOYEES.find((e) => e.locationId === locationId && e.managerId === null) ??
  EMPLOYEES.find((e) => e.locationId === locationId)!

const onNotice = pick((e) => e.status === "notice")

const SEED_REQUESTS: PeopleRequest[] = [
  ...onNotice.slice(0, 3).map((e, i) => ({
    id: `rq-exit-${i}`,
    kind: "exit" as const,
    locationId: e.locationId,
    raisedBy: leadOf(e.locationId).name,
    employeeId: e.id,
    reason: ["Resigned — moving cities", "End of contract", "Resigned — further study"][i % 3],
    status: "pending" as const,
    age: 1 + i * 2,
  })),
  {
    id: "rq-hire-0",
    kind: "hire",
    locationId: "st-grand",
    raisedBy: leadOf("st-grand").name,
    role: "Sales Associate",
    reason: "Two associates short against plan since the weekend peak began.",
    status: "pending",
    age: 2,
  },
  {
    id: "rq-hire-1",
    kind: "hire",
    locationId: "wh-ckr",
    raisedBy: leadOf("wh-ckr").name,
    role: "Picker",
    reason: "Overtime running above budget for three weeks straight.",
    status: "pending",
    age: 5,
  },
  {
    id: "rq-hire-2",
    kind: "hire",
    locationId: "st-bdg",
    raisedBy: leadOf("st-bdg").name,
    role: "Cashier",
    reason: "Replacement for a leaver whose exit was approved last month.",
    status: "approved",
    age: 21,
    decidedBy: "People",
  },
]

const grossFor = (locationId: string) =>
  EMPLOYEES.filter((e) => e.locationId === locationId).reduce(
    (sum, e) => sum + (e.employmentType === "part-time" ? 4_500_000 : 8_200_000),
    0
  )

const SEED_PAYROLL: PayrollRun[] = [
  {
    id: "pay-current",
    period: "This month",
    status: "pending",
    byLocation: Object.fromEntries(LOCATIONS.map((l) => [l.id, grossFor(l.id)])),
  },
  {
    id: "pay-prev",
    period: "Last month",
    status: "released",
    releasedBy: "People",
    byLocation: Object.fromEntries(
      LOCATIONS.map((l) => [l.id, Math.round(grossFor(l.id) * 0.97)])
    ),
  },
]

const SEED_LEAVE: LeaveRequest[] = EMPLOYEES.filter(
  (e) => e.status === "active" && e.locationId !== "ho"
)
  .filter((_, i) => i % 6 === 0)
  .slice(0, 12)
  .map((e, i) => ({
    id: `lv-${i}`,
    employeeId: e.id,
    kind: (["annual", "annual", "sick", "unpaid"] as const)[i % 4],
    days: 1 + (i % 3),
    /* spread either side of today so a store sees leave it has already
     * approved sitting in this week's roster, not only future requests */
    startsIn: 10 + ((i * 5) % 13),
    status: i % 2 === 0 ? "approved" : "pending",
    note: i % 3 === 0 ? "Family event out of town." : undefined,
  }))

/* One of each waiting, so the queue shows what both kinds look like. */
const SEED_CHANGES: RecordChange[] = [
  {
    id: "ch-seed-1",
    kind: "edit",
    employeeId: EMPLOYEES.find((e) => e.locationId === "st-grand" && e.employmentType === "contract")!.id,
    draft: {
      name: EMPLOYEES.find((e) => e.locationId === "st-grand" && e.employmentType === "contract")!.name,
      role: "Senior Sales Associate",
      division: "Store Ops",
      locationId: "st-grand",
      employmentType: "permanent",
    },
    reason: "Passed the review, moving from contract to permanent.",
    raisedBy: "Grand Indonesia",
    locationId: "st-grand",
    status: "pending",
    age: 1,
  },
]

/* Most people are already on file; a handful are mid-collection, which is
 * what the queue is for. */
const SEED_DOCS: EmployeeDoc[] = EMPLOYEES.flatMap((e, i) => {
  const kinds: DocKind[] = i % 7 === 0 ? ["ktp"] : i % 5 === 0 ? ["ktp", "contract"] : ["ktp", "contract", "bank"]
  return kinds.map((kind, n) => ({
    id: `doc-${e.id}-${kind}`,
    employeeId: e.id,
    kind,
    fileName: `${kind}-${e.name.toLowerCase().replace(/\s+/g, "-")}.pdf`,
    uploadedBy: LOCATIONS.find((l) => l.id === e.locationId)?.name ?? "Head Office",
    uploadedOn: dayKey(new Date(Date.now() - (30 + i * 3 + n) * 86_400_000)),
    status: i % 11 === 0 && n === 0 ? ("pending" as const) : ("approved" as const),
    decidedBy: i % 11 === 0 && n === 0 ? undefined : "People",
  }))
})

const HUES = ["#0086fc", "#7b5cfa", "#ffbb26", "#00c978", "#ff58ae", "#64c6ff", "#ff3e00"]

const ACTIVE = EMPLOYEES.filter((e) => e.status === "active")
/* Adjustments come up from a shop floor, so seed them against one. */
const STORE_STAFF = ACTIVE.filter((e) => e.locationId === "st-grand")

const SEED_MANUAL_LINES: ManualLine[] = [
  {
    id: "ml-seed-1",
    employeeId: STORE_STAFF[2].id,
    componentId: "pc-incentive",
    amount: 1_200_000,
    note: "Top seller for the month.",
    raisedBy: "Grand Indonesia",
  },
  {
    id: "ml-seed-2",
    employeeId: STORE_STAFF[4].id,
    componentId: "pc-uniform",
    amount: 180_000,
    raisedBy: "Grand Indonesia",
  },
]

/* Two stores have handed this month in already; the rest are still working
 * on it, which is the state a payroll deadline actually looks like. */
const SEED_SUBMISSIONS: Record<string, PayrollSubmission> = Object.fromEntries(
  (["st-pi", "st-bdg"] as const).map((locationId) => [
    submissionKey("pay-current", locationId),
    {
      runId: "pay-current",
      locationId,
      status: "submitted" as const,
      submittedBy: leadOf(locationId).name,
    },
  ])
)

const DISCOUNT_ITEMS = [
  "Wool blend coat",
  "Straight leg denim",
  "Ribbed knit dress",
  "Oversized shirt",
  "Leather loafers",
  "Cotton tee, 3-pack",
  "Quilted jacket",
  "Pleated midi skirt",
]

/* A cheap deterministic hash so the seeded spend has a real spread —
 * some people barely touch the discount, a few are close to the ceiling. */
const spread = (seed: number) => ((seed * 1103515245 + 12345) >>> 8) % 1000

const SEED_DISCOUNT_USES: DiscountUse[] = ACTIVE.flatMap((e, i) => {
  const count = spread(i + 1) % 8
  return Array.from({ length: count }, (_, n) => {
    const ticket = 240_000 + (spread(i * 31 + n * 7 + 3) % 22) * 165_000
    return {
      id: `du-${i}-${n}`,
      employeeId: e.id,
      item: DISCOUNT_ITEMS[spread(i + n * 5) % DISCOUNT_ITEMS.length],
      locationId: e.locationId,
      daysAgo: 1 + (spread(i * 13 + n) % 300),
      ticket,
      saved: Math.round((ticket * DEFAULT_DISCOUNT.rate) / 100),
    }
  })
})

interface HrValue {
  requests: PeopleRequest[]
  /** The shared in-memory directory — a store proposes, Head Office writes. */
  employees: Employee[]
  changes: RecordChange[]
  docs: EmployeeDoc[]
  docsFor: (employeeId: string) => EmployeeDoc[]
  docGaps: (employeeId: string) => DocKind[]
  addDoc: (doc: Omit<EmployeeDoc, "id" | "status" | "uploadedOn">) => void
  decideDoc: (id: string, status: RequestStatus, by: string) => void
  raiseChange: (change: Omit<RecordChange, "id" | "status" | "age">) => void
  decideChange: (id: string, status: RequestStatus, by: string, note?: string) => void
  /** Shift types, owned by Head Office. */
  shifts: ShiftType[]
  shiftMeta: (id: ShiftId) => ShiftType
  saveShift: (shift: ShiftType) => void
  removeShift: (id: ShiftId) => void
  /** Rosters keyed by week, then by employee. A week with no entry inherits. */
  rosterByWeek: Record<WeekKey, Record<string, Week>>
  weekOf: (employeeId: string, week: WeekKey) => Week
  /** True while a week is still exactly what the previous week said. */
  isInherited: (week: WeekKey) => boolean
  setShift: (employeeId: string, week: WeekKey, day: number, shift: ShiftId) => void
  setDay: (employeeIds: string[], week: WeekKey, day: number, shift: ShiftId) => void
  clearWeek: (employeeId: string, week: WeekKey) => void
  resetWeek: (week: WeekKey) => void
  attendance: Record<string, AttendanceRecord>
  /** One person, one day — the whole attendance model lives here. */
  attendanceOn: (employeeId: string, key: DayKey) => DayStatus
  monthAttendance: (employeeId: string, year: number, month: number) => AttendanceRecord
  /** Corrections to a day the clock got wrong. */
  fixes: AttendanceFix[]
  fixOn: (employeeId: string, key: DayKey) => AttendanceFix | undefined
  raiseFix: (fix: Omit<AttendanceFix, "id" | "status">, immediate: boolean) => void
  decideFix: (id: string, status: RequestStatus, by: string) => void
  /** Public holidays, kept by Head Office. */
  holidays: Holiday[]
  holidayOn: (key: DayKey) => Holiday | undefined
  saveHoliday: (holiday: Holiday) => void
  removeHoliday: (id: string) => void
  /** The component catalogue — Head Office's to write. */
  payrollComponents: PayrollComponent[]
  savePayrollComponent: (component: PayrollComponent) => void
  removePayrollComponent: (id: string) => void
  /** Manual lines a store enters against a manual component. */
  manualLines: ManualLine[]
  addManualLine: (line: Omit<ManualLine, "id">) => void
  removeManualLine: (id: string) => void
  /** Every payslip for a location, worked out from the month's own data. */
  payslipsFor: (locationId: string) => Payslip[]
  /** Overtime the roster asks of one person this month, in hours. */
  overtimeFor: (employeeId: string) => number
  netFor: (locationId: string) => number
  submissions: Record<string, PayrollSubmission>
  submissionFor: (runId: string, locationId: string) => PayrollSubmission
  submitPayroll: (runId: string, locationId: string, by: string) => void
  returnPayroll: (runId: string, locationId: string, by: string, note: string) => void
  approveSubmission: (runId: string, locationId: string, by: string) => void
  /** Staff discount — Head Office acts, stores read. */
  discountPolicy: DiscountPolicy
  setDiscountPolicy: (policy: DiscountPolicy) => void
  discountUses: DiscountUse[]
  discountUsedBy: (employeeId: string) => number
  resetDiscount: (employeeId: string) => void
  suspendedDiscounts: string[]
  toggleDiscount: (employeeId: string) => void
  payroll: PayrollRun[]
  leave: LeaveRequest[]
  decideRequest: (id: string, status: RequestStatus, by: string, note?: string) => void
  raiseRequest: (request: Omit<PeopleRequest, "id" | "status" | "age">) => void
  releasePayroll: (id: string, by: string) => void
  decideLeave: (id: string, status: LeaveRequest["status"]) => void
}

const HrContext = createContext<HrValue | null>(null)

export function HrProvider({ children }: { children: React.ReactNode }) {
  const [requests, setRequests] = useState<PeopleRequest[]>(SEED_REQUESTS)
  const [payroll, setPayroll] = useState<PayrollRun[]>(SEED_PAYROLL)
  const [leave, setLeave] = useState<LeaveRequest[]>(SEED_LEAVE)
  const [rosterByWeek, setRosterByWeek] = useState<Record<WeekKey, Record<string, Week>>>({})
  const [payrollComponents, setPayrollComponents] =
    useState<PayrollComponent[]>(DEFAULT_PAY_COMPONENTS)
  const [manualLines, setManualLines] = useState<ManualLine[]>(SEED_MANUAL_LINES)
  const [submissions, setSubmissions] =
    useState<Record<string, PayrollSubmission>>(SEED_SUBMISSIONS)
  const [discountPolicy, setDiscountPolicy] = useState<DiscountPolicy>(DEFAULT_DISCOUNT)
  const [discountUses, setDiscountUses] = useState<DiscountUse[]>(SEED_DISCOUNT_USES)
  const [suspendedDiscounts, setSuspendedDiscounts] = useState<string[]>([])
  const [shifts, setShifts] = useState<ShiftType[]>(DEFAULT_SHIFTS)
  const [holidays, setHolidays] = useState<Holiday[]>(seedHolidays)
  const [fixes, setFixes] = useState<AttendanceFix[]>([])
  const [employees, setEmployees] = useState<Employee[]>(EMPLOYEES)
  const [changes, setChanges] = useState<RecordChange[]>(SEED_CHANGES)
  const [docs, setDocs] = useState<EmployeeDoc[]>(SEED_DOCS)

  /* Sync the shared in-memory list before children render, so the helpers in
   * data.ts — employeeOf, locationStats — see the same people as the screens. */
  setEmployeeRegistry(employees)

  const shiftMeta = useCallback(
    (id: ShiftId) => shifts.find((s) => s.id === id) ?? shifts[shifts.length - 1],
    [shifts]
  )

  const saveShift = useCallback((shift: ShiftType) => {
    setShifts((list) => {
      const i = list.findIndex((s) => s.id === shift.id)
      if (i === -1) return [...list.slice(0, -1), shift, list[list.length - 1]]
      const next = [...list]
      next[i] = shift
      return next
    })
  }, [])

  const removeShift = useCallback(
    (id: ShiftId) => setShifts((list) => list.filter((s) => s.id !== id || s.locked)),
    []
  )

  /* A week that nobody has touched simply repeats the week before it, all the
   * way back to the seed — so last week's rota keeps applying until someone
   * actually changes something. */
  const weekOf = useCallback(
    (employeeId: string, week: WeekKey): Week => {
      let cursor = week
      for (let back = 0; back < 52; back += 1) {
        const stored = rosterByWeek[cursor]?.[employeeId]
        if (stored) return stored
        cursor = shiftWeek(cursor, -1)
      }
      return seedWeek(employeeId)
    },
    [rosterByWeek]
  )

  const isInherited = useCallback(
    (week: WeekKey) => Object.keys(rosterByWeek[week] ?? {}).length === 0,
    [rosterByWeek]
  )

  /** Copy the inherited week into this one before editing it. */
  const materialise = useCallback(
    (week: WeekKey, employeeIds: string[]) => {
      const current = rosterByWeek[week] ?? {}
      const next = { ...current }
      for (const id of employeeIds) if (!next[id]) next[id] = [...weekOf(id, week)]
      return next
    },
    [rosterByWeek, weekOf]
  )

  const setShift = useCallback(
    (employeeId: string, week: WeekKey, day: number, shift: ShiftId) => {
      setRosterByWeek((all) => {
        const base = all[week] ?? {}
        const existing = base[employeeId] ?? [...weekOf(employeeId, week)]
        const updated = [...existing]
        updated[day] = shift
        return { ...all, [week]: { ...base, [employeeId]: updated } }
      })
    },
    [weekOf]
  )

  const setDay = useCallback(
    (employeeIds: string[], week: WeekKey, day: number, shift: ShiftId) => {
      setRosterByWeek((all) => {
        const base = materialise(week, employeeIds)
        for (const id of employeeIds) {
          const updated = [...base[id]]
          updated[day] = shift
          base[id] = updated
        }
        return { ...all, [week]: base }
      })
    },
    [materialise]
  )

  const clearWeek = useCallback((employeeId: string, week: WeekKey) => {
    setRosterByWeek((all) => ({
      ...all,
      [week]: { ...(all[week] ?? {}), [employeeId]: Array(7).fill("off") as Week },
    }))
  }, [])

  /** Drop this week's overrides and go back to inheriting. */
  const resetWeek = useCallback((week: WeekKey) => {
    setRosterByWeek((all) => {
      const next = { ...all }
      delete next[week]
      return next
    })
  }, [])

  const savePayrollComponent = useCallback((component: PayrollComponent) => {
    setPayrollComponents((list) => {
      const i = list.findIndex((c) => c.id === component.id)
      if (i === -1) return [...list, component]
      const next = [...list]
      next[i] = component
      return next
    })
  }, [])

  const removePayrollComponent = useCallback(
    (id: string) => setPayrollComponents((list) => list.filter((c) => c.id !== id)),
    []
  )

  const addManualLine = useCallback((line: Omit<ManualLine, "id">) => {
    setManualLines((list) => [...list, { ...line, id: `ml-${Date.now()}` }])
  }, [])

  const removeManualLine = useCallback(
    (id: string) => setManualLines((list) => list.filter((l) => l.id !== id)),
    []
  )

  /* While a store still has payroll in its hands the fix simply applies;
   * after it has been handed in, Head Office decides. */
  const raiseFix = useCallback(
    (fix: Omit<AttendanceFix, "id" | "status">, immediate: boolean) =>
      setFixes((list) => [
        ...list,
        {
          ...fix,
          id: `fix-${Date.now()}`,
          status: immediate ? ("approved" as const) : ("pending" as const),
          decidedBy: immediate ? fix.raisedBy : undefined,
        },
      ]),
    []
  )

  const decideFix = useCallback(
    (id: string, status: RequestStatus, by: string) =>
      setFixes((list) =>
        list.map((f) => (f.id === id ? { ...f, status, decidedBy: by } : f))
      ),
    []
  )

  const fixOn = useCallback(
    (employeeId: string, key: DayKey) =>
      fixes.find((f) => f.employeeId === employeeId && f.date === key),
    [fixes]
  )

  const addDoc = useCallback(
    (doc: Omit<EmployeeDoc, "id" | "status" | "uploadedOn">) =>
      setDocs((list) => [
        ...list.filter((d) => !(d.employeeId === doc.employeeId && d.kind === doc.kind)),
        { ...doc, id: `doc-${Date.now()}`, uploadedOn: todayKey(), status: "pending" },
      ]),
    []
  )

  const decideDoc = useCallback(
    (id: string, status: RequestStatus, by: string) =>
      setDocs((list) => list.map((d) => (d.id === id ? { ...d, status, decidedBy: by } : d))),
    []
  )

  const docsFor = useCallback(
    (employeeId: string) => docs.filter((d) => d.employeeId === employeeId),
    [docs]
  )

  /** Required documents that are missing or still unverified. */
  const docGaps = useCallback(
    (employeeId: string) =>
      (Object.keys(DOC_KIND) as DocKind[]).filter((kind) => {
        if (!DOC_KIND[kind].required) return false
        const doc = docs.find((d) => d.employeeId === employeeId && d.kind === kind)
        return !doc || doc.status !== "approved"
      }),
    [docs]
  )

  const raiseChange = useCallback(
    (change: Omit<RecordChange, "id" | "status" | "age">) =>
      setChanges((list) => [
        { ...change, id: `ch-${Date.now()}`, status: "pending" as const, age: 0 },
        ...list,
      ]),
    []
  )

  /* Approving a change is what actually writes it into the directory. */
  const decideChange = useCallback(
    (id: string, status: RequestStatus, by: string, note?: string) => {
      const change = changes.find((c) => c.id === id)
      if (!change) return

      if (status === "approved") {
        setEmployees((people) => {
          if (change.kind === "edit" && change.employeeId) {
            return people.map((p) => (p.id === change.employeeId ? { ...p, ...change.draft } : p))
          }
          return [
            ...people,
            {
              ...change.draft,
              id: `e${String(people.length + 1).padStart(3, "0")}`,
              status: "probation" as const,
              tenureMonths: 0,
              hue: HUES[people.length % HUES.length],
              overtimeHours: 0,
              attendance: 100,
              managerId: null,
            },
          ]
        })
      }

      setChanges((list) =>
        list.map((c) => (c.id === id ? { ...c, status, decidedBy: by, decisionNote: note } : c))
      )
    },
    [changes]
  )

  const holidayOn = useCallback(
    (key: DayKey) => holidays.find((h) => h.date === key),
    [holidays]
  )

  const saveHoliday = useCallback((holiday: Holiday) => {
    setHolidays((list) => {
      const i = list.findIndex((h) => h.id === holiday.id)
      const next = i === -1 ? [...list, holiday] : list.map((h) => (h.id === holiday.id ? holiday : h))
      return [...next].sort((a, b) => a.date.localeCompare(b.date))
    })
  }, [])

  const removeHoliday = useCallback(
    (id: string) => setHolidays((list) => list.filter((h) => h.id !== id)),
    []
  )

  /* One day for one person, read off the roster rather than recorded:
   * a rostered day in the past resolves to present, late or absent using
   * that person's rate, and a day in the future is simply rostered. */
  const attendanceOn = useCallback(
    (employeeId: string, key: DayKey): DayStatus => {
      const today = todayKey()
      const onLeave = leave.some(
        (l) =>
          l.employeeId === employeeId &&
          l.status === "approved" &&
          leaveDays(l).includes(key)
      )
      if (onLeave) return "leave"
      if (holidayOn(key)) return "holiday"

      const rostered = weekOf(employeeId, weekOfDay(key))[dayIndex(key)]
      if (rostered === "off") return "off"
      if (key > today) return "scheduled"

      const employee = EMPLOYEES.find((e) => e.id === employeeId)
      if (!employee) return "off"

      const fix = fixes.find(
        (f) => f.employeeId === employeeId && f.date === key && f.status === "approved"
      )
      if (fix) return fix.claim

      const noise = dayNoise(employeeId, key)
      /* the top sliver of the absent band is the machine missing a punch,
       * not a no-show — somebody has to say which it was */
      if (noise >= employee.attendance + (100 - employee.attendance) * 0.55) return "missing"
      if (noise >= employee.attendance) return "absent"
      /* the band just under the line is someone who turned up, but late */
      if (noise >= employee.attendance - 6) return "late"
      return "present"
    },
    [fixes, holidayOn, leave, weekOf]
  )

  /** Days of approved unpaid leave that land in the month being paid. */
  const unpaidDaysFor = useCallback(
    (employeeId: string) => {
      const now = new Date()
      const month = dayKey(now).slice(0, 7)
      return leave
        .filter((l) => l.employeeId === employeeId && l.status === "approved" && l.kind === "unpaid")
        .flatMap(leaveDays)
        .filter((key) => key.startsWith(month)).length
    },
    [leave]
  )

  /** Present, late and absent across one calendar month. */
  const monthAttendance = useCallback(
    (employeeId: string, year: number, month: number): AttendanceRecord => {
      const record = { present: 0, late: 0, absent: 0 }
      for (const key of monthDays(year, month)) {
        const status = attendanceOn(employeeId, key)
        if (status === "present") record.present += 1
        else if (status === "late") record.late += 1
        else if (status === "absent") record.absent += 1
      }
      return record
    },
    [attendanceOn]
  )

  const attendance = useMemo(() => {
    const now = new Date()
    return Object.fromEntries(
      EMPLOYEES.map((e) => [e.id, monthAttendance(e.id, now.getFullYear(), now.getMonth())])
    ) as Record<string, AttendanceRecord>
  }, [monthAttendance])

  /* Overtime is not typed in anywhere — it is whatever the roster asks for
   * beyond a standard day, over the four weeks of the month. */
  const overtimeFor = useCallback(
    (employeeId: string) => {
      let hours = 0
      for (let back = 0; back < 4; back += 1) {
        const week = weekOf(employeeId, shiftWeek(mondayOf(), -back))
        for (const id of week) {
          hours += Math.max(0, shiftHours(shiftMeta(id)) - STANDARD_DAY)
        }
      }
      return Math.round(hours * 10) / 10
    },
    [weekOf, shiftMeta]
  )

  const payslipsFor = useCallback(
    (locationId: string) =>
      EMPLOYEES.filter((e) => e.locationId === locationId).map((e) =>
        computePayslip(
          e,
          attendance[e.id],
          overtimeFor(e.id),
          unpaidDaysFor(e.id),
          payrollComponents,
          manualLines.filter((l) => l.employeeId === e.id)
        )
      ),
    [payrollComponents, manualLines, overtimeFor, unpaidDaysFor, attendance]
  )

  const netFor = useCallback(
    (locationId: string) => payslipsFor(locationId).reduce((sum, p) => sum + p.net, 0),
    [payslipsFor]
  )

  const submissionFor = useCallback(
    (runId: string, locationId: string): PayrollSubmission =>
      submissions[submissionKey(runId, locationId)] ?? {
        runId,
        locationId,
        status: "draft",
      },
    [submissions]
  )

  const setSubmission = useCallback(
    (runId: string, locationId: string, patch: Partial<PayrollSubmission>) =>
      setSubmissions((all) => {
        const key = submissionKey(runId, locationId)
        const current = all[key] ?? { runId, locationId, status: "draft" as const }
        return { ...all, [key]: { ...current, ...patch } }
      }),
    []
  )

  const submitPayroll = useCallback(
    (runId: string, locationId: string, by: string) =>
      setSubmission(runId, locationId, { status: "submitted", submittedBy: by, note: undefined }),
    [setSubmission]
  )

  const returnPayroll = useCallback(
    (runId: string, locationId: string, by: string, note: string) =>
      setSubmission(runId, locationId, { status: "returned", decidedBy: by, note }),
    [setSubmission]
  )

  const approveSubmission = useCallback(
    (runId: string, locationId: string, by: string) =>
      setSubmission(runId, locationId, { status: "approved", decidedBy: by, note: undefined }),
    [setSubmission]
  )

  const discountUsedBy = useCallback(
    (employeeId: string) =>
      discountUses
        .filter((u) => u.employeeId === employeeId)
        .reduce((sum, u) => sum + u.saved, 0),
    [discountUses]
  )

  /* A reset wipes the year's spend for one person — it is the only way a
   * balance goes back up, and Head Office keeps that lever. */
  const resetDiscount = useCallback(
    (employeeId: string) =>
      setDiscountUses((list) => list.filter((u) => u.employeeId !== employeeId)),
    []
  )

  const toggleDiscount = useCallback(
    (employeeId: string) =>
      setSuspendedDiscounts((list) =>
        list.includes(employeeId)
          ? list.filter((id) => id !== employeeId)
          : [...list, employeeId]
      ),
    []
  )

  const decideRequest = useCallback(
    (id: string, status: RequestStatus, by: string, note?: string) =>
      setRequests((list) =>
        list.map((r) =>
          r.id === id ? { ...r, status, decidedBy: by, decisionNote: note } : r
        )
      ),
    []
  )

  const raiseRequest = useCallback(
    (request: Omit<PeopleRequest, "id" | "status" | "age">) =>
      setRequests((list) => [
        { ...request, id: `rq-${Date.now()}`, status: "pending" as const, age: 0 },
        ...list,
      ]),
    []
  )

  const releasePayroll = useCallback(
    (id: string, by: string) =>
      setPayroll((list) =>
        list.map((p) => (p.id === id ? { ...p, status: "released", releasedBy: by } : p))
      ),
    []
  )

  const decideLeave = useCallback(
    (id: string, status: LeaveRequest["status"]) =>
      setLeave((list) => list.map((l) => (l.id === id ? { ...l, status } : l))),
    []
  )

  const value = useMemo(
    () => ({
      requests,
      employees,
      changes,
      docs,
      docsFor,
      docGaps,
      addDoc,
      decideDoc,
      raiseChange,
      decideChange,
      payroll,
      leave,
      shifts,
      shiftMeta,
      saveShift,
      removeShift,
      rosterByWeek,
      weekOf,
      isInherited,
      setShift,
      setDay,
      clearWeek,
      resetWeek,
      attendance,
      attendanceOn,
      monthAttendance,
      fixes,
      fixOn,
      raiseFix,
      decideFix,
      holidays,
      holidayOn,
      saveHoliday,
      removeHoliday,
      payrollComponents,
      savePayrollComponent,
      removePayrollComponent,
      manualLines,
      addManualLine,
      removeManualLine,
      payslipsFor,
      overtimeFor,
      netFor,
      submissions,
      submissionFor,
      submitPayroll,
      returnPayroll,
      approveSubmission,
      discountPolicy,
      setDiscountPolicy,
      discountUses,
      discountUsedBy,
      resetDiscount,
      suspendedDiscounts,
      toggleDiscount,
      decideRequest,
      raiseRequest,
      releasePayroll,
      decideLeave,
    }),
    [
      requests,
      employees,
      changes,
      docs,
      docsFor,
      docGaps,
      addDoc,
      decideDoc,
      raiseChange,
      decideChange,
      payroll,
      leave,
      shifts,
      shiftMeta,
      saveShift,
      removeShift,
      rosterByWeek,
      weekOf,
      isInherited,
      setShift,
      setDay,
      clearWeek,
      resetWeek,
      attendance,
      attendanceOn,
      monthAttendance,
      fixes,
      fixOn,
      raiseFix,
      decideFix,
      holidays,
      holidayOn,
      saveHoliday,
      removeHoliday,
      payrollComponents,
      savePayrollComponent,
      removePayrollComponent,
      manualLines,
      addManualLine,
      removeManualLine,
      payslipsFor,
      overtimeFor,
      netFor,
      submissions,
      submissionFor,
      submitPayroll,
      returnPayroll,
      approveSubmission,
      discountPolicy,
      setDiscountPolicy,
      discountUses,
      discountUsedBy,
      resetDiscount,
      suspendedDiscounts,
      toggleDiscount,
      decideRequest,
      raiseRequest,
      releasePayroll,
      decideLeave,
    ]
  )

  return <HrContext.Provider value={value}>{children}</HrContext.Provider>
}

export function useHr() {
  const value = useContext(HrContext)
  if (!value) throw new Error("useHr must be used inside HrProvider")
  return value
}

export const rupiah = (value: number) =>
  value.toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })

export const payrollTotal = (run: PayrollRun) =>
  Object.values(run.byLocation).reduce((sum, v) => sum + v, 0)
