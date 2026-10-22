import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Money } from "@/components/ui/field"
import { Section } from "@/components/ui/form"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { count, money, sku } from "@/lib/format"
import {
  commercialKeys,
  commercialProducts,
  commercialProductsByArticles,
  minorOf,
  type CommercialChannel,
  type CommercialProduct,
} from "@/lib/queries/commercial"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import { Named, Quiet } from "@/screens/commercial/parts"
import type { PendingPrice } from "@/screens/commercial/pricelist-editor"

/// Pushing a new price to the fleet.
///
/// **There is no "change a price" in this system, and this sheet is what that
/// looks like when it is said out loud.** A price book is a list of changes;
/// the engine ranks by publication version before it ranks by scope
/// (`price.rs` `better`), so the newest book naming a product simply wins and
/// the figure underneath stops being reached. Nothing retires it, nothing
/// edits it, and there is no row anywhere to open and correct. So the verb
/// here is *push*, the record is always new, and the old price stays in the
/// book that carried it — which is what makes "what did this cost in July"
/// answerable at all.
///
/// **Why it is per product rather than per style.** `commercial_price_rule` is
/// keyed by `sku_id`, so a style priced 219.000 in eight sizes is eight rows.
/// The grid cannot supply those ids — `article-prices` answers in styles and
/// carries only `sku_codes` — so the products are resolved here through
/// `GET /api/v1/commercial/products`, which searches by SKU code, article code
/// or name and answers with the id AND the company price each one currently
/// carries. Authoring against a list that shows what a thing costs now is the
/// whole guard against this domain's commonest expensive mistake: restating a
/// price that had not changed.
///
/// **The three levels are the engine's, not an invention.** `PriceLevel` is
/// `Company` (0), `SiteGroup` (1), `Site` (2) and higher wins — but only after
/// the version has had its say. That ordering is why a fresh company-wide book
/// supersedes last season's shop price rather than losing to it, and it is
/// worth knowing before pushing one.
///
/// **What this sheet deliberately does not offer**, each with the reason,
/// because a control that silently does nothing is worse than a control that
/// is not there:
///
///  - **Dates.** `commercial_price_rule` has no `effective_from` of its own;
///    `load_site_price_book` reads the *publication's* window for every price
///    in it. So when a price starts is one decision for the whole book, and it
///    is taken at Publish. A markdown is the opposite — it carries its own
///    dates, and its own hours — which is why a limited-time cut is a sale
///    price and not this.
///  - **Online and marketplace.** Publishing a book that introduces a channel
///    makes the server demand a company-wide price for *every* active SKU in
///    it. Pricing a handful online would therefore write a book, take the next
///    version number, and then refuse to publish. The company does not trade
///    either way, so the channel is a constant here rather than a Select with
///    two dead options in it.
///  - **A tax class and rate.** The server insists a book that sets prices
///    carries a tax rule, so one is sent — `STANDARD` at nothing per cent,
///    which is what an article setup files its first price under. It is not
///    asked for: the fleet has one class at one rate, and the right home for a
///    tax class is the article anyway, beside division and tags.
///  - **"May be sold".** The permission travels with the price because the
///    server refuses one without the other, and it is always granted. Pricing
///    something a till will not sell is a withdrawal, and belongs where a
///    style is withdrawn rather than on the sheet that prices it.

/// One shop the grid knows about — the STORE origins, as `article-prices`
/// returns them.
export interface PriceShop {
  readonly site_id: string
  readonly label: string | null
}

/// What the grid hands over when the composer is opened from a selection.
///
/// Codes and shop ids rather than products, because a cell knows a style and
/// this sheet is the thing that turns a style into rows.
export interface PriceSeed {
  readonly articleCodes: readonly string[]
  readonly siteIds: readonly string[]
  /// A figure already typed in the sale sheet, carried over rather than asked
  /// for twice.
  readonly priceMinor: number | null
}

/// Which shops a price names. The engine's three levels, in its own order.
type Scope = "FLEET" | "ONE" | "SOME"

