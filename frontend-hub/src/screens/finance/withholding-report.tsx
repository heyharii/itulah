import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { ExportButton } from "@/components/ui/export-button"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { fileSafe, type ExportSheet } from "@/lib/export-xlsx"
import { count, day, money } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import { financeKeys, listTaxTemplates } from "@/lib/queries/finance"
import {
  financeReportKeys,
  withholdingReport,
} from "@/lib/queries/finance-reports"
import { Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import { monthLabel, todayIso } from "@/screens/finance/chart"
import { useSupplierName, useUnitName } from "@/screens/finance/hooks"
import { UnitSelect } from "@/screens/finance/parts"
import { ReportFilters, ReportSummary } from "@/screens/finance/report"
import type { WithholdingRow } from "@itulah/contract"

/// ERPNext's Tax Withholding Details, as the accountant's monthly worksheet
/// for the PPh 23 / PPh 4(2) return: every posted supplier payment that kept
/// tax back, grouped by the tax template it was withheld under, with the base
/// (DPP) it was worked on and the amount withheld.
///
/// `GET /api/v1/finance/reports/withholding`. The server reads it off the
/// payments themselves — the payment is where the tax was decided and posted —
/// so nothing here is re-derived: the base is the server's, and the subtotals
/// are sums of those rows, not of anything divided back out of a rate.
///
/// A month, not a free window: the return is filed per month, and a month is
/// one choice where two dates are two chances to leave a day out. It opens on
/// last month, because that is the one being filed.
///
/// An NPWP the supplier master does not have is said on the row. A withholding
/// certificate (bukti potong) cannot be issued without one, and the person
/// reading this is the person who will find that out otherwise on the 10th.
export function WithholdingReport() {
  const [month, setMonth] = useState(lastMonth)
  const [unit, setUnit] = useState("")
  const [template, setTemplate] = useState("")
  const unitName = useUnitName()
  const supplierName = useSupplierName()

  const { from, to } = windowOf(month)

  const templates = useQuery({
    queryKey: financeKeys.taxTemplates(),
    queryFn: ({ signal }) => listTaxTemplates(signal),
    staleTime: 5 * 60_000,
  })

  const report = useQuery({
    queryKey: financeReportKeys.withholding(
      from,
      to,
      unit || null,
      template || null
    ),
    queryFn: ({ signal }) =>
      withholdingReport(
        {
          from,
          to,
          unit: unit || undefined,
          template: template || undefined,
        },
        signal
      ),
  })

  const note = [
    monthName(month),
    unit === "" ? "All units" : unitName(unit),
    ...(template === "" ? [] : [templateName(templates.data, template)]),
  ].join(" · ")

  const build = (): ExportSheet | null => {
    const rows = report.data
    if (rows === undefined) return null
    const groups = groupRows(rows)
    const sheetRows: (string | number | null)[][] = []
    const styles: ({ bold?: boolean } | undefined)[] = []
    for (const group of groups) {
      for (const row of group.rows) {
        sheetRows.push([
          row.payment_date,
          row.payment_number,
          supplierOf(row, supplierName),
          row.npwp ?? "",
          taxOf(row),
          kindOf(row),
          row.invoices,
          row.entry_number ?? "",
          row.base_minor,
          row.withheld_minor,
        ])
        styles.push(undefined)
      }
      sheetRows.push([
        "",
        "",
        `${group.name} · ${group.rows.length} ${group.rows.length === 1 ? "payment" : "payments"}`,
        "",
        "",
        "",
        "",
        "",
        group.base,
        group.withheld,
      ])
      styles.push({ bold: true })
    }
    return {
      filename: `Tax-Withholding-${month}${unit === "" ? "" : `-${fileSafe(unitName(unit))}`}`,
      sheet: "Tax Withholding",
      title: "Tax Withholding Details",
      subtitle: note,
      columns: [
        { header: "Date", kind: "date" },
        { header: "Payment", kind: "text", width: 18 },
        { header: "Supplier", kind: "text", width: 32 },
        { header: "NPWP", kind: "text", width: 22 },
        { header: "Tax", kind: "text", width: 28 },
        { header: "Final / Creditable", kind: "text", width: 16 },
        { header: "Bills", kind: "text", width: 30 },
        { header: "Journal", kind: "text", width: 18 },
        { header: "Base (DPP)", kind: "money" },
        { header: "Withheld", kind: "money" },
      ],
      rows: sheetRows,
      rowStyles: styles,
      totalRow: [
        "",
        "",
        "Total",
        "",
        "",
        "",
        "",
        "",
        sum(rows, "base_minor"),
        sum(rows, "withheld_minor"),
      ],
    }
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Taxes"
        title="Tax Withholding Details"
        actions={
          <ExportButton
            build={build}
            disabled={report.data === undefined || report.data.length === 0}
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
        <Select
          value={month}
          onChange={setMonth}
          className="h-control w-44"
          aria-label="Month"
        >
          {monthChoices().map((choice) => (
            <option key={choice} value={choice}>
              {monthName(choice)}
            </option>
          ))}
        </Select>
        <Select
          value={template}
          onChange={setTemplate}
          className="h-control w-56"
          aria-label="Tax template"
        >
          <option value="">All tax templates</option>
          {(templates.data ?? []).map((row) => (
            <option key={row.code} value={row.code}>
              {row.name}
            </option>
          ))}
        </Select>
      </ReportFilters>

      {queryState(report, {
        loading: "Adding up what was withheld…",
        render: (rows) => <Body rows={rows} />,
      })}
    </PageContent>
  )
}

function Body({ rows }: { rows: WithholdingRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState>
          No tax was withheld from suppliers in this month.
        </EmptyState>
      </Card>
    )
  }
  const groups = groupRows(rows)
  const withheld = sum(rows, "withheld_minor")
  const base = sum(rows, "base_minor")
  const missing = rows.filter((row) => row.npwp === null || row.npwp === "")
  return (
    <>
      <ReportSummary
        items={[
          { label: "Base (DPP)", value: base },
          { label: "Withheld", value: withheld },
          {
            label: "Payments",
            value: rows.length,
            display: count(rows.length),
          },
        ]}
      />

      <Grid>
        <thead>
          <tr>
            <Th width="8rem">Date</Th>
            <Th width="14rem">Payment</Th>
            <Th>Supplier</Th>
            <Th align="right" width="9.5rem">
              Base (DPP)
            </Th>
            <Th align="right" width="9.5rem">
              Withheld
            </Th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <GroupRows key={group.code} group={group} />
          ))}
          <TotalRow>
            <Td colSpan={3}>Total</Td>
            <Td align="right">{money(base)}</Td>
            <Td align="right">{money(withheld)}</Td>
          </TotalRow>
        </tbody>
      </Grid>

      {missing.length > 0 && (
        <p className="mt-3 px-1 text-[0.875rem] text-warn-fg">
          {count(missing.length)}{" "}
          {missing.length === 1 ? "payment is" : "payments are"} for a supplier
          with no NPWP. A withholding certificate cannot be issued without it.
        </p>
      )}
    </>
  )
}

