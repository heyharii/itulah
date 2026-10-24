import { Sheet } from "@/components/ui/sheet"
import { day } from "@/lib/format"
import type { UnmatchedSale } from "@/lib/queries/unmatched"
import {
  kindWord,
  matchedWithOf,
  timeText,
  titleOf,
  typedOf,
  variantOf,
} from "@/screens/money/unmatched-model"
import { useHeld } from "@/screens/stock/open-record"
import { money } from "@itulah/contract/money"

/// One sale this shop could not take from its own stock, opened over the list:
/// what was sold, on which receipt, and — once head office has answered — how.
/// Read-only: a sale is matched at head office, so there is no foot.
///
/// `row` is the one asked for; `undefined` is closed, and the sheet keeps its
/// last record while it slides away.
export function UnmatchedSheet({
  row,
  onClose,
}: {
  row: UnmatchedSale | undefined
  onClose: () => void
}) {
  const held = useHeld(row)
  return (
    <Sheet
      open={row !== undefined}
      onOpenChange={(next) => !next && onClose()}
      title={held === undefined ? "Unmatched sale" : titleOf(held)}
      caption={held === undefined ? undefined : variantOf(held)}
    >
      {held !== undefined && <Info row={held} />}
    </Sheet>
  )
}

/// A short list of label and value, a hairline between: the sheet reads as
/// facts, never as fields.
function Info({ row }: { row: UnmatchedSale }) {
  const rows: [label: string, value: string, figure?: boolean][] = [
    ["Sold", `${day(row.sold_at)} · ${timeText(row.sold_at)}`],
    ["Receipt", row.receipt_no, true],
    ["Cashier", row.cashier_name ?? "—"],
    ["Price", money(row.price_minor)],
    ["Kind", kindWord(row.kind)],
  ]
  const typed = typedOf(row)
  if (typed !== null)
    rows.push([
      "Typed as",
      row.priced_by_name === null
        ? typed
        : `${typed} · priced by ${row.priced_by_name}`,
    ])
  if (row.matched_with !== null || row.matched_at !== null)
    rows.push([
      "Matched",
      row.matched_at === null
        ? matchedWithOf(row)
        : `${matchedWithOf(row)} · ${day(row.matched_at)}`,
    ])
  return (
    <dl className="flex flex-col border-t border-hairline text-[0.9375rem]">
      {rows.map(([label, value, figure]) => (
        <div key={label} className="flex gap-4 border-b border-hairline py-2.5">
          <dt className="w-30 shrink-0 text-mute">{label}</dt>
          <dd className={figure ? "min-w-0 tabular-nums" : "min-w-0"}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
