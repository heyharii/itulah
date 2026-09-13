import { useMemo } from "react"
import { Filter, Store, Tags } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { Button } from "@/kit/button"
import { CheckRow, SearchField } from "@/kit/field"
import { PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { Sheet } from "@/kit/sheet"
import { Table } from "@/kit/table"
import { Tag } from "@/kit/tag"
import { Tile, Tiles } from "@/kit/tiles"
import { Empty, Failed, Loading, NoMatch } from "@/kit/state"
import { amount, count, day } from "@/lib/format"
import { useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import { useDebounced } from "@/lib/use-debounced"
import type { TableSetup } from "@/lib/table"
import {
  Capped,
  Fact,
  Facts,
  Line,
  Quiet,
  SubHead,
} from "@/modules/commercial/parts"
import {
  describeLevel,
  describeSource,
  sourceWord,
} from "@/modules/commercial/labels"
import type {
  ArticlePriceRow,
  ArticlePrices,
  PriceBook,
  PriceCandidate,
  ShopStack,
} from "@/modules/commercial/wire"

/// The pricelist — what every style costs at every shop, right now, and why.
///
/// One row is one STYLE, across the whole fleet. That is the reading a per-shop
/// list cannot give: a branch quietly charging from a book two versions old
/// looks perfectly consistent with itself, and only the comparison catches it.
///
/// ## Why `useReport` and not either list hook
///
/// `GET /commercial/article-prices` is neither of the two shapes `lib/list.ts`
/// is built around. It is not a cursor envelope — there is no `next_cursor`
/// anywhere on the commercial surface — and it is not a bare capped array
/// either: it answers ONE object carrying the shop columns, the facet counts,
/// two counts and `items`. So `useCursorList` cannot page it and
/// `useBoundedList` would not parse it, and the honest hook is the one that
/// treats a whole answer as a whole answer.
///
/// What it does have is real server narrowing, and every one of them is used:
/// `q` over the style code, the style name and the SKU codes; `divisions` and
/// `tags` as facets; `min_price` and `max_price` as bounds. Nothing on this
/// screen is filtered in the browser — see `lib/table.ts` for why a second
/// definition of "matches" could only ever disagree with the server's, and
/// would be blind to the SKU codes the server searched.
///
/// ## What it cannot do, and what the screen says about it
///
/// `limit` defaults to 200 and clamps at 2.000; `total_article_count` counts
/// the same narrowing before that limit. So the screen can say "200 of 1.284",
/// which is more than most of this surface manages — but there is no cursor, so
/// the other 1.084 cannot be fetched at all. `<Capped>` says exactly that
/// rather than borrowing the kit's `Truncated`, whose sentence claims the
/// endpoint knows no total.
///
/// One qualification travels with that figure and is printed beside it: the
/// price bounds are applied AFTER pricing, because what a style costs is the
/// answer rather than the question, and `total_article_count` is counted
/// before them. With a bound set it is a ceiling, not a count of matches.
///
/// ## Three readings derived here, and why each is honest
///
/// Every figure in a cell comes off `row.shops`, which is COMPLETE for that
/// row — the server prices every shop that can sell the style and omits only
/// the ones that cannot. That is the distinction the house rule is about: a sum
/// over a page that may be a fraction of the set is a lie, and a reading of one
/// row's whole payload is not. The server computes the very same min and max
/// over rank 0 to apply its own price bounds, so this mirrors rather than
/// invents.
///
/// ## What did not come across from the old screen
///
///   **The matrix.** The screen this replaces drew a grid of styles by shops
///   with a frozen first column, written by hand because `<DataTable>` could
///   not be one. There is one table grammar in this app and it is
///   `kit/table.tsx`; thirteen shop columns would be dropped to three by the
///   width budget before anybody read them. The per-shop detail is in the
///   sheet instead, where a stack has room to be read as a stack.
///
///   **The scheduled-price diff.** The old screen asked the endpoint a second
///   time at the instant the next published book starts, and showed which
///   prices were about to change. It is a genuinely good reading and it doubles
///   the heaviest request in the app — this one prices styles TIMES shops. The
///   honest cheap half is kept: the next book's start date, read from the
///   publications list, which needs no second pricing run.
///
///   **Every write.** The composer, the markdown sheet, the publish flow. This
///   module is a port of the reads; a price book is written with an idempotency
///   key and a two-step publish, and that belongs in its own change.

/// The channel this grid is about.
///
/// A constant rather than a picker. The engine takes all three and `ONLINE` and
/// `MARKETPLACE` are real, but nothing in this business sells on them yet — so
/// a control would have offered two answers that are always empty and made the
/// third look like a choice. The request below already takes it as a parameter.
const CHANNEL = "STORE"

/// How many styles to price. The endpoint's own default, restated here because
/// `<Capped>` prints it and a figure that disagreed with the request would be
/// worse than none.
const LIMIT = 200

/// What the till charges for a style, across every shop that can sell it.
///
/// Rank 0 only. The rungs below it are prices that were BEATEN, and a range
/// drawn from those would report an amount no shop is charging.
function charged(row: ArticlePriceRow): { low: number; high: number } | null {
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (const shop of row.shops) {
    const top = shop.stack[0]
    if (top === undefined) continue
    low = Math.min(low, top.min_unit_price_minor)
    high = Math.max(high, top.max_unit_price_minor)
  }
  return low <= high ? { low, high } : null
}

/// How many distinct prices the fleet is charging for one style.
///
/// A pair rather than a number, because a style can be priced per size: one
/// shop's winning candidate already covers a range, and two shops agree only
/// when both ends agree.
function distinctPrices(row: ArticlePriceRow): number {
  const seen = new Set<string>()
  for (const shop of row.shops) {
    const top = shop.stack[0]
    if (top === undefined) continue
    seen.add(`${top.min_unit_price_minor}-${top.max_unit_price_minor}`)
  }
  return seen.size
}

/// Shops whose winning price is a clearance rather than a base price.
///
/// Read from `markdown_id` rather than by comparing two amounts: a markdown
/// authored at or above the base price still wins the cascade and still
/// charges what it charges, and this column is about which rung won.
function onClearance(row: ArticlePriceRow): number {
  return row.shops.filter((shop) => shop.stack[0]?.markdown_id != null).length
}

/// Whether two shops are charging the same KIND of price from different books.
///
/// Compared per source, and that comparison cost the old screen a rewrite to
/// learn. Taking the highest version across a whole row meant one shop's
/// clearance dragged every other shop's *pricelist* into looking stale: a
/// branch simply left out of a two-shop cap clearance was marked "behind v9" on
/// the pricelist it shares with everybody — a warning that was not merely
/// useless but false.
///
/// Like with like, the mark means what it says: this shop's company price comes
/// out of an older book than its neighbour's company price, which is a real
/// difference somebody has to explain.
function versionsDisagree(row: ArticlePriceRow): boolean {
  const bySource = new Map<string, number>()
  for (const shop of row.shops) {
    const top = shop.stack[0]
    if (top === undefined) continue
    const seen = bySource.get(top.source)
    if (seen === undefined) bySource.set(top.source, top.publication_version)
    else if (seen !== top.publication_version) return true
  }
  return false
}

export function PricelistScreen() {
  const url = useQueryState()
  const typed = url.one("q")
  const divisions = url.many("division")
  const tags = url.many("tag")
  const min = url.one("min")
  const max = url.one("max")
  const panel = url.one("panel")
  const openCode = url.one("article")

  // A long pause, not the usual 200ms. This endpoint prices every matching
  // style across every shop — a keystroke is seconds of server work — so the
  // box waits until a word has been typed rather than asking six questions on
  // the way through "kemeja".
  const q = useDebounced(typed, 400)

  const prices = useReport<ArticlePrices>({
    key: ["commercial", "article-prices"],
    path: "/api/v1/commercial/article-prices",
    // `divisions` and `tags` cross the wire as ONE comma-joined string, not as
    // repeated keys — `comma_list` on the server splits, trims and drops the
    // blanks. Sent as `null` when nothing is ticked rather than as an empty
    // string: `?divisions=` is a list holding one empty value, which matches no
    // division and would empty the screen on a filter nobody set.
    params: {
      channel: CHANNEL,
      limit: LIMIT,
      q: q || null,
      divisions: divisions.length > 0 ? divisions.join(",") : null,
      tags: tags.length > 0 ? tags.join(",") : null,
      min_price: min || null,
      max_price: max || null,
    },
  })

  /// The books, for the one thing the grid cannot say for itself: what the
  /// publication behind a price is CALLED.
  ///
  /// A price rule has no name of its own, so a price's identity is the book it
  /// came out of — "Bandung + Surabaya cap clearance" says who decided and why
  /// in a way "v9" never can. The endpoint takes no parameters and applies no
  /// cap, so this is every book there has ever been.
  const books = useReport<{ items: readonly PriceBook[] }>({
    key: ["commercial", "publications"],
    path: "/api/v1/commercial/publications",
  })

  const bookNames = useMemo(() => {
    const named = new Map<number, string>()
    for (const book of books.data?.items ?? [])
      named.set(book.version, book.name)
    return named
  }, [books.data])

  const data = prices.data
  const rows = useMemo(() => data?.items ?? [], [data])
  const fleet = data?.shops.length ?? 0

  /// When the next published book takes effect, measured against the instant
  /// the grid was priced at.
  ///
  /// Against `as_of` and never against the browser's clock. Two reasons, and
  /// the second is the one that matters: a component may not read a clock
  /// during render, because the answer changes on a re-render nobody asked
  /// for; and everything below is the server's answer at that instant, so a
  /// book is only "upcoming" relative to the moment the grid was drawn for.
  const nextBook = useMemo(() => {
    if (data === undefined) return null
    const drawnAt = new Date(data.as_of).getTime()
    const ahead = (books.data?.items ?? [])
      .filter(
        (book) =>
          book.status === "PUBLISHED" &&
          new Date(book.effective_from).getTime() > drawnAt,
      )
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from))
    return ahead[0] ?? null
  }, [books.data, data])

  const narrowed =
    q !== "" ||
    divisions.length > 0 ||
    tags.length > 0 ||
    min !== "" ||
    max !== ""

  const columns: ColumnDef<TableSetup, ArticlePriceRow>[] = [
    {
      id: "style",
      header: "Style",
      size: 29,
      // No priority: it is the identity column, and a pricelist that hides
      // which style a figure belongs to has stopped being a pricelist.
      meta: { icon: <Tags className="size-[15px]" />, min: 230 },
      cell: ({ row }) => {
        const style = row.original
        return (
          <>
            <span className="text-ink block truncate font-medium">
              {style.article_name || style.article_code}
            </span>
            <span className="text-label text-ink-4 flex items-center gap-1.5">
              <span className="font-mono">{style.article_code}</span>
              {style.division_code && <span>· {style.division_code}</span>}
              <span>
                · {count(style.sku_count)}{" "}
                {style.sku_count === 1 ? "product" : "products"}
              </span>
            </span>
          </>
        )
      },
    },
    {
      id: "charged",
      header: "Charged now",
      size: 18,
      // Never dropped. This is the figure the screen exists for.
      meta: { align: "right", min: 150 },
      cell: ({ row }) => {
        const range = charged(row.original)
        if (range === null) {
          return (
            <Quiet>
              <span title="No shop holds a price for this style at this channel. No price is not a price of zero, so nothing is drawn.">
                not priced
              </span>
            </Quiet>
          )
        }
        if (range.low === range.high) {
          return (
            <span className="text-ink font-medium tabular-nums">
              {amount(range.low)}
            </span>
          )
        }
        // A style priced per size, or priced differently by shop. Both ends
        // are the server's own integers; nothing here averages them, because
        // an average of two real prices is a price nobody charges.
        return (
          <span className="text-ink font-medium tabular-nums">
            {amount(range.low)} – {amount(range.high)}
          </span>
        )
      },
    },
    {
      id: "spread",
      header: "Across the fleet",
      size: 16,
      // The question this screen exists to answer, and the one a per-shop list
      // cannot ask at all.
      meta: { min: 160, priority: 2 },
      cell: ({ row }) => {
        const distinct = distinctPrices(row.original)
        if (distinct === 0) return <Quiet />
        if (distinct === 1) {
          return <Tag tone="ok">One price everywhere</Tag>
        }
        return <Tag tone="warn">{count(distinct)} different prices</Tag>
      },
    },
    {
      id: "clearance",
      header: "Clearance",
      size: 13,
      meta: { min: 125, priority: 3 },
      cell: ({ row }) => {
        const shops = onClearance(row.original)
        if (shops === 0) return <Quiet>—</Quiet>
        return (
          <Tag tone="info">
            {shops === row.original.shops.length
              ? "Every shop"
              : `${count(shops)} of ${count(row.original.shops.length)}`}
          </Tag>
        )
      },
    },
    {
      id: "shops",
      header: "Priced at",
      size: 12,
      meta: {
        icon: <Store className="size-[15px]" />,
        align: "right",
        min: 115,
        priority: 1,
      },
      cell: ({ row }) => {
        const priced = row.original.shops.length
        return (
          <span
            className={
              priced < fleet
                ? "text-warn-ink font-medium tabular-nums"
                : "text-ink-2 tabular-nums"
            }
            title={
              priced < fleet
                ? "A shop is absent from this row because it holds no price for the style — not because the price is zero."
                : undefined
            }
          >
            {count(priced)} / {count(fleet)}
          </span>
        )
      },
    },
    {
      id: "book",
      header: "From the book",
      size: 12,
      meta: { min: 120, priority: 4 },
      cell: ({ row }) => {
        const versions = [
          ...new Set(
            row.original.shops
              .map((shop) => shop.stack[0]?.publication_version)
              .filter((version): version is number => version !== undefined),
          ),
        ].sort((a, b) => a - b)
        if (versions.length === 0) return <Quiet />
        const label =
          versions.length === 1
            ? `v${versions[0]}`
            : `v${versions[0]}–v${versions[versions.length - 1]}`
        return versionsDisagree(row.original) ? (
          <Tag tone="warn">
            <span title="Two shops are charging the same kind of price out of different books. Compared like with like — a clearance at one shop is not a reason to call another shop's pricelist stale.">
              {label} behind
            </span>
          </Tag>
        ) : (
          <span className="text-ink-3 tabular-nums">{label}</span>
        )
      },
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Commercial"
        title="Pricelist"
        description="What each style costs at each shop, which rung of the cascade set it, and where the fleet disagrees with itself."
      />

      {/* A price is a position, never a period: this is what the tills would
          charge at one instant, and it is the server's instant rather than the
          browser's. See kit/scope.tsx for why the three sentences never
          share one phrasing. */}
      <ScopeLine
        scope={{ kind: "asAt", date: data?.as_of.slice(0, 10) ?? "" }}
        note={
          nextBook === null ? (
            "STORE channel · no published book starts later than this"
          ) : (
            <>
              STORE channel · next book{" "}
              <b className="text-ink-2 font-medium">{nextBook.name}</b> starts{" "}
              {day(nextBook.effective_from)}
            </>
          )
        }
      />

      <Tiles>
        {/* Both figures are the server's own counts. Neither is a length of
            what happens to be on screen — `article_count` is the rows it sent
            and `total_article_count` is what the narrowing matches, and saying
            them apart is the whole point of drawing two. */}
        <Tile
          label="Styles priced"
          value={data === undefined ? "—" : count(data.article_count)}
          note={
            data === undefined
              ? undefined
              : `of ${count(data.total_article_count)} matching`
          }
        />
        <Tile
          label="Shops"
          value={data === undefined ? "—" : count(fleet)}
          note="every STORE origin the centre knows"
        />
        <Tile
          label="Disagreeing"
          value={
            data === undefined
              ? "—"
              : count(rows.filter((row) => distinctPrices(row) > 1).length)
          }
          tone={
            rows.some((row) => distinctPrices(row) > 1) ? "warn" : undefined
          }
          // Said plainly, because it is a count over the rows that ARRIVED and
          // not over everything the narrowing matched. The endpoint answers no
          // such aggregate, and inventing one over a capped answer is exactly
          // the total that lies quietly.
          note="of the styles on this page"
        />
        <Tile
          label="On clearance"
          value={
            data === undefined
              ? "—"
              : count(rows.filter((row) => onClearance(row) > 0).length)
          }
          note="of the styles on this page"
        />
      </Tiles>

      {data !== undefined && data.article_count < data.total_article_count && (
        <Capped
          shown={data.article_count}
          matched={data.total_article_count}
          noun="styles"
          caveat={
            min !== "" || max !== "" ? (
              <>
                The total is counted before the price bound, so it is a ceiling
                rather than a count of matches.
              </>
            ) : undefined
          }
        />
      )}

      <Toolbar trailing={prices.isFetching ? "Pricing…" : undefined}>
        <SearchField
          value={typed}
          onChange={(value) => url.set({ q: value || null })}
          // Says what it searches, because the answer is wider than the row:
          // the server matches SKU codes too, and a style found by a code that
          // is not on screen reads as a fault unless the box said so.
          placeholder="Search a style code, a name or a SKU"
          className="w-[22rem]"
        />
        <Button
          icon={<Filter className="size-4" />}
          onClick={() =>
            url.set({ panel: panel === "filter" ? null : "filter" }, false)
          }
        >
          Filter
          {divisions.length + tags.length > 0 && (
            <span className="text-ink-4 tabular-nums">
              {divisions.length + tags.length}
            </span>
          )}
        </Button>
        {/* Two bounds rather than one "between", because they land on two
            request parameters and AND on the server exactly as they read.
            Sent as typed: `unit_price_minor` is whole rupiah despite the name,
            so scaling by a hundred — which the name invites — is the mistake
            that has already cost this codebase seven columns. */}
        <Bound
          label="Rp from"
          value={min}
          onChange={(value) => url.set({ min: value || null })}
        />
        <Bound
          label="to"
          value={max}
          onChange={(value) => url.set({ max: value || null })}
        />
      </Toolbar>

      {prices.isError ? (
        <Failed
          what="the pricelist"
          error={prices.error}
          onRetry={() => void prices.refetch()}
        />
      ) : prices.isPending ? (
        <Loading cols={6} />
      ) : rows.length === 0 ? (
        narrowed ? (
          <NoMatch
            what="styles"
            held={data?.total_article_count}
            onClear={() =>
              url.set(
                { q: null, division: null, tag: null, min: null, max: null },
                false,
              )
            }
          />
        ) : (
          <Empty
            what="priced styles"
            detail="No published price book names a style for the STORE channel, so there is nothing for a till to charge."
          />
        )
      ) : (
        <Table
          columns={columns}
          rows={rows as ArticlePriceRow[]}
          rowId={(row) => row.article_code}
          caption="Every style, priced across the fleet"
          onRowClick={(row) => url.set({ article: row.article_code }, false)}
          isOpen={(row) => row.article_code === openCode}
          foot={{
            style: (
              <>
                <b className="text-ink">{count(data?.article_count ?? 0)}</b> of{" "}
                {count(data?.total_article_count ?? 0)} styles
              </>
            ),
            charged: "rank 0 only — what the till charges",
          }}
        />
      )}

      <FilterPanel
        open={panel === "filter"}
        onClose={() => url.set({ panel: null }, false)}
        facets={data?.facets}
        divisions={divisions}
        tags={tags}
        onDivisions={(next) => url.set({ division: [...next] }, false)}
        onTags={(next) => url.set({ tag: [...next] }, false)}
      />

      <StyleSheet
        openCode={openCode}
        row={rows.find((row) => row.article_code === openCode)}
        bookNames={bookNames}
        onClose={() => url.set({ article: null }, false)}
      />
    </div>
  )
}

/// One end of the price bound, as a number field.
///
/// Written inline in the same shape `modules/finance/aging.tsx` gives its
/// as-at date, rather than promoted to `kit/field.tsx`: the kit holds a search
/// box and a facet checkbox because two modules wanted each, and this is the
/// first numeric narrowing in the app. It goes to the kit when a second screen
/// wants one.
function Bound({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="h-ctl rounded-ctl border-line-2 bg-canvas shadow-btn focus-within:border-blue flex shrink-0 items-center gap-2 border px-2.5">
      <span className="text-ctl text-ink-4">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="text-ctl text-ink w-20 bg-transparent tabular-nums outline-none"
      />
    </label>
  )
}

/// The facets, ticked.
///
/// The counts are the SERVER's and they are counted over the whole catalogue
/// rather than over what came back — so ticking a second box shows what it
/// would ADD, instead of every unticked row reading zero. A value the server
/// did not count is simply not a row here; a zero would claim it was measured.
function FilterPanel({
  open,
  onClose,
  facets,
  divisions,
  tags,
  onDivisions,
  onTags,
}: {
  open: boolean
  onClose: () => void
  facets: ArticlePrices["facets"]
  divisions: readonly string[]
  tags: readonly string[]
  onDivisions: (next: readonly string[]) => void
  onTags: (next: readonly string[]) => void
}) {
  const toggle = (
    picked: readonly string[],
    value: string,
    on: boolean,
  ): readonly string[] =>
    on ? [...picked, value] : picked.filter((one) => one !== value)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Narrow the pricelist"
      subtitle="Counted across the whole catalogue, not across this page"
    >
      {facets === undefined ? (
        <p className="text-ctl text-ink-3 px-[18px] py-4">
          The answer carried no facet counts, so there is nothing to tick. That
          is the endpoint's silence, not an empty catalogue.
        </p>
      ) : (
        <div className="flex flex-col gap-4 px-3 py-3">
          <div>
            <div className="text-label text-ink-4 px-2 pb-1">Division</div>
            {facets.divisions.map((facet) => (
              <CheckRow
                key={facet.value}
                checked={divisions.includes(facet.value)}
                onChange={(on) =>
                  onDivisions(toggle(divisions, facet.value, on))
                }
                label={facet.value}
                count={facet.count}
              />
            ))}
          </div>
          <div>
            <div className="text-label text-ink-4 px-2 pb-1">
              Tag — a style matches if it carries any ticked tag
            </div>
            {facets.tags.map((facet) => (
              <CheckRow
                key={facet.value}
                checked={tags.includes(facet.value)}
                onChange={(on) => onTags(toggle(tags, facet.value, on))}
                label={facet.value}
                count={facet.count}
              />
            ))}
          </div>
        </div>
      )}
    </Sheet>
  )
}

