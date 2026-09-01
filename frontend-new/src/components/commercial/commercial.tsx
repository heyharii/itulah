import { Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import { IconButton, Switch } from "@/components/dashboard/nav-sidebar"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import { AppHeading } from "@/components/app-switcher"
import { Catalog } from "@/components/commercial/catalog"
import {
  Campaigns,
  Codes,
  Pricing,
  Returns,
} from "@/components/commercial/screens"
import { useCommercialResource } from "@/components/commercial/api"
import {
  buildCommercialModel,
  CASCADE,
  LEVEL_LABEL,
  MECHANIC_LABEL,
  rupiah,
  ruleMechanic,
  ANY_MEMBER,
  type CatalogueArticle,
  type Channel,
  type CommercialModel,
  type PriceContext,
  type Tier,
} from "@/components/commercial/model"
import {
  cue,
  readSoundPreference,
  useInteractionSounds,
  writeSoundPreference,
} from "@/components/dashboard/use-interaction-sounds"
import { shortDate } from "@/lib/day"
import { cn } from "@/lib/utils"
import { PreviewNotice } from "@/components/backend-status"
import { Route } from "@/routes/commercial"
import {
  AppShell,
  AppShellSidebar,
  SidebarTrigger,
} from "@/components/app-shell"

type Tab = "catalog" | "pricing" | "campaigns" | "codes" | "returns"

const TITLE: Record<Tab, string> = {
  catalog: "Catalogue",
  pricing: "Pricing",
  campaigns: "Campaigns",
  codes: "Vouchers and coupons",
  returns: "Return policies",
}

const HINT: Record<Tab, string> = {
  catalog: "Every article at the price it would ring up at",
  pricing: "The cascade, and what each level says",
  campaigns: "Windows, budgets and the rules inside them",
  codes: "Codes that unlock a rule, and value a customer holds",
  returns: "What can come back, and as what",
}

export function Commercial() {
  const commercialResource = useCommercialResource()
  const model = useMemo(
    () => buildCommercialModel(commercialResource.data),
    [commercialResource.data]
  )
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { tab, query = "", store, channel, tier = "" } = search

  /* The context every price on screen is resolved for. It is three scalars in
   * the URL and one object here, so a link carries the whole context. */
  const ctx: PriceContext = useMemo(
    () => ({ storeId: store, channel, tier }),
    [store, channel, tier]
  )
  const setCtx = (next: Partial<PriceContext>) =>
    void navigate({
      search: (prev) => ({
        ...prev,
        store: (next.storeId ?? ctx.storeId) || undefined,
        channel: next.channel ?? ctx.channel,
        tier: (next.tier ?? ctx.tier) || undefined,
      }),
      replace: true,
    })

  /* the sheet shows an id; the article behind it is whatever the model holds */
  const open = search.open
    ? (model.articles.find((article) => article.id === search.open) ?? null)
    : null
  const closeSheet = () =>
    void navigate({
      search: (prev) => ({ ...prev, open: undefined }),
      replace: true,
    })

  const [railHidden, setRailHidden] = useState(false)
  const [soundOn, setSoundOn] = useState(readSoundPreference)

  useInteractionSounds(soundOn)

  const navRow =
    "flex h-8 w-full items-center gap-2.5 rounded-control px-2 text-left text-[13px] font-medium transition-colors duration-[110ms]"

  const live =
    commercialResource.data?.campaigns.filter((c) => c.status === "active")
      .length ?? 0
  const codeCount = commercialResource.data
    ? commercialResource.data.coupons.length +
      commercialResource.data.vouchers.length
    : 0
  const priceRows =
    commercialResource.data?.priceLists.reduce(
      (total, list) => total + list.entries.length,
      0
    ) ?? 0

  return (
    <AppShell
      label="Commercial navigation"
      railWidth={240}
      cols={
        railHidden
          ? "grid-cols-[0px_minmax(0,1fr)]"
          : "grid-cols-[240px_minmax(0,1fr)]"
      }
    >
      <AppShellSidebar className={cn(railHidden && "invisible")}>
        <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-page">
          <div className="flex h-[52px] shrink-0 items-center gap-1.5 pr-2 pl-2.5">
            <AppHeading app="commercial" />
            <IconButton
              label="Collapse sidebar"
              onClick={() => setRailHidden((v) => !v)}
            >
              <Icon path={paths.panel} size={17} />
            </IconButton>
          </div>

          <nav className="flex-1 overflow-auto px-2 pt-0.5 pb-2">
            {(
              [
                ["catalog", "Catalogue", paths.grid, model.articles.length],
                ["pricing", "Pricing", paths.table, priceRows],
                ["campaigns", "Campaigns", paths.star, live],
                ["codes", "Vouchers", paths.tag, codeCount],
                [
                  "returns",
                  "Returns",
                  paths.reply,
                  commercialResource.data?.returnPolicies.length ?? 0,
                ],
              ] as const
            ).map(([id, label, icon, count]) => {
              const on = tab === id
              return (
                <Link
                  key={id}
                  from="/commercial"
                  to="/commercial"
                  search={(prev) => ({ ...prev, tab: id })}
                  replace
                  data-sound="page"
                  className={cn(
                    navRow,
                    "group/nav relative text-ink-2 hover:bg-hover hover:text-ink",
                    on && "font-semibold text-ink",
                    on &&
                      "before:absolute before:top-2 before:bottom-2 before:-left-2 before:w-[2.5px] before:rounded-r-full before:bg-ink before:content-['']"
                  )}
                >
                  <Icon
                    path={icon}
                    className={cn(
                      "shrink-0 text-ink-4 group-hover/nav:text-ink-2",
                      on && "text-ink-2"
                    )}
                  />
                  {label}
                  {count > 0 && (
                    <span className="ml-auto font-mono text-[10.5px] text-ink-4">
                      {count}
                    </span>
                  )}
                </Link>
              )
            })}

            {/* the context every price on screen is resolved for */}
            <div className="mt-3.5 flex h-7 items-center px-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
              Pricing context
            </div>
            <div className="grid gap-1.5 px-2">
              <label className="block">
                <span className="block pb-1 text-[10.5px] text-ink-4">
                  Store
                </span>
                <select
                  value={ctx.storeId ?? ""}
                  onChange={(e) => setCtx({ storeId: e.target.value })}
                  className="h-[30px] w-full rounded-control bg-surface px-2 text-xs text-ink shadow-btn outline-none focus:shadow-[inset_0_0_0_1px_var(--accent)]"
                >
                  <option value="">All stores</option>
                  {model.stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="block pb-1 text-[10.5px] text-ink-4">
                  Channel
                </span>
                <select
                  value={ctx.channel}
                  onChange={(e) =>
                    setCtx({ channel: e.target.value as Channel })
                  }
                  className="h-[30px] w-full rounded-control bg-surface px-2 text-xs text-ink shadow-btn outline-none focus:shadow-[inset_0_0_0_1px_var(--accent)]"
                >
                  <option value="pos">In store</option>
                  <option value="online">Online</option>
                </select>
              </label>

              <label className="block">
                <span className="block pb-1 text-[10.5px] text-ink-4">
                  Customer
                </span>
                <select
                  value={ctx.tier}
                  onChange={(e) => setCtx({ tier: e.target.value as Tier })}
                  className="h-[30px] w-full rounded-control bg-surface px-2 text-xs text-ink shadow-btn outline-none focus:shadow-[inset_0_0_0_1px_var(--accent)]"
                >
                  <option value="">Walk-in</option>
                  {/* A rule scoped to `member` matches any member; one scoped
                      to `tiers` needs a named tier, and this hub's loyalty
                      programme has none configured. */}
                  <option value={ANY_MEMBER}>Any member</option>
                  {model.tiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </nav>

          <div className="shrink-0 p-2">
            <button
              type="button"
              role="switch"
              aria-checked={soundOn}
              data-sound-silent
              onClick={() => {
                const next = !soundOn
                setSoundOn(next)
                writeSoundPreference(next)
                if (next) cue("toggle")
              }}
              className="flex h-[34px] w-full items-center gap-[9px] rounded-control px-2 text-xs font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              <Icon
                path={paths.sound}
                size={16}
                className="shrink-0 text-ink-4"
              />
              Interaction sounds
              <Switch on={soundOn} className="ml-auto" />
            </button>
          </div>
        </aside>
      </AppShellSidebar>

      <main className="flex h-full min-h-0 flex-col overflow-hidden p-2 pl-0 max-lg:pl-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-window bg-surface shadow-card">
          <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3.5">
            <SidebarTrigger className="-ml-1" />
            <span className="text-sm font-semibold text-ink">{TITLE[tab]}</span>
            <span className="ml-2 truncate text-[11.5px] text-ink-3">
              {HINT[tab]}
            </span>

            {(tab === "catalog" || tab === "pricing") && (
              <span className="relative ml-auto">
                <Icon
                  path={paths.search}
                  size={14}
                  width={1.9}
                  className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-4"
                />
                <input
                  value={query}
                  onChange={(e) =>
                    void navigate({
                      search: (prev) => ({
                        ...prev,
                        query: e.target.value || undefined,
                      }),
                      replace: true,
                    })
                  }
                  placeholder="Article or number"
                  className="h-[32px] w-[220px] rounded-control bg-field pr-2.5 pl-8 text-xs text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none placeholder:text-ink-4 focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
                />
              </span>
            )}
          </header>

          <div className="min-h-0 flex-1 overflow-auto">
            <PreviewNotice>
              Every tab reads the cloud hub directly. Prices, markdowns,
              promotions, campaigns and vouchers come from `/v1/commercial/*`;
              the rules, coupons and store groups come from
              `/v1/pricing-engine/*`, which is the same engine the tills run;
              the catalogue, stores and divisions come from `/v1/masterdata/*`.
              Pricing, Campaigns and Vouchers also author back: price lists and
              their entries, markdowns, pricing rules, campaigns and coupons are
              created, edited and retired here, and vouchers are issued,
              extended and voided. Every update re-reads its row first, because
              the hub's PUT replaces the whole object; there is no ETag and no
              delete anywhere in that contract, so retiring is a status or an
              active flag. Two things the engine supports have no source on this
              deployment and are shown as absent rather than filled in: the
              store, store-group and member-tier levels of the price cascade,
              and the article master the catalogue would otherwise group SKUs
              by.
            </PreviewNotice>
            {tab === "catalog" && (
              <Catalog
                ctx={ctx}
                query={query}
                model={model}
                onOpen={(article) =>
                  void navigate({
                    search: (prev) => ({ ...prev, open: article.id }),
                  })
                }
                resource={commercialResource}
              />
            )}
            {tab === "pricing" && (
              <Pricing ctx={ctx} query={query} resource={commercialResource} />
            )}
            {tab === "campaigns" && <Campaigns resource={commercialResource} />}
            {tab === "codes" && <Codes resource={commercialResource} />}
            {tab === "returns" && <Returns resource={commercialResource} />}
          </div>
        </div>
      </main>

      <SheetShell
        open={Boolean(open)}
        size="wide"
        eyebrow={
          open
            ? open.pricedOnly
              ? "Priced article"
              : open.division || "Article"
            : "Article"
        }
        title={open?.name ?? ""}
        onRequestClose={closeSheet}
        footer={
          <>
            <span className="flex-1" />
            <button
              type="button"
              onClick={closeSheet}
              className={sheetButton.secondary}
            >
              Close
            </button>
          </>
        }
      >
        {open && <ArticleDetail article={open} ctx={ctx} model={model} />}
      </SheetShell>
    </AppShell>
  )
}

/** One article, priced for the context currently selected. */
function ArticleDetail({
  article,
  ctx,
  model,
}: {
  article: CatalogueArticle
  ctx: PriceContext
  model: CommercialModel
}) {
  const resolved = model.resolvePrice(article, ctx)
  const offers = model.offersFor(article, ctx)
  const entries = model.entriesFor(article)
  const store = model.stores.find((s) => s.id === ctx.storeId)

  return (
    <div className="px-4 py-4">
      <div className="flex gap-3 pb-4">
        {/* The item master carries a default image url, but this deployment
            has set none, so the row shows its identity instead. */}
        <span className="grid size-[92px] shrink-0 place-items-center rounded-panel bg-inset font-mono text-[11px] text-ink-4">
          {article.code}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] text-ink-4">{article.id}</div>
          <div className="flex items-baseline gap-2 pt-1">
            <span className="font-mono text-[22px] font-medium tracking-[-0.02em] text-ink">
              {resolved.price === undefined
                ? "No price"
                : rupiah(resolved.price)}
            </span>
            {resolved.wasPrice !== undefined &&
              resolved.wasPrice !== resolved.price && (
                <span className="font-mono text-[13px] text-ink-4 line-through">
                  {rupiah(resolved.wasPrice)}
                </span>
              )}
          </div>
          <div className="pt-1 text-[11.5px] text-ink-3">
            {resolved.source === "markdown"
              ? "Markdown price, replacing the cascade"
              : resolved.source === "base"
                ? "Base price — no list covers this context"
                : resolved.source === "none"
                  ? "No price list and no base price cover this context"
                  : LEVEL_LABEL[resolved.source]}
            {" · "}
            {store?.name ?? "all stores"} ·{" "}
            {ctx.channel === "pos" ? "in store" : "online"} ·{" "}
            {ctx.tier || "walk-in"}
          </div>
          <div className="flex flex-wrap gap-1 pt-2">
            {article.skus.map((sku) => (
              <span
                key={sku}
                className="inline-flex h-[19px] items-center rounded-[6px] bg-inset px-1.5 font-mono text-[10.5px] text-ink-3"
              >
                {sku}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* the cascade, and which step of it won */}
      <div className="pb-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
        How the price resolved
      </div>
      <ol className="overflow-hidden rounded-panel border border-line-strong">
        {CASCADE.map((level) => {
          /* Only the global level has a source on this hub: every price entry
           * it holds is stamped `LevelGlobalDefault` by the snapshot builder,
           * because the price-list table has no narrower scope to read. */
          const row =
            level === "global"
              ? entries.find((candidate) => candidate.level === level)
              : undefined
          const won = resolved.source === level
          const beaten = resolved.source === "markdown" && Boolean(row) && !won

          return (
            <li
              key={level}
              className={cn(
                "flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0",
                won && "bg-accent-tint"
              )}
            >
              <span
                className={cn(
                  "grid size-[18px] shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                  won ? "bg-accent text-white" : "bg-inset text-ink-4"
                )}
              >
                {won ? "✓" : ""}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-ink-2">
                {LEVEL_LABEL[level]}
                {level !== "global" && (
                  <span className="pl-1.5 text-[10.5px] text-ink-4">
                    the engine reads this level; the hub authors nothing into it
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "shrink-0 font-mono text-[11.5px] tabular-nums",
                  row ? (won ? "text-accent-ink" : "text-ink-3") : "text-ink-4",
                  beaten && "line-through"
                )}
              >
                {row ? rupiah(row.entry.price) : "not set"}
              </span>
            </li>
          )
        })}
        {resolved.markdown && (
          <li className="flex items-center gap-2.5 border-t border-line-strong bg-red-tint px-3 py-2">
            <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-ember text-[10px] font-semibold text-white">
              ✓
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-red">
              Markdown replaces it
              {resolved.markdown.endsOn
                ? ` until ${shortDate(resolved.markdown.endsOn)}`
                : ""}
            </span>
            <span className="shrink-0 font-mono text-[11.5px] text-red tabular-nums">
              {rupiah(resolved.markdown.markdownPrice)}
            </span>
          </li>
        )}
      </ol>

      <div className="grid gap-3 pt-4 sm:grid-cols-2">
        <section>
          <div className="pb-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
            Offers on top
          </div>
          {offers.length === 0 ? (
            <p className="rounded-panel bg-inset py-6 text-center text-xs text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]">
              No live offer touches this article here.
            </p>
          ) : (
            <ul className="overflow-hidden rounded-panel border border-line-strong">
              {offers.map((offer) => (
                <li
                  key={offer.id}
                  className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-b-0"
                >
                  <span className="inline-flex h-[19px] shrink-0 items-center rounded-[6px] bg-accent-tint px-1.5 text-[10.5px] font-medium text-accent-ink">
                    {MECHANIC_LABEL[ruleMechanic(offer)]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-ink">
                      {offer.name}
                    </span>
                    <span className="block truncate text-[10px] text-ink-4">
                      {model.campaignById(offer.campaignId)?.name ??
                        "In no campaign"}
                    </span>
                  </span>
                  {model.couponedRuleIds.has(offer.id) && (
                    <span className="shrink-0 text-[10px] font-medium text-honey">
                      code
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="pt-1.5 text-[10.5px] leading-[1.5] text-ink-4">
            Offers are applied at the till, after the price above — they are
            never folded into it.
          </p>
        </section>

        <section>
          <div className="pb-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
            If it comes back
          </div>
          <div className="rounded-panel border border-line-strong px-3 py-2.5">
            <div className="text-[12.5px] font-semibold text-ink">
              No return policy to apply
            </div>
            <div className="text-[11px] leading-[1.5] text-ink-4">
              The hub's return-policy collection is empty, so no policy resolves
              for this article and nothing is assumed in its place. Author one
              and the same specificity-first selector the till uses will name it
              here.
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
