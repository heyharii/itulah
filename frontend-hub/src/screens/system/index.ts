import type { ScreenMap } from "@/screens/registry"
import { ActivityLog } from "@/screens/system/activity"
import { Health } from "@/screens/system/health"
import { Access } from "@/screens/system/access"
import { Account } from "@/screens/system/account"
import { Nodes } from "@/screens/system/nodes"
import { Notifications } from "@/screens/system/notifications"
import { SyncLane } from "@/screens/system/sync"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/system/health": Health,
  "/system/activity": ActivityLog,
  "/system": Nodes,
  "/system/sync": SyncLane,
  "/system/access": Access,
  "/system/notifications": Notifications,
  "/system/account": Account,
}
