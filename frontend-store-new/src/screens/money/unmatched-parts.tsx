import { ChevronRight, CircleHelp } from "lucide-react"
import { useMemo } from "react"

import { readColours } from "@/lib/colour-parse"
import { day } from "@/lib/format"
import { Garment } from "@/lib/garment"
import type { UnmatchedSale, UnmatchedStatus } from "@/lib/queries/unmatched"
import { cn } from "@/lib/utils"
import {
  countDocOf,
  kindWord,
  matchedWithOf,
  titleOf,
  variantOf,
} from "@/screens/money/unmatched-model"

/// The 40px tile an article stands in: its drawn garment, or a question mark
/// for an item nobody could name. (The prototype's emoji stand for the same.)
function Thumb({ row }: { row: UnmatchedSale }) {
  const colours = useMemo(
    () =>
      row.colour === null ? [] : readColours(row.colour).map((one) => one.hex),
    [row.colour],
  )
  return (
    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-[0.4375rem] bg-soft-2">
      {row.sku_code === null ? (
        <CircleHelp aria-hidden className="size-5 text-line-ico" />
      ) : (
        <Garment name={titleOf(row)} colours={colours} />
      )}
    </span>
  )
}

/// A table row's first story: the tile, the article, and its variant and SKU
/// under it in grey.
export function ArticleCell({ row }: { row: UnmatchedSale }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Thumb row={row} />
      <span className="flex min-w-0 flex-col leading-[1.45]">
        <span className="truncate text-ink">{titleOf(row)}</span>
        <span className="truncate text-mute">{variantOf(row)}</span>
      </span>
    </span>
  )
}

/// A row as a phone draws it: the article, its variant and SKU, the day and
/// the kind, and where the answer stands once there is one.
export function UnmatchedCard({
  row,
  status,
  onOpen,
}: {
  row: UnmatchedSale
  status: UnmatchedStatus
  onOpen: () => void
}) {
  const answered = row.matched_at === null ? "—" : day(row.matched_at)
  const extra =
    status === "matched"
      ? `${matchedWithOf(row)} · ${answered}`
      : status === "found"
        ? `${countDocOf(row)} · ${answered}`
        : null
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-3 rounded-[0.75rem] border border-hairline bg-canvas p-3.5 text-left text-[0.9375rem]",
        "transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.98]",
      )}
    >
      <Thumb row={row} />
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate font-semibold text-ink">{titleOf(row)}</b>
        <span className="truncate text-mute">{variantOf(row)}</span>
        <span className="truncate text-mute">
          {day(row.sold_at)} · {kindWord(row.kind)}
        </span>
        {extra !== null && <span className="truncate text-mute">{extra}</span>}
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-line-ico" />
    </button>
  )
}
