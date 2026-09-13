import { cn } from "@/lib/utils"

/// The segmented control: switch which slice of one dataset is shown.
///
/// `{soft-2}` track, white active chip with a hairline and the whisper shadow —
/// one of the two places DESIGN.md allows a shadow to mean "on". At 44px,
/// because everything on this surface is aimed at with a thumb, and full width
/// because a segmented control floating in a gutter is a desktop shape.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly { readonly value: T; readonly label: React.ReactNode }[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      role="group"
      className={cn(
        "flex w-full gap-1 rounded-[0.5625rem] bg-soft-2 p-1",
        className,
      )}
    >
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-10 flex-1 rounded-inner text-cell font-medium transition-colors",
              on
                ? "border border-hairline-2 bg-canvas text-ink shadow-soft"
                : "text-body",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
