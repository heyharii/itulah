import {
  Building2,
  Hammer,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Stamp,
  type LucideIcon,
} from "lucide-react"

import type { SheetSearch } from "@/lib/sheets"

/// The wire's word for a group of contract types.
export type ContractGroupCode = NonNullable<SheetSearch["contract-group"]>

/// The six groups of `contract_type`, in the order the register reads them.
///
/// One list for the two places that offer them — the chips above the register
/// and the Group cards in the composer — so the chip and the card cannot
/// disagree about what a group is called. `group_code` is the wire's word and
/// never changes; `label` is what a person reads.
export const CONTRACT_GROUPS: readonly {
  readonly label: string
  readonly icon: LucideIcon
  readonly group_code: ContractGroupCode
}[] = [
  { label: "Leases", icon: Building2, group_code: "SEWA" },
  { label: "Services", icon: Hammer, group_code: "JASA" },
  { label: "Insurance", icon: ShieldCheck, group_code: "ASURANSI" },
  { label: "Permits", icon: Stamp, group_code: "IZIN" },
  { label: "Subscriptions", icon: RefreshCw, group_code: "LANGGANAN" },
  { label: "Leased out", icon: KeyRound, group_code: "DISEWAKAN" },
]
