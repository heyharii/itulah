import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import {
  KeyValue,
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
  TotalsLadder,
} from "@/components/ui/rows"
import { Segmented } from "@/components/ui/segmented"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, money, moment } from "@/lib/format"
import {
  CHANNELS,
  commercialFleet,
  commercialKeys,
  describeSource,
  instantOf,
  minorOf,
  simulate,
  type CommercialChannel,
  type SimulateLine,
} from "@/lib/queries/commercial"
import { Named, Quiet } from "@/screens/commercial/parts"

/// Price a basket without selling it.
///
/// A POST that writes nothing: no sale, no usage count, no reservation. It is
/// the same evaluator, the same snapshot and the same instant a till uses, so
/// what it says here is what a till would charge — not an approximation built
/// for a preview. That is what makes it worth having: a promotion can be
/// checked before it is published, and "why did this not come off" can be asked
/// without a customer standing there.
///
/// The rejected rules are the point of the screen. The engine reports what
/// could have applied and did not, in its own words — `RejectionReason::
/// describe()` — rather than through a lookup table kept in the browser, which
/// would go stale the day a reason is added and leave a blank cell on the one
/// screen whose job is to explain.

interface BasketLine {
  sku: string
  quantity: string
  /// A price typed in over the book, the way a supervisor overrides at a till.
  /// Recorded as `MANUAL_OVERRIDE` on the line rather than blended into the
  /// published price, and promotions still apply on top: an override says what
  /// the item costs, not that the shopper forfeits every offer.
  manual: string
}

const emptyLine = (): BasketLine => ({
  sku: "",
  quantity: "1",
  manual: "",
})

interface SimulationDraft {
  siteId: string
  channel: CommercialChannel
  at: string
  coupons: string
  tier: string
  customer: string
  lines: BasketLine[]
}

/// The lines worth asking about. A row with no SKU is one somebody started and
/// thought better of, not a question.
function basketOf(lines: readonly BasketLine[]): SimulateLine[] {
  return lines
    .filter((line) => line.sku.trim() !== "" && Number(line.quantity) > 0)
    .map((line) => ({
      sku_code: line.sku.trim(),
      quantity: Number(line.quantity),
      manual_unit_price_minor: minorOf(line.manual),
    }))
}

