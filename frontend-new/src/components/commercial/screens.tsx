import { Link } from "@tanstack/react-router"
import {
  columnFilteringFeature,
  createFilteredRowModel,
  filterFn_equalsString,
  filterFn_includesString,
  globalFilteringFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { Icon, paths } from "@/components/dashboard/parts"
import {
  CampaignDetailSheet,
  CampaignSheet,
  CouponSheet,
  MarkdownSheet,
  PriceEntrySheet,
  PriceListSheet,
  PricingRuleSheet,
  VoucherSheet,
  type CampaignSheetTarget,
  type CouponSheetTarget,
  type EntrySheetTarget,
  type ListSheetTarget,
  type MarkdownSheetTarget,
  type RuleSheetTarget,
  type VoucherSheetTarget,
} from "@/components/commercial/forms"
import { rupiah, type PriceContext } from "@/components/commercial/model"
import {
  type CommercialCampaign,
  type CommercialPricingRule,
  type CommercialResource,
  type CommercialPromotion,
} from "@/components/commercial/api"
import { shortDate } from "@/lib/day"
import { type ApiResource } from "@/lib/api"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"
import { Route } from "@/routes/commercial"

/* Both tables below hand their row model to TanStack Table and read its state
 * out of the URL: the pricing search box is a global filter, the code list's
 * all/coupon/voucher switch is a column filter. */
const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: {
    includesString: filterFn_includesString,
    equalsString: filterFn_equalsString,
  },
})

export type CommercialResourceState = Pick<
  ApiResource<CommercialResource>,
  "status" | "data" | "errorMessage" | "reload" | "isRefreshing"
>

export function ResourceState({
  resource,
  label,
}: {
  resource: CommercialResourceState
  label: string
}) {
  if (resource.status === "loading" && !resource.data) {
    return (
      <div className="flex h-[240px] items-center justify-center text-xs text-ink-4">
        Loading {label} from the hub…
      </div>
    )
  }
  if (resource.status === "error" && !resource.data) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="max-w-[460px] text-xs text-ember">
          {resource.errorMessage ?? `The hub's ${label} could not be loaded.`}
        </p>
        <button
          type="button"
          onClick={resource.reload}
          className="rounded-control bg-hover px-2.5 py-1.5 text-xs font-medium text-ink"
        >
          Retry
        </button>
      </div>
    )
  }
  if (!resource.data) {
    return (
      <div className="flex h-[240px] items-center justify-center text-xs text-ink-4">
        The hub's {label} is not available.
      </div>
    )
  }
  return null
}

/** The one affordance that opens an authoring sheet. */
function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-[26px] shrink-0 items-center gap-1 rounded-control bg-surface px-2 text-[11.5px] font-medium text-ink shadow-btn transition-colors duration-[120ms] hover:bg-hover"
    >
      <Icon path={paths.plus} size={12} width={2.4} />
      {label}
    </button>
  )
}

/** A section heading with the actions that author into that section. */
function SectionHead({
  title,
  actions,
  className,
}: {
  title: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-center gap-2 pb-2", className)}>
      <h2 className="text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
        {title}
      </h2>
      <span className="flex-1" />
      {actions}
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="px-3.5 py-12 text-center text-xs text-ink-4">
      No {label} returned by the hub.
    </div>
  )
}

function dateWindow(start?: string, end?: string): string {
  if (!start && !end) return "Always"
  return `${start ? shortDate(start) : "Open"} – ${end ? shortDate(end) : "Open"}`
}

function statusHue(status: string): string {
  switch (status) {
    case "active":
      return "var(--grass)"
    case "scheduled":
      return "var(--sky)"
    case "draft":
      return "var(--honey)"
    default:
      return "var(--ink-4)"
  }
}

function Status({ value }: { value: string }) {
  const hue = statusHue(value)
  return (
    <span
      style={{ color: hue }}
      className="flex items-center gap-1.5 text-[11px] font-medium capitalize"
    >
      <span style={{ background: hue }} className="size-1.5 rounded-full" />
      {value.replaceAll("_", " ")}
    </span>
  )
}

