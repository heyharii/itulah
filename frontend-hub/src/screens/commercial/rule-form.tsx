import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import type { Applicability, Effect, Rule } from "@itulah/contract"

import { Button } from "@/components/ui/button"
import { Field, Input, Money } from "@/components/ui/field"
import { Day } from "@/components/ui/day"
import { PickMany, PickOne, type Choice } from "@/components/ui/pick"
import { Sheet } from "@/components/ui/sheet"
import { Banner, ErrorState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import { articleKeys, searchArticles } from "@/lib/queries/articles"
import {
  BookWrittenNotPublished,
  commercialKeys,
  commercialProducts,
  minorOf,
  NOTHING_TO_PUBLISH,
  writeAndPublish,
  type CampaignInput,
  type CampaignRow,
  type PublishReceipt,
} from "@/lib/queries/commercial"
import { listTerms, vocabularyKeys } from "@/lib/queries/vocabulary"
import { named } from "@/screens/commercial/compose"
import { endOfDay, shift, startOfDay, today } from "@/lib/calendar"
import { FindMany, type Found } from "@/components/ui/find"
import {
  Choices,
  Dial,
  Section,
  Stepper,
  Toggle,
  type Tile,
} from "@/components/ui/form"
import { Terms } from "@/screens/commercial/controls"
import { describeEffect, termsOf, useActor } from "@/screens/commercial/shared"

/// Writing a promotion.
///
/// The form's shape is the engine's `Rule`, and that is not laziness: a rule is
/// stored, dispatched and evaluated as one document, so a form that invented
/// its own shape would be a second author of promotion semantics and the
/// translation between the two is exactly where a promotion comes to mean
/// something different at the till than it did on this screen. Every control
/// below writes one field of that document.
///
/// **Three things the server refuses on purpose**, said on the option itself
/// rather than hidden — a form field that silently does not apply is worse
/// than a field that is not there, because the promotion looks authored, the
/// shelf ticket gets printed, and the counter charges something else:
///
///  - **A free item.** The engine grants one correctly, emitting a line the
///    caller must append to the sale. No caller does: a till builds its sale
///    from the scanned EPCs alone, so the granted shirt walks out of the shop
///    while the stock still says it is on the shelf. It is a greyed tile
///    carrying that whole sentence, which is the reason `<Choices>` exists: the
///    same refusal in a dropdown could only ever read "— not available".
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
///
/// **What a merchandiser types, and what they pick.** The first version of this
/// form asked for every one of those fields as text in an identical pill: a
/// division was typed as `MENSWEAR` into the same box that had just taken a
/// name, and a misspelling was not an error — it was a promotion scoped to a
/// division of nothing, published to every shop, applying nowhere. Only two
/// answers on this form are genuinely free text (the name, and the coupon
/// code). Everything else is a value out of a list the server already holds, so
/// everything else is picked: divisions and tags out of the vocabulary,
/// articles and SKUs out of the catalogue by server-side search, days off a
/// calendar. See `controls.tsx`.

type ScopeKind = Applicability["on"]
type EffectKind = Effect["kind"]

/// What a rule can match, each with the sentence that distinguishes it from
/// the one above.
const SCOPES: readonly Tile<ScopeKind>[] = [
  {
    value: "ARTICLE",
    label: "These articles",
    note: "A whole article — every colourway and every size minted against it.",
  },
  {
    value: "SKU",
    label: "These SKUs",
    note: "One article in one colourway and one size — SKU-0003-003, not the whole article.",
  },
  {
    value: "DIVISION",
    label: "A division",
    note: "Menswear, Kids — the whole department.",
  },
  {
    value: "TAG",
    label: "Anything tagged",
    note: "Every article carrying the tag, however it is filed.",
  },
  {
    value: "WHOLE_CART",
    label: "The whole basket",
    note: "Matches nothing in particular — it applies to the sale.",
  },
]

const EFFECTS: readonly Tile<EffectKind>[] = [
  {
    value: "PERCENT",
    label: "A percentage off",
    note: "Taken off every matching line.",
  },
  {
    value: "AMOUNT",
    label: "An amount off the basket",
    note: "One flat cut on the sale, not per item.",
  },
  {
    value: "FIXED_UNIT_PRICE",
    label: "A fixed price each",
    note: "Every matching item becomes this price.",
  },
  {
    value: "EARN_POINTS",
    label: "Loyalty points",
    note: "Points rather than money off.",
  },
  {
    value: "FREE_ITEM",
    label: "Free items",
    refused:
      "Not available: a shop sells by EPC and nothing chooses which unit is given away, so the goods would leave while the stock still said they were on the shelf. Use a fixed price or a percentage.",
  },
]

const AUDIENCE: readonly Tile<"EVERYONE" | "MEMBERS">[] = [
  {
    value: "EVERYONE",
    label: "Anybody who walks in",
    note: "No identification asked for at the till.",
  },
  {
    value: "MEMBERS",
    label: "Identified members only",
    note: "The till must have identified the shopper first.",
  },
]

function applicabilityOf(
  kind: ScopeKind,
  codes: readonly string[]
): Applicability {
  switch (kind) {
    case "SKU":
      return { on: "SKU", sku_codes: [...codes] }
    case "DIVISION":
      return { on: "DIVISION", divisions: [...codes] }
    case "TAG":
      return { on: "TAG", tags: [...codes] }
    case "WHOLE_CART":
      return { on: "WHOLE_CART" }
    default:
      return { on: "ARTICLE", article_codes: [...codes] }
  }
}

/// One vocabulary, as a picker's choices.
///
/// Retired terms are dropped rather than greyed: this is a form authoring
/// something new, and a term withdrawn from new work has nothing to offer it.
/// The master screen is where a retired term is still visible.
function useVocabulary(kind: "divisions" | "tags", enabled: boolean) {
  const terms = useQuery({
    queryKey: vocabularyKeys.list(kind),
    queryFn: ({ signal }) => listTerms(kind, signal),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
  const choices: Choice[] = (terms.data?.terms ?? [])
    .filter((one) => one.active)
    .map((one) => ({ value: one.code, label: one.label }))
  return { choices, failed: terms.isError }
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
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [scopeKind, setScopeKind] = useState<ScopeKind>("ARTICLE")
  // One held list per scope, rather than one shared box of text. Switching
  // from articles to divisions and back should not have thrown away the
  // articles,
  // and with a single `codes` string it always did.
  const [articles, setArticles] = useState<readonly Found[]>([])
  const [products, setProducts] = useState<readonly Found[]>([])
  const [divisions, setDivisions] = useState<readonly string[]>([])
  const [tags, setTags] = useState<readonly string[]>([])
  const [members, setMembers] = useState(false)
  const [minQuantity, setMinQuantity] = useState("")
  const [minAmount, setMinAmount] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [effectKind, setEffectKind] = useState<EffectKind>("PERCENT")
  const [percentOff, setPercentOff] = useState("")
  const [amount, setAmount] = useState("")
  const [gated, setGated] = useState(false)
  const [couponCode, setCouponCode] = useState("")
  const [budget, setBudget] = useState("")
  const [maxUses, setMaxUses] = useState("")
  const [priority, setPriority] = useState("0")

  const divisionList = useVocabulary(
    "divisions",
    open && scopeKind === "DIVISION"
  )
  const tagList = useVocabulary("tags", open && scopeKind === "TAG")

  const chosen: readonly string[] =
    scopeKind === "ARTICLE"
      ? articles.map((one) => one.value)
      : scopeKind === "SKU"
        ? products.map((one) => one.value)
        : scopeKind === "DIVISION"
          ? divisions
          : scopeKind === "TAG"
            ? tags
            : []

  /// The same choice, in the words a person reads. Codes are what the engine
  /// matches on; a term that says `MENSWEAR` is a term nobody checks.
  const chosenNames: readonly string[] =
    scopeKind === "ARTICLE"
      ? articles.map((one) => one.label)
      : scopeKind === "SKU"
        ? products.map((one) => one.label)
        : scopeKind === "DIVISION"
          ? divisions.map(
              (code) =>
                divisionList.choices.find((one) => one.value === code)?.label ??
                code
            )
          : scopeKind === "TAG"
            ? tags.map(
                (code) =>
                  tagList.choices.find((one) => one.value === code)?.label ??
                  code
              )
            : []

  const needsCodes = scopeKind !== "WHOLE_CART"
  const bps =
    percentOff.trim() === "" ? null : Math.round(Number(percentOff) * 100)
  const amountMinor = minorOf(amount)
  const budgetMinor = budget.trim() === "" ? null : minorOf(budget)
  // A day, not a minute. The start is the first instant of the day chosen and
  // the end is the LAST instant of the day chosen — "until 30 September"
  // includes the thirtieth, which a `datetime-local` box left at 00:00 quietly
  // did not.
  const startsAt = from === "" ? null : startOfDay(from)
  const endsAt = to === "" ? null : endOfDay(to)
  const code = couponCode.trim().toUpperCase()

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
        ? `Pick what this applies to, or scope it to the whole basket.`
        : effect === null
          ? "Say how much, under “What it does”."
          : gated && code === ""
            ? "A coupon-gated offer needs the code shoppers will present."
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
  /// The document, assembled once.
  ///
  /// The preview below reads THIS, and the button sends it. A preview built
  /// from the form's state instead would be a second author of what the rule
  /// means — and the whole worth of a preview is that it cannot describe
  /// something the button will not publish. `null` while the effect is
  /// incomplete, which is the one field the document cannot be assembled
  /// without.
  const draft: Rule | null =
    effect === null
      ? null
      : {
          // Minted per render and thrown away with it; the published one is
          // minted inside the mutation, so no two attempts share an id.
          rule_id: "rule-draft",
          campaign_id: campaignId,
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
          effect,
          coupon_code: gated && code !== "" ? code : null,
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

  /// A code as the person who picked it reads it. Built from the two lists in
  /// step: `chosen` holds the codes the rule matches on, `chosenNames` the
  /// words beside them, and both are derived from the same source in the same
  /// order.
  ///
  /// Not memoised. Both lists are rebuilt every render anyway, so a memo keyed
  /// on them would never hit — and this is a Map of the handful of things
  /// somebody has picked, rebuilt while they are typing into a form.
  const words = new Map(chosen.map((code, index) => [code, chosenNames[index]]))
  const reading =
    draft === null ? null : termsOf(draft, (code) => words.get(code) ?? code)

  const publish = useMutation({
    mutationFn: () => {
      const ruleId = `rule-${crypto.randomUUID().slice(0, 8)}`
      const rule: Rule = { ...draft!, rule_id: ruleId }

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
                // Verbatim includes the poster. Omitting these would restate
                // the campaign with its banner blanked, so joining a rule to
                // the Lebaran sale would quietly wipe the Lebaran sale's
                // picture from every shop in the fleet.
                image_url: campaign.campaign.image_url,
                headline: campaign.campaign.headline,
                terms: campaign.campaign.terms,
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
          gated && code !== ""
            ? [
                {
                  code,
                  rule_id: ruleId,
                  active: true,
                  valid_from: startsAt,
                  valid_to: endsAt,
                  max_uses: maxUses.trim() === "" ? null : Number(maxUses),
                },
              ]
            : [],
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
      // Emptied on the way out. A published promotion is not a draft of the
      // next one, and reopening the sheet on last week's answers is how the
      // same offer gets written twice.
      setName("")
      setArticles([])
      setProducts([])
      setDivisions([])
      setTags([])
      setPercentOff("")
      setAmount("")
      setGated(false)
      setCouponCode("")
      setBudget("")
      setMaxUses("")
      setMinQuantity("")
      setMinAmount("")
      setFrom("")
      setTo("")
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
      id={`v${nextVersion}`}
      width="wide"
      // Two thirds of the glass rather than the `wide` default's 46rem cap.
      // This form asks six groups of questions and every one of them is a row
      // of tiles or a picker with chips in it; at rail width they stack into a
      // column nobody can see the end of, and the scroll IS the difficulty.
      className="md:w-[clamp(32rem,66vw,58rem)]"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 text-[0.71875rem] leading-relaxed">
            {/* What is stopping the button, said BESIDE the button. It used to
                be the last line of a long scroll, which is the one place
                somebody looking at a disabled Publish will not be looking. */}
            {problem !== undefined ? (
              <span className="text-bad">{problem}</span>
            ) : (
              <span className="text-mute">
                <span className="text-text">
                  {reads(effect, scopeKind, chosen, members)}
                </span>{" "}
                — published and sent to every shop the moment you press this.
              </span>
            )}
          </span>
          <Button
            variant="primary"
            disabled={problem !== undefined || publish.isPending}
            onClick={() => publish.mutate()}
          >
            {publish.isPending ? "Publishing…" : "Publish"}
          </Button>
        </div>
      }
    >
      {halted !== null ? (
        <Banner tone="bad" className="mb-4">
          {halted.message}
        </Banner>
      ) : publish.isError ? (
        <div className="mb-4">
          <ErrorState error={publish.error} />
        </div>
      ) : null}

      {/* Two columns when there is room for two, measured on the sheet and not
          on the window: this panel is 66vw on a desk and the whole glass on a
          phone, so a `lg:` breakpoint would be reading the wrong box. */}
      <div className="@container">
        <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] @3xl:gap-x-8">
          <div className="flex flex-col gap-6">
            <Section title="The offer">
              <Field
                label="What it is called"
                hint="What a cashier and a report will both call this offer."
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
                <PickOne
                  choices={campaigns.map((one) => ({
                    value: one.campaign.campaign_id,
                    label: one.campaign.name,
                  }))}
                  value={campaignId}
                  onChange={setCampaignId}
                  placeholder="On its own"
                  label="The campaign this offer belongs to"
                />
              </Field>
            </Section>

            <Section title="What it applies to">
              <Choices
                options={SCOPES}
                value={scopeKind}
                onChange={setScopeKind}
                columns={2}
                label="What this promotion matches"
              />

              {scopeKind === "ARTICLE" && (
                <Field label="Which articles" hint={named(articles, "article")}>
                  <FindMany
                    chosen={articles}
                    onChange={setArticles}
                    queryKey={(needle) =>
                      articleKeys.list({ q: needle, limit: 20 })
                    }
                    search={(needle, signal) =>
                      searchArticles({ q: needle, limit: 20 }, signal).then(
                        (page) =>
                          page.items.map((row) => ({
                            value: row.article_code,
                            label: row.name,
                            note: `${row.article_code} · ${row.division_code ?? "Unclassified"}`,
                            aside: `${count(row.sku_count)} SKUs`,
                          }))
                      )
                    }
                    placeholder="Search an article by name or code"
                    label="The articles this promotion applies to"
                    offline="The catalogue is not answering. `GET /api/v1/articles` is not on the node this app is talking to."
                  />
                </Field>
              )}

              {scopeKind === "SKU" && (
                <Field label="Which SKUs" hint={named(products, "SKU")}>
                  <FindMany
                    chosen={products}
                    onChange={setProducts}
                    queryKey={(needle) => commercialKeys.products(needle, 20)}
                    search={(needle, signal) =>
                      commercialProducts(needle, 20, signal).then((rows) =>
                        rows.map((row) => ({
                          value: row.sku_code,
                          label: row.sku_code,
                          note: [row.article_name, row.color, row.size]
                            .filter(Boolean)
                            .join(" · "),
                          aside: money(row.unit_price_minor),
                        }))
                      )
                    }
                    placeholder="Search a SKU code, an article name or a colour"
                    label="The SKUs this promotion applies to"
                    offline="The product search is not answering. `GET /api/v1/commercial/products` is not on the node this app is talking to."
                  />
                </Field>
              )}

              {scopeKind === "DIVISION" && (
                <Field
                  label="Which divisions"
                  hint={
                    divisionList.failed
                      ? "The division list is not answering, so none can be picked."
                      : "Chosen from the master list — a division nobody has declared cannot be typed in by accident."
                  }
                >
                  <PickMany
                    choices={divisionList.choices}
                    values={divisions}
                    onChange={setDivisions}
                    placeholder="Choose the divisions"
                    label="The divisions this promotion applies to"
                  />
                </Field>
              )}

              {scopeKind === "TAG" && (
                <Field
                  label="Which tags"
                  hint={
                    tagList.failed
                      ? "The tag list is not answering, so none can be picked."
                      : "Every article carrying one of these is matched."
                  }
                >
                  <PickMany
                    choices={tagList.choices}
                    values={tags}
                    onChange={setTags}
                    placeholder="Choose the tags"
                    label="The tags this promotion applies to"
                  />
                </Field>
              )}

              {scopeKind === "WHOLE_CART" && (
                <p className="text-[0.71875rem] leading-relaxed text-mute">
                  Nothing to name: this applies to the sale itself, so the
                  conditions on the right are what decide whether it fires.
                </p>
              )}

              {/* Its own heading rather than a `<Field>`: a `<label>` wrapped
                  round a radio group hands every click on the words to the
                  first option in it. */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[0.78125rem] font-medium text-text">
                  Who it is for
                </span>
                <Choices
                  options={AUDIENCE}
                  value={members ? "MEMBERS" : "EVERYONE"}
                  onChange={(next) => setMembers(next === "MEMBERS")}
                  columns={2}
                  label="Who this promotion is for"
                />
              </div>
            </Section>

            <Section title="What it does">
              <Choices
                options={EFFECTS}
                value={effectKind}
                onChange={setEffectKind}
                columns={2}
                label="What this promotion does"
              />

              {effectKind === "PERCENT" ? (
                <Field
                  label="How much off"
                  hint={
                    bps === null || !Number.isFinite(bps)
                      ? "The engine stores this as basis points; type it as a percentage."
                      : `${count(bps)} basis points.`
                  }
                >
                  <Dial
                    value={percentOff}
                    onChange={setPercentOff}
                    max={100}
                    tick={10}
                    suffix="%"
                    marks={[10, 20, 30, 50, 70]}
                    placeholder="20"
                    label="Per cent off"
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
                    amountMinor === null
                      ? "Whole rupiah."
                      : effectKind === "EARN_POINTS"
                        ? `One point per ${money(amountMinor)} spent.`
                        : `${money(amountMinor)}.`
                  }
                >
                  <Money
                    value={amount}
                    onChange={setAmount}
                    prefix="Rp"
                    placeholder="50.000"
                    label="The figure this promotion applies"
                  />
                </Field>
              )}

              <Toggle
                on={gated}
                onToggle={() => setGated((was) => !was)}
                label="Only with a coupon code"
                note={
                  gated
                    ? "Shut until the code is typed in at the till. A coupon is a gate on this rule, never a discount of its own."
                    : "Open to everybody the rule matches, with nothing to present."
                }
              />

              {gated && (
                <Field
                  label="The code"
                  hint="Upper case, however it is typed. It travels to every shop with the offer."
                >
                  <Input
                    value={couponCode}
                    placeholder="LEBARAN25"
                    className="font-mono uppercase"
                    onChange={(event) => setCouponCode(event.target.value)}
                  />
                </Field>
              )}
            </Section>
          </div>

          <div className="flex flex-col gap-6">
            <Section title="When it runs" aside="days, not minutes">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Runs from">
                  <Day
                    value={from}
                    onChange={setFrom}
                    placeholder="Straight away"
                    label="The day this promotion starts"
                    presets={[
                      { label: "Today", value: today() },
                      { label: "Tomorrow", value: shift(today(), 1) },
                      { label: "In a week", value: shift(today(), 7) },
                    ]}
                  />
                </Field>
                <Field label="Until">
                  <Day
                    value={to}
                    onChange={setTo}
                    placeholder="Open ended"
                    label="The last day this promotion runs"
                    notBefore={from}
                    presets={[
                      { label: "In a week", value: shift(from ?? today(), 7) },
                      {
                        label: "In a month",
                        value: shift(from ?? today(), 30),
                      },
                    ]}
                  />
                </Field>
              </div>
              <p className="text-[0.71875rem] leading-relaxed text-mute">
                A whole day each end: it starts at the first minute of the day
                it runs from and stops after the last minute of the day it runs
                until. Leave both alone and it starts the moment it is published
                and never stops on its own.
              </p>
            </Section>

            {/* Counted over what the rule MATCHES, not over the basket. The
                engine sums `quantity` and `gross_total` for the matched lines
                alone (`check_conditions` in `engine.rs`), so "least basket
                value" was a label that promised the wrong thing on every scope
                but the whole cart: a million rupiah of footwear does not open a
                menswear offer. */}
            <Section
              title="Before it applies"
              aside={
                scopeKind === "WHOLE_CART"
                  ? "both must be met"
                  : "counted on what it matches"
              }
            >
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={
                    scopeKind === "WHOLE_CART"
                      ? "Least units in the basket"
                      : "Least matching units"
                  }
                >
                  <Stepper
                    value={minQuantity}
                    onChange={setMinQuantity}
                    placeholder="Any"
                    label="Least matching units"
                  />
                </Field>
                <Field
                  label={
                    scopeKind === "WHOLE_CART"
                      ? "Least basket value"
                      : "Least value of those"
                  }
                >
                  <Money
                    value={minAmount}
                    onChange={setMinAmount}
                    prefix="Rp"
                    placeholder="0"
                    label="Least value of the matching lines"
                  />
                </Field>
              </div>
              <p className="text-[0.71875rem] leading-relaxed text-mute">
                {scopeKind === "WHOLE_CART"
                  ? "This offer matches the whole sale, so both are read over the whole basket."
                  : "Both are counted over the lines this offer matches, not over the whole sale — the rest of the basket does not count towards either."}
              </p>
            </Section>

            <Section title="How far it may go">
              <Field
                label="Budget"
                hint="A brake, not a gate — a shop enforces from the last count it was sent."
              >
                <Money
                  value={budget}
                  onChange={setBudget}
                  prefix="Rp"
                  placeholder="Unlimited"
                  label="Budget"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Most baskets">
                  <Stepper
                    value={maxUses}
                    onChange={setMaxUses}
                    min={1}
                    placeholder="Unlimited"
                    label="Most baskets"
                  />
                </Field>
                <Field
                  label="Priority"
                  hint="Higher wins when two cannot both apply."
                >
                  <Stepper
                    value={priority}
                    onChange={setPriority}
                    max={99}
                    placeholder="0"
                    label="Priority"
                  />
                </Field>
              </div>
              <p className="text-[0.71875rem] leading-relaxed text-mute">
                A limit per customer is not offered: nothing counts a
                customer&rsquo;s own history yet, so it would be stored,
                dispatched, and honoured by no till.
              </p>
            </Section>

            {/* The combination, read back. Every control above writes one
                field; this is the only place all of them are said together,
                and it is where a promotion that would never have fired gets
                caught. */}
            <Section title="How it will read" aside="the terms">
              <Terms
                headline={
                  effect === null ? "Not complete" : describeEffect(effect)
                }
                name={name}
                empty="Choose what it applies to and how much, and the terms will be written here."
                clauses={reading?.clauses ?? []}
                hidden={reading?.hidden ?? []}
              />
            </Section>
          </div>
        </div>
      </div>
    </Sheet>
  )
}

/// The offer in one line, for the foot of the sheet.
///
/// Read off the same three answers the rule will carry, so it cannot describe
/// something the button will not publish.
function reads(
  effect: Effect | null,
  scopeKind: ScopeKind,
  chosen: readonly string[],
  members: boolean
): string {
  // Through `describeEffect`, which is the one reading of an effect in this
  // module — a second one here would be a second opinion about what a rule
  // does, and they drift.
  const does = effect === null ? "Not complete" : describeEffect(effect)
  const on =
    scopeKind === "WHOLE_CART"
      ? "the whole basket"
      : `${count(chosen.length)} ${
          scopeKind === "ARTICLE"
            ? "article"
            : scopeKind === "SKU"
              ? "SKU"
              : scopeKind === "DIVISION"
                ? "division"
                : "tag"
        }${chosen.length === 1 ? "" : "s"}`
  return `${does} on ${on}${members ? ", members only" : ""}`
}
