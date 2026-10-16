import { cn } from "@/lib/utils"

/// What a list opens with from a tablet up: the title, and the figures as one
/// box at its right (owner, 2026-10-10 — `po-list-layout-options.html`, G). It
/// replaces the title, a row of cards and the stamp that stood over the table:
/// the table's heading now starts about 110px higher. When the list was read
/// ("Updated 18:43" and the reload) sits in the toolbar beside Columns, as
/// `<RefreshStamp deskOnly>` (owner, 2026-10-11).
///
/// A phone keeps what it had — the title in the top bar, the stamp over the
/// cards with the reload in the dock — so this is not drawn under 768px. Pair
/// it with `<DataTable refreshOnPhoneOnly>`.
export function ListHead({
  title,
  kpis,
  className,
}: {
  title: string
  /// A `KpiBox`.
  kpis?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "mb-3 flex flex-col gap-3 max-md:hidden md:-mt-1 lg:flex-row lg:items-center lg:justify-between lg:gap-6",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="page-title text-[0.9375rem] leading-5 font-semibold text-ink">
          {title}
        </h1>
      </div>
      {kpis}
    </div>
  )
}
