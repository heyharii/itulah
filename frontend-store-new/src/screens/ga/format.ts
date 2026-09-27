import {
  AppWindow,
  Armchair,
  Box,
  Building2,
  Car,
  Cpu,
  Droplets,
  Hammer,
  KeyRound,
  Monitor,
  MoveVertical,
  Paintbrush,
  RefreshCw,
  ShieldCheck,
  Snowflake,
  Speaker,
  Stamp,
  Zap,
  type LucideIcon,
} from "lucide-react"

import { count } from "@/lib/format"
import type { GaContractRow } from "@itulah/contract"

/// The GA vocabulary a shop reads: what each class, group, stage and interval
/// is CALLED here, and the few small rules that decide a tone.
///
/// Words only, kept apart from `parts.tsx` because that file exports
/// components and react-refresh allows no functions beside them — the hub
/// splits `screens/contracts/format.ts` and `screens/maintenance/format.ts`
/// off for the same reason. The server's codes are the keys everywhere, so a
/// code this file does not know falls back to the server's own name rather
/// than to a blank.

// ── Dates ───────────────────────────────────────────────────────────────────

const dayFormat = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
})

/// `2026-09-25` → "25 Sep 2026". Dates on this wire are calendar days, so
/// they are read at local midnight rather than as UTC instants — a UTC read
/// prints yesterday for anybody west of Greenwich.
export function day(iso: string | null | undefined): string {
  if (!iso) return "—"
  const parsed = new Date(`${iso.slice(0, 10)}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? iso : dayFormat.format(parsed)
}

/// Today as the wire spells a day, on this till's own calendar.
export function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const date = String(now.getDate()).padStart(2, "0")
  return `${now.getFullYear()}-${month}-${date}`
}

/// Whole days from today to `iso`; negative once it has passed.
export function daysUntil(iso: string): number {
  return Math.round(
    (Date.parse(`${iso.slice(0, 10)}T00:00:00`) -
      Date.parse(`${today()}T00:00:00`)) /
      86_400_000,
  )
}

/// "in 3 days", "today", "5 days ago" — the distance a person acts on.
export function inDays(days: number): string {
  if (days === 0) return "today"
  if (days === 1) return "tomorrow"
  if (days === -1) return "yesterday"
  return days > 0 ? `in ${count(days)} days` : `${count(-days)} days ago`
}

// ── Assets ──────────────────────────────────────────────────────────────────

/// The seven classes a shop finds its things by — the hub's build views
/// (`frontend-hub/src/lib/builds.ts`, `BUILD_VIEWS`), in the hub's order.
///
/// Classes of THING rather than the chart's fifty-nine account classes: four
/// of those are air conditioners, lifts, escalators and gensets — four sets of
/// accounts and one kind of machine — and somebody looking for the shop's
/// machines wants the machines. Property is two builds, because land and the
/// building on it are one question to the person standing in it.
export const ASSET_CLASSES: readonly {
  readonly value: string
  readonly label: string
  readonly note: string
  readonly builds: readonly string[]
  readonly icon: LucideIcon
}[] = [
  {
    value: "property",
    label: "Property",
    note: "The building and its installations. A rented shop or mess is a contract, not an asset.",
    builds: ["LAND", "BUILDING"],
    icon: Building2,
  },
  {
    value: "technical",
    label: "Technical equipment",
    note: "AC, genset, lift, escalator and the mechanical–electrical installation.",
    builds: ["TECH"],
    icon: Cpu,
  },
  {
    value: "vehicles",
    label: "Vehicles",
    note: "Cars and motorbikes. STNK, KIR and insurance are under Contracts.",
    builds: ["VEHICLE"],
    icon: Car,
  },
  {
    value: "ffe",
    label: "Furniture & fixtures",
    note: "Office, shop & warehouse furniture, interior and exterior fit-out.",
    builds: ["FFE"],
    icon: Armchair,
  },
  {
    value: "it",
    label: "IT hardware",
    note: "Computers, printers, the till's own hardware.",
    builds: ["IT"],
    icon: Monitor,
  },
  {
    value: "audio",
    label: "Audio / music",
    note: "The shop's sound system.",
    builds: ["AUDIO"],
    icon: Speaker,
  },
  {
    value: "oe",
    label: "Operating equipment",
    note: "Racks, display hangers, tables, mannequins, hangers, sensor pins, shopping bags and baskets.",
    builds: ["OE"],
    icon: Box,
  },
]

/// The class a build belongs to. A build no class claims answers with
/// Operating equipment's box rather than `undefined`: a blank icon reads as a
/// row that failed to load.
export function classOf(build: string) {
  return (
    ASSET_CLASSES.find((one) => one.builds.includes(build)) ??
    ASSET_CLASSES[ASSET_CLASSES.length - 1]
  )
}

export function conditionOf(condition: string): {
  label: string
  tone: "ok" | "warn" | "bad"
} {
  switch (condition) {
    case "RUSAK":
      return { label: "Broken", tone: "bad" }
    case "PERLU_SERVIS":
      return { label: "Needs service", tone: "warn" }
    default:
      return { label: "Good", tone: "ok" }
  }
}

/// The register's own lifecycle, said only when it is not the ordinary
/// "registered and here". A shop reads DRAFT as a question it can answer —
/// a bill says this arrived; is it here?
export function assetStatusOf(
  status: string,
): { label: string; tone: "warn" | "info" } | null {
  switch (status) {
    case "DRAFT":
      return { label: "Not confirmed", tone: "warn" }
    case "DISPOSAL_REQUESTED":
      return { label: "Disposal asked", tone: "info" }
    default:
      return null
  }
}

// ── Contracts ───────────────────────────────────────────────────────────────

/// The six shelves a contract sits on, in the hub's order, with the chart's
/// per-shop split in mind: rent (land, the shop, the mess, a vehicle),
/// services (maintenance, cleaning, security), insurance (property all-risk
/// and fire, vehicles), permits and local tax (operating permit, STNK/KIR,
/// PBB, billboard tax), utilities (PLN, PDAM, telephone and internet).
export const CONTRACT_GROUPS: readonly {
  readonly value: string
  readonly label: string
  readonly icon: LucideIcon
}[] = [
  { value: "SEWA", label: "Rent", icon: Building2 },
  { value: "JASA", label: "Services", icon: Hammer },
  { value: "ASURANSI", label: "Insurance", icon: ShieldCheck },
  { value: "IZIN", label: "Permits & tax", icon: Stamp },
  { value: "LANGGANAN", label: "Utilities", icon: RefreshCw },
  { value: "DISEWAKAN", label: "Rented out", icon: KeyRound },
]

export function groupOf(code: string) {
  return (
    CONTRACT_GROUPS.find((one) => one.value === code) ?? {
      value: code,
      label: code,
      icon: Stamp,
    }
  )
}

/// English words for the seventeen types (`domain::ga::CONTRACT_TYPES`). The
/// server's own name is the fallback, so an eighteenth type is still named.
const CONTRACT_TYPE_WORDS: Readonly<Record<string, string>> = {
  SEWA_TANAH: "Land lease",
  SEWA_TOKO: "Shop / warehouse lease",
  SEWA_RUMAH: "House / mess lease",
  SEWA_KENDARAAN: "Vehicle rental",
  JASA_MAINTENANCE: "Maintenance contract",
  JASA_CLEANING: "Cleaning",
  ASURANSI_PROPERTI: "Property insurance",
  ASURANSI_KENDARAAN: "Vehicle insurance",
  IZIN_USAHA: "Operating permit",
  IZIN_KENDARAAN: "STNK / KIR",
  PAJAK_PBB: "Property tax (PBB)",
  PAJAK_REKLAME: "Billboard tax",
  LANGGANAN_LISTRIK: "Electricity",
  LANGGANAN_AIR: "Water",
  LANGGANAN_TELEKOM: "Telephone / internet",
  DISEWAKAN_GEDUNG: "Space let out",
  DISEWAKAN_PERALATAN: "Equipment let out",
}

export function contractTypeWords(code: string, fallback?: string): string {
  return CONTRACT_TYPE_WORDS[code] ?? fallback ?? code
}

/// The party a contract names — the supplier when one is on the record, the
/// free-text counterparty (a landlord who is a person, a co-operative) when
/// not. For a rent contract this is the landlord.
export function partyOf(row: GaContractRow): string {
  return row.supplier_name ?? row.counterparty_name ?? "—"
}

/// Whether the contract names this shop or covers it as one of many.
export function coverageOf(row: GaContractRow): string | null {
  if (row.site_id !== null) return null
  return row.site_scope === "ALL_SITES" ? "Every site" : "Every shop"
}

/// The contract's standing, in words and a tone. The server computes it from
/// the window and each contract's own `reminder_days`; this only translates,
/// and names the deadline, because "ends in 37 days" is the sentence that
/// gets a renewal started.
export function standingOf(row: GaContractRow): {
  label: string
  tone: "ok" | "warn" | "bad" | "neutral"
} {
  switch (row.standing) {
    case "AKTIF":
      return { label: "Active", tone: "ok" }
    case "SEGERA_HABIS":
      return {
        label:
          row.days_to_end === null
            ? "Ends soon"
            : row.days_to_end === 0
              ? "Ends today"
              : `Ends ${inDays(row.days_to_end)}`,
        tone: "warn",
      }
    case "HABIS":
      return {
        label:
          row.days_to_end === null
            ? "Ended"
            : `Ended ${inDays(row.days_to_end)}`,
        tone: "bad",
      }
    case "BELUM_MULAI":
      return { label: "Not started", tone: "neutral" }
    case "DIHENTIKAN":
      return { label: "Terminated", tone: "neutral" }
    default:
      return { label: "Draft", tone: "neutral" }
  }
}

/// Needs somebody's attention: inside its reminder window, or past its end
/// while still on the books as running.
export function contractNeedsLook(row: GaContractRow): boolean {
  return row.standing === "SEGERA_HABIS" || row.standing === "HABIS"
}

export function periodOf(row: GaContractRow): string {
  return row.ends_on === null
    ? `From ${day(row.starts_on)}`
    : `${day(row.starts_on)} – ${day(row.ends_on)}`
}

// ── Repairs ─────────────────────────────────────────────────────────────────

/// The repair ladder (`domain::ga::REPAIR_STATUSES`), CANCELLED being the one
/// exit. Head office climbs it; a shop reads where its request has got to.
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
      return "Reported"
    case "APPROVED":
      return "Approved"
    case "IN_PROGRESS":
      return "Being fixed"
    case "COMPLETED":
      return "Fixed"
    case "CLOSED":
      return "Closed"
    default:
      return "Cancelled"
  }
}

export function repairStageTone(
  status: string,
): "warn" | "accent" | "info" | "ok" | "neutral" | "bad" {
  switch (status) {
    case "OPEN":
      return "warn"
    case "APPROVED":
      return "accent"
    case "IN_PROGRESS":
      return "info"
    case "COMPLETED":
      return "ok"
    case "CLOSED":
      return "neutral"
    default:
      return "bad"
  }
}

/// Still somebody's work: not yet fixed, and not called off.
export function repairIsOpen(status: string): boolean {
  return status === "OPEN" || status === "APPROVED" || status === "IN_PROGRESS"
}

const REPAIR_OBJECT_WORDS: Readonly<Record<string, string>> = {
  FFE: "Furniture & operating equipment",
  SOFTWARE: "Software",
  KOMPUTER: "Computer",
  BANGUNAN: "Building",
  STAFF_HOUSE: "Staff house / mess",
  KENDARAAN: "Vehicle",
  AC: "AC & refrigeration",
  POWER_PLANT: "Genset / power",
  GENSET_BBM: "Genset fuel & lubricant",
  CAT: "Painting",
  LIFT: "Lift & escalator",
}

export function repairObjectWords(code: string, fallback?: string): string {
  return REPAIR_OBJECT_WORDS[code] ?? fallback ?? code
}

const REPAIR_OBJECT_ICONS: Readonly<Record<string, LucideIcon>> = {
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
  return REPAIR_OBJECT_ICONS[code] ?? Hammer
}

/// The object a repair on this asset is charged to — the server's own rule,
/// `domain::ga::repair_object_for_class`, read the same way.
///
/// Mirrored rather than guessed for two reasons. The form must know when the
/// class does NOT decide it: the server refuses such a repair unless the
/// object is named, so those are the assets the form asks about. And the
/// object is what finds the maintenance contract that covers the thing, and
/// so the vendor. When the class decides, the form still sends no object and
/// lets the server derive it — the two cannot disagree about the account.
export function repairObjectFor(asset: {
  class_code: string
  build: string
}): string | null {
  const code = asset.class_code.trim().toUpperCase()
  if (asset.build === "OE") return "FFE"
  switch (code) {
    case "AIR_CONDITIONER":
      return "AC"
    case "LIFT":
    case "ESKALATOR":
      return "LIFT"
    case "GENSET":
      return "POWER_PLANT"
    case "MOBIL":
    case "SEPEDA_MOTOR":
      return "KENDARAAN"
    case "FFE_KOMPUTER":
      return "KOMPUTER"
    case "FFE_STAFF_HOUSE_MESS":
    case "BANGUNAN_STAFF_HOUSE_MESS":
      return "STAFF_HOUSE"
    case "SEVENTH_SOFT_APPLICATION":
    case "OPTI_TEX_SYSTEM":
      return "SOFTWARE"
    case "INSTALASI_MEKANIKAL_ELEKTRIKAL":
    case "BANGUNAN_UTAMA":
    case "BANGUNAN_TAMBAHAN":
    case "TANAH_HAK_MILIK":
    case "HAK_SEWA_TANAH_HGB":
      return "BANGUNAN"
    default:
      return code.startsWith("FFE_") ? "FFE" : null
  }
}

// ── Servicing ───────────────────────────────────────────────────────────────

/// "Every 3 months". The interval and its unit arrive apart because the
/// server rolls the next date forward from them.
export function intervalWords(kind: string, value: number): string {
  const unit =
    kind === "DAYS"
      ? value === 1
        ? "day"
        : "days"
      : kind === "MONTHS"
        ? value === 1
          ? "month"
          : "months"
        : "km"
  return `Every ${count(value)} ${unit}`
}

/// How close a service is. Overdue in bad, inside a fortnight in warn,
/// otherwise the date itself. A KM task has no calendar date, and saying
/// "late" about it would be inventing a fact.
export function dueOf(nextDue: string | null): {
  label: string
  tone: "bad" | "warn" | "neutral"
  days: number | null
} {
  if (nextDue === null) {
    return { label: "By odometer", tone: "neutral", days: null }
  }
  const days = daysUntil(nextDue)
  if (days < 0) {
    return {
      label: `${count(-days)} ${days === -1 ? "day" : "days"} overdue`,
      tone: "bad",
      days,
    }
  }
  if (days <= 14) {
    return {
      label: days === 0 ? "Due today" : `Due ${inDays(days)}`,
      tone: "warn",
      days,
    }
  }
  return { label: day(nextDue), tone: "neutral", days }
}

/// What the servicing screen and the overview call "coming up".
export const SERVICING_HORIZON_DAYS = 30

// ── Supplies ────────────────────────────────────────────────────────────────

/// REQUESTED → APPROVED → ORDERED → RECEIVED → BILLED, REJECTED the one exit.
/// BILLED is Finance's step; for the shop the thing arrived at RECEIVED.
export const SUPPLY_FLOW = [
  "REQUESTED",
  "APPROVED",
  "ORDERED",
  "RECEIVED",
  "BILLED",
] as const

export function supplyStageWords(status: string): string {
  switch (status) {
    case "REQUESTED":
      return "Asked"
    case "APPROVED":
      return "Approved"
    case "ORDERED":
      return "Ordered"
    case "RECEIVED":
      return "Received"
    case "BILLED":
      return "Billed"
    default:
      return "Rejected"
  }
}

export function supplyStageTone(
  status: string,
): "warn" | "accent" | "info" | "ok" | "bad" {
  switch (status) {
    case "REQUESTED":
      return "warn"
    case "APPROVED":
      return "accent"
    case "ORDERED":
      return "info"
    case "RECEIVED":
    case "BILLED":
      return "ok"
    default:
      return "bad"
  }
}

/// Still on its way to the shop.
export function supplyIsOpen(status: string): boolean {
  return status === "REQUESTED" || status === "APPROVED" || status === "ORDERED"
}

const SUPPLY_CATEGORY_WORDS: Readonly<Record<string, string>> = {
  ATK: "Stationery & printing",
  RUMAH_TANGGA: "Household & cleaning",
  TOKO_KANTOR: "Shop & office supplies",
  LISTRIK: "Electrical supplies",
  TOOLS: "Tools",
  TELEPON: "Telephone equipment",
  MESS: "Mess supplies",
}

export function supplyCategoryWords(code: string, fallback?: string): string {
  return SUPPLY_CATEGORY_WORDS[code] ?? fallback ?? code
}
