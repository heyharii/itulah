import { ArrowLeft, Plus, ShoppingBasket, SlidersHorizontal, Store } from "lucide-react"
import { useMemo } from "react"
import type { AddToBasketRequest, BasketLine, FacetCount, SourcedItem } from "@itulah/contract"

import { Button } from "@/kit/button"
import { CheckRow, SearchField } from "@/kit/field"
import { PageHead, Toolbar } from "@/kit/page"
import { Sheet } from "@/kit/sheet"
import { Empty, Failed, Loading, NoMatch } from "@/kit/state"
import { amount, count } from "@/lib/format"
import { api } from "@/lib/api"
import { useCursorList } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import { useDebounced } from "@/lib/use-debounced"
import { useWrite } from "@/lib/mutate"
import { cn } from "@/lib/cn"

import { ItemRecord } from "@/modules/procurement/item"
import { sizeSpan, termLabel } from "@/modules/procurement/labels"
import { LinkButton, Quiet, Swatches, Thumb } from "@/modules/procurement/parts"
import { useBasket, useColours, useSuppliers, useVocabulary } from "@/modules/procurement/reads"
import { keys, unpackCatalogue, type CataloguePage } from "@/modules/procurement/wire"

/// Sourcing — "who sells this, and for how much".
///
/// A catalogue is BROWSED rather than queried, so this is a grid of
/// photographs and not a table. That is not decoration: a buyer arrives without
/// knowing what they want, and a table asks them to read twelve rows of text
/// before anything catches their eye. It is the one screen in this app that is
/// deliberately not `kit/table.tsx`.
///
/// One request answers the whole screen. `GET /api/v1/supplier-items` matches
/// an item's name or code or the supplier's name, returns the supplier attached
/// to every row, and counts the facets alongside — so the browser never
/// stitches suppliers to items itself, which would put the definition of
/// "matches" somewhere nobody can see and cost one request per supplier.
///
/// ## The number in the corner is the one thing to get right here
///
/// `total` and the facet counts are computed by the server from the SEARCH and
/// the status only, deliberately ignoring which divisions, tags, colours, sizes
/// or suppliers are ticked — because a facet list that only described the
/// current selection could not answer "what if I looked at menswear instead".
///
/// So `total` is the size of the catalogue being browsed, **not** the size of
/// the narrowed list. Printing "120 of 2.814" with three facets on would claim
/// a number nobody computed. The screen therefore says one of two different
/// sentences, and which one it says is decided by whether anything is ticked.
/// This is the same rule as the money tiles on the order book, arriving from
/// the other direction.
///
/// ## Only what is actually on offer
///
/// `status=ACTIVE`, always, with no control to change it. A retired item cannot
/// be ordered, so a toggle that showed them would be a toggle whose every extra
/// row is a row the buyer must not pick. Retired items are master data and are
/// read on Catalogue, which is where somebody goes to fix one.

/// A grid page. Four across at the widest, so this is three screenfuls before
/// anybody asks for more — and the server clamps `limit` at 200 regardless.
const PAGE = 48

