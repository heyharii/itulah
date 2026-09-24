import { Pin } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// Locations — the places the company operates from.
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
/// twice. A building, a floor or an area is a sub-location.
export const gaLocationsNav: AppModule = {
  id: "ga-locations",
  label: "Locations",
  icon: Pin,
  home: "/locations",
  // Declared now, inert, so the GA column reads whole before the screen lands:
  // a menu row that opened onto nothing would be the one thing worse than a
  // missing one. The screen arrives with the location hub.
  soon: true,
  sections: [{ items: [{ path: "/locations", label: "Locations", icon: Pin }] }],
}
