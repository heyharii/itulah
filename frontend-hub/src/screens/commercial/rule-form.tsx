import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import type { Applicability, Effect, Rule } from "@itulah/contract"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner, ErrorState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, money } from "@/lib/format"
import {
  BookWrittenNotPublished,
  commercialKeys,
  commercialProducts,
  instantOf,
  minorOf,
  NOTHING_TO_PUBLISH,
  writeAndPublish,
  type CampaignInput,
  type CampaignRow,
  type PublishReceipt,
} from "@/lib/queries/commercial"
import { Quiet } from "@/screens/commercial/parts"
import { useActor } from "@/screens/commercial/shared"

/// Writing a promotion.
///
/// The form's shape is the engine's `Rule`, and that is not laziness: a rule is
/// stored, dispatched and evaluated as one document, so a form that invented
/// its own shape would be a second author of promotion semantics and the
/// translation between the two is exactly where a promotion comes to mean
/// something different at the till than it did on this screen. Every control
/// below writes one field of that document.
///
/// **Three things the server refuses on purpose**, greyed out here with the
/// reason rather than hidden — a form field that silently does not apply is
/// worse than a field that is not there, because the promotion looks authored,
/// the shelf ticket gets printed, and the counter charges something else:
///
///  - **A free item.** The engine grants one correctly, emitting a line the
///    caller must append to the sale. No caller does: a till builds its sale
///    from the scanned EPCs alone, so the granted shirt walks out of the shop
///    while the stock still says it is on the shelf.
///  - **A per-customer limit.** Nothing populates a customer's own history, so
///    `Caps::allows` always reads zero and the limit never bites.
///  - **A campaign this book does not define.** Handled rather than refused: a
///    rule joining a campaign restates that campaign in the same book, because
///    a shop drops a rule whose campaign it does not hold.
///
/// The brief listed a different three — tier prices, a margin effect,
/// cumulative conditions. Those are being **deleted from the engine** rather
/// than merely refused (`Effect::Margin`, `PriceLevel::Tier`,
/// `CustomerScope::Tiers`, `Conditions.cumulative`, and with them
/// `PricingContext.customer_tier` and `CartLine.manual_unit_price`), so there
/// is nothing left to grey out and no control for any of them is built here —
/// not even a disabled one, which would be a promise to wire up something that
/// is on its way out. What is above is what
/// `refuse_what_the_fleet_cannot_honour` actually checks.

type ScopeKind = Applicability["on"]
type EffectKind = Effect["kind"]

const SCOPES: readonly { value: ScopeKind; label: string }[] = [
  { value: "ARTICLE", label: "These styles" },
  { value: "SKU", label: "These products" },
  { value: "DIVISION", label: "A division" },
  { value: "TAG", label: "Anything tagged" },
  { value: "WHOLE_CART", label: "The whole basket" },
]

const EFFECTS: readonly {
  value: EffectKind
  label: string
  refused?: string
}[] = [
  { value: "PERCENT", label: "A percentage off" },
  { value: "AMOUNT", label: "An amount off the basket" },
  { value: "FIXED_UNIT_PRICE", label: "A fixed price each" },
  {
    value: "FREE_ITEM",
    label: "Free items",
    refused:
      "A shop sells by EPC and nothing chooses which unit is given away, so the goods would leave while the stock still said they were on the shelf.",
  },
  { value: "EARN_POINTS", label: "Loyalty points" },
]

/// Codes typed as a list. Commas, spaces or newlines — somebody pasting a
/// column out of a spreadsheet should not have to reformat it first.
function codesOf(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((one) => one.trim().toUpperCase())
        .filter((one) => one !== "")
    ),
  ]
}

function applicabilityOf(kind: ScopeKind, codes: string[]): Applicability {
  switch (kind) {
    case "SKU":
      return { on: "SKU", sku_codes: codes }
    case "DIVISION":
      return { on: "DIVISION", divisions: codes }
    case "TAG":
      return { on: "TAG", tags: codes }
    case "WHOLE_CART":
      return { on: "WHOLE_CART" }
    default:
      return { on: "ARTICLE", article_codes: codes }
  }
}