/* ── pricing: the hub's price lists, markdowns and rules ─────── */

/**
 * The three layers of the price, in the order the engine runs them: the
 * price-list cascade settles a price, a markdown replaces it, and the rules
 * then run on top. Each section authors exactly one of them.
 */
interface PriceRow {
  list: CommercialResource["priceLists"][number]
  entry: CommercialResource["priceLists"][number]["entries"][number] | undefined
  scope: string
  applies: boolean
}

const PRICE_LIST_COLUMNS = "minmax(0,1fr) 150px 132px 150px 164px 108px"

/* This table never had a <colgroup> — table-fixed with no column or
 * first-row width falls back to five equal columns, which this reproduces
 * directly rather than guessing at widths nobody specified. */
const MARKDOWN_COLUMNS = "minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)"

/** One accessor column: everything the pricing search box matches on. */
const PRICE_COLUMNS = [
  {
    id: "search",
    accessorFn: (row: PriceRow) =>
      [row.list.name, row.list.id, row.entry?.sku, row.entry?.articleId]
        .filter(Boolean)
        .join(" "),
  },
]

export function Pricing({
  ctx,
  query,
  resource,
}: {
  ctx: PriceContext
  query: string
  resource: CommercialResourceState
}) {
  const [listSheet, setListSheet] = useState<ListSheetTarget | null>(null)
  const [entrySheet, setEntrySheet] = useState<EntrySheetTarget | null>(null)
  const [markdownSheet, setMarkdownSheet] =
    useState<MarkdownSheetTarget | null>(null)
  const [ruleSheet, setRuleSheet] = useState<RuleSheetTarget | null>(null)

  const priceRows = useMemo(() => {
    const data = resource.data
    if (!data) return []
    return data.priceLists.flatMap((list) => {
      /* Every list on this hub feeds the global level — the price-list row
       * has no store, group or tier column for anything narrower. */
      const scope = list.isDefault ? "Global default" : "Global"
      const applies = list.active
      const entries = list.entries.length ? list.entries : [undefined]
      return entries.map((entry) => ({ list, entry, scope, applies }))
    })
  }, [ctx.storeId, resource.data])

  const table = useTable({
    features,
    data: priceRows,
    columns: PRICE_COLUMNS,
    getRowId: (row) => `${row.list.id}:${row.entry?.id ?? "empty"}`,
    globalFilterFn: "includesString",
    state: { globalFilter: query.trim() },
  })
  const rows = table.getRowModel().rows.map((row) => row.original)

  if (!resource.data)
    return <ResourceState resource={resource} label="pricing" />
  const { data } = resource

  return (
    <div className="p-3.5">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <p className="text-[11px] leading-[1.5] text-ink-4">
          Live price-list rows from the hub, exactly as authored. The engine
          reads four cascade levels — store, store group, member tier, global —
          but the cloud price-list table has no column for the first three, so
          every row here feeds the global level and competes on priority. A
          markdown, which does carry a store scope, is how a per-store price is
          expressed on this deployment.
        </p>
        {resource.isRefreshing && (
          <span className="shrink-0 text-[10px] text-ink-4">Refreshing…</span>
        )}
      </div>

      <SectionHead
        title={`Price lists · ${rows.length} rows`}
        actions={
          <>
            <AddButton
              label="New price list"
              onClick={() => setListSheet({ mode: "create" })}
            />
            <AddButton
              label="New price"
              onClick={() => setEntrySheet({ mode: "create" })}
            />
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState label="price-list rows" />
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line-strong">
          <VirtualRows
            rows={rows}
            rowKey={({ list, entry }) => `${list.id}:${entry?.id ?? "empty"}`}
            columns={PRICE_LIST_COLUMNS}
            rowHeight={48}
            className="min-w-[900px]"
            onRowClick={({ list, entry }) =>
              entry
                ? setEntrySheet({
                    mode: "edit",
                    listId: list.id,
                    entryId: entry.id,
                  })
                : setListSheet({ mode: "edit", id: list.id })
            }
            header={
              <>
                <span className="pl-3.5">Price list</span>
                <span>Scope</span>
                <span>SKU</span>
                <span className="text-right">Price</span>
                <span>Window</span>
                <span>Status</span>
              </>
            }
            renderRow={({ list, entry, scope, applies }) => (
              <>
                <span role="gridcell" className="pr-3 pl-3.5">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      setListSheet({ mode: "edit", id: list.id })
                    }}
                    className="block w-full text-left"
                  >
                    <span className="block truncate text-xs font-medium text-ink underline decoration-transparent underline-offset-[3px] transition-colors hover:decoration-ink-4">
                      {list.name}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-ink-4">
                      {list.id}
                    </span>
                  </button>
                </span>
                <span role="gridcell" className="px-3 text-[11px]">
                  <span className={applies ? "text-accent-ink" : "text-ink-4"}>
                    {scope}
                  </span>
                  {applies && (
                    <span className="ml-1 text-[10px] text-ink-4">
                      · applies
                    </span>
                  )}
                </span>
                <span role="gridcell" className="px-3 font-mono text-[11px] text-ink-2">
                  {entry?.sku ?? "No entries"}
                </span>
                <span role="gridcell" className="px-3 text-right font-mono text-xs tabular-nums">
                  {entry ? rupiah(entry.price) : "—"}
                </span>
                <span role="gridcell" className="px-3 font-mono text-[10.5px] text-ink-3">
                  {dateWindow(entry?.startsOn, entry?.endsOn)}
                </span>
                <span role="gridcell" className="pr-3.5 pl-3">
                  <Status
                    value={
                      list.active && (entry?.active ?? true)
                        ? "active"
                        : "inactive"
                    }
                  />
                </span>
              </>
            )}
          />
        </div>
      )}

      <SectionHead
        className="pt-5"
        title={`Markdown prices · ${data.markdowns.length}`}
        actions={
          <AddButton
            label="New markdown"
            onClick={() => setMarkdownSheet({ mode: "create" })}
          />
        }
      />
      {data.markdowns.length === 0 ? (
        <EmptyState label="markdowns" />
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line-strong">
          <VirtualRows
            rows={data.markdowns}
            rowKey={(markdown) => markdown.id}
            columns={MARKDOWN_COLUMNS}
            rowHeight={46}
            className="min-w-[760px]"
            onRowClick={(markdown) =>
              setMarkdownSheet({ mode: "edit", id: markdown.id })
            }
            header={
              <>
                <span className="pl-3.5">Markdown</span>
                <span>SKU</span>
                <span className="text-right">Price</span>
                <span>Window</span>
                <span>Status</span>
              </>
            }
            renderRow={(markdown) => (
              <>
                <span role="gridcell" className="pr-3 pl-3.5">
                  <span className="block truncate text-xs font-medium text-ink">
                    {markdown.name}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-ink-4">
                    {markdown.id}
                  </span>
                </span>
                <span role="gridcell" className="px-3 font-mono text-[11px] text-ink-2">
                  {markdown.sku}
                </span>
                <span role="gridcell" className="px-3 text-right font-mono text-xs tabular-nums">
                  <span className="text-ember">
                    {rupiah(markdown.markdownPrice)}
                  </span>
                  <span className="ml-1 text-[10px] text-ink-4 line-through">
                    {rupiah(markdown.originalPrice)}
                  </span>
                </span>
                <span role="gridcell" className="px-3 font-mono text-[10.5px] text-ink-3">
                  {dateWindow(markdown.startsOn, markdown.endsOn)}
                </span>
                <span role="gridcell" className="pr-3.5 pl-3">
                  <Status value={markdown.status} />
                </span>
              </>
            )}
          />
        </div>
      )}

      <SectionHead
        className="pt-5"
        title={`Pricing rules · ${data.pricingRules.length}`}
        actions={
          <AddButton
            label="New rule"
            onClick={() => setRuleSheet({ mode: "create" })}
          />
        }
      />
      <PricingRules
        rules={data.pricingRules}
        onOpen={(id) => setRuleSheet({ mode: "edit", id })}
      />

      <PriceListSheet
        target={listSheet}
        resource={resource}
        onClose={() => setListSheet(null)}
      />
      <PriceEntrySheet
        target={entrySheet}
        resource={resource}
        onClose={() => setEntrySheet(null)}
      />
      <MarkdownSheet
        target={markdownSheet}
        resource={resource}
        onClose={() => setMarkdownSheet(null)}
      />
      <PricingRuleSheet
        target={ruleSheet}
        resource={resource}
        onClose={() => setRuleSheet(null)}
      />
    </div>
  )
}