export function SourcingScreen() {
  const url = useQueryState()
  const typed = url.one("q")
  const q = useDebounced(typed, 250)
  const sort = url.one("sort") || "relevance"
  const shop = url.one("shop")
  const division = url.many("division")
  const tag = url.many("tag")
  const colour = url.many("colour")
  const size = url.many("size")
  const openId = url.one("item")
  const panel = url.one("panel")

  const vocabulary = useVocabulary()
  const colours = useColours()
  const suppliers = useSuppliers()

  const catalogue = useCursorList<SourcedItem>({
    key: keys.items,
    path: "/api/v1/supplier-items",
    unpack: unpackCatalogue,
    limit: PAGE,
    params: {
      q,
      status: "ACTIVE",
      // Omitted rather than sent as "relevance": the server's default IS
      // relevance, and a cursor issued under one order cannot be walked under
      // another — so the fewer ways one request can be spelled, the better.
      sort: sort === "relevance" ? null : sort,
      // Comma-separated, which is what the handler's `comma_list` reads.
      division: division.length > 0 ? division.join(",") : null,
      tags: tag.length > 0 ? tag.join(",") : null,
      colour: colour.length > 0 ? colour.join(",") : null,
      size: size.length > 0 ? size.join(",") : null,
      // Standing in a shop IS a supplier filter, and it wins — expressed as
      // the same parameter rather than a second one, so the server answers one
      // question and the facet counts stay true.
      supplier_id: shop || null,
    },
  })

  const rows = catalogue.rows
  const head = catalogue.head as CataloguePage | undefined
  const facets = head?.facets

  /// How many items the SEARCH matches. See the note at the top: this is the
  /// catalogue being browsed, not the narrowed list.
  const searchable = head?.total ?? 0
  /// Whether a facet is ticked, which is what decides which sentence the corner
  /// says. The search box and the shop are NOT facets for this purpose: both
  /// are inside what the server counted.
  const faceted =
    division.length + tag.length + colour.length + size.length > 0

  const basket = useBasket()
  /// How many of each item is already picked out, read off the basket the
  /// header is already holding rather than asked for per card — so the count in
  /// the corner and the count on a card are one number and cannot disagree
  /// while a page of forty settles.
  const held = useMemo(
    () =>
      new Map(
        basket.rows.map(
          (line) => [line.item.supplier_item_id, line.quantity] as const,
        ),
      ),
    [basket.rows],
  )
  const picked = basket.rows.reduce((sum, line) => sum + line.quantity, 0)

  /// Picking one up, one piece at a time.
  ///
  /// `POST` ADDS to whatever is already on the line, which is the only thing
  /// this screen does to a basket. Saying exactly how many is a `PATCH` and it
  /// belongs to the basket: a grid is where things are taken off a shelf, and a
  /// screen that also corrected quantities would be asking a buyer to do their
  /// arithmetic in the middle of the shop.
  ///
  /// Not optimistic — see `lib/mutate.ts`. Only the card that was pressed goes
  /// quiet: a shared flag would grey out forty cards because one of them is in
  /// flight, and somebody picking quickly would spend the page waiting on other
  /// people's rows.
  const pick = useWrite<string, BasketLine>({
    send: (supplier_item_id) =>
      api.post<BasketLine>("/api/v1/sourcing-basket", {
        supplier_item_id,
        quantity: 1,
      } satisfies AddToBasketRequest),
    settles: () => [keys.basket],
  })

  // The supplier whose shop this is, taken from a row rather than fetched: the
  // catalogue carries the whole supplier on every item, so a second request to
  // learn a name already in hand is a request for nothing. It falls back to the
  // supplier list for the case that matters — a shop URL opened cold whose
  // first page has not landed yet.
  const standing =
    shop === ""
      ? undefined
      : (rows.find((row) => row.supplier.supplier_id === shop)?.supplier ??
        suppliers.rows.find((one) => one.supplier_id === shop))

  /// What this supplier offers — a thing the facets DO know, counted over the
  /// whole search rather than over the page.
  const offering =
    shop === ""
      ? 0
      : (facets?.suppliers.find((one) => one.value === shop)?.count ?? 0)

  const clear = () =>
    url.set(
      { division: null, tag: null, colour: null, size: null, q: null },
      false,
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {standing ? (
        <PageHead
          module="Procurement · Sourcing"
          title={standing.name}
          description={`${standing.supplier_code} — ${count(offering)} items on offer. Everything below is theirs.`}
          action={
            <Button
              icon={<ArrowLeft className="size-4" />}
              onClick={() => url.set({ shop: null }, false)}
            >
              Every supplier
            </Button>
          }
        />
      ) : (
        <PageHead
          module="Procurement"
          title="Sourcing"
          description="Every supplier's catalogue in one place. Open a supplier to see only what they sell."
          action={
            <LinkButton
              to="/procurement/basket"
              variant={picked > 0 ? "primary" : "ghost"}
            >
              <ShoppingBasket className="size-4" /> Basket
              {picked > 0 && ` · ${count(picked)}`}
            </LinkButton>
          }
        />
      )}

      <Toolbar
        trailing={
          catalogue.query.isPending ? (
            "Loading…"
          ) : faceted ? (
            // Nothing here can honestly be called a total: the server counted
            // the search, and these rows are the search with four facets
            // applied to it.
            <>
              {count(rows.length)} shown
              {catalogue.hasMore ? ", more to load" : ""} — no total is counted
              for a facet selection
            </>
          ) : (
            <>
              {count(rows.length)} of {count(searchable)} shown
            </>
          )
        }
      >
        <SearchField
          value={typed}
          onChange={(value) => url.set({ q: value || null })}
          placeholder={
            standing
              ? `Search in ${standing.name}`
              : "Search every supplier's catalogue"
          }
          className="w-[20rem]"
        />
        <Button
          icon={<SlidersHorizontal className="size-4" />}
          onClick={() =>
            url.set({ panel: panel === "" ? "filter" : null }, false)
          }
        >
          Filters
          {faceted &&
            ` · ${division.length + tag.length + colour.length + size.length}`}
        </Button>
        <Sort value={sort} onChange={(next) => url.set({ sort: next }, false)} />
      </Toolbar>

      {pick.problem !== null && (
        <div className="border-bad/40 bg-bad-wash text-ctl text-bad-ink border-b px-4 py-2">
          The basket refused that: {pick.problem} Nothing was added.
        </div>
      )}

      {catalogue.query.isError ? (
        <Failed
          what="the catalogue"
          error={catalogue.query.error}
          onRetry={() => void catalogue.query.refetch()}
        />
      ) : catalogue.query.isPending ? (
        <Loading rows={6} cols={4} />
      ) : rows.length === 0 ? (
        q === "" && !faceted && shop === "" ? (
          <Empty
            what="supplier items"
            detail="No supplier has offered anything yet. An item enters the catalogue on Catalogue, or when a supplier's feed is imported."
          />
        ) : (
          <NoMatch what="items" onClear={clear} />
        )
      ) : (
        <div className="@container min-h-0 flex-1 overflow-y-auto">
          {/* Container queries, not viewport ones. This column's width is
              whatever the rail and the sidebar leave it, so a `md:` breakpoint
              reading the WINDOW puts four cards in a space that fits two and
              truncates every name. */}
          <div className="grid grid-cols-1 gap-4 p-4 @2xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
            {rows.map((row) => (
              <Card
                key={row.item.supplier_item_id}
                row={row}
                sizes={vocabulary.data?.sizes}
                held={held.get(row.item.supplier_item_id) ?? 0}
                busy={
                  pick.pending &&
                  pick.mutation.variables === row.item.supplier_item_id
                }
                inShop={shop !== ""}
                onOpen={() => url.set({ item: row.item.supplier_item_id }, false)}
                onShop={() => url.set({ shop: row.supplier.supplier_id }, false)}
                onAdd={() => pick.run(row.item.supplier_item_id)}
              />
            ))}
          </div>

          {catalogue.hasMore && (
            <div className="flex justify-center pb-8">
              <Button
                disabled={catalogue.loadingMore}
                onClick={() => void catalogue.loadMore()}
              >
                {catalogue.loadingMore ? "Fetching…" : "Show more"}
              </Button>
            </div>
          )}
        </div>
      )}

      <FacetPanel
        open={panel === "filter"}
        onClose={() => url.set({ panel: null }, false)}
        facets={facets}
        inShop={shop !== ""}
        groups={[
          {
            key: "division",
            label: "Division",
            chosen: division,
            values: facets?.divisions ?? [],
            name: (code) => termLabel(vocabulary.data?.divisions, code),
          },
          {
            key: "tag",
            label: "Tag",
            chosen: tag,
            values: facets?.tags ?? [],
            name: (code) => termLabel(vocabulary.data?.tags, code),
          },
          {
            key: "colour",
            label: "Colour",
            chosen: colour,
            values: facets?.colours ?? [],
            name: (code) =>
              colours.data?.colours.find((one) => one.code === code)?.label ??
              code,
            dot: (code) =>
              colours.data?.colours.find((one) => one.code === code)
                ?.hex_code ?? null,
          },
          {
            key: "size",
            label: "Size",
            chosen: size,
            values: facets?.sizes ?? [],
            name: (code) =>
              vocabulary.data?.sizes.find((one) => one.code === code)?.label ??
              code,
          },
        ]}
        onToggle={(key, value, on) => {
          const current =
            key === "division"
              ? division
              : key === "tag"
                ? tag
                : key === "colour"
                  ? colour
                  : size
          const next = on
            ? [...current, value]
            : current.filter((each) => each !== value)
          url.set({ [key]: next.length === 0 ? null : [...next] }, false)
        }}
        onClear={clear}
      />

      <ItemSheet
        id={openId}
        row={rows.find((row) => row.item.supplier_item_id === openId)}
        onClose={() => url.set({ item: null }, false)}
      />
    </div>
  )
}

