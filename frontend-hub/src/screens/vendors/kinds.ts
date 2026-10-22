import {
  Briefcase,
  Building,
  Droplets,
  Printer,
  Snowflake,
  Sparkles,
  Truck,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react"

/// What a supplier is for, said the way the department says it.
///
/// # Where the kind comes from
///
/// The supplier record has no kind of its own. What it does carry is the
/// account its bills usually debit, and that account IS the answer to "what do
/// we buy from them": a bill that debits Biaya Pemakaian Listrik is the power
/// company, one that debits Biaya Kebersihan is the cleaners. So the kind is
/// read off the account, by the client's own chart (`6040`, `6045`, …), and a
/// supplier with no account yet reads as Other until somebody sets it. No
/// name guessing: a wrong chip is worse than an honest "Other".
export type SupplierKind =
  | "UTILITIES"
  | "CLEANING"
  | "WORKSHOP"
  | "AC"
  | "LOGISTICS"
  | "OFFICE"
  | "LANDLORD"
  | "OTHER"

export interface KindInfo {
  readonly value: SupplierKind
  readonly label: string
  readonly icon: LucideIcon
}

/// In the order the chips stand.
export const KINDS: readonly KindInfo[] = [
  { value: "UTILITIES", label: "Utilities", icon: Zap },
  { value: "CLEANING", label: "Cleaning", icon: Sparkles },
  { value: "WORKSHOP", label: "Workshop", icon: Wrench },
  { value: "AC", label: "AC", icon: Snowflake },
  { value: "LOGISTICS", label: "Logistics", icon: Truck },
  { value: "OFFICE", label: "Office", icon: Printer },
  { value: "LANDLORD", label: "Landlord", icon: Building },
  { value: "OTHER", label: "Other", icon: Briefcase },
]

/// The accounts of the client's chart, by what they buy. Anything not named
/// here is Other.
const BY_ACCOUNT: Readonly<Record<string, SupplierKind>> = {
  // Telephone and internet, electricity, water.
  "6044": "UTILITIES",
  "6045": "UTILITIES",
  "6046": "UTILITIES",
  // Kebersihan.
  "6040": "CLEANING",
  // Repairs and upkeep: electrical, tyres, fuel, tools, furniture, computers,
  // buildings, staff houses, vehicles, power plant, paint, lifts.
  "6054": "WORKSHOP",
  "6055": "WORKSHOP",
  "6056": "WORKSHOP",
  "6057": "WORKSHOP",
  "6066": "WORKSHOP",
  "6068": "WORKSHOP",
  "6069": "WORKSHOP",
  "6070": "WORKSHOP",
  "6071": "WORKSHOP",
  "6073": "WORKSHOP",
  "6074": "WORKSHOP",
  "6075": "WORKSHOP",
  // Air conditioners and refrigerators.
  "6072": "AC",
  // Couriers and loading.
  "6009": "LOGISTICS",
  "6010": "LOGISTICS",
  // Stationery, household, computer and shop supplies.
  "6041": "OFFICE",
  "6042": "OFFICE",
  "6050": "OFFICE",
  "6052": "OFFICE",
  "6063": "OFFICE",
  // Rent of land, shops, warehouses and the staff house.
  "7002": "LANDLORD",
  "7004": "LANDLORD",
  "7005": "LANDLORD",
}

const OTHER = KINDS[KINDS.length - 1]

/// The kind of a supplier whose bills debit this account.
export function kindOf(accountCode: string | null): KindInfo {
  if (accountCode === null) return OTHER
  const kind = BY_ACCOUNT[accountCode.trim()]
  return KINDS.find((one) => one.value === kind) ?? OTHER
}

/// An account's name as the chart keeps it, said calmly. The client's headings
/// are in capitals ("BIAYA PERBAIKAN DAN PERAWATAN KENDARAAN"), which in a
/// column of names reads as shouting; a name that is all capitals is set in
/// capitals-and-small, short ones (AC, FFE) kept as they are. A name already
/// in mixed case is the client's own and is left alone.
export function calmName(name: string): string {
  if (name !== name.toUpperCase()) return name
  return name
    .split(" ")
    .map((word) => {
      const lower = word.toLowerCase()
      if (SMALL_WORDS.has(lower)) return lower
      if (word.length <= 3) return word
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(" ")
}

const SMALL_WORDS: ReadonlySet<string> = new Set(["dan", "di", "dari", "atau"])

/// The glyph on a supplier's row: the kind's own, except that water is a drop
/// and not the power company's bolt.
export function glyphOf(accountCode: string | null): LucideIcon {
  return accountCode?.trim() === "6046" ? Droplets : kindOf(accountCode).icon
}
