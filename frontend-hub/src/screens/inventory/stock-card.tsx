import { useQuery } from "@tanstack/react-query"
import { Shirt, Store, type LucideIcon } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { DayRange, type DayWindow } from "@/components/ui/day-range"
import { Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { BarSpacer, ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { today } from "@/lib/calendar"
import { count, dayMonth, label as humanise } from "@/lib/format"
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
import {
  ITEMS_CELL,
  ITEMS_HEAD,
  ItemIdentity,
} from "@/screens/procurement/items-table"

/// The stock card (kartu stok), in place of Movements (owner, 16 Oct 2026:
/// "inventory atau log?" — Inventory reads the card; the log is its
/// evidence). The pair ERPNext calls Stock Balance and Stock Ledger, on one
/// page: first the period's equation per store (or per article) —
/// Opening · Received · Sent out · Sold · Missing · Closing — then, opened,
/// one place's card with the balance after every line.
///
/// Stock (`/inventory`) answers "how much is there now, and can it be
/// trusted"; this answers "how did it get there". Closing on the last day is
/// the stock on hand that day.

type Way = "store" | "article"

const WAYS: readonly { value: Way; label: string; icon: LucideIcon }[] = [
  { value: "store", label: "By store", icon: Store },
  { value: "article", label: "By article", icon: Shirt },
]

/// The period's columns, in the order the equation reads.
const COLUMNS: readonly {
  key: keyof StockCardFigures
  label: string
  /// Off a phone's table; the card's KPIs still say it.
  wide?: boolean
}[] = [
  { key: "opening", label: "Opening", wide: true },
  { key: "received", label: "Received" },
  { key: "sent_out", label: "Sent out", wide: true },
  { key: "sold", label: "Sold" },
  { key: "missing", label: "Missing", wide: true },
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
  CONFIRMED_LOST: "Written off",
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
  return line.reference_id ?? "—"
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

/// Two big buttons where tabs would be: the icon over its name, the chosen one
/// marked (owner, 16 Oct 2026).
function WaySwitch({
  value,
  onChange,
}: {
  value: Way
  onChange: (next: Way) => void
}) {
  return (
    <div
      role="tablist"
      className="mb-4 grid grid-cols-2 gap-3 md:max-w-[22rem]"
    >
      {WAYS.map((way) => {
        const on = way.value === value
        const Icon = way.icon
        return (
          <button
            key={way.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(way.value)}
            className={cn(
              "flex flex-col items-center gap-2 rounded-card border px-3 py-3.5 text-[0.9375rem] transition-[border-color,background-color,color,scale] duration-150 ease-(--ease-out) active:scale-[0.97]",
              on
                ? "border-accent bg-accent-bg font-medium text-accent"
                : "border-hairline bg-canvas text-body hover:border-hairline-strong hover:text-ink"
            )}
          >
            <Icon className="size-6" strokeWidth={1.6} />
            {way.label}
          </button>
        )
      })}
    </div>
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
                column.key === "missing" && figures.missing > 0 && "text-bad-fg"
              )}
            >
              {count(figures[column.key])}
            </span>
          }
        />
      ))}
    </KpiStrip>
  )
}

