import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { ChevronRight } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/field"
import { FilterOmnibox } from "@/components/ui/filter-omnibox"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, day, money, moment } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  articlePrices,
  commercialKeys,
  priceScopeFromFilters,
  type ArticlePriceScope,
  describeLevel,
  describeSource,
  isMarkedDown,
  listPriceBooks,
  priceBookDetail,
  priceHistory,
  priceHistoryKeys,
  resolveOffer,
  shelfPrices,
  type PricelistShop,
  type ArticlePricePoint,
  type ArticlePriceRow,
  type ArticlePriceRule,
  type ArticlePriceShop,
  type ArticlePrices,
  type CommercialChannel,
  type PriceScope,
  type PublishReceipt,
  type ShelfPrice,
} from "@/lib/queries/commercial"
import { useFilterState, type FilterField } from "@/lib/filters"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import {
  listTerms,
  vocabularyKeys,
  type MasterTerm,
} from "@/lib/queries/vocabulary"
import { useDebounced } from "@/lib/use-debounced"
import { Named, Quiet } from "@/screens/commercial/parts"
import {
  EditBar,
  PublishSheet,
  SalePriceSheet,
  type CellRef,
  type PendingEdit,
  type PendingMarkdown,
  type PendingPrice,
} from "@/screens/commercial/pricelist-editor"
import { NewPriceSheet, type PriceSeed } from "@/screens/commercial/price-form"
import { markdownDepthBps } from "@/lib/queries/commercial"
import { cellKey, percent } from "@/screens/commercial/shared"

/// The pricelist — what every article costs at every shop, right now, and why.
///
/// This screen replaces four: a per-SKU list, an article-across-shops list, a
/// books list and an overview. They were four readings of one fact, and keeping
/// them apart meant a merchandiser had to hold the join in their head: the
/// per-shop list looked perfectly consistent with itself while one shop quietly
/// charged from a book two versions old, and only the comparison catches that.
///
/// Three things about the data are worth knowing before reading the code.
///
///  1. **The column model is data.** `shops[]` comes back from the endpoint —
///     the STORE origins the centre knows about — so the grid's shape changes
///     when the client opens a branch, and nothing here names a shop.
///  2. **`stack` is the engine's own ranking**, not a sort key. Rank 0 is what
///     the till charges; the rest are the losing candidates, shown dimmed
///     because "why is it this price" is answered by what it beat. Re-sorting
///     the stack would be this screen having a second opinion about a price,
///     which is the failure the shared engine exists to prevent.
///  3. **A style can be priced per size**, so a candidate can cover a range
///     rather than a number. `in_force_for` says how many of the style's
///     products it actually wins, which is why a losing row can still be in
///     force for two sizes out of five. A range is a fact about the data, not a
///     rendering choice: when every size of a style shares one price — which is
///     what a book like "One price per style" produces — every figure here is a
///     single exact number.
///
/// The grid is written here rather than with `<DataTable>`, and that is a
/// deliberate exception to PATTERN.md's "one table grammar". `<DataTable>` is
/// the full-width *list*: one column model declared outside the component, one
/// click target per row. This is a matrix whose columns are data, whose first
/// column has to stay put while the rest scroll, and whose click target is a
/// cell. The header grammar, the hairlines and the hover tint are lifted from
/// `<DataTable>` verbatim so the two read as the same table even though only
/// one of them is one.

/// What the till charges. `undefined` when this shop cannot sell the style at
/// all — absent rather than zero, because no price is not a price.
function winner(shop: ArticlePriceShop): ArticlePriceRule | undefined {
  return shop.stack[0]
}

/// The distinct prices one candidate carries, always as a list.
///
/// A style priced per size makes a rung cover several amounts, and this screen
/// draws every one of them on a row of its own rather than folding them into
/// "Rp 139.000–159.000". A dashed range reads as a single fact and is not one:
/// it hides how many prices there are, which of them the till charges, and
/// leaves the two ends looking like a band that every size falls inside.
///
/// `points` is the server's own breakdown of the same rung it drew the range
/// from, so the rows can never disagree with it. The fallback is for a rung
/// that arrives without one: a price is never dropped just because the
/// breakdown is missing.
function pointsOf(rule: ArticlePriceRule): readonly ArticlePricePoint[] {
  if (rule.points.length > 0) return rule.points
  return [
    {
      unit_price_minor: rule.min_unit_price_minor,
      sku_codes: [],
      in_force_for: rule.in_force_for,
    },
  ]
}

/// A candidate's prices as one sentence, for prose that has no rows to use.
function amounts(rule: ArticlePriceRule): string {
  return pointsOf(rule)
    .map((point) => money(point.unit_price_minor))
    .join(", ")
}

/// The newest book any shop on this row uses **for a given rung**.
///
/// The comparison the "behind" mark is made against, and it is per rung for a
/// reason that cost a rewrite to learn: taking the maximum across a whole row
/// meant one shop's clearance dragged every other shop's *pricelist* into
/// looking stale. A branch that was simply not included in a two-shop cap
/// clearance was marked "behind v9" on the pricelist it shares with everybody
/// — a warning that was not only useless but false.
///
/// Compared like with like, the mark means what it says: this shop's pricelist
/// comes from an older book than its neighbours' pricelist, which is a real
/// difference somebody has to explain.
///
/// It is still row-scoped rather than fleet-scoped: "is this shop on the newest
/// book in the system" is a different question, and a book that never mentioned
/// this article would make every shop fail it.
function newestByRung(row: ArticlePriceRow): ReadonlyMap<string, number> {
  const newest = new Map<string, number>()
  for (const shop of row.shops) {
    for (const rule of shop.stack) {
      const seen = newest.get(rule.source)
      if (seen === undefined || rule.publication_version > seen)
        newest.set(rule.source, rule.publication_version)
    }
  }
  return newest
}

/// What a selection of cells says to the price composer.
///
/// A cell is a style at a shop; a base price is a product at a level. The
/// translation is deliberately lossy in one direction only — the styles become
/// *which products to offer*, the shops become *which shops to name* — and the
/// composer then asks for everything a cell cannot say. Deduplicated because
/// three cells of one style at three shops is one style and three shops, not
/// three of each.
function seedFrom(
  cells: readonly CellRef[],
  priceMinor: number | null
): PriceSeed {
  return {
    articleCodes: [...new Set(cells.map((one) => one.articleCode))],
    siteIds: [...new Set(cells.map((one) => one.siteId))],
    priceMinor,
  }
}

/// The key a cell is opened under, and read back from.
///
/// One cell is one article at one shop, and neither half identifies it alone —
/// so the URL carries both. It goes through the existing `price` parameter
/// because `lib/sheets.ts` is shared and a module does not add keys to it; the
/// value is shaped rather than opaque so a malformed one opens nothing instead
/// of a sheet onto a question nobody can answer. `cellKey` itself lives beside
/// the editor, which keys its selection and its pending edits the same way.
function readCellKey(value: string | undefined): {
  articleCode: string
  siteId: string
} | null {
  if (value === undefined) return null
  const at = value.lastIndexOf("@")
  if (at <= 0 || at === value.length - 1) return null
  return { articleCode: value.slice(0, at), siteId: value.slice(at + 1) }
}

/// The channel this grid is about.
///
/// A constant rather than a picker. The engine takes all three channels and
/// `ONLINE`/`MARKETPLACE` are real, but nothing in this business sells on them
/// yet, so the control offered two answers that were always empty and made the
/// third look like a choice. When a second channel starts trading, this becomes
/// a `Segmented` again — the query below already takes it as an argument.
const CHANNEL: CommercialChannel = "STORE"

