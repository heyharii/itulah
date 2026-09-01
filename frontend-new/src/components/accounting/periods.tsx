/*
 * Periods — the monthly accounting periods of every published fiscal year, and
 * their lock state.
 *
 * `/v1/accounting/periods` lists ONE fiscal year at a time (`fiscal_year_id` is
 * required; without it the handler answers `null`), so the rows here are the
 * union of one call per year and are grouped back by the fiscal year they came
 * from.
 *
 * Closing a period is irreversible in accounting terms: a closed period refuses
 * every subsequent posting into its date range, and `/reopen` is an
 * administrative act, not an undo. So the close button never fires directly —
 * it stages a confirmation that names the period and its dates first.
 */

import { useMemo } from "react"

import { Pill, num } from "@/components/accounting/parts"
import { type FiscalYear, type LedgerPeriod } from "@/components/accounting/api"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

const PERIODS_COLUMNS = "210px 130px 130px minmax(0,1fr) 190px"

/** A fiscal-year heading or one period — the two things the table interleaves. */
type PeriodFeedEntry =
  | { kind: "year"; year: string; label: string; count: number }
  | { kind: "period"; period: LedgerPeriod }

export function PeriodsTable({
  periods,
  fiscalYears,
  selectedId,
  busyId,
  onRequestClose,
  onOpenJournal,
}: {
  periods: LedgerPeriod[]
  fiscalYears: FiscalYear[]
  /** The period the sidebar filter currently points at, if any. */
  selectedId: string | null
  /** The period whose close request is in flight, if any. */
  busyId: string | null
  onRequestClose: (period: LedgerPeriod) => void
  onOpenJournal: (period: LedgerPeriod) => void
}) {
  const yearName = useMemo(() => {
    const map = new Map<string, string>()
    for (const year of fiscalYears) map.set(year.id, year.name)
    return map
  }, [fiscalYears])

  const byYear = useMemo(() => {
    const map = new Map<string, LedgerPeriod[]>()
    for (const period of periods) {
      const list = map.get(period.year) ?? []
      list.push(period)
      map.set(period.year, list)
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([year, list]) => ({
        year,
        list: list.sort((a, b) => a.startsOn.localeCompare(b.startsOn)),
      }))
  }, [periods])

  /* One flat list: a virtualizer positions by index, so a fiscal-year
   * heading has to be an entry beside the periods it introduces rather than
   * a wrapper around them. */
  const feed = useMemo<PeriodFeedEntry[]>(
    () =>
      byYear.flatMap((group): PeriodFeedEntry[] => [
        {
          kind: "year",
          year: group.year,
          label: yearName.get(group.year) ?? group.year,
          count: group.list.length,
        },
        ...group.list.map((period): PeriodFeedEntry => ({
          kind: "period",
          period,
        })),
      ]),
    [byYear, yearName]
  )

  return (
    <VirtualRows
      rows={feed}
      rowKey={(entry) =>
        entry.kind === "year" ? `year:${entry.year}` : entry.period.id
      }
      columns={PERIODS_COLUMNS}
      rowHeight={(entry) => (entry.kind === "year" ? 32 : 34)}
      /* Per-row rather than the `hoverable` flag: a year header is a section
       * divider, not a target, and washing it on hover would promise an
       * interaction it does not have. */
      rowClassName={(entry) =>
        entry.kind === "year"
          ? undefined
          : cn("hover:bg-hover", entry.period.id === selectedId && "bg-hover")
      }
      header={
        <>
          <span className="pl-3.5">Period</span>
          <span>Starts</span>
          <span>Ends</span>
          <span>State</span>
          <span className="pr-3.5 text-right">Actions</span>
        </>
      }
      renderRow={(entry) => {
        if (entry.kind === "year") {
          return (
            <span
              role="gridcell"
              style={{ gridColumn: "1 / -1" }}
              className="flex h-full items-center bg-[color-mix(in_srgb,var(--inset)_55%,var(--surface))] px-3.5"
            >
              <span className="text-[10.5px] font-semibold tracking-[0.05em] text-ink-3 uppercase">
                {entry.label}
              </span>
              <span className="ml-2 font-mono text-[10.5px] text-ink-4">
                {entry.count}
              </span>
            </span>
          )
        }

        const { period } = entry
        const busy = busyId === period.id
        return (
          /* `contents` keeps every cell a direct grid item of the row. The
           * background used to be painted per-cell from here; it is not, now.
           * The row is `items-center`, so a cell is only as tall as its own
           * content and a background on it paints a short centred band rather
           * than a row-height one — see `rowClassName` in VirtualRows. */
          <div className="contents">
            <span role="gridcell" className="pl-3.5">
              <span className={cn(num, "text-ink")}>{period.name}</span>
              <span className={cn(num, "block text-[10.5px] text-ink-4")}>
                {period.id}
              </span>
            </span>
            <span role="gridcell" className="px-3">
              <span className={cn(num, "text-ink-3")}>{period.startsOn}</span>
            </span>
            <span role="gridcell" className="px-3">
              <span className={cn(num, "text-ink-3")}>{period.endsOn}</span>
            </span>
            <span role="gridcell" className="min-w-0 px-3">
              {period.status === "closed" ? (
                <Pill tone="bad">Closed · locked</Pill>
              ) : (
                <Pill tone="good">Open · accepts postings</Pill>
              )}
            </span>
            <span role="gridcell" className="pr-3.5 pl-3 text-right">
              <span className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onOpenJournal(period)}
                  className="inline-flex h-[26px] items-center rounded-control bg-surface px-2 text-[11px] font-medium text-ink-2 shadow-btn transition-colors hover:bg-hover hover:text-ink"
                >
                  Journal
                </button>
                <button
                  type="button"
                  disabled={period.status === "closed" || busy}
                  onClick={() => onRequestClose(period)}
                  className="inline-flex h-[26px] items-center rounded-control bg-surface px-2 text-[11px] font-medium text-ink shadow-btn transition-colors hover:bg-hover disabled:opacity-40 disabled:hover:bg-surface"
                >
                  {busy ? "Closing…" : "Close"}
                </button>
              </span>
            </span>
          </div>
        )
      }}
    />
  )
}
