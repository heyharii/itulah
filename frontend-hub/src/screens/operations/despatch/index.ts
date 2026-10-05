import type { ScreenMap } from "@/screens/registry"

import { Trucks } from "@/screens/operations/despatch/trucks"

/// Both paths render the same screen — see `nav.ts`'s hidden alias entry for
/// `/operations/despatch/trucks`, kept routable so a bookmark from before the
/// owner's 29 Sep 2026 ruling (which folded the Shipments station into this
/// one) still lands on Dispatch rather than a 404.
export const screens: ScreenMap = {
  "/operations/despatch": Trucks,
  "/operations/despatch/trucks": Trucks,
}