/* No <colgroup> here either — table-fixed with only the first cell's
 * `w-[30%]` set falls back to splitting the rest evenly across the other
 * four columns (17.5% apiece), which this states directly. */
const PRICING_RULE_COLUMNS = "30% 17.5% 17.5% 17.5% 17.5%"

function PricingRules({
  rules,
  onOpen,
}: {
  rules: CommercialPricingRule[]
  onOpen: (id: string) => void
}) {
  if (!rules.length) return <EmptyState label="pricing rules" />
  return (
    <div className="overflow-x-auto rounded-panel border border-line-strong">
      <VirtualRows
        rows={rules}
        rowKey={(pricingRule) => pricingRule.id}
        columns={PRICING_RULE_COLUMNS}
        rowHeight={46}
        className="min-w-[760px]"
        onRowClick={(pricingRule) => onOpen(pricingRule.id)}
        header={
          <>
            <span className="pl-3.5">Rule</span>
            <span>Applies on</span>
            <span>Effect</span>
            <span>Window</span>
            <span>Status</span>
          </>
        }
        renderRow={(pricingRule) => (
          <>
            <span role="gridcell" className="pr-3 pl-3.5">
              <span className="block truncate text-xs font-medium text-ink">
                {pricingRule.name}
              </span>
              <span className="block truncate font-mono text-[10px] text-ink-4">
                {pricingRule.id}
              </span>
            </span>
            <span role="gridcell" className="px-3 text-[11px] text-ink-2">
              {pricingRule.applyOn}
              {pricingRule.skus.length
                ? ` · ${pricingRule.skus.length} SKU${pricingRule.skus.length === 1 ? "" : "s"}`
                : ""}
            </span>
            <span role="gridcell" className="px-3 text-[11px] text-ink-2">
              {ruleEffect(pricingRule)}
            </span>
            <span role="gridcell" className="px-3 font-mono text-[10.5px] text-ink-3">
              {dateWindow(pricingRule.startsOn, pricingRule.endsOn)}
            </span>
            <span role="gridcell" className="pr-3.5 pl-3">
              <Status value={pricingRule.status} />
            </span>
          </>
        )}
      />
    </div>
  )
}

