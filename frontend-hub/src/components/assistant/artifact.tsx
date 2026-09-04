import { QueryCard } from "@/components/assistant/query-card"
import { rowsShown, useArtifactSpace } from "@/components/assistant/space"
import { BarSeries, type ChartRow } from "@/components/ui/chart"
import { count, day, money } from "@/lib/format"
import { ReportCard } from "@/components/assistant/report-card"
import type { ToolRun } from "@/lib/queries/assistant"
import { cn } from "@/lib/utils"

/// What a tool answered, drawn the way the screen that owns it would draw it.
///
/// The alternative — pasting the JSON into the reply and asking the model to
/// describe it — costs tokens to restate rows a table renders better, and
/// turns a figure somebody could scan into a paragraph they have to parse. So
/// the model says what the numbers mean and this file shows the numbers.
///
/// Every renderer takes `unknown` and reads defensively. A tool result is
/// server data, not a typed contract: the server assembles these with
/// `json!()` and a field that moves must leave a gap in a card, never a blank
/// panel with an exception behind it.

// ---- Reading a payload safely ------------------------------------------

type Row = Record<string, unknown>

function items(data: unknown, key = "items"): Row[] {
  if (typeof data !== "object" || data === null) return []
  const value = (data as Row)[key]
  return Array.isArray(value) ? (value as Row[]) : []
}

function field(row: unknown, key: string): unknown {
  if (typeof row !== "object" || row === null) return undefined
  return (row as Row)[key]
}

function text(row: unknown, key: string): string {
  const value = field(row, key)
  return value === null || value === undefined ? "—" : String(value)
}

function num(row: unknown, key: string): number | null {
  const value = field(row, key)
  return typeof value === "number" ? value : null
}

// ---- The two shapes every renderer is built from ------------------------