export function Pricelist() {
  /// What was typed. In the URL like every other search box in this app: a
  /// filtered pricelist is a thing people send each other, and a `useState` box
  /// cannot be sent.
  const search = useSheet("q")
  const cell = useSheet("price")
  /// One style across every shop. Its own key rather than a second meaning for
  /// `price`, which names a SQUARE: a link to a style and a link to one shop's
  /// price for it are two different things to send somebody.
  const style = useSheet("article")
  /// One shop's whole shelf, opened from its column heading.
  const shop = useSheet("shop")

  /// What this screen can be narrowed by, and how.
  ///
  /// Each operator list is cut to what `/api/v1/commercial/article-prices` can
  /// actually answer. An operator in the menu the request cannot carry is a
  /// chip that silently narrows nothing, which is worse than a missing one:
  /// the reader believes the list in front of them is filtered.
  const fields = useMemo<FilterField[]>(
    () => [
      {
        column: "division",
        label: "Division",
        spec: {
          kind: "option",
          single: true,
          operators: ["isAnyOf"],
        },
      },
      {
        column: "tag",
        label: "Tag",
        spec: {
          kind: "multi",
          single: true,
          operators: ["includesAnyOf"],
        },
      },
      {
        column: "price",
        label: "Price",
        spec: {
          kind: "number",
          // No scale. `unit_price_minor` holds whole rupiah despite the name
          // (`lib/format` says why), so a bound is sent as typed — scaling by
          // a hundred is the mistake that already caught seven other columns.
          unit: "Rp",
          // Two clauses rather than one "is between": they land on two
          // different request parameters and AND on the server exactly as the
          // chips promise.
          operators: ["gte", "lte"],
        },
      },
    ],
    []
  )

  const filters = useFilterState(fields)

  /// The names for the codes the facets count.
  ///
  /// Both lists are small — a company has six divisions and a few dozen tags —
  /// and both are already cached by every other screen that draws them, so
  /// this costs nothing and stops the picker offering `LENGAN_PANJANG` where a
  /// merchandiser expects "Lengan Panjang".
  const divisions = useQuery({
    queryKey: vocabularyKeys.list("divisions"),
    queryFn: ({ signal }) => listTerms("divisions", signal),
  })
  const tags = useQuery({
    queryKey: vocabularyKeys.list("tags"),
    queryFn: ({ signal }) => listTerms("tags", signal),
  })

  /// What was typed, plus the chips, as the one request that answers both.
  ///
  /// Debounced deliberately: this endpoint prices every matching style across
  /// thirteen shops, so a keystroke is not a cheap question. Half a second is
  /// long enough that typing "kemeja" asks once instead of six times, and
  /// short enough that it still feels like the box is listening.
  const typed = (search.value ?? "").trim()
  const needle = useDebounced(typed, 400)
  const scope = useMemo<ArticlePriceScope>(
    () => ({
      ...priceScopeFromFilters(filters.filters),
      ...(needle === "" ? {} : { q: needle }),
    }),
    [filters.filters, needle]
  )

  /// Paged, and deliberately NOT with a `limit` of its own.
  ///
  /// This screen used to ask for 200 styles in one request and print "Showing
  /// 200 of 506 — search or filter to reach the rest". The other 306 were
  /// unreachable: there was no second page, only a suggestion that the reader
  /// narrow until the answer fitted.
  ///
  /// The endpoint pages now, and its default was tuned to **20** for a reason
  /// worth not overriding here: its cost is fixed per REQUEST, not per row —
  /// each shop's price book used to be fetched whole to price the handful of
  /// styles on the page. At 20 it answers in about 96 ms; at 200 it was 685.
  /// Naming a `limit` here would quietly undo that tuning, so this asks for the
  /// server's own default and follows the cursor instead.
  const prices = useInfiniteQuery({
    queryKey: commercialKeys.articlePrices(CHANNEL, null, scope),
    queryFn: ({ pageParam, signal }) =>
      articlePrices({ channel: CHANNEL, cursor: pageParam, ...scope }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // The previous answer stays on screen while the next is fetched. Without
    // it every keystroke empties the grid to a loading line and the screen
    // flashes its way through a word.
    placeholderData: (previous) => previous,
  })

  /// Every page so far, drawn as one answer.
  ///
  /// `shops`, `facets`, `as_of` and `total` come from the FIRST page: every
  /// page reports the same ones, and taking the first is what stops the shop
  /// columns and the counts from flickering as later pages land. Only `rows`
  /// accumulates.
  const page = useMemo(() => {
    const first = prices.data?.pages[0]
    if (first === undefined) return undefined
    return {
      ...first,
      rows: prices.data?.pages.flatMap((one: ArticlePrices) => one.rows) ?? [],
    }
  }, [prices.data])

  /// The books, for two things this screen has to say: which publication a
  /// price came out of, and whether a price is about to change.
  const books = useQuery({
    queryKey: commercialKeys.books(),
    queryFn: ({ signal }) => listPriceBooks(signal),
  })

  /// The next book that has not started yet.
  ///
  /// Scheduled prices are invisible in the "now" view by construction: the
  /// engine's `ranked()` only considers candidates whose window covers the
  /// instant asked about. So a price rise published last week and starting on
  /// the sixteenth simply is not in the answer above, and a merchandiser
  /// checking the range on the fifteenth would see the old number and no hint
  /// that it is the last day it is true.
  /// "Future" is measured against `as_of` — the instant the server priced at —
  /// and never against the browser's clock. Two reasons, and the second is the
  /// one that matters: a component may not read a clock during render, because
  /// the answer changes on a re-render nobody asked for; and the grid below is
  /// the server's answer at that instant, so a book is only "upcoming" relative
  /// to the moment the grid was drawn for.
  const upcomingFrom = useMemo(() => {
    if (page === undefined) return null
    const drawnAt = new Date(page.as_of).getTime()
    const future = (books.data ?? [])
      .filter(
        (book) =>
          book.status === "PUBLISHED" &&
          new Date(book.effective_from).getTime() > drawnAt
      )
      .map((book) => book.effective_from)
      .sort()
    return future[0] ?? null
  }, [books.data, page])

  /// The same question asked again at the moment that book starts. A second
  /// call rather than a second opinion: the diff between the two answers is the
  /// engine's, not this screen's.
  /// The same question at the moment the next book starts — narrowed the same
  /// way, so the two answers are about the same styles.
  ///
  /// `scope` is passed deliberately: without it this asked the whole range
  /// while the grid showed a filtered slice, so the comparison was between two
  /// different sets and a style could be marked against a rule for an article
  /// nobody was looking at.
  ///
  /// It is capped rather than paged, and the consequence is stated rather than
  /// hidden: `later` below is a LOOKUP, so a style past the cap simply carries
  /// no "falling to" marker. That is an absence, not a wrong number — the grid
  /// never invents a future price it did not fetch. Raising the cap costs a
  /// whole second request at this endpoint's fixed per-request price, which is
  /// why it is not simply set to the total.
  const UPCOMING_CAP = 200
  const upcoming = useQuery({
    queryKey: commercialKeys.articlePrices(CHANNEL, upcomingFrom, scope),
    queryFn: ({ signal }) =>
      articlePrices(
        { channel: CHANNEL, at: upcomingFrom!, limit: UPCOMING_CAP, ...scope },
        signal
      ),
    enabled: upcomingFrom !== null,
  })

  /// What each published book is called, by version.
  ///
  /// The grid names the thing that set a price rather than classifying it. A
  /// price's identity is the book it came out of — "Bandung + Surabaya cap
  /// clearance" says who decided and why in a way "Markdown" never can, and it
  /// is the only name this data carries: a price rule has no name of its own,
  /// and promotions and campaigns do not reach this screen at all, because they
  /// are statements about a basket rather than about what a garment costs.
  const bookNames = useMemo(() => {
    const map = new Map<number, string>()
    for (const book of books.data ?? []) map.set(book.version, book.name)
    return map
  }, [books.data])

  /// The rows, as they came back. No second filter here on purpose: the
  /// server matched them, and a browser-side pass over the SAME words would
  /// be a second definition of "matches" — one that could only ever disagree,
  /// and that could not see the SKU codes the server searched.
  const items = page?.rows ?? []

  const open = readCellKey(cell.value)

  // ── writing ──────────────────────────────────────────────────────────────
  //
  // Two pieces of screen state, and they are deliberately not the same one.
  // A *selection* is cells somebody is pointing at; a *pending edit* is a price
  // they have typed and not sent. Collapsing them would mean clearing a
  // selection threw away typed prices, which is the kind of loss a grid makes
  // easy and an undo does not exist for.
  /// Which styles are showing what their price beat.
  ///
  /// Local rather than in the URL, unlike the search box and the open cell.
  /// Those two name a QUESTION — "the caps" , "this shop's price for that
  /// style" — and a question is worth sending to a colleague. A disclosure
  /// names a glance: it survives neither a reload nor a filter meaningfully,
  /// and putting it in the address bar would make every chevron a history
  /// entry to press Back through.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const toggleExpanded = useCallback((articleCode: string) => {
    setExpanded((open) => {
      const next = new Set(open)
      if (!next.delete(articleCode)) next.add(articleCode)
      return next
    })
  }, [])

  const [selection, setSelection] = useState<readonly CellRef[]>([])
  const [pending, setPending] = useState<readonly PendingEdit[]>([])
  const [pricing, setPricing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  /// Every book the last publish wrote. Usually one; more when the batch held
  /// prices starting on different days, which is one book each.
  const [receipt, setReceipt] = useState<readonly PublishReceipt[]>([])

  /// The composer, in the URL like every other panel: a merchandiser sent
  /// "price these for Bandung" should land on the sheet, not on the grid with
  /// instructions.
  const composer = useSheet("new-price")
  /// What the grid pointed it at. Screen state and not the URL, deliberately —
  /// a seed is the *starting* contents of a form somebody is now editing, and
  /// putting it in the address bar would make a half-filled form re-seed itself
  /// on every navigation.
  const [seed, setSeed] = useState<PriceSeed | null>(null)
  const openComposer = (next: PriceSeed | null) => {
    setSeed(next)
    composer.open(true)
  }

  /// The two halves of what is waiting to be published, counted apart because
  /// they are not the same promise — see the editor's `PendingEdit`.
  const sales = pending.filter(
    (one): one is PendingMarkdown => one.kind === "markdown"
  )
  const priced = pending.filter(
    (one): one is PendingPrice => one.kind === "price"
  )

  /// The number a new book has to carry to win. The engine ranks by version
  /// before anything else, so a book written below one already here publishes,
  /// dispatches, and changes nothing.
  const nextVersion =
    (books.data ?? []).reduce(
      (highest, book) => Math.max(highest, book.version),
      0
    ) + 1

  const toggleSelected = (ref: CellRef) =>
    setSelection((was) => {
      const key = cellKey(ref.articleCode, ref.siteId)
      return was.some((one) => cellKey(one.articleCode, one.siteId) === key)
        ? was.filter((one) => cellKey(one.articleCode, one.siteId) !== key)
        : [...was, ref]
    })

  /// The fields the bar actually draws: the declarations above, with the
  /// server's counts and the master list's names attached.
  ///
  /// Counted over the whole catalogue rather than over what is on screen —
  /// that is the server's doing, and the reason it matters is that a facet
  /// list counting only the current page cannot tell you what ticking a
  /// second box would ADD, which is the one thing a facet is for.
  const counted = useMemo<FilterField[]>(() => {
    const names = (terms: readonly MasterTerm[] | undefined) =>
      new Map((terms ?? []).map((term) => [term.code, term.label]))
    const divisionNames = names(divisions.data?.terms)
    const tagNames = names(tags.data?.terms)
    const facets = page?.facets
    return fields.map((field) => {
      if (field.column === "division")
        return {
          ...field,
          spec: {
            ...field.spec,
            counted: facets?.divisions,
            format: (code: string) => divisionNames.get(code) ?? code,
          },
        }
      if (field.column === "tag")
        return {
          ...field,
          spec: {
            ...field.spec,
            counted: facets?.tags,
            format: (code: string) => tagNames.get(code) ?? code,
          },
        }
      return field
    })
  }, [fields, page?.facets, divisions.data, tags.data])

  /// Sale prices, keyed the way the grid is.
  ///
  /// **Markdowns only, and that is not an omission.** A cell shows one figure
  /// for a whole style, which is exactly what a markdown is; a new base price
  /// is per product, so eight sizes at one shop would be eight numbers with one
  /// square to draw them in. Striking the cell through with one of them would
  /// be the screen inventing an answer the engine never gave. The affected
  /// cells are marked instead, and the figures are in the bar and the publish
  /// sheet where every row has its own line.
  const pendingByCell = useMemo(() => {
    const map = new Map<string, PendingMarkdown>()
    for (const edit of sales) {
      map.set(cellKey(edit.articleCode, edit.siteId), edit)
    }
    return map
  }, [sales])

  /// Which cells a pending base price touches — a marker, never a figure.
  ///
  /// A fleet-wide or grouped price names no article, so the cells are worked
  /// out the other way round: from the styles the priced products belong to,
  /// against the shops the price actually reaches.
  const pricedCells = useMemo(() => {
    const cells = new Set<string>()
    const everywhere = (page?.shops ?? []).map((shop) => shop.site_id)
    for (const price of priced) {
      const sites =
        price.siteId !== null
          ? [price.siteId]
          : price.siteIds !== null
            ? price.siteIds
            : everywhere
      for (const site of sites) cells.add(cellKey(price.articleCode, site))
    }
    return cells
  }, [priced, page?.shops])

  return (
    <PageContent fill>
      <PageHeader
        crumb="Commercial"
        title="Prices"
        sub="What each shop is charging. Open a style to see what that price beat."
        actions={
          // Reachable without a cell, because the commonest reason to open it
          // is a style whose price is being decided rather than read — and a
          // composer that could only be reached by first finding a square in a
          // 500-row matrix would make the grid a toll gate.
          <Button variant="soft" onClick={() => openComposer(null)}>
            New price
          </Button>
        }
      />

      {queryState(prices, {
        loading: "Pricing the range across every shop…",
        // The folded page above, not the raw `{pages, pageParams}` an infinite
        // query hands back. Everything below reads one answer, as it did when
        // there was only ever one.
        render: () =>
          page === undefined ? null : (
            <>
              {page.shops.length === 0 && (
                <Banner tone="warn" className="mb-4">
                  No shop origin is registered at the centre, so this grid has
                  no columns and nothing below can be compared. Register a STORE
                  node first — a published book with no fleet reaches no till.
                </Banner>
              )}

              {/* One box for both questions, sitting on top of what it narrows.
                Search used to be a 12rem input in the page header's top-right
                corner — as far from the grid as the layout allowed, and small
                enough to read as a minor control, when it is the only way
                through five hundred styles. Filtering and searching are also
                one thought: "kemeja, menswear, under 200.000" is a sentence
                somebody says in one breath, and splitting it across two
                controls in two corners makes them say it twice. */}
              <FilterOmnibox
                model={{ ...filters, fields: counted }}
                text={typed === "" ? undefined : typed}
                onText={(next) => (next ? search.open(next) : search.close())}
                placeholder="Search an article, code or SKU — or filter by division, tag or price"
                className="mb-4"
              />

              {receipt.length > 0 &&
                (() => {
                  // The books are reported together but judged separately: one of
                  // three reaching nobody is the case this banner exists for, and
                  // summing the deliveries would hide it behind the two that
                  // worked.
                  const named = (one: PublishReceipt) =>
                    bookNames.get(one.version) ?? `Book v${one.version}`
                  const nowhere = receipt.filter(
                    (one) => one.delivered_to.length === 0
                  )
                  const shops = [
                    ...new Set(receipt.flatMap((one) => one.delivered_to)),
                  ]
                  return (
                    <Banner
                      tone={nowhere.length === 0 ? "ok" : "warn"}
                      className="mb-4"
                      onDismiss={() => setReceipt([])}
                    >
                      {nowhere.length === receipt.length ? (
                        // The important case, and the reason the receipt is a
                        // banner rather than a toast: published and reaching
                        // nobody looks exactly like success everywhere else on
                        // this screen.
                        <>
                          {receipt.map(named).join(", ")}{" "}
                          {receipt.length === 1 ? "was" : "were"} published, and
                          queued for nobody. No shop origin is registered, so no
                          till will ever see these prices.
                        </>
                      ) : (
                        <>
                          {receipt.map(named).join(", ")}{" "}
                          {receipt.length === 1 ? "was" : "were"} published and
                          queued for {count(shops.length)} shop
                          {shops.length === 1 ? "" : "s"} ({shops.join(", ")}).
                          Each one starts charging when it takes the message,
                          which is a separate moment — open a cell to see who
                          has.
                          {nowhere.length > 0 && (
                            <>
                              {" "}
                              {nowhere.map(named).join(" and ")} reached nobody.
                            </>
                          )}
                        </>
                      )}
                    </Banner>
                  )
                })()}

              <EditBar
                selected={selection.length}
                markdowns={sales.length}
                prices={priced.length}
                onSetPrice={() => {
                  // One sheet at a time: the editor and the drill-down are both
                  // the same floating panel, and two of them are a stack nobody
                  // asked for.
                  cell.close()
                  setPricing(true)
                }}
                onNewPrice={() => {
                  cell.close()
                  openComposer(seedFrom(selection, null))
                }}
                onClearSelection={() => setSelection([])}
                onDiscard={() => setPending([])}
                onPublish={() => {
                  cell.close()
                  setPublishing(true)
                }}
              />

              <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {items.length === 0 ? (
                  needle === "" ? (
                    <EmptyState>
                      No published book prices anything for the shops. A product
                      with no price is absent rather than free.
                    </EmptyState>
                  ) : (
                    <EmptyState>
                      No article matches “{search.value}”. The search runs over
                      the {count(page.rows.length)} articles loaded, not the
                      whole catalogue.
                    </EmptyState>
                  )
                ) : (
                  <PriceGrid
                    page={page}
                    items={items}
                    bookNames={bookNames}
                    upcoming={upcoming.data ?? null}
                    openCell={cell.value}
                    onOpenCell={(articleCode, siteId) =>
                      cell.open(cellKey(articleCode, siteId))
                    }
                    onOpenArticle={(articleCode) => style.open(articleCode)}
                    onOpenShop={(siteId) => shop.open(siteId)}
                    selection={selection}
                    pending={pendingByCell}
                    pricedCells={pricedCells}
                    onToggleSelected={toggleSelected}
                    expanded={expanded}
                    onToggleExpanded={toggleExpanded}
                  />
                )}

                {/* The way through the rest of the catalogue, under the grid
                    it pages rather than in a banner over it. A partial list
                    still must not read as a complete one, but that is a footer
                    job: the reader meets it when they reach the end of what
                    was loaded, which is the moment the question arises. */}
                {prices.hasNextPage && (
                  <div className="shrink-0 border-t border-hairline-2 px-3.5 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void prices.fetchNextPage()}
                      disabled={prices.isFetchingNextPage}
                      className="text-cell text-mute underline underline-offset-2 disabled:opacity-60"
                    >
                      {prices.isFetchingNextPage ? "Fetching…" : "Show more"}
                    </button>
                  </div>
                )}
              </Card>
            </>
          ),
      })}

      <StoreSheet
        siteId={shop.value ?? null}
        label={
          (page?.shops ?? []).find((one) => one.site_id === shop.value)
            ?.label ?? null
        }
        channel={CHANNEL}
        at={null}
        onClose={shop.close}
      />

      <ArticleSheet
        row={
          style.value === undefined
            ? null
            : ((page?.rows ?? []).find(
                (one) => one.article_code === style.value
              ) ?? null)
        }
        shops={page?.shops ?? []}
        bookNames={bookNames}
        onClose={style.close}
        onOpenCell={(siteId) => {
          // One sheet at a time. Going from the style to one of its squares is
          // going DEEPER, not opening a second panel beside the first.
          style.close()
          cell.open(cellKey(style.value as string, siteId))
        }}
      />

      <CellSheet
        cell={open}
        channel={CHANNEL}
        at={null}
        bookNames={bookNames}
        row={
          open === null
            ? null
            : ((page?.rows ?? []).find(
                (one) => one.article_code === open.articleCode
              ) ?? null)
        }
        onClose={cell.close}
      />

      <SalePriceSheet
        open={pricing}
        cells={selection}
        onNewPrice={(priceMinor) => {
          setPricing(false)
          openComposer(seedFrom(selection, priceMinor))
        }}
        onApply={(edits) => {
          // Later edits win over earlier ones for the same cell: typing a
          // second price for a cell is a correction, not a second markdown, and
          // the server would refuse two rows with the same id anyway.
          //
          // Only markdowns are compared. A base price for the same style at the
          // same shop is not a correction of a clearance — the two are separate
          // rungs and a book carries both — so matching on the cell alone would
          // silently drop one of them.
          setPending((was) => [
            ...was.filter(
              (old) =>
                old.kind !== "markdown" ||
                !edits.some(
                  (edit) =>
                    edit.articleCode === old.articleCode &&
                    edit.siteId === old.siteId
                )
            ),
            ...edits,
          ])
          setSelection([])
          setPricing(false)
        }}
        onClose={() => setPricing(false)}
      />

      <NewPriceSheet
        // Remounted per seed, which is how the form starts filled without an
        // effect: every field's initial value is read from the seed, and a
        // seed that changed under a mounted form would be a set of defaults
        // arriving after somebody had already typed over them.
        key={
          seed === null
            ? "empty"
            : `${seed.articleCodes.join(",")}|${seed.siteIds.join(",")}|${seed.priceMinor ?? ""}`
        }
        open={composer.isOpen}
        seed={seed}
        shops={page?.shops ?? []}
        onAdd={(rows) => {
          // Keyed by the server's own uniqueness, so authoring a second price
          // for one product at one level replaces the first rather than
          // travelling as two rows the publication would refuse.
          setPending((was) => [
            ...was.filter(
              (old) =>
                old.kind !== "price" || !rows.some((row) => row.key === old.key)
            ),
            ...rows,
          ])
          setSelection([])
          // The seed is spent. Dropping it is what makes the next open a fresh
          // form rather than the same styles offered again at no price — the
          // sheet is keyed on the seed, so this is also what remounts it.
          setSeed(null)
          composer.close()
        }}
        onClose={composer.close}
      />

      <PublishSheet
        open={publishing}
        edits={pending}
        nextVersion={nextVersion}
        onClose={() => setPublishing(false)}
        onPublished={(published) => {
          setReceipt(published)
          setPending([])
          setPublishing(false)
        }}
      />
    </PageContent>
  )
}

