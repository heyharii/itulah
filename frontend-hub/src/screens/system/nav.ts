import {
  Building2,
  ScrollText,
  Activity,
  HeartPulse,
  KeyRound,
  LayoutGrid,
  Printer,
  RefreshCcw,
  Settings2,
  UserRound,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's row in the sidebar and the sub-items under it.
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
  home: "/system/health",
  // The prefix the module owns, now that its first screen is not at the
  // prefix itself — see `AppModule.base`. Every `/system/...` URL still draws
  // this sidebar; only where the row lands changed.
  base: "/system",
  // Not drawn in the sidebar. The screens stay routed and stay in ⌘K — the
  // module is simply not one of the places the sidebar offers.
  hidden: true,
  sections: [
    {
      items: [
        // First, because it is the question the rest of the module answers in
        // pieces: is data moving between the centre and every node, both ways,
        // and is anything stuck.
        { path: "/system/health", label: "Health", icon: HeartPulse },
        { path: "/system", label: "Nodes", icon: LayoutGrid },
        // What is enrolled to those nodes: tills, printers, readers, per
        // site, as each node last reported them.
        { path: "/system/devices", label: "Devices", icon: Printer },
        { path: "/system/sync", label: "Sync", icon: RefreshCcw },
        // Edge assignments and RFID readers: the identity policy the centre
        // publishes to a node. Its own entry rather than a third tab on
        // Account, because "who may sign in HERE" is a different dataset from
        // "who has an account at the centre" — the same person can appear in
        // both with different roles.
        { path: "/system/access", label: "Access", icon: KeyRound },
        // The organisation: head office and the stores, their premises and
        // who is in charge of each (0450-0452).
        { path: "/system/units", label: "Units", icon: Building2 },
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
