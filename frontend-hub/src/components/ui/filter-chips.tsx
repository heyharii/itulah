import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import type { LucideIcon } from "lucide-react"

import { count as countWords } from "@/lib/format"
import { cn } from "@/lib/utils"

/// One answer a list can be narrowed to. `null` is "All", and it comes first.
export interface ChipOption {
  readonly value: string | null
  readonly label: string
  /// The mark that tells this answer from its neighbours at a glance: a car
  /// for vehicles, a snowflake for AC. Leave it out only for "All" when no
  /// mark says "everything" better than the word.
  readonly icon?: LucideIcon
  /// How many rows this answer leaves. Shown grey after the word, so the
  /// person sees before pressing whether the press finds anything.
  readonly count?: number
}

/// A list narrowed by one question, with every answer on view.
///
/// # Why not a dropdown
///
/// Owner, 2026-10-18: "filter dropdown jangan pake, kalau bisa pakai radio
/// icon". A menu hides the answers behind a press, so nobody learns what the
/// list holds until they open it. A row of chips shows them all, the icon makes
/// each one quick to find, and the count says which ones are worth pressing.
///
/// A `<RadioGroup>`, as `Choices` is: exactly one answer is on, the arrow keys
/// walk the row and tab leaves it.
///
/// Use it for a question with a handful of answers: kind, group, stage,
/// condition. A question with dozens of answers, like a supplier or every site,
/// stays a searchable picker.
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
      className={cn("flex flex-wrap items-center gap-1.5", className)}
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
              "filter-chip inline-flex h-9 min-w-0 cursor-pointer items-center gap-1.5 rounded-full border pr-3.5 text-[0.9375rem] font-medium whitespace-nowrap",
              "transition-[background-color,border-color,color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              Glyph ? "pl-2.5" : "pl-3.5",
              on
                ? "border-accent bg-accent-bg text-accent"
                : "border-hairline-2 bg-canvas text-ink hover:border-hairline-strong hover:bg-soft-2"
            )}
          >
            {Glyph && (
              <Glyph
                aria-hidden
                className={cn(
                  "size-4 shrink-0 stroke-[1.7]",
                  on ? "text-accent" : "text-body"
                )}
              />
            )}
            <span className="truncate">{one.label}</span>
            {one.count !== undefined && (
              <span
                className={cn(
                  "tabular-nums",
                  on ? "text-accent" : "text-mute"
                )}
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