// ── the grid ───────────────────────────────────────────────────────────────

/// How many rows an article needs: the deepest stack any shop has for it.
///
/// **Rows are the engine's ranking, not two named concepts.** An earlier draft
/// drew one row called "Pricelist" and one called "Markdown", which read as two
/// prices of equal standing and left the only question that matters —
/// *which one does the till charge* — for the reader to work out. Now row 1 is
/// rank 0 for every shop, and rank 0 is by definition what is charged. What
/// kind of price it is (a markdown, a shop price, the company price) is said in
/// the cell, where it belongs: the same rank can be a markdown at one shop and
/// the company price at the next, which a row label cannot express.
///
/// Always at least two rows, so a style with a clearance at one shop and none
/// at another still lines up across the fleet.
///
/// **A column is one shop's cascade, listed densely.** Rung 0 is row 1 for
/// every shop — that is the alignment the grid is actually read for, and it
/// holds because rank 0 is always the first price a shop has. Below that the
/// rows are that shop's own candidates in the engine's order, one price each.
///
/// The alternative, tried and reverted, was to give every rung a band of rows
/// as tall as the most prices any shop had at it. It kept rung *n* on the same
/// row across the fleet and paid for it in holes: a shop with one price at a
/// rung its neighbour prices per size left two blank squares mid-column, and a
/// grid with gaps in the middle of it reads as missing data rather than as a
/// shop that simply has fewer prices.
interface Line {
  readonly rule: ArticlePriceRule
  readonly point: ArticlePricePoint
}

