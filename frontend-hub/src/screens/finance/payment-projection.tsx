import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Banner, LoadingState } from "@/components/ui/states"
import { ExportButton } from "@/components/ui/export-button"
import { fileSafe, type ExportSheet } from "@/lib/export-xlsx"
import { count, day, money, moneyCompact } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { problemOf } from "@/lib/problem"
import {
  financeKeys,
  listBillTemplates,
  listAllBills,
  listGiros,
  unbilledReceipts,
} from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import {
  listPurchaseOrders,
  paymentTermsBook,
  procurementKeys,
} from "@/lib/queries/procurement"
import { cn } from "@/lib/utils"
import { Code, Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import { isoDay, monthLabel, todayIso } from "@/screens/finance/chart"
import {
  useSuppliers,
  useSupplierName,
  useUnitName,
} from "@/screens/finance/hooks"
import { CardFigure, PhoneList } from "@/components/ui/phone-cards"
import { SupplierName, UnitName, UnitSelect } from "@/screens/finance/parts"
import type { PaymentTermsBook } from "@itulah/contract"

/// The owner's asks, settled into one shape: "kita di payables perlu
/// projection ya, per bulan apa yg harus dibayar … atau ada calendar payment
/// jg biar enak? … both digabung lah ya" (2026-09-29) — then, after two
/// layouts that split the calendar and the list into their own halves of the
/// page, the final word: "kalender besarnya act as filter ke bawahnya, tapi
/// bisa per month di kalendernya atau per year". The calendar is not a
/// second view beside the list; it is what CHOOSES what the list below it
/// shows — a month at a time, or a whole year at a time, one control.
///
/// Six sources, none of them new reads:
/// - Bills to pay — `listBills({status: "POSTED"})`, outstanding > 0. Payable.
/// - Draft bills — `listBills({status: "DRAFT"})`, not yet in the books. Not
///   payable yet.
/// - Giros issued and not yet cleared — `listGiros({direction: "OUT"})`.
///   Payable: the bill behind a giro is already settled, so counting the
///   giro and not the bill it paid is what keeps this from double-counting.
/// - Recurring bills expected — `GET /finance/bill-templates`, one projected
///   row per active template per month actually on screen (one month in
///   Month mode, twelve in Year mode), skipped wherever a real bill for that
///   supplier's due month already exists. Not payable yet.
/// - Received, not billed — `unbilledReceipts()`: goods in the warehouse the
///   books do not know about at all. Not payable yet, and not a payable
///   until a bill is raised against it.
/// - Ordered, not received — the open purchase orders
///   (`listPurchaseOrders`), pro-rated to what is still outstanding. Not
///   payable yet — the loosest estimate on the page, since neither the bill
///   nor the delivery exists.
///
/// The last two have no due date to read, only a delivery date to guess a
/// payment date from: `arrived_at` / `expected_arrival` plus the supplier's
/// own payment-terms template (`paymentTermsBook`, the longest instalment in
/// it), or 30 days when the supplier names no template. Their date cell says
/// "est." because it is one.
export function PaymentProjection() {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1 // 1–12
  const today = todayIso()
  const unitName = useUnitName()
  const supplierLabel = useSupplierName()

  const [mode, setMode] = useState<CalendarMode>("month")
  const [periodYear, setPeriodYear] = useState(currentYear)
  const [periodMonth, setPeriodMonth] = useState(currentMonth)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [unit, setUnit] = useState("")
  const [needle, setNeedle] = useState("")
  const [includeNotPayable, setIncludeNotPayable] = useState(true)
  // Collapsed by default: Month mode's Overdue table can run to hundreds of
  // rows, and it is the register catching up on the PAST — the month just
  // chosen is what the reader came here for, so that goes first.
  const [overdueExpanded, setOverdueExpanded] = useState(false)
  const overdueRef = useRef<HTMLDivElement>(null)

  const units = useUnits()
  const sites =
    unit === ""
      ? ""
      : (units.data?.find((one) => one.id === unit)?.sites ?? [])
          .map((site) => site.id)
          .join(",")
  const siteFilter = sites === "" ? undefined : sites
  // A unit whose sites are not known yet must not read as every unit.
  const unitReady = unit === "" || sites !== ""

  const bills = useQuery({
    queryKey: [
      ...financeKeys.bills("POSTED", siteFilter ?? null),
      "projection",
    ],
    queryFn: ({ signal }) => listAllBills("POSTED", siteFilter, signal),
    enabled: unitReady,
    staleTime: 30_000,
  })
  const drafts = useQuery({
    queryKey: [...financeKeys.bills("DRAFT", siteFilter ?? null), "projection"],
    queryFn: ({ signal }) => listAllBills("DRAFT", siteFilter, signal),
    enabled: unitReady,
    staleTime: 30_000,
  })
  const giros = useQuery({
    queryKey: ["finance", "giros", "projection", "OUT"] as const,
    queryFn: ({ signal }) =>
      listGiros({ direction: "OUT", limit: 1000 }, signal),
    staleTime: 30_000,
  })
  const templates = useQuery({
    queryKey: financeKeys.billTemplates(),
    queryFn: ({ signal }) => listBillTemplates(signal),
    staleTime: 60_000,
  })
  const unbilled = useQuery({
    queryKey: ["finance", "unbilled", "projection"] as const,
    queryFn: ({ signal }) => unbilledReceipts(signal),
    staleTime: 30_000,
  })
  const purchaseOrders = useQuery({
    queryKey: procurementKeys.orders(),
    queryFn: ({ signal }) => listPurchaseOrders(undefined, signal),
    staleTime: 30_000,
  })
  const suppliers = useSuppliers()
  const termsBook = useQuery({
    queryKey: procurementKeys.paymentTerms(),
    queryFn: ({ signal }) => paymentTermsBook(signal),
    staleTime: 5 * 60_000,
  })

  const loading =
    !unitReady ||
    bills.isPending ||
    drafts.isPending ||
    giros.isPending ||
    templates.isPending ||
    unbilled.isPending ||
    purchaseOrders.isPending ||
    suppliers.isPending ||
    termsBook.isPending
  const errored =
    bills.error ??
    drafts.error ??
    giros.error ??
    templates.error ??
    unbilled.error ??
    purchaseOrders.error ??
    suppliers.error ??
    termsBook.error

  // ── the non-recurring rows — every date is the document's own, so these
  // don't depend on which month or year the calendar is showing ──────────
  //
  // Plain `const`s throughout, not `useMemo`: the React Compiler memoizes
  // this component's whole render, and a hand-written dependency array here
  // fights it rather than helping it.

  const siteSet = sites === "" ? null : new Set(sites.split(","))

  const baseEntries = ((): ProjectionEntry[] => {
    const list: ProjectionEntry[] = []

    for (const bill of bills.data ?? []) {
      if (bill.outstanding_minor <= 0 || bill.due_date === null) continue
      list.push({
        key: `bill-${bill.invoice_id}`,
        date: bill.due_date,
        kind: "bill",
        payable: true,
        estimated: false,
        whatLabel: bill.invoice_number,
        link: {
          to: "/finance/payables/bills",
          sheet: { key: "bill", value: bill.invoice_id },
        },
        supplierId: bill.supplier_id,
        supplierName: bill.supplier_name,
        amountMinor: bill.outstanding_minor,
      })
    }

    if (includeNotPayable) {
      for (const bill of drafts.data ?? []) {
        if (bill.due_date === null) continue
        list.push({
          key: `draft-${bill.invoice_id}`,
          date: bill.due_date,
          kind: "draft",
          payable: false,
          estimated: false,
          whatLabel: bill.invoice_number,
          link: {
            to: "/finance/payables/bills",
            sheet: { key: "bill", value: bill.invoice_id },
          },
          supplierId: bill.supplier_id,
          supplierName: bill.supplier_name,
          amountMinor: bill.total_minor,
        })
      }
    }

    for (const giro of giros.data ?? []) {
      if (
        giro.status === "CLEARED" ||
        giro.status === "REJECTED" ||
        giro.status === "VOIDED"
      )
        continue
      if (unit !== "" && giro.unit_id !== unit) continue
      list.push({
        key: `giro-${giro.giro_id}`,
        date: giro.due_date,
        kind: "giro",
        payable: true,
        estimated: false,
        whatLabel: giro.number,
        link: { to: "/finance/cash-bank/giro" },
        // `party_name` sometimes already carries a resolved name and
        // sometimes the bare supplier code — `<SupplierName>` resolves
        // either, and falls back to printing whatever this is unchanged
        // when it recognises neither, so routing it through the lookup here
        // is never a regression.
        supplierId: giro.party_name,
        supplierName: null,
        amountMinor: giro.amount_minor,
      })
    }

    if (includeNotPayable) {
      // Supplier codes (`SUP-001`), not the register's uuid: bills, receipts
      // and orders all carry the code — see `useSupplierName`'s own comment.
      const termCodeByCode = new Map<string, string | null>()
      for (const supplier of suppliers.data ?? []) {
        termCodeByCode.set(
          supplier.supplier_code,
          supplier.default_payment_terms_code
        )
      }

      for (const receipt of unbilled.data ?? []) {
        if (siteSet !== null && !siteSet.has(receipt.site_id)) continue
        const amount =
          receipt.invoice_total_minor ?? receipt.value_at_order_price_minor
        const days = termDaysOf(
          termCodeByCode.get(receipt.supplier_id) ?? null,
          termsBook.data
        )
        list.push({
          key: `unbilled-${receipt.receipt_id}`,
          date: addDaysIso(receipt.arrived_at, days),
          kind: "unbilled",
          payable: false,
          estimated: true,
          whatLabel: receipt.receipt_number,
          link: undefined,
          supplierId: receipt.supplier_id,
          supplierName: null,
          amountMinor: amount,
        })
      }

      for (const po of purchaseOrders.data ?? []) {
        if (po.outstanding_stock_units <= 0 || po.fully_received) continue
        if (po.expected_stock_units <= 0 || po.expected_arrival === null)
          continue
        if (siteSet !== null && !siteSet.has(po.destination_site_id)) continue
        const amount = Math.round(
          (po.net_minor * po.outstanding_stock_units) / po.expected_stock_units
        )
        const days = termDaysOf(
          termCodeByCode.get(po.supplier_id) ?? null,
          termsBook.data
        )
        list.push({
          key: `po-${po.purchase_order_id}`,
          date: addDaysIso(po.expected_arrival, days),
          kind: "ordered",
          payable: false,
          estimated: true,
          whatLabel: po.po_number,
          link: undefined,
          supplierId: po.supplier_id,
          supplierName: po.supplier_name,
          amountMinor: amount,
        })
      }
    }

    return list
  })()

  // The months actually on screen: one in Month mode, all twelve in Year
  // mode. Recurring rows are projected only for these — a promise for a
  // month nobody is looking at is not this render's business.
  const monthsShown: readonly { year: number; month: number }[] =
    mode === "month"
      ? [{ year: periodYear, month: periodMonth }]
      : Array.from({ length: 12 }, (_, i) => ({
          year: periodYear,
          month: i + 1,
        }))

  const recurringEntries = ((): ProjectionEntry[] => {
    if (!includeNotPayable) return []
    const list: ProjectionEntry[] = []
    const bothBills = [...(bills.data ?? []), ...(drafts.data ?? [])]
    for (const { year, month } of monthsShown) {
      const monthKey = keyOf(year, month)
      const daysInThatMonth = new Date(year, month, 0).getDate()
      const covered = new Set(
        bothBills
          .filter(
            (bill) =>
              bill.due_date !== null && bill.due_date.slice(0, 7) === monthKey
          )
          .map((bill) => bill.supplier_id)
      )
      for (const template of templates.data ?? []) {
        if (!template.active) continue
        if (siteSet !== null && !siteSet.has(template.site_id)) continue
        // A real bill from this supplier due this same month already
        // covers the promise — the projected row would double what is
        // already on the register.
        if (covered.has(template.supplier_id)) continue
        const dueDay = Math.min(Math.max(template.due_day, 1), daysInThatMonth)
        list.push({
          key: `template-${template.template_id}-${monthKey}`,
          date: `${monthKey}-${String(dueDay).padStart(2, "0")}`,
          kind: "recurring",
          payable: false,
          estimated: false,
          whatLabel: template.label,
          link: undefined,
          supplierId: template.supplier_id,
          supplierName: template.supplier_name,
          amountMinor:
            template.expected_subtotal_minor + template.expected_tax_minor,
        })
      }
    }
    return list
  })()

  // The search narrows every figure on the page, the calendar and the export
  // along with the lists — they all read from this one set — so what is
  // totalled is always what is shown. It matches the payee and the document
  // number (bill, giro, receipt, order or recurring label).
  const text = needle.trim().toLowerCase()
  const allEntries = [...baseEntries, ...recurringEntries].filter(
    (row) =>
      text === "" ||
      [
        supplierLabel(row.supplierId, row.supplierName),
        row.supplierId,
        row.whatLabel,
      ].some((field) => (field ?? "").toLowerCase().includes(text))
  )

  // The selected period's own bounds, and whether it reaches back to today —
  // which is the only time a carried-in Overdue table means anything: a
  // month or year that does not contain today has no "before this" to speak
  // of that is not simply last month's own table.
  const periodStartIso =
    mode === "month"
      ? isoDay(new Date(periodYear, periodMonth - 1, 1))
      : isoDay(new Date(periodYear, 0, 1))
  const periodEndIso =
    mode === "month"
      ? isoDay(new Date(periodYear, periodMonth, 0))
      : isoDay(new Date(periodYear, 11, 31))
  const showOverdue =
    mode === "month"
      ? periodYear === currentYear && periodMonth === currentMonth
      : periodYear === currentYear

  const overdueRows = showOverdue
    ? allEntries
        .filter((row) => row.date < periodStartIso)
        .sort((a, b) => a.date.localeCompare(b.date))
    : []
  const periodRows = allEntries
    .filter((row) => row.date >= periodStartIso && row.date <= periodEndIso)
    .sort((a, b) => a.date.localeCompare(b.date))

  const overdueTotal = sumOf(overdueRows)
  const payableTotal = sumOf(periodRows.filter((row) => row.payable))
  const notPayableTotal = sumOf(periodRows.filter((row) => !row.payable))
  const grandTotal = overdueTotal + payableTotal + notPayableTotal

  const monthDayTotals = mode === "month" ? dayTotalsOf(periodRows) : new Map()

  function stepPeriod(delta: number) {
    setSelectedDay(null)
    if (mode === "month") {
      const base = new Date(periodYear, periodMonth - 1 + delta, 1)
      setPeriodYear(base.getFullYear())
      setPeriodMonth(base.getMonth() + 1)
    } else {
      setPeriodYear((year) => year + delta)
    }
  }

  function goToday() {
    setSelectedDay(null)
    setPeriodYear(currentYear)
    setPeriodMonth(currentMonth)
  }

  function selectMonth(month: number) {
    setMode("month")
    setPeriodMonth(month)
    setSelectedDay(null)
  }

  function selectMonthDay(month: number, iso: string) {
    setMode("month")
    setPeriodMonth(month)
    setSelectedDay(iso)
  }

  function toggleDay(iso: string) {
    setSelectedDay((was) => (was === iso ? null : iso))
  }

  function openOverdue() {
    setOverdueExpanded(true)
    requestAnimationFrame(() =>
      overdueRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    )
  }

  /// The same rows and columns the CSV had, as a workbook: the overdue ones
  /// first, then the period on screen, amounts as numbers.
  function buildExport(): ExportSheet | null {
    const rows: ExportRow[] = [
      ...overdueRows.map((row) => ({ ...row, monthText: "Overdue" })),
      ...(mode === "month"
        ? periodRows.map((row) => ({
            ...row,
            monthText: monthLabel(periodYear, periodMonth),
          }))
        : monthsShown.flatMap(({ year, month }) =>
            periodRows
              .filter((row) => row.date.slice(0, 7) === keyOf(year, month))
              .map((row) => ({ ...row, monthText: monthLabel(year, month) }))
          )),
    ]
    if (rows.length === 0) return null
    const period =
      mode === "month"
        ? monthLabel(periodYear, periodMonth)
        : String(periodYear)
    return {
      filename: `Payment-Projection-${fileSafe(period)}`,
      sheet: "Payment Projection",
      title: "Payment Projection",
      subtitle: `${period} · ${unit === "" ? "all units" : unitName(unit)}${
        includeNotPayable ? "" : " · not-payable-yet excluded"
      }`,
      columns: [
        { header: "Month", kind: "text", width: 18 },
        { header: "Date", kind: "date" },
        { header: "What", kind: "text", width: 36 },
        { header: "Supplier", kind: "text", width: 34 },
        { header: "Type", kind: "text", width: 16 },
        { header: "Payable / Not Payable Yet", kind: "text", width: 24 },
        { header: "Status", kind: "text", width: 18 },
        { header: "Amount", kind: "money" },
      ],
      rows: rows.map((row) => [
        row.monthText,
        row.date,
        row.whatLabel,
        supplierLabel(row.supplierId, row.supplierName),
        TYPE_LABEL[row.kind],
        row.payable ? "Payable" : "Not payable yet",
        statusOf(row, today).label,
        row.amountMinor,
      ]),
    }
  }

  const summary: readonly SummaryTile[] = [
    ...(showOverdue
      ? [
          {
            label: "Overdue",
            value: overdueTotal,
            indicator: overdueTotal > 0 ? ("Red" as const) : undefined,
            onClick: overdueRows.length > 0 ? openOverdue : undefined,
          },
        ]
      : []),
    { label: "Payable", value: payableTotal },
    { label: "Not payable yet", value: notPayableTotal },
    { label: "Total", value: grandTotal },
  ]

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Payables"
        title="Payment Projection"
      />

      <Toolbar>
        <Input
          value={needle}
          onChange={(event) => {
            setNeedle(event.target.value)
            setSelectedDay(null)
          }}
          aria-label="Search payments"
          placeholder="Search payments"
          className="h-control w-64"
        />
        <UnitSelect
          value={unit}
          onChange={(next) => {
            setUnit(next)
            setSelectedDay(null)
          }}
          className="h-control w-44"
          aria-label="Unit"
        />
        <Checkbox
          label="Include not payable yet"
          checked={includeNotPayable}
          onChange={setIncludeNotPayable}
        />
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute">
          {unit === "" ? "all units" : <UnitName id={unit} />}
          {includeNotPayable ? "" : " · not-payable-yet excluded"}
        </span>
        <ExportButton
          variant="ghost"
          build={buildExport}
          disabled={periodRows.length === 0 && overdueRows.length === 0}
        />
      </Toolbar>

      {errored !== undefined && errored !== null && (
        <Banner tone="bad">
          {problemOf(errored) ?? "The projection could not be read."}
        </Banner>
      )}

      {loading ? (
        <LoadingState>Working out what must be paid…</LoadingState>
      ) : (
        <>
          <PeriodSummary items={summary} />

          <Card className="mb-3 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Segmented
                options={[
                  { value: "month" as const, label: "Month" },
                  { value: "year" as const, label: "Year" },
                ]}
                value={mode}
                onChange={(next) => {
                  setMode(next)
                  setSelectedDay(null)
                }}
              />
              <span className="inline-flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={
                    mode === "month" ? "Previous month" : "Previous year"
                  }
                  onClick={() => stepPeriod(-1)}
                >
                  <ChevronLeft className="size-4 stroke-[1.7]" />
                </Button>
                <span className="min-w-[8rem] text-center text-[0.9375rem] font-medium text-ink">
                  {mode === "month"
                    ? monthLabel(periodYear, periodMonth)
                    : periodYear}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={mode === "month" ? "Next month" : "Next year"}
                  onClick={() => stepPeriod(1)}
                >
                  <ChevronRight className="size-4 stroke-[1.7]" />
                </Button>
              </span>
              <Button variant="ghost" onClick={goToday}>
                Today
              </Button>
            </div>

            {mode === "month" ? (
              <BigMonthCalendar
                year={periodYear}
                month={periodMonth}
                today={today}
                dayTotals={monthDayTotals}
                selectedDay={selectedDay}
                onSelectDay={toggleDay}
              />
            ) : (
              <YearGrid
                year={periodYear}
                rows={periodRows}
                today={today}
                onSelectMonth={selectMonth}
                onSelectDay={selectMonthDay}
              />
            )}
          </Card>

          {mode === "month" ? (
            <>
              {selectedDay !== null && (
                <div className="mb-1.5 flex items-center gap-2 text-[0.875rem] text-mute">
                  <span>Showing {day(selectedDay)}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedDay(null)}
                    className="text-accent hover:underline"
                  >
                    Clear
                  </button>
                </div>
              )}
              <MonthSection
                heading={monthLabel(periodYear, periodMonth)}
                rows={
                  selectedDay === null
                    ? periodRows
                    : periodRows.filter((row) => row.date === selectedDay)
                }
                today={today}
                selectedDay={null}
                emptyText={
                  text !== ""
                    ? `No payment matches “${needle.trim()}”.`
                    : selectedDay === null
                      ? `Nothing falls due in ${monthLabel(periodYear, periodMonth)}.`
                      : `Nothing falls due on ${day(selectedDay)}.`
                }
              />

              {showOverdue && overdueRows.length > 0 && (
                <OverdueSection
                  rows={overdueRows}
                  today={today}
                  expanded={overdueExpanded}
                  onToggle={() => setOverdueExpanded((was) => !was)}
                  registerRef={overdueRef}
                />
              )}
            </>
          ) : (
            <>
              {showOverdue && overdueRows.length > 0 && (
                <MonthSection
                  heading="Overdue"
                  rows={overdueRows}
                  today={today}
                  selectedDay={null}
                  emptyText="Nothing is overdue."
                />
              )}

              {text !== "" &&
                periodRows.length === 0 &&
                overdueRows.length === 0 && (
                  <p className="px-1 pb-1 text-[0.875rem] text-mute">
                    No payment matches “{needle.trim()}”.
                  </p>
                )}

              {monthsShown.map(({ year, month }) => {
                const key = keyOf(year, month)
                const inMonth = periodRows.filter(
                  (row) => row.date.slice(0, 7) === key
                )
                // A month the search left empty is not worth a heading.
                if (text !== "" && inMonth.length === 0) return null
                return (
                  <MonthSection
                    key={key}
                    heading={monthLabel(year, month)}
                    rows={inMonth}
                    today={today}
                    selectedDay={null}
                    emptyText={`Nothing falls due in ${monthLabel(year, month)}.`}
                  />
                )
              })}
            </>
          )}
        </>
      )}
    </PageContent>
  )
}

