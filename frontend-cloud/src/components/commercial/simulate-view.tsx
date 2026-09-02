import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { Segmented } from "@/components/custom/segmented"
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
import { ApiError } from "@itulah/contract/client"
import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Play, Plus, Tag, X } from "lucide-react"
import { useMemo } from "react"

interface DraftLine {
  readonly id: string
  readonly sku_code: string
  readonly quantity: number
}

/// The basket somebody is building, before any of it is sent.
interface Draft {
  site: string
  channel: CommercialChannel
  /// Blank is now. The engine takes the instant as an argument, so asking what
  /// the fleet will charge on the first morning of a campaign is the same code
  /// path as asking what it charges at this second.
  at: string
  coupon: string
  lines: DraftLine[]
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

  /// Every value on this screen is a field of one request.
  ///
  /// It was seven `useState`s and a hand-rolled array editor, which is the
  /// shape a form takes when nobody has said out loud that it is one. The
  /// tell was `setLines((current) => current.map(...))` written twice, once
  /// per editable cell: a form owns that, and gets `pushFieldValue` and
  /// `removeFieldValue` with it.
  ///
  /// The shop is a field too even though it also chooses the catalogue. It is
  /// sent with the basket — pricing the same basket at two shops is the second
  /// most common thing done on this screen — so it belongs to the request and
  /// not to the chrome around it.
  const form = useForm({
    defaultValues: {
      site: "",
      channel: "STORE",
      at: "",
      coupon: "",
      lines: [{ id: crypto.randomUUID(), sku_code: "", quantity: 1 }],
    } as Draft,
    onSubmit: ({ value }) => run.mutateAsync(value),
  })

