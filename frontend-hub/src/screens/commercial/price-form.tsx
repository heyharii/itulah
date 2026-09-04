import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { PickMany, PickOne } from "@/components/ui/pick"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Segmented } from "@/components/ui/segmented"
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
import { Switch } from "@/components/ui/form"
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
///    version number, and then refuse to publish.

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

const SCOPES: readonly { value: Scope; label: string }[] = [
  { value: "FLEET", label: "Every shop" },
  { value: "ONE", label: "One shop" },
  { value: "SOME", label: "Some shops" },
]

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
  const [scope, setScope] = useState<Scope>(() =>
    seed === null || seed.siteIds.length === 0
      ? "FLEET"
      : seed.siteIds.length === 1
        ? "ONE"
        : "SOME"
  )
  const [siteId, setSiteId] = useState<string | null>(
    () => seed?.siteIds[0] ?? null
  )
  const [siteIds, setSiteIds] = useState<readonly string[]>(
    () => seed?.siteIds ?? []
  )
  const [channel, setChannel] = useState<CommercialChannel>("STORE")
  const [sellable, setSellable] = useState(true)

  // ── how it is taxed ──────────────────────────────────────────────────────
  const [taxCategory, setTaxCategory] = useState(TAX_CATEGORY)
  const [rate, setRate] = useState("0")
  const [taxInclusive, setTaxInclusive] = useState(true)

  const choices = useMemo(
    () =>
      shops.map((shop) => ({
        value: shop.site_id,
        label: shop.label ?? shop.site_id,
      })),
    [shops]
  )
  const labelOf = (id: string) =>
    shops.find((shop) => shop.site_id === id)?.label ?? id

  /// The level, as the three fields the server takes. Exactly one is set —
  /// `price_rule_names_one_level` counts them and refuses a second.
  const level =
    scope === "ONE" && siteId !== null
      ? { site_id: siteId, site_ids: null }
      : scope === "SOME" && siteIds.length > 0
        ? { site_id: null, site_ids: siteIds }
        : { site_id: null, site_ids: null }

  const where =
    scope === "FLEET"
      ? "Every shop"
      : scope === "ONE"
        ? siteId === null
          ? "No shop chosen"
          : labelOf(siteId)
        : siteIds.length === 0
          ? "No shops chosen"
          : siteIds.length === 1
            ? labelOf(siteIds[0])
            : `${count(siteIds.length)} shops`

  const rateBps = Math.round(Number(rate.replace(",", ".")) * 100)
  const rateBroken =
    rate.trim() === "" ||
    !Number.isFinite(rateBps) ||
    rateBps < 0 ||
    rateBps > 100_000

  const unpriced = chosen.filter((one) => priceOf(one.sku_id) === null)
  const scopeBroken =
    (scope === "ONE" && siteId === null) ||
    (scope === "SOME" && siteIds.length === 0)

  const ready =
    chosen.length > 0 &&
    unpriced.length === 0 &&
    !scopeBroken &&
    !rateBroken &&
    taxCategory.trim() !== ""

  const commit = () => {
    if (!ready) return
    onAdd(
      chosen.map((product) => ({
        kind: "price" as const,
        // `COALESCE(site_id,'*')` is what the server's unique index keys on,
        // so this is the same identity — a group price and a fleet price for
        // one product are one row's worth of book, and the later one wins
        // here instead of being refused there.
        key: `${product.sku_id}|${level.site_id ?? "*"}|${channel}`,
        skuId: product.sku_id,
        skuCode: product.sku_code,
        articleCode: product.article_code,
        articleName: product.article_name,
        variant: variantOf(product),
        wasMinor: product.unit_price_minor,
        priceMinor: priceOf(product.sku_id)!,
        currency: CURRENCY,
        channel,
        siteId: level.site_id,
        siteIds: level.site_ids,
        where,
        sellable,
        taxCategory: taxCategory.trim().toUpperCase(),
        taxRateBps: rateBps,
        taxInclusive,
      }))
    )
    // Everything chosen is marked dropped rather than the lists being emptied:
    // the seeded half is derived from a query, so clearing `added` alone would
    // leave the styles the grid sent sitting in the table at no price.
    setAdded([])
    setDropped(new Set(chosen.map((product) => product.sku_id)))
    setOwn({})
    setBulk("")
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
          <Button variant="dark" disabled={!ready} onClick={commit}>
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
          <SubHead aside="one level per price">Where it applies</SubHead>
          <Segmented
            options={SCOPES}
            value={scope}
            onChange={setScope}
            className="mb-2"
          />

          {scope === "ONE" && (
            <PickOne
              choices={choices}
              value={siteId}
              onChange={setSiteId}
              placeholder="Choose a shop"
              label="The shop this price is for"
            />
          )}
          {scope === "SOME" && (
            <PickMany
              choices={choices}
              values={siteIds}
              onChange={setSiteIds}
              placeholder="Choose the shops"
              label="The shops this price is for"
            />
          )}

          <p className="mt-2 text-[0.71875rem] leading-relaxed text-mute">
            {scope === "FLEET"
              ? "The company price — the level every active product must have, and the one a shop falls back to. It is what a new shop sells at on its first day, without anybody remembering to add it."
              : scope === "ONE"
                ? "A price for this shop alone. It outranks a group price and the company price — but only within the same book: a newer company-wide book supersedes it, because the engine ranks by version first."
                : "One price naming several shops — a city, a format — rather than one row per shop. That is the difference the level exists for: a shop added to the group later is priced by it, where a row-per-shop list quietly leaves the new branch on the company price."}
          </p>
          {scope === "SOME" && siteIds.length === 1 && (
            <p className="mt-1.5 text-[0.71875rem] leading-relaxed text-mute">
              A group of one is legal and is not the same as “One shop”: it sits
              a rung lower, so a shop price would beat it inside the same book.
            </p>
          )}
        </div>

        {/* ── channel and permission ─────────────────────────────────────── */}
        <Field
          label="Where it is sold"
          hint="Online and marketplace are refused on purpose — see below."
        >
          <Select
            value={channel}
            onChange={(next) => setChannel(next as CommercialChannel)}
          >
            <option value="STORE">In the shops</option>
            <option value="ONLINE" disabled>
              Online — not available
            </option>
            <option value="MARKETPLACE" disabled>
              Marketplace — not available
            </option>
          </Select>
        </Field>
        <p className="-mt-3 text-[0.71875rem] leading-relaxed text-mute">
          A book that carries the first price in a channel has to carry one for
          every active product in it: publishing checks that each active SKU has
          a company-wide price in every channel the book touches. So an online
          price for a handful of styles would write a book, take the next
          version number, and then refuse to publish. Trading online begins with
          pricing the range, not with this sheet.
        </p>

        <div className="flex items-start gap-2.5 rounded-inner border border-hairline px-3 py-2.5">
          <Switch
            on={sellable}
            label="May be sold"
            onToggle={() => setSellable((was) => !was)}
          />
          <span className="min-w-0">
            <span className="block text-[0.8125rem] font-medium text-ink">
              {sellable ? "May be sold" : "Priced but not for sale"}
            </span>
            <span className="block text-[0.71875rem] leading-relaxed text-body">
              A price and the permission to sell are authored together — the
              server refuses a book holding one without the other. Switching
              this off prices a product that a till will not put in a basket,
              which is how something is withdrawn without losing what it costs.
            </span>
          </span>
        </div>

        {/* ── tax ────────────────────────────────────────────────────────── */}
        <div>
          <SubHead aside="required with a price">Filed under</SubHead>
          <div className="flex flex-wrap items-start gap-2.5">
            <Field label="Tax class" className="w-40">
              <Input
                value={taxCategory}
                onChange={(event) =>
                  setTaxCategory(event.target.value.toUpperCase())
                }
              />
            </Field>
            <Field
              label="Rate"
              className="w-28"
              problem={rateBroken ? "Between 0 and 1000%." : undefined}
            >
              <Input
                value={rate}
                inputMode="decimal"
                onChange={(event) => setRate(event.target.value)}
              />
            </Field>
            <Field label="Reading" className="w-44">
              <Select
                value={taxInclusive ? "IN" : "ON"}
                onChange={(next) => setTaxInclusive(next === "IN")}
              >
                <option value="IN">Included in the price</option>
                <option value="ON">Added at the till</option>
              </Select>
            </Field>
          </div>
          <p className="mt-2 text-[0.71875rem] leading-relaxed text-mute">
            A book that sets prices carries at least one tax rule to categorise
            them, and a book that sets none may not carry any — the server
            refuses both ways round. {TAX_CATEGORY} at nothing per cent is what
            an article setup files its first price under, so leaving this alone
            keeps a pushed price in the same class as the one it supersedes.
          </p>
        </div>

        <p className="text-[0.71875rem] leading-relaxed text-mute">
          When these start is decided once, for the whole book, at Publish: a
          price rule carries no dates of its own — the engine reads the
          publication's window for every price in it. A cut that has to end on a
          date is a sale price, which does carry its own.
        </p>
      </div>
    </Sheet>
  )
}