/// The level, read off the shops that are lit rather than chosen twice.
///
/// This used to be a segmented control — Every shop / One shop / Some shops —
/// sitting above a combobox, so naming two shops meant a click to say "some"
/// and then a search field to say which. Two controls for one thought, and the
/// first of them asking about the engine's vocabulary rather than the user's.
/// The tiles below say the same thing by being pressed: nothing lit is the
/// company price, one is that shop's own, several is a group.
///
/// The rung a group of one would sit on is the one shape this cannot express,
/// and deliberately: it is legal at the server but there is no reason to want
/// it — a shop price beats it inside the same book and is otherwise identical.
function scopeOf(siteIds: readonly string[]): Scope {
  return siteIds.length === 0 ? "FLEET" : siteIds.length === 1 ? "ONE" : "SOME"
}

/// Rupiah, and the only currency the fleet trades in. Declared rather than
/// asked for: `CurrencyCode` validates it at the server and a second currency
/// is a business decision, not a field on a form.
const CURRENCY = "IDR"

/// The tax class a price is filed under.
///
/// `STANDARD` at nothing per cent is exactly what `publish_setup_prices` writes
/// for a newly set-up article (`SETUP_TAX_CATEGORY`), so a price pushed here
/// lands in the same class as the price it supersedes. The right home for a tax
/// class is the article, beside division and tags — it is a property of the
/// goods, not of a price — and until it lives there this is the constant the
/// rest of the system already assumes.
const TAX_CATEGORY = "STANDARD"

/// The only channel there is. It was a Select — In the shops / Online /
/// Marketplace — with the last two disabled and a paragraph explaining why,
/// which is three lines of screen spent telling somebody about two ways of
/// trading the company does not do.
const CHANNEL: CommercialChannel = "STORE"

/// A price and the permission to sell are one thing here. The server refuses a
/// book carrying one without the other, so the flag has to be sent; it was a
/// switch on this sheet, offering to price something a till would then refuse
/// to put in a basket. That is a withdrawal, and withdrawing a style is not
/// what somebody opening "New price" came to do.
const SELLABLE = true

/// One row the book will carry: a level, a figure, and when it starts.
///
/// The composer used to have exactly one of these implied by a segmented
/// control, which is why one price for the whole batch was the only thing it
/// could say. Shops charge different money and change on different days, and
/// both of those are ordinary rather than exceptional.
interface Target {
  readonly siteId: string | null
  readonly siteIds: readonly string[] | null
  /// How the level reads out loud — "Every shop", "Toko Bandung", "3 shops".
  readonly where: string
  /// The shop's own figure as typed, or `""` to take the figures at the top of
  /// the sheet — which is the per-product ones, falling back to the batch one.
  readonly price: string
  /// `datetime-local` text, or `null` for "when the book starts".
  readonly from: string | null
}

/// One shop in "Where it applies", pressed rather than searched for.
function ShopTile({
  on,
  label,
  note,
  onClick,
  className,
}: {
  on: boolean
  label: string
  /// The site id, when the shop has a name that is not it — on hover, since
  /// two shops in one city can read almost identically by name alone.
  note?: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={note}
      className={cn(
        "flex min-w-0 flex-col items-start gap-0.5 rounded-inner border px-4 py-3.5 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        on
          ? "border-accent bg-accent-bg"
          : "border-hairline-2 bg-canvas hover:border-hairline-strong hover:bg-soft-2",
        className
      )}
    >
      <span
        className={cn(
          "w-full truncate text-[0.9375rem] font-medium",
          on ? "text-accent" : "text-ink"
        )}
      >
        {label}
      </span>
    </button>
  )
}

/// How many matches the product search asks for. Said on screen when hit.
const PRODUCT_CAP = 100

/// "Khaki · 02", or nothing when a product carries neither.
function variantOf(product: CommercialProduct): string {
  return [product.color, product.size].filter((one) => one !== null).join(" · ")
}