/// How the catalogue is ordered.
///
/// Four, and deliberately no "popular" and no "best selling". Popular would be
/// a ranking with no signal behind it — nothing records views, per-item order
/// counts a shopper generated, or ratings — and best selling needs a sold
/// figure, which needs every supplier item to carry an article code of ours.
/// Almost none do. A sort somebody trusts and that is invented is worse than a
/// sort that is missing.
const SORTS = [
  ["relevance", "Best match"],
  ["newest", "Newest"],
  ["price_low", "Price low"],
  ["price_high", "Price high"],
] as const

function Sort({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-ctl text-ink-4 mr-0.5">Sort</span>
      {SORTS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "h-ctl rounded-ctl text-ctl px-2.5 font-medium whitespace-nowrap transition-colors",
            value === key
              ? "bg-field text-ink"
              : "text-ink-3 hover:bg-hover hover:text-ink",
          )}
        >
          {label}
        </button>
      ))}
    </span>
  )
}

/// One product, as a buyer sees it before they know they want it.
///
/// The supplier is a CONTROL, not a caption: "who else sells this" is the
/// question a catalogue exists to answer, and one click is the whole point.
/// It is dropped while standing in one supplier's shop, where every card would
/// carry the same name and the button could only do nothing.
function Card({
  row,
  sizes,
  held,
  busy,
  inShop,
  onOpen,
  onShop,
  onAdd,
}: {
  row: SourcedItem
  sizes: readonly { code: string; label: string }[] | undefined
  held: number
  busy: boolean
  inShop: boolean
  onOpen: () => void
  onShop: () => void
  onAdd: () => void
}) {
  const item = row.item
  return (
    <div className="rounded-card border-line bg-canvas shadow-card flex flex-col overflow-hidden border">
      <button
        type="button"
        onClick={onOpen}
        className="bg-field block aspect-[4/3] w-full overflow-hidden"
      >
        {item.image_url === null ? (
          <span className="text-meta text-ink-4 grid h-full place-items-center">
            no photograph
          </span>
        ) : (
          <img
            src={item.image_url}
            alt={item.name}
            loading="lazy"
            className="size-full object-cover"
          />
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-2.5">
        <button
          type="button"
          onClick={onOpen}
          className="text-cell text-ink hover:text-blue truncate text-left font-medium transition-colors"
          title={item.name}
        >
          {item.name}
        </button>

        {!inShop && (
          <button
            type="button"
            onClick={onShop}
            className="text-label text-ink-3 hover:text-blue flex items-center gap-1 truncate text-left transition-colors"
          >
            <Store className="size-3 shrink-0" />
            {row.supplier.name}
          </button>
        )}

        <span className="text-cell text-ink font-medium tabular-nums">
          {amount(item.unit_price_minor)}
          <span className="text-label text-ink-4 ml-1 font-normal">
            {item.currency}
          </span>
        </span>

        {/* What it comes in — the two facts migration 0092 added and the
            reason a supplier catalogue that drops the variant is wrong. Five
            dots and the ends of the size range here; the sheet shows the full
            lists, because the sheet is where somebody goes to READ. */}
        <span className="flex items-center gap-2">
          <Swatches colours={item.colours} limit={5} />
          <span className="text-label text-ink-4">
            {item.size_codes.length === 0 ? (
              <Quiet>no sizes recorded</Quiet>
            ) : (
              sizeSpan(sizes, item.size_codes)
            )}
          </span>
        </span>

        <span className="mt-auto flex items-center gap-2 pt-1">
          <Button
            variant={held > 0 ? "ghost" : "primary"}
            disabled={busy}
            onClick={onAdd}
            icon={<Plus className="size-4" />}
            className="flex-1"
          >
            {busy ? "Adding…" : held > 0 ? `In basket · ${count(held)}` : "Add"}
          </Button>
        </span>
      </div>
    </div>
  )
}

/// What else is in this catalogue, as four lists of ticks.
///
/// The number beside a value is the whole affordance: it is how somebody
/// decides whether a filter is worth pressing before they press it. They are
/// the server's, counted over everything the SEARCH matches rather than over
/// the current selection — which is what stops ticking one division making the
/// others read zero.
///
/// The colour and size lists exist because a supplier item carries colours and
/// sizes (migration 0092). The counts there are counted **by item, not by
/// variant**: an item offered in five colours adds one to each of five rows, so
/// they answer "how many things could I buy in navy" and summing them exceeds
/// the catalogue, which is correct and is the same thing the tag counts do.
function FacetPanel({
  open,
  onClose,
  facets,
  inShop,
  groups,
  onToggle,
  onClear,
}: {
  open: boolean
  onClose: () => void
  facets: CataloguePage["facets"] | undefined
  inShop: boolean
  groups: readonly {
    key: string
    label: string
    chosen: readonly string[]
    values: readonly FacetCount[]
    name: (code: string) => string
    dot?: (code: string) => string | null
  }[]
  onToggle: (key: string, value: string, on: boolean) => void
  onClear: () => void
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="What else is in here"
      subtitle="Counted over everything the search matches, not over what you have already ticked."
      foot={<Button onClick={onClear}>Clear every facet</Button>}
    >
      {facets === undefined ? (
        <Loading rows={6} cols={2} />
      ) : (
        groups.map((group) => (
          <div key={group.key}>
            <h3 className="border-line bg-side text-meta text-ink-3 border-y px-[18px] py-1.5 font-medium">
              {group.label}
            </h3>
            <div className="px-2 py-1.5">
              {group.values.length === 0 ? (
                <p className="text-ctl text-ink-4 px-2 py-1.5">
                  Nothing in this catalogue carries one.
                </p>
              ) : (
                group.values.map((facet) => (
                  <CheckRow
                    key={facet.value}
                    checked={group.chosen.includes(facet.value)}
                    onChange={(on) => onToggle(group.key, facet.value, on)}
                    // `Unclassified` is the label `sourcing_facets` files items
                    // with nothing in the column under. It is counted like a
                    // division and is not one — ticking it filters on the
                    // string, which matches nothing, so it is drawn and left
                    // alone rather than hidden. The honest fix is
                    // `division_null=true`, which this panel has no shape for.
                    label={group.name(facet.value)}
                    count={facet.count}
                    dot={group.dot?.(facet.value) ?? undefined}
                  />
                ))
              )}
            </div>
          </div>
        ))
      )}

      {inShop && (
        <p className="text-ctl text-ink-4 mt-auto px-[18px] py-3">
          Filtering by supplier is not offered while you are standing in one
          supplier's shop: it is the same parameter, and it could only do
          nothing.
        </p>
      )}
    </Sheet>
  )
}

/// One item, read.
///
/// The row behind it is handed in for two things the record cannot answer: the
/// supplier it came from, which the catalogue already carries on every row, and
/// what has already been bought of it, which only the sourcing search computes.
/// A URL naming an item this page is not holding still opens — see
/// `ItemRecord`, which re-reads.
function ItemSheet({
  id,
  row,
  onClose,
}: {
  id: string
  row: SourcedItem | undefined
  onClose: () => void
}) {
  return (
    <Sheet
      open={id !== ""}
      onClose={onClose}
      width="record"
      title={row?.item.name ?? "Supplier item"}
      subtitle={row?.supplier.name ?? "Reading the item…"}
      foot={
        row && (
          <LinkButton
            to="/procurement/catalogue"
            search={{ item: row.item.supplier_item_id }}
          >
            Open it as master data
          </LinkButton>
        )
      }
    >
      <ItemRecord id={id} bought={row?.bought} />
    </Sheet>
  )
}
