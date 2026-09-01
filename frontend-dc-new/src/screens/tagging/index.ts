import type { ScreenMap } from "@/screens/registry"

import { PrintBench } from "@/screens/tagging/bench"
import { TaggingJobs } from "@/screens/tagging/jobs"

export const screens: ScreenMap = {
  "/tagging": TaggingJobs,
  "/tagging/bench": PrintBench,
}
