import { ChevronRight } from "lucide-react"
import { Fragment, useState } from "react"

import { useShopName } from "@/components/operations/outbound-papers"
import { Checkbox, Input } from "@/components/ui/field"
import { count } from "@/lib/format"
import type { AllotmentLine } from "@/lib/queries/inventory"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import {
  floorOf,
  spreadOf,
  stagesOf,
  storesOf,
  targetOf,
} from "@/screens/allotment/amend-data"
import { ArticleThumb } from "@/screens/allotment/article-thumb"

/// MD's allotment sheet, read and edited as STORES (allotment-ops-prototype,
/// "MD · Allotments", approved 15 Oct 2026). MD is a policy maker: a store is
/// one row with its total and where its pieces are; opening it shows its
/// articles; sizes are never shown.
///
/// ```
/// ☐  ›  Kemang                 120   +20   To pick 40 · In stock 30 · Dispatched 50 · Received 0
///          Polo Pique Basic      60   +10
///          PLO-PQ-BS
/// ```
///
/// Editing types a store's total, or one article's total for a store; the app
/// spreads it over the sizes underneath (`spreadOf`), never under what is
/// already dispatched — going lower says so in a toast and stops at the floor.
/// The ticks pick the stores a Cancel is for. The same list on every width: a
/// phone folds the stage figures into a line under the store's name instead
/// of columns, so nothing scrolls sideways.

/// A store's total, or an article's total for a store, as a box. What is
/// typed is taken on leaving the box (Enter, Tab, a tap elsewhere, the phone's
/// number sheet closing) — never per keystroke: "1" on the way to "15" would
/// spread one piece and then lose the proportions.
function TotalInput({
  value,
  floor,
  where,
  label,
  onCommit,
}: {
  value: number
  /// What is already dispatched: the least it takes.
  floor: number
  /// The store, for the toast that refuses going under the floor.
  where: string
  label: string
  onCommit: (total: number) => void
}) {
  const [text, setText] = useState(String(value))
  // The figure follows the draft when something else moved it (the store's
  // box after an article's, or Discard) — "adjusting state during render".
  const [was, setWas] = useState(value)
  if (value !== was) {
    setWas(value)
    setText(String(value))
  }
  const commit = () => {
    let total = Number.parseInt(text, 10)
    if (Number.isNaN(total) || total < 0) total = 0
    if (total < floor) {
      total = floor
      toast(
        `${count(floor)} already dispatched to ${where} · ask the store to return them`
      )
    }
    setText(String(total))
    if (total !== value) onCommit(total)
  }
  return (
    <Input
      inputMode="numeric"
      aria-label={label}
      padLabel={label}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
      }}
      onClick={(event) => event.stopPropagation()}
      className="h-9 w-24 text-right tabular-nums"
    />
  )
}

/// "+20", "−30", or a quiet dash.
function Delta({ n }: { n: number }) {
  if (n === 0) return <span className="text-faint">—</span>
  return (
    <span className={cn("tabular-nums", n < 0 ? "text-warn-fg" : "text-ink")}>
      {n > 0 ? "+" : "−"}
      {count(Math.abs(n))}
    </span>
  )
}

/// A figure in a stage column; nothing is a quiet 0.
function Figure({ n, strong = false }: { n: number; strong?: boolean }) {
  return (
    <span
      className={cn(
        "tabular-nums",
        n === 0 ? "text-faint" : strong ? "font-medium text-ink" : "text-ink"
      )}
    >
      {count(n)}
    </span>
  )
}

/// What a store's row says under its name: pieces the warehouse still has to
/// put back, a store whose share MD cancelled, one that has everything.
function noteOf(lines: readonly AllotmentLine[]): {
  text: string
  tone: string
} | null {
  const s = stagesOf(lines)
  const putBack = lines.reduce(
    (sum, line) => sum + (line.takeout_pending_quantity ?? 0),
    0
  )
  if (putBack > 0)
    return {
      text: `Put back ${count(putBack)} · warehouse`,
      tone: "text-warn-fg",
    }
  const asked = lines.reduce((sum, line) => sum + line.quantity, 0)
  if (asked > 0 && s.allotted === 0)
    return { text: "Cancelled", tone: "text-bad-fg" }
  if (s.allotted > 0 && s.dispatched >= s.allotted) {
    if (s.received >= s.dispatched)
      return { text: "Received", tone: "text-ok-fg" }
    // Everything MD still wants is on the road. (A lower target reads the
    // same whether MD edited it or cancelled the rest, so neither is said.)
    return { text: "In transit", tone: "text-info-fg" }
  }
  return null
}

