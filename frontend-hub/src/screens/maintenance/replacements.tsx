import { useSuspenseInfiniteQuery } from "@tanstack/react-query"
import { Suspense, useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import {
  EmptyState,
  LoadingState,
  LoadMore,
  type Pageable,
} from "@/components/ui/states"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { gaReplacementBookQuery } from "@/lib/queries/ga"
import { useSheet } from "@/lib/sheets"
import { FinanceMark } from "@/screens/contracts/parts"
import { ReplacementSheet } from "@/screens/maintenance/hub"
import { ReplacementStagePill } from "@/screens/maintenance/parts"
import { type CardSpec, PhoneCards } from "@/components/ui/phone-cards"
import { SupplierName } from "@/screens/procurement/supplier-name"
import type { GaMaintenanceFacet, GaReplacementRow } from "@itulah/contract"

/// Replacement — the swaps: one asset replaced by another, with the reason
/// and the repair that led there.
///
/// # A happening, not a kind of asset
///
/// The register has no "replacement" class on purpose: a swap is something
/// that HAPPENED to a thing, and this book is where the happenings live.
/// The old asset and the new one are both ordinary register rows — the old
/// one ends up marked REPLACED, the new one is born at Terpasang — so every
/// column here that names an asset is pointing, not copying.
///
/// # The cost column reads em-dash, and that is honest
///
/// What a swap COST is the bills that point at it, and the replacement's row
/// does not carry that figure back yet. The column carries the Finance mark
/// and waits rather than showing a zero.
export function Replacements() {
  const open = useSheet("replacement")

  return (
    <PageContent>
      <PageHeader
        crumb="GA"
        title="Replacements"
        sub="A replacement proposal links the old asset with the new one and the reason for the swap."
      />

      <Suspense
        fallback={<LoadingState>Loading the replacement list…</LoadingState>}
      >
        <ReplacementBook onOpen={open.open} />
      </Suspense>

      <ReplacementSheet
        key={open.value ?? "none"}
        replacementId={open.value}
        open={open.isOpen}
        onClose={open.close}
      />
    </PageContent>
  )
}

/// The book: its figures and its table, read together. The page's head stands
/// outside, so it paints before the book arrives.
function ReplacementBook({
  onOpen,
}: {
  onOpen: (replacementId: string) => void
}) {
  /// A page at a time, the next one fetched as the foot of the list nears
  /// view.
  const book = useSuspenseInfiniteQuery(gaReplacementBookQuery())
  const rows = useMemo(
    () => book.data.pages.flatMap((page) => page.rows),
    [book.data]
  )
  const head = book.data.pages[0]

  return (
    <>
      {head !== undefined && <SummaryStrip statuses={head.facets.statuses} />}

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            action={
              <AppLink to="/assets" variant="ghost">
                Open the asset list
              </AppLink>
            }
          >
            No replacements proposed yet. A proposal is created from the asset
            hub — open the asset, then press Replace.
          </EmptyState>
        </Card>
      ) : (
        <ReplacementTable rows={rows} onOpen={onOpen} more={book} />
      )}
    </>
  )
}

/// The three figures the book is managed by, read off the server's status
/// counts over the WHOLE book — the table pages as it scrolls, and a strip
/// counted over the rows it holds would change with the scroll position.
function SummaryStrip({
  statuses,
}: {
  statuses: readonly GaMaintenanceFacet[]
}) {
  const of = (...wanted: string[]) =>
    statuses
      .filter((one) => wanted.includes(one.value))
      .reduce((sum, one) => sum + one.count, 0)
  const proposed = of("PROPOSED")
  const running = of("APPROVED", "PURCHASED", "INSTALLED")
  const done = of("CLOSED")

  return (
    <KpiStrip className="md:grid-cols-3 xl:grid-cols-3">
      <Kpi label="Proposed" value={count(proposed)} />
      <Kpi label="In progress" value={count(running)} />
      <Kpi label="Done" value={count(done)} />
    </KpiStrip>
  )
}

