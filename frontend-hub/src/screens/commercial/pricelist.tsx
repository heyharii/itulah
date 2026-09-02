import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, day, money, moment } from "@/lib/format"
import {
  articlePrices,
  commercialKeys,
  describeLevel,
  describeSource,
  isMarkedDown,
  listPriceBooks,
  priceBookDetail,
  resolveOffer,
  shelfPrices,
  type ArticlePriceRow,
  type ArticlePriceRule,
  type ArticlePriceShop,
  type ArticlePrices,
  type CommercialChannel,
  type PriceScope,
  type PublishReceipt,
  type ShelfPrice,
} from "@/lib/queries/commercial"
import { queryState } from "@/lib/query-state"
import { CommercialTabs } from "@/screens/commercial/tabs"
import { useSheet } from "@/lib/sheets"
import { Named, Quiet } from "@/screens/commercial/parts"
import {
  EditBar,
  PublishSheet,
  SalePriceSheet,
  type CellRef,
  type PendingEdit,
} from "@/screens/commercial/pricelist-editor"
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

/// A candidate's price, as one string.
///
/// Two ends when the style is priced per size, one when every product agrees.
/// The currency is written once: "Rp 139.000–159.000" is the same fact as
/// repeating the symbol and fits a column in a fleet of thirteen, which the
/// repeated form does not — it was being truncated to "Rp 139.000–Rp…", which
/// hides the very number the range exists to show.
function amount(rule: ArticlePriceRule): string {
  const low = money(rule.min_unit_price_minor)
  if (rule.min_unit_price_minor === rule.max_unit_price_minor) return low
  return `${low}–${money(rule.max_unit_price_minor).replace(/^\D+/, "")}`
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

  const prices = useQuery({
    queryKey: commercialKeys.articlePrices(CHANNEL, null),
    queryFn: ({ signal }) =>
      articlePrices({ channel: CHANNEL, limit: 200 }, signal),
  })

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
    if (prices.data === undefined) return null
    const drawnAt = new Date(prices.data.as_of).getTime()
    const future = (books.data ?? [])
      .filter(
        (book) =>
          book.status === "PUBLISHED" &&
          new Date(book.effective_from).getTime() > drawnAt
      )
      .map((book) => book.effective_from)
      .sort()
    return future[0] ?? null
  }, [books.data, prices.data])

  /// The same question asked again at the moment that book starts. A second
  /// call rather than a second opinion: the diff between the two answers is the
  /// engine's, not this screen's.
  const upcoming = useQuery({
    queryKey: commercialKeys.articlePrices(CHANNEL, upcomingFrom),
    queryFn: ({ signal }) =>
      articlePrices(
        { channel: CHANNEL, at: upcomingFrom!, limit: 200 },
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

  const needle = (search.value ?? "").trim().toLowerCase()

  const items = useMemo(() => {
    const all = prices.data?.items ?? []
    if (needle === "") return all
    return all.filter(
      (row) =>
        row.article_code.toLowerCase().includes(needle) ||
        (row.article_name ?? "").toLowerCase().includes(needle)
    )
  }, [prices.data, needle])

  const open = readCellKey(cell.value)

  // ── writing ──────────────────────────────────────────────────────────────
  //
  // Two pieces of screen state, and they are deliberately not the same one.
  // A *selection* is cells somebody is pointing at; a *pending edit* is a price
  // they have typed and not sent. Collapsing them would mean clearing a
  // selection threw away typed prices, which is the kind of loss a grid makes
  // easy and an undo does not exist for.
  const [selection, setSelection] = useState<readonly CellRef[]>([])
  const [pending, setPending] = useState<readonly PendingEdit[]>([])
  const [pricing, setPricing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [receipt, setReceipt] = useState<PublishReceipt | null>(null)

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

  const pendingByCell = useMemo(() => {
    const map = new Map<string, PendingEdit>()
    for (const edit of pending) {
      map.set(cellKey(edit.articleCode, edit.siteId), edit)
    }
    return map
  }, [pending])

  return (
    <PageContent>
      <PageHeader
        crumb="Commercial"
        title="Pricelist"
        sub="What every article costs at every shop, and what that price beat. Row one is what the till charges."
        actions={
          <Input
            value={search.value ?? ""}
            onChange={(event) =>
              event.target.value === ""
                ? search.close()
                : search.open(event.target.value)
            }
            placeholder="Search article"
            className="h-8 w-48"
          />
        }
      />

      <CommercialTabs current="/commercial" />

      {queryState(prices, {
        loading: "Pricing the range across every shop…",
        render: (page) => (
          <>
            {page.shops.length === 0 && (
              <Banner tone="warn" className="mb-4">
                No shop origin is registered at the centre, so this grid has no
                columns and nothing below can be compared. Register a STORE node
                first — a published book with no fleet reaches no till.
              </Banner>
            )}

            {page.article_count < page.total_article_count && (
              // Never let a capped list read as a complete one.
              <Banner tone="info" className="mb-4">
                Showing {count(page.article_count)} of{" "}
                {count(page.total_article_count)} articles. Search to reach the
                rest.
              </Banner>
            )}

            {upcomingFrom !== null && (
              <Banner tone="info" className="mb-4">
                A book starts on {day(upcomingFrom)}. Any rung whose own price
                changes then carries a caret — the grid shows today, because
                today is what the tills are charging.
              </Banner>
            )}

            {receipt !== null && (
              <Banner
                tone={receipt.delivered_to.length > 0 ? "ok" : "warn"}
                className="mb-4"
                onDismiss={() => setReceipt(null)}
              >
                {receipt.delivered_to.length > 0 ? (
                  <>
                    “{bookNames.get(receipt.version) ?? `Book v${receipt.version}`}” published and queued for{" "}
                    {count(receipt.delivered_to.length)} shop
                    {receipt.delivered_to.length === 1 ? "" : "s"} (
                    {receipt.delivered_to.join(", ")}). Each one starts charging
                    it when it takes the message, which is a separate moment —
                    open a cell to see who has.
                  </>
                ) : (
                  // The important case, and the reason the receipt is a banner
                  // rather than a toast: published and reaching nobody looks
                  // exactly like success everywhere else on this screen.
                  <>
                    “{bookNames.get(receipt.version) ?? `Book v${receipt.version}`}” published, and queued for nobody. No
                    shop origin is registered, so no till will ever see these
                    prices.
                  </>
                )}
              </Banner>
            )}

            <EditBar
              selected={selection.length}
              pending={pending.length}
              onSetPrice={() => {
                // One sheet at a time: the editor and the drill-down are both
                // the same floating panel, and two of them are a stack nobody
                // asked for.
                cell.close()
                setPricing(true)
              }}
              onClearSelection={() => setSelection([])}
              onDiscard={() => setPending([])}
              onPublish={() => {
                cell.close()
                setPublishing(true)
              }}
            />

            <Card className="overflow-hidden">
              {items.length === 0 ? (
                needle === "" ? (
                  <EmptyState>
                    No published book prices anything for the shops. A
                    product with no price is absent rather than free.
                  </EmptyState>
                ) : (
                  <EmptyState>
                    No article matches “{search.value}”. The search runs over
                    the {count(page.article_count)} articles loaded, not the
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
                  selection={selection}
                  pending={pendingByCell}
                  onToggleSelected={toggleSelected}
                />
              )}
            </Card>
          </>
        ),
      })}

      <CellSheet
        cell={open}
        channel={CHANNEL}
        at={null}
        bookNames={bookNames}
        row={
          open === null
            ? null
            : ((prices.data?.items ?? []).find(
                (one) => one.article_code === open.articleCode
              ) ?? null)
        }
        onClose={cell.close}
      />

      <SalePriceSheet
        open={pricing}
        cells={selection}
        onApply={(edits) => {
          // Later edits win over earlier ones for the same cell: typing a
          // second price for a cell is a correction, not a second markdown, and
          // the server would refuse two rows with the same id anyway.
          setPending((was) => [
            ...was.filter(
              (old) =>
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
function depthOf(row: ArticlePriceRow): number {
  let deepest = 1
  for (const shop of row.shops) deepest = Math.max(deepest, shop.stack.length)
  return Math.max(deepest, 2)
}

/// The candidate at one rank at one shop, or `undefined` when this shop's
/// cascade is not that deep. Indexed rather than searched: `stack` arrives in
/// the engine's own order and position *is* the rank.
function ruleAt(
  shop: ArticlePriceShop | undefined,
  rank: number
): ArticlePriceRule | undefined {
  return shop?.stack[rank]
}

function PriceGrid({
  page,
  items,
  bookNames,
  upcoming,
  openCell,
  onOpenCell,
  selection,
  pending,
  onToggleSelected,
}: {
  page: ArticlePrices
  items: readonly ArticlePriceRow[]
  bookNames: ReadonlyMap<number, string>
  upcoming: ArticlePrices | null
  openCell: string | undefined
  onOpenCell: (articleCode: string, siteId: string) => void
  selection: readonly CellRef[]
  pending: ReadonlyMap<string, PendingEdit>
  onToggleSelected: (cell: CellRef) => void
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
    for (const row of upcoming?.items ?? []) {
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
    <div className="max-h-[calc(100vh-19rem)] min-h-0 overflow-auto">
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

        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 left-0 z-30 border-r border-b border-hairline bg-canvas px-3.5 py-[0.5625rem] text-left font-medium text-mute"
            >
              Article
            </th>
            {page.shops.map((shop, index) => (
              <th
                key={shop.site_id}
                scope="col"
                className={
                  "sticky top-0 z-20 truncate border-b border-hairline bg-canvas px-3.5 py-[0.5625rem] text-right font-medium text-mute " +
                  (index === page.shops.length - 1 ? "" : "border-r")
                }
                title={shop.label ?? shop.site_id}
              >
                {shop.label ?? shop.site_id}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {items.map((row) => {
            const depth = depthOf(row)
            const newest = newestByRung(row)
            return Array.from({ length: depth }, (_, rank) => (
              <tr key={`${row.article_code}:${rank}`} className="group/row">
                {rank === 0 && (
                  <th
                    scope="rowgroup"
                    rowSpan={depth}
                    className="sticky left-0 z-20 max-w-0 border-r border-b border-hairline bg-canvas px-3.5 py-2.5 text-left align-top font-normal"
                  >
                    <span className="flex items-center gap-2 overflow-hidden">
                      {/* A style with no picture is a box, not a broken image:
                          the catalogue is filled in over months and a missing
                          photograph is not a fault worth drawing as one. */}
                      <span className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-inner bg-soft-2">
                        {row.image_url ? (
                          <img
                            src={row.image_url}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : (
                          <span className="font-mono text-[0.5625rem] text-faint">
                            —
                          </span>
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-ink">
                          {row.article_name ?? "—"}
                        </span>
                        <span className="font-mono text-[0.65625rem] text-mute">
                          {row.article_code} · {count(row.sku_count)} SKU
                        </span>
                      </span>
                    </span>
                  </th>
                )}

                {page.shops.map((shop, index) => {
                  const priced = row.shops.find(
                    (one) => one.site_id === shop.site_id
                  )
                  const key = cellKey(row.article_code, shop.site_id)
                  const rule = ruleAt(priced, rank)
                  const top = priced === undefined ? undefined : winner(priced)
                  return (
                    <PriceCell
                      key={shop.site_id}
                      rule={rule}
                      // Rank 0 is, by definition, what the till charges. Every
                      // figure below it is a candidate it beat, drawn quietly
                      // for that reason.
                      charging={rank === 0}
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
                      editable={rank === 0}
                      pending={rank === 0 ? (pending.get(key) ?? null) : null}
                      bookName={
                        rule === undefined
                          ? null
                          : (bookNames.get(rule.publication_version) ?? null)
                      }
                      last={index === page.shops.length - 1}
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

/// One rung of one article at one shop.
///
/// The cell carries the money and nothing else. What rung it is, is the row
/// label; whether the till charges it, is weight; everything the engine said
/// beyond that is in the panel a click away and in the cell's own tooltip. A
/// grid whose job is comparison across thirteen shops cannot also be four lines
/// deep in every square.
function PriceCell({
  rule,
  charging,
  newestForRung,
  later,
  open,
  picked,
  editable,
  pending,
  bookName,
  last,
  onOpen,
  onPick,
}: {
  /// This rung's candidate here, or `undefined` when this shop has none of it
  /// — absent rather than zero, because no price is not a price.
  rule: ArticlePriceRule | undefined
  /// Whether this is the rung the till actually charges from.
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
  pending: PendingEdit | null
  /// What the book that set this price is called. `null` when the price came
  /// from a book this screen has not loaded — an old publication still in force
  /// somewhere, which is worth showing as a version rather than as nothing.
  bookName: string | null
  /// The right-hand column carries no rule of its own — the table's edge is
  /// already there, and a second line beside it reads as a stray border.
  last: boolean
  onOpen: () => void
  onPick: () => void
}) {
  const rules = "border-b border-hairline " + (last ? "" : "border-r ")
  const behind =
    rule !== undefined &&
    newestForRung !== null &&
    rule.publication_version < newestForRung
  const changing =
    later !== null &&
    rule !== undefined &&
    later.min_unit_price_minor !== rule.min_unit_price_minor

  if (rule === undefined && pending === null) {
    return (
      <td
        className={
          rules +
          "group/cell relative px-3.5 py-2.5 text-right text-faint group-hover/row:bg-soft " +
          (picked ? "bg-accent-bg" : open ? "bg-soft-2" : "")
        }
      >
        —
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
    null,
    rule !== undefined && rule.in_force_for > 0
      ? `in force for ${rule.in_force_for} of ${rule.sku_count}`
      : null,
    behind ? "from an older book than the other shops" : null,
    changing ? `${amount(later!)} from ${day(later!.effective_from)}` : null,
    pending !== null ? "edited, not published" : null,
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
        onClick={(event) =>
          event.shiftKey && editable ? onPick() : onOpen()
        }
        className="flex w-full items-center justify-end gap-1.5 overflow-hidden px-3.5 py-2.5 text-right"
      >
        {/* Markers before the figure, so the column of money stays a straight
            right-aligned edge whatever else is true of a cell. */}
        {changing && (
          <span aria-hidden className="shrink-0 text-[0.6875rem] text-info-fg">
            {later!.min_unit_price_minor > rule!.min_unit_price_minor
              ? "↑"
              : "↓"}
          </span>
        )}
        {rule !== undefined && rule.source === "MARKDOWN" && (
          // Which rank is a clearance, said on the square that is one. On a
          // fleet where a style is cleared at two shops out of thirteen, this
          // is the mark somebody is scanning the row for.
          <span
            aria-hidden
            className="shrink-0 rounded-[0.25rem] bg-warn-bg px-1 text-[0.625rem] font-medium text-warn-fg"
          >
            SALE
          </span>
        )}
        {rule !== undefined && (
          <span
            className={
              "truncate tabular-nums " +
              (pending !== null
                ? "text-mute line-through decoration-1"
                : charging
                  ? "font-medium text-ink"
                  : "text-mute")
            }
          >
            {amount(rule)}
          </span>
        )}
        {pending !== null && (
          <span className="shrink-0 font-medium text-accent tabular-nums">
            {money(pending.priceMinor)}
          </span>
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
    <label
      className={
        "absolute top-1/2 left-2 -translate-y-1/2 cursor-pointer transition-opacity " +
        (picked ? "opacity-100" : "opacity-0 group-hover/cell:opacity-100")
      }
    >
      <span className="sr-only">Select this cell to price</span>
      <input
        type="checkbox"
        checked={picked}
        onChange={onPick}
        className="block size-3 accent-accent"
      />
    </label>
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
            <Fact term="Channel">{channel}</Fact>
            <Fact term="Charged">{top === undefined ? "—" : amount(top)}</Fact>
            <Fact term="From book">
              {top === undefined
                ? "—"
                : (bookNames.get(top.publication_version) ?? "—")}
            </Fact>
            <Fact term="Products">{count(row?.sku_count)}</Fact>
            <Fact term="Priced at">{at === null ? "Now" : moment(at)}</Fact>
          </Facts>

          {shop === undefined || shop.stack.length === 0 ? (
            <Quiet>
              This shop cannot sell this style. No price is not a price of zero.
            </Quiet>
          ) : (
            <div>
              <SubHead aside="the engine's order">Why this price</SubHead>
              <MiniTable
                head={[
                  "Rung",
                  { label: "For", align: "left" },
                  "In force for",
                  "Price",
                ]}
              >
                {shop.stack.map((rule, index) => (
                  <MiniRow
                    key={`${rule.source}-${rule.publication_version}-${index}`}
                  >
                    <MiniCell>
                      <span className={index === 0 ? "text-ink" : "text-mute"}>
                        {describeSource(rule.source)}
                      </span>
                      <span className="block text-[0.65625rem] text-mute">
                        {bookNames.get(rule.publication_version) ?? "—"}
                      </span>
                    </MiniCell>
                    <MiniCell>
                      <span
                        className={
                          index === 0
                            ? "text-[0.71875rem] text-body"
                            : "text-[0.71875rem] text-mute"
                        }
                      >
                        {describeLevel(rule.applies_to)}
                      </span>
                    </MiniCell>
                    <MiniCell align="right">
                      <span className={index === 0 ? "text-text" : "text-mute"}>
                        {count(rule.in_force_for)} of {count(rule.sku_count)}
                      </span>
                    </MiniCell>
                    <MiniCell align="right">
                      <span
                        className={
                          index === 0 ? "font-medium text-ink" : "text-mute"
                        }
                      >
                        {amount(rule)}
                      </span>
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
              <p className="mt-2 text-[0.71875rem] leading-relaxed text-mute">
                Top row is what the till charges. The rest are candidates it
                beat, ranked by the engine — newest book first, then the most
                specific rung, then the latest start. They are kept because a
                price is only explicable against what it displaced.
              </p>
            </div>
          )}

          {top !== undefined && top.points.length > 1 && (
            <div>
              <SubHead aside="priced per size">Inside the range</SubHead>
              <MiniTable head={["Amount", "Products", "In force for"]}>
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
              What each product rings up at
            </SubHead>
            {queryState(products, {
              loading: "Asking the shop's own engine…",
              render: () =>
                lines.length === 0 ? (
                  <Quiet>
                    This shop has nothing of this style it may sell on {channel}
                    .
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
