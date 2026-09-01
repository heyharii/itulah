import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/custom/table"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDestinations } from "@/lib/basket"
import type { CommercialChannel, SimulateResult } from "@/lib/commercial"
import {
  CHANNELS,
  describeSource,
  localInstantToIso,
  priceSource,
  shelfPrices,
  shelfPricesKey,
  simulate,
} from "@/lib/commercial"
import { money, units } from "@/lib/money"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Play, Plus, Tag, X } from "lucide-react"
import { useMemo, useState } from "react"

interface DraftLine {
  readonly id: string
  readonly sku_code: string
  readonly quantity: number
}

/// Price a basket nobody is buying.
///
/// This is the only way to ask "why is my promotion not coming off" without a
/// customer standing at the counter. It calls the same evaluator a till calls,
/// against the same price book, so the answer is not a preview of what would
/// happen — it is what would happen.
///
/// The totals are the least interesting part. What this screen exists for is
/// the list of promotions that did NOT apply and the reason each gave: "that
/// coupon expired on Friday" and "the promotion budget is used up" are
/// different conversations, and a merchandiser who cannot tell them apart
/// re-authors a rule that was never wrong.
export function SimulateView() {
  const destinations = useDestinations()
  const shops = useMemo(() => {
    const rows = destinations.data ?? []
    return [...rows].sort((left, right) =>
      left.node_role === right.node_role
        ? left.label.localeCompare(right.label)
        : left.node_role === "STORE"
          ? -1
          : 1,
    )
  }, [destinations.data])

  const [chosen, setChosen] = useState("")
  const site = chosen !== "" ? chosen : (shops[0]?.site_id ?? "")
  const [channel, setChannel] = useState<CommercialChannel>("STORE")
  const [at, setAt] = useState("")
  const [coupon, setCoupon] = useState("")
  const [tier, setTier] = useState("")
  const [lines, setLines] = useState<DraftLine[]>([
    { id: crypto.randomUUID(), sku_code: "", quantity: 1 },
  ])

  // The shop's own priced range, so the basket is built by picking real
  // products rather than by typing codes and finding out they were wrong only
  // once the server refuses the whole basket.
  const catalogue = useQuery({
    queryKey: shelfPricesKey({ siteId: site, channel }),
    queryFn: ({ signal }) => shelfPrices({ siteId: site, channel }, signal),
    enabled: site !== "",
  })
  const products = catalogue.data?.items ?? []

  const run = useMutation({
    mutationFn: () =>
      simulate({
        site_id: site,
        channel,
        at: localInstantToIso(at),
        lines: lines
          .filter((line) => line.sku_code !== "" && line.quantity > 0)
          .map((line) => ({ sku_code: line.sku_code, quantity: line.quantity })),
        coupon_codes: coupon.trim() === "" ? [] : [coupon.trim()],
        customer_tier: tier.trim() === "" ? undefined : tier.trim(),
      }),
  })

  const usable = lines.some((line) => line.sku_code !== "" && line.quantity > 0)

  return (
    <AppShell nav={<Nav />}>
      <ScreenHeader
        title="Test a basket"
        subtitle={site === "" ? "pick a shop" : `${units(products.length)} products to pick from`}
      >
        <select
          value={site}
          onChange={(event) => setChosen(event.target.value)}
          aria-label="Shop"
          className="border-input bg-background h-8 max-w-40 rounded-md border px-2 text-xs"
        >
          {shops.length === 0 && <option value="">No shops</option>}
          {shops.map((shop) => (
            <option key={shop.site_id} value={shop.site_id}>
              {shop.label}
            </option>
          ))}
        </select>
        <div className="bg-muted flex items-center gap-0.5 rounded-md p-0.5">
          {CHANNELS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setChannel(option)}
              className={cn(
                "rounded px-2 py-1 text-[11px] capitalize transition-colors",
                channel === option
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.toLowerCase()}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/commercial" />}>
          <Tag className="size-3.5" />
          Prices
        </Button>
      </ScreenHeader>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-auto border-r p-3.5">
          <h2 className="mb-2 text-xs font-semibold">The basket</h2>
          <div className="flex flex-col gap-2">
            {lines.map((line) => (
              <div key={line.id} className="flex items-center gap-1.5">
                <select
                  value={line.sku_code}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((row) =>
                        row.id === line.id ? { ...row, sku_code: event.target.value } : row,
                      ),
                    )
                  }
                  aria-label="Product"
                  className="border-input bg-background h-8 min-w-0 flex-1 rounded-md border px-2 text-xs"
                >
                  <option value="">Pick a product…</option>
                  {products.map((product) => (
                    <option key={product.sku_code} value={product.sku_code}>
                      {product.article_name} · {product.sku_code} ·{" "}
                      {money(product.unit_price_minor, product.currency)}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  min={1}
                  value={line.quantity}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((row) =>
                        row.id === line.id
                          ? { ...row, quantity: Number(event.target.value) || 1 }
                          : row,
                      ),
                    )
                  }
                  aria-label="Quantity"
                  className="h-8 w-16 text-xs"
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Remove line"
                  disabled={lines.length === 1}
                  onClick={() =>
                    setLines((current) => current.filter((row) => row.id !== line.id))
                  }
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() =>
              setLines((current) => [
                ...current,
                { id: crypto.randomUUID(), sku_code: "", quantity: 1 },
              ])
            }
          >
            <Plus className="size-3.5" />
            Another line
          </Button>

          <div className="mt-4 flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px]">Coupon code</span>
              <Input
                value={coupon}
                onChange={(event) => setCoupon(event.target.value)}
                placeholder="none"
                className="h-8 text-xs"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px]">Member tier</span>
              <Input
                value={tier}
                onChange={(event) => setTier(event.target.value)}
                placeholder="walk-in"
                className="h-8 text-xs"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px]">
                Price as of — blank is now
              </span>
              <Input
                type="datetime-local"
                value={at}
                onChange={(event) => setAt(event.target.value)}
                className="h-8 text-xs"
              />
            </label>
          </div>

          <Button
            className="mt-4 w-full"
            disabled={!usable || site === "" || run.isPending}
            onClick={() => run.mutate()}
          >
            <Play className="size-3.5" />
            {run.isPending ? "Pricing…" : "Price it"}
          </Button>
          <p className="text-muted-foreground mt-2 text-[10.5px]">
            Nothing is sold and nothing is counted. A promotion that would exhaust its
            budget is reported as applying, because it would.
          </p>
        </div>

        <div className="min-h-0 overflow-auto">
          {run.isError ? (
            <ScreenState tone="problem">
              {run.error instanceof ApiError
                ? run.error.message
                : "The basket could not be priced."}
            </ScreenState>
          ) : run.data === undefined ? (
            <ScreenState>
              Build a basket and price it. The answer comes from the same evaluator the
              till runs, so what it says is what the counter would charge.
            </ScreenState>
          ) : (
            <Answer result={run.data} />
          )}
        </div>
      </div>
    </AppShell>
  )
}

