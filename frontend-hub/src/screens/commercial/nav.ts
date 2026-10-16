import {
  Clock,
  LayoutDashboard,
  Megaphone,
  Percent,
  Tags,
  Ticket,
  Waypoints,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's row in the sidebar and the sub-items under it.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// ## The shape, ruled by the owner 2026-09-13
///
/// **Overview · Prices · Changes · History · Promotions · Campaigns ·
/// Vouchers**, all at ONE level. Commercial V1 writes Prices, Changes and
/// History as the three workspaces of a thing called Pricing, and the first
/// draft of this file nested them under a `Pricing` parent. The owner's
/// correction was flat, and it is the right one for this shell: the rail is
/// already the module's own column, so a parent row here would be a second
/// level of navigation inside a panel that exists to BE the level — one more
/// click to reach the screen somebody opens forty times a day.
///
/// The grouping survives as order rather than as depth. Prices, Changes and
/// History sit together, in that sequence, because they are three tenses of
/// one question:
///
///   * **Prices** — what is a shop actually charging right now?
///   * **Changes** — what price work is still outstanding?
///   * **History** — what has already happened to this price?
///
/// ## What is deliberately NOT a row here
///
/// Markdown, Clearance, Correction and Regular Price Change are **kinds of
/// change**, not destinations: they are a column and a filter on Changes. A
/// menu row each would split one queue four ways and hide the fact that a
/// clearance and an end-of-season markdown are the same rows with different
/// intent — which is exactly why `ChangeKind` is authored rather than derived.
///
/// A coupon is a *gate* on a promotion, not a thing of its own: a rule carrying
/// a code is shut until somebody presents that code. It is a tab inside a
/// promotion, a column on the Promotions list, and a field on its form. Giving
/// it a row would imply a coupon can exist without a promotion to unlock, and
/// one cannot.
///
/// Points belong to the customer, not to pricing — they are a liability the
/// business owes a member, where everything else here is what something costs.
/// They live under the member directory and are absent from this file on
/// purpose.
///
/// A voucher, by contrast, earns its own row precisely because it is *not* one
/// of the others. It carries money — it is tender, sitting beside cash and a
/// card at the counter. Filing it under pricing is the mistake the system this
/// replaces made, and it is why a clearance there was booked as a discount.
export const commercialNav: AppModule = {
  id: "commercial",
  label: "Commercial",
  icon: Tags,
  home: "/commercial",
  sections: [
    {
      // Owner's menu of 2026-09-28: Pricelist, Promotions, Campaigns and
      // Vouchers are the department's own primary rows now; Overview and
      // History moved under More. Changes became the Pricelist's second tab.
      items: [
        {
          path: "/commercial",
          label: "Overview",
          icon: LayoutDashboard,
          more: true,
        },
        {
          path: "/commercial/prices",
          label: "Pricelist",
          icon: Tags,
          alsoLights: ["/commercial/changes"],
        },
        {
          // Price changes are a tab of the Pricelist now; the path stays
          // routed for the links that name it.
          path: "/commercial/changes",
          label: "Changes",
          icon: Waypoints,
          hidden: true,
        },
        {
          path: "/commercial/history",
          label: "History",
          icon: Clock,
          more: true,
        },
        { path: "/commercial/promotions", label: "Promotions", icon: Percent },
        { path: "/commercial/campaigns", label: "Campaigns", icon: Megaphone },
        { path: "/commercial/vouchers", label: "Vouchers", icon: Ticket },
      ],
    },
  ],
}
