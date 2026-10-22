import { useMemo, useState } from "react"

import { GroupHeading } from "@/components/ui/phone-cards"
import { count, quantity, sku as skuNumber } from "@/lib/format"
import type { AllotmentLine } from "@/lib/queries/inventory"
import { targetOf } from "@/screens/allotment/amend-data"
import { ArticleThumb, colourDigitOf } from "@/screens/allotment/article-thumb"
import { cn } from "@/lib/utils"

/// An allotment's lines for READING on a phone, grouped by store (MD, 9 Oct
/// 2026). Editing is not here: Edit opens the New allotment grid, filled with
/// the allotment (`matrix.tsx`, `allotFrom=edit~<id>`).
///
/// ```
/// Store Kemang  6 SKUs                                          360  ⌄
/// ─────────────────────────────────────────────────────────────
/// Polo Pique Basic · M                                           50
/// PLO-PQ-BS-M
/// ```

/// A store's lines, in the order they are read.
interface Store {
  readonly id: string
  readonly name: string
  readonly lines: AllotmentLine[]
}

/// A shop's own id, shortened the way the allotment lists shorten it —
/// `store-04` → `04` — for the line that has no name (§14 #17: the raw id is
/// never the label).
function nameOf(line: AllotmentLine): string {
  return (
    line.destination_name ??
    (line.destination_id.replace(/^store-?/i, "") || line.destination_id)
  )
}

function storesOf(lines: readonly AllotmentLine[]): Store[] {
  const byId = new Map<string, Store>()
  for (const line of lines) {
    const store = byId.get(line.destination_id) ?? {
      id: line.destination_id,
      name: nameOf(line),
      lines: [],
    }
    store.lines.push(line)
    byId.set(line.destination_id, store)
  }
  return [...byId.values()]
    .sort((left, right) =>
      left.id.localeCompare(right.id, undefined, { numeric: true })
    )
    .map((store) => ({
      ...store,
      lines: store.lines.sort(
        (left, right) =>
          left.article_name.localeCompare(right.article_name) ||
          (left.colour ?? "").localeCompare(right.colour ?? "") ||
          (left.size ?? "").localeCompare(right.size ?? "", undefined, {
            numeric: true,
          })
      ),
    }))
}

/// More lines than this and only the first store starts open: a size run to
/// thirteen shops is a long page, and the heading of each says how it stands.
const OPEN_ALL_UP_TO = 14

/// The stores of an allotment's lines and which of them are folded.
function useStoreFolds(lines: readonly AllotmentLine[]) {
  const stores = useMemo(() => storesOf(lines), [lines])
  const [folded, setFolded] = useState<ReadonlySet<string>>(() =>
    lines.length > OPEN_ALL_UP_TO
      ? new Set(stores.slice(1).map((store) => store.id))
      : new Set()
  )
  const toggle = (id: string) =>
    setFolded((was) => {
      const next = new Set(was)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return { stores, folded, toggle }
}

/// A line's name: the article, then its colour and size when it has them.
function lineName(line: AllotmentLine): string {
  const variant = [line.colour, line.size].filter(Boolean).join(" · ")
  return variant ? `${line.article_name} · ${variant}` : line.article_name
}

/// "6 SKUs", "1 SKU".
function skusOf(n: number): string {
  return `${count(n)} ${n === 1 ? "SKU" : "SKUs"}`
}

/// The allotment's lines for READING, on a phone — the desk keeps its
/// store-by-column matrix, which is wider than 414px and so scrolled sideways.
/// A heading per store with its total, folded shut past the first when there
/// are many, one stacked row per SKU (the article · colour · size over the SKU
/// code, the quantity at the right) and a Total row to close.
export function ReadLines({ lines }: { lines: readonly AllotmentLine[] }) {
  const { stores, folded, toggle } = useStoreFolds(lines)
  const total = lines.reduce((sum, line) => sum + targetOf(line), 0)

  return (
    <div className="flex flex-col gap-3">
      {stores.map((store) => {
        const open = !folded.has(store.id)
        const sum = store.lines.reduce((acc, line) => acc + targetOf(line), 0)
        return (
          <section key={store.id}>
            <GroupHeading
              title={store.name}
              count={skusOf(store.lines.length)}
              total={quantity(sum)}
              open={open}
              onToggle={() => toggle(store.id)}
            />
            {open && (
              <ul className="flex flex-col">
                {store.lines.map((line, at) => {
                  const target = targetOf(line)
                  // The photograph rides on the first line of a colourway, so
                  // a size run is one picture; the box is kept on the rest so
                  // the names line up.
                  const above = store.lines[at - 1]
                  const lead =
                    above === undefined ||
                    above.article_id !== line.article_id ||
                    above.colour !== line.colour
                  return (
                    <li
                      key={line.id}
                      className="flex items-start justify-between gap-3 border-t border-hairline py-3"
                    >
                      {lead ? (
                        <ArticleThumb
                          url={line.image_url}
                          name={line.article_name}
                          colour={line.colour}
                          articleCode={line.article_code}
                          digit={colourDigitOf(line.article_code, line.sku_code)}
                        />
                      ) : (
                        <span aria-hidden className="size-8 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="block text-[0.9375rem] leading-5 text-ink [overflow-wrap:anywhere]">
                          {lineName(line)}
                        </span>
                        <span className="block truncate font-mono text-[0.9375rem] text-mute">
                          {skuNumber(line.sku_code)}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 text-right text-[0.9375rem] leading-5 tabular-nums",
                          target > 0 ? "text-ink" : "text-faint"
                        )}
                      >
                        {target > 0 ? count(target) : "—"}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
      <div className="flex items-baseline justify-between gap-3 rounded-inner bg-soft px-3 py-3 text-[0.9375rem] font-medium text-ink">
        <span>Total</span>
        <span className="tabular-nums">{quantity(total)}</span>
      </div>
    </div>
  )
}