type CalendarMode = "month" | "year"

function keyOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`
}

/// `iso` plus `days`, in local time — the same reason `isoDay` parses by hand
/// rather than through `new Date(iso)`: that reads a bare date as UTC and
/// names the previous day for the first seven hours of every day in Jakarta.
function addDaysIso(iso: string, days: number): string {
  const [year, month, dateOfMonth] = iso.slice(0, 10).split("-").map(Number)
  const date = new Date(year, month - 1, dateOfMonth)
  date.setDate(date.getDate() + days)
  return isoDay(date)
}

/// The longest instalment in a supplier's default template, in days —
/// `MONTHS_AFTER_BILL_MONTH_END` read as 30 days a month. A rough estimate
/// for a rough row: this screen is projecting money that is not yet a bill,
/// so the day-of-month precision the real schedule carries would be false
/// confidence. Falls back to 30 when the supplier names no template, or the
/// book has not answered yet.
function termDaysOf(
  code: string | null,
  book: PaymentTermsBook | undefined
): number {
  if (code === null || book === undefined) return 30
  const template = book.templates.find((one) => one.code === code)
  if (template === undefined || template.lines.length === 0) return 30
  return Math.max(
    ...template.lines.map((line) =>
      line.basis === "MONTHS_AFTER_BILL_MONTH_END"
        ? line.offset_value * 30
        : line.offset_value
    )
  )
}

function dayTotalsOf(
  rows: readonly ProjectionEntry[]
): Map<string, { total: number; count: number }> {
  const map = new Map<string, { total: number; count: number }>()
  for (const row of rows) {
    const cell = map.get(row.date) ?? { total: 0, count: 0 }
    cell.total += row.amountMinor
    cell.count += 1
    map.set(row.date, cell)
  }
  return map
}

// ---------------------------------------------------------------------------
// One month's table — payables first, what is only expected after them
// ---------------------------------------------------------------------------

function MonthSection({
  heading,
  rows,
  today,
  selectedDay,
  emptyText,
}: {
  heading: string
  rows: readonly ProjectionEntry[]
  today: string
  selectedDay: string | null
  emptyText: string
}) {
  return (
    <div className="mb-5">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h2 className="text-[0.9375rem] font-semibold text-ink">{heading}</h2>
        {rows.length > 0 && (
          <span className="text-[0.875rem] text-mute">
            {rows.length} {rows.length === 1 ? "item" : "items"}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-1 pb-1 text-[0.875rem] text-mute">{emptyText}</p>
      ) : (
        <ProjectionTable
          rows={rows}
          today={today}
          selectedDay={selectedDay}
          grandTotalLabel={heading}
        />
      )}
    </div>
  )
}

/// The Overdue table, Month mode's own: collapsed by default behind a single
/// summary row — "Overdue · 68 items · Rp 576.677.600" — because a register
/// that has been building up since January is not the reason anybody opened
/// this month's page, and pushing it below the month it was actually asked
/// for is what makes that true on screen as well as in the data.
function OverdueSection({
  rows,
  today,
  expanded,
  onToggle,
  registerRef,
}: {
  rows: readonly ProjectionEntry[]
  today: string
  expanded: boolean
  onToggle: () => void
  registerRef: React.RefObject<HTMLDivElement | null>
}) {
  const total = sumOf(rows)
  return (
    <div ref={registerRef} className="mb-5 scroll-mt-4">
      <Card className="overflow-hidden p-0">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-soft"
        >
          <span className="text-[0.9375rem] font-semibold text-ink">
            Overdue · {rows.length} {rows.length === 1 ? "item" : "items"} ·{" "}
            {money(total)}
          </span>
          <span className="shrink-0 text-[0.875rem] font-medium text-accent">
            {expanded ? "Hide" : "Show"}
          </span>
        </button>
        {expanded && (
          <div className="border-t border-hairline p-3">
            <ProjectionTable rows={rows} today={today} selectedDay={null} />
          </div>
        )}
      </Card>
    </div>
  )
}

/// The table itself — payables first, what is only expected after them,
/// shared by every month's own section and by the collapsed Overdue one.
function ProjectionTable({
  rows,
  today,
  selectedDay,
  grandTotalLabel,
}: {
  rows: readonly ProjectionEntry[]
  today: string
  selectedDay: string | null
  /// When given, a final row sums the whole table under "Total {label}" —
  /// only once there are both a payable and a not-payable half to add
  /// together, since a single subtotal repeated as a grand total says
  /// nothing new.
  grandTotalLabel?: string
}) {
  const payableRows = rows.filter((row) => row.payable)
  const notPayableRows = rows.filter((row) => !row.payable)
  const showGrandTotal =
    grandTotalLabel !== undefined &&
    payableRows.length > 0 &&
    notPayableRows.length > 0
  const phone = useLayout() === "phone"

  if (phone) {
    const cards = (list: readonly ProjectionEntry[], muted: boolean) => (
      <PhoneList
        rows={list.map((row) => {
          const status = statusOf(row, today)
          return {
            key: row.key,
            title: <PartyCell row={row} muted={muted} />,
            code: <WhatCell row={row} muted={muted} />,
            lead: (
              <CardFigure
                value={money(row.amountMinor)}
                tone={!muted && status.tone === "bad" ? "bad" : undefined}
              />
            ),
            foot: (
              <span>
                {day(row.date)}
                {row.estimated && " est."} · {TYPE_LABEL[row.kind]}
              </span>
            ),
            action: (
              <Status tone={muted ? "neutral" : status.tone}>
                {status.label}
              </Status>
            ),
          }
        })}
      />
    )
    const total = (text: string, minor: number) => (
      <p className="flex items-baseline justify-between gap-3 px-1 text-[0.9375rem] font-medium text-ink tabular-nums">
        <span>{text}</span>
        <span>{money(minor)}</span>
      </p>
    )
    return (
      <div className="flex flex-col gap-3">
        {payableRows.length > 0 && (
          <>
            {cards(payableRows, false)}
            {total("Total payable", sumOf(payableRows))}
          </>
        )}
        {notPayableRows.length > 0 && (
          <>
            <h3 className="px-1 text-[0.875rem] text-mute">Not payable yet</h3>
            {cards(notPayableRows, true)}
            {total("Total not payable yet", sumOf(notPayableRows))}
          </>
        )}
        {showGrandTotal && total(`Total ${grandTotalLabel}`, sumOf(rows))}
      </div>
    )
  }

  return (
    <Grid>
      <thead>
        <tr>
          <Th width="7rem">Date</Th>
          <Th>What</Th>
          <Th>Supplier</Th>
          <Th width="7rem">Type</Th>
          <Th width="7rem">Status</Th>
          <Th align="right" width="9.5rem">
            Amount
          </Th>
        </tr>
      </thead>
      <tbody>
        {payableRows.map((row) => (
          <ProjectionRow
            key={row.key}
            row={row}
            today={today}
            highlighted={selectedDay === row.date}
          />
        ))}
        {payableRows.length > 0 && (
          <TotalRow>
            <Td colSpan={5}>Total payable</Td>
            <Td align="right">{money(sumOf(payableRows))}</Td>
          </TotalRow>
        )}
        {notPayableRows.length > 0 && (
          <>
            <tr>
              <Td colSpan={6} className="bg-soft whitespace-normal text-mute">
                Not payable yet
              </Td>
            </tr>
            {notPayableRows.map((row) => (
              <ProjectionRow
                key={row.key}
                row={row}
                today={today}
                highlighted={selectedDay === row.date}
                muted
              />
            ))}
            <tr className="h-11 border-t border-hairline-2 bg-soft [&>td]:border-b-0 [&>td]:py-0 [&>td]:whitespace-nowrap [&>td]:text-mute [&>td]:tabular-nums">
              <Td colSpan={5}>Total not payable yet</Td>
              <Td align="right">{money(sumOf(notPayableRows))}</Td>
            </tr>
          </>
        )}
        {showGrandTotal && (
          <TotalRow>
            <Td colSpan={5}>Total {grandTotalLabel}</Td>
            <Td align="right">{money(sumOf(rows))}</Td>
          </TotalRow>
        )}
      </tbody>
    </Grid>
  )
}

// ---------------------------------------------------------------------------
// The summary strip — `ReportSummary`'s own markup, kept local rather than
// shared: this is the one screen in Finance whose Overdue figure is also a
// button, and a shared component grown an `onClick` only one caller uses is
// a worse trade than a page-local copy of four short lines of JSX.
// ---------------------------------------------------------------------------

interface SummaryTile {
  readonly label: string
  readonly value: number | null | undefined
  readonly indicator?: "Red"
  readonly onClick?: () => void
}

function PeriodSummary({ items }: { items: readonly SummaryTile[] }) {
  return (
    <Card className="mb-3">
      <dl className="grid grid-cols-2 divide-hairline sm:flex sm:divide-x">
        {items.map((item) => {
          const valueCls = cn(
            "mt-1 text-[1.25rem] leading-tight font-semibold tracking-[-0.01em] tabular-nums",
            item.indicator === "Red" ? "text-bad-fg" : "text-ink"
          )
          const body = (
            <>
              <dt className="truncate text-[0.875rem] text-mute">
                {item.label}
              </dt>
              <dd className={valueCls}>
                {item.value === null || item.value === undefined
                  ? "—"
                  : money(item.value)}
              </dd>
            </>
          )
          return item.onClick ? (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              className="min-w-0 flex-1 px-4 py-3.5 text-left hover:bg-soft"
            >
              {body}
            </button>
          ) : (
            <div key={item.label} className="min-w-0 flex-1 px-4 py-3.5">
              {body}
            </div>
          )
        })}
      </dl>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The big month calendar (Month mode) — a filter on the table below it
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const
const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"] as const

interface GridDay {
  readonly iso: string
  readonly date: number
  readonly inMonth: boolean
  readonly weekend: boolean
}

/// A Monday-first month grid, padded with the days either side that share
/// its first and last week — an ordinary wall calendar, not a bare list of
/// the 1st through the 30th.
function gridDaysOf(year: number, month: number): readonly GridDay[] {
  const first = new Date(year, month - 1, 1)
  const last = new Date(year, month, 0)
  // Monday=1 … Sunday=7, so the grid always opens on a Monday.
  const leading = (first.getDay() + 6) % 7
  const trailing = (7 - ((last.getDay() + 6) % 7) - 1) % 7
  const start = new Date(year, month - 1, 1 - leading)
  const days: GridDay[] = []
  const total = leading + last.getDate() + trailing
  for (let i = 0; i < total; i++) {
    const date = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + i
    )
    days.push({
      iso: isoDay(date),
      date: date.getDate(),
      inMonth: date.getMonth() === month - 1 && date.getFullYear() === year,
      weekend: date.getDay() === 0 || date.getDay() === 6,
    })
  }
  return days
}

const compactRupiah = {
  format: (value: number) => moneyCompact(value),
}

/// What a day is tinted on a phone, where seven columns leave no room to
/// write its figure: the busier the day, the darker (the same three steps as
/// the year's little calendars), red where the money is already late.
const PHONE_TINT_ACCENT: Readonly<Record<1 | 2 | 3, string>> = {
  1: "max-md:bg-accent/10",
  2: "max-md:bg-accent/25",
  3: "max-md:bg-accent/45",
}
const PHONE_TINT_BAD: Readonly<Record<1 | 2 | 3, string>> = {
  1: "max-md:bg-bad/10",
  2: "max-md:bg-bad/25",
  3: "max-md:bg-bad/45",
}

function BigMonthCalendar({
  year,
  month,
  today,
  dayTotals,
  selectedDay,
  onSelectDay,
}: {
  year: number
  month: number
  today: string
  dayTotals: ReadonlyMap<string, { total: number; count: number }>
  selectedDay: string | null
  onSelectDay: (iso: string) => void
}) {
  const gridDays = gridDaysOf(year, month)
  const busiest = Math.max(
    0,
    ...Array.from(dayTotals.values(), (cell) => cell.total)
  )
  return (
    <>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="px-1 pb-1.5 text-center text-[0.875rem] font-medium text-mute"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {gridDays.map((cell) => {
          const totals = dayTotals.get(cell.iso)
          // Gated on `inMonth`: a leading or trailing day borrows its date
          // from the adjacent month, and today already gets its ring on
          // that month's own page — a second one on the faint, disabled
          // padding copy just reads as a second today.
          const isToday = cell.inMonth && cell.iso === today
          const pastOpen =
            cell.inMonth && cell.iso < today && totals !== undefined
          const selected = selectedDay === cell.iso
          return (
            <button
              key={cell.iso}
              type="button"
              disabled={!cell.inMonth}
              onClick={() => onSelectDay(cell.iso)}
              className={cn(
                "flex min-h-[4.375rem] flex-col items-start gap-0.5 rounded-inner border px-2 py-1.5 text-left transition-colors",
                "max-md:min-h-11 max-md:items-center max-md:justify-center max-md:px-0",
                cell.inMonth
                  ? "border-hairline bg-canvas hover:bg-soft"
                  : "border-transparent bg-transparent",
                cell.inMonth &&
                  totals !== undefined &&
                  (pastOpen ? PHONE_TINT_BAD : PHONE_TINT_ACCENT)[
                    tierOf(totals.total, busiest)
                  ],
                isToday && "border-accent",
                selected && "border-accent bg-soft-2"
              )}
            >
              <span
                className={cn(
                  "text-[0.875rem] tabular-nums",
                  !cell.inMonth && "text-faint",
                  cell.inMonth && !pastOpen && cell.weekend && "text-mute",
                  cell.inMonth && !pastOpen && !cell.weekend && "text-ink",
                  pastOpen && "font-medium text-bad-fg"
                )}
              >
                {cell.date}
              </span>
              {totals !== undefined && (
                <>
                  <span
                    className={cn(
                      "text-[0.875rem] font-medium tabular-nums max-md:hidden",
                      pastOpen ? "text-bad-fg" : "text-ink"
                    )}
                  >
                    {compactRupiah.format(totals.total)}
                  </span>
                  <span className="text-[0.875rem] text-mute max-md:hidden">
                    {totals.count} {totals.count === 1 ? "item" : "items"}
                  </span>
                </>
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// The year grid (Year mode) — twelve small calendars, a filter each
// ---------------------------------------------------------------------------

function YearGrid({
  year,
  rows,
  today,
  onSelectMonth,
  onSelectDay,
}: {
  year: number
  rows: readonly ProjectionEntry[]
  today: string
  onSelectMonth: (month: number) => void
  onSelectDay: (month: number, iso: string) => void
}) {
  // Twelve calendars of seven 24px days do not fit two to a row on a phone,
  // and their figures are 10–11px: a phone gets the twelve months as the
  // cards every list is, each opening that month.
  if (useLayout() === "phone") {
    return (
      <PhoneList
        rows={Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
          const key = keyOf(year, month)
          const monthRows = rows.filter((row) => row.date.slice(0, 7) === key)
          const notPayable = sumOf(monthRows.filter((row) => !row.payable))
          return {
            key,
            title: monthLabel(year, month),
            lead: money(sumOf(monthRows.filter((row) => row.payable))),
            foot: (
              <span className="tabular-nums">
                {count(monthRows.length)}{" "}
                {monthRows.length === 1 ? "item" : "items"}
                {notPayable > 0 && ` · not payable yet ${money(notPayable)}`}
              </span>
            ),
            onOpen: () => onSelectMonth(month),
          }
        })}
      />
    )
  }
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
        const key = keyOf(year, month)
        const monthRows = rows.filter((row) => row.date.slice(0, 7) === key)
        return (
          <MiniMonthCard
            key={month}
            year={year}
            month={month}
            rows={monthRows}
            today={today}
            onSelectMonth={() => onSelectMonth(month)}
            onSelectDay={(iso) => onSelectDay(month, iso)}
          />
        )
      })}
    </div>
  )
}

function MiniMonthCard({
  year,
  month,
  rows,
  today,
  onSelectMonth,
  onSelectDay,
}: {
  year: number
  month: number
  rows: readonly ProjectionEntry[]
  today: string
  onSelectMonth: () => void
  onSelectDay: (iso: string) => void
}) {
  const gridDays = gridDaysOf(year, month)
  const dayTotals = dayTotalsOf(rows)
  const maxDayTotal = Math.max(
    0,
    ...Array.from(dayTotals.values(), (cell) => cell.total)
  )
  const payable = sumOf(rows.filter((row) => row.payable))
  const notPayable = sumOf(rows.filter((row) => !row.payable))

  return (
    <div className="rounded-card border border-hairline bg-canvas p-2">
      <button
        type="button"
        onClick={onSelectMonth}
        className="mb-1 block w-full truncate text-left text-[0.875rem] font-medium text-ink hover:text-accent"
      >
        {monthLabel(year, month)}
      </button>
      <div className="mb-1.5 text-[0.875rem] tabular-nums">
        <span className="text-ink">{compactRupiah.format(payable)}</span>
        {notPayable > 0 && (
          <span className="text-mute">
            {" "}
            · {compactRupiah.format(notPayable)}
          </span>
        )}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAY_INITIALS.map((label, index) => (
          <div key={index} className="text-center text-[0.875rem] text-mute">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {gridDays.map((cell) => {
          const totals = dayTotals.get(cell.iso)
          const hasItem = totals !== undefined && totals.total > 0
          // Open money sitting in the past is a debt this month is late on,
          // not merely an amount — the bad tone, not the accent, carries it.
          const overdueDay = cell.inMonth && hasItem && cell.iso < today
          const tint =
            cell.inMonth && hasItem && totals !== undefined
              ? (overdueDay ? TINT_BAD : TINT_ACCENT)[
                  tierOf(totals.total, maxDayTotal)
                ]
              : undefined
          // Gated on `inMonth` for the same reason the big calendar is: a
          // leading or trailing day borrows its date from the neighbouring
          // month, whose own card already carries today's ring.
          const isToday = cell.inMonth && cell.iso === today
          return (
            <button
              key={cell.iso}
              type="button"
              disabled={!cell.inMonth}
              onClick={() => onSelectDay(cell.iso)}
              title={
                hasItem && totals !== undefined
                  ? money(totals.total)
                  : undefined
              }
              className={cn(
                "flex size-6 items-center justify-center rounded-full border border-transparent transition-colors",
                tint,
                isToday && "border-accent"
              )}
            >
              <span
                className={cn(
                  "text-[0.875rem] tabular-nums",
                  !cell.inMonth && "text-faint",
                  cell.inMonth && !hasItem && cell.weekend && "text-mute",
                  cell.inMonth && !hasItem && !cell.weekend && "text-ink",
                  cell.inMonth &&
                    hasItem &&
                    (overdueDay ? "font-medium text-bad-fg" : "text-ink")
                )}
              >
                {cell.date}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/// Three steps, not a continuous gradient — a mini calendar is read at a
/// glance, and a scale fine enough to need a legend is a scale nobody reads
/// without one.
function tierOf(amount: number, max: number): 1 | 2 | 3 {
  if (max <= 0) return 1
  const ratio = amount / max
  if (ratio <= 1 / 3) return 1
  if (ratio <= 2 / 3) return 2
  return 3
}

const TINT_ACCENT: Readonly<Record<1 | 2 | 3, string>> = {
  1: "bg-accent/10",
  2: "bg-accent/25",
  3: "bg-accent/45",
}
const TINT_BAD: Readonly<Record<1 | 2 | 3, string>> = {
  1: "bg-bad/10",
  2: "bg-bad/25",
  3: "bg-bad/45",
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type ProjectionKind =
  "bill" | "draft" | "giro" | "recurring" | "unbilled" | "ordered"

interface ProjectionEntry {
  readonly key: string
  /// `YYYY-MM-DD` — the day the money is due to leave: a bill's `due_date`,
  /// a giro's own `due_date` (the day the bank takes it), a recurring
  /// template's `due_day` projected into its own month, or, for the two
  /// estimated kinds, a delivery date plus a supplier's payment term.
  readonly date: string
  readonly kind: ProjectionKind
  /// A real payable (a posted bill, a giro) versus money the business only
  /// expects to owe — a draft, a recurring promise, a delivery not yet
  /// billed, an order not yet received.
  readonly payable: boolean
  /// The date is a guess, not a document's own field — draws "est." beside
  /// it.
  readonly estimated: boolean
  readonly whatLabel: string
  readonly link?: {
    readonly to: string
    readonly sheet?: { readonly key: "bill"; readonly value: string }
  }
  readonly supplierId: string | null
  readonly supplierName: string | null
  readonly amountMinor: number
}

const TYPE_LABEL: Readonly<Record<ProjectionKind, string>> = {
  bill: "Bill",
  draft: "Draft",
  giro: "Giro",
  recurring: "Recurring",
  unbilled: "Received, not billed",
  ordered: "Ordered",
}

function sumOf(rows: readonly ProjectionEntry[]): number {
  return rows.reduce((total, row) => total + row.amountMinor, 0)
}

function statusOf(
  row: ProjectionEntry,
  today: string
): { label: string; tone: "bad" | "neutral" } {
  if (row.kind === "draft") return { label: "Draft", tone: "neutral" }
  if (row.kind === "recurring") return { label: "Expected", tone: "neutral" }
  if (row.kind === "unbilled" || row.kind === "ordered") {
    return { label: "Estimated", tone: "neutral" }
  }
  return row.date < today
    ? { label: "Overdue", tone: "bad" }
    : { label: "Due", tone: "neutral" }
}

function ProjectionRow({
  row,
  today,
  highlighted,
  muted,
}: {
  row: ProjectionEntry
  today: string
  highlighted: boolean
  muted?: boolean
}) {
  const status = statusOf(row, today)
  const dim = muted === true ? "text-mute" : undefined
  return (
    <tr className={cn(highlighted && "bg-soft-2")}>
      <Td className={cn("whitespace-nowrap", dim)}>
        {day(row.date)}
        {row.estimated && <span className="text-mute"> est.</span>}
      </Td>
      <Td className={dim}>
        <WhatCell row={row} muted={muted === true} />
      </Td>
      <Td className={dim}>
        <PartyCell row={row} muted={muted === true} />
      </Td>
      <Td className={dim}>{TYPE_LABEL[row.kind]}</Td>
      <Td className={dim}>
        <Status tone={muted === true ? "neutral" : status.tone}>
          {status.label}
        </Status>
      </Td>
      <Td align="right" className={dim}>
        {money(row.amountMinor)}
      </Td>
    </tr>
  )
}

function WhatCell({ row, muted }: { row: ProjectionEntry; muted: boolean }) {
  if (
    row.kind === "recurring" ||
    row.kind === "unbilled" ||
    row.kind === "ordered"
  ) {
    return (
      <span className={muted ? "text-mute" : "text-ink"}>{row.whatLabel}</span>
    )
  }
  if (row.link === undefined) return <Code>{row.whatLabel}</Code>
  return (
    <AppLink
      to={row.link.to}
      sheet={row.link.sheet}
      className="font-mono text-[0.875rem] text-mute hover:text-accent hover:underline"
    >
      {row.whatLabel}
    </AppLink>
  )
}

function PartyCell({ row, muted }: { row: ProjectionEntry; muted: boolean }) {
  const nameOf = useSupplierName()
  if (row.supplierId !== null) {
    return (
      <SupplierName
        id={row.supplierId}
        name={row.supplierName}
        className={muted ? "text-mute" : "text-ink"}
      />
    )
  }
  if (row.supplierName !== null) {
    return (
      <span className={muted ? "text-mute" : "text-ink"}>
        {nameOf(null, row.supplierName)}
      </span>
    )
  }
  return <span className="text-faint">—</span>
}

interface ExportRow extends ProjectionEntry {
  readonly monthText: string
}