  const chosen = useStore(form.store, (state) => state.values.site)
  const channel = useStore(form.store, (state) => state.values.channel)
  const lines = useStore(form.store, (state) => state.values.lines)
  // Nothing is chosen until somebody chooses, and the first shop is the one the
  // screen opens on. Left as a fallback rather than written into the field so
  // that "not yet chosen" and "chose the first one" stay different states.
  const site = chosen !== "" ? chosen : (shops[0]?.site_id ?? "")

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
    mutationFn: (value: Draft) =>
      simulate({
        site_id: site,
        channel: value.channel,
        at: localInstantToIso(value.at),
        lines: value.lines
          .filter((line) => line.sku_code !== "" && line.quantity > 0)
          .map((line) => ({ sku_code: line.sku_code, quantity: line.quantity })),
        coupon_codes: value.coupon.trim() === "" ? [] : [value.coupon.trim()],
      }),
  })

  const usable = lines.some((line) => line.sku_code !== "" && line.quantity > 0)

  return (
    <AppShell data-cloudhub nav={<Nav />}>
      <ScreenHeader
        eyebrow="Commercial"
        title="Test a basket"
        subtitle={site === "" ? "pick a shop" : `${units(products.length)} products to pick from`}
      >
        <form.Field name="site">
          {(field) => (
            <select
              value={site}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-label="Shop"
              className="border-input bg-background max-w-40 rounded-[var(--os-r-inner,0.5625rem)] border px-2"
            >
              {shops.length === 0 && <option value="">No shops</option>}
              {shops.map((shop) => (
                <option key={shop.site_id} value={shop.site_id}>
                  {shop.label}
                </option>
              ))}
            </select>
          )}
        </form.Field>
        <form.Field name="channel">
          {(field) => (
            <Segmented
              size="sm"
              value={field.state.value}
              onChange={(value) => field.handleChange(value)}
              options={CHANNELS.map((option) => ({
                id: option,
                label: option.toLowerCase(),
              }))}
            />
          )}
        </form.Field>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/commercial" />}>
          <Tag className="size-3.5" />
          Prices
        </Button>
      </ScreenHeader>

      <ScreenBody card={false} className="grid min-h-0 flex-1 grid-cols-1 gap-[1.125rem] lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className="os-card min-h-0 overflow-auto p-3.5">
          <h2 className="mb-2 text-xs font-semibold">The basket</h2>
          <div className="flex flex-col gap-2">
            {lines.map((line, index) => (
              <div key={line.id} className="flex items-center gap-1.5">
                <form.Field name={`lines[${index}].sku_code`}>
                  {(field) => (
                    <select
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-label="Product"
                      className="border-input bg-background min-w-0 flex-1 rounded-[var(--os-r-inner,0.5625rem)] border px-2"
                    >
                      <option value="">Pick a product…</option>
                      {products.map((product) => (
                        <option key={product.sku_code} value={product.sku_code}>
                          {product.article_name} · {product.sku_code} ·{" "}
                          {money(product.unit_price_minor, product.currency)}
                        </option>
                      ))}
                    </select>
                  )}
                </form.Field>
                <form.Field name={`lines[${index}].quantity`}>
                  {(field) => (
                    <Input
                      type="number"
                      min={1}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      // A quantity of nought is not a line somebody meant to
                      // write, and the engine would price it as nothing at all.
                      onChange={(event) => field.handleChange(Number(event.target.value) || 1)}
                      aria-label="Quantity"
                      className="w-16"
                    />
                  )}
                </form.Field>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Remove line"
                  disabled={lines.length === 1}
                  onClick={() => form.removeFieldValue("lines", index)}
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
              form.pushFieldValue("lines", {
                id: crypto.randomUUID(),
                sku_code: "",
                quantity: 1,
              })
            }
          >
            <Plus className="size-3.5" />
            Another line
          </Button>

          <div className="mt-4 flex flex-col gap-2">
            <form.Field name="coupon">
              {(field) => (
                <Ask label="Coupon code">
                  <Input
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="none"
                    className="text-xs"
                  />
                </Ask>
              )}
            </form.Field>
            <form.Field name="at">
              {(field) => (
                <Ask label="Price as of — blank is now">
                  <Input
                    type="datetime-local"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    className="text-xs"
                  />
                </Ask>
              )}
            </form.Field>
          </div>

          <Button
            className="mt-4 w-full"
            disabled={!usable || site === "" || run.isPending}
            onClick={() => void form.handleSubmit()}
          >
            <Play className="size-3.5" />
            {run.isPending ? "Pricing…" : "Price it"}
          </Button>
          <p className="text-muted-foreground mt-2 text-[0.65625rem]">
            Nothing is sold and nothing is counted. A promotion that would exhaust its
            budget is reported as applying, because it would.
          </p>
        </div>

        <div className="os-card min-h-0 overflow-auto">
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
      </ScreenBody>
    </AppShell>
  )
}

/// One labelled box in the basket's side panel.
function Ask({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground text-[0.6875rem]">{label}</span>
      {children}
    </label>
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
          <span className="text-[0.71875rem] text-[var(--os-warn,#c9892e)]">
            {money(result.discount_total_minor, result.currency)} off
          </span>
        )}
        {result.points_earned > 0 && (
          <span className="text-muted-foreground text-[0.71875rem]">
            {units(result.points_earned)} points
          </span>
        )}
        <span className="text-muted-foreground ml-auto font-mono text-[0.65625rem]">
          book v{result.publication_version}
        </span>
      </div>

      <Table>
        <TableHeader>
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
              <TableCell className="font-mono text-[0.6875rem]">{line.sku_code}</TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {units(line.quantity)}
              </TableCell>
              <TableCell>
                <span className="text-muted-foreground text-[0.65625rem]">
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
              <span className="font-mono text-[0.6875rem]">{line.sku_code}</span>{" "}
              <span className="text-muted-foreground text-[0.6875rem]">
                ×{units(line.quantity)} by {line.granted_by_rule_id}, worth{" "}
                {money(line.value_minor, result.currency)}
              </span>
              <span className="text-muted-foreground block text-[0.65625rem]">
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
                <span className="text-muted-foreground font-mono text-[0.65625rem]">
                  {rule.rule_id}
                  {rule.coupon_code !== null && ` · ${rule.coupon_code}`}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[0.6875rem] tabular-nums text-[var(--os-ok,#36b827)]">
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
                  <span className="text-muted-foreground font-mono text-[0.65625rem]">
                    {rule.rule_id}
                  </span>
                </span>
                {rule.would_have_saved_minor !== null && (
                  <span className="text-muted-foreground shrink-0 font-mono text-[0.6875rem] tabular-nums">
                    would have been {money(rule.would_have_saved_minor, result.currency)}
                  </span>
                )}
              </div>
              <p className="text-[0.6875rem] text-[var(--os-warn,#c9892e)]">
                {rule.explanation}
              </p>
            </li>
          ))}
        </Section>
      )}

      <div className="text-muted-foreground border-t px-3.5 py-2 font-mono text-[0.65625rem]">
        trace {result.trace_id}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t">
      <h3 className="text-muted-foreground px-3.5 pt-2 pb-1 text-[0.6875rem] font-semibold">
        {title}
      </h3>
      <ul className="divide-y">{children}</ul>
    </div>
  )
}
