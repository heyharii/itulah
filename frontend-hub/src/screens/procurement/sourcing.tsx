import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  ArrowLeft,
  Check,
  Globe,
  Search,
  ShoppingBasket,
  Store,
} from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, money } from "@/lib/format"
import {
  addToBasket,
  catalogueVocabulary,
  listSuppliers,
  procurementKeys,
  readBasket,
  searchSupplierItems,
  supplierItemDetail,
  type SourcingScope,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import { BasketSheet } from "@/screens/procurement/basket"
import { ItemDetail } from "@/screens/procurement/item-detail"
import { termLabel, toggle } from "@/screens/procurement/shared"
import type {
  CatalogueVocabulary,
  SourcedItem,
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
  /// Whose shop is being browsed, or nobody's. In the URL so the back button
  /// leaves the shop rather than the app, and so a buyer can send a colleague
  /// "look at this supplier".
  const shop = useSheet("supplier")
  /// What was typed. Also in the URL: a filtered catalogue is a thing people
  /// send each other, and a `useState` box cannot be sent.
  const search = useSheet("q")
  const item = useSheet("item")
  const cart = useSheet("cart")

  const [onlyActive, setOnlyActive] = useState<"ACTIVE" | "ALL">("ACTIVE")
  const [divisions, setDivisions] = useState<readonly string[]>([])
  const [tags, setTags] = useState<readonly string[]>([])
  const [suppliers, setSuppliers] = useState<readonly string[]>([])

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

  const scope = useMemo<SourcingScope>(
    () => ({
      q: needle === "" ? undefined : needle,
      status: onlyActive === "ACTIVE" ? "ACTIVE" : undefined,
      divisionCodes: divisions.length === 0 ? undefined : divisions,
      tagCodes: tags.length === 0 ? undefined : tags,
      // Standing in a shop IS a supplier filter. Expressed as the same
      // parameter rather than a second one, so the server answers one question
      // and the facet counts stay true.
      supplierIds: shop.value
        ? [shop.value]
        : suppliers.length === 0
          ? undefined
          : suppliers,
    }),
    [needle, onlyActive, divisions, tags, suppliers, shop.value]
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

  const basket = useQuery({
    queryKey: procurementKeys.basket(),
    queryFn: ({ signal }) => readBasket(signal),
  })
  const picked = (basket.data ?? []).reduce(
    (sum, line) => sum + line.quantity,
    0
  )

  // The supplier whose shop this is, taken from a row rather than fetched: the
  // catalogue already carries the whole supplier on every item, and a second
  // request to learn a name we are already holding is a request for nothing.
  const standing: Supplier | undefined = shop.value
    ? rows.find((row) => row.supplier.supplier_id === shop.value)?.supplier
    : undefined

  const filtered =
    needle !== "" ||
    divisions.length > 0 ||
    tags.length > 0 ||
    suppliers.length > 0

  return (
    <div className="flex h-full min-h-0">
      {/* The filter column — 212 declared, the width DESIGN.md gives the
          catalogue's third column. It carries the search too: scoping and
          filtering are one question, and splitting them across two corners of
          the screen makes a buyer hunt for half of it. */}
      <aside className="flex w-[13.25rem] shrink-0 flex-col overflow-y-auto border-r border-hairline px-4 py-[1.125rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-line-ico" />
          <Input
            value={search.value ?? ""}
            onChange={(event) =>
              event.target.value === ""
                ? search.close()
                : search.open(event.target.value)
            }
            placeholder={standing ? `In ${standing.name}` : "Search everything"}
            className="h-9 pl-9"
            aria-label="Search the catalogue"
          />
        </div>

        {/* The scope, said out loud. A box that quietly searches one shop is
            worse than one that searches everything: the missing results look
            like missing stock. */}
        {standing && (
          <button
            type="button"
            onClick={() => shop.close()}
            className="mt-2 inline-flex items-center gap-1.5 self-start rounded-full bg-accent-bg px-2.5 py-1 text-[0.6875rem] font-medium text-info-fg transition-colors hover:brightness-97"
          >
            <Globe className="size-3" />
            Search everything instead
          </button>
        )}

        <div className="mt-4 flex items-center justify-between">
          <b className="text-[0.9375rem] font-semibold text-ink">Filters</b>
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setDivisions([])
                setTags([])
                setSuppliers([])
                search.close()
              }}
              className="text-[0.75rem] font-medium text-body transition-colors hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>

        <FacetGroup label="Offered">
          <Segmented
            className="w-full"
            options={[
              { value: "ACTIVE", label: "On offer" },
              { value: "ALL", label: "Everything" },
            ]}
            value={onlyActive}
            onChange={setOnlyActive}
          />
        </FacetGroup>

        <FacetGroup label="Division">
          {(facets?.divisions ?? []).map((facet) => (
            <FacetItem
              key={facet.value}
              label={termLabel(vocabulary.data?.divisions, facet.value)}
              count={facet.count}
              on={divisions.includes(facet.value)}
              onToggle={() => setDivisions(toggle(divisions, facet.value))}
            />
          ))}
        </FacetGroup>

        <FacetGroup label="Tag">
          <div className="flex flex-wrap gap-1.5">
            {(facets?.tags ?? []).map((facet) => (
              <button
                key={facet.value}
                type="button"
                onClick={() => setTags(toggle(tags, facet.value))}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[0.75rem] transition-colors",
                  tags.includes(facet.value)
                    ? "border-ink bg-ink text-white"
                    : "border-hairline-2 text-text hover:bg-soft-2"
                )}
              >
                {termLabel(vocabulary.data?.tags, facet.value)}{" "}
                <span className="text-mute">{facet.count}</span>
              </button>
            ))}
          </div>
        </FacetGroup>

        {/* Hidden inside a shop: filtering by supplier when you are standing in
            one supplier's shop is a control that can only do nothing. */}
        {!standing && (
          <FacetGroup label="Supplier">
            {(facets?.suppliers ?? []).map((facet) => (
              <FacetItem
                key={facet.value}
                label={supplierNames.get(facet.value) ?? facet.value}
                count={facet.count}
                on={suppliers.includes(facet.value)}
                onToggle={() => setSuppliers(toggle(suppliers, facet.value))}
              />
            ))}
          </FacetGroup>
        )}
      </aside>

      <div className="@container min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[77.5rem] px-[1.875rem] pt-6 pb-14">
          {standing ? (
            <ShopHead
              supplier={standing}
              offering={offering}
              onBack={() => shop.close()}
            />
          ) : (
            <div className="mb-4">
              <div className="mb-[0.3125rem] text-[0.75rem] font-medium text-mute">
                Procurement
              </div>
              <h1 className="text-hero font-semibold text-ink">Sourcing</h1>
              <p className="mt-[0.1875rem] text-[0.8125rem] text-body">
                Every supplier's catalogue in one place. Open a supplier to see
                only what they sell.
              </p>
            </div>
          )}

          <div className="mb-[1.125rem] flex items-center justify-between gap-3">
            <span className="text-[0.84375rem] text-body">
              <b className="font-medium text-ink">{count(rows.length)}</b>{" "}
              {filtered || standing
                ? catalogue.hasNextPage
                  ? "shown, more to load"
                  : rows.length === 1
                    ? "item matches"
                    : "items match"
                : `of ${count(searchable)} shown`}
            </span>
            <Button
              variant={picked > 0 ? "dark" : "ghost"}
              onClick={() => cart.open(true)}
            >
              <ShoppingBasket />
              Basket
              {picked > 0 && ` · ${count(picked)}`}
            </Button>
          </div>

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
                        onOpen={() => item.open(row.item.supplier_item_id)}
                        onSupplier={() => shop.open(row.supplier.supplier_id)}
                      />
                    ))}
                  </div>

                  {catalogue.hasNextPage && (
                    <div className="mt-6 flex justify-center">
                      <Button
                        onClick={() => catalogue.fetchNextPage()}
                        disabled={catalogue.isFetchingNextPage}
                      >
                        {catalogue.isFetchingNextPage
                          ? "Fetching…"
                          : "Show more"}
                      </Button>
                    </div>
                  )}
                </>
              ),
          })}
        </div>
      </div>

      <ItemSheet
        id={item.value ?? null}
        vocabulary={vocabulary.data}
        onClose={item.close}
      />
      <BasketSheet open={cart.isOpen} onClose={cart.close} />
    </div>
  )
}

