import { AppShell, ScreenBody, ScreenHeader } from "@/components/app-shell"
import { Nav } from "@/components/nav"
import { ProductPicker } from "@/components/commercial/product-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { PriceBook } from "@/lib/commercial"
import { CHANNELS, listPriceBooks, priceBooksKey } from "@/lib/commercial"
import type {
  CampaignDraft,
  CouponDraft,
  MarkdownDraft,
  PriceDraft,
  PriceLevel,
  PromotionDraft,
} from "@/lib/commercial-authoring"
import {
  createPriceBook,
  instantOf,
  minorOf,
  newRuleId,
  NO_TAX,
  promotionProblems,
  toCampaigns,
  toCoupons,
  toMarkdowns,
  toOfferRules,
  toRules,
} from "@/lib/commercial-authoring"
import { commercialFleet, fleetKey } from "@/lib/commercial"
import { useIdentity } from "@/lib/identity"
import { money, units } from "@/lib/money"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Plus, Save, Tag, X } from "lucide-react"
import { useMemo, useRef, useState } from "react"

/// Write a price book.
///
/// The whole model in one screen, because the parts of it only make sense
/// against each other:
///
///   - a **price** is what a thing costs, at one of three levels;
///   - a **markdown** REPLACES that price for the goods it names — clearance,
///     not a discount on top;
///   - a **promotion** comes off whatever the thing now costs;
///   - a **coupon** is a gate on a promotion and never a discount of its own;
///   - a **campaign** is the envelope several promotions share: one window, one
///     budget, one switch.
///
/// A book is a LIST OF CHANGES, not a catalogue. Anything it does not name
/// keeps the price the last book gave it, and the newest book that names a
/// product wins. That is why this screen never asks you to fill in a range: a
/// twenty-line book is the ordinary case, and a five-thousand-line one is
/// somebody restating what had not changed — which quietly republishes every
/// one of those prices under a newer version.
///
/// It saves a DRAFT. Sending it to thirty tills is a second decision, made on
/// the books screen, and the dispatch happens inside the transaction that
/// publishes — so either the book is out to the whole fleet or nothing happened.
export function BookComposer() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const identity = useIdentity()

  const books = useQuery({
    queryKey: priceBooksKey(),
    queryFn: ({ signal }) => listPriceBooks(signal),
  })
  const fleet = useQuery({
    queryKey: fleetKey(),
    queryFn: ({ signal }) => commercialFleet(signal),
  })

  const [name, setName] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [section, setSection] = useState<Section>("prices")
  const [prices, setPrices] = useState<PriceDraft[]>([])
  const [markdowns, setMarkdowns] = useState<MarkdownDraft[]>([])
  const [promotions, setPromotions] = useState<PromotionDraft[]>([])
  const [coupons, setCoupons] = useState<CouponDraft[]>([])
  const [campaigns, setCampaigns] = useState<CampaignDraft[]>([])

  /// The number the book will claim, suggested rather than asked for.
  ///
  /// The engine ranks by version before anything else, so a book numbered below
  /// one already written loses every product the higher book names — it
  /// publishes, it dispatches, and it changes nothing. The server takes the
  /// same lock and refuses a low number outright; showing the next one here
  /// means nobody has to find that out by being refused.
  const version = useMemo(
    () => Math.max(0, ...(books.data ?? []).map((book: PriceBook) => book.version)) + 1,
    [books.data],
  )

  const shops = useMemo(
    () =>
      (fleet.data?.items ?? [])
        .filter((shop) => shop.site_id !== null)
        .map((shop) => ({
          site_id: shop.site_id as string,
          label: shop.label ?? (shop.site_id as string),
        })),
    [fleet.data],
  )

  // One key per attempt, replaced only once the server has answered: a
  // double-clicked Save writes one book and returns the same one twice.
  const key = useRef(crypto.randomUUID())

  const offerRules = useMemo(() => toOfferRules(prices), [prices])
  const markdownRows = useMemo(() => toMarkdowns(markdowns), [markdowns])
  const ruleRows = useMemo(() => toRules(promotions), [promotions])
  const campaignRows = useMemo(() => toCampaigns(campaigns), [campaigns])
  const couponRows = useMemo(() => toCoupons(coupons), [coupons])

  const save = useMutation({
    mutationFn: () =>
      createPriceBook({
        version,
        name: name.trim(),
        effective_from: instantOf(from) ?? new Date().toISOString(),
        effective_to: instantOf(to),
        // Sent only when the book actually sets prices: an offer names a tax
        // category and the category has to exist, but a promotion-only book
        // categorises nothing. Zero-rated either way — this business charges no
        // tax and nothing downstream divides a price into net and tax.
        tax_rules: offerRules.length > 0 ? [NO_TAX] : [],
        offer_rules: offerRules,
        markdowns: markdownRows,
        rules: ruleRows,
        coupons: couponRows,
        campaigns: campaignRows,
        actor_id: identity.data?.username ?? "",
        idempotency_key: key.current,
      }),
    onSuccess: () => {
      key.current = crypto.randomUUID()
      void queryClient.invalidateQueries({ queryKey: priceBooksKey() })
      void navigate({ to: "/commercial/books" })
    },
  })

  const changes =
    offerRules.length +
    markdownRows.length +
    ruleRows.length +
    couponRows.length +
    campaignRows.length
  const blocked = name.trim() === "" || changes === 0

  return (
    <AppShell data-cloudhub nav={<Nav />}>
      <ScreenHeader
        eyebrow="Commercial"
        title="Write a price book"
        subtitle={
          books.isPending
            ? "loading…"
            : `Will be version ${units(version)} · saves as a draft`
        }
      >
        <Button
          size="sm"
          variant="outline"
          onClick={() => void navigate({ to: "/commercial/books" })}
        >
          Cancel
        </Button>
        <Button size="sm" disabled={blocked || save.isPending} onClick={() => save.mutate()}>
          <Save className="size-3.5" />
          {save.isPending ? "Saving…" : "Save draft"}
        </Button>
      </ScreenHeader>

      {save.isError && (
        <div className="text-destructive border-b px-3.5 py-2 text-[0.71875rem]">
          {save.error instanceof ApiError
            ? save.error.message
            : "The book could not be saved."}
        </div>
      )}

      <ScreenBody>
        <div className="grid gap-3 border-b p-3.5 sm:grid-cols-[1fr_auto_auto]">
          <Labelled label="What this book is">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Harga Lebaran, Turun harga kemeja…"
              className="text-[0.75rem]"
            />
          </Labelled>
          <Labelled label="In force from" hint="Blank means immediately">
            <Input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="w-52 text-[0.75rem]"
            />
          </Labelled>
          <Labelled label="Until" hint="Blank means until replaced">
            <Input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="w-52 text-[0.75rem]"
            />
          </Labelled>
        </div>

        <div className="flex flex-wrap gap-1 border-b px-3 py-2">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={section === entry.id}
              onClick={() => setSection(entry.id)}
              className={cn(
                "rounded-full px-3 py-1 text-[0.71875rem] font-medium",
                section === entry.id
                  ? "bg-[var(--os-soft-2,#f3f3f5)] text-[var(--os-ink,#1d1d1f)]"
                  : "text-[var(--os-body,#74747b)] hover:bg-[var(--os-soft-2,#f3f3f5)]",
              )}
            >
              {entry.label}
              {countOf(entry.id, {
                prices,
                markdowns,
                promotions,
                coupons,
                campaigns,
              }) > 0 && (
                <span className="ml-1.5 opacity-70">
                  {units(
                    countOf(entry.id, {
                      prices,
                      markdowns,
                      promotions,
                      coupons,
                      campaigns,
                    }),
                  )}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="p-3.5">
          {section === "prices" && (
            <Prices rows={prices} shops={shops} onChange={setPrices} />
          )}
          {section === "markdowns" && (
            <Markdowns rows={markdowns} shops={shops} onChange={setMarkdowns} />
          )}
          {section === "promotions" && (
            <Promotions
              rows={promotions}
              campaigns={campaigns}
              onChange={setPromotions}
            />
          )}
          {section === "coupons" && (
            <Coupons rows={coupons} promotions={promotions} onChange={setCoupons} />
          )}
          {section === "campaigns" && (
            <Campaigns rows={campaigns} onChange={setCampaigns} />
          )}
        </div>
      </ScreenBody>

      <div className="text-muted-foreground flex shrink-0 items-center justify-between gap-4 border-t px-3.5 py-2 text-[0.71875rem]">
        <span>
          {changes === 0
            ? "A book has to change something before it can be saved."
            : `${units(changes)} change${changes === 1 ? "" : "s"}: ` +
              [
                offerRules.length > 0 && `${units(offerRules.length)} priced`,
                markdownRows.length > 0 && `${units(markdownRows.length)} marked down`,
                ruleRows.length > 0 && `${units(ruleRows.length)} promotion${ruleRows.length === 1 ? "" : "s"}`,
                couponRows.length > 0 && `${units(couponRows.length)} coupon${couponRows.length === 1 ? "" : "s"}`,
                campaignRows.length > 0 && `${units(campaignRows.length)} campaign${campaignRows.length === 1 ? "" : "s"}`,
              ]
                .filter(Boolean)
                .join(" · ")}
        </span>
        <span>Anything not named here keeps the price the last book gave it.</span>
      </div>
    </AppShell>
  )
}

type Section = "prices" | "markdowns" | "promotions" | "coupons" | "campaigns"

const SECTIONS: readonly { id: Section; label: string }[] = [
  { id: "prices", label: "Prices" },
  { id: "markdowns", label: "Markdowns" },
  { id: "promotions", label: "Promotions" },
  { id: "coupons", label: "Coupons" },
  { id: "campaigns", label: "Campaigns" },
]

function countOf(
  section: Section,
  state: {
    prices: readonly unknown[]
    markdowns: readonly unknown[]
    promotions: readonly unknown[]
    coupons: readonly unknown[]
    campaigns: readonly unknown[]
  },
): number {
  return state[section].length
}

interface Shop {
  readonly site_id: string
  readonly label: string
}

function Labelled({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="grid gap-1">
      <span className="text-muted-foreground text-[0.65625rem] font-medium tracking-wide uppercase">
        {label}
      </span>
      {children}
      {hint !== undefined && (
        <span className="text-muted-foreground text-[0.65625rem]">{hint}</span>
      )}
    </label>
  )
}

/// Empty state that says what the thing IS, not just that there is none of it.
function Nothing({ children, onAdd, add }: { children: React.ReactNode; onAdd: () => void; add: string }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <p className="text-muted-foreground mx-auto max-w-lg text-[0.75rem]">{children}</p>
      <Button size="sm" variant="outline" className="mt-3" onClick={onAdd}>
        <Plus className="size-3.5" />
        {add}
      </Button>
    </div>
  )
}

