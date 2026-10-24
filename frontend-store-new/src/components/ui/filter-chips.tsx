import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import type { LucideIcon } from "lucide-react"

import { count as countWords } from "@/lib/format"
import { cn } from "@/lib/utils"

/// One answer a list can be narrowed to. `null` is "All", and it comes first.
export interface ChipOption {
  readonly value: string | null
  readonly label: string
  /// The mark that tells this answer from its neighbours at a glance.
  readonly icon?: LucideIcon
  /// How many rows this answer leaves. Shown grey after the word, so the
  /// person sees before pressing whether the press finds anything.
  readonly count?: number
}

/// A list narrowed by one question, with every answer on view — the hub's
/// `FilterChips` (`frontend-hub/src/components/ui/filter-chips.tsx`), drawn as
/// `unmatched-sales-prototype.html` draws its chips.
///
/// Owner, 2026-10-18: "filter dropdown jangan pake, kalau bisa pakai radio
/// icon". A menu hides the answers behind a press, so nobody learns what the
/// list holds until they open it. A row of chips shows them all, the icon makes
/// each one quick to find, and the count says which ones are worth pressing.
///
/// A `<RadioGroup>`: exactly one answer is on, the arrow keys walk the row and
/// tab leaves it. For a question with a handful of answers; on a phone the same
/// answers go in the dock's sheet instead, never in a row at the top.
export function FilterChips({
  label,
  value,
  options,
  onChange,
  className,
}: {
  /// The question, for the screen reader: "Kind", "Stage".
  readonly label: string
  readonly value: string | null
  readonly options: readonly ChipOption[]
  readonly onChange: (value: string | null) => void
  readonly className?: string
}) {
  // Radio values are strings; "All" travels as the empty string.
  const here = value ?? ""
  return (
    <RadioGroup
      aria-label={label}
      value={here}
      onValueChange={(next) => onChange(next === "" ? null : (next as string))}
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {options.map((one) => {
        const key = one.value ?? ""
        const on = key === here
        const Glyph = one.icon
        return (
          <Radio.Root
            key={key || "all"}
            value={key}
            className={cn(
              // `rounded-[999px]`, not `rounded-full`: the white look
              // restyles every span with that class (a filled pill goes
              // outlined, an outlined one goes grey), and a chip is drawn
              // as the prototype draws it — a white capsule on a hairline,
              // light blue and blue when it is the answer.
              "filter-chip inline-flex h-[2.375rem] min-w-0 cursor-pointer items-center gap-2 rounded-[999px] border pr-3.5 text-[0.9375rem] whitespace-nowrap",
              "transition-[scale,border-color,background-color,color] duration-150 ease-(--ease-out) active:scale-[0.97]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              Glyph ? "pl-[0.6875rem]" : "pl-3.5",
              on
                ? "border-accent bg-accent-bg font-medium text-accent"
                : "border-hairline bg-canvas text-body hover:border-hairline-strong hover:text-ink",
            )}
          >
            {Glyph && (
              <Glyph
                aria-hidden
                className="size-[1.125rem] shrink-0 stroke-[1.7]"
              />
            )}
            <span className="truncate">{one.label}</span>
            {one.count !== undefined && (
              <span
                className={cn("tabular-nums", on ? "opacity-70" : "text-faint")}
              >
                {countWords(one.count)}
              </span>
            )}
          </Radio.Root>
        )
      })}
    </RadioGroup>
  )
}
