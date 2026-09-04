import { Megaphone, Percent, Tags, Ticket } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's row in the sidebar and the sub-items under it.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// **Pricelist → Promotions → Campaign → Vouchers**, in the order the work
/// happens. A price exists before anything can come off it, a promotion is the
/// thing that comes off, and a campaign is the envelope several promotions are
/// run and budgeted as one thing inside.
///
/// A coupon is deliberately absent. It is a *gate* on a promotion, not a thing
/// of its own: a rule carrying a code is shut until somebody presents that
/// code, which is a column on the Promotions list and a field on its form.
/// Giving it a sub-item would imply a coupon can exist without a promotion to
/// unlock, and one cannot.
///
/// **Margin arrived here 2026-09-03** when the Analytics module was dissolved.
/// What is left once the tax comes off, and what each garment actually brought
/// in, is the question a price is set to answer — so it belongs three rows from
/// the pricelist that sets it, not in a module named after the chart it draws.
///
/// A voucher, by contrast, earns its own row precisely because it is *not* one
/// of the other three. It carries money — it is tender, sitting beside cash and
/// a card at the counter — where the first three all describe what something
/// costs. Filing it under pricing is the mistake the system this replaces made,
/// and it is why a clearance there was booked as a discount.
export const commercialNav: AppModule = {
  id: "commercial",
  label: "Commercial",
  icon: Tags,
  home: "/commercial",
  sections: [
    {
      items: [
        { path: "/commercial", label: "Pricelist", icon: Tags },
        { path: "/commercial/promotions", label: "Promotions", icon: Percent },
        { path: "/commercial/campaigns", label: "Campaign", icon: Megaphone },
        { path: "/commercial/vouchers", label: "Vouchers", icon: Ticket },
      ],
    },
  ],
}