export function RuleForm({
  open,
  campaigns,
  nextVersion,
  onClose,
  onPublished,
}: {
  open: boolean
  campaigns: readonly CampaignRow[]
  nextVersion: number
  onClose: () => void
  onPublished: (receipt: PublishReceipt) => void
}) {
  const client = useQueryClient()
  const actor = useActor()

  const [name, setName] = useState("")
  const [campaignId, setCampaignId] = useState("")
  const [scopeKind, setScopeKind] = useState<ScopeKind>("ARTICLE")
  const [codes, setCodes] = useState("")
  const [members, setMembers] = useState(false)
  const [minQuantity, setMinQuantity] = useState("")
  const [minAmount, setMinAmount] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [effectKind, setEffectKind] = useState<EffectKind>("PERCENT")
  const [percentOff, setPercentOff] = useState("")
  const [amount, setAmount] = useState("")
  const [couponCode, setCouponCode] = useState("")
  const [budget, setBudget] = useState("")
  const [maxUses, setMaxUses] = useState("")
  const [priority, setPriority] = useState("0")
  const [search, setSearch] = useState("")

  /// The picker. Server-side because the catalogue is far too large to hold in
  /// a browser, and **404 is a state this has to survive**: the route is newer
  /// than some running binaries, and a picker that threw would take the whole
  /// form down over a control most rules do not use.
  const products = useQuery({
    queryKey: commercialKeys.products(search.trim()),
    queryFn: ({ signal }) => commercialProducts(search.trim(), 20, signal),
    enabled: open && scopeKind === "SKU" && search.trim().length >= 2,
    retry: false,
  })

  const chosen = codesOf(codes)
  const needsCodes = scopeKind !== "WHOLE_CART"
  const bps =
    percentOff.trim() === "" ? null : Math.round(Number(percentOff) * 100)
  const amountMinor = minorOf(amount)
  const budgetMinor = budget.trim() === "" ? null : minorOf(budget)
  const startsAt = from === "" ? null : instantOf(from)
  const endsAt = to === "" ? null : instantOf(to)

  const effect: Effect | null = (() => {
    switch (effectKind) {
      case "PERCENT":
        return bps === null || !Number.isFinite(bps) || bps <= 0
          ? null
          : { kind: "PERCENT", bps, compound: false }
      case "AMOUNT":
        return amountMinor === null
          ? null
          : { kind: "AMOUNT", amount: { minor: amountMinor } }
      case "FIXED_UNIT_PRICE":
        return amountMinor === null
          ? null
          : { kind: "FIXED_UNIT_PRICE", unit_price: { minor: amountMinor } }
      case "EARN_POINTS":
        return amountMinor === null
          ? null
          : {
              kind: "EARN_POINTS",
              mode: "SPEND_RATE",
              spend_per_point: { minor: amountMinor },
            }
      default:
        // FREE_ITEM: never assembled, because it cannot be published.
        return null
    }
  })()

  const problem =
    name.trim() === ""
      ? "A promotion needs a name — it is what a shop sees in its own log."
      : needsCodes && chosen.length === 0
        ? "Name what this applies to, or scope it to the whole basket."
        : effect === null
          ? "The effect is not complete yet."
          : endsAt !== null && startsAt !== null && endsAt <= startsAt
            ? "The end has to come after the start."
            : actor === ""
              ? "Nobody is signed in, so no command can name who did this."
              : undefined

  const campaign = campaigns.find(
    (one) => one.campaign.campaign_id === campaignId
  )

  /// A fresh key for each attempt, made where the command is built rather than
  /// held for the life of the sheet.
  ///
  /// Reusing one key across attempts is what an idempotency key is usually for,
  /// and here it would be wrong: a halted publish leaves a book behind, so the
  /// *next* attempt asks for a higher version — a different payload under the
  /// same key, which `command_deduplication` refuses outright. The guard
  /// against a double click is the disabled button, and the guard against a
  /// lost response is the version check, which refuses a second book at a
  /// number already taken.
  const publish = useMutation({
    mutationFn: () => {
      const ruleId = `rule-${crypto.randomUUID().slice(0, 8)}`
      const rule: Rule = {
        rule_id: ruleId,
        campaign_id: campaignId === "" ? null : campaignId,
        name: name.trim(),
        status: "ACTIVE",
        scope: {
          applicability: applicabilityOf(scopeKind, chosen),
          excluded_sku_codes: [],
          site_ids: [],
          channels: [],
          customers: { who: members ? "MEMBERS" : "EVERYONE" },
          effect_on: null,
        },
        conditions: {
          min_quantity: minQuantity.trim() === "" ? 0 : Number(minQuantity),
          max_quantity: null,
          min_amount: { minor: minorOf(minAmount) ?? 0 },
          max_amount: null,
          effective_from: startsAt,
          effective_to: endsAt,
          days: { iso_weekdays: [] },
          time_window: null,
        },
        effect: effect!,
        coupon_code:
          couponCode.trim() === "" ? null : couponCode.trim().toUpperCase(),
        max_discount: null,
        caps: {
          budget: budgetMinor === null ? null : { minor: budgetMinor },
          spent: { minor: 0 },
          max_uses: maxUses.trim() === "" ? null : Number(maxUses),
          used: 0,
        },
        priority: Number(priority) || 0,
        stacking: "ALONE",
        advisory: false,
        earn_basis: "POST_MARKDOWN_PRE_DISCOUNT",
        max_points: null,
      }

      // A campaign has to travel with the rule that names it: the server
      // refuses a book whose rule points at a campaign that book does not
      // define, because a shop drops such a rule and the offer would apply
      // nowhere. Restated verbatim, so joining a campaign never edits it.
      const restated: CampaignInput[] =
        campaign === undefined
          ? []
          : [
              {
                campaign_id: campaign.campaign.campaign_id,
                name: campaign.campaign.name,
                status: campaign.campaign.status,
                valid_from: campaign.campaign.valid_from,
                valid_to: campaign.campaign.valid_to,
                budget_minor: campaign.campaign.budget_minor,
                max_uses: campaign.campaign.max_uses,
              },
            ]

      return writeAndPublish({
        ...NOTHING_TO_PUBLISH,
        version: nextVersion,
        name: `Promotion: ${name.trim()}`,
        effective_from: startsAt ?? new Date().toISOString(),
        effective_to: null,
        rules: [rule],
        campaigns: restated,
        coupons:
          couponCode.trim() === ""
            ? []
            : [
                {
                  code: couponCode.trim().toUpperCase(),
                  rule_id: ruleId,
                  active: true,
                  valid_from: startsAt,
                  valid_to: endsAt,
                  max_uses: maxUses.trim() === "" ? null : Number(maxUses),
                },
              ],
        actor_id: actor,
        idempotency_key: crypto.randomUUID(),
      })
    },
    onError: () => {
      // A halted publish still wrote a book, so the number this form is asking
      // for is now taken. Without this every retry asks for a version the
      // server has already refused.
      client.invalidateQueries({ queryKey: commercialKeys.books() })
    },
    onSuccess: (receipt) => {
      client.invalidateQueries({ queryKey: commercialKeys.all })
      onPublished(receipt)
    },
  })

  const halted =
    publish.error instanceof BookWrittenNotPublished ? publish.error : null

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New promotion"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.71875rem] text-mute">
            Published and sent to every shop the moment you press this.
          </span>
          <Button
            variant="dark"
            disabled={problem !== undefined || publish.isPending}
            onClick={() => publish.mutate()}
          >
            {publish.isPending ? "Publishing…" : "Publish"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {halted !== null ? (
          <Banner tone="bad">{halted.message}</Banner>
        ) : publish.isError ? (
          <ErrorState error={publish.error} />
        ) : null}

        <Field
          label="What it is called"
          hint="What a cashier and a report will both call this offer."
          problem={
            name.trim() === "" && publish.isError ? "Required." : undefined
          }
        >
          <Input
            value={name}
            autoFocus
            placeholder="20% off outerwear"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field
          label="Part of a campaign"
          hint="A rule is live only when both it and its campaign are, so a campaign is one switch over a set of offers."
        >
          <Select
            value={campaignId}
            onChange={(event) => setCampaignId(event.target.value)}
          >
            <option value="">On its own</option>
            {campaigns.map((one) => (
              <option
                key={one.campaign.campaign_id}
                value={one.campaign.campaign_id}
              >
                {one.campaign.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="What it applies to">
          <Select
            value={scopeKind}
            onChange={(event) => {
              setScopeKind(event.target.value as ScopeKind)
              setCodes("")
            }}
          >
            {SCOPES.map((one) => (
              <option key={one.value} value={one.value}>
                {one.label}
              </option>
            ))}
          </Select>
        </Field>

        {needsCodes && (
          <Field
            label={scopeKind === "SKU" ? "Product codes" : "Codes"}
            hint={
              chosen.length === 0
                ? "Separated by commas, spaces or new lines."
                : `${count(chosen.length)} named.`
            }
          >
            <Input
              value={codes}
              placeholder={
                scopeKind === "ARTICLE"
                  ? "ART-JACKET, ART-HOODIE"
                  : scopeKind === "DIVISION"
                    ? "MENSWEAR"
                    : scopeKind === "TAG"
                      ? "lebaran"
                      : "SKU-06-L"
              }
              onChange={(event) => setCodes(event.target.value)}
            />
          </Field>
        )}

        {scopeKind === "SKU" && (
          <div>
            <SubHead aside="server-side search">Find a product</SubHead>
            <Input
              value={search}
              placeholder="Type a code or a description"
              className="mb-2"
              onChange={(event) => setSearch(event.target.value)}
            />
            {search.trim().length < 2 ? (
              <Quiet>Two characters is enough to start.</Quiet>
            ) : products.isError ? (
              // The one degraded state worth naming precisely, because the
              // cause is operational rather than a fault in the data: this
              // route is newer than some running binaries.
              <Quiet>
                The product search is not answering. `GET
                /api/v1/commercial/products` is not on the node this app is
                talking to — codes can still be typed above.
              </Quiet>
            ) : products.data === undefined ? (
              <Quiet>Searching the catalogue…</Quiet>
            ) : products.data.length === 0 ? (
              <Quiet>Nothing matches “{search.trim()}”.</Quiet>
            ) : (
              <MiniTable
                head={["Product", { label: "", align: "left" }, "Now"]}
              >
                {products.data.map((product) => (
                  <MiniRow key={product.sku_id}>
                    <MiniCell>
                      <button
                        type="button"
                        className="text-left text-[0.78125rem] text-accent hover:underline"
                        onClick={() =>
                          setCodes((was) =>
                            codesOf(was).includes(product.sku_code)
                              ? was
                              : `${was}${was.trim() === "" ? "" : ", "}${product.sku_code}`
                          )
                        }
                      >
                        {product.sku_code}
                      </button>
                    </MiniCell>
                    <MiniCell>
                      <span className="text-[0.71875rem] text-mute">
                        {[product.article_name, product.color, product.size]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </MiniCell>
                    <MiniCell align="right">
                      {money(product.unit_price_minor)}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            )}
          </div>
        )}

        <Field label="Who it is for">
          <Select
            value={members ? "MEMBERS" : "EVERYONE"}
            onChange={(event) => setMembers(event.target.value === "MEMBERS")}
          >
            <option value="EVERYONE">Anybody who walks in</option>
            <option value="MEMBERS">Identified members only</option>
          </Select>
        </Field>

        <Field label="What it does">
          <Select
            value={effectKind}
            onChange={(event) =>
              setEffectKind(event.target.value as EffectKind)
            }
          >
            {EFFECTS.map((one) => (
              <option
                key={one.value}
                value={one.value}
                disabled={one.refused !== undefined}
              >
                {one.label}
                {one.refused === undefined ? "" : " — not available"}
              </option>
            ))}
          </Select>
        </Field>

        {/* The refusal, said in full where the choice was made. The greyed
            option can only show a few words. */}
        <Banner tone="info">
          {EFFECTS.find((one) => one.value === "FREE_ITEM")!.refused} Use a
          fixed price or a percentage.
        </Banner>

        {effectKind === "PERCENT" ? (
          <Field
            label="Per cent off"
            hint={
              bps === null || !Number.isFinite(bps)
                ? "The engine stores this as basis points; type it as a percentage."
                : `${bps} basis points.`
            }
          >
            <Input
              value={percentOff}
              inputMode="decimal"
              placeholder="20"
              onChange={(event) => setPercentOff(event.target.value)}
            />
          </Field>
        ) : (
          <Field
            label={
              effectKind === "AMOUNT"
                ? "Amount off the basket"
                : effectKind === "FIXED_UNIT_PRICE"
                  ? "Price each"
                  : "Spend per point"
            }
            hint={
              amountMinor === null ? "Whole rupiah." : `${money(amountMinor)}.`
            }
          >
            <Input
              value={amount}
              inputMode="numeric"
              placeholder="50.000"
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
        )}

        <Field
          label="Coupon code"
          hint="Optional. With one, the offer applies only when the code is typed in — a coupon is a gate on this rule, never a discount of its own."
        >
          <Input
            value={couponCode}
            placeholder="LEBARAN25"
            onChange={(event) => setCouponCode(event.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Least units in the basket">
            <Input
              value={minQuantity}
              inputMode="numeric"
              placeholder="0"
              onChange={(event) => setMinQuantity(event.target.value)}
            />
          </Field>
          <Field label="Least basket value">
            <Input
              value={minAmount}
              inputMode="numeric"
              placeholder="0"
              onChange={(event) => setMinAmount(event.target.value)}
            />
          </Field>
          <Field label="Runs from">
            <Input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field label="Until">
            <Input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
          <Field
            label="Budget"
            hint="A brake, not a gate — a shop enforces from the last count it was sent."
          >
            <Input
              value={budget}
              inputMode="numeric"
              placeholder="Unlimited"
              onChange={(event) => setBudget(event.target.value)}
            />
          </Field>
          <Field label="Most baskets">
            <Input
              value={maxUses}
              inputMode="numeric"
              placeholder="Unlimited"
              onChange={(event) => setMaxUses(event.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Priority"
          hint="Higher wins when two promotions cannot both apply."
        >
          <Input
            value={priority}
            inputMode="numeric"
            onChange={(event) => setPriority(event.target.value)}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-1.5">
          <Tag>uses per customer</Tag>
          <span className="text-[0.71875rem] leading-relaxed text-mute">
            not offered: nothing counts a customer&rsquo;s own history yet, so
            the limit would be stored, dispatched, and honoured by no till.
          </span>
        </div>

        {problem !== undefined && (
          <p className="text-[0.71875rem] text-mute">{problem}</p>
        )}
      </div>
    </Sheet>
  )
}
