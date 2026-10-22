import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { DayRange, type DayWindow } from "@/components/ui/day-range"
import { Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { BarSpacer, ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { Thumbnail } from "@/components/ui/thumbnail"
import { today } from "@/lib/calendar"
import { count, dayMonth, label as humanise, sku as skuNumber } from "@/lib/format"
import {
  stockCardLinesQuery,
  stockCardQuery,
  type StockCardFigures,
  type StockCardLine,
  type StockCardRow,
} from "@/lib/queries/inventory"
import { unitsQuery } from "@/lib/queries/organisation"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import { ITEMS_CELL, ITEMS_HEAD } from "@/screens/procurement/items-table"
import { shortRef } from "@/screens/inventory/missing-data"

/// The stock card (kartu stok), in place of Movements (owner, 16 Oct 2026:
/// "inventory atau log?" — Inventory reads the card; the log is its
/// evidence). The pair ERPNext calls Stock Balance and Stock Ledger, on one
/// page: first the period's equation per place (or per SKU) —
/// Opening · In · Out · Sold · Lost · Closing — then, opened, one place's card
/// with the balance after every line. Missing stays inside Inventory; only
/// pieces declared lost leave it.
///
/// Stock (`/inventory`) answers "how much is there now, and can it be
/// trusted"; this answers "how did it get there". Closing on the last day is
/// the stock on hand that day.

type Way = "place" | "sku"

const WAYS: readonly { value: Way; label: string }[] = [
  { value: "place", label: "By Place" },
  { value: "sku", label: "By SKU" },
]

type FigureKey = keyof StockCardFigures

/// A figure, tolerating a server that has not sent `lost` yet.
const figure = (figures: StockCardFigures, key: FigureKey): number =>
  figures[key] ?? 0

/// The period's columns, in the order the equation reads.
const COLUMNS: readonly {
  key: FigureKey
  label: string
  /// Off a phone's table; the card's KPIs still say it.
  wide?: boolean
}[] = [
  { key: "opening", label: "Opening", wide: true },
  { key: "received", label: "In" },
  { key: "sent_out", label: "Out", wide: true },
  { key: "sold", label: "Sold" },
  { key: "lost", label: "Lost", wide: true },
  { key: "closing", label: "Closing" },
]

/// What a posting was, in a store's words.
const ACTION: Record<string, string> = {
  OPENING: "Opening stock",
  STORE_RECEIVE: "Received",
  NORMAL_MOVE: "Moved",
  SALE: "Sold",
  CUSTOMER_RETURN: "Customer return",
  RETURN_TO_WAREHOUSE: "Back to HO",
  RETURN_TO_DC: "Back to HO",
  SUPPLIER_RETURN: "Back to supplier",
  COUNT_SHORTAGE: "Count short",
  COUNT_GAIN: "Count over",
  FOUND: "Found",
  CONFIRMED_LOST: "Lost",
  DISPOSAL: "Disposed",
  PLACEMENT_CORRECTION: "Corrected",
  IDENTIFICATION: "Set up",
  TAGGING: "Tagged",
}

const actionOf = (cause: string) => ACTION[cause] ?? humanise(cause)

/// The document a line names, in words.
function documentOf(line: StockCardLine): string {
  if (line.cause === "SALE")
    return `${count(line.groups)} ${line.groups === 1 ? "receipt" : "receipts"}`
  if (line.reference_type === "OFFICIAL_COUNT") return "Count"
  return shortRef(line.reference_id ?? null) ?? "—"
}

/// This month so far: the window the page opens on.
function thisMonth(): DayWindow {
  const now = today()
  return { from: `${now.slice(0, 8)}01`, to: now }
}

/// A window with both ends: an open end reads as the month's first day or
/// today, because a card has to start and stop somewhere.
function closed(picked: DayWindow): { from: string; to: string } {
  const to = picked.to !== "" ? picked.to : today()
  const from = picked.from !== "" ? picked.from : `${to.slice(0, 8)}01`
  return { from, to }
}

function signed(value: number): string {
  return value > 0 ? `+${count(value)}` : value < 0 ? `−${count(-value)}` : "0"
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/// By Place | By SKU as the same tabs a purchase order list has.
function WaySwitch({
  value,
  onChange,
}: {
  value: Way
  onChange: (next: Way) => void
}) {
  return (
    <SubTabs
      tabs={WAYS.map((way) => ({ value: way.value, label: way.label }))}
      value={value}
      onChange={(next) => onChange(next as Way)}
    />
  )
}

/// The six figures as one row of KPIs.
function FigureStrip({ figures }: { figures: StockCardFigures }) {
  return (
    <KpiStrip className="mb-2! grid-cols-2 md:grid-cols-6 xl:grid-cols-6">
      {COLUMNS.map((column) => (
        <Kpi
          key={column.key}
          label={column.label}
          value={
            <span
              className={cn(
                column.key === "lost" && figure(figures, "lost") > 0 && "text-bad-fg"
              )}
            >
              {count(figure(figures, column.key))}
            </span>
          }
        />
      ))}
    </KpiStrip>
  )
}

/// A row's figure cells. Flows that did not happen are a quiet dash, Lost
/// is red while it is more than nothing, Closing is the row's answer.
function FigureCells({ figures }: { figures: StockCardFigures }) {
  return (
    <>
      {COLUMNS.map((column) => {
        const value = figure(figures, column.key)
        const flow = column.key !== "opening" && column.key !== "closing"
        return (
          <td
            key={column.key}
            className={cn(
              ITEMS_CELL,
              "text-right whitespace-nowrap tabular-nums",
              column.wide && "max-md:hidden",
              column.key === "closing" ? "font-semibold text-ink" : "text-ink",
              column.key === "lost" && value > 0 && "text-bad-fg"
            )}
          >
            {flow && value === 0 ? (
              <span className="text-mute">—</span>
            ) : (
              count(value)
            )}
          </td>
        )
      })}
    </>
  )
}

function FigureHead({ first }: { first: string }) {
  return (
    <thead>
      <tr>
        <th className={cn(ITEMS_HEAD, "text-left")}>{first}</th>
        {COLUMNS.map((column) => (
          <th
            key={column.key}
            className={cn(
              ITEMS_HEAD,
              "text-right",
              column.wide && "max-md:hidden"
            )}
          >
            {column.label}
          </th>
        ))}
      </tr>
    </thead>
  )
}

function FigureCols() {
  return (
    <colgroup>
      <col />
      {COLUMNS.map((column) => (
        <col
          key={column.key}
          className={cn(
            "w-[7.5rem] max-lg:w-[6rem]",
            column.wide && "max-md:hidden",
            "max-md:w-[4.75rem]"
          )}
        />
      ))}
    </colgroup>
  )
}

/// Site id → the unit's name and code, the words the Stock page uses.
function useSiteNames() {
  const units = useQuery(unitsQuery())
  return useMemo(() => {
    const names = new Map<string, { name: string; sub: string }>()
    for (const unit of units.data ?? []) {
      for (const site of unit.sites) {
        names.set(site.id, {
          name: unit.name,
          sub: unit.kind === "HO" ? "HO" : `Store · ${unit.code}`,
        })
      }
    }
    return names
  }, [units.data])
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function StockCard() {
  const [way, setWay] = useState<Way>("place")
  const [range, setRange] = useState<DayWindow>(thisMonth)
  const [opened, setOpened] = useState<Opened | null>(null)
  const period = closed(range)
  const switcher = (
    <WaySwitch
      value={way}
      onChange={(next) => {
        setWay(next)
        setOpened(null)
      }}
    />
  )

  return (
    <PageContent>
      <PageHeader title="Stock card" small />
      {way === "place" ? (
        <ByStore
          range={range}
          onRange={setRange}
          period={period}
          onOpen={setOpened}
          switcher={switcher}
        />
      ) : (
        <BySku
          range={range}
          onRange={setRange}
          period={period}
          onOpen={setOpened}
          switcher={switcher}
        />
      )}
      {opened !== null && way === "place" && (
        <StoreCard
          site={opened}
          period={period}
          onClose={() => setOpened(null)}
        />
      )}
      {opened !== null && way === "sku" && (
        <SkuCard
          sku={opened}
          period={period}
          onClose={() => setOpened(null)}
        />
      )}
    </PageContent>
  )
}

type Period = { from: string; to: string }
type Opened = { key: string; label: string; sub: string | null }

function PeriodBox({
  range,
  onRange,
}: {
  range: DayWindow
  onRange: (next: DayWindow) => void
}) {
  return (
    <DayRange
      label="Period"
      placeholder="Period"
      value={range}
      onChange={onRange}
      className="h-control min-h-0 w-52 shrink-0 py-0"
    />
  )
}

/// The one filter bar: search, and the period beside it.
function FilterBar({
  typed,
  onTyped,
  label,
  range,
  onRange,
}: {
  typed: string
  onTyped: (next: string) => void
  label: string
  range: DayWindow
  onRange: (next: DayWindow) => void
}) {
  return (
    <div className="group/bar mb-3 flex flex-wrap items-center gap-2">
      <ExpandingSearch value={typed} onChange={onTyped} label={label} />
      <PeriodBox range={range} onRange={onRange} />
      <BarSpacer />
    </div>
  )
}

function ByStore({
  range,
  onRange,
  period,
  onOpen,
  switcher,
}: {
  range: DayWindow
  onRange: (next: DayWindow) => void
  period: Period
  onOpen: (opened: Opened) => void
  switcher: React.ReactNode
}) {
  const names = useSiteNames()
  const [typed, setTyped] = useState("")
  const page = useQuery(stockCardQuery({ ...period, by: "site" }))
  const label = (row: StockCardRow) => names.get(row.key)?.name ?? row.label
  const sub = (row: StockCardRow) =>
    names.get(row.key)?.sub ?? (row.sub === "HO" ? "HO" : "Store")
  const needle = typed.trim().toLowerCase()
  // HO is a row like any other place; it is found by "HO" as well as by name.
  const rows = (page.data?.rows ?? []).filter(
    (row) =>
      needle === "" ||
      `${label(row)} ${sub(row)}`.toLowerCase().includes(needle)
  )

  return (
    <>
      {page.data && <FigureStrip figures={page.data.total} />}
      {switcher}
      <FilterBar
        typed={typed}
        onTyped={setTyped}
        label="Search article, SKU or place"
        range={range}
        onRange={onRange}
      />
      {page.isPending ? (
        <LoadingState>Reading the stock card…</LoadingState>
      ) : page.isError ? (
        <EmptyState>The stock card could not be read.</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>No place matches.</EmptyState>
      ) : (
        <div className="items-box overflow-hidden rounded-inner border border-hairline">
          <table className="w-full table-fixed border-collapse">
            <FigureCols />
            <FigureHead first="Place" />
            <tbody className="[&>tr:first-child>td]:border-t-0">
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className="cursor-pointer transition-colors hover:bg-soft"
                  onClick={() =>
                    onOpen({ key: row.key, label: label(row), sub: sub(row) })
                  }
                >
                  <td className={ITEMS_CELL}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-ink">{label(row)}</span>
                      <span className="truncate text-[0.9375rem] text-mute">
                        {sub(row)}
                      </span>
                    </span>
                  </td>
                  <FigureCells figures={row.figures} />
                </tr>
              ))}
              {page.data && needle === "" && (
                <tr className="bg-soft font-medium">
                  <td className={cn(ITEMS_CELL, "text-ink")}>All places</td>
                  <FigureCells figures={page.data.total} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

const SKU_PAGE = 50

/// A SKU row's words: "Article · Variant" and its code, falling back to the
/// article's own label and code while the server sends no SKU fields.
function skuWords(row: StockCardRow): { name: string; code: string } {
  const article = row.article_name ?? row.label
  const variant = row.variant ?? row.variant_label ?? null
  return {
    name: variant ? `${article} · ${variant}` : article,
    code: row.sku_code ? skuNumber(row.sku_code) : (row.sub ?? ""),
  }
}

function BySku({
  range,
  onRange,
  period,
  onOpen,
  switcher,
}: {
  range: DayWindow
  onRange: (next: DayWindow) => void
  period: Period
  onOpen: (opened: Opened) => void
  switcher: React.ReactNode
}) {
  const [typed, setTyped] = useState("")
  const [offset, setOffset] = useState(0)
  const needle = useDebounced(typed.trim(), 300)
  const page = useQuery(
    stockCardQuery({
      ...period,
      by: "sku",
      q: needle === "" ? undefined : needle,
      limit: SKU_PAGE,
      offset,
    })
  )
  const rows = page.data?.rows ?? []
  const total = page.data?.row_count ?? 0

  return (
    <>
      {page.data && <FigureStrip figures={page.data.total} />}
      {switcher}
      <FilterBar
        typed={typed}
        onTyped={(next) => {
          setTyped(next)
          setOffset(0)
        }}
        label="Search article, SKU or place"
        range={range}
        onRange={onRange}
      />
      {page.isPending ? (
        <LoadingState>Reading the stock card…</LoadingState>
      ) : rows.length === 0 ? (
        <EmptyState>
          {needle === "" ? "Nothing moved in this period." : "No SKU matches."}
        </EmptyState>
      ) : (
        <>
          <div className="items-box overflow-hidden rounded-inner border border-hairline">
            <table className="w-full table-fixed border-collapse">
              <FigureCols />
              <FigureHead first="SKU" />
              <tbody className="[&>tr:first-child>td]:border-t-0">
                {rows.map((row, at) => {
                  const words = skuWords(row)
                  return (
                    <tr
                      key={row.sku_id ?? row.key}
                      className="cursor-pointer transition-colors hover:bg-soft"
                      onClick={() =>
                        onOpen({
                          key: row.sku_id ?? row.key,
                          label: words.name,
                          sub: words.code,
                        })
                      }
                    >
                      <td className={ITEMS_CELL}>
                        <div className="flex min-w-0 items-center gap-3">
                          <Thumbnail
                            url={row.photo_url ?? null}
                            name={row.article_name ?? row.label}
                            division={null}
                            fallback="—"
                            className="size-10 shrink-0 rounded-inner"
                            eager={at < 24}
                          />
                          <span className="flex min-w-0 flex-col">
                            <span className="line-clamp-2 text-ink">
                              {words.name}
                            </span>
                            <span className="truncate text-[0.9375rem] text-mute">
                              {words.code}
                            </span>
                          </span>
                        </div>
                      </td>
                      <FigureCells figures={row.figures} />
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 py-3 text-[0.9375rem] text-mute">
            <span className="tabular-nums">
              {count(offset + 1)}–{count(offset + rows.length)} of{" "}
              {count(total)}
            </span>
            <span className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - SKU_PAGE))}
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={offset + rows.length >= total}
                onClick={() => setOffset(offset + SKU_PAGE)}
              >
                Next
              </Button>
            </span>
          </div>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/// Opening balance, every line with the balance after it, closing balance.
function Ledger({
  period,
  site,
  article,
  sku,
}: {
  period: Period
  site?: string
  article?: string
  sku?: string
}) {
  const lines = useQuery(
    stockCardLinesQuery({
      ...period,
      site_id: site,
      article_id: article,
      sku_id: sku,
    })
  )
  if (lines.isPending) return <LoadingState>Reading the card…</LoadingState>
  if (lines.isError || lines.data === undefined)
    return <EmptyState>The card could not be read.</EmptyState>
  const data = lines.data
  return (
    <div className="items-box overflow-hidden rounded-inner border border-hairline">
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[6.5rem] max-md:w-[5rem]" />
          <col />
          <col className="w-[11rem] max-md:hidden" />
          <col className="w-[6.5rem] max-md:w-[4.5rem]" />
          <col className="w-[7rem] max-md:w-[5rem]" />
        </colgroup>
        <thead>
          <tr>
            <th className={cn(ITEMS_HEAD, "text-left")}>Date</th>
            <th className={cn(ITEMS_HEAD, "text-left")}>What</th>
            <th className={cn(ITEMS_HEAD, "text-left max-md:hidden")}>
              Document
            </th>
            <th className={cn(ITEMS_HEAD, "text-right")}>Pieces</th>
            <th className={cn(ITEMS_HEAD, "text-right")}>Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-soft">
            <td className="px-4 py-3 text-mute tabular-nums">
              {dayMonth(period.from)}
            </td>
            <td className="px-4 py-3 font-medium text-ink" colSpan={3}>
              Opening balance
            </td>
            <td className="px-4 py-3 text-right font-medium text-ink tabular-nums">
              {count(data.figures.opening)}
            </td>
          </tr>
          {data.lines.map((line, index) => (
            <tr
              key={`${line.at}-${index}`}
              className={cn(line.to_missing && "bg-bad-bg")}
            >
              <td
                className={cn(
                  ITEMS_CELL,
                  "whitespace-nowrap text-mute tabular-nums"
                )}
              >
                {dayMonth(line.at)}
              </td>
              <td className={ITEMS_CELL}>
                <span className="flex min-w-0 flex-col">
                  <span
                    className={cn(
                      "truncate",
                      line.to_missing ? "text-bad-fg" : "text-ink"
                    )}
                  >
                    {line.to_missing
                      ? `Went missing · ${line.from_pocket ?? "Stock"} → Missing`
                      : actionOf(line.cause)}
                  </span>
                  <span className="truncate text-[0.9375rem] text-mute md:hidden">
                    {documentOf(line)}
                  </span>
                </span>
              </td>
              <td
                className={cn(ITEMS_CELL, "truncate text-mute max-md:hidden")}
              >
                {documentOf(line)}
              </td>
              <td
                className={cn(
                  ITEMS_CELL,
                  "text-right whitespace-nowrap tabular-nums",
                  line.to_missing ? "text-bad-fg" : "text-ink"
                )}
              >
                {line.to_missing ? "0" : signed(line.pieces)}
              </td>
              <td
                className={cn(
                  ITEMS_CELL,
                  "text-right font-medium whitespace-nowrap text-ink tabular-nums"
                )}
              >
                {count(line.balance)}
              </td>
            </tr>
          ))}
          <tr className="border-t border-hairline bg-soft">
            <td className="px-4 py-3 text-mute tabular-nums">
              {dayMonth(period.to)}
            </td>
            <td className="px-4 py-3 font-semibold text-ink" colSpan={3}>
              Closing balance
            </td>
            <td className="px-4 py-3 text-right font-semibold text-ink tabular-nums">
              {count(data.figures.closing)}
            </td>
          </tr>
        </tbody>
      </table>
      {data.lines.length === 0 && (
        <p className="border-t border-hairline px-4 py-6 text-center text-[0.9375rem] text-mute">
          Nothing moved in this period.
        </p>
      )}
    </div>
  )
}

/// One place's card inside another sheet — the Stock page's place sheet: the
/// period box and the lines (owner, 16 Oct 2026: the tab and this page show
/// the same card).
export function PlaceStockCard({ site }: { site: string }) {
  const [range, setRange] = useState<DayWindow>(thisMonth)
  const period = closed(range)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodBox range={range} onRange={setRange} />
      </div>
      <Ledger period={period} site={site} />
    </div>
  )
}

function periodWords(period: Period): string {
  return `${dayMonth(period.from)} – ${dayMonth(period.to)}`
}

/// One store's card: its figures, an article to narrow it to, the lines.
function StoreCard({
  site,
  period,
  onClose,
}: {
  site: Opened
  period: Period
  onClose: () => void
}) {
  const [article, setArticle] = useState("")
  const figures = useQuery(
    stockCardQuery({
      ...period,
      by: article === "" ? "site" : "article",
      site_id: article === "" ? undefined : site.key,
      article_id: article === "" ? undefined : article,
      limit: 1,
    })
  )
  // The articles that moved here in the period, for the narrowing select.
  const articles = useQuery(
    stockCardQuery({ ...period, by: "article", site_id: site.key, limit: 200 })
  )
  const shown =
    article === ""
      ? figures.data?.rows.find((row) => row.key === site.key)?.figures
      : figures.data?.rows[0]?.figures

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      context="Stock card"
      id={periodWords(period)}
      title={site.label}
      width="wide"
    >
      <div className="flex flex-col gap-6">
        {shown && <FigureStrip figures={shown} />}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={article}
            onChange={setArticle}
            aria-label="Article"
            className="w-72 max-md:w-full"
          >
            <option value="">All articles</option>
            {(articles.data?.rows ?? []).map((row) => (
              <option key={row.key} value={row.key}>
                {row.label}
              </option>
            ))}
          </Select>
        </div>
        <Ledger
          period={period}
          site={site.key}
          article={article === "" ? undefined : article}
        />
      </div>
    </Sheet>
  )
}

/// One SKU: where it is, place by place; a place opens its card below.
function SkuCard({
  sku,
  period,
  onClose,
}: {
  sku: Opened
  period: Period
  onClose: () => void
}) {
  const names = useSiteNames()
  const where = useQuery(
    stockCardQuery({ ...period, by: "site", sku_id: sku.key })
  )
  const rows = (where.data?.rows ?? []).filter((row) =>
    Object.values(row.figures).some((value) => value !== 0)
  )
  const [picked, setPicked] = useState<string | null>(null)
  const site =
    picked ??
    rows.find((row) => row.figures.closing > 0)?.key ??
    rows[0]?.key ??
    null
  const label = (key: string, fallback: string) =>
    names.get(key)?.name ?? fallback

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      context="Stock card"
      id={periodWords(period)}
      title={sku.label}
      caption={sku.sub ?? undefined}
      width="wide"
    >
      <div className="flex flex-col gap-6">
        {where.data && <FigureStrip figures={where.data.total} />}
        <section className="flex flex-col gap-2">
          <h3 className="text-[0.9375rem] font-semibold text-ink">
            Where it is
          </h3>
          {where.isPending ? (
            <LoadingState>Reading…</LoadingState>
          ) : rows.length === 0 ? (
            <EmptyState>Nothing moved in this period.</EmptyState>
          ) : (
            <div className="items-box overflow-hidden rounded-inner border border-hairline">
              <table className="w-full table-fixed border-collapse">
                <FigureCols />
                <FigureHead first="Place" />
                <tbody className="[&>tr:first-child>td]:border-t-0">
                  {rows.map((row) => (
                    <tr
                      key={row.key}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-soft",
                        row.key === site && "bg-accent-bg hover:bg-accent-bg"
                      )}
                      onClick={() => setPicked(row.key)}
                    >
                      <td className={cn(ITEMS_CELL, "truncate text-ink")}>
                        {label(row.key, row.label)}
                      </td>
                      <FigureCells figures={row.figures} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {site !== null && (
          <section className="flex flex-col gap-2">
            <h3 className="text-[0.9375rem] font-semibold text-ink">
              Stock card · {label(site, site)}
            </h3>
            <Ledger period={period} site={site} sku={sku.key} />
          </section>
        )}
      </div>
    </Sheet>
  )
}