/// A swap as a phone's card: the old asset, why it goes and what takes its
/// place, who supplies it, the repair that led there, and where it stands.
const REPLACEMENT_CARD: CardSpec<GaReplacementRow> = {
  title: (row) => (
    <span className="min-w-0 break-words">{row.old_asset_name ?? "—"}</span>
  ),
  meta: [
    (row) => row.reason,
    (row) =>
      row.new_asset_name === null
        ? "New asset created once installed"
        : `Replaced by ${row.new_asset_name}`,
    (row) =>
      row.supplier_name === null && row.supplier_id === null ? null : (
        <SupplierName code={row.supplier_id} name={row.supplier_name} />
      ),
  ],
  foot: (row) =>
    row.repair_id === null
      ? "No repair"
      : `Repair ${row.repair_id.slice(0, 8)}`,
  action: (row) => <ReplacementStagePill status={row.status} />,
}

function ReplacementTable({
  rows,
  onOpen,
  more,
}: {
  rows: readonly GaReplacementRow[]
  onOpen: (replacementId: string) => void
  more: Pageable
}) {
  const phone = useLayout() === "phone"
  if (phone) {
    return (
      <PhoneCards
        rows={rows}
        rowId={(row) => row.replacement_id}
        spec={REPLACEMENT_CARD}
        onOpen={(row) => onOpen(row.replacement_id)}
        more={more}
      />
    )
  }
  return (
    <Card className="overflow-hidden">
      {/* The book scrolls INSIDE its own box rather than squeezing the
          columns — eight columns of names, reasons and stages do not fit a
          phone, and a squeezed table overlaps its own cells while the page
          itself starts scrolling sideways. */}
      <div className="overflow-x-auto">
        <div className="min-w-[72rem]">
          <div className="grid h-10 grid-cols-[3rem_minmax(13rem,1fr)_minmax(13rem,1fr)_9rem_minmax(11rem,0.9fr)_10rem_8rem_8.5rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
            <span>No</span>
            <span>Old asset</span>
            <span>Reason</span>
            <span>Repair</span>
            <span>New asset</span>
            <span>Vendor</span>
            <span className="text-right">
              Cost <FinanceMark className="ml-1 align-[0.0625rem]" />
            </span>
            <span>Status</span>
          </div>
          {rows.map((row, index) => (
            <div
              key={row.replacement_id}
              onClick={() => onOpen(row.replacement_id)}
              className="grid cursor-pointer grid-cols-[3rem_minmax(13rem,1fr)_minmax(13rem,1fr)_9rem_minmax(11rem,0.9fr)_10rem_8rem_8.5rem] items-center gap-3 border-b border-hairline px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-soft"
            >
              <span className="text-meta text-mute tabular-nums">
                {index + 1}
              </span>
              <div className="min-w-0">
                <span className="block truncate text-cell font-medium text-ink">
                  {row.old_asset_name ?? "—"}
                </span>
                <span className="block truncate font-mono text-pill text-mute">
                  {row.old_asset_id.slice(0, 8)}
                </span>
              </div>
              <span className="min-w-0 truncate text-meta text-body">
                {row.reason}
              </span>
              <span className="min-w-0 truncate font-mono text-id text-body">
                {row.repair_id === null ? "—" : row.repair_id.slice(0, 8)}
              </span>
              <div className="min-w-0">
                <span className="block truncate text-meta text-body">
                  {row.new_asset_name ?? "—"}
                </span>
                {row.new_asset_name === null && (
                  <span className="block truncate text-pill text-mute">
                    created once installed
                  </span>
                )}
              </div>
              <span className="min-w-0 truncate text-meta text-body">
                <SupplierName code={row.supplier_id} name={row.supplier_name} />
              </span>
              <span className="truncate text-right text-meta text-body tabular-nums">
                —
              </span>
              <span>
                <ReplacementStagePill status={row.status} />
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* Outside the sideways-scrolling box, which computes as a vertical
          scroller too — see `<LoadMore>`. The page scrolls. */}
      <LoadMore query={more} />
    </Card>
  )
}
