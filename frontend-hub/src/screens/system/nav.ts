import {
  ScrollText,
  Activity,
  KeyRound,
  LayoutGrid,
  RefreshCcw,
  Settings2,
  UserRound,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's place in the rail and everything under it in the sidebar.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// The reading order is the operator's: which nodes exist, whether they are
/// keeping up, who may sign in where, what came looking for you, and finally
/// your own account.
export const systemNav: AppModule = {
  id: "system",
  label: "System",
  icon: Settings2,
  tint: { top: "#b3b1c0", bottom: "#78758a" },
  home: "/system",
  sections: [
    {
      items: [
        { path: "/system", label: "Nodes", icon: LayoutGrid },
        { path: "/system/sync", label: "Sync", icon: RefreshCcw },
        // Edge assignments and RFID readers: the identity policy the centre
        // publishes to a node. Its own entry rather than a third tab on
        // Account, because "who may sign in HERE" is a different dataset from
        // "who has an account at the centre" — the same person can appear in
        // both with different roles.
        { path: "/system/access", label: "Access", icon: KeyRound },
        {
          path: "/system/notifications",
          label: "Notifications",
          icon: Activity,
        },
        { path: "/system/activity", label: "Activity", icon: ScrollText },
        { path: "/system/account", label: "Account", icon: UserRound },
      ],
    },
  ],
}
