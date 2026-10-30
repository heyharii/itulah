import { Boxes } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// Assets — the things the company owns, from the side of the people who look
/// after them.
///
/// # Why this is GA's and not Finance's
///
/// Finance already has an asset screen and keeps it: cost, method, the monthly
/// charge, disposal. This is the other half of the same register — where the
/// thing is, what serial is on its plate, who holds it — and the owner put it
/// here for the same reason he put vendors here: registering and looking after
/// the company's things is General Affairs' work, and paying for them is
/// Finance's.
///
/// ERPNext divides it the same way, by role rather than by department: the
/// Asset record and its money belong to Accounts, and Asset Maintenance
/// belongs to roles with no accounting rights at all. What ERPNext calls
/// Quality Manager and Manufacturing User, a clothing retailer calls GA.
///
/// The tables were already built for this: `fixed_asset` carries no monetary
/// column and `asset_capitalization` carries the money (migration 0070). Two
/// doors onto one register, not two registers.
///
/// # One row
///
/// Register · Software · Projects were three rows with seven hidden build
/// routes behind them, until the owner asked for a shorter menu on 2026-09-27.
/// All ten were one register narrowed by build, so they are chips on the
/// screen now (`BUILD_VIEWS`), and the sidebar spends one row on the place.
export const assetsNav: AppModule = {
  id: "ga-assets",
  label: "Assets",
  icon: Boxes,
  home: "/assets",
  sections: [{ items: [{ path: "/assets", label: "Assets", icon: Boxes }] }],
}