function ruleEffect(pricingRule: CommercialPricingRule): string {
  if (pricingRule.percentBps)
    return `${(pricingRule.percentBps / 100).toFixed(2)}% off`
  if (pricingRule.amount) return `${rupiah(pricingRule.amount)} off`
  if (pricingRule.fixedPrice) return `Fixed ${rupiah(pricingRule.fixedPrice)}`
  return pricingRule.effect || pricingRule.kind
}

/* ── campaigns ───────────────────────────────────────────────── */

export function Campaigns({ resource }: { resource: CommercialResourceState }) {
  /* which card is open, and which campaign the detail sheet is showing —
   * both are what the user is looking at, so both are in the URL */
  const { expand, detail } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [sheet, setSheet] = useState<CampaignSheetTarget | null>(null)
  const go = (next: { expand?: string; detail?: string }) =>
    void navigate({
      search: (prev) => ({ ...prev, ...next }),
      replace: true,
    })
  if (!resource.data)
    return <ResourceState resource={resource} label="campaigns" />
  const { data } = resource
  const campaigns = data.campaigns

  return (
    <div className="p-3.5">
      <div className="flex items-start gap-2 pb-3">
        <p className="text-[11px] leading-[1.5] text-ink-4">
          A campaign is the container the offers inside it are authored against:
          a title, a window, a budget and a store scope. It applies no mechanic
          of its own. The hub projects spend to date and a KPI block onto each
          campaign, so what a budget has absorbed is read, never estimated here.
        </p>
        <span className="flex-1" />
        <AddButton
          label="New campaign"
          onClick={() => setSheet({ mode: "create" })}
        />
      </div>
      {!campaigns.length ? (
        <EmptyState label="campaigns" />
      ) : (
        <div className="grid gap-2.5">
          {campaigns.map((campaign) => {
            const expanded = expand === campaign.id
            const promotions = data.promotions.filter(
              (promotion) =>
                campaign.promotionIds.includes(promotion.id) ||
                promotion.campaignIds.includes(campaign.id)
            )
            const rules = data.pricingRules.filter(
              (pricingRule) => pricingRule.campaignId === campaign.id
            )
            return (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                expanded={expanded}
                promotions={promotions}
                rules={rules}
                onToggle={() =>
                  go({ expand: expanded ? undefined : campaign.id })
                }
                onOpen={() => go({ detail: campaign.id })}
              />
            )
          })}
        </div>
      )}

      <CampaignDetailSheet
        id={detail ?? null}
        resource={resource}
        onClose={() => go({ detail: undefined })}
        onEdit={(id) => {
          go({ detail: undefined })
          setSheet({ mode: "edit", id })
        }}
      />
      <CampaignSheet
        target={sheet}
        resource={resource}
        onClose={() => setSheet(null)}
      />
    </div>
  )
}

