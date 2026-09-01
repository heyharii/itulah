/* eslint-disable react-refresh/only-export-components -- column definitions and the cells they render belong in one file. */
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import type { DataTableFilterField } from "@/components/data-table/types"
import type { PriceSource, ShelfPrice } from "@/lib/commercial"
import {
  describeSource,
  isMarkedDown,
  markdownDepthBps,
  priceSource,
} from "@/lib/commercial"
import { ARRAY_DELIMITER, SLIDER_DELIMITER } from "@/lib/delimiters"
import { money } from "@/lib/money"
import { createSchema, field } from "@/lib/store/schema"
import type { DataTableFeatures } from "@/lib/table/features"
import { cn } from "@/lib/utils"
import type { ColumnDef } from "@tanstack/react-table"

/// The filter state, named once.
///
/// Every key here is also a column id and a `filterFields` value — the three
/// have to agree or a filter silently does nothing, so they are written beside
/// each other in this file rather than in three.
export const priceFilterSchema = createSchema({
  sku_code: field.string(),
  source: field.array(field.string()).delimiter(ARRAY_DELIMITER),
  tax_category: field.array(field.string()).delimiter(ARRAY_DELIMITER),
  unit_price_minor: field.array(field.number()).delimiter(SLIDER_DELIMITER),
})

function includesAny(rowValue: unknown, filterValue: unknown): boolean {
  const chosen = Array.isArray(filterValue) ? filterValue : [filterValue]
  if (chosen.length === 0) return true
  return chosen.includes(rowValue)
}

function withinRange(rowValue: unknown, filterValue: unknown): boolean {
  const value = Number(rowValue)
  if (!Number.isFinite(value)) return false
  if (typeof filterValue === "number") return value === filterValue
  if (!Array.isArray(filterValue) || filterValue.length === 0) return true
  const numbers = filterValue.map(Number).filter(Number.isFinite)
  if (numbers.length === 1) return value === numbers[0]
  const [low, high] = [...numbers].sort((a, b) => a - b)
  return low <= value && value <= high
}

/// A row as the table reads it: the wire shape, plus the one field the wire
/// spells two ways.
///
/// `source` is normalised at the edge of the query rather than inside a cell,
/// because a facet counts the values it is given. Left raw, "Company" and
/// "COMPANY_PRICE" would be two entries in the rail describing the same shops.
export interface PriceRow extends ShelfPrice {
  readonly source: PriceSource
}

export function toPriceRows(items: readonly ShelfPrice[]): PriceRow[] {
  return items.map((item) => ({ ...item, source: priceSource(item.price_source) }))
}

/// Where the price came from, as a badge.
///
/// A markdown is coloured and the rest are not, on purpose: the cascade levels
/// are all ordinary answers to "which price list won", and only the markdown
/// says money is currently being given away.
export function SourceBadge({ source }: { source: PriceSource }) {
  const marked = source === "MARKDOWN"
  const typed = source === "MANUAL_OVERRIDE"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] whitespace-nowrap",
        marked
          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-400"
          : typed
            ? "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-400"
            : "bg-muted text-muted-foreground",
      )}
    >
      {describeSource(source)}
    </span>
  )
}

/// What is charged, and what it was before.
///
/// The original is struck through beside it rather than hidden behind a hover:
/// the difference between a price and a marked-down price is the single thing
/// somebody opens this screen to see, and a number you have to go looking for
/// is a number that gets checked once and then trusted.
function Charged({ row }: { row: PriceRow }) {
  const marked = isMarkedDown(row)
  return (
    <div className="flex items-baseline justify-end gap-2 whitespace-nowrap">
      {marked && (
        <span className="text-muted-foreground font-mono text-[11px] line-through tabular-nums">
          {money(row.base_unit_price_minor, row.currency)}
        </span>
      )}
      <span
        className={cn(
          "font-mono text-xs tabular-nums",
          marked && "font-medium text-amber-700 dark:text-amber-500",
        )}
      >
        {money(row.unit_price_minor, row.currency)}
      </span>
    </div>
  )
}

