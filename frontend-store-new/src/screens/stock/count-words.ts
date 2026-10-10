import type { CountKind, CountStatus } from "@/lib/counts"
import { placeCodeOf, placeLabel } from "@/screens/stock/shared"

/// The words for a count: where, what kind, and what state.

export function poolName(poolId: string): string {
  const code = placeCodeOf(poolId)
  return code === null ? poolId : placeLabel(code)
}

const KINDS: Readonly<Record<CountKind, string>> = {
  FULL: "Full count",
  CYCLE: "Cycle count",
  TARGETED: "Targeted count",
}

export function kindLabel(kind: CountKind): string {
  return KINDS[kind] ?? kind
}

/// What a count's state is called here — still to do, sent, or closed — and the
/// tone that says it (`Status` in a list, `Pill` in a sheet's head). Sent is in
/// motion: it is waiting on head office.
export function statusOf(status: CountStatus): {
  readonly word: string
  readonly tone: "warn" | "info" | "done"
} {
  switch (status) {
    case "ACTIVE":
      return { word: "To count", tone: "warn" }
    case "SUBMITTED":
    case "ADJUSTMENT_PENDING":
      return { word: "Sent", tone: "info" }
    default:
      return { word: "Closed", tone: "done" }
  }
}