export function Simulate() {
  const fleet = useQuery({
    queryKey: commercialKeys.fleet(),
    queryFn: ({ signal }) => commercialFleet(signal),
  })

  const shops = useMemo(
    () => (fleet.data?.items ?? []).filter((shop) => shop.site_id !== null),
    [fleet.data]
  )

  // Derived, not synced. An effect that wrote the first shop into state
  // rendered once with nothing selected before correcting itself, and the
  // "which shop" question has an answer the moment the fleet arrives. An
  // explicit choice still wins — `siteId` is only empty until somebody picks.
  const siteOf = (siteId: string) =>
    siteId !== "" ? siteId : (shops[0]?.site_id ?? "")

  // Nothing is invalidated on success, and nothing should be: the server wrote
  // nothing, so no answer anywhere became stale. It is a mutation rather than a
  // query for the same reason — there is no key under which this belongs,
  // because it is not a fact, it is a question.
  const priced = useMutation({
    mutationFn: (draft: SimulationDraft) =>
      simulate({
        site_id: siteOf(draft.siteId),
        channel: draft.channel,
        at: instantOf(draft.at) ?? undefined,
        lines: basketOf(draft.lines),
        coupon_codes: draft.coupons
          .split(",")
          .map((code) => code.trim())
          .filter((code) => code !== ""),
        customer_id:
          draft.customer.trim() === "" ? null : draft.customer.trim(),
        customer_tier: draft.tier.trim() === "" ? null : draft.tier.trim(),
      }),
  })

  const form = useForm({
    defaultValues: {
      siteId: "",
      channel: "STORE",
      at: "",
      coupons: "",
      tier: "",
      customer: "",
      lines: [emptyLine()],
    } as SimulationDraft,
    onSubmit: ({ value }) => priced.mutate(value),
  })

  const ready = (draft: SimulationDraft) =>
    siteOf(draft.siteId) !== "" && basketOf(draft.lines).length > 0

  return (
    <PageContent>
      <PageHeader
        crumb="Commercial"
        title="Simulate"
        sub="The same call a till makes, with nothing written. What it answers is what a counter would charge."
        actions={
          <form.Subscribe selector={(state) => ready(state.values)}>
            {(can) => (
              <Button
                variant="dark"
                disabled={!can || priced.isPending}
                onClick={() => form.handleSubmit()}
              >
                {priced.isPending ? "Pricing…" : "Price this basket"}
              </Button>
            )}
          </form.Subscribe>
        }
      />

      <div className="grid gap-[1.125rem] xl:grid-cols-[24rem_1fr]">
        <Card className="p-4">
          <form
            // The button is in the page header, outside this element, so its
            // disabled state cannot block an Enter keypress.
            onSubmit={(event) => {
              event.preventDefault()
              if (ready(form.state.values) && !priced.isPending) {
                form.handleSubmit()
              }
            }}
            className="flex flex-col gap-4"
          >
            <form.Field name="siteId">
              {(field) => (
                <Field label="Shop">
                  <Select
                    value={siteOf(field.state.value)}
                    onChange={(event) => field.handleChange(event.target.value)}
                  >
                    {shops.map((shop) => (
                      <option key={shop.origin_id} value={shop.site_id!}>
                        {shop.label ?? shop.site_id}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </form.Field>

            <form.Field name="channel">
              {(field) => (
                <Field label="Channel">
                  <div>
                    <Segmented
                      options={CHANNELS.map((one) => ({
                        value: one,
                        label: one,
                      }))}
                      value={field.state.value}
                      onChange={field.handleChange}
                    />
                  </div>
                </Field>
              )}
            </form.Field>

            <form.Field name="at">
              {(field) => (
                <Field
                  label="Priced as at"
                  hint="Now, if left blank. A campaign can be checked before it starts."
                >
                  <Input
                    type="datetime-local"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>

            <form.Field name="lines" mode="array">
              {(lines) => {
                const counted = basketOf(lines.state.value).length
                return (
                  <div>
                    <SubHead
                      aside={`${counted} line${counted === 1 ? "" : "s"}`}
                    >
                      Basket
                    </SubHead>
                    <div className="flex flex-col gap-2.5">
                      {lines.state.value.map((_, index) => (
                        <div
                          key={index}
                          className="flex flex-col gap-2 rounded-inner border border-hairline p-2.5"
                        >
                          <div className="flex gap-2">
                            <form.Field name={`lines[${index}].sku`}>
                              {(field) => (
                                <Input
                                  value={field.state.value}
                                  aria-label="SKU code"
                                  placeholder="SKU code"
                                  onChange={(event) =>
                                    field.handleChange(event.target.value)
                                  }
                                />
                              )}
                            </form.Field>
                            <form.Field name={`lines[${index}].quantity`}>
                              {(field) => (
                                <Input
                                  value={field.state.value}
                                  aria-label="Quantity"
                                  type="number"
                                  min={1}
                                  className="w-20"
                                  onChange={(event) =>
                                    field.handleChange(event.target.value)
                                  }
                                />
                              )}
                            </form.Field>
                          </div>
                          <div className="flex gap-2">
                            <form.Field name={`lines[${index}].manual`}>
                              {(field) => (
                                <Input
                                  value={field.state.value}
                                  aria-label="Typed-in price"
                                  inputMode="numeric"
                                  placeholder="Typed-in price (optional)"
                                  onChange={(event) =>
                                    field.handleChange(event.target.value)
                                  }
                                />
                              )}
                            </form.Field>
                            <Button
                              variant="quiet"
                              // The last line is not removable: a basket with
                              // nothing in it is not a shorter question.
                              disabled={lines.state.value.length === 1}
                              onClick={() => lines.removeValue(index)}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <Button
                      variant="soft"
                      className="mt-2.5"
                      onClick={() => lines.pushValue(emptyLine())}
                    >
                      Add a line
                    </Button>
                  </div>
                )
              }}
            </form.Field>

            <form.Field name="coupons">
              {(field) => (
                <Field
                  label="Coupon codes"
                  hint="Comma separated. A rule gated by a coupon stays shut until its code is here."
                >
                  <Input
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="WELCOME10, STAFF"
                  />
                </Field>
              )}
            </form.Field>

            <div className="grid grid-cols-2 gap-3">
              <form.Field name="tier">
                {(field) => (
                  <Field label="Customer tier">
                    <Input
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      placeholder="Optional"
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="customer">
                {(field) => (
                  <Field label="Customer id">
                    <Input
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      placeholder="Optional"
                    />
                  </Field>
                )}
              </form.Field>
            </div>
          </form>
        </Card>

        <div className="flex flex-col gap-[1.125rem]">
          {priced.isError && (
            <Card>
              <ErrorState error={priced.error} />
            </Card>
          )}

          {priced.isPending && (
            <Card>
              <LoadingState>Pricing the basket…</LoadingState>
            </Card>
          )}

          {priced.isIdle && (
            <Card>
              <EmptyState>
                Nothing priced yet. Name a shop and at least one product, and
                the engine will answer exactly as a till would.
              </EmptyState>
            </Card>
          )}

          {priced.isSuccess && (
            <>
              <Card className="p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Pill tone="ok">Priced</Pill>
                  <Tag>v{priced.data.publication_version}</Tag>
                  <span className="text-[0.71875rem] text-mute">
                    as at {moment(priced.data.as_of)}
                  </span>
                </div>

                <MiniTable head={["Product", "Qty", "Unit", "Line total"]}>
                  {priced.data.lines.map((line, index) => (
                    <MiniRow key={`${line.sku_code}-${index}`}>
                      <MiniCell>
                        <Named
                          name={line.sku_code}
                          code={describeSource(line.price_source)}
                        />
                      </MiniCell>
                      <MiniCell align="right">{count(line.quantity)}</MiniCell>
                      <MiniCell align="right">
                        {line.unit_price_minor < line.base_unit_price_minor ? (
                          <>
                            <span className="mr-1.5 text-mute line-through">
                              {money(line.base_unit_price_minor)}
                            </span>
                            {money(line.unit_price_minor)}
                          </>
                        ) : (
                          money(line.unit_price_minor)
                        )}
                      </MiniCell>
                      <MiniCell align="right">
                        {money(line.line_total_minor)}
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>

                {priced.data.free_lines.length > 0 && (
                  <div className="mt-4">
                    <SubHead>Given away</SubHead>
                    <MiniTable head={["Product", "Qty", "Worth"]}>
                      {priced.data.free_lines.map((line, index) => (
                        <MiniRow key={`${line.sku_code}-${index}`}>
                          <MiniCell>
                            <Named
                              name={line.sku_code}
                              code={line.granted_by_rule_id}
                            />
                          </MiniCell>
                          <MiniCell align="right">
                            {count(line.quantity)}
                          </MiniCell>
                          <MiniCell align="right">
                            {money(line.value_minor)}
                          </MiniCell>
                        </MiniRow>
                      ))}
                    </MiniTable>
                  </div>
                )}

                {/* Both figures are the server's own. Nothing is added up here:
                    a total this screen computed could disagree with the one the
                    till will print, and that is the whole defect this module
                    exists to prevent. */}
                <TotalsLadder
                  className="mt-4"
                  rows={[
                    {
                      label: "Promotions take off",
                      value:
                        priced.data.discount_total_minor > 0
                          ? `− ${money(priced.data.discount_total_minor)}`
                          : money(0),
                    },
                    {
                      label: "Points earned",
                      value: count(priced.data.points_earned),
                    },
                  ]}
                  total={{
                    label: "To pay",
                    value: money(priced.data.total_minor),
                  }}
                />
              </Card>

              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>Promotions applied</CardTitle>
                  <span className="text-[0.75rem] text-mute tabular-nums">
                    {priced.data.applied_rules.length}
                  </span>
                </CardHeader>
                <div className="border-t border-hairline px-4 pb-3">
                  {priced.data.applied_rules.length === 0 ? (
                    <Quiet>Nothing came off this basket.</Quiet>
                  ) : (
                    priced.data.applied_rules.map((rule) => (
                      <KeyValue
                        key={`${rule.rule_id}-${rule.coupon_code ?? ""}`}
                        term={
                          <>
                            {rule.name}
                            {rule.coupon_code && (
                              <Tag className="ml-1.5" tone="accent">
                                {rule.coupon_code}
                              </Tag>
                            )}
                          </>
                        }
                      >
                        − {money(rule.benefit_minor)}
                      </KeyValue>
                    ))
                  )}
                </div>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>Promotions that did not</CardTitle>
                  <span className="text-[0.75rem] text-mute tabular-nums">
                    {priced.data.rejected_rules.length}
                  </span>
                </CardHeader>
                <div className="border-t border-hairline px-4 pb-3">
                  {priced.data.rejected_rules.length === 0 ? (
                    <Quiet>
                      Every promotion in scope applied, so there is nothing to
                      explain.
                    </Quiet>
                  ) : (
                    <div className="flex flex-col">
                      {priced.data.rejected_rules.map((rule) => (
                        <div
                          key={rule.rule_id}
                          className="border-b border-hairline py-2.5 last:border-b-0"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-meta font-medium text-ink">
                              {rule.name}
                            </span>
                            {rule.would_have_saved_minor !== null && (
                              <span className="shrink-0 text-meta text-mute tabular-nums">
                                would have saved{" "}
                                {money(rule.would_have_saved_minor)}
                              </span>
                            )}
                          </div>
                          {/* The engine's own sentence, not a lookup table kept
                              beside it here. */}
                          <p className="mt-0.5 text-[0.71875rem] leading-relaxed text-body">
                            {rule.explanation}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>

              <Banner tone="info">
                Trace {priced.data.trace_id}. The same basket, against the same
                book, at the same instant gives this id on any machine — so a
                shop and the centre can compare answers rather than opinions.
              </Banner>
            </>
          )}
        </div>
      </div>
    </PageContent>
  )
}
