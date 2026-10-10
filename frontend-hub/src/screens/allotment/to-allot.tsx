import { ChevronRight, Search, Tag as TagIcon } from "lucide-react"
import { useMemo, useState } from "react"

import { DockSelection } from "@/components/shell/dock-selection"
import { DockTools, type DockStatus } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/states"
import { count, day, dayMonth, quantity } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  asPicks,
  pickedOf,
  useAllotSelection,
  useMakeAllotment,
  type PickArticle,
  type PickSupplier,
} from "./to-allot-data"
import { ArticleThumb } from "./article-thumb"

/// The Unallotted tab of the Allotments page — see `to-allot-data.tsx` for
/// what it reads and how the grid walks the suppliers ticked.

/// The header's button: the grid for exactly the ticked articles, supplier by
/// supplier.
export function MakeAllotmentButton({
  suppliers,
}: {
  suppliers: readonly PickSupplier[]
}) {
  const { selection } = useAllotSelection()
  const make = useMakeAllotment()
  const picked = pickedOf(suppliers, selection)
  return (
    <Button
      variant="primary"
      disabled={picked.length === 0}
      onClick={() => make(asPicks(picked))}
    >
      Make new allotment
    </Button>
  )
}

/// The article number, division and tags, on the line under the name.
///
/// The tags are plain muted words behind a tag glyph rather than chips (house
/// rule, 28 Sep 2026), and the glyph is what keeps them from reading as part
/// of the number: "00000003 · Basic" said nothing about which half was a tag.
export function ArticleMeta({
  group,
}: {
  group: {
    readonly code: string
    readonly divisionName: string
    readonly tagNames: readonly string[]
  }
}) {
  return (
    <span
      className="mt-0.5 flex min-w-0 items-center gap-2 text-[0.875rem] text-mute"
      title={[group.divisionName, ...group.tagNames]
        .filter(Boolean)
        .join(" · ")}
    >
      <span className="shrink-0 tabular-nums">{group.code}</span>
      {group.divisionName !== "" && (
        <span className="truncate text-body">{group.divisionName}</span>
      )}
      {group.tagNames.length > 0 && (
        <span className="flex min-w-0 items-center gap-1">
          <TagIcon className="size-3.5 shrink-0" aria-label="Tags" />
          <span className="truncate">{group.tagNames.join(", ")}</span>
        </span>
      )}
    </span>
  )
}

