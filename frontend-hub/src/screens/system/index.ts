import type { ScreenMap } from "@/screens/registry"
import { ActivityLog } from "@/screens/system/activity"
import { Devices } from "@/screens/system/devices"
import { Notifications } from "@/screens/system/notifications"
import { StoreServers } from "@/screens/system/servers"
import { Users } from "@/screens/system/users"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
///
/// Tidied 2026-09-27: `Nodes`, `Health`, `Incidents`, `Monitoring` and
/// `SyncLane` are still written and still exported from their own files —
/// `StoreServers` (`servers.tsx`) composes them as tabs of one page — but none
/// of them answers a route of its own any more, so none is registered here.
/// The same goes for `Access` and `Account`, which no longer exist as files:
/// their content moved into `Users` (`users.tsx`) and `Devices`, and the
/// personal half of `Account` moved to `/me`. See `nav.ts` for the redirects
/// from every path this leaves behind.
export const screens: ScreenMap = {
  "/system/users": Users,
  "/system/servers": StoreServers,
  "/system/devices": Devices,
  "/system/notifications": Notifications,
  "/system/activity": ActivityLog,
}
