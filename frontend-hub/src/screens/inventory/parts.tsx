import { cn } from "@/lib/utils"

/// The two controls this module needed and `components/ui` does not have yet.
///
/// Kept here rather than added to the shared layer on purpose: a primitive is
/// a decision for the whole app, and these are one module's stopgap. If a
/// second module wants either, that is the moment it moves.

/// A picker.
///
/// There is no `<Select>` in `components/ui`, and every inventory screen needs
/// one: a pool, a site, an origin, a status. It wears the `<Input>` chrome —
/// pill, `{soft-2}` fill, hairline on hover — so a row of filters does not have
/// one control from a different app in the middle of it.
export function Choice({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
}: {
  value: string
  onChange: (value: string) => void
  options: readonly { readonly value: string; readonly label: string }[]
  /// The "no filter" row. Absent means the control always holds a value.
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "h-8 max-w-56 rounded-full border border-transparent bg-soft-2 px-3 text-[0.78125rem] text-ink transition-colors outline-none",
        "hover:border-hairline-2 hover:bg-soft-3 disabled:opacity-50",
        className
      )}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
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
