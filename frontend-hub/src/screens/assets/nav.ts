import {
  AppWindow,
  Armchair,
  Box,
  Boxes,
  Building2,
  Car,
  Cpu,
  HardHat,
  Monitor,
  Speaker,
} from "lucide-react"

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
/// # Three rows, and seven more behind them
///
/// Register · Software · Projects are the three groups a manager sets out for —
/// plant, the intangibles, the cost still becoming a thing — and the endpoint
/// narrows by `group` for each.
///
/// The seven hidden rows are the BUILD views: Property, Technical Equipment,
/// Vehicles, Furniture & Fixtures, IT Hardware, Audio, Operating Equipment.
/// They are the same register narrowed by `asset_class.build` (migration 0356),
/// which is the eleven shapes a thing can come in — four of the fifty-nine
/// classes are one form, and a shop manager looking for the shop's air
/// conditioners wants the machines, not four AC-shaped lists.
///
/// They are `hidden` rather than sidebar rows, and that is the owner's cut:
/// eleven rows under Assets would push Contracts and Maintenance off the
/// screen to answer a question the chips on the Register already answer in one
/// click. A hidden row is still routed, still in ⌘K, and still reachable by a
/// link — it is simply not a place anybody sets out for.
export const assetsNav: AppModule = {
  id: "ga-assets",
  label: "Aset",
  icon: Boxes,
  home: "/assets",
  sections: [
    {
      items: [
        {
          path: "/assets",
          label: "Daftar aset",
          icon: Boxes,
          // The build views are not under Register's path in the tree the
          // router walks — they are its siblings — so arriving at one from a
          // chip would leave the column with nothing lit. See `alsoLights`.
          alsoLights: [
            "/assets/property",
            "/assets/technical",
            "/assets/vehicles",
            "/assets/ffe",
            "/assets/it",
            "/assets/audio",
            "/assets/oe",
          ],
        },
        { path: "/assets/software", label: "Perangkat lunak", icon: AppWindow },
        { path: "/assets/projects", label: "Proyek", icon: HardHat },
        {
          path: "/assets/property",
          label: "Property",
          icon: Building2,
          hidden: true,
        },
        {
          path: "/assets/technical",
          label: "Technical Equipment",
          icon: Cpu,
          hidden: true,
        },
        {
          path: "/assets/vehicles",
          label: "Vehicles",
          icon: Car,
          hidden: true,
        },
        {
          path: "/assets/ffe",
          label: "Furniture & Fixtures",
          icon: Armchair,
          hidden: true,
        },
        {
          path: "/assets/it",
          label: "IT Hardware",
          icon: Monitor,
          hidden: true,
        },
        {
          path: "/assets/audio",
          label: "Audio / Music",
          icon: Speaker,
          hidden: true,
        },
        {
          path: "/assets/oe",
          label: "Operating Equipment",
          icon: Box,
          hidden: true,
        },
      ],
    },
  ],
}
