import type { ComponentProps } from "react"

import { Card } from "@/components/ui/card"
import { CardGroup, CardList } from "@/components/ui/card-list"
import { LeadCard } from "@/components/ui/lead-card"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { OpenRows } from "@/components/ui/open-rows"
import { EmptyState } from "@/components/ui/states"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"

/// A list that is lead-figure cards on a phone and the hub's table on a desk —
/// one declaration, two readings. Written for the Money and Promotions screens;
/// any list whose rows are records with a figure can use it.

/// What a lead card is given: the record's name over its code, the one figure,
/// and a foot. The card's own props, so a screen's `card` function is checked
/// against the kit.
export type CardTableCard = Omit<ComponentProps<typeof LeadCard>, "onOpen">

/// A list that is cards on a phone and the hub's table on a desk — one
/// declaration, two readings.
///
/// A phone shows each row as the uniform lead-figure card (`card`), under a
/// heading that folds and carries a figure (`aside`). From 48rem up it is the
/// table (`columns`) in a card with the same heading as its band, because a
/// mouse has the width to compare rows across and a thumb has not.
///
/// A row that opens a record (`onOpen`) is the whole card on a phone; on a desk
/// its first cell carries an `OpenButton` (the table is wrapped in `OpenRows`),
/// which is where the keyboard's way in lives.
export function CardTable<T>({
  title,
  sub,
  aside,
  rows,
  columns,
  rowKey,
  card,
  onOpen,
  empty,
  foot,
  roomy = false,
}: {
  title?: React.ReactNode
  /// The desk's line under the heading.
  sub?: React.ReactNode
  /// A figure or a count beside the heading: "Rp 120.000".
  aside?: React.ReactNode
  rows: readonly T[]
  columns: readonly ListColumn<T>[]
  rowKey: (row: T) => string
  card: (row: T) => CardTableCard
  onOpen?: (row: T) => void
  empty: React.ReactNode
  /// Under the rows, on both: "Showing 100 of 240", a "Show more" button.
  foot?: React.ReactNode
  roomy?: boolean
}) {
  const phone = useLayout() === "phone"

  if (phone) {
    const cards =
      rows.length === 0 ? (
        <EmptyState art={null}>{empty}</EmptyState>
      ) : (
        rows.map((row) => (
          <LeadCard
            key={rowKey(row)}
            onOpen={onOpen === undefined ? undefined : () => onOpen(row)}
            {...card(row)}
          />
        ))
      )
    return (
      <>
        {title !== undefined ? (
          <CardGroup heading={title} aside={aside}>
            {cards}
          </CardGroup>
        ) : (
          <CardList>{cards}</CardList>
        )}
        {foot}
      </>
    )
  }

  const table = (
    <ListTable
      roomy={roomy}
      rows={rows}
      columns={columns}
      rowKey={rowKey}
      empty={empty}
    />
  )
  return (
    <Card>
      {title !== undefined && (
        <CardTableHead title={title} sub={sub} aside={aside} />
      )}
      {onOpen === undefined ? (
        table
      ) : (
        <OpenRows
          onOpen={(key) => {
            const row = rows.find((one) => rowKey(one) === key)
            if (row !== undefined) onOpen(row)
          }}
        >
          {table}
        </OpenRows>
      )}
      {foot}
    </Card>
  )
}

/// The band a desk card opens with: what it is, the span or count it covers,
/// and anything that belongs beside the title — a total, a control.
export function CardTableHead({
  title,
  sub,
  aside,
  className,
}: {
  title: React.ReactNode
  sub?: React.ReactNode
  aside?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-hairline px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-card-title font-semibold text-ink">{title}</h2>
        {sub !== undefined && (
          <p className="mt-0.5 text-meta text-mute">{sub}</p>
        )}
      </div>
      {aside !== undefined && (
        <div className="flex shrink-0 items-center gap-2 text-metric font-semibold text-ink tabular-nums">
          {aside}
        </div>
      )}
    </div>
  )
}
