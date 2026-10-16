import { warmInfinite, type PrefetchMap } from "@/lib/prefetch"
import {
  gaInspectionBookQuery,
  gaRepairBookQuery,
  gaReplacementBookQuery,
  gaTaskBookQuery,
} from "@/lib/queries/ga"

/// What Maintenance asks first, before the screen is open (`lib/prefetch.ts`).
/// Every screen here opens on the first page of its book; the options are the
/// screens' own (`lib/queries/ga.ts`).

export const prefetch: PrefetchMap = {
  "/maintenance": (client) => warmInfinite(client, gaRepairBookQuery()),
  // The two books the schedule page is made of: the recurring tasks and the
  // inspections.
  "/maintenance/schedule": (client) =>
    Promise.all([
      warmInfinite(client, gaTaskBookQuery()),
      warmInfinite(client, gaInspectionBookQuery()),
    ]),
  "/maintenance/replacements": (client) =>
    warmInfinite(client, gaReplacementBookQuery()),
}