/// One product, as a buyer sees it before they know they want it.
///
/// The supplier is a control, not a caption: "who else sells this" is the
/// question a catalogue exists to answer, and one click is the whole point.
function ProductCard({
  row,
  vocabulary,
  onOpen,
  onSupplier,
}: {
  row: SourcedItem
  vocabulary?: CatalogueVocabulary
  onOpen: () => void
  onSupplier: () => void
}) {
  const { item, supplier } = row
  // A URL is not a photograph. Most of this catalogue points at images that no
  // longer resolve, and a broken-image glyph reads as a defect in the app
  // rather than a gap in the data — so a failed load falls back to the same
  // sentence a missing URL gets.
  const [broken, setBroken] = useState(false)
  const shown = item.image_url !== null && !broken

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft transition duration-150 hover:-translate-y-0.5 hover:shadow-pop">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full text-left"
        aria-label={item.name}
      >
        <div className="relative h-[9.875rem] overflow-hidden bg-soft-2">
          {shown ? (
            <img
              src={item.image_url!}
              alt=""
              loading="lazy"
              onError={() => setBroken(true)}
              className="size-full object-cover object-[center_15%]"
            />
          ) : (
            <span className="grid size-full place-items-center text-[0.71875rem] text-mute">
              No photograph
            </span>
          )}
          {item.status !== "ACTIVE" && (
            <span className="absolute top-2.5 left-2.5">
              <Pill tone="neutral">Retired</Pill>
            </span>
          )}
        </div>
        <div className="px-[0.9375rem] pt-3 pb-1">
          <div className="truncate text-[0.875rem] font-medium text-ink">
            {item.name}
          </div>
          <div className="mt-[0.1875rem] truncate font-mono text-[0.6875rem] text-mute">
            {item.supplier_item_code}
          </div>
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
          className="flex w-full min-w-0 items-center gap-1.5 text-[0.71875rem] text-body transition-colors hover:text-ink"
        >
          <Store className="size-3 shrink-0 text-line-ico" />
          <span className="truncate">{supplier.name}</span>
        </button>
        {item.division_code && (
          <Tag className="mt-1.5">
            {termLabel(vocabulary?.divisions, item.division_code)}
          </Tag>
        )}
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
        className="mb-3 inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-body transition-colors hover:text-ink"
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
                {supplier.status === "ACTIVE" ? "Active" : "Retired"}
              </Pill>
            </div>
          </div>
        </div>

        <dl className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-hairline pt-3.5 md:grid-cols-3">
          {facts.map(([term, value]) => (
            <div key={term} className="min-w-0">
              <dt className="text-[0.625rem] font-semibold tracking-[0.04em] text-mute uppercase">
                {term}
              </dt>
              <dd className="mt-0.5 truncate text-[0.78125rem] text-ink">
                {value === null || value === "" ? "—" : value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

function FacetGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="border-t border-hairline py-4 first-of-type:border-t-0">
      <div className="mb-2.5 text-[0.6875rem] font-semibold tracking-[0.04em] text-mute uppercase">
        {label}
      </div>
      {children}
    </div>
  )
}

/// A checkbox with its count, which is the whole affordance: the number is how
/// a buyer decides whether a filter is worth pressing.
function FacetItem({
  label,
  count: howMany,
  on,
  onToggle,
}: {
  label: string
  count: number
  on: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className="flex w-full items-center gap-2.5 py-[0.3125rem] text-left text-[0.84375rem] text-text transition-colors hover:text-ink"
    >
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-[5px] border-[1.5px] transition-colors",
          on ? "border-ink bg-ink" : "border-hairline-strong"
        )}
      >
        {on && <Check className="size-2.5 text-white" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[0.75rem] text-mute tabular-nums">
        {count(howMany)}
      </span>
    </button>
  )
}

function ItemSheet({
  id,
  vocabulary,
  onClose,
}: {
  id: string | null
  vocabulary?: CatalogueVocabulary
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
              variant="dark"
              className="flex-1"
              disabled={!valid || pick.isPending}
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
            {pick.isSuccess && (
              <Banner tone="ok">
                {count(pick.data.quantity)} in the basket.
              </Banner>
            )}
            <ItemDetail item={item} vocabulary={vocabulary} />
          </div>
        ),
      })}
    </Sheet>
  )
}