export function NewPriceSheet({
  open,
  seed,
  shops,
  onAdd,
  onClose,
}: {
  open: boolean
  seed: PriceSeed | null
  shops: readonly PriceShop[]
  /// Hand the authored rows to the bar above the grid. They do not reach a
  /// till from here: publishing is one act for the whole book, and a sheet
  /// that published on its own would take a version number per price.
  onAdd: (prices: readonly PendingPrice[]) => void
  onClose: () => void
}) {
  // ── which products ───────────────────────────────────────────────────────
  const [search, setSearch] = useState("")
  const typed = useDebounced(search, 250)
  const needle = typed.trim()

  const results = useQuery({
    // The limit is part of the key because it is part of the ANSWER — the
    // key's own comment says so: two searches for the same words at different
    // limits are different answers, and sharing one entry hands the narrower
    // one a list it thinks is complete. This screen asks for 100 here and 500
    // below, so they were colliding on a key that named neither.
    queryKey: commercialKeys.products(needle, PRODUCT_CAP),
    queryFn: ({ signal }) => commercialProducts(needle, PRODUCT_CAP, signal),
    // Two characters, because one is every product in the catalogue and the
    // endpoint caps rather than refuses — a silent slice of five hundred is
    // worse than being asked for another letter.
    enabled: open && needle.length >= 2,
  })

  /// The styles the grid pointed at, expanded into their products.
  ///
  /// One read for all of them, matched on whole article codes by the server.
  /// It used to be a substring search per style, which was a request per
  /// style and a prefix dragging its neighbour in. The narrowing below stays
  /// as a guard: it costs nothing, and a node that has not learned
  /// `article_codes` would otherwise hand back the first five hundred products.
  const seeds = useMemo(() => seed?.articleCodes ?? [], [seed])
  const seededRead = useQuery({
    queryKey: commercialKeys.productsByArticles(seeds, 500),
    queryFn: ({ signal }) => commercialProductsByArticles(seeds, 500, signal),
    enabled: open && seeds.length > 0,
  })
  const seeded = {
    loading: seededRead.isPending,
    failed: seededRead.isError,
  }
  const fromSeed = useMemo(() => {
    const wanted = new Set(seeds)
    return (seededRead.data ?? []).filter((one) => wanted.has(one.article_code))
  }, [seededRead.data, seeds])

  /// Picked by hand, and dropped by hand.
  ///
  /// Two lists rather than one mutable set seeded by an effect: what the grid
  /// sent arrives as *data*, and deriving the chosen list from it means a
  /// seeded row can be removed like any other without a `useEffect` racing the
  /// query that supplied it.
  const [added, setAdded] = useState<readonly CommercialProduct[]>([])
  const [dropped, setDropped] = useState<ReadonlySet<string>>(() => new Set())

  const chosen = useMemo(() => {
    const byId = new Map<string, CommercialProduct>()
    for (const product of [...fromSeed, ...added]) {
      if (!dropped.has(product.sku_id)) byId.set(product.sku_id, product)
    }
    return [...byId.values()].sort((left, right) =>
      left.article_code === right.article_code
        ? left.sku_code.localeCompare(right.sku_code)
        : left.article_code.localeCompare(right.article_code)
    )
  }, [fromSeed, added, dropped])

  const pick = (product: CommercialProduct) => {
    setDropped((was) => {
      if (!was.has(product.sku_id)) return was
      const next = new Set(was)
      next.delete(product.sku_id)
      return next
    })
    setAdded((was) =>
      was.some((one) => one.sku_id === product.sku_id) ? was : [...was, product]
    )
  }
  const drop = (skuId: string) => {
    setAdded((was) => was.filter((one) => one.sku_id !== skuId))
    setDropped((was) => new Set(was).add(skuId))
  }

  // ── what it costs ────────────────────────────────────────────────────────
  //
  // One figure for everything chosen, and any product may be given its own.
  // A style priced per size is normal here — the spread is the reason a base
  // price is authored per product at all — so the override is a field on the
  // row rather than a mode to switch into.
  const [bulk, setBulk] = useState(() =>
    seed?.priceMinor != null ? String(seed.priceMinor) : ""
  )
  const [own, setOwn] = useState<Record<string, string>>({})
  const priceText = (skuId: string) => own[skuId] ?? bulk
  const priceOf = (skuId: string) => minorOf(priceText(skuId))

  // ── where it applies ─────────────────────────────────────────────────────
  const [siteIds, setSiteIds] = useState<readonly string[]>(
    () => seed?.siteIds ?? []
  )
  /// A shop's own figure and its own start, when it does not take the batch's.
  ///
  /// Kept while the tile is dark rather than cleared with it: unlighting a shop
  /// by mistake is one click, and throwing away the two things somebody typed
  /// for it is not a thing a click should do.
  const [shopPrice, setShopPrice] = useState<Record<string, string>>({})
  const [shopFrom, setShopFrom] = useState<Record<string, string>>({})

  const labelOf = (id: string) =>
    shops.find((shop) => shop.site_id === id)?.label ?? id

  const scope = scopeOf(siteIds)

  const toggleShop = (id: string) =>
    setSiteIds((was) =>
      was.includes(id) ? was.filter((one) => one !== id) : [...was, id]
    )

  /// The rows the tiles come to: one per level the book will actually carry.
  ///
  /// Shops that agree on both figure and start date are ONE price naming
  /// several shops, which is what the group level is for and what keeps a
  /// branch opened next month on the same price. Disagree on either and they
  /// get a row each.
  const targets = useMemo<readonly Target[]>(() => {
    if (siteIds.length === 0) {
      return [
        {
          siteId: null,
          siteIds: null,
          where: "Every store",
          price: "",
          from: null,
        },
      ]
    }

    const by = new Map<
      string,
      { shops: string[]; price: string; from: string | null }
    >()
    for (const id of siteIds) {
      const price = (shopPrice[id] ?? "").trim()
      const from = (shopFrom[id] ?? "").trim()
      const at = `${price}|${from}`
      const found = by.get(at)
      if (found !== undefined) found.shops.push(id)
      else by.set(at, { shops: [id], price, from: from === "" ? null : from })
    }
    const batches = [...by.values()]

    // At most one group row per book, and this is the constraint's own doing:
    // `commercial_price_scope_unique` keys on `COALESCE(site_id,'*')`, so every
    // level that stores a null site — the company price and every group — is
    // one slot per product per book. Two groups in one book would be refused
    // after the book had been written. The biggest set keeps the level; the
    // rest are written a shop at a time, which prices the same shops the same
    // way and only gives up the "a shop added later joins this" property.
    const holds = new Map<string, number>()
    batches.forEach((batch, index) => {
      const book = batch.from ?? ""
      const held = holds.get(book)
      if (held === undefined || batch.shops.length > batches[held].shops.length)
        holds.set(book, index)
    })

    return batches.flatMap<Target>((batch, index) =>
      batch.shops.length > 1 && holds.get(batch.from ?? "") === index
        ? [
            {
              siteId: null,
              siteIds: batch.shops,
              where: `${count(batch.shops.length)} stores`,
              price: batch.price,
              from: batch.from,
            },
          ]
        : batch.shops.map((id) => ({
            siteId: id,
            siteIds: null,
            where: shops.find((shop) => shop.site_id === id)?.label ?? id,
            price: batch.price,
            from: batch.from,
          }))
    )
  }, [siteIds, shopPrice, shopFrom, shops])

  /// The books this batch will be published as — one per distinct start date.
  const books = [...new Set(targets.map((one) => one.from ?? ""))]

  /// What a product costs at a target: the shop's own figure when it has one,
  /// and otherwise whatever the figures at the top of the sheet say.
  const priceIn = (target: Target, skuId: string) =>
    target.price !== "" ? minorOf(target.price) : priceOf(skuId)

  const where =
    targets.length === 1 ? targets[0].where : `${count(siteIds.length)} stores`

  const unpriced = chosen.filter((one) =>
    targets.some((target) => priceIn(target, one.sku_id) === null)
  )

  /// No scope can be wrong any more: nothing lit is the company price, which
  /// is a complete answer rather than an unfinished one.
  const ready = chosen.length > 0 && unpriced.length === 0

  const commit = () => {
    if (!ready) return
    onAdd(
      targets.flatMap((target) =>
        chosen.map((product) => ({
          kind: "price" as const,
          // `COALESCE(site_id,'*')` is what the server's unique index keys on,
          // so this is the same identity — a group price and a fleet price for
          // one product are one row's worth of book, and the later one wins
          // here instead of being refused there. The start date joins it
          // because two dates are two books, which the index cannot see.
          key: `${product.sku_id}|${target.siteId ?? "*"}|${CHANNEL}|${target.from ?? "book"}`,
          skuId: product.sku_id,
          skuCode: product.sku_code,
          articleCode: product.article_code,
          articleName: product.article_name,
          variant: variantOf(product),
          wasMinor: product.unit_price_minor,
          priceMinor: priceIn(target, product.sku_id)!,
          currency: CURRENCY,
          channel: CHANNEL,
          siteId: target.siteId,
          siteIds: target.siteIds,
          where: target.where,
          from: target.from,
          sellable: SELLABLE,
          taxCategory: TAX_CATEGORY,
          taxRateBps: 0,
          taxInclusive: true,
        }))
      )
    )
    // Everything chosen is marked dropped rather than the lists being emptied:
    // the seeded half is derived from a query, so clearing `added` alone would
    // leave the styles the grid sent sitting in the table at no price.
    setAdded([])
    setDropped(new Set(chosen.map((product) => product.sku_id)))
    setOwn({})
    setBulk("")
    setShopPrice({})
    setShopFrom({})
    setSearch("")
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New price"
      id={chosen.length === 0 ? undefined : `${count(chosen.length)} SKUs`}
      width="wide"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              "min-w-0 truncate text-[0.9375rem]",
              unpriced.length > 0 ? "text-bad" : "text-text"
            )}
          >
            {chosen.length === 0
              ? "Choose the SKUs."
              : unpriced.length > 0
                ? `${count(unpriced.length)} SKU${unpriced.length === 1 ? " has" : "s have"} no price yet.`
                : `${count(chosen.length)} SKU${chosen.length === 1 ? "" : "s"} · ${where}`}
          </span>
          <Button variant="primary" disabled={!ready} onClick={commit}>
            Add
          </Button>
        </div>
      }
    >
      {/* Nothing is amended: this writes a new price, and the newest book that
          names a product is the one every till reads — the old figure stays in
          the book that carried it. */}
      <div className="flex flex-col gap-8">
        {/* ── products ───────────────────────────────────────────────────── */}
        <Section title="Articles">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          {seeded.loading && seeds.length > 0 ? (
            <Quiet>Loading…</Quiet>
          ) : seeded.failed ? (
            <Quiet>Could not load the selected articles.</Quiet>
          ) : null}

          {needle.length === 0 ? null : needle.length < 2 ? (
            <Quiet>Type at least 2 characters.</Quiet>
          ) : results.isError ? (
            <Quiet>Search failed.</Quiet>
          ) : results.data === undefined ? (
            <Quiet>Searching…</Quiet>
          ) : results.data.length === 0 ? (
            <Quiet>Nothing matches “{needle}”.</Quiet>
          ) : (
            <div>
              <div className="mb-3 flex justify-end">
                <Button
                  variant="quiet"
                  onClick={() => results.data.forEach(pick)}
                >
                  Add all {count(results.data.length)}
                </Button>
              </div>
              {/* The search is capped; at the cap, say so rather than let
                  the list pass for every match. */}
              {results.data.length >= PRODUCT_CAP && (
                <Quiet>First {count(PRODUCT_CAP)} matches.</Quiet>
              )}
              {/* A window onto the matches rather than the whole list, so the
                  price and the shops stay on screen while somebody picks. */}
              <div className="max-h-[17rem] overflow-y-auto rounded-inner border border-hairline-2 px-4">
                <MiniTable
                  head={[
                    "Article",
                    { label: "Variant", align: "left" },
                    "Now",
                    { label: "", align: "right" },
                  ]}
                >
                  {results.data.map((product) => {
                    const on = chosen.some(
                      (one) => one.sku_id === product.sku_id
                    )
                    return (
                      <MiniRow key={product.sku_id}>
                        <MiniCell className="py-3.5">
                          <Named
                            name={product.article_name ?? product.article_code}
                            code={sku(product.sku_code)}
                          />
                        </MiniCell>
                        <MiniCell className="py-3.5">
                          <span className="text-[0.9375rem] text-mute">
                            {variantOf(product)}
                          </span>
                        </MiniCell>
                        <MiniCell align="right" className="py-3.5">
                          {money(product.unit_price_minor)}
                        </MiniCell>
                        <MiniCell align="right" className="py-3.5">
                          <Button
                            variant="quiet"
                            onClick={() =>
                              on ? drop(product.sku_id) : pick(product)
                            }
                          >
                            {on ? "Remove" : "Add"}
                          </Button>
                        </MiniCell>
                      </MiniRow>
                    )
                  })}
                </MiniTable>
              </div>
            </div>
          )}
        </Section>

        {/* ── the figure ─────────────────────────────────────────────────── */}
        {/* One figure for everything chosen; any row below can be given its
            own. "Now" is the company price the last published book gave each
            product — a shop charging something else is read on the grid. */}
        <Section title="Price">
          <Field
            label="New price for all"
            className="max-w-[16rem]"
            problem={
              bulk.trim() !== "" && minorOf(bulk) === null
                ? "Whole rupiah only."
                : undefined
            }
          >
            <Money value={bulk} onChange={setBulk} prefix="Rp" />
          </Field>

          {chosen.length > 0 && (
            <MiniTable
              head={[
                "Article",
                "Now",
                { label: "New Price", align: "right" },
                { label: "", align: "right" },
              ]}
            >
              {chosen.map((product) => {
                const minor = priceOf(product.sku_id)
                return (
                  <MiniRow key={product.sku_id}>
                    <MiniCell className="py-3.5">
                      <Named
                        name={product.article_name ?? product.article_code}
                        code={[sku(product.sku_code), variantOf(product)]
                          .filter((one) => one !== "")
                          .join(" · ")}
                      />
                    </MiniCell>
                    <MiniCell align="right" className="py-3.5">
                      <span className="text-mute tabular-nums">
                        {money(product.unit_price_minor)}
                      </span>
                    </MiniCell>
                    <MiniCell align="right" className="py-3.5">
                      <Money
                        value={priceText(product.sku_id)}
                        label={`Price for ${sku(product.sku_code)}`}
                        invalid={
                          minor === null && priceText(product.sku_id) !== ""
                        }
                        className="h-9 w-32 px-3 text-right text-[0.9375rem]"
                        onChange={(next) =>
                          setOwn((was) => ({ ...was, [product.sku_id]: next }))
                        }
                      />
                    </MiniCell>
                    <MiniCell align="right" className="py-3.5">
                      <Button
                        variant="quiet"
                        onClick={() => drop(product.sku_id)}
                      >
                        Remove
                      </Button>
                    </MiniCell>
                  </MiniRow>
                )
              })}
            </MiniTable>
          )}
        </Section>

        {/* ── the level ──────────────────────────────────────────────────── */}
        <Section title="Stores">
          {/* Every shop is a tile of its own rather than the absence of one.
              "Nothing lit" and "the company price" are the same state to the
              engine, but not to a reader: an empty grid looks like a question
              nobody has answered yet, and the company price is the answer most
              of these rows want. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <ShopTile
              on={scope === "FLEET"}
              label="Every store"
              onClick={() => setSiteIds([])}
              className="col-span-full sm:col-span-1"
            />
            {shops.map((shop) => (
              <ShopTile
                key={shop.site_id}
                on={siteIds.includes(shop.site_id)}
                label={shop.label ?? shop.site_id}
                note={shop.label === null ? undefined : shop.site_id}
                onClick={() => toggleShop(shop.site_id)}
              />
            ))}
          </div>

          {siteIds.length > 0 && (
            <div className="overflow-hidden rounded-inner border border-hairline-2">
              {/* The header only appears where the row is a row. Below `sm`
                  the three fields stack, and a caption sitting above the first
                  of three stacks would be labelling one of them. */}
              <div className="hidden bg-soft px-4 py-3 text-[0.9375rem] font-medium text-mute sm:grid sm:grid-cols-[1fr_8.5rem_10.5rem] sm:gap-3">
                <span>Store</span>
                <span>Its own price</span>
                <span>Starts</span>
              </div>
              {siteIds.map((id) => (
                <div
                  key={id}
                  className="grid grid-cols-1 gap-2 border-t border-hairline px-4 py-3 first:border-t-0 sm:grid-cols-[1fr_8.5rem_10.5rem] sm:items-center sm:gap-3 sm:first:border-t"
                >
                  <span
                    title={id}
                    className="min-w-0 truncate text-[0.9375rem] text-ink"
                  >
                    {labelOf(id)}
                  </span>
                  <Money
                    value={shopPrice[id] ?? ""}
                    label={`What ${labelOf(id)} charges`}
                    onChange={(digits) =>
                      setShopPrice((was) => ({ ...was, [id]: digits }))
                    }
                  />
                  <Input
                    type="datetime-local"
                    value={shopFrom[id] ?? ""}
                    aria-label={`When ${labelOf(id)} starts charging it`}
                    onChange={(event) =>
                      setShopFrom((was) => ({
                        ...was,
                        [id]: event.target.value,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          )}

          {/* A price carries no date of its own — the book's window is
              what every till reads — so two start dates are two books. And
              shops that agree on figure and date are one price naming several
              shops, which a shop added to the group later is priced by. */}
          {books.length > 1 && (
            <Banner tone="info">
              {count(books.length)} start dates — published as{" "}
              {count(books.length)} price changes.
            </Banner>
          )}
        </Section>
      </div>
    </Sheet>
  )
}
