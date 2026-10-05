import { Pin } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// Sites — the premises the company operates from.
///
/// # Why this is not a new master
///
/// `site` is already the company's own list of places: every journal line, every
/// asset and every stock movement carries a `site_id`, and the shop a person
/// stands in is the shop the books are kept for. A GA "location" table would be
/// a second list of the same places, and the first thing to drift.
///
/// What GA adds is what the site table never needed: the address, what kind of
/// place it is, its floor area, who to ring in an emergency, and which parts of
/// it are which — the ground floor, the warehouse, the mess. Those live beside
/// the site, one row each, and the hub reads the site's assets, contracts,
/// utilities, repairs and supplies back through the references that already
/// point at it.
///
/// # Why offices and warehouses are not sites of their own
///
/// Migration 0353 settled this: the distribution centre IS head office, kind
/// `HO`, and a second site for a building would put the same place in the books
/// twice. A building, a floor or an area is a sub-site.
export const gaLocationsNav: AppModule = {
  id: "ga-locations",
  label: "Sites",
  icon: Pin,
  home: "/locations",
  // Live: the list and its hub are written, so the row navigates rather than
  // sitting inert. `site` is the company's own list of places, so this module
  // has one door and does not unfold — the hub is a sheet raised over this
  // list, not a second screen beside it. Paths and labels unchanged: the
  // screen arrives at the path the menu already claimed.
  sections: [{ items: [{ path: "/locations", label: "Sites", icon: Pin }] }],
}
