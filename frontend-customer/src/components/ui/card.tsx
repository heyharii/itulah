import { cn } from "@/lib/utils"

/// White card, one hairline, 16px corners, whisper shadow.
///
/// Cards are lifted by their border and not by shadow: the shadow token exists
/// to stop a white edge disappearing into a white page, not to float anything.
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-card border border-hairline bg-canvas shadow-soft",
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1 px-4 pt-4 pb-1", className)}
      {...props}
    />
  )
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("text-card-title font-semibold text-ink", className)}
      {...props}
    />
  )
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-meta text-body", className)} {...props} />
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-4", className)} {...props} />
}

/// The tinted band a record card opens with: a full-bleed `{soft}` strip
/// carrying what the record is, with the body staying white below it.
export function CardStrip({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-t-card border-b border-hairline bg-soft px-4 py-3",
        className,
      )}
      {...props}
    />
  )
}
