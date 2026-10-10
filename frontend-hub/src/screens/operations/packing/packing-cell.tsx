import { Pill } from "@/components/ui/pill"
import { quantity } from "@/lib/format"

/// The packing result: Completed, or Closed short with the pieces left out.
export function PackingCell({ short }: { short: number }) {
  return short > 0 ? (
    <span className="flex items-center gap-2">
      <Pill tone="warn">Closed short</Pill>
      <span className="font-medium text-bad-fg tabular-nums">
        −{quantity(short)}
      </span>
    </span>
  ) : (
    <Pill tone="ok">Completed</Pill>
  )
}
