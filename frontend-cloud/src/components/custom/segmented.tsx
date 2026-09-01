import { cn } from "@/lib/utils"

/// Cloud Hub's in-page segmented control: `{soft-2}` track, white active pill.
///
/// Distinct from a tab and from a button group. The track is the surface; the
/// active option is a white pill that sits on it — never a heavier weight,
/// never a coloured fill. Used for channel, layout, and any other choice that
/// switches the dataset *within* a screen.
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T
  onChange: (value: T) => void
  options: readonly {
    id: T
    label: React.ReactNode
    ariaLabel?: string
  }[]
  className?: string
  size?: "sm" | "md"
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center bg-[var(--os-soft-2,#f3f3f5)] p-[3px]",
        "rounded-full",
        className,
      )}
    >
      {options.map((option) => {
        const on = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={option.ariaLabel}
            onClick={() => onChange(option.id)}
            className={cn(
              "rounded-full font-medium whitespace-nowrap transition-colors",
              size === "sm"
                ? "h-6 px-2.5 text-[11px]"
                : "h-7 px-3.5 text-[13px]",
              on
                ? "bg-[var(--os-canvas,#fff)] text-[var(--os-ink,#1d1d1f)] shadow-[var(--os-shadow-soft,0_1px_2px_rgba(20,20,25,.03))]"
                : "text-[var(--os-body,#74747b)] hover:text-[var(--os-ink,#1d1d1f)]",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
