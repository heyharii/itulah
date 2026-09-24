import {
  Building2,
  Hammer,
  Handshake,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Stamp,
  Zap,
  type LucideIcon,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// Contracts — the deals behind the bills. The shop's rent, the cleaning
/// service, the insurance, the operating permit, the PLN account, and the
/// rooms the company rents OUT to somebody else.
///
/// # Why these stand in GA
///
/// The same line every master in this domain follows: GA signs the deal and
/// looks after it — renews it, files the signed paper, remembers when it
/// ends — and Finance pays what comes in under it. A contract is the fact
/// "we owe (or are owed) by agreement"; the bills it produces are Finance's
/// facts, pointed back here through `contract_id`.
///
/// # What a contract deliberately does not carry
///
/// No monthly amount, no billing day, no payment schedule. Those belong to
/// Finance's `bill_template` (0316), which raises the draft bills; this
/// register holds the deal itself — the type, the parties, the window, the
/// total the document says, when it was signed. The value and the billed
/// amounts are two facts, and each lives where it is produced.
///
/// # Two views that are not groups
///
/// Utilities and Cleaning are the same table read for a different job, and
/// neither is a group of its own:
///
///  - **Utilities** is Langganan grouped by PLACE instead of by kind, because
///    that is how a facilities person asks the question — "what is connected
///    at the distribution centre" — and the meter readings live on those
///    contracts. Six rows of one group, sorted the other way.
///  - **Cleaning** is Jasa narrowed to its cleaning contracts, because a
///    cleaning contract is checked against a staffing schedule and not against
///    a service interval, and the person doing that check wants only theirs.
///
/// Both are `hidden`: routed, in ⌘K, reached from the group they narrow, and
/// not a place anybody sets out for. Their rows light the group they belong to
/// through `alsoLights`, because they share no path prefix with it.
type ContractGroup = {
  readonly label: string
  readonly icon: LucideIcon
}

/// One row per group of `contract_type`, in the order the brief reads them.
/// Each path is the same register, filtered to its group — six doors onto
/// one table, not six tables.
const GROUPS: readonly ContractGroup[] = [
  { label: "Sewa", icon: Building2 },
  { label: "Jasa", icon: Hammer },
  { label: "Asuransi", icon: ShieldCheck },
  { label: "Izin", icon: Stamp },
  { label: "Langganan", icon: RefreshCw },
  { label: "Disewakan", icon: KeyRound },
]

export const contractsNav: AppModule = {
  id: "contracts",
  label: "Contracts",
  icon: Handshake,
  // The register's first group is where the module's row lands, per the
  // registry's rule that home is the first item of the first section.
  home: "/contracts/sewa",
  // `home` names one group's path, so the prefix is declared separately —
  // the same shape Procurement is the existing example of.
  base: "/contracts",
  sections: [
    {
      items: [
        ...GROUPS.map((group) => ({
          path: `/contracts/${group.label.toLowerCase()}`,
          label: group.label,
          icon: group.icon,
          alsoLights:
            group.label === "Langganan"
              ? ["/contracts/utilities"]
              : group.label === "Jasa"
                ? ["/contracts/cleaning"]
                : undefined,
        })),
        {
          path: "/contracts/utilities",
          label: "Utilities",
          icon: Zap,
          hidden: true,
        },
        {
          path: "/contracts/cleaning",
          label: "Cleaning",
          icon: Sparkles,
          hidden: true,
        },
      ],
    },
  ],
}
