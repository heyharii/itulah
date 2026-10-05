import { createContext } from "react"

import type { AppDomain } from "@/lib/navigation"

/// On a compact desk (an iPad held sideways) pressing a department in the rail
/// opens that department's screens beside it, floating, instead of walking to
/// its home. The shell provides this; the rail reads it. Null where a press
/// simply navigates.
export const RailPick = createContext<((domain: AppDomain) => void) | null>(
  null
)
