import { ChevronDown, Search, Tag as TagIcon } from "lucide-react"
import { useId, useMemo, useState } from "react"

import { DockSelection } from "@/components/shell/dock-selection"
import { DockTools, type DockStatus } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/states"
import { ago, count, quantity, sku as skuNumber } from "@/lib/format"
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
      className="mt-0.5 flex min-w-0 items-center gap-2 text-[0.9375rem] text-mute"
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
  /// The supplier's Allot all: straight into the grid with every article it
  /// shows, nothing ticked first (owner, 15 Oct 2026).
  const allotAll = (supplier: PickSupplier) =>
    makeAllotment([
      {
        supplier: supplier.id,
        articles: supplier.articles.map((one) => one.id),
      },
    ])
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
            className="h-9 w-full rounded-inner border border-hairline-2 bg-canvas pr-3 pl-9 text-[0.9375rem] text-ink shadow-soft outline-none placeholder:text-body focus:border-accent pointer-coarse:h-11"
          />
        </span>
      </div>

      {/* A card per supplier, its articles as cards inside it — the New
          Articles page's queue (`setups.tsx` CardGrid), with a tick where
          that page opens a form (owner, 15 Oct 2026). */}
      {status !== null || shown.length === 0 ? (
        <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
          {status ?? (
            <EmptyState>
              {suppliers.length === 0
                ? "Nothing left to allot. Every piece in the warehouse has been given to a store."
                : `No supplier, article or order matches “${query.trim()}”.`}
            </EmptyState>
          )}
        </div>
      ) : (
        <div className="@container flex flex-col gap-3">
          {shown.map((supplier) => (
            <SupplierFold
              key={supplier.id}
              supplier={supplier}
              open={words.length > 0 || !folded.has(supplier.id)}
              ticked={selection.get(supplier.id)}
              onFold={() => fold(supplier.id)}
              onToggle={(article) => toggle(supplier, article)}
              onAllotAll={() => allotAll(supplier)}
            />
          ))}
        </div>
      )}

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

/// One supplier, as New Articles draws it (`SupplierCard` in `setups.tsx`):
/// a card whose heading folds it, the tally beside the name, and one blue
/// button that opens the grid on every article it shows.
function SupplierFold({
  supplier,
  open,
  ticked: chosen,
  onFold,
  onToggle,
  onAllotAll,
}: {
  supplier: PickSupplier
  open: boolean
  /// This supplier's ticked articles, if any.
  ticked: ReadonlySet<string> | undefined
  onFold: () => void
  onToggle: (article: string) => void
  onAllotAll: () => void
}) {
  const body = useId()
  return (
    <section
      aria-label={supplier.name}
      className="rounded-[0.625rem] border border-hairline bg-canvas"
    >
      <div className="flex items-center gap-3 pr-4 @2xl:pr-5">
        <button
          type="button"
          onClick={onFold}
          aria-expanded={open}
          aria-controls={body}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-[0.625rem] py-3 pl-5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 [@media(hover:hover)]:hover:bg-soft"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-mute transition-transform duration-200 ease-out",
              !open && "-rotate-90"
            )}
          />
          <h2 className="min-w-0 flex-1 text-[1.0625rem] font-semibold [overflow-wrap:anywhere] text-ink">
            {supplier.name}
          </h2>
          <span className="text-[0.9375rem] whitespace-nowrap text-mute tabular-nums">
            {count(supplier.articles.length)}{" "}
            {supplier.articles.length === 1 ? "article" : "articles"} ·{" "}
            {quantity(supplier.free)}
          </span>
        </button>
        <Button
          variant="primary"
          size="card"
          aria-label={`Allot every article of ${supplier.name}`}
          onClick={onAllotAll}
        >
          Allot all
        </Button>
      </div>
      <div
        id={body}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-2 px-4 pb-4 @2xl:px-5 @2xl:pb-5">
            {supplier.articles.map((article) => (
              <ArticleChoice
                key={article.id}
                article={article}
                checked={chosen?.has(article.id) ?? false}
                onToggle={() => onToggle(article.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function colourText(colours: PickArticle["colours"]): string {
  const names = colours.map((one) => one.name)
  return names.length > 2
    ? `${names.slice(0, 2).join(", ")}, +${names.length - 2}`
    : names.join(", ")
}

function sizeText(article: PickArticle): string {
  const { sizes } = article
  return article.sizesRun
    ? `${sizes[0]}–${sizes[sizes.length - 1]}`
    : sizes.join(", ")
}

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

/// One article as a card inside its supplier's, New Articles' `LineCard`
/// with a box: the photograph, the name over its number, its colours and
/// sizes, then the pieces free and how long ago it was set up. The whole card
/// ticks it.
function ArticleChoice({
  article,
  checked,
  onToggle,
}: {
  article: PickArticle
  checked: boolean
  onToggle: () => void
}) {
  const sizes = sizeText(article)
  return (
    <label
      className={cn(
        "grid w-full cursor-pointer grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-4 rounded-[0.625rem] border px-4 py-3",
        "transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.99]",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40",
        checked
          ? "border-accent bg-accent-bg"
          : "border-hairline bg-canvas [@media(hover:hover)]:hover:bg-soft"
      )}
      title={[article.divisionName, ...article.tagNames]
        .filter(Boolean)
        .join(" · ")}
    >
      <input
        type="checkbox"
        aria-label={`Select ${article.name}`}
        checked={checked}
        onChange={onToggle}
        className="size-5 shrink-0 cursor-pointer accent-accent md:size-4"
      />
      <ArticleThumb
        url={article.image}
        name={article.name}
        division={article.division}
        colour={article.colours[0]?.name}
        articleCode={article.code}
        className="size-12 rounded-[0.5rem] border border-hairline"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[0.9375rem] font-medium break-words text-ink">
          {article.name}
        </span>
        {/* Three lines (owner, 21 Oct 2026): the name, the article number
            with its colours and sizes, its SKU numbers. */}
        <span className="flex flex-wrap items-center gap-x-2.5 text-[0.9375rem] text-mute">
          <span className="font-mono text-body">{article.code}</span>
          {(article.colours.length > 0 || sizes !== "") && (
            <span
              className="min-w-0"
              title={article.colours.map((one) => one.name).join(", ")}
            >
              {article.colours.length > 0 && (
                <>
                  {article.colours.slice(0, 2).map((one) => (
                    <Swatch key={one.name} hex={one.hex} />
                  ))}
                  {colourText(article.colours)}
                </>
              )}
              {article.colours.length > 0 && sizes !== "" && " · "}
              {sizes}
            </span>
          )}
        </span>
        {article.skuCodes.length > 0 && (
          <span
            className="truncate font-mono text-[0.9375rem] text-mute"
            title={article.skuCodes.map(skuNumber).join(", ")}
          >
            {article.skuCodes.map(skuNumber).join(", ")}
          </span>
        )}
      </span>
      <span className="flex flex-col items-end gap-0.5 tabular-nums">
        <span className="text-[0.9375rem] font-semibold whitespace-nowrap text-ink">
          {quantity(article.free)}
        </span>
        {article.setupAt && (
          <span className="text-[0.9375rem] whitespace-nowrap text-mute">
            {ago(article.setupAt)}
          </span>
        )}
      </span>
    </label>
  )
}
