import { cn } from "@/lib/utils"

/// White card, one hairline, 16px corners, whisper shadow.
///
/// Cards are lifted by their border, not by shadow — the shadow token exists to
/// stop the white-on-white edge disappearing, not to float anything.
export function Card({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "card rounded-card border border-hairline bg-canvas shadow-soft",
        className
      )}
      {...props}
    />
  )
}

/// The card's own header row: title left, controls right.
export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2.5 px-4 pt-3.5 pb-[0.6875rem]",
        className
      )}
      {...props}
    />
  )
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-card-title font-semibold text-ink", className)}
      {...props}
    />
  )
}

/// The tinted band a data card may open with: a full-bleed `{soft}` strip
/// carrying the title or a record id, with the body staying white below it.
export function CardStrip({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-t-card border-b border-hairline bg-soft px-4 py-2.5",
        className
      )}
      {...props}
    />
  )
}
