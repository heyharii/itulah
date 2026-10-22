import { count } from "@/lib/format"
import { cn } from "@/lib/utils"

/// **Which lane** on a tablet or a phone: one row of white tabs, one lane
/// shown at a time (owner, 18 Oct 2026, pack-sheet-options: four squeezed
/// lanes cut every name to "2.."). The name, then its number in grey; the lane
/// on show has the accent's border and wash. Two to a row on a phone.
export function LaneBar({
  lanes,
  value,
  onChange,
}: {
  lanes: readonly { id: string; title: string; cards: number }[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div
      role="group"
      aria-label="Lane"
      className="mb-3 flex shrink-0 flex-wrap gap-1.5"
    >
      {lanes.map((lane) => {
        const on = lane.id === value
        return (
          <button
            key={lane.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(lane.id)}
            className={cn(
              "inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-[11px] border font-semibold transition-[background-color,border-color,color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97] max-md:basis-2/5",
              on
                ? "border-accent bg-accent-bg text-accent"
                : "border-hairline bg-canvas text-ink"
            )}
          >
            <span className="truncate">{lane.title}</span>
            <span className="font-medium text-body tabular-nums">
              {count(lane.cards)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