/// One style, shop by shop — the matrix, unfolded into something readable.
///
/// Read from the row the list is already holding rather than from a second
/// request, because there is no by-style endpoint: `article-prices` is the only
/// route that prices anything, and it prices a whole page at a time. So a URL
/// naming a style that is not on this page opens a panel that says so, which is
/// the honest answer rather than a spinner that never resolves.
function StyleSheet({
  openCode,
  row,
  bookNames,
  onClose,
}: {
  openCode: string
  row: ArticlePriceRow | undefined
  bookNames: ReadonlyMap<number, string>
  onClose: () => void
}) {
  return (
    <Sheet
      open={openCode !== ""}
      onClose={onClose}
      width="record"
      title={row?.article_name || openCode}
      subtitle={
        row === undefined
          ? "Not on this page"
          : `${row.article_code} · ${count(row.sku_count)} products · priced at ${count(row.shops.length)} shops`
      }
    >
      {row === undefined ? (
        <p className="text-ctl text-ink-3 px-[18px] py-4">
          This style is not among the ones the pricelist fetched. There is no
          endpoint that prices one style on its own, so it cannot be opened from
          a link alone — narrow the list until it is on the page.
        </p>
      ) : (
        <>
          <Facts>
            <Fact label="Division">
              {row.division_code ?? <Quiet>Unfiled</Quiet>}
            </Fact>
            <Fact label="Products">{count(row.sku_count)}</Fact>
            <Fact label="Tags" wide>
              {row.tags.length === 0 ? (
                <Quiet>None</Quiet>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {row.tags.map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </span>
              )}
            </Fact>
          </Facts>

          {row.shops.map((shop) => (
            <ShopBlock
              key={shop.site_id}
              shop={shop}
              bookNames={bookNames}
              products={row.sku_count}
            />
          ))}

          <p className="text-meta text-ink-4 mt-auto px-[18px] py-3">
            The order of each stack is the engine's ranking, not a sort. Rank 0
            is what the till charges; the rest are the candidates it beat, and
            they are shown because "why is it this price" is answered by what it
            lost to.
          </p>
        </>
      )}
    </Sheet>
  )
}

function ShopBlock({
  shop,
  bookNames,
  products,
}: {
  shop: ShopStack
  bookNames: ReadonlyMap<number, string>
  products: number
}) {
  return (
    <>
      <SubHead>{shop.label}</SubHead>
      {shop.stack.map((rung, index) => (
        <Candidate
          key={`${rung.rank}-${rung.source}-${index}`}
          rung={rung}
          bookNames={bookNames}
          products={products}
        />
      ))}
    </>
  )
}

function Candidate({
  rung,
  bookNames,
  products,
}: {
  rung: PriceCandidate
  bookNames: ReadonlyMap<number, string>
  /// The STYLE's own product count, so `in_force_for` can be said as a fraction
  /// rather than as a bare number nobody can scale.
  ///
  /// The style's and not the candidate's `sku_count`, which is how many
  /// products this rung NAMES — a different denominator, and one that would
  /// make "in force for 6 of 6" out of a rung that names six and wins six of
  /// the style's eight.
  products: number
}) {
  const winner = rung.rank === 0
  const book = bookNames.get(rung.publication_version)
  return (
    <Line
      dim={!winner}
      note={
        <>
          {describeLevel(rung.applies_to)} ·{" "}
          {book === undefined ? (
            <>v{rung.publication_version}</>
          ) : (
            <>
              {book} (v{rung.publication_version})
            </>
          )}{" "}
          · from {day(rung.effective_from)}
          {rung.effective_to !== null && <> to {day(rung.effective_to)}</>}
          {/* A losing rung can still be in force for some sizes: a shop price
              on one size beats the company price on that size alone, and the
              company rung then wins the rest. Drawn only when it is neither
              all nor none, because those two are already said above. */}
          {rung.in_force_for > 0 && rung.in_force_for < products && (
            <>
              {" "}
              · in force for {count(rung.in_force_for)} of {count(products)}
            </>
          )}
        </>
      }
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {winner ? <Tag tone="ok">Charged</Tag> : <Tag>Beaten</Tag>}
          <span className="text-ink-2">{sourceWord(rung.source)}</span>
        </span>
        {rung.points.length > 1 && (
          <span className="text-label text-ink-4 mt-0.5 block">
            {/* Every amount named, rather than the dashed range beside it. A
                range reads as one fact and is not one: it hides how many
                distinct prices there are and which of them the till charges.
                `covers` is the careful word — a point says how many products
                the rung NAMES at that amount, which is not the same as how many
                it wins, and the "in force for" clause under this one is where
                that second number lives. */}
            {rung.points
              .map(
                (point) =>
                  `${amount(point.unit_price_minor)} covers ${count(point.sku_codes.length)}`,
              )
              .join(" · ")}
          </span>
        )}
        <span className="text-label text-ink-4 mt-0.5 block">
          {describeSource(rung.source)}
        </span>
      </span>
      <span
        className={
          winner
            ? "text-ink shrink-0 font-medium tabular-nums"
            : "text-ink-3 shrink-0 tabular-nums"
        }
      >
        {rung.min_unit_price_minor === rung.max_unit_price_minor
          ? amount(rung.min_unit_price_minor)
          : `${amount(rung.min_unit_price_minor)} – ${amount(rung.max_unit_price_minor)}`}
      </span>
    </Line>
  )
}
