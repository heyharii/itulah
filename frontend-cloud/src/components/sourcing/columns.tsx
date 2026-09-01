/* eslint-disable react-refresh/only-export-components -- column definitions and the cells they render belong in one file. */
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import type { DataTableFilterField } from "@/components/data-table/types"
import { Checkbox } from "@/components/ui/checkbox"
import { ARRAY_DELIMITER, SLIDER_DELIMITER } from "@/lib/delimiters"
import { money } from "@/lib/money"
import { createSchema, field } from "@/lib/store/schema"
import type { DataTableFeatures } from "@/lib/table/features"
import type { ColumnDef } from "@tanstack/react-table"
import { Plus } from "lucide-react"
import type { SourcingFacets } from "@itulah/contract"
import type { Vocabulary } from "@/lib/vocabulary"
import type { SourcingRow } from "./rows"

/// The filter state, named once.
///
/// Every key here is also a column id and a `filterFields` value — the three
/// have to agree or a filter silently does nothing, so they are written next to
/// each other in this file rather than in three.
export const sourcingFilterSchema = createSchema({
  name: field.string(),
  supplier: field.array(field.string()).delimiter(ARRAY_DELIMITER),
  division: field.array(field.string()).delimiter(ARRAY_DELIMITER),
  tags: field.array(field.string()).delimiter(ARRAY_DELIMITER),
  status: field.array(field.string()).delimiter(ARRAY_DELIMITER),
  price: field.array(field.number()).delimiter(SLIDER_DELIMITER),
})

/// A row matches if it carries any of the chosen values.
///
/// Shared by `tags` (the row value is an array) and the plain string facets, so
/// that "womenswear OR menswear" means the same thing in both places.
function includesAny(rowValue: unknown, filterValue: unknown): boolean {
  const chosen = Array.isArray(filterValue) ? filterValue : [filterValue]
  if (chosen.length === 0) return true
  if (Array.isArray(rowValue)) {
    return chosen.some((value) => rowValue.includes(value))
  }
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

export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-muted text-muted-foreground inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap">
      {children}
    </span>
  )
}

export function StatusDot({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
      <span
        aria-hidden
        className={
          status === "ACTIVE"
            ? "size-2 shrink-0 rounded-full bg-emerald-500"
            : "size-2 shrink-0 rounded-full bg-neutral-400"
        }
      />
      {status === "ACTIVE" ? "In line" : "On hold"}
    </span>
  )
}

/// A supplier item's photo, or a legible admission that it has none.
///
/// An empty grey box is not the same as a broken image: a candidate with no
/// reference photo is one procurement cannot put on a PO line, and the buyer
/// should be able to see that at a glance rather than wonder if it failed to
/// load.
export function Thumb({
  row,
  className = "size-10",
}: {
  row: SourcingRow
  className?: string
}) {
  if (row.image === null) {
    return (
      <span
        aria-label={`${row.name} has no photo`}
        className={`bg-muted text-muted-foreground grid shrink-0 place-items-center rounded-md text-[9px] ${className}`}
      >
        no photo
      </span>
    )
  }
  return (
    <img
      src={row.image}
      alt={row.name}
      loading="lazy"
      className={`bg-muted shrink-0 rounded-md object-cover ${className}`}
    />
  )
}

