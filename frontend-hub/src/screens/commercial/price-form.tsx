import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Money } from "@/components/ui/field"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import {
  commercialKeys,
  commercialProducts,
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
  /// The site id, when the shop has a name that is not it. Small, and under —
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
      className={cn(
        "flex min-w-0 flex-col items-start gap-0.5 rounded-inner border px-3 py-2.5 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        on
          ? "border-accent bg-accent-bg"
          : "border-hairline-2 bg-canvas hover:border-hairline-strong hover:bg-soft-2",
        className
      )}
    >
      <span
        className={cn(
          "w-full truncate text-[0.8125rem] font-medium",
          on ? "text-accent" : "text-ink"
        )}
      >
        {label}
      </span>
      {note !== undefined && (
        <span className="w-full truncate text-[0.71875rem] text-mute">
          {note}
        </span>
      )}
    </button>
  )
}

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
    queryKey: commercialKeys.products(needle),
    queryFn: ({ signal }) => commercialProducts(needle, 100, signal),
    // Two characters, because one is every product in the catalogue and the
    // endpoint caps rather than refuses — a silent slice of five hundred is
    // worse than being asked for another letter.
    enabled: open && needle.length >= 2,
  })

  /// The styles the grid pointed at, expanded into their products.
  ///
  /// One query per article code and not one query for all of them: `q` is a
  /// single substring, so a joined list would match nothing. The results are
  /// then narrowed to an exact article code — `q` is an ILIKE, and a code that
  /// is a prefix of another would otherwise drag the neighbour in.
  const seeds = seed?.articleCodes ?? []
  const seeded = useQueries({
    queries: seeds.map((code) => ({
      queryKey: commercialKeys.products(code),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        commercialProducts(code, 500, signal),
      enabled: open,
    })),
    // `combine` rather than a `useMemo` over the results: `useQueries` hands
    // back a new array every render, so a memo keyed on it never holds.
    combine: (answers) => ({
      loading: answers.some((one) => one.isPending),
      failed: answers.some((one) => one.isError),
      items: answers.flatMap((one) => one.data ?? []),
    }),
  })
  const fromSeed = useMemo(
    () => seeded.items.filter((one) => seeds.includes(one.article_code)),
    // `seeds` is rebuilt each render from the `seed` prop, so the prop is what
    // the memo actually depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seeded.items, seed]
  )

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
          where: "Every shop",
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
              where: `${count(batch.shops.length)} shops`,
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
    targets.length === 1 ? targets[0].where : `${count(siteIds.length)} shops`

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
      id={chosen.length === 0 ? undefined : `${count(chosen.length)} products`}
      width="wide"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.71875rem] text-mute">
            {chosen.length === 0
              ? "Nothing chosen yet."
              : `${count(chosen.length)} product${chosen.length === 1 ? "" : "s"} · ${where}`}
          </span>
          <Button variant="primary" disabled={!ready} onClick={commit}>
            Add to the book
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Banner tone="info">
          Nothing is amended. This writes a new price, and the newest book that
          names a product is the one every till reads — so pushing 179.000 is
          the whole of changing 219.000, and the old figure stays in the book
          that carried it.
        </Banner>

        {/* ── products ───────────────────────────────────────────────────── */}
        <div>
          <SubHead aside="server-side search">Which products</SubHead>
          <Input
            value={search}
            placeholder="A style, a product code or a description — ART-0001, SKU-0001-002, kemeja"
            className="mb-2"
            onChange={(event) => setSearch(event.target.value)}
          />

          {seeded.loading && seeds.length > 0 ? (
            <Quiet>
              Opening {count(seeds.length)} style
              {seeds.length === 1 ? "" : "s"} from the grid…
            </Quiet>
          ) : seeded.failed ? (
            <Quiet>
              The styles from the grid could not be opened. Search for them
              above instead.
            </Quiet>
          ) : null}

          {needle.length === 0 ? null : needle.length < 2 ? (
            <Quiet>Two characters is enough to start.</Quiet>
          ) : results.isError ? (
            <Quiet>
              The product search is not answering. `GET
              /api/v1/commercial/products` is not on the node this app is
              talking to, and without it a price cannot name its products.
            </Quiet>
          ) : results.data === undefined ? (
            <Quiet>Searching the catalogue…</Quiet>
          ) : results.data.length === 0 ? (
            <Quiet>Nothing matches “{needle}”.</Quiet>
          ) : (
            <>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[0.71875rem] text-mute">
                  {count(results.data.length)} product
                  {results.data.length === 1 ? "" : "s"} match
                </span>
                <Button
                  variant="quiet"
                  onClick={() => results.data.forEach(pick)}
                >
                  Add all shown
                </Button>
              </div>
              <MiniTable
                head={[
                  "Product",
                  { label: "", align: "left" },
                  "Company now",
                  { label: "", align: "right" },
                ]}
              >
                {results.data.map((product) => {
                  const on = chosen.some((one) => one.sku_id === product.sku_id)
                  return (
                    <MiniRow key={product.sku_id}>
                      <MiniCell>
                        <Named
                          name={product.article_name ?? product.article_code}
                          code={product.sku_code}
                        />
                      </MiniCell>
                      <MiniCell>
                        <span className="text-[0.71875rem] text-mute">
                          {variantOf(product)}
                        </span>
                      </MiniCell>
                      <MiniCell align="right">
                        {money(product.unit_price_minor)}
                      </MiniCell>
                      <MiniCell align="right">
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
            </>
          )}
        </div>

        {/* ── the figure ─────────────────────────────────────────────────── */}
        <Field
          label="What they cost"
          hint={
            minorOf(bulk) === null
              ? "Whole rupiah, as it would be written on a ticket. Any product below can be given its own."
              : `${money(minorOf(bulk))} each, unless a row below says otherwise.`
          }
          problem={
            bulk.trim() !== "" && minorOf(bulk) === null
              ? "A price is whole rupiah. No decimals, and nothing but digits."
              : undefined
          }
        >
          <Money value={bulk} onChange={setBulk} placeholder="199.000" />
        </Field>

        {chosen.length > 0 && (
          <div>
            <SubHead aside={`${count(chosen.length)} chosen`}>
              What this book will say
            </SubHead>
            <MiniTable
              head={[
                "Product",
                "Company now",
                { label: "Becomes", align: "right" },
                { label: "", align: "right" },
              ]}
            >
              {chosen.map((product) => {
                const minor = priceOf(product.sku_id)
                return (
                  <MiniRow key={product.sku_id}>
                    <MiniCell>
                      <Named
                        name={product.article_name ?? product.article_code}
                        code={[product.sku_code, variantOf(product)]
                          .filter((one) => one !== "")
                          .join(" · ")}
                      />
                    </MiniCell>
                    <MiniCell align="right">
                      <span className="text-mute tabular-nums">
                        {money(product.unit_price_minor)}
                      </span>
                    </MiniCell>
                    <MiniCell align="right">
                      <Money
                        value={priceText(product.sku_id)}
                        label={`Price for ${product.sku_code}`}
                        placeholder="—"
                        className={cn(
                          "h-7 w-28 px-2.5 text-right text-[0.78125rem]",
                          minor === null && priceText(product.sku_id) !== ""
                            ? "border-bad"
                            : undefined
                        )}
                        onChange={(next) =>
                          setOwn((was) => ({ ...was, [product.sku_id]: next }))
                        }
                      />
                    </MiniCell>
                    <MiniCell align="right">
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
            {unpriced.length > 0 && (
              <p className="mt-2 text-[0.71875rem] leading-relaxed text-bad">
                {count(unpriced.length)} product
                {unpriced.length === 1 ? " has" : "s have"} no readable price.
                Every row in a book carries its own figure — there is no such
                thing as a price rule without one.
              </p>
            )}
            <p className="mt-2 text-[0.71875rem] leading-relaxed text-mute">
              “Company now” is the price the last published book gave each
              product fleet-wide. A shop already charging something else — from
              its own price or from a clearance — is not shown here; the grid
              behind this sheet is where that is read.
            </p>
          </div>
        )}

        {/* ── the level ──────────────────────────────────────────────────── */}
        <div>
          <SubHead aside={scope === "FLEET" ? "company price" : where}>
            Where it applies
          </SubHead>

          {/* Every shop is a tile of its own rather than the absence of one.
              "Nothing lit" and "the company price" are the same state to the
              engine, but not to a reader: an empty grid looks like a question
              nobody has answered yet, and the company price is the answer most
              of these rows want. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <ShopTile
              on={scope === "FLEET"}
              label="Every shop"
              note="the company price"
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
            <div className="mt-2.5 overflow-hidden rounded-inner border border-hairline-2">
              {/* The header only appears where the row is a row. Below `sm`
                  the three fields stack, and a caption sitting above the first
                  of three stacks would be labelling one of them. */}
              <div className="hidden bg-soft px-3 py-1.5 text-[0.6875rem] font-medium tracking-[0.06em] text-mute uppercase sm:grid sm:grid-cols-[1fr_8.5rem_10.5rem] sm:gap-2">
                <span>Shop</span>
                <span>Its own price</span>
                <span>Starts</span>
              </div>
              {siteIds.map((id) => (
                <div
                  key={id}
                  className="grid grid-cols-1 gap-1.5 border-t border-hairline px-3 py-2 first:border-t-0 sm:grid-cols-[1fr_8.5rem_10.5rem] sm:items-center sm:gap-2 sm:first:border-t"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[0.8125rem] text-ink">
                      {labelOf(id)}
                    </span>
                    <span className="block truncate text-[0.6875rem] text-mute">
                      {id}
                    </span>
                  </span>
                  <Money
                    value={shopPrice[id] ?? ""}
                    label={`What ${labelOf(id)} charges`}
                    placeholder="as above"
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

          {books.length > 1 && (
            <Banner tone="info" className="mt-2">
              {count(books.length)} start dates is {count(books.length)} books.
              A price carries no date of its own — every till reads the book's
              window — so publishing this writes one book per date, each taking
              its own version number. That is safe: a shop loads every book
              whose window is open, so a book naming one shop adds a price there
              and leaves the rest standing.
            </Banner>
          )}

          {/* What the tiles and the table above have actually come to, rather
              than what the number of lit tiles suggests: two shops on one
              figure and one day are a group, and the same two disagreeing on
              either are two prices. */}
          <p className="mt-2 text-[0.71875rem] leading-relaxed text-mute">
            {scope === "FLEET"
              ? "The company price — the level every active product must have, and the one a shop falls back to. It is what a new shop sells at on its first day, without anybody remembering to add it."
              : targets.some((one) => one.siteIds !== null)
                ? "Shops that agree on the figure and the day are one price naming them all — a city, a format — rather than a row each. That is the difference the level exists for: a shop added to that group later is priced by it, where a row-per-shop list quietly leaves the new branch on the company price."
                : targets.length === 1
                  ? "A price for this shop alone. It outranks a group price and the company price — but only within the same book: a newer company-wide book supersedes it, because the engine ranks by version first."
                  : "A price each, because these shops do not agree on the figure or on the day. Leave two of them on the same figure and the same date and they are written as one price naming both, which is what keeps a branch opened later on it."}
          </p>
        </div>

        <p className="text-[0.71875rem] leading-relaxed text-mute">
          A price with no start of its own begins when the book does, and that
          is decided once, at Publish. It is not a field on a price — the price
          row carries no dates at all, and the engine reads the publication's
          window for every price in it — which is why a shop given its own day
          above goes out as its own book. An end date is a different thing
          again: a cut that has to stop on a date is a sale price, and that one
          does carry its own window.
        </p>
      </div>
    </Sheet>
  )
}