/// One shop's prices, rung by rung and within a rung price by price.
function linesFor(shop: ArticlePriceShop | undefined): readonly Line[] {
  if (shop === undefined) return []
  return shop.stack.flatMap((rule) =>
    pointsOf(rule).map((point) => ({ rule, point }))
  )
}

/// How many rows an article needs: the longest cascade any shop has for it.
///
/// No floor. There used to be one of two rows, meant to keep a style that is
/// marked down at one shop and not at another lined up across the fleet — but
/// `deepest` is already the longest cascade *any* shop has, so the moment one
/// shop has a second price the depth is 2 without help. The floor could only
/// ever fire when no shop had more than one price, and all it did there was
/// draw a row of thirteen empty squares under a fleet that agrees.
function depthOf(lines: ReadonlyMap<string, readonly Line[]>): number {
  let deepest = 1
  for (const shop of lines.values()) deepest = Math.max(deepest, shop.length)
  return deepest
}

function PriceGrid({
  page,
  items,
  bookNames,
  upcoming,
  openCell,
  onOpenCell,
  onOpenArticle,
  onOpenShop,
  selection,
  pending,
  pricedCells,
  onToggleSelected,
  expanded,
  onToggleExpanded,
}: {
  page: ArticlePrices
  items: readonly ArticlePriceRow[]
  bookNames: ReadonlyMap<number, string>
  upcoming: ArticlePrices | null
  openCell: string | undefined
  onOpenCell: (articleCode: string, siteId: string) => void
  /// Open one style across every shop.
  onOpenArticle: (articleCode: string) => void
  /// Open one shop's whole shelf.
  onOpenShop: (siteId: string) => void
  selection: readonly CellRef[]
  pending: ReadonlyMap<string, PendingMarkdown>
  /// Cells a pending base price reaches. A marker only — the figures live in
  /// the publish sheet, because a cell is a style and a base price is not.
  pricedCells: ReadonlySet<string>
  onToggleSelected: (cell: CellRef) => void
  /// Article codes whose cascade is showing. A set rather than one open row:
  /// comparing two styles' markdowns side by side is the whole reason to open
  /// one, and an accordion that shuts the first when you open the second makes
  /// that impossible.
  expanded: ReadonlySet<string>
  onToggleExpanded: (articleCode: string) => void
}) {
  const selected = useMemo(
    () => new Set(selection.map((one) => cellKey(one.articleCode, one.siteId))),
    [selection]
  )

  /// What each cell will cost once the next book starts, keyed the way a cell
  /// is. Built once for the page rather than searched per cell, which would be
  /// a scan of every article for every column drawn.
  const later = useMemo(() => {
    const map = new Map<string, ArticlePriceRule>()
    for (const row of upcoming?.rows ?? []) {
      for (const shop of row.shops) {
        for (const rule of shop.stack) {
          // Keyed by rung as well as by cell. Comparing this rung against the
          // *winner* of the future answer is how a pricelist row came to be
          // marked "falling to 129.000" when nothing about the pricelist had
          // changed at all — the future winner was a markdown, which is a
          // different row on this grid and a different fact.
          const at = `${cellKey(row.article_code, shop.site_id)}|${rule.source}`
          if (!map.has(at)) map.set(at, rule)
        }
      }
    }
    return map
  }, [upcoming])

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {/* Fixed layout and separated borders, so a column keeps its width as
          rows scroll past and every cell carries its own rule. A matrix is read
          across as much as down, and without the vertical rules the eye loses
          which shop a figure belongs to halfway along the row.

          Two frozen columns rather than one: with a fleet of thirteen the shop
          columns scroll a long way, and a price with no rung beside it is as
          unreadable as a price with no article. */}
      <table className="w-full table-fixed border-separate border-spacing-0 text-cell">
        <colgroup>
          <col className="w-[15rem]" />
          {page.shops.map((shop) => (
            <col key={shop.site_id} className="w-[10.5rem]" />
          ))}
        </colgroup>

        {/* Micro-caps, like every other table head in the app. This one used
            to be sentence-case body text in the same size as the money under
            it, which left the header band reading as a first row of data. */}
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 left-0 z-30 border-r border-b border-hairline-2 bg-canvas px-3.5 py-2.5 text-left text-cell font-normal text-body"
            >
              Article
            </th>
            {page.shops.map((shop, index) => (
              <th
                key={shop.site_id}
                scope="col"
                className={
                  "sticky top-0 z-20 truncate border-b border-hairline-2 bg-canvas px-3.5 py-2.5 text-right text-cell font-normal text-body " +
                  (index === page.shops.length - 1 ? "" : "border-r")
                }
                title={activationTitle(shop)}
              >
                {/* The heading is the way into the shop — §4's "klik Store
                    header". A `<th>` is not a control, so the name inside it
                    is: a whole heading that navigated would also swallow the
                    click that starts a column selection. */}
                <button
                  type="button"
                  onClick={() => onOpenShop(shop.site_id)}
                  className="rounded-inner text-right underline-offset-2 hover:underline focus:bg-soft focus-visible:outline-none"
                >
                  {shop.label ?? shop.site_id}
                </button>
                {/* The evidence behind the column, on the column — UI-001 §3.
                    A heading that says only the shop's name invites the reader
                    to assume the prices under it are what that till is
                    charging, and for a shop that has confirmed nothing that is
                    exactly the claim the estate cannot make.
                    
                    The version NUMBER is gone from here and the STATE is not.
                    A reader of this grid is asking which prices are live, not
                    which ordinal the book carries — "v21" over twelve columns
                    is twelve pieces of bookkeeping for one fact, and the two
                    that matter are a shop that has confirmed nothing and a
                    shop head office has published past. The number itself is
                    still a click away, in the column tooltip and in the cell. */}
                {(shop.active_version === null ||
                  shop.pending_publication !== null) && (
                  <span className="block text-[0.65625rem] font-normal text-mute">
                    {shop.active_version === null
                      ? "belum terkonfirmasi"
                      : "pembaruan pending"}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {items.map((row) => {
            const lines = new Map<string, readonly Line[]>(
              page.shops.map((shop) => [
                shop.site_id,
                linesFor(row.shops.find((one) => one.site_id === shop.site_id)),
              ])
            )
            const full = depthOf(lines)
            const open = expanded.has(row.article_code)
            // One row unless asked. The rows below the first are prices that
            // were BEATEN — the history of the number, not the number — and
            // thirteen columns of history is what made this grid a wall of
            // grey figures nobody read. They are one click away, and the same
            // cascade is in the cell's own panel with more context than a row
            // can carry.
            const depth = open ? full : 1
            const newest = newestByRung(row)
            return Array.from({ length: depth }, (_, line) => (
              <tr key={`${row.article_code}:${line}`} className="group/row">
                {line === 0 && (
                  <th
                    scope="rowgroup"
                    rowSpan={depth}
                    className="sticky left-0 z-20 max-w-0 border-r border-b border-hairline-strong bg-canvas p-0 text-left align-top font-normal"
                  >
                    <ArticleCell
                      row={row}
                      // Nothing to open when every shop charges one price and
                      // beat nothing to get there. A disclosure that opens an
                      // empty drawer teaches people to stop pressing it.
                      beneath={full - 1}
                      open={open}
                      onToggle={() => onToggleExpanded(row.article_code)}
                      onOpen={() => onOpenArticle(row.article_code)}
                    />
                  </th>
                )}

                {page.shops.map((shop, index) => {
                  const priced = row.shops.find(
                    (one) => one.site_id === shop.site_id
                  )
                  const key = cellKey(row.article_code, shop.site_id)
                  const here = lines.get(shop.site_id) ?? []
                  const top = priced === undefined ? undefined : winner(priced)

                  // Collapsed, the cell draws the WINNING RUNG rather than the
                  // first flattened line, and those are not the same thing. A
                  // style priced per size has one rung carrying five amounts,
                  // and the first line is the cheapest of them — so the old
                  // one-row cell would have quietly shown 189.000 for a style
                  // that runs 189 to 269. `spread` is what stops that being a
                  // lie: the figure is the lowest, and the mark beside it says
                  // how many more there are.
                  const collapsedPoints = top === undefined ? [] : pointsOf(top)
                  const at = open
                    ? here[line]
                    : top === undefined
                      ? undefined
                      : { rule: top, point: collapsedPoints[0] }
                  const rule = at?.rule
                  return (
                    <PriceCell
                      key={shop.site_id}
                      rule={rule}
                      point={at?.point}
                      // This shop has nothing at all here, as opposed to having
                      // run out of candidates. Only the first row says so.
                      absent={here.length === 0 && line === 0}
                      // Row one is, by definition, what the till charges. Every
                      // figure below it is a candidate it beat, drawn quietly
                      // for that reason.
                      charging={line === 0}
                      newestForRung={
                        rule === undefined
                          ? null
                          : (newest.get(rule.source) ?? null)
                      }
                      later={
                        rule === undefined
                          ? null
                          : (later.get(`${key}|${rule.source}`) ?? null)
                      }
                      open={openCell === key}
                      picked={selected.has(key)}
                      // A sale price is written against the whole cell, not
                      // against one rank of it — so the top row is where it is
                      // offered, because that is the price a merchandiser is
                      // looking at when they decide to cut it.
                      editable={line === 0}
                      pending={line === 0 ? (pending.get(key) ?? null) : null}
                      repriced={line === 0 && pricedCells.has(key)}
                      bookName={
                        rule === undefined
                          ? null
                          : (bookNames.get(rule.publication_version) ?? null)
                      }
                      // How many amounts sit under this square that it is not
                      // showing. Collapsed only: expanded, every one of them
                      // has a row of its own and there is nothing hidden.
                      spread={open ? 1 : collapsedPoints.length}
                      // Expanded rows carry their own name, inside the square.
                      // It cannot be a row label on the left: a rank means a
                      // different thing at each shop — rung two is a markdown
                      // here and the company price next door.
                      //
                      // WHICH name depends on what actually separates this row
                      // from the one above it, and the two cases are different
                      // questions wearing the same shape:
                      //
                      //  * a deeper RUNG is a different candidate, so the name
                      //    is where it came from — "Company", "Markdown";
                      //  * another POINT of one rung is the same candidate
                      //    priced per size, and naming its source would print
                      //    "Company" four times down a column and distinguish
                      //    nothing. What separates those rows is who pays
                      //    them, so that is what they say.
                      label={
                        !open || rule === undefined || at?.point === undefined
                          ? null
                          : pointsOf(rule).length > 1
                            ? `${count(at.point.in_force_for)} ${at.point.in_force_for === 1 ? "product" : "products"}`
                            : describeSource(rule.source)
                      }
                      last={index === page.shops.length - 1}
                      groupEnd={line === depth - 1}
                      onOpen={() => onOpenCell(row.article_code, shop.site_id)}
                      onPick={() =>
                        onToggleSelected({
                          articleCode: row.article_code,
                          articleName: row.article_name,
                          siteId: shop.site_id,
                          siteLabel: shop.label ?? shop.site_id,
                          currentMinor: top?.min_unit_price_minor ?? null,
                        })
                      }
                    />
                  )
                })}
              </tr>
            ))
          })}
        </tbody>
      </table>
    </div>
  )
}

/// The frozen left-hand square: what the style IS, and the way into what its
/// price beat.
///
/// The disclosure is here rather than on each cell because what opens is the
/// whole ROW — thirteen shops' cascades line up or they say nothing — and a
/// per-cell control would offer thirteen ways to ask one question.
function ArticleCell({
  row,
  beneath,
  open,
  onToggle,
  onOpen,
}: {
  row: ArticlePriceRow
  /// Rows that would appear if this opened. Zero means the fleet agrees and
  /// beat nothing on the way, and there is no control at all.
  beneath: number
  open: boolean
  onToggle: () => void
  /// Open the style across every shop — UI-001 §4's "klik Article".
  onOpen: () => void
}) {
  // Two controls, not one. The chevron asks "what did these prices beat" and
  // the name asks "what does this style cost everywhere" — they were one
  // button, and making the name open the cross-shop view while the chevron
  // still expands the rungs is the only way both questions have a target.
  // A whole cell that did both would have to pick one, and §4 names the name.
  const name = (
    <button
      type="button"
      onClick={onOpen}
      title={`Compare ${row.article_name ?? row.article_code} across every shop`}
      // The app-wide focus ring is suppressed on both of these. They are two
      // of a thousand identical controls and the ring draws a heavy accent box
      // around a whole table cell, which reads as a selected record rather
      // than as a cursor. Keyboard users keep the hover tint, which these
      // also take on focus.
      className="flex min-w-0 items-start gap-2.5 overflow-hidden rounded-inner text-left focus:bg-soft focus-visible:outline-none"
    >
      {/* A style with no picture is a box, not a broken image: the catalogue
          is filled in over months and a missing photograph is not a fault
          worth drawing as one. */}
      <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-inner bg-soft-2">
        {row.image_url ? (
          <img src={row.image_url} alt="" className="size-full object-cover" />
        ) : (
          <span aria-hidden className="font-mono text-eyebrow text-faint">
            —
          </span>
        )}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-medium text-ink group-hover/row:underline group-hover/row:underline-offset-2">
          {row.article_name ?? "—"}
        </span>
        <span className="block truncate font-mono text-id text-mute">
          {row.article_code} · {count(row.sku_count)} SKU
        </span>
      </span>
    </button>
  )

  return (
    <span className="flex items-start gap-1.5 px-3.5 py-2.5">
      {beneath <= 0 ? (
        // The chevron's slot is held open anyway. Without it the styles that
        // have nothing to expand sit a few pixels left of the ones that do,
        // and a column of names that does not line up reads as a rendering
        // fault.
        <span aria-hidden className="size-4 shrink-0" />
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          title={
            open
              ? "Hide what these prices beat"
              : `Show the ${count(beneath)} ${beneath === 1 ? "price" : "prices"} these beat`
          }
          className="shrink-0 rounded-inner focus:bg-soft focus-visible:outline-none"
        >
          <ChevronRight
            aria-hidden
            data-motion="travel"
            className={
              "mt-0.5 size-4 text-line-ico transition-transform duration-[var(--t-pop)] " +
              (open ? "rotate-90" : "")
            }
          />
        </button>
      )}
      {name}
    </span>
  )
}

/// One rung of one article at one shop.
///
/// The cell carries the money and nothing else. What rung it is, is the row
/// label; whether the till charges it, is weight; everything the engine said
/// beyond that is in the panel a click away and in the cell's own tooltip. A
/// grid whose job is comparison across thirteen shops cannot also be four lines
/// deep in every square.
function PriceCell({
  rule,
  point,
  absent,
  charging,
  newestForRung,
  later,
  open,
  picked,
  editable,
  pending,
  repriced,
  bookName,
  spread,
  label,
  last,
  groupEnd,
  onOpen,
  onPick,
}: {
  /// This rung's candidate here, or `undefined` when this shop has none of it
  /// — absent rather than zero, because no price is not a price.
  rule: ArticlePriceRule | undefined
  /// The one price this square draws. `undefined` once this shop's cascade has
  /// run out, which is a different thing from having no price at all.
  point: ArticlePricePoint | undefined
  /// Whether this shop has no price for the style whatsoever. Said once, on
  /// the first row; a column of dashes reads as several missing prices rather
  /// than as one style this shop cannot sell.
  absent: boolean
  /// Whether this is the row the till actually charges from.
  charging: boolean
  /// The newest book any shop on this row uses for *this same* rung.
  newestForRung: number | null
  later: ArticlePriceRule | null
  /// Whether this is the cell whose drill-down is on screen.
  open: boolean
  /// Whether it is in the selection something is about to be written to. A
  /// different thing from `open`, and drawn differently: reading one cell and
  /// pricing nine are not the same act.
  picked: boolean
  /// Only the markdown row takes a price. Everywhere else the checkbox would
  /// promise a write this build cannot make.
  editable: boolean
  pending: PendingMarkdown | null
  /// Whether a base price waiting in the bar reaches this style at this shop.
  ///
  /// A marker and not a figure, because a base price is per product: eight
  /// sizes may be getting eight different amounts and this square holds one.
  /// Saying "something is coming here" is true; naming one of the eight would
  /// not be.
  repriced: boolean
  /// What the book that set this price is called. `null` when the price came
  /// from a book this screen has not loaded — an old publication still in force
  /// somewhere, which is worth showing as a version rather than as nothing.
  bookName: string | null
  /// How many distinct amounts this square's rung carries — 1 when the style
  /// costs one price here, 5 when it is priced per size.
  ///
  /// A range is deliberately NOT drawn. "Rp 189.000–269.000" reads as one fact
  /// and is five, and it hides the only thing worth knowing: how many prices
  /// there are and which of them most products carry. The figure stays the
  /// lowest, and the count beside it is a door into the rows that say the rest.
  spread: number
  /// What this row IS, drawn inside the square, on expanded rows only.
  label: string | null
  /// The right-hand column carries no rule of its own — the table's edge is
  /// already there, and a second line beside it reads as a stray border.
  last: boolean
  /// Whether this is the bottom row of one article's block.
  ///
  /// A style occupies as many rows as its deepest shop's cascade, and with
  /// every row ruled identically the blocks ran together: the only thing
  /// saying where one style ended was the next one's name appearing. The
  /// closing rule is what turns a scroll of money back into styles.
  groupEnd: boolean
  onOpen: () => void
  onPick: () => void
}) {
  const rules =
    "border-b " +
    (groupEnd ? "border-hairline-strong " : "border-hairline ") +
    (last ? "" : "border-r ")
  const behind =
    rule !== undefined &&
    newestForRung !== null &&
    rule.publication_version < newestForRung
  const changing =
    later !== null &&
    rule !== undefined &&
    later.min_unit_price_minor !== rule.min_unit_price_minor

  // A repriced cell is drawn even when this shop has no price at all: a
  // company-wide book reaches a shop that was selling nothing, and "nothing is
  // changing here" would be exactly the wrong thing to say about it.
  if (point === undefined && pending === null && !repriced) {
    return (
      <td
        className={
          rules +
          "group/cell relative px-3.5 py-2.5 text-right text-faint group-hover/row:bg-soft " +
          (picked ? "bg-accent-bg" : open ? "bg-soft-2" : "")
        }
      >
        {absent ? "—" : "\u00a0"}
        {editable && <Pick picked={picked} onPick={onPick} />}
      </td>
    )
  }

  /// Everything this cell knows, as one sentence, for the pointer and for a
  /// screen reader.
  const told = [
    bookName,
    rule === undefined
      ? null
      : rule.source === "MARKDOWN"
        ? "markdown"
        : describeSource(rule.source),
    charging ? "charged at the till" : "beaten",
    spread > 1 && rule !== undefined
      ? `priced per size — ${amounts(rule)}`
      : null,
    rule !== undefined && point !== undefined && point.in_force_for > 0
      ? `in force for ${point.in_force_for} of ${rule.sku_count}`
      : null,
    behind ? "from an older book than the other shops" : null,
    changing ? `${amounts(later!)} from ${day(later!.effective_from)}` : null,
    pending !== null ? "edited, not published" : null,
    repriced ? "a new price for this style is waiting to be published" : null,
  ]
    .filter((one) => one !== null)
    .join(" · ")

  return (
    <td
      className={
        rules +
        "group/cell relative p-0 " +
        (picked
          ? "bg-accent-bg"
          : open
            ? "bg-soft-2"
            : "group-hover/row:bg-soft")
      }
    >
      <button
        type="button"
        title={told}
        // Shift-click picks rather than opens. A grid is a thing people sweep
        // across, and holding a modifier is the gesture every spreadsheet has
        // already taught them; the checkbox in the corner is the same act for
        // anybody who has not been taught it.
        onClick={(event) => (event.shiftKey && editable ? onPick() : onOpen())}
        className="flex w-full flex-col items-end gap-0.5 overflow-hidden px-3.5 py-2.5 text-right"
      >
        <span className="flex w-full items-center justify-end gap-1.5">
          {/* Markers before the figure, so the column of money stays a straight
            right-aligned edge whatever else is true of a cell. */}
          {repriced && (
            <span
              aria-hidden
              // A dot and not a number. What is coming is per product, and
              // this square holds one figure — so it says that something is,
              // and the publish sheet says what.
              className="size-1.5 shrink-0 rounded-full bg-accent"
            />
          )}
          {changing && (
            <span
              aria-hidden
              className="shrink-0 text-[0.6875rem] text-info-fg"
            >
              {later!.min_unit_price_minor > rule!.min_unit_price_minor
                ? "↑"
                : "↓"}
            </span>
          )}
          {point !== undefined && (
            <span
              // A beaten price is `body`, not `mute`. It was mute, which is the
              // grey this system uses for text that is off — placeholders,
              // disabled controls — and a column of them read as a fault rather
              // than as the candidates the winner beat. One step darker is
              // still plainly below the ink of the charged row.
              className={
                "truncate tabular-nums " +
                (pending !== null
                  ? "text-mute line-through decoration-1"
                  : charging
                    ? "font-medium text-ink"
                    : "text-body")
              }
            >
              {money(point.unit_price_minor)}
            </span>
          )}
          {pending !== null && (
            <span className="shrink-0 font-medium text-accent tabular-nums">
              {money(pending.priceMinor)}
            </span>
          )}
          {/* "and four more amounts under this one". Not a range, and not a
            plus sign on the figure — either would read as arithmetic done to
            the price rather than as a count of how many prices there are. */}
          {spread > 1 && pending === null && (
            <span className="shrink-0 rounded-full bg-soft-2 px-1.5 py-px text-pill font-medium text-body tabular-nums">
              +{spread - 1}
            </span>
          )}
        </span>
        {/* The row's own name, UNDER the figure rather than beside it. A
            10.5rem column holds one price and nothing else: side by side, the
            label squeezed "Rp 449.000" down to "Rp 449.0…" — and a truncated
            amount is worse than no label at all. Below it, the money keeps
            both its edge and its digits. */}
        {label !== null && (
          <span className="w-full truncate text-id text-mute">{label}</span>
        )}
        <span className="sr-only">{told}</span>
      </button>
      {editable && <Pick picked={picked} onPick={onPick} />}
    </td>
  )
}

/// The pick control, revealed on hover and permanent once ticked.
///
/// A checkbox rather than a pencil because what it does is *choose*, and the
/// writing happens in the bar above the grid where the selection can be seen
/// whole.
function Pick({ picked, onPick }: { picked: boolean; onPick: () => void }) {
  return (
    <Checkbox
      checked={picked}
      onChange={onPick}
      label={<span className="sr-only">Select this cell to price</span>}
      className={cn(
        "absolute top-1/2 left-2 -translate-y-1/2 transition-opacity",
        picked ? "opacity-100" : "opacity-0 group-hover/cell:opacity-100"
      )}
    />
  )
}

// ── the drill-down ─────────────────────────────────────────────────────────

/// One cell, opened: the whole cascade, then the products underneath it.
///
/// This is where the per-SKU list went. It is the same question narrowed —
/// "what does this shop charge for this style, and why" — and asking it of one
/// cell rather than of a whole shop is what makes the answer short enough to
/// read.
function CellSheet({
  cell,
  row,
  channel,
  at,
  bookNames,
  onClose,
}: {
  cell: { articleCode: string; siteId: string } | null
  row: ArticlePriceRow | null
  channel: CommercialChannel
  at: string | null
  /// Publication version to the book's name. The sheet says which book a
  /// price came from, and a version number is not an answer to that.
  bookNames: ReadonlyMap<number, string>
  onClose: () => void
}) {
  const scope: PriceScope = useMemo(
    () => ({
      siteId: cell?.siteId ?? "",
      channel,
      at: at ?? undefined,
    }),
    [cell?.siteId, channel, at]
  )

  const shop =
    cell === null || row === null
      ? undefined
      : row.shops.find((one) => one.site_id === cell.siteId)
  const top = shop === undefined ? undefined : winner(shop)

  /// The products under this style at this shop. The list endpoint answers a
  /// whole shop, which is more than is wanted here — but it is the same read
  /// the shop's own till makes, so narrowing it in the browser is honest where
  /// asking a different question would not be.
  const products = useQuery({
    queryKey: commercialKeys.prices(scope),
    queryFn: ({ signal }) => shelfPrices(scope, signal),
    enabled: cell !== null && scope.siteId !== "",
  })

  const lines = useMemo(
    () =>
      (products.data?.items ?? []).filter(
        (item) => item.article_code === cell?.articleCode
      ),
    [products.data, cell?.articleCode]
  )

  return (
    <Sheet
      open={cell !== null}
      onOpenChange={(open) => !open && onClose()}
      id={cell?.articleCode}
      title={row?.article_name ?? "Price"}
    >
      {cell === null ? null : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={top?.source === "MARKDOWN" ? "warn" : "neutral"}>
              {top === undefined ? "No price" : describeSource(top.source)}
            </Pill>
            {row?.division_code && <Tag>{row.division_code}</Tag>}
            {row?.tags.map((tag) => (
              <Tag key={tag} tone="accent">
                {tag}
              </Tag>
            ))}
          </div>

          <Facts>
            <Fact term="Shop">{shop?.label ?? cell.siteId}</Fact>
            <Fact term="Sold through">{channel}</Fact>
            <Fact term="Price now">
              {top === undefined ? "—" : amounts(top)}
            </Fact>
            <Fact term="Price book">
              {top === undefined
                ? "—"
                : (bookNames.get(top.publication_version) ?? "—")}
            </Fact>
            <Fact term="Products">{count(row?.sku_count)}</Fact>
            <Fact term="Checked">{at === null ? "Just now" : moment(at)}</Fact>
          </Facts>

          {shop === undefined || shop.stack.length === 0 ? (
            <Quiet>
              This shop cannot sell this style. That is different from selling
              it for nothing — there is no price here at all.
            </Quiet>
          ) : (
            <div>
              <SubHead aside="best first">Why this price</SubHead>
              <MiniTable
                head={[
                  "Comes from",
                  { label: "Applies to", align: "left" },
                  "Used by",
                  "Price",
                ]}
              >
                {/* One row per price, not per rung: a rung priced per size
                    carries several amounts, and the question this table answers
                    — which price, for how many products — has a different
                    answer for each of them. The rung is named on its first row
                    and left blank underneath, so a rung still reads as one
                    block without repeating itself down the column. */}
                {shop.stack.flatMap((rule, index) =>
                  pointsOf(rule).map((point, within) => (
                    <MiniRow
                      key={`${rule.source}-${rule.publication_version}-${index}-${point.unit_price_minor}`}
                    >
                      <MiniCell>
                        {within === 0 && (
                          <>
                            <span
                              className={index === 0 ? "text-ink" : "text-mute"}
                            >
                              {describeSource(rule.source)}
                            </span>
                            <span className="block text-[0.65625rem] text-mute">
                              {bookNames.get(rule.publication_version) ?? "—"}
                            </span>
                          </>
                        )}
                      </MiniCell>
                      <MiniCell>
                        {within === 0 && (
                          <span
                            className={
                              index === 0
                                ? "text-[0.71875rem] text-body"
                                : "text-[0.71875rem] text-mute"
                            }
                          >
                            {describeLevel(rule.applies_to)}
                          </span>
                        )}
                      </MiniCell>
                      <MiniCell align="right">
                        <span
                          className={index === 0 ? "text-text" : "text-mute"}
                        >
                          {count(point.in_force_for)} of {count(rule.sku_count)}
                        </span>
                      </MiniCell>
                      <MiniCell align="right">
                        <span
                          className={
                            index === 0 ? "font-medium text-ink" : "text-mute"
                          }
                        >
                          {money(point.unit_price_minor)}
                        </span>
                      </MiniCell>
                    </MiniRow>
                  ))
                )}
              </MiniTable>
              <p className="mt-2 text-[0.71875rem] leading-relaxed text-body">
                The top row is what the till charges. The rows under it are
                prices that lost — the newest book wins, then the most specific
                price, then the one that started last. They are shown because
                “why is it this price” is only answerable against the price it
                replaced.
              </p>
            </div>
          )}

          {lines.length > 0 && cell !== null && (
            <PriceHistorySection
              skuCode={lines[0].sku_code}
              siteId={cell.siteId}
              channel={channel}
              productCount={lines.length}
            />
          )}

          {top !== undefined && top.points.length > 1 && (
            <div>
              <SubHead aside={`${count(top.points.length)} different prices`}>
                Priced per size
              </SubHead>
              <MiniTable head={["Price", "Products", "How many"]}>
                {top.points.map((point) => (
                  <MiniRow key={point.unit_price_minor}>
                    <MiniCell>
                      <span className="text-ink tabular-nums">
                        {money(point.unit_price_minor)}
                      </span>
                    </MiniCell>
                    <MiniCell align="right">
                      <span className="font-mono text-[0.65625rem] text-mute">
                        {point.sku_codes.join(", ")}
                      </span>
                    </MiniCell>
                    <MiniCell align="right">
                      {count(point.in_force_for)}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            </div>
          )}

          {top !== undefined && <InService version={top.publication_version} />}

          <div>
            <SubHead aside={`${count(lines.length)} products`}>
              What each product costs
            </SubHead>
            {queryState(products, {
              loading: "Asking this shop…",
              render: () =>
                lines.length === 0 ? (
                  <Quiet>
                    This shop has nothing of this style it is allowed to sell.
                  </Quiet>
                ) : (
                  <div className="flex flex-col">
                    {lines.map((line) => (
                      <ProductLine
                        key={line.sku_code}
                        line={line}
                        scope={scope}
                      />
                    ))}
                  </div>
                ),
            })}
          </div>
        </div>
      )}
    </Sheet>
  )
}

/// Which shops have actually put the book this price came from into service.
///
/// "Published" and "in force" are different things, and this is the difference
/// — the reason the fleet screen existed and the reason it did not need to be a
/// screen. The gap between the shop's clock (`activated_at`) and the centre's
/// (`reported_at`) is the number to watch: a shop that switched an hour before
/// the centre heard is priced correctly and reporting late, which is a
/// different fault from a shop that never switched at all.
function InService({ version }: { version: number }) {
  const books = useQuery({
    queryKey: commercialKeys.books(),
    queryFn: ({ signal }) => listPriceBooks(signal),
  })

  const book = (books.data ?? []).find((one) => one.version === version)

  const detail = useQuery({
    queryKey: commercialKeys.book(book?.id ?? ""),
    queryFn: ({ signal }) => priceBookDetail(book!.id, signal),
    enabled: book !== undefined,
  })

  if (book === undefined) return null

  return (
    <div>
      <SubHead aside={book.name}>In service at</SubHead>
      {detail.data === undefined ? (
        <Quiet>Asking which shops took this book…</Quiet>
      ) : detail.data.activated_by.length === 0 ? (
        <Quiet>
          No shop has reported putting {book.name} into service. Published and
          in force are different things, and this book is only the first.
        </Quiet>
      ) : (
        <MiniTable
          head={["Shop", { label: "Since", align: "left" }, "Rules taken"]}
        >
          {detail.data.activated_by.map((activation) => (
            <MiniRow key={activation.origin_id}>
              <MiniCell>
                <Named
                  name={activation.site_id ?? "Unsited"}
                  code={activation.origin_id}
                />
              </MiniCell>
              <MiniCell>
                <span className="text-[0.71875rem] text-body">
                  {moment(activation.activated_at)}
                </span>
                <span className="block text-[0.65625rem] text-mute">
                  told us {moment(activation.reported_at)}
                </span>
              </MiniCell>
              <MiniCell align="right">
                {count(activation.price_rule_count)}
              </MiniCell>
            </MiniRow>
          ))}
        </MiniTable>
      )}
    </div>
  )
}

/// One product, and — when asked — the engine's answer for it on its own.
///
/// The row already carries a price. Opening it asks again, and that is the
/// point rather than a round trip wasted: the list and this line come from the
/// same evaluator, and being able to watch them agree is what makes the list
/// believable. When they do not, the price changed between the two questions,
/// and that is worth saying out loud rather than hiding behind the newer
/// number.
function ProductLine({ line, scope }: { line: ShelfPrice; scope: PriceScope }) {
  const [asked, setAsked] = useState(false)

  const resolved = useQuery({
    queryKey: commercialKeys.price(line.sku_id ?? "", scope),
    queryFn: ({ signal }) => resolveOffer(line.sku_id!, scope, signal),
    enabled: asked && line.sku_id !== null,
  })

  const drifted =
    resolved.data !== undefined &&
    resolved.data.unit_price_minor !== line.unit_price_minor

  return (
    <div className="border-t border-hairline first:border-t-0">
      <button
        type="button"
        onClick={() => setAsked((was) => !was)}
        disabled={line.sku_id === null}
        className="flex w-full items-center gap-2 py-2 text-left transition-colors hover:bg-soft disabled:opacity-50"
      >
        <span className="min-w-0 flex-1">
          <Named name={line.sku_code} />
        </span>
        {isMarkedDown(line) && (
          <span className="text-[0.71875rem] text-mute tabular-nums line-through">
            {money(line.base_unit_price_minor)}
          </span>
        )}
        <span className="font-medium text-ink tabular-nums">
          {money(line.unit_price_minor)}
        </span>
        {isMarkedDown(line) && (
          <Tag tone="warn">{percent(markdownDepthBps(line))} off</Tag>
        )}
      </button>

      {asked && (
        <div className="pb-2.5">
          {queryState(resolved, {
            loading: "Asking the engine…",
            render: (answer) => (
              <div className="flex flex-col gap-2">
                {drifted && (
                  <Banner tone="warn">
                    The list had {money(line.unit_price_minor)} for this
                    product; the engine now answers{" "}
                    {money(answer.unit_price_minor)}. The price changed between
                    the two questions — the number here is the newer one.
                  </Banner>
                )}
                <Facts>
                  <Fact term="Charged">{money(answer.unit_price_minor)}</Fact>
                  <Fact term="Before markdown">
                    {money(answer.base_unit_price_minor)}
                  </Fact>
                  <Fact term="Priced by">
                    {describeSource(answer.price_source)}
                  </Fact>
                  <Fact term="Tax class">{answer.tax_category}</Fact>
                  <Fact term="Markdown">{answer.markdown_id ?? "—"}</Fact>
                </Facts>
              </div>
            ),
          })}
        </div>
      )}
    </div>
  )
}

/// Every price this shop has charged for one product, oldest first.
///
/// # Why one product and not the style
///
/// A history is a question about a thing with a price, and a style does not
/// have one — it has as many as it has sizes and colourways, which may have
/// moved on different days for different reasons. Showing the first product and
/// naming it is honest; averaging them would invent a price that was never on a
/// shelf edge.
///
/// # Why the book and the person are on every row
///
/// "The price went up on the third" is a fact somebody already has — they are
/// looking at this screen because of it. "Ramadan Pricing v21, published by
/// Andi on the second" is the answer, and it is the difference between a chart
/// and something a person can act on.
function PriceHistorySection({
  skuCode,
  siteId,
  channel,
  productCount,
}: {
  skuCode: string
  siteId: string
  channel: CommercialChannel
  productCount: number
}) {
  const history = useQuery({
    queryKey: priceHistoryKeys.of(skuCode, siteId, channel),
    queryFn: ({ signal }) => priceHistory(skuCode, siteId, channel, signal),
  })

  const periods = history.data?.periods ?? []

  return (
    <div>
      <SubHead
        aside={
          productCount > 1 ? `${skuCode}, 1 of ${count(productCount)}` : skuCode
        }
      >
        How it got here
      </SubHead>
      {queryState(history, {
        loading: "Replaying the price books…",
        render: (data) =>
          data.never_priced || periods.length === 0 ? (
            <Quiet>No book has ever named this product at this shop.</Quiet>
          ) : periods.length === 1 ? (
            <Quiet>
              This price has not moved since it was set. One book has ever had
              an opinion about it.
            </Quiet>
          ) : (
            <MiniTable
              head={[
                "From",
                { label: "Set by", align: "left" },
                "Change",
                "Price",
              ]}
            >
              {periods.map((period) => (
                <MiniRow key={`${period.from}-${period.publication_version}`}>
                  <MiniCell>
                    <span className="text-ink">{day(period.from)}</span>
                    <span className="block text-[0.65625rem] text-mute">
                      {period.until === null
                        ? "still in force"
                        : `until ${day(period.until)}`}
                    </span>
                  </MiniCell>
                  <MiniCell>
                    <span className="text-ink">
                      {describeSource(period.source)}
                    </span>
                    <span className="block text-[0.65625rem] text-mute">
                      {period.publication_name ??
                        `v${period.publication_version}`}
                      {period.published_by !== null &&
                        ` · ${period.published_by}`}
                    </span>
                  </MiniCell>
                  <MiniCell align="right" className="tabular-nums">
                    {/* The first period has nothing to have moved from, and
                        drawing it as a rise from nought would report a price
                        being set as a price going up. */}
                    {period.change_minor === null ? (
                      <span className="text-mute">—</span>
                    ) : (
                      <span
                        className={
                          period.change_minor < 0 ? "text-ok" : "text-warn"
                        }
                      >
                        {period.change_minor > 0 ? "+" : ""}
                        {money(period.change_minor)}
                      </span>
                    )}
                  </MiniCell>
                  <MiniCell align="right" className="text-ink tabular-nums">
                    {money(period.unit_price_minor)}
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          ),
      })}
    </div>
  )
}

/// What the column heading says when somebody hovers it.
///
/// Three different facts and they must not blur: which version this shop is
/// running, when it said so, and what head office has published over the top.
/// UI-001 §3 turns on keeping them apart — "Reaching scheduled start saja tidak
/// membuktikan POS sudah memakai publication."
function activationTitle(shop: PricelistShop): string {
  const who = shop.label ?? shop.site_id
  const active =
    shop.active_version === null
      ? "no book confirmed active — prices are not available for this shop"
      : `running v${shop.active_version}`
  const pending =
    shop.pending_publication === null
      ? ""
      : ` · head office has published v${shop.pending_publication.version} "${shop.pending_publication.name}", not yet activated here`
  return `${who}: ${active}${pending}`
}

// ---------------------------------------------------------------------------

/// One style, priced at every shop — UI-001 §4's second drill-down.
///
/// **No fetch.** Every figure here is already on the row the grid drew: the
/// matrix asked for the whole cascade at every shop and this reads the same
/// answer down a column instead of across a row. Asking the server again would
/// be a second opinion about a question already answered, and two opinions
/// about one price is the failure this module exists to end.
///
/// ## Regular and Markdown are read off the stack, never recomputed
///
/// The stack arrives in the engine's own order — rank 0 is what the till
/// charges. **Regular** is the best-ranked candidate that is not a markdown;
/// **Markdown** is the markdown rung when there is one. So a shop with a
/// clearance shows both and the difference between them is visible, and a shop
/// without one shows the same number in the price column and nothing beside it.
/// Deriving "regular" by undoing a percentage would be inventing a figure no
/// book contains.
///
/// A shop absent from `shops` is not priced here, and says so. It is NOT shown
/// as zero and not filled in from the company price — §3's last row again.
function ArticleSheet({
  row,
  shops,
  bookNames,
  onClose,
  onOpenCell,
}: {
  row: ArticlePriceRow | null
  /// Every column of the matrix, so a shop that prices nothing still gets a
  /// line. Reading only `row.shops` would draw a table of the shops that
  /// happen to charge something, and "nobody in Medan sells this" is the
  /// answer somebody opened this to find.
  shops: readonly PricelistShop[]
  bookNames: ReadonlyMap<number, string>
  onClose: () => void
  onOpenCell: (siteId: string) => void
}) {
  const lines = useMemo(() => {
    if (row === null) return []
    return shops.map((column) => {
      const shop = row.shops.find((one) => one.site_id === column.site_id)
      const charged = shop === undefined ? undefined : winner(shop)
      const markdown = shop?.stack.find((rule) => rule.source === "MARKDOWN")
      const regular = shop?.stack.find((rule) => rule.source !== "MARKDOWN")
      return { column, charged, markdown, regular }
    })
  }, [row, shops])

  // What the estate actually charges, over the shops that charge anything. The
  // question the whole sheet exists for is "is this one price or several", and
  // a reader should not have to scan thirteen rows to answer it.
  const charged = lines
    .map((line) => line.charged)
    .filter((rule): rule is ArticlePriceRule => rule !== undefined)
  const low = Math.min(...charged.map((rule) => rule.min_unit_price_minor))
  const high = Math.max(...charged.map((rule) => rule.max_unit_price_minor))

  return (
    <Sheet
      open={row !== null}
      onOpenChange={(next) => !next && onClose()}
      id={row?.article_code}
      title={row?.article_name ?? "Article"}
      // Read across, not down: Regular, Markdown and what the till charges
      // only mean anything beside each other, and a rail made the reader
      // compare three numbers a line apart.
      width="table"
      badge={
        row === null ? undefined : (
          <span className="flex flex-wrap items-center gap-1.5">
            {charged.length === 0 ? (
              <Pill tone="warn">Priced nowhere</Pill>
            ) : low === high ? (
              <Pill tone="ok">One price · {money(low)}</Pill>
            ) : (
              <Pill tone="warn">
                {money(low)} – {money(high)}
              </Pill>
            )}
            <span className="text-[0.71875rem] text-mute">
              {count(row.sku_count)} SKU
            </span>
          </span>
        )
      }
    >
      {row === null ? null : (
        <div className="flex flex-col gap-5">
          {/* The headline answer, in words, above the table that evidences it.
              A row of thirteen numbers does not say whether they agree — that
              is arithmetic the reader should not have to do standing up. */}
          <p className="text-meta leading-relaxed text-mute">
            {charged.length === 0
              ? "No shop is charging anything for this style."
              : low === high
                ? `One price everywhere it is sold — ${money(low)}.`
                : `Shops do not agree: ${money(low)} to ${money(high)}.`}
          </p>

          <div>
            <SubHead
              aside={`${count(charged.length)} of ${count(shops.length)}`}
            >
              Store prices
            </SubHead>
            <MiniTable
              head={[
                "Store",
                { label: "Regular", align: "right" },
                { label: "Markdown", align: "right" },
                { label: "Harga sebelum promo", align: "right" },
              ]}
            >
              {lines.map(({ column, charged: top, markdown, regular }) => (
                <MiniRow key={column.site_id}>
                  <MiniCell>
                    {/* The shop's name is the way through to that square's
                        explanation. `MiniRow` is a plain `<tr>` and is not
                        clickable, which is right — a whole row that navigates
                        gives a reader no target to aim at and no way to select
                        the figures in it. */}
                    <button
                      type="button"
                      onClick={() => onOpenCell(column.site_id)}
                      className="text-left text-ink underline-offset-2 hover:underline"
                    >
                      {column.label ?? column.site_id}
                    </button>
                    {column.active_version === null && (
                      <span className="block text-[0.6875rem] text-mute">
                        belum terkonfirmasi
                      </span>
                    )}
                  </MiniCell>
                  <MiniCell align="right">
                    {regular === undefined ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <span className="text-body tabular-nums">
                        {amounts(regular)}
                      </span>
                    )}
                  </MiniCell>
                  <MiniCell align="right">
                    {markdown === undefined ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <span className="text-bad tabular-nums">
                        {amounts(markdown)}
                      </span>
                    )}
                  </MiniCell>
                  <MiniCell align="right">
                    {top === undefined ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <span className="flex flex-col items-end leading-tight">
                        <span className="font-medium text-ink tabular-nums">
                          {amounts(top)}
                        </span>
                        <span className="text-[0.6875rem] text-mute">
                          {bookNames.get(top.publication_version) ??
                            describeSource(top.source)}
                        </span>
                      </span>
                    )}
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          </div>

          {/* The qualification the grid's own column headings carry, kept
              here so a drill-down never asserts a shop's price without it —
              but as one line, not a paragraph. */}
          <p className="text-[0.71875rem] text-mute">
            What each shop has put into service, not what head office has
            published.
          </p>
        </div>
      )}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

/// One shop's whole shelf — UI-001 §4's first drill-down.
///
/// **This one does fetch**, and it is the only drill-down that has to. The
/// matrix holds a page of styles; this question is about a SHOP, and answering
/// it from the loaded page would report "Toko Medan prices twenty styles"
/// because twenty is how many the grid happened to have. `/commercial/offers`
/// is the same read the shop's own till makes, which is why the answer here and
/// the answer at the counter cannot drift.
///
/// ## Grouped back into styles, because the column heading is a style column
///
/// The endpoint answers in products; §4 asks for `Article | Regular | Markdown
/// | Harga sebelum promo`. So the SKUs are folded per article and each figure
/// becomes a range when the sizes disagree — never a representative SKU, which
/// §4 forbids by name.
///
/// **Promotions is absent from the columns**, and that is a gap rather than a
/// decision: a promotion is a statement about a basket, `/commercial/offers`
/// carries none, and inventing a column that is empty on every row would say
/// this shop runs no offers when what is true is that this read cannot see
/// them. The cell explanation next door does show them.
function StoreSheet({
  siteId,
  label,
  channel,
  at,
  onClose,
}: {
  siteId: string | null
  label: string | null
  channel: CommercialChannel
  at: string | null
  onClose: () => void
}) {
  const scope: PriceScope = useMemo(
    () => ({ siteId: siteId ?? "", channel, at: at ?? undefined }),
    [siteId, channel, at]
  )

  const shelf = useQuery({
    queryKey: commercialKeys.prices(scope),
    queryFn: ({ signal }) => shelfPrices(scope, signal),
    enabled: siteId !== null,
  })

  const styles = useMemo(() => {
    const by = new Map<
      string,
      {
        code: string
        name: string
        charged: number[]
        regular: number[]
        markdowns: number
        skus: number
      }
    >()
    for (const item of shelf.data?.items ?? []) {
      const held = by.get(item.article_code) ?? {
        code: item.article_code,
        name: item.article_name,
        charged: [],
        regular: [],
        markdowns: 0,
        skus: 0,
      }
      held.charged.push(item.unit_price_minor)
      held.regular.push(item.base_unit_price_minor)
      if (item.markdown_id !== null) held.markdowns += 1
      held.skus += 1
      by.set(item.article_code, held)
    }
    return [...by.values()].sort((a, b) => a.code.localeCompare(b.code))
  }, [shelf.data])

  /// A set of amounts as one figure, or as the range it actually is.
  ///
  /// Never a representative SKU — §2: "tidak memilih representative SKU
  /// sebagai harga Article". Two sizes at different prices is a fact about the
  /// style, and picking one of them to print is how a shelf edge comes to
  /// disagree with the till for half the sizes on the rail.
  const span = (amounts: readonly number[]): string => {
    if (amounts.length === 0) return "—"
    const low = Math.min(...amounts)
    const high = Math.max(...amounts)
    return low === high ? money(low) : `${money(low)} – ${money(high)}`
  }

  const markedDown = styles.filter((style) => style.markdowns > 0).length

  return (
    <Sheet
      open={siteId !== null}
      onOpenChange={(next) => !next && onClose()}
      id={siteId ?? undefined}
      title={label ?? siteId ?? "Shop"}
      // Five hundred styles by four columns. This is a table with a sheet
      // around it.
      width="table"
      badge={
        shelf.data === undefined ? undefined : (
          <span className="flex flex-wrap items-center gap-1.5">
            <Pill tone="neutral">{count(styles.length)} styles</Pill>
            {markedDown > 0 && (
              <Pill tone="warn">{count(markedDown)} marked down</Pill>
            )}
          </span>
        )
      }
    >
      {queryState(shelf, {
        loading: "Reading what this shop is charging…",
        render: (data) =>
          data.items.length === 0 ? (
            <EmptyState>
              This shop is charging nothing. No book it has put into service
              prices anything — which is not the same as its prices being zero,
              and not something head office&apos;s own book can stand in for.
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-5">
              <p className="text-meta text-mute">
                {count(data.item_count)} products across {count(styles.length)}{" "}
                styles, read the way this till reads them.
              </p>

              <div>
                <SubHead aside={`${count(styles.length)} styles`}>
                  On the shelf
                </SubHead>
                <MiniTable
                  head={[
                    "Article",
                    { label: "Regular", align: "right" },
                    { label: "Markdown", align: "right" },
                    { label: "Harga sebelum promo", align: "right" },
                  ]}
                >
                  {styles.map((style) => (
                    <MiniRow key={style.code}>
                      <MiniCell>
                        <span className="block truncate text-ink">
                          {style.name}
                        </span>
                        <span className="block truncate font-mono text-[0.6875rem] text-mute">
                          {style.code} · {count(style.skus)} SKU
                        </span>
                      </MiniCell>
                      <MiniCell align="right">
                        <span className="text-body tabular-nums">
                          {span(style.regular)}
                        </span>
                      </MiniCell>
                      <MiniCell align="right">
                        {/* The markdown column says how many PRODUCTS are cut,
                            not an amount: a style where two sizes are cleared
                            and four are not has no single markdown price, and
                            printing the cut one would claim the rail is on
                            sale. The amount is in the charged column, which is
                            where the till's number belongs. */}
                        {style.markdowns === 0 ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <span className="text-bad tabular-nums">
                            {count(style.markdowns)} of {count(style.skus)}
                          </span>
                        )}
                      </MiniCell>
                      <MiniCell align="right">
                        <span className="font-medium text-ink tabular-nums">
                          {span(style.charged)}
                        </span>
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              </div>
            </div>
          ),
      })}
    </Sheet>
  )
}
