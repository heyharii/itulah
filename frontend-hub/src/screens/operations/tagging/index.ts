import type { ScreenMap } from "@/screens/registry"

import { PrintBench } from "@/screens/operations/tagging/bench"
import { TaggingJobs } from "@/screens/operations/tagging/jobs"

export const screens: ScreenMap = {
  "/operations/tagging": TaggingJobs,
  "/operations/tagging/bench": PrintBench,
}