export const priceColumns: ColumnDef<DataTableFeatures, PriceRow>[] = [
  {
    accessorKey: "sku_code",
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} title="SKU" />,
    cell: ({ row }) => (
      <span className="font-mono text-[11px] font-medium">{row.original.sku_code}</span>
    ),
    // Matched against the words a person actually has to hand — they know the
    // garment's name, or the code on the label, and rarely both.
    filterFn: (row, _id, value) => {
      const needle = String(value ?? "")
        .trim()
        .toLowerCase()
      if (needle === "") return true
      const { sku_code, article_code, article_name } = row.original
      return [sku_code, article_code, article_name].some((field) =>
        field.toLowerCase().includes(needle),
      )
    },
  },
  {
    accessorKey: "article_name",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Product" />,
    cell: ({ row }) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-xs">{row.original.article_name || "—"}</span>
        <span className="text-muted-foreground font-mono text-[10.5px]">
          {row.original.article_code}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "unit_price_minor",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Charged" />,
    cell: ({ row }) => <Charged row={row.original} />,
    filterFn: (row, id, value) => withinRange(row.getValue(id), value),
  },
  {
    id: "off",
    accessorFn: (row: PriceRow) => markdownDepthBps(row),
    header: ({ column }) => <DataTableColumnHeader column={column} title="Off" />,
    cell: ({ row }) => {
      const bps = markdownDepthBps(row.original)
      if (bps <= 0) return <span className="text-muted-foreground text-[11px]">—</span>
      return (
        <span className="font-mono text-[11px] tabular-nums text-amber-700 dark:text-amber-500">
          {(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%
        </span>
      )
    },
  },
  {
    accessorKey: "source",
    header: "From",
    cell: ({ row }) => <SourceBadge source={row.original.source} />,
    filterFn: (row, id, value) => includesAny(row.getValue(id), value),
  },
  {
    accessorKey: "markdown_id",
    header: "Markdown",
    cell: ({ row }) =>
      row.original.markdown_id === null ? (
        <span className="text-muted-foreground text-[11px]">—</span>
      ) : (
        <span className="font-mono text-[10.5px]">{row.original.markdown_id}</span>
      ),
  },
  {
    accessorKey: "tax_category",
    header: "Tax class",
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono text-[10.5px]">
        {row.original.tax_category}
      </span>
    ),
    filterFn: (row, id, value) => includesAny(row.getValue(id), value),
  },
  {
    accessorKey: "version",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Book" />,
    // The book a price came out of, not the newest book. A range priced from
    // three different publications is normal — each one only changed what it
    // named — and seeing which is which is how you find the line nobody has
    // repriced since March.
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono text-[10.5px] tabular-nums">
        v{row.original.version}
      </span>
    ),
  },
]

/// The facets, and the order the rail shows them in.
///
/// Values are read off the rows the server returned rather than hard-coded, so
/// a shop that has never had a tier price does not get an empty "Member tier"
/// box to wonder about.
export function priceFilterFields(
  rows: readonly PriceRow[],
): DataTableFilterField<PriceRow>[] {
  const prices = rows.map((row) => row.unit_price_minor)
  const unique = <T extends string>(values: readonly T[], label: (value: T) => string) =>
    [...new Set(values)]
      .sort((left, right) => left.localeCompare(right))
      .map((value) => ({ label: label(value), value }))

  return [
    { label: "Product", value: "sku_code", type: "input", defaultOpen: true },
    {
      label: "Price came from",
      value: "source",
      type: "checkbox",
      defaultOpen: true,
      options: unique(
        rows.map((row) => row.source),
        describeSource,
      ),
    },
    {
      label: "Tax class",
      value: "tax_category",
      type: "checkbox",
      options: unique(
        rows.map((row) => row.tax_category),
        (value) => value,
      ),
    },
    {
      label: "Charged",
      value: "unit_price_minor",
      type: "slider",
      min: prices.length === 0 ? 0 : Math.min(...prices),
      max: prices.length === 0 ? 0 : Math.max(...prices),
    },
  ]
}
