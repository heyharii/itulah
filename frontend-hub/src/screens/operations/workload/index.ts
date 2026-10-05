import type { ScreenMap } from "@/screens/registry"

import { WorkloadScreen } from "@/screens/operations/workload/workload"

/// The Operations landing. Keys must be paths declared in `nav.ts`.
export const screens: ScreenMap = {
  "/operations/workload": WorkloadScreen,
}