export function sourcingColumns({
  held,
  onAdd,
  onOpen,
}: {
  /// How many of each item is already in the basket.
  held: Map<string, number>
  onAdd: (id: string) => void
  onOpen: (id: string) => void
}): ColumnDef<DataTableFeatures, SourcingRow>[] {
  return [
    {
      id: "select",
      size: 36,
      enableHiding: false,
      enableSorting: false,
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={
            table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()
          }
          onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked === true)}
          aria-label="Select every row on this page"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(checked) => row.toggleSelected(checked === true)}
          aria-label={`Select ${row.original.name}`}
        />
      ),
    },
    {
      id: "basket",
      size: 56,
      enableHiding: false,
      enableSorting: false,
      header: () => <span className="sr-only">Add to basket</span>,
      cell: ({ row }) => {
        const inBasket = held.get(row.original.id) ?? 0
        const onHold = row.original.status !== "ACTIVE"
        return (
          <span className="flex items-center gap-1">
            <button
              type="button"
              disabled={onHold}
              aria-label={`Add one ${row.original.name} to the basket`}
              title={onHold ? "On hold — cannot be ordered" : "Add one to the basket"}
              onClick={(event) => {
                // The row opens the item; this button does one specific thing
                // to it, so it must not also open it.
                event.stopPropagation()
                onAdd(row.original.id)
              }}
              className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-6 place-items-center rounded-md disabled:pointer-events-none disabled:opacity-30"
            >
              <Plus className="size-4" />
            </button>
            {inBasket > 0 && (
              <span
                className="font-mono text-[10.5px] tabular-nums text-emerald-600"
                title={`${inBasket} in your basket`}
              >
                {inBasket}
              </span>
            )}
          </span>
        )
      },
    },
    {
      accessorKey: "name",
      enableHiding: false,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />,
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Thumb row={row.original} />
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onOpen(row.original.id)}
              className="block max-w-full truncate text-left text-[13px] font-medium hover:underline"
            >
              {row.original.name}
            </button>
            <div className="text-muted-foreground truncate font-mono text-[10.5px]">
              {row.original.code}
              {row.original.article !== null && ` · ${row.original.article}`}
            </div>
          </div>
        </div>
      ),
      filterFn: (row, _id, value) => {
        const needle = String(value ?? "").toLowerCase()
        if (needle === "") return true
        const item = row.original as SourcingRow
        return (
          item.name.toLowerCase().includes(needle) ||
          item.code.toLowerCase().includes(needle)
        )
      },
    },
    {
      accessorKey: "supplier",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Supplier" />,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{row.original.supplier}</div>
          <div className="text-muted-foreground truncate font-mono text-[10.5px]">
            {row.original.supplierCode}
          </div>
        </div>
      ),
      filterFn: (row, id, value) => includesAny(row.getValue(id), value),
    },
    {
      accessorKey: "division",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Division" />,
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs">{row.original.division}</span>
      ),
      filterFn: (row, id, value) => includesAny(row.getValue(id), value),
    },
    {
      accessorKey: "tags",
      enableSorting: false,
      header: "Tags",
      cell: ({ row }) =>
        row.original.tags.length === 0 ? (
          <span className="text-muted-foreground/60 text-xs">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.original.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
        ),
      filterFn: (row, id, value) => includesAny(row.getValue(id), value),
    },
    {
      accessorKey: "price",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Unit cost" />,
      cell: ({ row }) => (
        <span className="font-mono text-xs tabular-nums">
          {money(row.original.price, row.original.currency)}
        </span>
      ),
      filterFn: (row, id, value) => withinRange(row.getValue(id), value),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusDot status={row.original.status} />,
      filterFn: (row, id, value) => includesAny(row.getValue(id), value),
    },
  ]
}

/// The facets, and the order the rail shows them in.
///
/// Supplier, division and tag values are read off the rows the server returned,
/// not from a fixed list: the sourcing query already narrowed the answer, and
/// offering a facet value that matches nothing in it is an invitation to an
/// empty screen.
export function sourcingFilterFields(
  rows: readonly SourcingRow[],
  vocabulary: Vocabulary,
  /// Counted by the server over the whole catalogue. Passing the loaded rows
  /// instead would describe the page — which is what this used to do, and why
  /// a facet could say "Kids 137" about a catalogue holding 751.
  facets: SourcingFacets | undefined,
  /// Supplier ids read as names. The facet's value is the id, because that is
  /// what the server filters on and what survives a rename.
  supplierName: (id: string) => string,
): DataTableFilterField<SourcingRow>[] {
  /// Facets are labelled but still addressed by code: what a filter matches
  /// must not change when somebody renames a division.
  const counted = (
    entries: readonly { value: string; count: number }[] | undefined,
    label: (value: string) => string,
  ) =>
    (entries ?? []).map((entry) => ({
      label: `${label(entry.value)}`,
      value: entry.value,
      count: entry.count,
    }))

  const prices = rows.map((row) => row.price)
  return [
    {
      label: "Item",
      value: "name",
      type: "input",
      defaultOpen: true,
    },
    {
      label: "Supplier",
      value: "supplier",
      type: "checkbox",
      defaultOpen: true,
      options: counted(facets?.suppliers, supplierName).sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
    },
    {
      label: "Division",
      value: "division",
      type: "checkbox",
      defaultOpen: true,
      options: (() => {
        const rank = new Map(vocabulary.divisionOrder.map((code, index) => [code, index]))
        return counted(facets?.divisions, vocabulary.division).sort(
          (a, b) =>
            (rank.get(a.value) ?? Number.MAX_SAFE_INTEGER) -
              (rank.get(b.value) ?? Number.MAX_SAFE_INTEGER) || a.label.localeCompare(b.label),
        )
      })(),
    },
    {
      label: "Tags",
      value: "tags",
      type: "checkbox",
      options: counted(facets?.tags, vocabulary.tag),
    },
    {
      label: "Status",
      value: "status",
      type: "checkbox",
      options: [
        { label: "In line", value: "ACTIVE" },
        { label: "On hold", value: "INACTIVE" },
      ],
    },
    {
      label: "Unit cost",
      value: "price",
      type: "slider",
      min: prices.length === 0 ? 0 : Math.min(...prices),
      max: prices.length === 0 ? 0 : Math.max(...prices),
    },
  ]
}