/// Every word typed has to be somewhere in the text.
function matches(words: readonly string[], ...texts: string[]): boolean {
  const haystack = texts.join(" ").toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/// The Unallotted tab: a search, the suppliers as folds, and the selection's
/// bar at the foot.
export function ToAllot({
  suppliers,
  status,
  dockStatus,
}: {
  suppliers: readonly PickSupplier[]
  /// Drawn in place of the list while the stock is read, or when it failed.
  status: React.ReactNode | null
  /// The page's tabs as the dock's status button, on a phone.
  dockStatus?: DockStatus
}) {
  const { selection, select: onSelection } = useAllotSelection()
  const makeAllotment = useMakeAllotment()
  const [query, setQuery] = useState("")
  /// Every supplier starts open (owner, 2 Oct 2026); this holds the ones the
  /// person folded away.
  const [folded, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const words = useMemo(
    () => query.toLowerCase().split(/\s+/).filter(Boolean),
    [query]
  )

  /// What the search leaves: a supplier whose name answers keeps every
  /// article; otherwise only the articles that answer, by name, number or
  /// the order they came on.
  const shown = useMemo(
    () =>
      suppliers
        .map((supplier) =>
          words.length === 0 || matches(words, supplier.name)
            ? supplier
            : {
                ...supplier,
                articles: supplier.articles.filter((one) =>
                  matches(
                    words,
                    one.name,
                    one.code,
                    ...one.orders,
                    ...one.colours.map((colour) => colour.name),
                    ...one.sizes
                  )
                ),
              }
        )
        .filter((supplier) => supplier.articles.length > 0),
    [suppliers, words]
  )

  /// What is ticked and still free, supplier by supplier in the list's order.
  const picked = pickedOf(suppliers, selection)
  const articleCount = picked.reduce(
    (total, one) => total + one.articles.length,
    0
  )
  const pieces = picked.reduce(
    (total, one) =>
      total + one.articles.reduce((sum, article) => sum + article.free, 0),
    0
  )
  const onMake = () => makeAllotment(asPicks(picked))
  const selecting = articleCount > 0

  /// Writes one supplier's ticks back, every other supplier's kept, in the
  /// list's order.
  const tick = (supplier: string, next: ReadonlySet<string>) => {
    const all = new Map(selection)
    if (next.size === 0) all.delete(supplier)
    else all.set(supplier, next)
    onSelection(
      suppliers.flatMap((one) => {
        const ticked = all.get(one.id)
        return ticked ? [{ supplier: one.id, articles: [...ticked] }] : []
      })
    )
  }
  const toggle = (supplier: PickSupplier, article: string) => {
    const next = new Set(selection.get(supplier.id))
    if (next.has(article)) next.delete(article)
    else next.add(article)
    tick(supplier.id, next)
  }
  /// The supplier's box: ticks every article it shows, or clears them.
  const toggleAll = (supplier: PickSupplier) => {
    const mine = selection.get(supplier.id)
    const all =
      mine !== undefined && supplier.articles.every((one) => mine.has(one.id))
    const next = new Set(mine)
    for (const one of supplier.articles)
      if (all) next.delete(one.id)
      else next.add(one.id)
    tick(supplier.id, next)
  }
  const fold = (id: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const make = (
    <Button variant="primary" disabled={articleCount === 0} onClick={onMake}>
      Make new allotment
    </Button>
  )

  return (
    <div className="flex min-w-0 flex-col">
      {/* On a phone the search is the dock's, and while articles are ticked the
          dock is the selection (`DockSelection`). */}
      {selecting ? (
        <DockSelection
          summary={`${count(articleCount)} selected`}
          onClear={() => onSelection([])}
          action={{ label: "Make Allotment", onClick: onMake }}
        />
      ) : (
        <DockTools
          search={{
            value: query,
            onChange: setQuery,
            label: "Search Articles",
          }}
          status={dockStatus}
        />
      )}
      <div className="mb-4 flex items-center max-md:hidden">
        <span className="relative w-full md:max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-line-ico" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search supplier, article or order"
            className="h-9 w-full rounded-inner border border-hairline-2 bg-canvas pr-3 pl-9 text-[0.875rem] text-ink shadow-soft outline-none placeholder:text-body focus:border-accent pointer-coarse:h-11"
          />
        </span>
      </div>

      {/* A desk reads one card of suppliers; a phone reads a card each, with a
          gap between (owner, 2026-10-06). */}
      <div
        className={cn(
          status === null && shown.length > 0
            ? "max-md:flex max-md:flex-col max-md:gap-3 md:overflow-hidden md:rounded-card md:border md:border-hairline md:bg-canvas md:shadow-soft"
            : "overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft"
        )}
      >
        {status ?? (
          <>
            {shown.length === 0 ? (
              <EmptyState>
                {suppliers.length === 0
                  ? "Nothing left to allot. Every piece in the warehouse has been given to a store."
                  : `No supplier, article or order matches “${query.trim()}”.`}
              </EmptyState>
            ) : (
              shown.map((supplier) => (
                <SupplierFold
                  key={supplier.id}
                  supplier={supplier}
                  open={words.length > 0 || !folded.has(supplier.id)}
                  ticked={selection.get(supplier.id)}
                  onFold={() => fold(supplier.id)}
                  onToggle={(article) => toggle(supplier, article)}
                  onToggleAll={() => toggleAll(supplier)}
                />
              ))
            )}
          </>
        )}
      </div>

      {articleCount > 0 && (
        <div className="sticky bottom-5 z-20 mx-auto mt-5 flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-card border border-hairline-strong bg-canvas px-5 py-3 shadow-[0_10px_32px_-8px_rgb(0_0_0/0.22)] transition-[opacity,translate] duration-200 ease-(--ease-out) max-md:hidden starting:translate-y-3 starting:opacity-0 motion-reduce:starting:translate-none">
          <span className="text-[0.9375rem] text-ink tabular-nums">
            <span className="font-semibold">{count(articleCount)}</span>{" "}
            {articleCount === 1 ? "article" : "articles"} ·{" "}
            <span className="font-semibold">{count(picked.length)}</span>{" "}
            {picked.length === 1 ? "supplier" : "suppliers"} ·{" "}
            <span className="font-semibold">{count(pieces)}</span> pcs selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="quiet" onClick={() => onSelection([])}>
              Clear
            </Button>
            {make}
          </div>
        </div>
      )}
    </div>
  )
}

/// One supplier: a heading that folds, with a box that ticks all of it, and
/// its articles under it when open.
function SupplierFold({
  supplier,
  open,
  ticked: chosen,
  onFold,
  onToggle,
  onToggleAll,
}: {
  supplier: PickSupplier
  open: boolean
  /// This supplier's ticked articles, if any.
  ticked: ReadonlySet<string> | undefined
  onFold: () => void
  onToggle: (article: string) => void
  onToggleAll: () => void
}) {
  const ticked = chosen
    ? supplier.articles.filter((one) => chosen.has(one.id)).length
    : 0
  const mine = ticked > 0
  const all = mine && ticked === supplier.articles.length

  return (
    <section className="border-b border-hairline max-md:overflow-hidden max-md:rounded-card max-md:border max-md:bg-canvas max-md:shadow-soft">
      <div
        className={cn(
          "flex min-h-14 items-center gap-3 px-5",
          mine ? "bg-accent-bg" : "bg-canvas"
        )}
      >
        <label className="-m-2 flex size-10 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            aria-label={`Select every article of ${supplier.name}`}
            checked={all}
            ref={(node) => {
              if (node) node.indeterminate = ticked > 0 && !all
            }}
            onChange={onToggleAll}
            className="size-4 cursor-pointer accent-ink"
          />
        </label>
        <button
          type="button"
          onClick={onFold}
          aria-expanded={open}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 text-left"
        >
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-mute transition-transform duration-150",
              open && "rotate-90"
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.9375rem] font-medium text-ink">
              {supplier.name}
            </span>
            <span className="block truncate text-[0.875rem] text-mute tabular-nums">
              {count(supplier.articles.length)}{" "}
              {supplier.articles.length === 1 ? "article" : "articles"} ·{" "}
              {quantity(supplier.free)} free
              {ticked > 0 && (
                <span className="text-accent"> · {count(ticked)} selected</span>
              )}
            </span>
          </span>
        </button>
      </div>
      {open && (
        <div className="@container">
          <ColumnHeader />
          {supplier.articles.map((article) => (
            <ArticleChoice
              key={article.id}
              article={article}
              checked={chosen?.has(article.id) ?? false}
              onToggle={() => onToggle(article.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/// The columns an article row and the fold's header share, from 40rem of
/// list width; narrower, a row stacks into a card.
const COLUMNS =
  "@min-[40rem]:grid @min-[40rem]:grid-cols-[1rem_minmax(0,3fr)_5rem_minmax(0,1.7fr)_minmax(0,1fr)_6.5rem] @min-[40rem]:gap-x-4"

/// Inset under the supplier's name, the same for the header and the rows.
const INSET = "pr-5 pl-5 md:pl-12"

/// The colours named on a row: the first two, and how many more.
function colourText(colours: PickArticle["colours"]): string {
  const names = colours.map((one) => one.name)
  return names.length > 2
    ? `${names.slice(0, 2).join(", ")}, +${names.length - 2}`
    : names.join(", ")
}

/// "S – XL" for an unbroken run of the size book, else the sizes listed.
function sizeText(article: PickArticle): string {
  const { sizes } = article
  return article.sizesRun
    ? `${sizes[0]} – ${sizes[sizes.length - 1]}`
    : sizes.join(", ")
}

/// The slim row of column names at the top of an open fold.
function ColumnHeader() {
  return (
    <div
      aria-hidden
      className={cn(
        "hidden h-10 items-center border-t border-hairline text-[0.875rem] text-mute",
        COLUMNS,
        INSET
      )}
    >
      <span />
      <span>Article</span>
      <span className="text-right">Quantity</span>
      <span>Colors</span>
      <span>Sizes</span>
      <span>Setup date</span>
    </div>
  )
}

/// One colour: a swatch, or an outlined dot where the master has none.
function Swatch({ hex }: { hex: string | null }) {
  return (
    <span
      className={cn(
        "mr-1.5 inline-block size-2.5 shrink-0 rounded-full border align-[0.05em]",
        hex ? "border-hairline-strong" : "border-dashed border-mute"
      )}
      style={hex ? { backgroundColor: hex } : undefined}
    />
  )
}

/// One article: a box, the photograph, what it is, how much is free, its
/// colours and sizes, and when it was set up.
function ArticleChoice({
  article,
  checked,
  onToggle,
}: {
  article: PickArticle
  checked: boolean
  onToggle: () => void
}) {
  const colours = article.colours.map((one) => one.name).join(", ")
  const sizes = article.sizes.join(", ")
  const summary = [
    colourText(article.colours),
    sizeText(article).replace(" – ", "–"),
  ]
    .filter(Boolean)
    .join(" · ")
  return (
    <label
      className={cn(
        "flex min-h-16 cursor-pointer items-center gap-3 border-t border-hairline py-2.5 hover:bg-soft",
        COLUMNS,
        INSET,
        checked && "bg-accent-bg/60"
      )}
    >
      <input
        type="checkbox"
        aria-label={`Select ${article.name}`}
        checked={checked}
        onChange={onToggle}
        className="size-5 shrink-0 cursor-pointer accent-ink md:size-4"
      />
      <span
        className="flex min-w-0 flex-1 items-center gap-3"
        title={[article.divisionName, ...article.tagNames]
          .filter(Boolean)
          .join(" · ")}
      >
        <ArticleThumb
          url={article.image}
          name={article.name}
          division={article.division}
          colour={article.colours[0]?.name}
          articleCode={article.code}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-medium text-ink">
            {article.name}
          </span>
          <span className="block truncate font-mono text-[0.875rem] text-mute">
            {article.code}
          </span>
          <span className="mt-0.5 line-clamp-2 text-[0.875rem] text-body @min-[40rem]:hidden">
            {summary}
          </span>
        </span>
      </span>
      {/* Narrow: the figure stands at the right, the day under it — the same
          lead as a purchase order's card. */}
      <span className="flex shrink-0 flex-col items-end tabular-nums @min-[40rem]:hidden">
        <span className="text-[1.125rem] leading-tight font-semibold text-ink">
          {count(article.free)}
          <span className="text-[0.875rem] font-normal text-mute"> pcs</span>
        </span>
        {article.setupAt && (
          <span className="mt-0.5 text-[0.875rem] text-mute">
            {dayMonth(article.setupAt)}
          </span>
        )}
      </span>
      <span className="hidden text-right text-[0.9375rem] text-ink tabular-nums @min-[40rem]:block">
        {count(article.free)}
        <span className="text-[0.875rem] text-mute"> pcs</span>
      </span>
      <span
        className="hidden min-w-0 items-center gap-2 text-[0.875rem] text-body @min-[40rem]:flex"
        title={colours || undefined}
      >
        {article.colours.length === 0 ? (
          <span className="text-mute">—</span>
        ) : (
          <span className="truncate">
            {article.colours.slice(0, 2).map((one, index) => (
              <span key={one.name}>
                {index > 0 && ", "}
                <Swatch hex={one.hex} />
                {one.name}
              </span>
            ))}
            {article.colours.length > 2 && `, +${article.colours.length - 2}`}
          </span>
        )}
      </span>
      <span
        className="hidden truncate text-[0.875rem] text-body @min-[40rem]:block"
        title={sizes || undefined}
      >
        {sizes === "" ? (
          <span className="text-mute">—</span>
        ) : (
          sizeText(article)
        )}
      </span>
      <span className="hidden text-[0.875rem] text-body tabular-nums @min-[40rem]:block">
        {day(article.setupAt)}
      </span>
    </label>
  )
}
