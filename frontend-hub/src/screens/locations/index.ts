import type { ScreenMap } from "@/screens/registry"
import { Locations } from "@/screens/locations/locations"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`.
///
/// One door, one screen: a location is a `site`, and the hub is a sheet raised
/// over this list rather than a route of its own. `ga_location_detail` is the
/// half GA adds — address, kind, floor area, contacts — and everything else on
/// the hub is a query back through the references that already point at the
/// site (brief §2.1).
export const screens: ScreenMap = {
  "/locations": Locations,
}
