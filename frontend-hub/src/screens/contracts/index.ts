import type { ScreenMap } from "@/screens/registry"
import { Contracts } from "@/screens/contracts/contracts"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`.
///
/// Eight paths, one screen: the six group doors, Utilities and Cleaning are
/// all the same register reading its question off the URL — the same shape
/// Assets is the existing example of. A new reading is a nav entry, not a
/// screen to write.
export const screens: ScreenMap = {
  "/contracts/sewa": Contracts,
  "/contracts/jasa": Contracts,
  "/contracts/asuransi": Contracts,
  "/contracts/izin": Contracts,
  "/contracts/langganan": Contracts,
  "/contracts/disewakan": Contracts,
  "/contracts/utilities": Contracts,
  "/contracts/cleaning": Contracts,
}
