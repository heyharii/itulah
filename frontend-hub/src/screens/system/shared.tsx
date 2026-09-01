import { cn } from "@/lib/utils"

/// The three parts the System screens need that `components/ui` does not carry
/// yet, plus one formatter.
///
/// Inlined here rather than added to the shared layer: this module is being
/// written alongside eight others and the shared layer is not its to widen. If
/// a second module reaches for `<Select>` or `<Secret>`, that is the moment
/// they graduate — until then they live where they are used.

/// A yes/no that is not a state change until the form is submitted.
export function Check({
  label,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 text-[0.78125rem] text-text",
        className
      )}
    >
      <input type="checkbox" className="size-3.5 accent-accent" {...props} />
      {label}
    </label>
  )
}

/// A secret on its way to the server, and nowhere else.
///
/// No reveal toggle and no `defaultValue`: this control is write-only by
/// construction. A password or an ingest key that can be read back out of the
/// page is one screenshot away from being somebody else's, and no screen in
/// this module ever needs to show one — the server does not return them and
/// this app does not keep them.
export function Secret({
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "defaultValue">) {
  return (
    <input
      type="password"
      autoComplete="new-password"
      spellCheck={false}
      className={cn(
        "h-9 w-full rounded-full border border-transparent bg-soft-2 px-3.5 text-[0.84375rem] text-ink transition-colors outline-none",
        "placeholder:text-mute hover:border-hairline-2 hover:bg-soft-3 disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

/// A titled block inside a sheet: the heading, an optional control beside it,
/// and whatever the section is about.
export function Section({
  title,
  actions,
  children,
}: {
  title: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-card-title font-semibold text-ink">{title}</h4>
        {actions}
      </div>
      {children}
    </div>
  )
}