/// A dense list. Three columns at most: the panel is 30rem wide and a fourth
/// one turns every row into two lines of truncation.
function Table({
  head,
  rows,
  empty,
}: {
  head: readonly string[]
  rows: readonly (readonly React.ReactNode[])[]
  empty: string
}) {
  if (rows.length === 0) {
    return <p className="px-3 py-3 text-meta text-body">{empty}</p>
  }
  return (
    // Scrolls rather than truncates once there are more rows than fit. On the
    // panel this changes nothing — twelve rows have always fitted — and on the
    // page it is what lets the cap be forty without the card taking over the
    // conversation.
    <div className="max-h-[24rem] overflow-auto">
    {/* `min-w` and not a breakpoint: the constraint is the container, and this
        table has two of them — a 30rem panel and a phone. Below that width the
        card scrolls sideways rather than squeezing three columns into
        "COMP…" and "Rp 1.1…", which is a table that costs a tap to read and
        answers nothing at a glance. */}
    <table className="w-full min-w-[26rem] table-fixed border-collapse">
      <thead>
        <tr>
          {head.map((column, index) => (
            <th
              key={column}
              className={cn(
                "sticky top-0 z-1 border-b border-hairline bg-canvas px-3 py-1.5 text-eyebrow font-semibold text-mute uppercase",
                index === 0 ? "text-left" : "text-right",
                index === 0 ? "w-1/2" : undefined
              )}
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className="border-b border-hairline last:border-0">
            {row.map((cell, column) => (
              <td
                key={column}
                className={cn(
                  "truncate px-3 py-[0.4375rem] text-cell",
                  column === 0
                    ? "text-left text-ink"
                    : "text-right text-body tabular-nums"
                )}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}

/// Two or three figures with their labels, for a result that is a summary
/// rather than a list.
function Figures({
  figures,
}: {
  figures: readonly { label: string; value: string }[]
}) {
  return (
    <div className="grid grid-cols-3 gap-px bg-hairline">
      {figures.map((figure) => (
        <div key={figure.label} className="bg-canvas px-3 py-2.5">
          <div className="text-eyebrow font-semibold text-mute uppercase">
            {figure.label}
          </div>
          <div className="mt-1 text-[0.9375rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {figure.value}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- One renderer per tool ---------------------------------------------

/// The fleet's takings per bucket, as the bar chart Analytics draws.
///
/// Summed across shops rather than stacked by shop: the panel is too narrow
/// for nineteen bands, and the question a chart in a chat answers is "what is
/// the shape of this", with "which shop" a follow-up the assistant can take.
function SalesSeries({ data }: { data: unknown }) {
  const buckets = (field(data, "buckets") as unknown[] | undefined) ?? []
  const cells = items(data, "cells")
  const totals = new Map<string, number>()
  for (const cell of cells) {
    const bucket = text(cell, "bucket_start")
    totals.set(
      bucket,
      (totals.get(bucket) ?? 0) + (num(cell, "gross_minor") ?? 0)
    )
  }
  const rows: ChartRow[] = buckets.map((bucket) => ({
    bucket: String(bucket),
    gross: totals.get(String(bucket)) ?? 0,
  }))
  if (rows.length === 0) {
    return <p className="px-3 py-3 text-meta text-body">Nothing traded.</p>
  }
  return (
    <div className="px-3 pt-2.5 pb-1">
      <BarSeries
        className="h-[9.5rem] w-full text-eyebrow"
        rows={rows}
        series={[{ key: "gross", label: "Gross", tone: "accent" }]}
        format={money}
        titleOf={day}
        labelOf={(bucket) => bucket.slice(5).replace("-", "/")}
      />
    </div>
  )
}

/// One shop, one day: the totals, then how it was paid for.
function DailySales({ data }: { data: unknown }) {
  const sales = field(data, "sales")
  const tenders = items(data, "tenders").length
    ? items(data, "tenders")
    : Array.isArray(field(data, "tenders"))
      ? (field(data, "tenders") as Row[])
      : []
  return (
    <>
      <Figures
        figures={[
          { label: "Gross", value: money(num(sales, "gross_minor")) },
          { label: "Receipts", value: count(num(sales, "count")) },
          { label: "Units", value: count(num(sales, "units_sold")) },
        ]}
      />
      <Table
        head={["Tender", "Count", "Amount"]}
        rows={tenders.map((tender) => [
          text(tender, "method"),
          count(num(tender, "count")),
          money(num(tender, "amount_minor")),
        ])}
        empty="Nothing was tendered."
      />
    </>
  )
}

/// Stock as it stands. Only the holding pools: rollups are listed beside the
/// pools they roll up, and showing both makes the same garment appear twice.
function Pools({ data }: { data: unknown }) {
  const limit = rowsShown(useArtifactSpace())
  const leaves = items(data).filter(
    (pool) => field(pool, "is_rollup") === false
  )
  return (
    <Table
      head={["Pool", "On hand", "Missing"]}
      rows={leaves
        .slice(0, limit)
        .map((pool) => [
          `${text(pool, "site_id")} · ${text(pool, "label")}`,
          count(num(pool, "on_hand")),
          count(num(pool, "missing")),
        ])}
      empty="No pools hold stock."
    />
  )
}

function Articles({ data }: { data: unknown }) {
  const limit = rowsShown(useArtifactSpace())
  return (
    <Table
      head={["Article", "SKUs", "Status"]}
      rows={items(data)
        .slice(0, limit)
        .map((article) => [
          <span key="name" className="block truncate">
            <span className="font-mono text-id text-body">
              {text(article, "article_code")}
            </span>{" "}
            {text(article, "name")}
          </span>,
          count(num(article, "sku_count")),
          field(article, "active") === false ? "Retired" : "Active",
        ])}
      empty="No article matched."
    />
  )
}

/// What each shop charges for a style. The top rung of the stack is the price
/// on the shelf edge; the rungs under it are why.
function Prices({ data }: { data: unknown }) {
  const space = useArtifactSpace()
  const limit = rowsShown(space)
  // Two nested caps multiply, and the product is not what the number in
  // `space.ts` means: six styles by eight shops is forty-eight rows on a card
  // whose limit is forty. The bound that matters is on the rows themselves,
  // so it is applied to them — the loops only decide how the budget is spent,
  // which is breadth first: every style gets a few shops before any style gets
  // many.
  const rows: (readonly React.ReactNode[])[] = []
  for (const article of items(data)) {
    if (rows.length >= limit) break
    const shops = Array.isArray(field(article, "shops"))
      ? (field(article, "shops") as Row[])
      : []
    for (const shop of shops.slice(0, space === "page" ? 6 : 4)) {
      if (rows.length >= limit) break
      const stack = Array.isArray(field(shop, "stack"))
        ? (field(shop, "stack") as Row[])
        : []
      const top = stack[0]
      if (!top) continue
      const min = num(top, "min_unit_price_minor")
      const max = num(top, "max_unit_price_minor")
      rows.push([
        `${text(article, "article_code")} · ${text(shop, "label")}`,
        text(top, "source"),
        min !== null && max !== null && min !== max
          ? `${money(min)}–${money(max)}`
          : money(min),
      ])
    }
  }
  return (
    <Table
      head={["Style · shop", "Rung", "Price"]}
      rows={rows}
      empty="No style is priced at any shop."
    />
  )
}

function Sales({ data }: { data: unknown }) {
  const limit = rowsShown(useArtifactSpace())
  return (
    <Table
      head={["Receipt", "Status", "Total"]}
      rows={items(data)
        .slice(0, limit)
        .map((sale) => [
          <span key="id" className="block truncate">
            <span className="font-mono text-id">
              {text(sale, "sale_number")}
            </span>{" "}
            <span className="text-body">{text(sale, "site_id")}</span>
          </span>,
          text(sale, "status"),
          money(num(sale, "total_minor")),
        ])}
      empty="No sale in that range."
    />
  )
}

function Missing({ data }: { data: unknown }) {
  const limit = rowsShown(useArtifactSpace())
  const rows = items(data)
  return (
    <Table
      head={["Tag", "Where", "Missing for"]}
      rows={rows
        .slice(0, limit)
        .map((row) => [
          text(row, "sku_code") === "—"
            ? text(row, "epc")
            : text(row, "sku_code"),
          text(row, "site_id"),
          num(row, "age_hours") === null
            ? "—"
            : `${count(Math.round((num(row, "age_hours") ?? 0) / 24))} d`,
        ])}
      empty="Nothing is missing."
    />
  )
}

/// Which book each shop is actually running. `behind_by` is the number worth
/// reading: one version behind an hour after a publish is ordinary.
function Activation({ data }: { data: unknown }) {
  const limit = rowsShown(useArtifactSpace())
  return (
    <Table
      head={["Shop", "Version", "Behind"]}
      rows={items(data)
        .slice(0, limit)
        .map((shop) => [
          text(shop, "label"),
          text(shop, "version"),
          num(shop, "behind_by") === null ? "—" : count(num(shop, "behind_by")),
        ])}
      empty="No shop reports a commercial version."
    />
  )
}

function TrialBalance({ data }: { data: unknown }) {
  const limit = rowsShown(useArtifactSpace())
  const rows = items(data, "rows")
  return (
    <Table
      head={["Account", "Debit", "Credit"]}
      rows={rows.slice(0, limit).map((row) => [
        <span key="account" className="block truncate">
          <span className="font-mono text-id text-body">
            {text(row, "account_code")}
          </span>{" "}
          {text(row, "name")}
        </span>,
        money(num(row, "debit_minor")),
        money(num(row, "credit_minor")),
      ])}
      empty="The ledger has no entry on that date."
    />
  )
}

const RENDERERS: Record<string, (props: { data: unknown }) => React.ReactNode> =
  {
    sales_series: SalesSeries,
    sales_daily: DailySales,
    inventory_pools: Pools,
    search_articles: Articles,
    article_prices: Prices,
    list_sales: Sales,
    missing_stock: Missing,
    commercial_activation: Activation,
    trial_balance: TrialBalance,
    // The one renderer that knows nothing about what it is drawing. Every
    // question the nine above do not cover arrives here — see `query-card.tsx`.
    sql_query: QueryCard,
    // `describe_schema` has no card on purpose. It is how the model finds the
    // column names, not an answer to anybody's question, and a card listing
    // forty columns under a reply about takings is noise. The chip in the
    // trace still says it was read.
  }

/// The cards under one answer, or nothing at all.
///
/// Plural, and it owns its own spacing, so the panel never has to ask which
/// runs have a renderer in order to decide whether to leave a gap. A chip in
/// the trace is drawn for every call; a card is drawn only for a call that
/// succeeded and has a shape somebody wrote a renderer for.
export function Artifacts({
  runs,
  question,
}: {
  runs: readonly ToolRun[]
  /// The sentence that produced these. Only the composed-report card uses it —
  /// it travels with the report when somebody keeps it.
  question: string
}) {
  const drawable = runs.filter(
    (run) => run.ok === true && (run.name in RENDERERS || run.name === COMPOSED)
  )
  if (drawable.length === 0) return null
  return (
    <div className="mt-3 flex flex-col gap-2.5">
      {drawable.map((run) => (
        <div
          key={run.id}
          className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft"
        >
          {run.name === COMPOSED ? (
            <ReportCard data={run.data} question={question} />
          ) : (
            renderer(run)
          )}
        </div>
      ))}
    </div>
  )
}

/// The one tool that proposes a definition rather than answering a question.
/// It is not in `RENDERERS` because its card needs more than the payload: it
/// needs the sentence that produced it, and a button that writes.
const COMPOSED = "author_report"

function renderer(run: ToolRun) {
  const Render = RENDERERS[run.name]
  return Render ? <Render data={run.data} /> : null
}
