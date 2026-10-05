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

/// What a count's state is called here: still to do, sent, or closed.
export function statusOf(status: CountStatus): {
  readonly word: string
  readonly dot: string
} {
  switch (status) {
    case "ACTIVE":
      return { word: "To count", dot: "bg-warn" }
    case "SUBMITTED":
    case "ADJUSTMENT_PENDING":
      return { word: "Sent", dot: "bg-body" }
    default:
      return { word: "Closed", dot: "bg-mute" }
  }
}
