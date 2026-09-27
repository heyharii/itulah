import type { ScreenMap } from "@/screens/registry"
import { Contracts } from "@/screens/contracts/contracts"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`.
///
/// One path: a group is a chip whose value rides in `?contract-group=`, the
/// same shape the asset register's readings take, so a new reading is a chip
/// and not a route.
export const screens: ScreenMap = {
  "/contracts": Contracts,
}
