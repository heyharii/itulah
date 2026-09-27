import type { ScreenMap } from "@/screens/registry"
import { StoreDetail } from "@/screens/stores/detail"
import { StoresList } from "@/screens/stores/list"

/// Screens this module has written. Keys must be paths declared in
/// `nav.ts`; anything not listed here renders `Placeholder`.
export const screens: ScreenMap = {
  "/stores": StoresList,
  "/stores/$unit": StoreDetail,
}