interface Group {
  readonly code: string
  readonly name: string
  readonly rows: WithholdingRow[]
  readonly base: number
  readonly withheld: number
}

/// One group per tax template, in template-code order; the rows inside keep
/// the server's date order.
function groupRows(rows: readonly WithholdingRow[]): Group[] {
  const byCode = new Map<string, WithholdingRow[]>()
  for (const row of rows) {
    const bucket = byCode.get(row.template_code)
    if (bucket === undefined) byCode.set(row.template_code, [row])
    else bucket.push(row)
  }
  return [...byCode.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, bucket]) => {
      const head = bucket[0]
      return {
        code,
        name: head === undefined ? code : taxOf(head),
        rows: bucket,
        base: sum(bucket, "base_minor"),
        withheld: sum(bucket, "withheld_minor"),
      }
    })
}

function GroupRows({ group }: { group: Group }) {
  const supplierName = useSupplierName()
  return (
    <>
      <tr data-total className="h-10 bg-soft/60">
        <Td colSpan={5} className="font-medium text-ink">
          {group.name}
          {/* Final or creditable is a property of the tax, so it is said
              once on its band rather than on every row under it. */}
          {group.rows[0] !== undefined && (
            <span className="font-normal text-mute">
              {" · "}
              {kindOf(group.rows[0])}
            </span>
          )}
        </Td>
      </tr>
      {group.rows.map((row) => (
        <tr key={row.payment_id}>
          <Td>{day(row.payment_date)}</Td>
          {/* The payment and the bills it paid: one answer to "which
              document", two lines instead of two columns. */}
          <Td className="max-w-0">
            <span className="block font-mono text-[0.875rem] text-ink">
              {row.payment_number}
            </span>
            <span
              className="block truncate text-[0.875rem] text-mute"
              title={row.invoices}
            >
              {row.invoices === "" ? "—" : row.invoices}
            </span>
          </Td>
          {/* The supplier and the NPWP the certificate is issued to. */}
          <Td className="max-w-0">
            <span className="block truncate text-ink">
              {supplierOf(row, supplierName)}
              {row.supplier_count > 1 && (
                <span className="text-mute">
                  {" "}
                  +{count(row.supplier_count - 1)} more
                </span>
              )}
            </span>
            <span className="block text-[0.875rem]">
              {row.npwp === null || row.npwp === "" ? (
                <span className="text-warn-fg">No NPWP</span>
              ) : (
                <span className="font-mono text-mute">{row.npwp}</span>
              )}
            </span>
          </Td>
          <Td align="right">{money(row.base_minor)}</Td>
          <Td align="right">
            <span className="font-medium text-ink">
              {money(row.withheld_minor)}
            </span>
          </Td>
        </tr>
      ))}
      <tr data-total className="h-11 border-b border-hairline-2">
        <Td colSpan={3} className="text-mute">
          {group.name} · {count(group.rows.length)}{" "}
          {group.rows.length === 1 ? "payment" : "payments"}
        </Td>
        <Td align="right" className="font-medium text-ink">
          {money(group.base)}
        </Td>
        <Td align="right" className="font-medium text-ink">
          {money(group.withheld)}
        </Td>
      </tr>
    </>
  )
}

