import type { ScreenMap } from "@/screens/registry"
import { ActivityLog } from "@/screens/system/activity"
import { Health } from "@/screens/system/health"
import { Access } from "@/screens/system/access"
import { Account } from "@/screens/system/account"
import { Devices } from "@/screens/system/devices"
import { Incidents, Monitoring } from "@/screens/system/monitoring"
import { Nodes } from "@/screens/system/nodes"
import { Notifications } from "@/screens/system/notifications"
import { Organisation } from "@/screens/system/organisation"
import { SyncLane } from "@/screens/system/sync"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/system/monitoring": Monitoring,
  "/system/incidents": Incidents,
  "/system/health": Health,
  "/system/activity": ActivityLog,
  "/system": Nodes,
  "/system/devices": Devices,
  "/system/sync": SyncLane,
  "/system/access": Access,
  "/system/units": Organisation,
  "/system/notifications": Notifications,
  "/system/account": Account,
}
