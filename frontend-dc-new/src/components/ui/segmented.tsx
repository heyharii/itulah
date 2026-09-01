import { cn } from "@/lib/utils"

/// The segmented control: switch which slice of ONE dataset is shown.
///
/// The hub pairs this with `<SubTabs>`, which switches to a *different*
/// dataset within a screen. This app has no sub-tabs and does not want any:
/// the rail is the flow and the sidebar is the screens, so a station that
/// needed in-page dataset switching would be a station that should have been
/// two. What is left is the honest use — All / Open / Loose over one list of
/// cartons — and it stays a segment because it is one dataset, filtered.
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
      className={cn("inline-flex rounded-full bg-soft-2 p-0.5", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-[1.625rem] rounded-full px-2.5 text-[0.75rem] font-medium transition-colors",
            option.value === value
              ? "bg-canvas text-ink shadow-soft"
              : "text-body hover:text-ink"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
