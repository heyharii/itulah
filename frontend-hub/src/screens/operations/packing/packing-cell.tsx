import { Pill } from "@/components/ui/pill"
import { count } from "@/lib/format"

/// The packing result: Completed, or Closed short with the pieces left out.
export function PackingCell({ short }: { short: number }) {
  return short > 0 ? (
    <span className="flex items-center gap-2">
      <Pill tone="warn">Closed short</Pill>
      <span className="font-medium text-bad-fg tabular-nums">
        −{count(short)} pcs
      </span>
    </span>
  ) : (
    <Pill tone="ok">Completed</Pill>
  )
}