/// A row's figure cells. Flows that did not happen are a quiet dash, Missing
/// is red while it is more than nothing, Closing is the row's answer.
function FigureCells({ figures }: { figures: StockCardFigures }) {
  return (
    <>
      {COLUMNS.map((column) => {
        const value = figures[column.key]
        const flow = column.key !== "opening" && column.key !== "closing"
        return (
          <td
            key={column.key}
            className={cn(
              ITEMS_CELL,
              "text-right whitespace-nowrap tabular-nums",
              column.wide && "max-md:hidden",
              column.key === "closing" ? "font-semibold text-ink" : "text-ink",
              column.key === "missing" && value > 0 && "text-bad-fg"
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
  const [way, setWay] = useState<Way>("store")
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
      {way === "store" ? (
        <ByStore
          range={range}
          onRange={setRange}
          period={period}
          onOpen={setOpened}
          switcher={switcher}
        />
      ) : (
        <ByArticle
          range={range}
          onRange={setRange}
          period={period}
          onOpen={setOpened}
          switcher={switcher}
        />
      )}
      {opened !== null && way === "store" && (
        <StoreCard
          site={opened}
          period={period}
          onClose={() => setOpened(null)}
        />
      )}
      {opened !== null && way === "article" && (
        <ArticleCard
          article={opened}
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
  const page = useQuery(stockCardQuery({ ...period, by: "site" }))
  const rows = page.data?.rows ?? []
  const label = (row: StockCardRow) => names.get(row.key)?.name ?? row.label
  const sub = (row: StockCardRow) =>
    names.get(row.key)?.sub ?? (row.sub === "HO" ? "HO" : "Store")

  return (
    <>
      {page.data && <FigureStrip figures={page.data.total} />}
      <div className="mt-5">{switcher}</div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <PeriodBox range={range} onRange={onRange} />
      </div>
      {page.isPending ? (
        <LoadingState>Reading the stock card…</LoadingState>
      ) : page.isError ? (
        <EmptyState>The stock card could not be read.</EmptyState>
      ) : (
        <div className="items-box overflow-hidden rounded-inner border border-hairline">
          <table className="w-full table-fixed border-collapse">
            <FigureCols />
            <FigureHead first="Store" />
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
              {page.data && (
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

const ARTICLE_PAGE = 50

function ByArticle({
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
      by: "article",
      q: needle === "" ? undefined : needle,
      limit: ARTICLE_PAGE,
      offset,
    })
  )
  const rows = page.data?.rows ?? []
  const total = page.data?.row_count ?? 0

  return (
    <>
      {page.data && <FigureStrip figures={page.data.total} />}
      <div className="mt-5">{switcher}</div>
      <div className="group/bar mb-3 flex flex-wrap items-center gap-2">
        <PeriodBox range={range} onRange={onRange} />
        <ExpandingSearch
          value={typed}
          onChange={(next) => {
            setTyped(next)
            setOffset(0)
          }}
          label="Search article or code"
        />
        <BarSpacer />
      </div>
      {page.isPending ? (
        <LoadingState>Reading the stock card…</LoadingState>
      ) : rows.length === 0 ? (
        <EmptyState>
          {needle === ""
            ? "Nothing moved in this period."
            : "No article matches."}
        </EmptyState>
      ) : (
        <>
          <div className="items-box overflow-hidden rounded-inner border border-hairline">
            <table className="w-full table-fixed border-collapse">
              <FigureCols />
              <FigureHead first="Article" />
              <tbody className="[&>tr:first-child>td]:border-t-0">
                {rows.map((row, at) => (
                  <tr
                    key={row.key}
                    className="cursor-pointer transition-colors hover:bg-soft"
                    onClick={() =>
                      onOpen({ key: row.key, label: row.label, sub: row.sub })
                    }
                  >
                    <td className={ITEMS_CELL}>
                      <ItemIdentity
                        eager={at < 24}
                        row={{
                          image: null,
                          name: row.label,
                          division: null,
                          filed: row.sub ?? "",
                        }}
                      />
                    </td>
                    <FigureCells figures={row.figures} />
                  </tr>
                ))}
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
                onClick={() => setOffset(Math.max(0, offset - ARTICLE_PAGE))}
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={offset + rows.length >= total}
                onClick={() => setOffset(offset + ARTICLE_PAGE)}
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
}: {
  period: Period
  site?: string
  article?: string
}) {
  const lines = useQuery(
    stockCardLinesQuery({ ...period, site_id: site, article_id: article })
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
            <tr key={`${line.at}-${index}`}>
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
                  <span className="truncate text-ink">
                    {actionOf(line.cause)}
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
                {signed(line.pieces)}
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

/// One article: where it is, store by store; a store opens its card below.
function ArticleCard({
  article,
  period,
  onClose,
}: {
  article: Opened
  period: Period
  onClose: () => void
}) {
  const names = useSiteNames()
  const where = useQuery(
    stockCardQuery({ ...period, by: "site", article_id: article.key })
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
      title={article.label}
      caption={article.sub ?? undefined}
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
                <FigureHead first="Store" />
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
            <Ledger period={period} site={site} article={article.key} />
          </section>
        )}
      </div>
    </Sheet>
  )
}
