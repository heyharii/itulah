import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { ExportButton } from "@/components/ui/export-button"
import { PageHeader } from "@/components/ui/page-header"
import { Banner, EmptyState } from "@/components/ui/states"
import { monthStamp, type ExportSheet } from "@/lib/export-xlsx"
import { count, day, money } from "@/lib/format"
import { financeKeys, listAllAssets } from "@/lib/queries/finance"
import { useSiteLabel } from "@/lib/queries/organisation"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { Code, Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import { todayIso } from "@/screens/finance/chart"
import type { DateWindow } from "@/screens/finance/hooks"
import { SiteSelect, WindowControl } from "@/screens/finance/parts"
import { ReportFilters, ReportSummary } from "@/screens/finance/report"

import type { AssetRow } from "@itulah/contract"

/// Asset Disposals: what left the books in a window, what it was carried at
/// when it went, what it fetched, and the gain or loss that fell out.
///
/// An asset is disposed by selling it or by writing it off (a write-off fetches
/// nothing, by the database's own rule). Either way one journal entry takes the
/// cost and the accumulated depreciation out, books the proceeds and lands the
/// difference in the gain-or-loss account — the **Journal** column opens it.
///
/// ```text
/// book value at disposal = cost − accumulated depreciation
/// gain / (loss)          = proceeds − book value at disposal
/// ```
///
/// The same arithmetic the server posts (`assets::dispose`). The register's own
/// `book_value_minor` is nil once an asset is disposed — nothing is left of it
/// — so the figure the entry used is rebuilt from cost and accumulated, which
/// stop moving the day the asset leaves.
///
/// Read from the asset register: `status=DISPOSED`, then narrowed to the window
/// on `disposed_on`. There is no date filter on that endpoint, but the disposed
/// set is a small one — a handful a year.

export function AssetDisposals() {
  const [from, setFrom] = useState(() => `${new Date().getFullYear()}-01-01`)
  const [to, setTo] = useState(todayIso)
  const [site, setSite] = useState("")
  const siteName = useSiteLabel()

  const range: DateWindow = {
    from,
    to,
    setFrom,
    setTo,
    chip: `${day(from)} – ${day(to)}`,
  }

  const register = useQuery({
    queryKey: financeKeys.assetsAll(null, "DISPOSED", site || null),
    queryFn: ({ signal }) =>
      listAllAssets({ status: "DISPOSED", site: site || undefined }, signal),
  })

  const rows = useMemo(
    () =>
      (register.data?.rows ?? [])
        .filter(
          (row) =>
            row.disposed_on !== null &&
            (from === "" || row.disposed_on >= from) &&
            (to === "" || row.disposed_on <= to)
        )
        .sort(
          (a, b) =>
            (a.disposed_on ?? "").localeCompare(b.disposed_on ?? "") ||
            a.asset_number.localeCompare(b.asset_number)
        )
        .map(figuresOf),
    [register.data, from, to]
  )

  const total = rows.reduce(
    (sum, row) => ({
      cost: sum.cost + row.cost,
      accumulated: sum.accumulated + row.accumulated,
      book: sum.book + row.book,
      proceeds: sum.proceeds + row.proceeds,
      result: sum.result + row.result,
    }),
    { cost: 0, accumulated: 0, book: 0, proceeds: 0, result: 0 }
  )

  const build = (): ExportSheet | null => {
    if (register.data === undefined) return null
    return {
      filename: `Asset-Disposals-${monthStamp(to)}`,
      sheet: "Asset Disposals",
      title: "Asset Disposals",
      subtitle: `${range.chip} · ${site === "" ? "every site" : siteName(site)}`,
      columns: [
        { header: "Date", kind: "date" },
        { header: "Asset No", kind: "text", width: 16 },
        { header: "Name", kind: "text", width: 40 },
        { header: "Category", kind: "text", width: 28 },
        { header: "Method", kind: "text", width: 14 },
        { header: "Cost", kind: "money" },
        { header: "Accumulated Depreciation", kind: "money" },
        { header: "Book Value at Disposal", kind: "money" },
        { header: "Proceeds", kind: "money" },
        { header: "Gain / (Loss)", kind: "money" },
      ],
      rows: rows.map(({ asset, cost, accumulated, book, proceeds, result }) => [
        asset.disposed_on,
        asset.asset_number,
        asset.name,
        asset.category_name,
        methodLabel(asset.disposal_method),
        cost,
        accumulated,
        book,
        proceeds,
        result,
      ]),
      totalRow: [
        null,
        "Total",
        null,
        null,
        null,
        total.cost,
        total.accumulated,
        total.book,
        total.proceeds,
        total.result,
      ],
    }
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Financial Reports"
        title="Asset Disposals"
        actions={
          <ExportButton
            build={build}
            disabled={register.data === undefined || rows.length === 0}
          />
        }
      />

      <ReportFilters note={range.chip}>
        <SiteSelect
          value={site}
          onChange={setSite}
          className="h-control w-52"
          aria-label="Site"
        />
        <WindowControl range={range} />
      </ReportFilters>

      {queryState(register, {
        loading: "Reading the disposed assets…",
        render: (data) => (
          <>
            {!data.complete && (
              <Banner tone="warn" className="mb-3">
                The register is larger than this report reads in one go, so
                disposals may be missing. Narrow the site.
              </Banner>
            )}
            <ReportSummary
              items={[
                { label: "Assets disposed", display: count(rows.length) },
                { label: "Book value at disposal", value: total.book },
                { label: "Proceeds", value: total.proceeds },
                {
                  label: "Gain / (Loss)",
                  value: total.result,
                  indicator:
                    rows.length === 0
                      ? undefined
                      : total.result >= 0
                        ? "Green"
                        : "Red",
                },
              ]}
            />
            {rows.length === 0 ? (
              <EmptyState>
                No asset was sold or written off between {day(from)} and{" "}
                {day(to)}.
              </EmptyState>
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Asset No</Th>
                    <Th>Name</Th>
                    <Th>Category</Th>
                    <Th>Method</Th>
                    <Th align="right">Cost</Th>
                    <Th align="right">Accumulated depreciation</Th>
                    <Th align="right">Book value at disposal</Th>
                    <Th align="right">Proceeds</Th>
                    <Th align="right">Gain / (Loss)</Th>
                    <Th>Journal</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(
                    ({ asset, cost, accumulated, book, proceeds, result }) => (
                      <tr key={asset.asset_id}>
                        <Td>{day(asset.disposed_on)}</Td>
                        <Td>
                          <Code>{asset.asset_number}</Code>
                        </Td>
                        <Td className="max-w-[20rem] truncate">
                          <span title={asset.name}>{asset.name}</span>
                        </Td>
                        <Td>{asset.category_name}</Td>
                        <Td>{methodLabel(asset.disposal_method)}</Td>
                        <Td align="right">{money(cost)}</Td>
                        <Td align="right">{money(accumulated)}</Td>
                        <Td align="right">{money(book)}</Td>
                        <Td align="right">{money(proceeds)}</Td>
                        <Td align="right">
                          <span className={cn(result < 0 && "text-bad-fg")}>
                            {money(result)}
                          </span>
                        </Td>
                        <Td>
                          {asset.disposal_journal_entry_id === null ? (
                            <span className="text-faint">—</span>
                          ) : (
                            <AppLink
                              to="/finance/accounting/journal-entries"
                              sheet={{
                                key: "entry",
                                value: asset.disposal_journal_entry_id,
                              }}
                              className="text-accent hover:underline"
                            >
                              Open entry
                            </AppLink>
                          )}
                        </Td>
                      </tr>
                    )
                  )}
                  <TotalRow>
                    <Td colSpan={5}>Total</Td>
                    <Td align="right">{money(total.cost)}</Td>
                    <Td align="right">{money(total.accumulated)}</Td>
                    <Td align="right">{money(total.book)}</Td>
                    <Td align="right">{money(total.proceeds)}</Td>
                    <Td align="right">{money(total.result)}</Td>
                    <Td />
                  </TotalRow>
                </tbody>
              </Grid>
            )}
          </>
        ),
      })}
    </PageContent>
  )
}

/// One disposal's money, from the figures the entry was built on.
function figuresOf(asset: AssetRow) {
  const cost = asset.capitalized_cost_minor ?? 0
  const accumulated = asset.accumulated_minor
  const book = cost - accumulated
  const proceeds = asset.disposal_proceeds_minor ?? 0
  return { asset, cost, accumulated, book, proceeds, result: proceeds - book }
}

function methodLabel(method: string | null): string {
  if (method === "SOLD") return "Sold"
  if (method === "WRITTEN_OFF") return "Written off"
  return method ?? "—"
}
