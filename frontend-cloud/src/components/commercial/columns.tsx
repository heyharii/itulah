/* eslint-disable react-refresh/only-export-components -- column definitions and the cells they render belong in one file. */
import { StatusPill } from "@/components/custom/status-pill"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Button } from "@/components/ui/button"
import type { BookPriceRule, PriceBook, PromotionUsage, ShopActivation } from "@/lib/commercial"
import { money, units } from "@/lib/money"
import type { DataTableFeatures } from "@/lib/table/features"
import { cn } from "@/lib/utils"
import type { ColumnDef } from "@tanstack/react-table"
import { Send } from "lucide-react"

/// The commercial tables' columns.
///
/// # Why these sort and the price screen does not
///
/// Everything here is a flat list of things that happened — books written,
/// shops reporting, promotions used, prices in one book — and the reader's
/// question is always a superlative: which shop is furthest behind, which
/// promotion has spent the most, which price in this book is the odd one. That
/// is a sort. The price screen next door is a different shape entirely and is
/// left alone; see the note on `prices-view.tsx`.
const numeric = "text-right font-mono text-xs tabular-nums"
const right = "text-right"

/// A local date, written the way the client writes them.
function on(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID")
}

function at(iso: string): string {
  return new Date(iso).toLocaleString("id-ID")
}

// ── Price books ────────────────────────────────────────────────────────────

/// The books, and the one irreversible act on this screen.
///
/// Publishing is passed in rather than reached for here because the receipt it
/// returns belongs to the screen: what a publish is worth knowing about is who
/// it reached, and that is drawn above the table, not in it.
export function priceBookColumns({
  canPublish,
  publishing,
  onPublish,
}: {
  canPublish: boolean
  /// The book currently going out, so only its own button says "Sending…".
  publishing: string | null
  onPublish: (id: string) => void
}): ColumnDef<DataTableFeatures, PriceBook>[] {
  return [
    {
      accessorKey: "version",
      enableHiding: false,
      meta: { label: "Book" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Book" />,
      cell: ({ row }) => (
        <span className="font-mono text-xs font-medium">v{row.original.version}</span>
      ),
    },
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
      cell: ({ row }) => <span className="text-xs">{row.original.name}</span>,
      meta: { cellClassName: "max-w-64 truncate" },
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => {
        const draft = row.original.status === "DRAFT"
        return (
          <StatusPill tone={draft ? "warn" : "ok"} dot={false}>
            {draft ? "Draft" : "Published"}
          </StatusPill>
        )
      },
    },
    {
      accessorKey: "offer_count",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Prices" align="end" />
      ),
      // The size of the change and never the size of the range: a book of
      // twenty prices is a normal book, and a book of five thousand is somebody
      // restating what had not changed.
      cell: ({ row }) => units(row.original.offer_count),
      meta: { headerClassName: right, cellClassName: numeric },
    },
    {
      accessorKey: "effective_from",
      header: ({ column }) => <DataTableColumnHeader column={column} title="In force" />,
      cell: ({ row }) => (
        <span className="text-muted-foreground font-mono text-[0.6875rem] whitespace-nowrap">
          {on(row.original.effective_from)}
          {row.original.effective_to === null ? " →" : ` → ${on(row.original.effective_to)}`}
        </span>
      ),
    },
    {
      accessorKey: "created_by",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Written by" />,
      cell: ({ row }) => (
        <div className="text-muted-foreground flex flex-col text-[0.6875rem]">
          <span>{row.original.created_by}</span>
          {row.original.published_by !== null &&
            row.original.published_by !== row.original.created_by && (
              <span className="text-[0.65625rem]">published by {row.original.published_by}</span>
            )}
        </div>
      ),
    },
    {
      id: "publish",
      header: "",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.status !== "DRAFT" ? null : (
          <Button
            size="sm"
            disabled={!canPublish || publishing !== null}
            // The row opens the book; this button publishes it. Without this
            // the click would do both, and the second thing it did would be
            // irreversible.
            onClick={(event) => {
              event.stopPropagation()
              onPublish(row.original.id)
            }}
          >
            <Send className="size-3.5" />
            {publishing === row.original.id ? "Sending…" : "Publish"}
          </Button>
        ),
      meta: { headerClassName: right, cellClassName: right },
    },
  ]
}

// ── The fleet ──────────────────────────────────────────────────────────────

