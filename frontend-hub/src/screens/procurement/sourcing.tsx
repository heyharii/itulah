import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { ArrowLeft, Plus, Search, ShoppingBasket, Store } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Fab } from "@/components/ui/fab"
import { Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, LoadMore } from "@/components/ui/states"
import { FilterOmnibox } from "@/components/ui/filter-omnibox"
import {
  ChoiceMenu,
  DockedFilters,
  ListOptionsSheet,
  ViewPicker,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Tag } from "@/components/ui/tag"
import { colourKeys, listColours, type ColourTerm } from "@/lib/queries/colours"
import { useFilterState, type FilterField } from "@/lib/filters"
import { count, money } from "@/lib/format"
import {
  addToBasket,
  catalogueVocabulary,
  listSuppliers,
  procurementKeys,
  readBasket,
  scopeFromFilters,
  searchSupplierItems,
  supplierItemDetail,
  type SourcingScope,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { BasketSheet } from "@/screens/procurement/basket"
import { ItemDetail } from "@/screens/procurement/item-detail"
import { ItemFormSheet } from "@/screens/procurement/item-form"
import { Swatches } from "@/components/ui/swatch"
import { Thumbnail } from "@/components/ui/thumbnail"
import { sizeSpan, termLabel } from "@/screens/procurement/shared"
import type {
  CatalogueVocabulary,
  FacetCount,
  PurchaseHistory,
  SourcedItem,
  SourcingPage,
  Supplier,
} from "@itulah/contract"

/// Sourcing — "who sells this, and for how much".
///
/// A catalogue is browsed, not queried, so this is a grid with the filters
/// beside it rather than a table with chips above it. That is not decoration:
/// a buyer arrives without knowing what they want, and a table asks them to
/// read twelve rows of text before anything catches their eye.
///
/// One request answers the whole screen. `GET /api/v1/supplier-items` matches
/// an item's name or code or the supplier's name and returns the supplier
/// attached to each row, so the browser never stitches suppliers to items
/// itself: that would put the definition of "matches" somewhere nobody can see,
/// and cost one request per supplier.
///
/// The facets are counted by the server over everything the search matches, not
/// over the page and not over the current selection — choosing a division must
/// not make the other divisions read zero, because the facet list is how a
/// buyer sees what else is there.

export function Sourcing() {
  const client = useQueryClient()
  /// Whose shop is being browsed, or nobody's. In the URL so the back button
  /// leaves the shop rather than the app, and so a buyer can send a colleague
  /// "look at this supplier".
  const shop = useSheet("supplier")
  /// What was typed. Also in the URL: a filtered catalogue is a thing people
  /// send each other, and a `useState` box cannot be sent.
  const search = useSheet("q")
  const item = useSheet("item")
  const cart = useSheet("cart")
  /// Adding to the catalogue this screen browses. Here as well as on
  /// Catalogue, because this is where somebody is standing when they discover
  /// a supplier sells something we have never written down.
  const adding = useSheet("new-item")
  /// Relevance is the absence of a sort rather than a value, so the plain URL
  /// is the plain catalogue and there is one spelling of "no order chosen".
  const sort = useSheet("sort")

  const needle = (search.value ?? "").trim()

  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    // The words the catalogue may be described with change when somebody edits
    // the vocabulary table, which is roughly never.
    staleTime: 30 * 60 * 1000,
  })

  /// The facet counts come back keyed by supplier id, because that is what the
  /// scope takes. A buyer reads names, so the two have to be joined somewhere
  /// — here, once, rather than by asking the server to say both.
  const supplierList = useQuery({
    queryKey: procurementKeys.suppliers(),
    queryFn: ({ signal }) => listSuppliers(undefined, signal),
    staleTime: 5 * 60 * 1000,
  })
  const supplierNames = useMemo(
    () =>
      new Map(
        (supplierList.data ?? []).map((one) => [one.supplier_id, one.name])
      ),
    [supplierList.data]
  )

  /// The colour master, for the filter's labels.
  ///
  /// Read from `/api/v1/colours` rather than folded into the catalogue
  /// vocabulary, and the same way `master/articles` reads it: colour is an
  /// editable master with its own screen, and a second half-copy of it
  /// travelling on another endpoint is the exact split the master was created
  /// to prevent.
  ///
  /// The CARDS do not need this. Every item carries its own colours with their
  /// labels and hexes already on them, so a card draws its swatches from the
  /// row it was handed — this is only for the picker, which has to name
  /// colours no item on this page happens to be offered in.
  const colourMaster = useQuery({
    queryKey: colourKeys.list(),
    queryFn: ({ signal }) => listColours(signal),
    staleTime: 30 * 60 * 1000,
  })
  const colourTerms = useMemo(
    () =>
      new Map<string, ColourTerm>(
        (colourMaster.data?.colours ?? []).map((term) => [term.code, term])
      ),
    [colourMaster.data]
  )

  /// How each facet's codes are read out loud. Callbacks rather than inline
  /// arrows because the field list memoises on them.
  const divisionLabel = useCallback(
    (code: string) => termLabel(vocabulary.data?.divisions, code),
    [vocabulary.data]
  )
  const tagLabel = useCallback(
    (code: string) => termLabel(vocabulary.data?.tags, code),
    [vocabulary.data]
  )
  const supplierLabel = useCallback(
    (id: string) => supplierNames.get(id) ?? id,
    [supplierNames]
  )
  const colourLabel = useCallback(
    (code: string) => colourTerms.get(code)?.label ?? code,
    [colourTerms]
  )
  const sizeLabelOf = useCallback(
    (code: string) =>
      vocabulary.data?.sizes.find((term) => term.code === code)?.label ?? code,
    [vocabulary.data]
  )

  /// What this catalogue can be narrowed by.
  ///
  /// Declared without counts, and deliberately: the counts come from the
  /// response, the response comes from the scope, and the scope comes from the
  /// clauses — so a field list carrying counts could not be built before the
  /// request it shapes. The bar only needs a column's name, kind and operators
  /// to read a URL; the counted copy is assembled below, once there is an
  /// answer to count.
  ///
  /// Each operator list is cut to what `/api/v1/supplier-items` can actually
  /// answer. `includesAllOf` is absent because the tag clause is an `ANY`, and
  /// a chip reading "include all of" over an OR would be a chip that lies.
  const fields = useMemo<FilterField[]>(() => {
    const list: FilterField[] = [
      {
        column: "division",
        label: "Division",
        spec: {
          kind: "option",
          format: divisionLabel,
          single: true,
          // The label `sourcing_facets` files unclassified items under. It is
          // counted like a division and is not one, so the picker has to know
          // which row it is.
          emptyValue: "Unclassified",
          operators: ["isAnyOf", "isNoneOf", "isEmpty", "isNotEmpty"],
        },
      },
      {
        column: "tag",
        label: "Tag",
        spec: {
          kind: "multi",
          format: tagLabel,
          single: true,
          operators: ["includesAnyOf", "excludes", "isEmpty", "isNotEmpty"],
        },
      },
      // What it comes in, as two more facets. `multi` and not `option`,
      // because an item is offered in several colours at once and "is navy"
      // would be a chip that lies about a tee sold in five — the same reason
      // Tag is a multi and Division is not.
      //
      // No `includesAllOf` on either, for the same reason Tag has none: the
      // server ANDs nothing here, and a chip reading "include all of" over an
      // OR is a chip a buyer would trust and should not.
      {
        column: "colour",
        label: "Colour",
        spec: {
          kind: "multi",
          format: colourLabel,
          single: true,
          operators: ["includesAnyOf", "excludes", "isEmpty", "isNotEmpty"],
        },
      },
      {
        column: "size",
        label: "Size",
        spec: {
          kind: "multi",
          format: sizeLabelOf,
          single: true,
          operators: ["includesAnyOf", "excludes", "isEmpty", "isNotEmpty"],
        },
      },
      {
        column: "price",
        label: "Price",
        spec: {
          kind: "number",
          // No scale. The column is named `unit_price_minor` and holds whole
          // rupiah — `lib/format` says why: IDR has no minor unit in practice,
          // so the server's "minor" is already what a person types. Reading
          // the name instead of the data would multiply every bound by a
          // hundred and match nothing.
          unit: "Rp",
          // Not `single`: "at least 50.000" and "at most 90.000" are two
          // clauses that land on two different request parameters, so they
          // AND on the server exactly as the chips promise. A range is two
          // chips here rather than one "is between", which reads the same and
          // survives a single-line input.
          operators: ["gte", "lte"],
        },
      },
    ]
    // Filtering by supplier while standing in one supplier's shop is a control
    // that can only do nothing. Dropped from the list rather than disabled —
    // and a clause already in `?f=` is left in the address bar untouched, so
    // leaving the shop brings it back.
    if (!shop.value) {
      list.splice(4, 0, {
        column: "supplier",
        label: "Supplier",
        spec: {
          kind: "option",
          format: supplierLabel,
          single: true,
          operators: ["isAnyOf", "isNoneOf"],
        },
      })
    }
    return list
  }, [
    divisionLabel,
    tagLabel,
    colourLabel,
    sizeLabelOf,
    supplierLabel,
    shop.value,
  ])

  const filters = useFilterState(fields)

  const scope = useMemo<SourcingScope>(
    () => ({
      ...scopeFromFilters(filters.filters),
      sort: sort.value ?? "relevance",
      q: needle === "" ? undefined : needle,
      // Always what is actually on offer. A retired item cannot be ordered, so
      // a control that shows them is a control that can only mislead — every
      // extra row it adds is a row the buyer must not pick.
      status: "ACTIVE",
      // Standing in a shop IS a supplier filter, and it wins: expressed as the
      // same parameter rather than a second one, so the server answers one
      // question and the facet counts stay true.
      ...(shop.value ? { supplierIds: [shop.value] } : {}),
    }),
    [filters.filters, needle, shop.value, sort.value]
  )

  const catalogue = useInfiniteQuery({
    queryKey: procurementKeys.sourcing(scope),
    queryFn: ({ pageParam, signal }) =>
      searchSupplierItems({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

  // Append-only: the list grows as the buyer asks for more, and every row
  // fetched stays in the model. Nothing is sliced away to make it look fast.
  const rows = useMemo(
    () => catalogue.data?.pages.flatMap((page) => page.items) ?? [],
    [catalogue.data]
  )
  // From the first page. Every page reports the same totals, so taking the
  // first is what stops the counts flickering as more pages arrive.
  const facets = catalogue.data?.pages[0]?.facets
  /// How many items the SEARCH matches — not how many the filters do.
  ///
  /// The server computes this and the facets from the words and the status
  /// only, deliberately ignoring the division/tag/supplier selection, because
  /// a facet list that only described the current selection could not answer
  /// "what if I looked at menswear instead". So it is the size of the
  /// catalogue being browsed, and saying "120 of 2.810" with three filters on
  /// would claim a number nobody computed.
  const searchable = catalogue.data?.pages[0]?.total ?? 0
  /// What this supplier offers, which is a thing the facets DO know.
  const offering = shop.value
    ? (facets?.suppliers.find((one) => one.value === shop.value)?.count ?? 0)
    : 0

  /// The same fields, now carrying the server's counts.
  ///
  /// The number beside a value is the whole affordance of a facet: it is how
  /// somebody decides whether a filter is worth pressing before they press it.
  /// These are counted over everything the SEARCH matches rather than over the
  /// current selection, which is what stops ticking one division making the
  /// others read zero — a list that only describes what you have already
  /// chosen cannot answer "what if I looked at menswear instead".
  const counted = useMemo<FilterField[]>(() => {
    const source: Record<string, readonly FacetCount[] | undefined> = {
      division: facets?.divisions,
      tag: facets?.tags,
      colour: facets?.colours,
      size: facets?.sizes,
      supplier: facets?.suppliers,
    }
    return fields.map((field) => {
      const values = source[field.column]
      return values
        ? { ...field, spec: { ...field.spec, counted: values } }
        : field
    })
  }, [fields, facets])

  const basket = useQuery({
    queryKey: procurementKeys.basket(),
    queryFn: ({ signal }) => readBasket(signal),
  })
  const picked = (basket.data ?? []).reduce(
    (sum, line) => sum + line.quantity,
    0
  )
  /// How many of each item is already picked out, so a card can say so.
  ///
  /// Read off the basket the header is already holding rather than asked for
  /// per card: the count in the corner and the count on the card are then one
  /// number, and cannot disagree while a page of forty cards settles.
  const held = useMemo(
    () =>
      new Map(
        (basket.data ?? []).map((line) => [
          line.item.supplier_item_id,
          line.quantity,
        ])
      ),
    [basket.data]
  )

  const settleBasket = () =>
    client.invalidateQueries({ queryKey: procurementKeys.basket() })

  /// Picking up from the grid, one piece at a time.
  ///
  /// `POST` adds to whatever is already on the line, which is the only thing
  /// this screen does to a basket. Saying exactly how many is `PATCH`, and it
  /// belongs to the basket sheet: a grid is where things are taken, and a
  /// screen that also corrected quantities would be asking a buyer to do their
  /// arithmetic in the middle of the shop.
  const pick = useMutation({
    mutationFn: (id: string) =>
      addToBasket({ supplier_item_id: id, quantity: 1 }),
    onSuccess: settleBasket,
  })

  // The supplier whose shop this is, taken from a row rather than fetched: the
  // catalogue already carries the whole supplier on every item, and a second
  // request to learn a name we are already holding is a request for nothing.
  const standing: Supplier | undefined = shop.value
    ? rows.find((row) => row.supplier.supplier_id === shop.value)?.supplier
    : undefined

  const filtered = needle !== "" || filters.filters.length > 0

  return (
    <PageContent>
      {standing ? (
        <ShopHead
          supplier={standing}
          offering={offering}
          onBack={() => shop.close()}
        />
      ) : (
        <PageHeader
          title="Sourcing"
          sub="Every supplier's catalogue in one place. Open a supplier to see only what they sell."
        />
      )}

      {/* The order book's shape: what is on the glass at the left, what
          narrows it docked at the right where there is room for it. A catalogue
          is browsed rather than queried, so the panel matters MORE here than on
          a table — the facets are how a buyer discovers that the thing they
          are looking for is filed under a division they had not thought of.
          Below 1440 it is the same model, reachable from the omnibox. */}
      <div className="grid min-w-0 items-start gap-5 dock:grid-cols-[minmax(0,1fr)_16rem]">
        {/* `@container` on the column the cards are laid out in, not on the
            page: this column's width is whatever the sidebar and the panel
            leave it, and a `md:` breakpoint reading the VIEWPORT would put four
            cards in the space for three. */}
        <div className="@container flex min-w-0 flex-col">
          {/* One box for both questions. Searching and filtering were two
              controls in two corners — a pill across the top and a 212px rail
              down the left — and they are one thought: "kaus, kidswear, not
              from that supplier" is a single sentence a buyer says in one
              breath. The rail also spent permanent width on a control most
              buyers touch twice a day, and this screen's grid is sized by what
              is left over. */}
          {/* The phone: a plain search box and one button for filter, sort
              and views (`ListOptionsSheet`) — the other books' shape. The
              omnibox's menus are drawn for a pointer. From 48rem up it is the
              omnibox, as it always was. */}
          <div className="mb-3 flex items-center gap-1.5 md:hidden">
            <span className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-line-ico" />
              <input
                value={search.value ?? ""}
                onChange={(event) =>
                  event.target.value
                    ? search.open(event.target.value)
                    : search.close()
                }
                placeholder={
                  standing
                    ? `Search in ${standing.name}`
                    : "Search the catalogue"
                }
                aria-label="Search the catalogue"
                enterKeyHint="search"
                className="h-11 w-full rounded-inner border border-hairline-2 bg-canvas pr-3 pl-9 text-ink shadow-soft outline-none placeholder:text-body focus:border-accent"
              />
            </span>
            <ListOptionsSheet
              model={filters}
              filterModel={{ ...filters, fields: counted }}
              orders={{
                options: SORTS,
                value: sort.value ?? null,
                onChange: (next) =>
                  next === null ? sort.close() : sort.open(next),
              }}
              id="sourcing"
              all="Everything"
            />
          </div>
          <FilterOmnibox
            model={{ ...filters, fields: counted }}
            text={search.value ?? undefined}
            onText={(next) => (next ? search.open(next) : search.close())}
            placeholder={
              standing
                ? `Search in ${standing.name}`
                : "Search every supplier's catalogue, or filter"
            }
            className="mb-3 max-md:hidden"
          />

          {/* One line the width of the grid, carrying everything that acts on
              it — the same line the order book and the supplier book wear, and
              in the same order: what is on screen at the left, how it is
              ordered and saved in the middle, what creates and what collects at
              the right. */}
          <div className="mb-[1.125rem] flex flex-wrap items-center gap-1.5">
            <span className="mr-auto text-[0.875rem] text-body">
              <b className="font-medium text-ink">{count(rows.length)}</b>{" "}
              {filtered || standing
                ? catalogue.hasNextPage
                  ? "shown, more to load"
                  : rows.length === 1
                    ? "item matches"
                    : "items match"
                : `of ${count(searchable)} shown`}
            </span>
            {/* Four pills in a row became one menu, because the row was this
                screen's own invention: every other list in the module names
                its order from a menu with the same trigger, and four buttons
                sitting open said that choosing an order is four times as
                important here as it is next door. */}
            <div className="hidden md:contents">
              <ChoiceMenu
                heading="Sort by"
                value={sort.value ?? null}
                options={SORTS}
                onChange={(next) =>
                  next === null ? sort.close() : sort.open(next)
                }
              />
              <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
              <ViewPicker model={filters} id="sourcing" all="Everything" />
              <Button onClick={() => adding.open(true)}>
                <Plus />
                Add item
              </Button>
            </div>
            <Button
              variant={picked > 0 ? "primary" : "ghost"}
              onClick={() => cart.open(true)}
            >
              <ShoppingBasket />
              Basket
              {picked > 0 && ` · ${count(picked)}`}
            </Button>
          </div>
          <Fab label="Add item" onClick={() => adding.open(true)} />

          {queryState(catalogue, {
            loading: "Reading the catalogue…",
            render: () =>
              rows.length === 0 ? (
                <EmptyState>
                  {filtered || standing
                    ? "Nothing here matches. Widen the filters, or search everything."
                    : "No supplier has offered anything yet."}
                </EmptyState>
              ) : (
                <>
                  {/* Container queries, not viewport ones. This column's width
                      is whatever the module sidebar and the filter column leave
                      it — roughly 500px inside a 1280px window — so a `md:`
                      breakpoint reading the viewport puts three cards in a
                      space that fits two and truncates every name. */}
                  <div className="grid grid-cols-1 gap-[1.125rem] @sm:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-4">
                    {rows.map((row) => (
                      <ProductCard
                        key={row.item.supplier_item_id}
                        row={row}
                        vocabulary={vocabulary.data}
                        held={held.get(row.item.supplier_item_id) ?? 0}
                        // Only the card being changed goes quiet. A shared
                        // flag would grey out forty cards because one of them
                        // is in flight, and a buyer picking quickly would spend
                        // the whole page waiting on other people's rows.
                        busy={
                          pick.isPending &&
                          pick.variables === row.item.supplier_item_id
                        }
                        onOpen={() => item.open(row.item.supplier_item_id)}
                        onSupplier={() => shop.open(row.supplier.supplier_id)}
                        onAdd={() => pick.mutate(row.item.supplier_item_id)}
                      />
                    ))}
                  </div>

                  <LoadMore query={catalogue} className="mt-6" />
                </>
              ),
          })}
        </div>

        <DockedFilters
          model={{ ...filters, fields: counted }}
          kpis={catalogueKpis(searchable, facets)}
          id="sourcing"
          subject="Supplier item"
          className="hidden dock:flex"
        />
      </div>

      <ItemSheet
        id={item.value ?? null}
        vocabulary={vocabulary.data}
        bought={
          rows.find((row) => row.item.supplier_item_id === item.value)?.bought
        }
        onClose={item.close}
      />
      <ItemFormSheet open={adding.value === true} onClose={adding.close} />

      <BasketSheet
        open={cart.isOpen}
        onClose={cart.close}
        onReopen={() => cart.open(true)}
      />
    </PageContent>
  )
}

/// The four orders this catalogue can be read in.
///
/// `null` is relevance: the absence of a sort rather than a value, so the plain
/// URL is the plain catalogue and there is one spelling of "no order chosen".
const SORTS = [
  { value: null, label: "Best match" },
  { value: "newest", label: "Newest" },
  { value: "price_low", label: "Price low" },
  { value: "price_high", label: "Price high" },
]

/// Two figures about the catalogue being browsed, above the controls that
/// narrow it.
///
/// Both are the server's own, counted over everything the SEARCH matches and
/// deliberately not over the current selection — the same numbers the facet
/// lists are drawn from, so a tile and the rows under it cannot disagree.
function catalogueKpis(
  searchable: number,
  facets: SourcingPage["facets"] | undefined
) {
  if (facets === undefined) return undefined
  return [
    { label: "Items", value: count(searchable) },
    {
      label: "Suppliers",
      value: count(facets.suppliers.length),
      note: "Suppliers offering something the search matches.",
    },
  ]
}

/// One product, as a buyer sees it before they know they want it.
///
/// The supplier is a control, not a caption: "who else sells this" is the
/// question a catalogue exists to answer, and one click is the whole point.
function ProductCard({
  row,
  vocabulary,
  held,
  busy,
  onOpen,
  onSupplier,
  onAdd,
}: {
  row: SourcedItem
  vocabulary?: CatalogueVocabulary
  /// How many of this are already in the basket. Zero is the ordinary case.
  held: number
  busy: boolean
  onOpen: () => void
  onSupplier: () => void
  onAdd: () => void
}) {
  const { item, supplier } = row

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft transition duration-150 hover:-translate-y-0.5 hover:shadow-pop">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full text-left"
        aria-label={item.name}
      >
        {/* The same thumbnail the article grid draws, rather than a second
            hand-rolled `onError` beside it: a URL is not a photograph, most of
            this catalogue points at images that no longer resolve, and one
            component deciding what a missing one looks like is what keeps the
            two catalogues looking like one app. */}
        <Thumbnail
          url={item.image_url}
          fallback="No photograph"
          className="h-[9.875rem] w-full"
        >
          {/* The division rides on the photograph, the way a marketplace puts
              its category badge there: it is what the picture IS, so it belongs
              with the picture rather than in a list of facts under it. */}
          {item.division_code && (
            <span className="absolute top-2.5 left-2.5 inline-flex items-center rounded-full bg-canvas/95 px-2 py-[0.1875rem] text-[0.875rem] font-semibold text-ink shadow-[0_1px_3px_rgba(20,20,25,.1)] backdrop-blur-[5px]">
              {termLabel(vocabulary?.divisions, item.division_code)}
            </span>
          )}
          {/* How many are already in the basket, opposite the division and in
              the same shape — inverted, because this one is about what the
              buyer has done rather than about what the thing is. Absent at
              zero: a badge every card wears is a badge that says nothing. */}
          {held > 0 && (
            <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-full bg-ink/90 px-2 py-[0.1875rem] text-[0.875rem] font-semibold text-white tabular-nums backdrop-blur-[5px]">
              <ShoppingBasket className="size-2.5" />
              {count(held)}
            </span>
          )}
        </Thumbnail>
        <div className="px-[0.9375rem] pt-3 pb-1">
          <div className="truncate text-[0.875rem] font-medium text-ink">
            {item.name}
          </div>

          {/* What it comes in: the dots, then the size range beside them.
              Together they are one phrase — "navy or black, S to XXL" — and
              pushing the sizes to the far edge made a card read as two
              unrelated columns with a gap down the middle.

              The supplier's own item code used to sit above this. It is gone
              from the card: eleven digits nobody recognises, in mono, directly
              under the one line somebody actually reads. It is still on the
              sheet, under "Supplier code", which is where somebody goes when
              they need to type it into something else.

              Drawn only when there is something to say. Most of a scraped
              supplier feed has no variants recorded, and a row of em dashes on
              two thousand cards is a page-long apology for a gap. The item
              carries its own labels and hexes, so no lookup happens here. */}
          {(item.colours.length > 0 || item.size_codes.length > 0) && (
            <div className="mt-2 flex min-w-0 items-center gap-2">
              {item.colours.length > 0 && (
                <Swatches colours={item.colours} cap={5} />
              )}
              {item.size_codes.length > 0 && (
                <span className="min-w-0 truncate text-[0.875rem] text-body">
                  {sizeSpan(vocabulary?.sizes, item.size_codes)}
                </span>
              )}
            </div>
          )}

          <div className="mt-2 text-[1rem] font-semibold text-ink tabular-nums">
            {money(item.unit_price_minor)}
          </div>
        </div>
      </button>

      <div className="px-[0.9375rem] pt-1 pb-3">
        {/* The supplier gets its own line rather than a corner: at three
            columns a name and a tag on one row leaves the name a stub, and the
            name is the half a buyer clicks. */}
        <button
          type="button"
          onClick={onSupplier}
          className="flex w-full min-w-0 items-center gap-1.5 text-[0.875rem] text-body transition-colors hover:text-ink"
        >
          <Store className="size-3 shrink-0 text-line-ico" />
          <span className="truncate">{supplier.name}</span>
        </button>

        {/* What the item is filed under. Capped at three with a count for the
            rest: a card is a glance, and an item wearing nine tags would push
            every other card down the page to say something no buyer reads at
            this size. The full set is in the sheet. */}
        {item.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {item.tags.slice(0, 3).map((code) => (
              <Tag key={code}>{termLabel(vocabulary?.tags, code)}</Tag>
            ))}
            {item.tags.length > 3 && (
              <span className="text-[0.875rem] text-mute tabular-nums">
                +{count(item.tags.length - 3)}
              </span>
            )}
          </div>
        )}

        {/* Picking something out is one click from the grid.

            A buyer walking a catalogue picks a dozen things and reads none of
            them: making every pick pass through the detail sheet costs an open
            and a close per item, and the sheet is where you go to READ, not to
            buy. So the card carries the basket control and the rest of the card
            still opens the sheet — both, rather than a choice between them.

            One button, and it stays a button. A card that turned into a
            [− 50 +] stepper the moment something was picked up put what looked
            like a form field in the middle of a picture, on a card whose whole
            job is to be glanced at — and it did it to whichever cards happened
            to be in the basket, so a page of forty read as two different
            designs. How many were taken is now SAID, on the photograph, beside
            the other thing the photograph says; correcting the number is done
            in the basket, which is the screen that exists for exactly that and
            already has a field per line. */}
        <div className="mt-2.5 flex items-center gap-2">
          {/* What this business has already committed to, and the one number
              on the card that is about US rather than about the supplier —
              so it is the one thing wearing a colour. The marketplace
              equivalent is "10RB+ terjual", and the difference matters: we are
              the buyer here, so the number that helps is what WE bought, not
              what anybody sold.

              It was grey, beside the price, where it read as a footnote to the
              money. Level with the button instead: "we have bought this
              before" and "take another one" are the same thought, and putting
              them on one line is what lets a buyer act on it without moving
              their eyes. Hidden at zero rather than shown as "0 bought" — a
              first order is not a warning. */}
          {row.bought !== undefined && row.bought.units > 0 && (
            <span className="min-w-0 flex-1 truncate rounded-full bg-info-bg px-2 py-[0.1875rem] text-center text-[0.875rem] font-medium text-info-fg tabular-nums">
              {count(row.bought.units)} bought
            </span>
          )}
          {/* A third of the width, not all of it. A full-width button is what
              a card ends with when the card has nothing else to say, and this
              one does — it made "Add" the loudest thing in a grid whose job is
              to be browsed, and it left the history above it nowhere to sit. */}
          <Button
            size="sm"
            variant={held > 0 ? "soft" : undefined}
            className="ml-auto w-1/3 shrink-0"
            disabled={busy}
            onClick={onAdd}
            aria-label={
              held === 0
                ? `Put ${item.name} in the basket`
                : `One more ${item.name}`
            }
          >
            <ShoppingBasket />
            Add
          </Button>
        </div>
      </div>
    </div>
  )
}

/// The supplier, in as much detail as we actually hold.
///
/// Deliberately small and deliberately short: this system knows a supplier's
/// code, who to ring and where they are, and nothing about ratings, response
/// times or how long they have been trading. Inventing those would make the
/// page look like a marketplace and lie while doing it.
function ShopHead({
  supplier,
  offering,
  onBack,
}: {
  supplier: Supplier
  offering: number
  onBack: () => void
}) {
  const facts = [
    ["Code", supplier.supplier_code],
    ["On offer", `${count(offering)} items`],
    ["Contact", supplier.contact_name],
    ["Phone", supplier.phone],
    ["Email", supplier.email],
    ["Address", supplier.address],
  ] as const

  return (
    <div className="mb-[1.125rem]">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1.5 text-[0.875rem] font-medium text-body transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        All suppliers
      </button>

      <div className="rounded-card border border-hairline bg-canvas p-[1.125rem] shadow-soft">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-inner bg-soft-2 text-ink">
            <Store className="size-5 stroke-[1.6]" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[1.125rem] font-semibold text-ink">
              {supplier.name}
            </h1>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="font-mono text-id text-body">
                {supplier.supplier_code}
              </span>
              <Pill tone={supplier.status === "ACTIVE" ? "ok" : "neutral"}>
                {supplier.status === "ACTIVE" ? "Active" : "Cancelled"}
              </Pill>
            </div>
          </div>
        </div>

        <dl className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-hairline pt-3.5 md:grid-cols-3">
          {facts.map(([term, value]) => (
            <div key={term} className="min-w-0">
              <dt className="text-[0.875rem] font-semibold tracking-[0.04em] text-mute uppercase">
                {term}
              </dt>
              <dd className="mt-0.5 truncate text-[0.875rem] text-ink">
                {value === null || value === "" ? "—" : value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

function ItemSheet({
  id,
  vocabulary,
  bought,
  onClose,
}: {
  id: string | null
  vocabulary?: CatalogueVocabulary
  bought?: PurchaseHistory
  onClose: () => void
}) {
  const client = useQueryClient()
  const [quantity, setQuantity] = useState("1")

  const detail = useQuery({
    queryKey: procurementKeys.supplierItem(id ?? ""),
    queryFn: ({ signal }) => supplierItemDetail(id!, signal),
    enabled: id !== null,
  })

  const pick = useMutation({
    mutationFn: (request: { supplier_item_id: string; quantity: number }) =>
      addToBasket(request),
    // Only the basket changes. The catalogue row is untouched by picking
    // something up, so nothing else is dropped.
    onSuccess: () =>
      client.invalidateQueries({ queryKey: procurementKeys.basket() }),
  })

  const pieces = Number.parseInt(quantity, 10)
  const valid = Number.isFinite(pieces) && pieces > 0

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "supplier_item", id }}
      onOpenChange={(open) => !open && onClose()}
      id={detail.data?.supplier_item_code}
      title={detail.data?.name ?? "Item"}
      footer={
        detail.data && (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="h-8 w-20"
              aria-label="Pieces"
            />
            <Button
              variant="primary"
              className="flex-1"
              pending={pick.isPending}
              disabled={!valid}
              onClick={() =>
                pick.mutate({
                  supplier_item_id: detail.data!.supplier_item_id,
                  quantity: pieces,
                })
              }
            >
              {pick.isPending ? "Adding…" : "Add to basket"}
            </Button>
          </div>
        )
      }
    >
      {queryState(detail, {
        loading: "Loading the item…",
        render: (item) => (
          <div className="flex flex-col gap-4">
            {pick.isError && (
              <Banner tone="bad">{(pick.error as Error).message}</Banner>
            )}
            <ItemDetail item={item} vocabulary={vocabulary} bought={bought} />
          </div>
        ),
      })}
    </Sheet>
  )
}