/// Desk columns: tick · name · Allotted · (Change) · To pick · In the
/// warehouse · Dispatched · Received.
const GRID = (ticks: boolean, editing: boolean) =>
  cn(
    "md:grid md:items-center md:gap-x-3",
    ticks && editing
      ? "md:grid-cols-[1.5rem_minmax(0,1fr)_7rem_5rem_6rem_8.5rem_6.5rem_6rem]"
      : ticks
        ? "md:grid-cols-[1.5rem_minmax(0,1fr)_7rem_6rem_8.5rem_6.5rem_6rem]"
        : editing
          ? "md:grid-cols-[minmax(0,1fr)_7rem_5rem_6rem_8.5rem_6.5rem_6rem]"
          : "md:grid-cols-[minmax(0,1fr)_7rem_6rem_8.5rem_6.5rem_6rem]"
  )

export function StoreLines({
  lines,
  draft,
  onDraft,
  selected,
  onSelect,
}: {
  lines: readonly AllotmentLine[]
  /// Editing: each changed line's new target, by line id. Left out, the
  /// list is read.
  draft?: ReadonlyMap<string, number>
  onDraft?: (next: Map<string, number>) => void
  /// The stores ticked for a Cancel. Left out, there are no ticks.
  selected?: ReadonlySet<string>
  onSelect?: (next: Set<string>) => void
}) {
  // The store as the board names it ("C001 · Cikupa"), not the bare id.
  const shop = useShopName()
  const stores = storesOf(lines).map((store) => {
    const named = shop(store.id)
    return named === store.id ? store : { ...store, name: named }
  })
  const editing = draft !== undefined && onDraft !== undefined
  const ticks = selected !== undefined && onSelect !== undefined && !editing
  // Every store opens unfolded (owner, 2026-10-16): the set holds the ones
  // folded by hand, so a store that arrives later is open too.
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const flip = (id: string) =>
    setFolded((was) => {
      const next = new Set(was)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const current = (line: AllotmentLine) => draft?.get(line.id) ?? targetOf(line)
  const sumOf = (group: readonly AllotmentLine[]) =>
    group.reduce((sum, line) => sum + current(line), 0)
  const deltaOf = (group: readonly AllotmentLine[]) =>
    group.reduce((sum, line) => sum + current(line) - targetOf(line), 0)
  /// A new total for these lines: spread over them and written into the draft.
  const set = (group: readonly AllotmentLine[], total: number) => {
    if (onDraft === undefined) return
    const next = new Map(draft)
    for (const [id, to] of spreadOf(group, total, current)) next.set(id, to)
    onDraft(next)
  }
  const tick = (id: string, on: boolean) => {
    if (!ticks || onSelect === undefined) return
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    onSelect(next)
  }
  const every =
    ticks && stores.every((store) => selected?.has(store.id) === true)
  const some = ticks && stores.some((store) => selected?.has(store.id) === true)

  const total = stagesOf(lines)
  const NUM = "hidden text-right text-[0.9375rem] md:block"
  /// The stage figures as one line under the name, on a phone.
  const phoneLine = (group: readonly AllotmentLine[]) => {
    const s = stagesOf(group)
    return (
      <span className="block text-[0.9375rem] text-mute tabular-nums md:hidden">
        To pick {count(s.toPick)} · In stock {count(s.picked + s.packed)} ·
        Dispatched {count(s.dispatched)} · Received {count(s.received)}
      </span>
    )
  }
  const stageCells = (group: readonly AllotmentLine[]) => {
    const s = stagesOf(group)
    return (
      <>
        <span className={NUM}>
          <Figure n={s.toPick} />
        </span>
        <span className={NUM}>
          <Figure n={s.picked + s.packed} />
        </span>
        <span className={NUM}>
          <Figure n={s.dispatched} />
        </span>
        <span className={NUM}>
          <Figure n={s.received} />
        </span>
      </>
    )
  }

  return (
    <div className="flex flex-col rounded-inner border border-hairline">
      <div
        className={cn(
          GRID(ticks, editing),
          "hidden h-11 rounded-t-inner bg-soft px-4 text-[0.9375rem] text-mute md:grid"
        )}
      >
        {ticks && (
          <Checkbox
            label={<span className="sr-only">All stores</span>}
            checked={every}
            indeterminate={some && !every}
            onChange={(on) =>
              onSelect?.(
                on ? new Set(stores.map((store) => store.id)) : new Set()
              )
            }
          />
        )}
        <span>Store</span>
        <span className="text-right">Allotted</span>
        {editing && <span className="text-right">Change</span>}
        <span className="text-right">To pick</span>
        <span className="text-right">In stock</span>
        <span className="text-right">Dispatched</span>
        <span className="text-right">Received</span>
      </div>

      {stores.map((store) => {
        const open = !folded.has(store.id)
        const note = noteOf(store.lines)
        const floor = store.lines.reduce((sum, line) => sum + floorOf(line), 0)
        const on = ticks && selected?.has(store.id) === true
        return (
          <Fragment key={store.id}>
            <div
              className={cn(
                GRID(ticks, editing),
                "flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline px-4 py-3 first:border-t-0 md:min-h-16",
                on && "bg-accent-bg"
              )}
            >
              {ticks && (
                <Checkbox
                  label={<span className="sr-only">{store.name}</span>}
                  checked={on}
                  onChange={(next) => tick(store.id, next)}
                />
              )}
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${open ? "Fold" : "Open"} ${store.name}`}
                onClick={() => flip(store.id)}
                className="flex min-w-0 flex-1 items-start gap-2 text-left"
              >
                <ChevronRight
                  className={cn(
                    "mt-0.5 size-4 shrink-0 text-mute transition-transform duration-150",
                    open && "rotate-90"
                  )}
                />
                <span className="min-w-0">
                  <span className="block font-medium [overflow-wrap:anywhere] text-ink">
                    {store.name}
                  </span>
                  {note !== null && (
                    <span className={cn("block text-[0.9375rem]", note.tone)}>
                      {note.text}
                    </span>
                  )}
                  {phoneLine(store.lines)}
                </span>
              </button>
              <span className="ml-auto flex flex-col items-end text-right text-[0.9375rem] md:ml-0">
                {editing ? (
                  <TotalInput
                    value={sumOf(store.lines)}
                    floor={floor}
                    where={store.name}
                    label={`${store.name} total`}
                    onCommit={(n) => set(store.lines, n)}
                  />
                ) : (
                  <Figure n={sumOf(store.lines)} strong />
                )}
                {editing && (
                  <span className="text-mute md:hidden">
                    <Delta n={deltaOf(store.lines)} />
                  </span>
                )}
              </span>
              {editing && (
                <span className={NUM}>
                  <Delta n={deltaOf(store.lines)} />
                </span>
              )}
              {stageCells(store.lines)}
            </div>

            {open &&
              store.articles.map((article) => {
                const articleFloor = article.lines.reduce(
                  (sum, line) => sum + floorOf(line),
                  0
                )
                return (
                  <div
                    key={article.id}
                    className={cn(
                      GRID(ticks, editing),
                      "flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline bg-soft px-4 py-2.5"
                    )}
                  >
                    {ticks && <span aria-hidden />}
                    <span className="flex min-w-0 flex-1 items-center gap-3 pl-6">
                      <ArticleThumb
                        url={article.image}
                        name={article.name}
                        colour={article.colour}
                        articleCode={article.code}
                      />
                      <span className="min-w-0">
                        <span className="block text-[0.9375rem] [overflow-wrap:anywhere] text-ink">
                          {article.name}
                        </span>
                        <span className="block truncate font-mono text-[0.9375rem] text-mute">
                          {article.code}
                        </span>
                      </span>
                    </span>
                    <span className="ml-auto flex flex-col items-end text-right text-[0.9375rem] md:ml-0">
                      {editing ? (
                        <TotalInput
                          value={sumOf(article.lines)}
                          floor={articleFloor}
                          where={store.name}
                          label={`${article.name} for ${store.name}`}
                          onCommit={(n) => set(article.lines, n)}
                        />
                      ) : (
                        <Figure n={sumOf(article.lines)} />
                      )}
                      {editing && (
                        <span className="text-mute md:hidden">
                          <Delta n={deltaOf(article.lines)} />
                        </span>
                      )}
                    </span>
                    {editing && (
                      <span className={NUM}>
                        <Delta n={deltaOf(article.lines)} />
                      </span>
                    )}
                    {stageCells(article.lines)}
                  </div>
                )
              })}
          </Fragment>
        )
      })}

      <div
        className={cn(
          GRID(ticks, editing),
          "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-b-inner border-t border-hairline bg-soft px-4 py-3 text-[0.9375rem] font-medium text-ink"
        )}
      >
        {ticks && <span aria-hidden />}
        <span className="flex-1">Total</span>
        <span className="ml-auto text-right tabular-nums md:ml-0">
          {count(sumOf(lines))}
        </span>
        {editing && (
          <span className={NUM}>
            <Delta n={deltaOf(lines)} />
          </span>
        )}
        <span className={NUM}>{count(total.toPick)}</span>
        <span className={NUM}>{count(total.picked + total.packed)}</span>
        <span className={NUM}>{count(total.dispatched)}</span>
        <span className={NUM}>{count(total.received)}</span>
      </div>
    </div>
  )
}
