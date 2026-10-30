import { Plug } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// Vendors — the parties we owe who do not sell us clothes.
///
/// # Why this stands in GA and not in Finance
///
/// It was drawn under Finance for an hour, and the owner corrected it in five
/// words: "vendor registrasi di ga bukan?". He is right, and it is the
/// distinction every company with a General Affairs department makes: GA signs
/// up the electricity account, negotiates the shop's rent, appoints the
/// cleaners and keeps their contracts. Finance pays what they send.
///
/// So REGISTERING is this screen, in GA. What Finance needs from the same
/// record — which account the bills debit, what is owed, what is late — it
/// reads where it works: on the bill, and in payables.
///
/// The merchandise half of the same book belongs to Procurement, at
/// `/procurement/suppliers`. Three departments, one table — see migration 0212.
export const vendorsNav: AppModule = {
  id: "vendors",
  label: "Vendors",
  icon: Plug,
  home: "/vendors",
  // Where it answered for the hour it lived under Finance.
  moved: ["/finance/vendors"],
  sections: [{ items: [{ path: "/vendors", label: "Vendors", icon: Plug }] }],
}
