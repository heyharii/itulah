import { node } from "@/lib/api"
import type { OvertimePolicyView } from "@itulah/contract"

/// Ratify the overtime caps (PP 35/2021 art. 26(1)): the most one person may
/// work in a day and in a week. Versioned — the server refuses a version that
/// is not the next one — so the caller passes the version in force (0 when no
/// caps have been ratified yet) and this posts the one after it.
///
/// `POST /api/v1/overtime-policy` has existed server-side since the overtime
/// orders landed; the screens only ever read it.
export function setOvertimeCaps(
  current: OvertimePolicyView | null,
  body: {
    max_per_day_minutes: number
    max_per_week_minutes: number
    reason: string
  }
): Promise<OvertimePolicyView> {
  return node.post<OvertimePolicyView>("/api/v1/overtime-policy", {
    version: (current?.version ?? 0) + 1,
    ...body,
  })
}
