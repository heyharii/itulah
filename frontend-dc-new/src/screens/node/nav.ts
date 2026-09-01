import { Cpu, RefreshCw, UserCog } from "lucide-react"

import type { Station } from "@/lib/navigation"

/// **Node** — the machine this warehouse is standing on.
///
/// An edge node runs whether or not anything can reach the centre: capture is
/// local and durable, and the outbox drains on its own cadence. Nobody
/// watching a bay can see whether today's work has actually got to head
/// office, so it is said here rather than left to be inferred from a screen
/// that looks the same either way.
export const nodeNav: Station = {
  id: "node",
  label: "Node",
  does: "The outbox, the machine, and your account",
  icon: Cpu,
  mesh: { c1: "#e0e2e8", c2: "#cdd2dd", c3: "#7b818f", base: "#8d939f" },
  home: "/node",
  sections: [
    {
      items: [
        { path: "/node", label: "Sync", icon: RefreshCw },
        { path: "/node/account", label: "Account", icon: UserCog },
      ],
    },
  ],
}
