import { Handshake } from "lucide-react"

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
/// # One row
///
/// The six groups were six rows, with Utilities and Cleaning as hidden views
/// behind them, until the owner asked for a shorter menu on 2026-09-27. All
/// eight were one table narrowed by one parameter, so the groups are chips on
/// the register now (`screens/contracts/groups.ts`) and the sidebar spends one
/// row on the place.
export const contractsNav: AppModule = {
  id: "contracts",
  label: "Contracts",
  icon: Handshake,
  home: "/contracts",
  sections: [
    { items: [{ path: "/contracts", label: "Contracts", icon: Handshake }] },
  ],
}