function Row({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="flex items-end gap-2 rounded-lg border p-2.5">
      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        {children}
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="size-8 shrink-0"
        aria-label="Remove"
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}

/// Which shops a price or a markdown is for.
///
/// One level, never two. The server refuses a row claiming to be both a shop
/// price and a group price — there would be no single right reading, and
/// picking one silently is how a till and the centre come to disagree — so this
/// is one control rather than three checkboxes that can contradict each other.
function Level({
  level,
  siteId,
  siteIds,
  shops,
  onLevel,
  onSite,
  onSites,
}: {
  level: PriceLevel
  siteId: string
  siteIds: readonly string[]
  shops: readonly Shop[]
  onLevel: (level: PriceLevel) => void
  onSite: (siteId: string) => void
  onSites: (siteIds: string[]) => void
}) {
  return (
    <>
      <Labelled label="Applies to">
        <Select value={level} onValueChange={(value) => onLevel(value as PriceLevel)}>
          <SelectTrigger className="w-36">
            <SelectValue>
              {level === "COMPANY"
                ? "Every shop"
                : level === "SITE"
                  ? "One shop"
                  : "Some shops"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="COMPANY">Every shop</SelectItem>
            <SelectItem value="SITE">One shop</SelectItem>
            <SelectItem value="SITE_GROUP">Some shops</SelectItem>
          </SelectContent>
        </Select>
      </Labelled>
      {level === "SITE" && (
        <Labelled label="Shop">
          <Select value={siteId} onValueChange={(value) => onSite(String(value))}>
            <SelectTrigger className="w-44">
              <SelectValue>
                {shops.find((shop) => shop.site_id === siteId)?.label ?? "Choose"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {shops.map((shop) => (
                <SelectItem key={shop.site_id} value={shop.site_id}>
                  {shop.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Labelled>
      )}
      {level === "SITE_GROUP" && (
        <Labelled label="Shops" hint={`${units(siteIds.length)} chosen`}>
          <div className="flex max-w-md flex-wrap gap-1">
            {shops.map((shop) => {
              const on = siteIds.includes(shop.site_id)
              return (
                <button
                  key={shop.site_id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    onSites(
                      on
                        ? siteIds.filter((id) => id !== shop.site_id)
                        : [...siteIds, shop.site_id],
                    )
                  }
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[0.6875rem]",
                    on ? "border-[var(--os-ink,#1d1d1f)] bg-[var(--os-ink,#1d1d1f)] text-white" : "hover:bg-[var(--os-soft-2,#f3f3f5)]",
                  )}
                >
                  {shop.label}
                </button>
              )
            })}
          </div>
        </Labelled>
      )}
    </>
  )
}

function Prices({
  rows,
  shops,
  onChange,
}: {
  rows: readonly PriceDraft[]
  shops: readonly Shop[]
  onChange: (rows: PriceDraft[]) => void
}) {
  const add = () =>
    onChange([
      ...rows,
      {
        key: crypto.randomUUID(),
        sku_id: "",
        sku_code: "",
        article_name: "",
        current_minor: null,
        price: "",
        level: "COMPANY",
        site_id: "",
        site_ids: [],
        channel: "STORE",
      },
    ])
  const edit = (key: string, patch: Partial<PriceDraft>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  if (rows.length === 0) {
    return (
      <Nothing onAdd={add} add="Price a product">
        What a product costs, before any clearance or promotion. Leave this empty
        for a book that only adds a discount — the prices stay where the last
        book put them, and restating one would republish it under a newer number.
      </Nothing>
    )
  }

  return (
    <div className="grid gap-2">
      {rows.map((row) => {
        const next = minorOf(row.price)
        return (
          <Row key={row.key} onRemove={() => onChange(rows.filter((r) => r.key !== row.key))}>
            <Labelled
              label="Product"
              hint={
                row.current_minor === null
                  ? row.sku_id === ""
                    ? undefined
                    : "no published price yet"
                  : `now ${money(row.current_minor)}${
                      next !== null && next !== row.current_minor
                        ? ` → ${money(next)}`
                        : next === row.current_minor
                          ? " · unchanged"
                          : ""
                    }`
              }
            >
              <ProductPicker
                value={row.sku_code === "" ? "" : `${row.article_name} · ${row.sku_code}`}
                onPick={(product) =>
                  edit(row.key, {
                    sku_id: product.sku_id,
                    sku_code: product.sku_code,
                    article_name: product.article_name,
                    current_minor: product.unit_price_minor,
                  })
                }
              />
            </Labelled>
            <Labelled label="New price">
              <Input
                inputMode="numeric"
                value={row.price}
                onChange={(event) => edit(row.key, { price: event.target.value })}
                placeholder="200000"
                className="w-32 text-right font-mono tabular-nums"
              />
            </Labelled>
            <Level
              level={row.level}
              siteId={row.site_id}
              siteIds={row.site_ids}
              shops={shops}
              onLevel={(level) => edit(row.key, { level })}
              onSite={(site_id) => edit(row.key, { site_id })}
              onSites={(site_ids) => edit(row.key, { site_ids })}
            />
            <Labelled label="Channel">
              <Select
                value={row.channel}
                onValueChange={(value) =>
                  edit(row.key, { channel: value as PriceDraft["channel"] })
                }
              >
                <SelectTrigger className="w-32">
                  <SelectValue>{row.channel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((channel) => (
                    <SelectItem key={channel} value={channel}>
                      {channel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Labelled>
          </Row>
        )
      })}
      <Button size="sm" variant="outline" className="justify-self-start" onClick={add}>
        <Plus className="size-3.5" />
        Price another
      </Button>
    </div>
  )
}

function Markdowns({
  rows,
  shops,
  onChange,
}: {
  rows: readonly MarkdownDraft[]
  shops: readonly Shop[]
  onChange: (rows: MarkdownDraft[]) => void
}) {
  const add = () =>
    onChange([
      ...rows,
      {
        key: crypto.randomUUID(),
        target: "SKU",
        sku_code: "",
        article_code: "",
        label: "",
        current_minor: null,
        price: "",
        level: "COMPANY",
        site_id: "",
        site_ids: [],
        from: "",
        to: "",
      },
    ])
  const edit = (key: string, patch: Partial<MarkdownDraft>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  if (rows.length === 0) {
    return (
      <Nothing onAdd={add} add="Mark something down">
        Clearance. A markdown REPLACES the price for the goods it names, rather
        than coming off it — so a shirt on markdown is a shirt that now costs
        less, and promotions still apply on top of the new number.
      </Nothing>
    )
  }

  return (
    <div className="grid gap-2">
      {rows.map((row) => (
        <Row key={row.key} onRemove={() => onChange(rows.filter((r) => r.key !== row.key))}>
          <Labelled
            label={row.target === "SKU" ? "Product" : "Style"}
            hint={
              row.target === "ARTICLE"
                ? "every colour and size under this style"
                : row.current_minor === null
                  ? undefined
                  : `now ${money(row.current_minor)}`
            }
          >
            <div className="flex gap-1.5">
              <Select
                value={row.target}
                onValueChange={(value) =>
                  edit(row.key, { target: value as MarkdownDraft["target"] })
                }
              >
                <SelectTrigger className="w-24">
                  <SelectValue>{row.target === "SKU" ? "Product" : "Style"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SKU">Product</SelectItem>
                  <SelectItem value="ARTICLE">Style</SelectItem>
                </SelectContent>
              </Select>
              {row.target === "SKU" ? (
                <div className="min-w-0 flex-1">
                  <ProductPicker
                    value={row.sku_code === "" ? "" : `${row.label} · ${row.sku_code}`}
                    onPick={(product) =>
                      edit(row.key, {
                        sku_code: product.sku_code,
                        label: product.article_name,
                        current_minor: product.unit_price_minor,
                      })
                    }
                  />
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <ProductPicker
                    placeholder="Search a style…"
                    value={row.article_code === "" ? "" : `${row.label} · ${row.article_code}`}
                    onPick={(product) =>
                      edit(row.key, {
                        article_code: product.article_code,
                        label: product.article_name,
                        current_minor: null,
                      })
                    }
                  />
                </div>
              )}
            </div>
          </Labelled>
          <Labelled label="Sale price">
            <Input
              inputMode="numeric"
              value={row.price}
              onChange={(event) => edit(row.key, { price: event.target.value })}
              placeholder="149000"
              className="w-32 text-right font-mono tabular-nums"
            />
          </Labelled>
          <Level
            level={row.level}
            siteId={row.site_id}
            siteIds={row.site_ids}
            shops={shops}
            onLevel={(level) => edit(row.key, { level })}
            onSite={(site_id) => edit(row.key, { site_id })}
            onSites={(site_ids) => edit(row.key, { site_ids })}
          />
          <div className="flex gap-2">
            <Labelled label="From" hint="Blank starts now">
              <Input
                type="datetime-local"
                value={row.from}
                onChange={(event) => edit(row.key, { from: event.target.value })}
                className="w-48 text-[0.75rem]"
              />
            </Labelled>
            <Labelled label="Until" hint="Blank never ends">
              <Input
                type="datetime-local"
                value={row.to}
                onChange={(event) => edit(row.key, { to: event.target.value })}
                className="w-48 text-[0.75rem]"
              />
            </Labelled>
          </div>
        </Row>
      ))}
      <Button size="sm" variant="outline" className="justify-self-start" onClick={add}>
        <Plus className="size-3.5" />
        Mark down another
      </Button>
    </div>
  )
}

const WEEKDAYS = [
  { iso: 1, label: "Sen" },
  { iso: 2, label: "Sel" },
  { iso: 3, label: "Rab" },
  { iso: 4, label: "Kam" },
  { iso: 5, label: "Jum" },
  { iso: 6, label: "Sab" },
  { iso: 7, label: "Min" },
]

function Promotions({
  rows,
  campaigns,
  onChange,
}: {
  rows: readonly PromotionDraft[]
  campaigns: readonly CampaignDraft[]
  onChange: (rows: PromotionDraft[]) => void
}) {
  const add = () =>
    onChange([
      ...rows,
      {
        key: crypto.randomUUID(),
        rule_id: newRuleId(),
        name: "",
        campaign_id: "",
        matches: "SKU",
        targets: "",
        effect: "PERCENT",
        percent: "",
        amount: "",
        pointsMode: "FIXED_POINTS",
        pointsValue: "",
        minQuantity: "",
        minAmount: "",
        from: "",
        to: "",
        weekdays: [],
        couponCode: "",
        siteIds: [],
        budget: "",
        maxUses: "",
        maxDiscount: "",
        priority: "0",
        stacking: "STACKABLE",
        membersOnly: false,
      },
    ])
  const edit = (key: string, patch: Partial<PromotionDraft>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  if (rows.length === 0) {
    return (
      <Nothing onAdd={add} add="Add a promotion">
        A promotion comes off whatever the goods now cost — after any markdown,
        never instead of one. Give it a coupon code to keep it shut until the
        shopper produces the code.
      </Nothing>
    )
  }

  return (
    <div className="grid gap-3">
      {rows.map((row) => {
        const problems = promotionProblems(row)
        return (
          <div key={row.key} className="rounded-lg border">
            <div className="flex items-center gap-2 border-b p-2.5">
              <Tag className="text-muted-foreground size-3.5 shrink-0" />
              <Input
                value={row.name}
                onChange={(event) => edit(row.key, { name: event.target.value })}
                placeholder="Diskon akhir pekan"
                className="flex-1 text-[0.75rem]"
              />
              {/* The id, editable but never recomputed. Usage is counted per id
                  across every book ever published, so this is the handle a
                  merchandiser follows from a number they did not expect back to
                  the offer that produced it. */}
              <Input
                value={row.rule_id}
                onChange={(event) =>
                  edit(row.key, { rule_id: event.target.value.toUpperCase() })
                }
                aria-label="Promotion code"
                className="w-32 shrink-0 font-mono text-[0.71875rem]"
              />
              <Button
                size="icon"
                variant="ghost"
                className="size-8 shrink-0"
                aria-label="Remove"
                onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
              >
                <X className="size-3.5" />
              </Button>
            </div>

            <div className="grid gap-3 p-2.5 sm:grid-cols-2">
              <Labelled
                label="Applies to"
                hint={
                  row.matches === "WHOLE_CART"
                    ? "conditions read the whole basket"
                    : "codes separated by commas"
                }
              >
                <div className="flex gap-1.5">
                  <Select
                    value={row.matches}
                    onValueChange={(value) =>
                      edit(row.key, { matches: value as PromotionDraft["matches"] })
                    }
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue>{MATCH_LABELS[row.matches]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(MATCH_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {row.matches !== "WHOLE_CART" && (
                    <Input
                      value={row.targets}
                      onChange={(event) => edit(row.key, { targets: event.target.value })}
                      placeholder={MATCH_PLACEHOLDERS[row.matches]}
                      className="flex-1 font-mono text-[0.75rem]"
                    />
                  )}
                </div>
              </Labelled>

              <Labelled label="Takes off">
                <div className="flex gap-1.5">
                  <Select
                    value={row.effect}
                    onValueChange={(value) =>
                      edit(row.key, { effect: value as PromotionDraft["effect"] })
                    }
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue>{EFFECT_LABELS[row.effect]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(EFFECT_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {row.effect === "PERCENT" && (
                    <Input
                      inputMode="decimal"
                      value={row.percent}
                      onChange={(event) => edit(row.key, { percent: event.target.value })}
                      placeholder="20"
                      className="w-24 text-right font-mono tabular-nums"
                    />
                  )}
                  {(row.effect === "AMOUNT" || row.effect === "FIXED_UNIT_PRICE") && (
                    <Input
                      inputMode="numeric"
                      value={row.amount}
                      onChange={(event) => edit(row.key, { amount: event.target.value })}
                      placeholder="50000"
                      className="w-32 text-right font-mono tabular-nums"
                    />
                  )}
                  {row.effect === "EARN_POINTS" && (
                    <>
                      <Select
                        value={row.pointsMode}
                        onValueChange={(value) =>
                          edit(row.key, {
                            pointsMode: value as PromotionDraft["pointsMode"],
                          })
                        }
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue>{POINT_LABELS[row.pointsMode]}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(POINT_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        inputMode="numeric"
                        value={row.pointsValue}
                        onChange={(event) =>
                          edit(row.key, { pointsValue: event.target.value })
                        }
                        className="w-24 text-right font-mono tabular-nums"
                      />
                    </>
                  )}
                </div>
              </Labelled>

              <Labelled label="Only when the basket has" hint="Blank means no threshold">
                <div className="flex gap-1.5">
                  <Input
                    inputMode="numeric"
                    value={row.minQuantity}
                    onChange={(event) => edit(row.key, { minQuantity: event.target.value })}
                    placeholder="2 pcs"
                    className="w-24 font-mono text-[0.75rem]"
                  />
                  <Input
                    inputMode="numeric"
                    value={row.minAmount}
                    onChange={(event) => edit(row.key, { minAmount: event.target.value })}
                    placeholder="500000"
                    className="flex-1 font-mono text-[0.75rem]"
                  />
                </div>
              </Labelled>

              <Labelled label="Coupon code" hint="Blank applies unprompted">
                <Input
                  value={row.couponCode}
                  onChange={(event) =>
                    edit(row.key, { couponCode: event.target.value.toUpperCase() })
                  }
                  placeholder="LEBARAN"
                  className="font-mono text-[0.75rem]"
                />
              </Labelled>

              <Labelled label="Only on" hint="No day chosen means every day">
                <div className="flex gap-1">
                  {WEEKDAYS.map((day) => {
                    const on = row.weekdays.includes(day.iso)
                    return (
                      <button
                        key={day.iso}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          edit(row.key, {
                            weekdays: on
                              ? row.weekdays.filter((iso) => iso !== day.iso)
                              : [...row.weekdays, day.iso],
                          })
                        }
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[0.6875rem]",
                          on
                            ? "border-[var(--os-ink,#1d1d1f)] bg-[var(--os-ink,#1d1d1f)] text-white"
                            : "hover:bg-[var(--os-soft-2,#f3f3f5)]",
                        )}
                      >
                        {day.label}
                      </button>
                    )
                  })}
                </div>
              </Labelled>

              <Labelled
                label="Budget"
                hint="A brake, not a gate — an offline till cannot know what other shops spent this morning"
              >
                <Input
                  inputMode="numeric"
                  value={row.budget}
                  onChange={(event) => edit(row.key, { budget: event.target.value })}
                  placeholder="unlimited"
                  className="font-mono text-[0.75rem]"
                />
              </Labelled>

              {campaigns.length > 0 && (
                <Labelled label="Part of campaign" hint="Its window and budget bind here too">
                  <Select
                    value={row.campaign_id}
                    onValueChange={(value) =>
                      edit(row.key, { campaign_id: value === NONE ? "" : String(value) })
                    }
                  >
                    <SelectTrigger className="w-56">
                      <SelectValue>
                        {campaigns.find((c) => c.campaign_id === row.campaign_id)?.name ??
                          "On its own"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>On its own</SelectItem>
                      {campaigns
                        .filter((campaign) => campaign.campaign_id.trim() !== "")
                        .map((campaign) => (
                          <SelectItem key={campaign.key} value={campaign.campaign_id}>
                            {campaign.name === "" ? campaign.campaign_id : campaign.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Labelled>
              )}

              <Labelled
                label="Stacking"
                hint="Exclusive wins alone; two stacked 10% promotions come to 20%, not 19%"
              >
                <Select
                  value={row.stacking}
                  onValueChange={(value) =>
                    edit(row.key, { stacking: value as PromotionDraft["stacking"] })
                  }
                >
                  <SelectTrigger className="w-40">
                    <SelectValue>
                      {row.stacking === "STACKABLE" ? "Stacks with others" : "On its own"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STACKABLE">Stacks with others</SelectItem>
                    <SelectItem value="EXCLUSIVE">On its own</SelectItem>
                  </SelectContent>
                </Select>
              </Labelled>
            </div>

            {problems.length > 0 && (
              <p className="text-muted-foreground border-t px-2.5 py-1.5 text-[0.6875rem]">
                Not saved yet: {problems.join(" ")}
              </p>
            )}
          </div>
        )
      })}
      <Button size="sm" variant="outline" className="justify-self-start" onClick={add}>
        <Plus className="size-3.5" />
        Add another promotion
      </Button>
    </div>
  )
}

/// The value a Select uses for "none", because an empty string is not a legal
/// item value and a select with one is a select that will not open.
const NONE = "__none__"

const MATCH_LABELS: Record<PromotionDraft["matches"], string> = {
  SKU: "These products",
  ARTICLE: "These styles",
  DIVISION: "A division",
  TAG: "A tag",
  WHOLE_CART: "The whole basket",
}

const MATCH_PLACEHOLDERS: Record<PromotionDraft["matches"], string> = {
  SKU: "KEM001, KEM002",
  ARTICLE: "KEMEJA-PUTIH",
  DIVISION: "PRIA",
  TAG: "LEBARAN",
  WHOLE_CART: "",
}

const EFFECT_LABELS: Record<PromotionDraft["effect"], string> = {
  PERCENT: "A percentage",
  AMOUNT: "A flat amount",
  FIXED_UNIT_PRICE: "A fixed price",
  EARN_POINTS: "Loyalty points",
}

const POINT_LABELS: Record<PromotionDraft["pointsMode"], string> = {
  SPEND_RATE: "Per spend",
  FIXED_POINTS: "Flat bonus",
  POINTS_PER_QUANTITY: "Per unit",
}

function Coupons({
  rows,
  promotions: drafts,
  onChange,
}: {
  rows: readonly CouponDraft[]
  promotions: readonly PromotionDraft[]
  onChange: (rows: CouponDraft[]) => void
}) {
  // Only the ones that would actually be saved. A coupon attached to a
  // half-written promotion is refused by the server for the whole book, naming
  // a rule the author cannot see on this screen.
  const promotions = drafts.filter((draft) => promotionProblems(draft).length === 0)
  const add = () =>
    onChange([
      ...rows,
      {
        key: crypto.randomUUID(),
        code: "",
        rule_id: promotions[0]?.rule_id ?? "",
        active: true,
        maxUses: "",
        from: "",
        to: "",
      },
    ])
  const edit = (key: string, patch: Partial<CouponDraft>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  if (promotions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-muted-foreground mx-auto max-w-lg text-[0.75rem]">
          A coupon is a gate on a promotion and never a discount of its own —
          keeping it that way means there is exactly one place a benefit is
          calculated, so a code cannot disagree with the offer it opens.
          {drafts.length === 0
            ? " Write a promotion first."
            : " Finish a promotion first: a coupon can only open one this book actually publishes."}
        </p>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <Nothing onAdd={add} add="Issue a code">
        A code that unlocks one of the promotions in this book. Until a shopper
        produces it the promotion stays shut, and a code typed and refused is
        never counted as redeemed.
      </Nothing>
    )
  }

  return (
    <div className="grid gap-2">
      {rows.map((row) => (
        <Row key={row.key} onRemove={() => onChange(rows.filter((r) => r.key !== row.key))}>
          <Labelled label="Code">
            <Input
              value={row.code}
              onChange={(event) => edit(row.key, { code: event.target.value.toUpperCase() })}
              placeholder="LEBARAN2026"
              className="font-mono text-[0.75rem]"
            />
          </Labelled>
          <Labelled label="Unlocks">
            <Select
              value={row.rule_id}
              onValueChange={(value) => edit(row.key, { rule_id: String(value) })}
            >
              <SelectTrigger className="w-56">
                <SelectValue>
                  {promotions.find((rule) => rule.rule_id === row.rule_id)?.name ??
                    "Choose a promotion"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {promotions.map((rule) => (
                  <SelectItem key={rule.rule_id} value={rule.rule_id}>
                    {rule.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labelled>
          <Labelled label="Times it may be used" hint="Blank is unlimited">
            <Input
              inputMode="numeric"
              value={row.maxUses}
              onChange={(event) => edit(row.key, { maxUses: event.target.value })}
              placeholder="unlimited"
              className="w-32 font-mono text-[0.75rem]"
            />
          </Labelled>
          <Labelled label="Until" hint="Blank never expires">
            <Input
              type="datetime-local"
              value={row.to}
              onChange={(event) => edit(row.key, { to: event.target.value })}
              className="w-48 text-[0.75rem]"
            />
          </Labelled>
        </Row>
      ))}
      <Button size="sm" variant="outline" className="justify-self-start" onClick={add}>
        <Plus className="size-3.5" />
        Issue another code
      </Button>
    </div>
  )
}

function Campaigns({
  rows,
  onChange,
}: {
  rows: readonly CampaignDraft[]
  onChange: (rows: CampaignDraft[]) => void
}) {
  const add = () =>
    onChange([
      ...rows,
      {
        key: crypto.randomUUID(),
        campaign_id: "",
        name: "",
        status: "ACTIVE",
        from: "",
        to: "",
        budget: "",
        maxUses: "",
      },
    ])
  const edit = (key: string, patch: Partial<CampaignDraft>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  if (rows.length === 0) {
    return (
      <Nothing onAdd={add} add="Start a campaign">
        The envelope several promotions share: one window, one budget, one
        switch. A shop refuses a promotion whose campaign it does not hold, so a
        campaign has to travel with the offers that name it.
      </Nothing>
    )
  }

  return (
    <div className="grid gap-2">
      {rows.map((row) => (
        <Row key={row.key} onRemove={() => onChange(rows.filter((r) => r.key !== row.key))}>
          <Labelled label="Campaign">
            <div className="flex gap-1.5">
              <Input
                value={row.campaign_id}
                onChange={(event) =>
                  edit(row.key, { campaign_id: event.target.value.toUpperCase() })
                }
                placeholder="LEBARAN26"
                className="w-36 font-mono text-[0.75rem]"
              />
              <Input
                value={row.name}
                onChange={(event) => edit(row.key, { name: event.target.value })}
                placeholder="Lebaran 2026"
                className="flex-1 text-[0.75rem]"
              />
            </div>
          </Labelled>
          <Labelled
            label="Budget"
            hint="Shared across every promotion in it"
          >
            <Input
              inputMode="numeric"
              value={row.budget}
              onChange={(event) => edit(row.key, { budget: event.target.value })}
              placeholder="unlimited"
              className="w-36 font-mono text-[0.75rem]"
            />
          </Labelled>
          <div className="flex gap-2">
            <Labelled label="From">
              <Input
                type="datetime-local"
                value={row.from}
                onChange={(event) => edit(row.key, { from: event.target.value })}
                className="w-48 text-[0.75rem]"
              />
            </Labelled>
            <Labelled label="Until">
              <Input
                type="datetime-local"
                value={row.to}
                onChange={(event) => edit(row.key, { to: event.target.value })}
                className="w-48 text-[0.75rem]"
              />
            </Labelled>
          </div>
        </Row>
      ))}
      <Button size="sm" variant="outline" className="justify-self-start" onClick={add}>
        <Plus className="size-3.5" />
        Start another
      </Button>
    </div>
  )
}