/// Which shop is charging which book.
///
/// `behind_by` sorts, and that is the point of the table: "who is behind" is
/// the question, and it used to be answered by reading fourteen rows in
/// whatever order the shops happened to be registered in.
export const fleetColumns: ColumnDef<DataTableFeatures, ShopActivation>[] = [
  {
    accessorKey: "label",
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Shop" />,
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="text-xs">{row.original.label ?? row.original.origin_id}</span>
        <span className="text-muted-foreground font-mono text-[0.65625rem]">
          {row.original.site_id ?? row.original.origin_id}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "version",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Charging from" />,
    cell: ({ row }) =>
      row.original.version === null ? (
        <span className="text-destructive text-xs">nothing, ever</span>
      ) : (
        <div className="flex flex-col">
          <span className="font-mono text-xs">v{row.original.version}</span>
          {row.original.book_name !== null && (
            <span className="text-muted-foreground max-w-48 truncate text-[0.65625rem]">
              {row.original.book_name}
            </span>
          )}
        </div>
      ),
  },
  {
    id: "behind_by",
    /// A shop that has never taken up a book is infinitely behind, which is not
    /// a number the server can send — it sends null. `nullsLast` counts the
    /// null as larger than any number, so sorted furthest-behind-first it lands
    /// above every shop that is merely behind, instead of being swept to the
    /// end with the missing values.
    ///
    /// The accessor hands over the value the cell below draws, null and all: an
    /// accessor that substituted `Number.POSITIVE_INFINITY` sorted right by
    /// telling everything else that reads this column a number no shop has.
    accessorFn: (row: ShopActivation) => row.behind_by,
    sortFn: "nullsLast",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Behind" align="end" />
    ),
    cell: ({ row }) => {
      const behind = row.original.behind_by
      if (behind === null) return <span className="text-muted-foreground text-[0.6875rem]">—</span>
      if (behind === 0) return <span className="text-[0.6875rem] text-[var(--os-ok,#36b827)]">up to date</span>
      return (
        <span className="font-mono text-xs tabular-nums text-[var(--os-warn,#c9892e)]">
          {units(behind)} book{behind === 1 ? "" : "s"}
        </span>
      )
    },
    meta: { headerClassName: right, cellClassName: right },
  },
  {
    accessorKey: "price_rule_count",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Prices received" align="end" />
    ),
    // How much of the book arrived, so a truncated delivery shows as a number
    // rather than as a wrong price weeks later.
    cell: ({ row }) =>
      row.original.price_rule_count === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        units(row.original.price_rule_count)
      ),
    meta: { headerClassName: right, cellClassName: numeric },
  },
  {
    accessorKey: "activated_at",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Since" />,
    cell: ({ row }) =>
      row.original.activated_at === null ? "—" : at(row.original.activated_at),
    meta: { cellClassName: "text-muted-foreground font-mono text-[0.65625rem] whitespace-nowrap" },
  },
  {
    accessorKey: "reported_at",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Centre heard" />,
    // The gap between this and the column before it is the number to watch.
    cell: ({ row }) => (row.original.reported_at === null ? "—" : at(row.original.reported_at)),
    meta: { cellClassName: "text-muted-foreground font-mono text-[0.65625rem] whitespace-nowrap" },
  },
]

// ── What the promotions have cost ──────────────────────────────────────────

export const usageColumns: ColumnDef<DataTableFeatures, PromotionUsage>[] = [
  {
    accessorKey: "name",
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Promotion" />,
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="text-xs">{row.original.name ?? row.original.key}</span>
        <span className="text-muted-foreground font-mono text-[0.65625rem]">{row.original.key}</span>
      </div>
    ),
  },
  {
    accessorKey: "kind",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Kind" />,
    cell: ({ row }) => (
      <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[0.65625rem]">
        {row.original.kind === "RULE"
          ? "Rule"
          : row.original.kind === "CAMPAIGN"
            ? "Campaign"
            : "Coupon"}
      </span>
    ),
  },
  {
    accessorKey: "uses",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Used" align="end" />
    ),
    cell: ({ row }) => {
      const usedUp = row.original.max_uses !== null && row.original.uses >= row.original.max_uses
      return (
        <>
          {units(row.original.uses)}
          {row.original.max_uses !== null && (
            <span className={cn("text-muted-foreground", usedUp && "text-[var(--os-warn,#c9892e)]")}>
              {" / "}
              {units(row.original.max_uses)}
            </span>
          )}
        </>
      )
    },
    meta: { headerClassName: right, cellClassName: numeric },
  },
  {
    accessorKey: "spent_minor",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Given away" align="end" />
    ),
    cell: ({ row }) => <Spend row={row.original} />,
    meta: { headerClassName: right, cellClassName: right },
  },
  {
    accessorKey: "customer_count",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Shoppers" align="end" />
    ),
    cell: ({ row }) => units(row.original.customer_count),
    meta: { headerClassName: right, cellClassName: numeric },
  },
  {
    accessorKey: "last_used_at",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Last used" />,
    cell: ({ row }) => at(row.original.last_used_at),
    meta: { cellClassName: "text-muted-foreground font-mono text-[0.65625rem] whitespace-nowrap" },
  },
]