function CampaignCard({
  campaign,
  expanded,
  promotions,
  rules,
  onToggle,
  onOpen,
}: {
  campaign: CommercialCampaign
  expanded: boolean
  promotions: CommercialPromotion[]
  rules: CommercialPricingRule[]
  onToggle: () => void
  onOpen: () => void
}) {
  return (
    <section className="overflow-hidden rounded-panel border border-line-strong">
      <div className="flex items-center transition-colors hover:bg-hover">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-2 pl-3.5 text-left"
        >
          <Icon
            path={paths.chevronRight}
            size={13}
            width={2.2}
            className={cn(
              "shrink-0 text-ink-4 transition-transform duration-[140ms]",
              expanded && "rotate-90"
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-ink">
              {campaign.name}
            </span>
            <span className="block truncate text-[11px] text-ink-4">
              {dateWindow(campaign.startsOn, campaign.endsOn)} ·{" "}
              {campaign.storeIds.length
                ? `${campaign.storeIds.length} stores`
                : "every store"}{" "}
              · {promotions.length} promotion
              {promotions.length === 1 ? "" : "s"} · {rules.length} rule
              {rules.length === 1 ? "" : "s"}
            </span>
          </span>
          {campaign.budget !== undefined && campaign.budget > 0 ? (
            <span className="shrink-0 font-mono text-[11px] text-ink-3">
              {rupiah(campaign.budgetUsed)} of {rupiah(campaign.budget)}
              <span className="pl-1 text-ink-4">
                · {Math.round((campaign.budgetUsed / campaign.budget) * 100)}%
              </span>
            </span>
          ) : (
            <span className="shrink-0 font-mono text-[11px] text-ink-4">
              uncapped
            </span>
          )}
          <span className="w-[88px] shrink-0 justify-end">
            <Status value={campaign.status} />
          </span>
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="mr-3 ml-1 inline-flex h-[26px] shrink-0 items-center gap-1 rounded-control bg-surface px-2 text-[11.5px] font-medium text-ink shadow-btn transition-colors duration-[120ms] hover:bg-hover"
        >
          Open
        </button>
      </div>
      {expanded && (
        <div className="border-t border-line">
          {promotions.map((promotion) => (
            <div
              key={promotion.id}
              className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5 last:border-b-0"
            >
              <span className="inline-flex h-[20px] shrink-0 items-center rounded-[6px] bg-accent-tint px-1.5 text-[10.5px] font-medium text-accent-ink">
                {promotion.type.replaceAll("_", " ")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-ink">
                  {promotion.name}
                </span>
                <span className="block truncate text-[10.5px] text-ink-4">
                  {promotion.summary} · priority {promotion.priority}
                </span>
              </span>
              <Status value={promotion.status} />
            </div>
          ))}
          {rules.map((pricingRule) => (
            <div
              key={pricingRule.id}
              className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5 last:border-b-0"
            >
              <span className="inline-flex h-[20px] shrink-0 items-center rounded-[6px] bg-inset px-1.5 text-[10.5px] font-medium text-ink-2">
                rule
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-ink">
                  {pricingRule.name}
                </span>
                <span className="block truncate text-[10.5px] text-ink-4">
                  {pricingRule.applyOn} · {ruleEffect(pricingRule)}
                </span>
              </span>
              <Status value={pricingRule.status} />
            </div>
          ))}
          {!promotions.length && !rules.length && (
            <div className="px-3.5 py-6 text-center text-xs text-ink-4">
              No promotions or pricing rules reference this campaign.
            </div>
          )}
          {/* Promotions are read-only here on purpose. The hub's snapshot
              builder reads pricing rules, campaigns, coupons, price entries
              and markdowns — never the promotions table — so authoring into
              it would put an offer somewhere the tills never look. */}
        </div>
      )}
    </section>
  )
}

/* ── vouchers and coupons ────────────────────────────────────── */

/** The code list filters on one column: which owner the row came from. */
const CODE_COLUMNS = [
  {
    id: "kind",
    accessorFn: (row: { kind: "coupon" | "voucher" }) => row.kind,
    filterFn: "equalsString" as const,
  },
]

const CODE_TABLE_COLUMNS = "170px 92px minmax(0,1fr) 176px 148px 108px"

export function Codes({ resource }: { resource: CommercialResourceState }) {
  const { kind } = Route.useSearch()
  const [couponSheet, setCouponSheet] = useState<CouponSheetTarget | null>(null)
  const [voucherSheet, setVoucherSheet] = useState<VoucherSheetTarget | null>(
    null
  )

  const data = resource.data
  const codeRows = useMemo(() => {
    if (!data) return []
    return [
      ...data.coupons.map((coupon) => ({
        kind: "coupon" as const,
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        status: coupon.status,
        memberId: coupon.memberId,
        startsOn: coupon.startsOn,
        endsOn: coupon.endsOn,
        used: `${coupon.used.toLocaleString("id-ID")}${coupon.maxUses ? `/${coupon.maxUses.toLocaleString("id-ID")}` : " / no cap"}`,
        detail: coupon.ruleId ? `Unlocks ${coupon.ruleId}` : "Unlocks nothing",
        onOpen: () => setCouponSheet({ mode: "edit", code: coupon.code }),
      })),
      ...data.vouchers.map((voucher) => ({
        kind: "voucher" as const,
        id: voucher.id,
        code: voucher.code,
        name: voucher.issuedToCustomerName || voucher.kind.replaceAll("_", " "),
        status: voucher.status,
        memberId: voucher.issuedToCustomerId,
        startsOn: undefined,
        endsOn: voucher.expiresOn,
        used: voucher.singleUse
          ? `${voucher.redeemedCount.toLocaleString("id-ID")} / once`
          : `${voucher.redeemedCount.toLocaleString("id-ID")} / no cap`,
        detail: voucherDetail(voucher),
        onOpen: () => setVoucherSheet({ mode: "edit", id: voucher.id }),
      })),
    ]
  }, [data])

  const table = useTable({
    features,
    data: codeRows,
    columns: CODE_COLUMNS,
    getRowId: (row) => `${row.kind}:${row.id}`,
    state: {
      columnFilters: kind === "all" ? [] : [{ id: "kind", value: kind }],
    },
  })
  const rows = table.getRowModel().rows.map((row) => row.original)

  if (!data)
    return <ResourceState resource={resource} label="vouchers and coupons" />

  return (
    <div>
      <div className="flex h-11 items-center gap-1.5 border-b border-line px-3.5">
        {(["all", "coupon", "voucher"] as const).map((option) => {
          const count =
            option === "all"
              ? data.coupons.length + data.vouchers.length
              : option === "coupon"
                ? data.coupons.length
                : data.vouchers.length
          return (
            <Link
              key={option}
              from="/commercial"
              to="/commercial"
              search={(prev) => ({ ...prev, kind: option })}
              replace
              className={cn(
                "inline-flex h-[26px] items-center gap-1.5 rounded-control px-2.5 text-[11.5px] font-medium capitalize transition-colors",
                kind === option
                  ? "bg-hover text-ink"
                  : "text-ink-3 hover:bg-hover hover:text-ink"
              )}
            >
              {option === "all" ? "All" : `${option}s`}
              <span className="font-mono text-[10.5px] text-ink-4">
                {count}
              </span>
            </Link>
          )
        })}
        <span className="ml-auto text-[11px] text-ink-4">
          A coupon unlocks a rule · a voucher carries its own value
        </span>
        <AddButton
          label="New coupon"
          onClick={() => setCouponSheet({ mode: "create" })}
        />
        <AddButton
          label="New voucher"
          onClick={() => setVoucherSheet({ mode: "create" })}
        />
      </div>
      {!rows.length ? (
        <EmptyState label="codes" />
      ) : (
        <VirtualRows
          rows={rows}
          rowKey={(code) => `${code.kind}:${code.id}`}
          columns={CODE_TABLE_COLUMNS}
          rowHeight={46}
          className="min-w-[900px]"
          onRowClick={(code) => code.onOpen()}
          header={
            <>
              <span className="pl-3.5">Code</span>
              <span>Kind</span>
              <span>What it does</span>
              <span className="text-right">Window</span>
              <span className="text-right">Used</span>
              <span className="pr-3.5">Status</span>
            </>
          }
          renderRow={(code) => (
            <>
              <span role="gridcell" className="pr-3 pl-3.5">
                <span className="block truncate font-mono text-[12px] font-medium text-ink">
                  {code.code}
                </span>
                {code.memberId && (
                  <span className="block truncate font-mono text-[10px] text-ink-4">
                    {code.memberId}
                  </span>
                )}
              </span>
              <span role="gridcell" className="px-3 text-[11.5px] text-ink-3 capitalize">
                {code.kind}
              </span>
              <span role="gridcell" className="px-3 text-xs text-ink-2">
                <span className="block truncate">{code.name}</span>
                <span className="block truncate text-[10.5px] text-ink-4">
                  {code.detail}
                </span>
              </span>
              <span role="gridcell" className="px-3 text-right font-mono text-[11px] text-ink-3 tabular-nums">
                {dateWindow(code.startsOn, code.endsOn)}
              </span>
              <span role="gridcell" className="px-3 text-right font-mono text-xs text-ink-2 tabular-nums">
                {code.used}
              </span>
              <span role="gridcell" className="pr-3.5 pl-3">
                <Status value={code.status} />
              </span>
            </>
          )}
        />
      )}

      <CouponSheet
        target={couponSheet}
        resource={resource}
        onClose={() => setCouponSheet(null)}
      />
      <VoucherSheet
        target={voucherSheet}
        resource={resource}
        onClose={() => setVoucherSheet(null)}
      />
    </div>
  )
}

function voucherDetail(
  voucher: CommercialResource["vouchers"][number]
): string {
  const floor = voucher.minSpend ? ` · over ${rupiah(voucher.minSpend)}` : ""
  // `discountPct` is a whole percent on this route, not basis points.
  if (voucher.discountPct) return `${voucher.discountPct}% off${floor}`
  if (voucher.valueIdr) return `${rupiah(voucher.valueIdr)} off${floor}`
  if (voucher.balance !== undefined)
    return `${rupiah(voucher.balance)} left of ${rupiah(voucher.initialValue ?? 0)}`
  if (voucher.pointsValue)
    return `${voucher.pointsValue.toLocaleString("id-ID")} points`
  return voucher.kind.replaceAll("_", " ")
}

/* ── return policies ─────────────────────────────────────────── */

/**
 * The hub DOES publish a return-policy resource — `/v1/return-policies`, read
 * by the same specificity-first selector the till uses — but this deployment
 * has authored none, so it answers `{"policies": []}`. The screen shows that
 * emptiness rather than a local stand-in: an unauthored policy is not the same
 * as an absent feature, and the difference matters to whoever has to author
 * the first one.
 */
export function Returns({ resource }: { resource: CommercialResourceState }) {
  const policies = resource.data?.returnPolicies ?? []
  if (policies.length) return <ReturnPolicies policies={policies} />
  return <NoReturnPolicies />
}

/* No <colgroup> in the original either — three equal columns. In practice
 * this hub always answers `{"policies": []}` on this deployment (see the
 * docstring above), so the row this renders barely exists today. */
const RETURN_POLICY_COLUMNS = "minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)"

function ReturnPolicies({
  policies,
}: {
  policies: NonNullable<CommercialResource["returnPolicies"]>
}) {
  return (
    <div className="p-3.5">
      <p className="pb-3 text-[11px] leading-[1.5] text-ink-4">
        The most specific policy wins. An article rule beats a tag, a tag beats
        a store, a store beats the default — and only the winning policy is
        applied, never a blend of two.
      </p>
      <div className="overflow-x-auto rounded-panel border border-line-strong">
        <VirtualRows
          rows={policies}
          rowKey={(policy) => policy.id}
          columns={RETURN_POLICY_COLUMNS}
          rowHeight={46}
          className="min-w-[560px]"
          header={
            <>
              <span className="pl-3.5">Policy</span>
              <span>Scope</span>
              <span className="pr-3.5 text-right">Window</span>
            </>
          }
          renderRow={(policy) => (
            <>
              <span role="gridcell" className="pr-3 pl-3.5">
                <span className="block truncate text-xs font-medium text-ink">
                  {policy.name}
                </span>
                <span className="block truncate font-mono text-[10px] text-ink-4">
                  {policy.id}
                </span>
              </span>
              <span role="gridcell" className="px-3 text-[11.5px] text-ink-2 capitalize">
                {policy.scope}
              </span>
              <span role="gridcell" className="pr-3.5 pl-3 text-right font-mono text-[11px] text-ink-3 tabular-nums">
                {policy.days} days
              </span>
            </>
          )}
        />
      </div>
    </div>
  )
}

function NoReturnPolicies() {
  return (
    <div className="p-3.5">
      <p className="pb-3 text-[11px] leading-[1.5] text-ink-4">
        The most specific policy wins. An article rule beats a tag, a tag beats
        a store, a store beats the default — and only the winning policy is
        applied, never a blend of two.
      </p>

      <div className="grid gap-2.5">
        <section className="overflow-hidden rounded-panel border border-line-strong">
          <div className="flex items-center gap-3 border-b border-line px-3.5 py-3">
            <span className="grid size-[30px] shrink-0 place-items-center rounded-panel bg-inset text-ink-4">
              <Icon path={paths.reply} size={15} width={2} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink">
                No return policies
              </span>
              <span className="block truncate text-[11px] text-ink-4">
                Nothing authored, nothing assumed
              </span>
            </span>
          </div>
          <p className="px-3.5 py-4 text-[11.5px] leading-[1.6] text-ink-3">
            The hub answers{" "}
            <code className="font-mono">/v1/return-policies</code> with an empty
            list: the resource exists and the engine folds the winning policy
            into an article's coverage, but nobody has authored a policy on this
            deployment yet. Until one is authored this screen shows nothing
            rather than a local stand-in, and the catalogue reports “no policy”
            for every article instead of guessing at a settlement.
          </p>
        </section>
      </div>
    </div>
  )
}
