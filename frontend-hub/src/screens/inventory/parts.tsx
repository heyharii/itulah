import { Select } from "@/components/ui/field"
import { cn } from "@/lib/utils"

/// The two controls this module needed.
///
/// `Metric` is still a stopgap kept out of the shared layer on purpose — a
/// primitive is a decision for the whole app, and if a second module wants it,
/// that is the moment it moves. `Choice` already made that trip in the other
/// direction: the picker it used to be is now `<Select>` in `components/ui`,
/// and what is left here is only the filter-row shape of it.

/// A picker.
///
/// Every inventory screen needs one — a pool, a site, an origin, a status —
/// and this is the toolbar-shaped wrapper round the kit's `<Select>`: shorter
/// (`h-8`), quieter type, and an `options` array instead of `<option>`
/// children, because a filter row builds its list from a query.
///
/// It used to be a native `<select>`, written when `components/ui` had no
/// picker at all. It is not one any more, for the reason the kit gives: the
/// panel of a native dropdown belongs to the operating system, so the same
/// filter row is one control on a Mac and a different one on the Windows
/// machines these screens are actually read on.
///
/// The one thing the native control did for free and this does not: it sized
/// itself to the LONGEST option, so the toolbar never moved when the filter
/// changed. A button is as wide as the answer it is showing, so keep the
/// `max-w-*` caps — they are what stops a long store name pushing the search
/// box off the row.
export function Choice({
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  value: string
  onChange: (value: string) => void
  options: readonly { readonly value: string; readonly label: string }[]
  disabled?: boolean
  className?: string
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onChange={onChange}
      className={cn("h-8 w-auto max-w-56 px-3 text-[0.875rem]", className)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  )
}

/// A number with its name over it — the unit a summary strip is made of.
///
/// Not `<Kpi>`: that one is a bordered card for the top of an overview, and
/// what is wanted inside a card or a sheet is the same figure without a second
/// box drawn round it.
export function Metric({
  label,
  value,
  tone,
}: {
  label: React.ReactNode
  value: React.ReactNode
  tone?: "ink" | "ok" | "warn" | "bad"
}) {
  return (
    <div>
      <div className="text-eyebrow font-semibold text-mute uppercase">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-metric leading-none font-semibold tabular-nums",
          (tone === "ink" || tone === undefined) && "text-ink",
          tone === "ok" && "text-ok-fg",
          tone === "warn" && "text-warn-fg",
          tone === "bad" && "text-bad-fg"
        )}
      >
        {value}
      </div>
    </div>
  )
}

/// The strip `<Metric>`s sit in.
export function MetricRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("grid grid-cols-2 gap-4 sm:grid-cols-4", className)}
      {...props}
    />
  )
}