/// The template's own name and rate: "PPh 23 Services · 2%". A template the
/// server no longer names falls back to its code.
function taxOf(row: WithholdingRow): string {
  const name = row.template_name ?? row.template_code
  return row.rate_bps === null ? name : `${name} · ${row.rate_bps / 100}%`
}

function kindOf(row: WithholdingRow): string {
  if (row.is_final === null) return "—"
  return row.is_final ? "Final" : "Creditable"
}

function supplierOf(
  row: WithholdingRow,
  supplierName: (id: string | null, name: string | null) => string
): string {
  return supplierName(row.supplier_id, row.supplier_name)
}

function templateName(
  templates: readonly { code: string; name: string }[] | undefined,
  code: string
): string {
  return templates?.find((row) => row.code === code)?.name ?? code
}

function sum(
  rows: readonly WithholdingRow[],
  key: "base_minor" | "withheld_minor"
): number {
  return rows.reduce((total, row) => total + row[key], 0)
}

// ── months ───────────────────────────────────────────────────────────────

/// `YYYY-MM` of the month before today's. Sliced, not parsed — see
/// `report.tsx`'s `periodsOf` for why a bare date is never `new Date`d here.
function lastMonth(): string {
  const today = todayIso()
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  return month === 1 ? stamp(year - 1, 12) : stamp(year, month - 1)
}

function stamp(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`
}

/// The eighteen months up to and including this one, newest first: far enough
/// back to refile a quarter, short enough to read as a list.
function monthChoices(): string[] {
  const today = todayIso()
  let year = Number(today.slice(0, 4))
  let month = Number(today.slice(5, 7))
  const out: string[] = []
  for (let i = 0; i < 18; i += 1) {
    out.push(stamp(year, month))
    month -= 1
    if (month === 0) {
      month = 12
      year -= 1
    }
  }
  return out
}

function monthName(value: string): string {
  return monthLabel(Number(value.slice(0, 4)), Number(value.slice(5, 7)))
}

/// First and last day of a `YYYY-MM`.
function windowOf(value: string): { from: string; to: string } {
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const last = new Date(year, month, 0).getDate()
  return {
    from: `${value}-01`,
    to: `${value}-${String(last).padStart(2, "0")}`,
  }
}
