import { cn } from "@/lib/utils"

/// Every screen opens the same way: an optional crumb, the title, an optional
/// sentence under it, and the actions right-aligned.
///
/// One primary action per screen — everything else is secondary. That is why
/// `actions` takes nodes rather than a list: the constraint is a review
/// question, not something a prop can enforce.
///
/// Narrow, the actions drop under the title instead of squeezing beside it.
/// They are a search box and a CTA on most screens, and 375px cannot hold
/// those plus a 22px heading in one row — the version that tries puts the
/// heading in two words per line with a search field lying across it.
export function PageHeader({
  crumb,
  title,
  sub,
  actions,
  className,
}: {
  crumb?: React.ReactNode
  title: React.ReactNode
  sub?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-col items-stretch gap-3",
        "md:flex-row md:items-start md:justify-between md:gap-4",
        className
      )}
    >
      <div className="min-w-0">
        {crumb && (
          <div className="mb-[0.3125rem] text-[0.75rem] font-medium text-mute">
            {crumb}
          </div>
        )}
        <h1 className="text-hero font-semibold text-ink">{title}</h1>
        {sub && (
          <p className="mt-[0.1875rem] text-[0.8125rem] text-body">{sub}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-[0.4375rem] md:shrink-0 md:pt-[0.1875rem]">
          {actions}
        </div>
      )}
    </div>
  )
}
