import { cn } from "@/lib/utils"

/// A white card standing on the grey page. Borderless: the edge is the change
/// of surface and a shadow too soft to see as one.
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-card bg-canvas shadow-soft", className)}
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
      className={cn("flex flex-col gap-1 px-5 pt-5 pb-1", className)}
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
  return <div className={cn("px-5 py-5", className)} {...props} />
}

/// The grey label a group of rows sits under, inside its card — "Cashback",
/// "Fees" in the reference. Quieter than a title: it names the group, the rows
/// carry the content.
export function CardLabel({
  className,
  children,
  aside,
}: {
  className?: string
  children: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-5 pt-5 pb-2",
        className,
      )}
    >
      <p className="text-section text-body">{children}</p>
      {aside}
    </div>
  )
}

export function CardStrip({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-5 pt-5 pb-3",
        className,
      )}
      {...props}
    />
  )
}