function Answer({ result }: { result: SimulateResult }) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b px-3.5 py-2.5">
        <span className="text-sm font-semibold">
          {money(result.total_minor, result.currency)}
        </span>
        {result.discount_total_minor > 0 && (
          <span className="text-[11.5px] text-amber-700 dark:text-amber-500">
            {money(result.discount_total_minor, result.currency)} off
          </span>
        )}
        {result.points_earned > 0 && (
          <span className="text-muted-foreground text-[11.5px]">
            {units(result.points_earned)} points
          </span>
        )}
        <span className="text-muted-foreground ml-auto font-mono text-[10.5px]">
          book v{result.publication_version}
        </span>
      </div>

      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow className="hover:bg-transparent">
            <TableHead>SKU</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead>From</TableHead>
            <TableHead className="text-right">Each</TableHead>
            <TableHead className="text-right">Line</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.lines.map((line) => (
            <TableRow key={line.sku_code}>
              <TableCell className="font-mono text-[11px]">{line.sku_code}</TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {units(line.quantity)}
              </TableCell>
              <TableCell>
                <span className="text-muted-foreground text-[10.5px]">
                  {describeSource(priceSource(line.price_source))}
                </span>
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {line.unit_price_minor < line.base_unit_price_minor && (
                  <span className="text-muted-foreground mr-1.5 line-through">
                    {money(line.base_unit_price_minor, result.currency)}
                  </span>
                )}
                {money(line.unit_price_minor, result.currency)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {money(line.line_total_minor, result.currency)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {result.free_lines.length > 0 && (
        <Section title="Given away">
          {result.free_lines.map((line) => (
            <li key={`${line.granted_by_rule_id}:${line.sku_code}`} className="px-3.5 py-1.5">
              <span className="font-mono text-[11px]">{line.sku_code}</span>{" "}
              <span className="text-muted-foreground text-[11px]">
                ×{units(line.quantity)} by {line.granted_by_rule_id}, worth{" "}
                {money(line.value_minor, result.currency)}
              </span>
              <span className="text-muted-foreground block text-[10.5px]">
                Append this to the sale as a real line, or the shirt walks out and the
                stock still says it is on the shelf.
              </span>
            </li>
          ))}
        </Section>
      )}

      {result.applied_rules.length > 0 && (
        <Section title="Applied">
          {result.applied_rules.map((rule) => (
            <li
              key={rule.rule_id}
              className="flex items-baseline justify-between gap-3 px-3.5 py-1.5"
            >
              <span className="min-w-0">
                <span className="text-xs">{rule.name}</span>{" "}
                <span className="text-muted-foreground font-mono text-[10.5px]">
                  {rule.rule_id}
                  {rule.coupon_code !== null && ` · ${rule.coupon_code}`}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-emerald-700 dark:text-emerald-400">
                −{money(rule.benefit_minor, result.currency)}
              </span>
            </li>
          ))}
        </Section>
      )}

      {/* The reason this screen exists. Not diagnostic noise: "the promotion
          did not come off" and "that coupon expired on Friday" are different
          conversations, and the second one is the only actionable answer. */}
      {result.rejected_rules.length > 0 && (
        <Section title="Did not apply, and why">
          {result.rejected_rules.map((rule) => (
            <li key={rule.rule_id} className="px-3.5 py-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  <span className="text-xs">{rule.name}</span>{" "}
                  <span className="text-muted-foreground font-mono text-[10.5px]">
                    {rule.rule_id}
                  </span>
                </span>
                {rule.would_have_saved_minor !== null && (
                  <span className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
                    would have been {money(rule.would_have_saved_minor, result.currency)}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-amber-700 dark:text-amber-500">
                {rule.explanation}
              </p>
            </li>
          ))}
        </Section>
      )}

      <div className="text-muted-foreground border-t px-3.5 py-2 font-mono text-[10.5px]">
        trace {result.trace_id}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t">
      <h3 className="text-muted-foreground px-3.5 pt-2 pb-1 text-[11px] font-semibold">
        {title}
      </h3>
      <ul className="divide-y">{children}</ul>
    </div>
  )
}