/// What one promotion has given away, against what it was allowed to.
///
/// An unlimited budget is not a full bar and not an empty one — there is no
/// bar. Drawing one would invent a ceiling nobody set.
export function Spend({ row }: { row: PromotionUsage }) {
  const capped = row.budget_minor !== null && row.budget_minor > 0
  const share = capped ? Math.min(1, row.spent_minor / (row.budget_minor ?? 1)) : null
  const spentOut = capped && row.spent_minor >= (row.budget_minor ?? 0)
  return (
    <div className="flex flex-col items-end gap-1">
      <span
        className={cn(
          "font-mono text-xs tabular-nums",
          spentOut && "font-medium text-[var(--os-warn,#c9892e)]",
        )}
      >
        {money(row.spent_minor)}
        {capped && (
          <span className="text-muted-foreground">
            {" / "}
            {money(row.budget_minor ?? 0)}
          </span>
        )}
      </span>
      {share !== null && (
        <div className="bg-muted h-1 w-20 overflow-hidden rounded-full">
          <div
            className={cn("h-full", spentOut ? "bg-[var(--os-warn,#c9892e)]" : "bg-[var(--os-accent,#3c52f0)]")}
            style={{ width: `${share * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}

/// Whether a usage row has run out of what it was given, which is what colours
/// it. Exported so the screen can hand it to the table as a row class rather
/// than computing it a second time inside a cell.
export function exhausted(row: PromotionUsage): boolean {
  const spentOut =
    row.budget_minor !== null && row.budget_minor > 0 && row.spent_minor >= row.budget_minor
  const usedUp = row.max_uses !== null && row.uses >= row.max_uses
  return spentOut || usedUp
}

// ── One book's prices ──────────────────────────────────────────────────────

/// Which shops or shoppers a row applies to.
///
/// One level only — a row claiming to be both a shop price and a tier price has
/// no single right reading, and the database refuses it.
export function scope(row: {
  readonly site_id: string | null
  readonly site_ids: readonly string[] | null
  readonly tier: string | null
}): string {
  if (row.site_id !== null) return row.site_id
  if (row.site_ids !== null && row.site_ids.length > 0) return `${row.site_ids.length} shops`
  if (row.tier !== null) return `tier ${row.tier}`
  return "every shop"
}

/// The prices one book carries.
///
/// This is the table in the folder that most needed converting, and for the
/// dullest reason: a book of five thousand prices is a real book, and reading
/// one meant scrolling five thousand rows in the order the server happened to
/// send them. Sorting by price is how somebody checks a book before publishing
/// it, which is the last moment it can be checked at all — a published book is
/// immutable.
export const bookPriceColumns: ColumnDef<DataTableFeatures, BookPriceRule>[] = [
  {
    accessorKey: "sku_code",
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} title="SKU" />,
    cell: ({ row }) => <span className="font-mono text-[0.6875rem]">{row.original.sku_code}</span>,
  },
  {
    accessorKey: "article_name",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Product" />,
    cell: ({ row }) => <span className="text-xs">{row.original.article_name}</span>,
    meta: { cellClassName: "max-w-48 truncate" },
  },
  {
    id: "applies_to",
    header: "Applies to",
    enableSorting: false,
    cell: ({ row }) => <span className="text-[0.6875rem]">{scope(row.original)}</span>,
  },
  {
    accessorKey: "channel",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Channel" />,
    cell: ({ row }) => row.original.channel,
    meta: { cellClassName: "text-muted-foreground text-[0.65625rem]" },
  },
  {
    accessorKey: "unit_price_minor",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Price" align="end" />
    ),
    cell: ({ row }) => money(row.original.unit_price_minor, row.original.currency),
    meta: { headerClassName: right, cellClassName: numeric },
  },
  {
    accessorKey: "tax_category",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Tax class" />,
    cell: ({ row }) => row.original.tax_category,
    meta: { cellClassName: "text-muted-foreground font-mono text-[0.65625rem]" },
  },
]
