import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo } from "react"

import { DataTable } from "@/components/ui/data-table"
import {
  CardFigure,
  CardFoot,
  type FigureTone,
} from "@/components/ui/phone-cards"
import { useLayout } from "@/lib/layout"
import { tableSetup, type TableSetup } from "@/lib/table"

/// A short list that stands in a dashboard card: the shared `DataTable`, so a
/// desk gets the table (sortable heads, the sticky heading) and a phone gets
/// the rows as cards — nothing scrolls sideways.
///
/// The dashboards drew these as `MiniTable`s inside `overflow-x-auto`. A card
/// holding one wears `max-md:overflow-visible max-md:border-0
/// max-md:bg-transparent max-md:shadow-none`, so the cards stand on the page,
/// as the Store comparison card on Store Performance does.

type CardRole =
  "id" | "title" | "status" | "metric" | "meta" | "lead" | "foot" | "hide"

/// One column, written the short way.
///
/// `by` is what the column sorts by; leaving it out makes the column
/// unsortable, and returning `null` from it says "nothing here" — a card then
/// leaves that figure out instead of printing a label over a dash.
/// With no `card` role the first column is the card's title, a right-aligned
/// one a figure under its own label, and the rest a quiet line.
export function field<TRow>(
  id: string,
  header: string,
  cell: (row: TRow) => React.ReactNode,
  options: {
    readonly right?: boolean
    readonly by?: (row: TRow) => string | number | null
    readonly card?: CardRole
    /// What goes first when the card is too narrow for every column: 3, then 2.
    readonly priority?: 2 | 3
  } = {}
): ColumnDef<TableSetup, TRow> {
  return {
    id,
    header,
    ...(options.by === undefined ? {} : { accessorFn: options.by }),
    meta: {
      ...(options.right === true ? { align: "right" as const } : {}),
      ...(options.card === undefined ? {} : { card: options.card }),
      ...(options.priority === undefined ? {} : { priority: options.priority }),
    },
    cell: ({ row }: { row: { original: TRow } }) => cell(row.original),
  } as ColumnDef<TableSetup, TRow>
}

/// What a row is as a phone's card: the figure it leads with at the right, a
/// quiet foot under a hairline, and one status where the thumb rests. The
/// first column is its name. Left out, a card is the first column over its
/// other figures, each under its own label.
export interface CardShape<TRow> {
  readonly lead: (row: TRow) => {
    readonly value: React.ReactNode
    readonly caption?: React.ReactNode
    readonly tone?: FigureTone
  }
  readonly foot?: (row: TRow) => React.ReactNode
  readonly status?: (row: TRow) => React.ReactNode
}

const LEAD = "card-lead"
const FOOT = "card-foot"
const STATUS = "card-status"

export function CardTable<TRow>({
  columns,
  rows,
  getRowId,
  card,
  apart = true,
  onRowClick,
  isSelected,
  empty,
}: {
  readonly columns: ColumnDef<TableSetup, TRow>[]
  readonly rows: readonly TRow[]
  /// A function that does not change from one render to the next.
  readonly getRowId: (row: TRow) => string
  readonly card?: CardShape<TRow>
  /// On a phone each row is a card of its own. Off, they are rows divided by
  /// hairlines, for a list that already stands in a card (a `card` shape is
  /// always one card to a row).
  readonly apart?: boolean
  /// A row that opens something. Left out, the rows only read.
  readonly onRowClick?: (row: TRow) => void
  readonly isSelected?: (row: TRow) => boolean
  readonly empty?: React.ReactNode
}) {
  const phone = useLayout() === "phone"

  /// With a `card` shape the card's own columns join the table on a phone
  /// and never on a desk, where the table keeps giving up columns by priority
  /// when its card is narrow; the desk columns leave the card, bar the first,
  /// which is its name.
  const shaped = useMemo<ColumnDef<TableSetup, TRow>[]>(() => {
    if (card === undefined || !phone) return columns
    const own = (id: string, role: CardRole, draw: (row: TRow) => React.ReactNode) =>
      ({
        id,
        header: "",
        enableHiding: false,
        enableSorting: false,
        meta: { card: role },
        cell: ({ row }: { row: { original: TRow } }) => draw(row.original),
      }) as ColumnDef<TableSetup, TRow>
    return [
      ...columns.map(
        (column, index) =>
          ({
            ...column,
            meta: { ...column.meta, card: index === 0 ? "title" : "hide" },
          }) as ColumnDef<TableSetup, TRow>
      ),
      own(LEAD, "lead", (row) => {
        const lead = card.lead(row)
        return (
          <CardFigure
            value={lead.value}
            caption={lead.caption}
            tone={lead.tone}
          />
        )
      }),
      ...(card.foot === undefined
        ? []
        : [
            own(FOOT, "foot", (row) => (
              <CardFoot>{card.foot?.(row)}</CardFoot>
            )),
          ]),
      ...(card.status === undefined
        ? []
        : [own(STATUS, "status", (row) => card.status?.(row))]),
    ]
  }, [columns, card, phone])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows as TRow[],
        columns: shaped,
        getRowId,
      }),
      [rows, shaped, getRowId]
    )
  )
  return (
    <DataTable<TRow>
      table={table}
      onRowClick={onRowClick}
      isSelected={isSelected}
      empty={empty}
      cardSort={false}
      cardsApart={apart}
      cardLead={card !== undefined && phone}
    />
  )
}
