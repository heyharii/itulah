import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { ExportButton } from "@/components/ui/export-button"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { node } from "@/lib/api"
import { fileSafe, type ExportSheet } from "@/lib/export-xlsx"
import { count, day, money } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import { listTerms, vocabularyKeys } from "@/lib/queries/vocabulary"
import { Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import { percent, share } from "@/screens/finance-final/reports/two-year"
import { todayIso } from "@/screens/finance/chart"
import { useUnitName, type DateWindow } from "@/screens/finance/hooks"
import { UnitSelect, WindowControl } from "@/screens/finance/parts"
import { ReportFilters, ReportSummary } from "@/screens/finance/report"
import type {
  DivisionSalesRow,
  DivisionSalesTotal,
  SalesByDivision as Report,
} from "@itulah/contract"

/// 7Soft's "SUMMARY PENJUALAN per DIVISI By HPP rata2", the way the client
/// read it there: one row per division — quantity, gross, discount, returns,
/// net, its share of the net, the cost at average receipt cost (HPP
/// rata-rata), gross profit, margin and mark-up — then the total, then the
/// voided sales (PEMBATALAN PENJUALAN) on a line of their own.
///
/// `GET /api/v1/finance/reports/sales-by-division`. The server sends the
/// figures; gross profit and the three percentages are worked out here, once,
/// so the screen and the Excel file cannot disagree. 7Soft's GROUP filter has
/// nothing to stand on in the article master (a division and its tags are all
/// an article carries), so the one filter under the division is the tag,
/// called Category here.
export function SalesByDivision() {
  const range = useYearToDate()
  const [unit, setUnit] = useState("")
  const [category, setCategory] = useState("")
  const unitName = useUnitName()

  const tags = useQuery({
    queryKey: vocabularyKeys.list("tags"),
    queryFn: ({ signal }) => listTerms("tags", signal),
    staleTime: 5 * 60_000,
  })

  const report = useQuery({
    queryKey: [
      "finance",
      "sales-by-division",
      range.from,
      range.to,
      unit || null,
      category || null,
    ],
    queryFn: ({ signal }) =>
      salesByDivision(
        { from: range.from, to: range.to, unit, category },
        signal
      ),
  })

  const categoryName =
    tags.data?.terms.find((term) => term.code === category)?.label ?? category
  const note = [
    range.chip,
    unit === "" ? "All units" : unitName(unit),
    ...(category === "" ? [] : [categoryName]),
  ].join(" · ")

  const build = (): ExportSheet | null => {
    const data = report.data
    if (data === undefined) return null
    return {
      filename: `Sales-by-Division-${unit === "" ? "All-Units" : fileSafe(unitName(unit))}-${range.from}-${range.to}`,
      sheet: "Sales by Division",
      title: "Sales by Division",
      subtitle: note,
      columns: [
        { header: "Code", kind: "text", width: 16 },
        { header: "Division", kind: "text", width: 28 },
        { header: "Quantity", kind: "number" },
        { header: "Gross Sales", kind: "money" },
        { header: "Discount", kind: "money" },
        { header: "Returns", kind: "money" },
        { header: "Net Sales", kind: "money" },
        { header: "% of Net", kind: "percent" },
        { header: "HPP", kind: "money" },
        { header: "Gross Profit", kind: "money" },
        { header: "Margin %", kind: "percent" },
        { header: "Mark-up %", kind: "percent" },
      ],
      rows: [
        ...data.rows.map((row) =>
          exportRow(row.division_code, nameOf(row), row, data.total.net_minor)
        ),
        [],
        ["", "Voided sales", data.voided.count, data.voided.gross_minor],
      ],
      totalRow: exportRow("", "Total", data.total, data.total.net_minor),
    }
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Financial Reports"
        title="Sales by Division"
        actions={
          <ExportButton
            build={build}
            disabled={
              report.data === undefined || report.data.rows.length === 0
            }
          />
        }
      />

      <ReportFilters note={note}>
        <UnitSelect
          value={unit}
          onChange={setUnit}
          emptyLabel="All units"
          className="h-control w-52"
          aria-label="Unit"
        />
        <WindowControl range={range} />
        <Select
          value={category}
          onChange={setCategory}
          className="h-control w-48"
          aria-label="Category"
        >
          <option value="">All categories</option>
          {(tags.data?.terms ?? []).map((term) => (
            <option key={term.code} value={term.code}>
              {term.label}
            </option>
          ))}
        </Select>
      </ReportFilters>

      {queryState(report, {
        loading: "Adding up the divisions…",
        render: (data) => <Body report={data} />,
      })}
    </PageContent>
  )
}

function Body({ report }: { report: Report }) {
  const { total, voided } = report
  const grossProfit = total.net_minor - total.cost_minor
  const margin = share(grossProfit, total.net_minor)

  return (
    <>
      <ReportSummary
        items={[
          { label: "Net sales", value: total.net_minor },
          { label: "HPP", value: total.cost_minor },
          {
            label: "Gross profit",
            value: grossProfit,
            indicator: grossProfit < 0 ? "Red" : undefined,
          },
          { label: "Margin", value: margin, display: percent(margin) },
        ]}
      />

      {report.rows.length === 0 ? (
        <Card>
          <EmptyState>No sales in this window.</EmptyState>
        </Card>
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th>Division</Th>
              <Th align="right" width="5rem">
                Qty
              </Th>
              <Th align="right">Gross sales</Th>
              <Th align="right">Discount</Th>
              <Th align="right">Returns</Th>
              <Th align="right">Net sales</Th>
              <Th align="right" width="6rem">
                % of net
              </Th>
              <Th align="right">HPP</Th>
              <Th align="right">Gross profit</Th>
              <Th align="right" width="6rem">
                Margin %
              </Th>
              <Th align="right" width="6.5rem">
                Mark-up %
              </Th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <FigureRow
                key={row.division_code || "\u0000none"}
                row={row}
                base={total.net_minor}
              />
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Figures figures={total} base={total.net_minor} />
            </TotalRow>
          </tbody>
        </Grid>
      )}

      <p className="mt-3 px-1 text-[0.875rem] text-mute tabular-nums">
        Voided sales: {count(voided.count)} · {money(voided.gross_minor)}
      </p>
    </>
  )
}

function FigureRow({ row, base }: { row: DivisionSalesRow; base: number }) {
  return (
    <tr>
      <Td className="w-full max-w-0">
        <span
          title={row.division_code === "" ? undefined : row.division_code}
          className={
            row.division_code === ""
              ? "block truncate text-mute"
              : "block truncate text-ink"
          }
        >
          {nameOf(row)}
        </span>
      </Td>
      <Figures figures={row} base={base} />
    </tr>
  )
}

/// The ten figure cells, the same for a division and for the total.
function Figures({
  figures,
  base,
}: {
  figures: DivisionSalesRow | DivisionSalesTotal
  base: number
}) {
  const gp = figures.net_minor - figures.cost_minor
  return (
    <>
      <Td align="right" className={FIGURE}>
        {count(figures.quantity)}
      </Td>
      <Td align="right" className={FIGURE}>
        {figure(figures.gross_minor)}
      </Td>
      <Td align="right" className={FIGURE}>
        {figure(figures.discount_minor)}
      </Td>
      <Td align="right" className={FIGURE}>
        {figure(figures.returns_minor)}
      </Td>
      <Td align="right" className={FIGURE}>
        {figure(figures.net_minor)}
      </Td>
      <Td align="right" className={FIGURE}>
        {percent(share(figures.net_minor, base))}
      </Td>
      <Td align="right" className={FIGURE}>
        {figure(figures.cost_minor)}
      </Td>
      <Td align="right" className={FIGURE}>
        <span className={gp < 0 ? "text-bad-fg" : undefined}>{figure(gp)}</span>
      </Td>
      <Td align="right" className={FIGURE}>
        {percent(share(gp, figures.net_minor))}
      </Td>
      <Td align="right" className={FIGURE}>
        {percent(share(gp, figures.cost_minor))}
      </Td>
    </>
  )
}

/// Figure cells sit a little closer than text cells so all eleven columns
/// fit a laptop screen without scrolling sideways.
const FIGURE = "px-2.5 tabular-nums"

/// A whole-rupiah figure the way 7Soft prints its columns: grouped digits, no
/// currency sign (the headers say what they are), a loss in brackets.
function figure(minor: number): string {
  return minor < 0 ? `(${count(-minor)})` : count(minor)
}

function nameOf(row: DivisionSalesRow): string {
  return row.division_code === "" ? "Unclassified" : row.division_name
}

function exportRow(
  code: string,
  name: string,
  figures: DivisionSalesRow | DivisionSalesTotal,
  base: number
): (string | number | null)[] {
  const gp = figures.net_minor - figures.cost_minor
  return [
    code,
    name,
    figures.quantity,
    figures.gross_minor,
    figures.discount_minor,
    figures.returns_minor,
    figures.net_minor,
    share(figures.net_minor, base),
    figures.cost_minor,
    gp,
    share(gp, figures.net_minor),
    share(gp, figures.cost_minor),
  ]
}

/// A window defaulting to the year so far — 7Soft's summary was read for a
/// year — and following the boxes once somebody edits one.
function useYearToDate(): DateWindow {
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null)
  const today = todayIso()
  const value = draft ?? { from: `${today.slice(0, 4)}-01-01`, to: today }
  return {
    from: value.from,
    to: value.to,
    setFrom: (from) => setDraft({ ...value, from }),
    setTo: (to) => setDraft({ ...value, to }),
    chip: `${day(value.from)} – ${day(value.to)}`,
  }
}

/// Query string from what is set; an empty filter is left off.
function salesByDivision(
  params: { from: string; to: string; unit: string; category: string },
  signal?: AbortSignal
): Promise<Report> {
  const query = new URLSearchParams({ from: params.from, to: params.to })
  if (params.unit !== "") query.set("unit", params.unit)
  if (params.category !== "") query.set("category", params.category)
  return node.get<Report>(
    `/api/v1/finance/reports/sales-by-division?${query.toString()}`,
    { signal }
  )
}
