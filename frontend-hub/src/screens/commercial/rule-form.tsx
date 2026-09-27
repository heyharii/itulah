import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Banknote,
  Barcode,
  Coins,
  Gift,
  Hash,
  Layers,
  LayoutGrid,
  Percent,
  Shirt,
  ShoppingBasket,
  Tag,
} from "lucide-react"
import { useState } from "react"
import type {
  Applicability,
  Effect,
  ExclusiveScope,
  MarkdownPolicy,
  PointsCombination,
  Rule,
} from "@itulah/contract"

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
import { endOfDay, shift, startOfDay, today } from "@/lib/calendar"
import { FindMany, type Found } from "@/components/ui/find"
import {
  Choices,
  Dial,
  Section,
  Stepper,
  type Tile,
} from "@/components/ui/form"
import { More, Question, Terms } from "@/screens/commercial/controls"
import { describeEffect, termsOf, useActor } from "@/screens/commercial/shared"
import { cn } from "@/lib/utils"

/// Writing a promotion.
///
/// The form's shape is the engine's `Rule`, and that is not laziness: a rule is
/// stored, dispatched and evaluated as one document, so a form that invented
/// its own shape would be a second author of promotion semantics and the
/// translation between the two is exactly where a promotion comes to mean
/// something different at the till than it did on this screen. Every control
/// below writes one field of that document.
///
/// **Two things the server refuses on purpose**, said on the option itself
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
///  - **A campaign this book does not define.** Handled rather than refused: a
///    rule joining a campaign restates that campaign in the same book, because
///    a shop drops a rule whose campaign it does not hold.
///
/// It used to be three. The per-customer limit was refused on the grounds that
/// "nothing populates a customer's own history", and that had stopped being
/// true: `commercial_usage_customer(kind, key, customer_id, uses)` is written
/// on every promotion of every sale the centre accepts. It is offered now, with
/// the half that IS still missing said where it is set rather than hidden
/// behind a refusal — a till keeps no shopper history, so the engine refuses
/// such an offer at the counter instead of handing it out unlimited.
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
/// division was typed as `PRIA` into the same box that had just taken a
/// name, and a misspelling was not an error — it was a promotion scoped to a
/// division of nothing, published to every shop, applying nowhere. Only two
/// answers on this form are genuinely free text (the name, and the coupon
/// code). Everything else is a value out of a list the server already holds, so
/// everything else is picked: divisions and tags out of the vocabulary,
/// articles and SKUs out of the catalogue by server-side search, days off a
/// calendar. See `controls.tsx`.

type ScopeKind = Applicability["on"]
type EffectKind = Effect["kind"]

/// What a rule can match. A label and a glyph, and nothing under them: the
/// sentence that used to sit on each tile is what the terms on the right say
/// once a choice is made, and saying it twice made the form a page of grey.
const SCOPES: readonly Tile<ScopeKind>[] = [
  { value: "ARTICLE", label: "Articles", icon: Shirt },
  { value: "SKU", label: "SKUs", icon: Barcode },
  { value: "DIVISION", label: "Divisions", icon: LayoutGrid },
  { value: "TAG", label: "Tags", icon: Hash },
  { value: "WHOLE_CART", label: "Whole basket", icon: ShoppingBasket },
]

const EFFECTS: readonly Tile<EffectKind>[] = [
  { value: "PERCENT", label: "Percent off", icon: Percent },
  { value: "AMOUNT", label: "Amount off", icon: Banknote },
  { value: "FIXED_UNIT_PRICE", label: "Fixed price", icon: Tag },
  { value: "BUY_X_GET_Y", label: "Buy X get Y", icon: Layers },
  { value: "FREE_ITEM", label: "Free item", icon: Gift },
  { value: "EARN_POINTS", label: "Points", icon: Coins },
]

const AUDIENCE: readonly Tile<"EVERYONE" | "MEMBERS">[] = [
  { value: "EVERYONE", label: "Everyone" },
  { value: "MEMBERS", label: "Members only" },
]

/// "Not valid on sale items", as the two things it can actually mean — worded
/// from the shop's side rather than the engine's, whose word is `EXCLUDE`.
const MARKDOWNS: readonly Tile<MarkdownPolicy>[] = [
  { value: "EXCLUDE", label: "Not on sale items" },
  { value: "ALLOW", label: "Sale items too" },
]

/// "This offer cannot be combined with any other", as the two things a shop
/// can mean by it.
///
/// Every promotion written before this control existed means the first one,
/// which is why it is the default here as well as in the engine: a shop that
/// has been running an exclusive offer all season has been suppressing
/// everything else with it, and quietly narrowing that would let offers through
/// that nobody decided to let through.
const EXCLUSIVES: readonly Tile<ExclusiveScope>[] = [
  { value: "BASKET", label: "Blocks every other offer" },
  { value: "LINE", label: "Blocks offers on its items" },
]

/// What a points offer is worth on an item a better points offer already
/// reached, written against the everyday rate — the one a shop leaves running
/// all year and the only thing "double points" is a number against.
const POINTS: readonly Tile<PointsCombination>[] = [
  { value: "HIGHEST", label: "Best rate only" },
  { value: "ADD", label: "Add the extra" },
  { value: "COMPOUND", label: "Multiply" },
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
  const [buyQuantity, setBuyQuantity] = useState("2")
  const [getQuantity, setGetQuantity] = useState("1")
  const [rewardPercentOff, setRewardPercentOff] = useState("100")
  const [amount, setAmount] = useState("")
  const [couponCode, setCouponCode] = useState("")
  const [budget, setBudget] = useState("")
  const [maxUses, setMaxUses] = useState("")
  const [maxPerCustomer, setMaxPerCustomer] = useState("")
  const [priority, setPriority] = useState("0")
  /// Excluded by default, which is the locked rule and what the shop means by
  /// "not valid on sale items". Stacking on a markdown has to be chosen out
  /// loud — the other way round, it happens silently and shows up in margin.
  const [markdownPolicy, setMarkdownPolicy] =
    useState<MarkdownPolicy>("EXCLUDE")
  /// The whole sale by default, which is what every promotion published so far
  /// means. Narrowing an exclusive offer to its own goods is a real decision
  /// and is made here rather than inherited.
  const [exclusiveScope, setExclusiveScope] = useState<ExclusiveScope>("BASKET")
  /// The best rate takes the item, which is the arithmetic the engine already
  /// did. Adding or compounding gives more points away than any published rule
  /// promised, so neither can be the default.
  const [pointsCombination, setPointsCombination] =
    useState<PointsCombination>("HIGHEST")

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
  /// matches on; a term that says `PRIA` is a term nobody checks.
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
  const rewardBps =
    rewardPercentOff.trim() === ""
      ? null
      : Math.round(Number(rewardPercentOff) * 100)
  const positiveWhole = (value: string) => {
    const number = Number(value.trim())
    return value.trim() !== "" && Number.isSafeInteger(number) && number > 0
      ? number
      : null
  }
  const buy = positiveWhole(buyQuantity)
  const get = positiveWhole(getQuantity)
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
      case "BUY_X_GET_Y":
      case "FREE_ITEM":
        return buy === null ||
          get === null ||
          (effectKind === "BUY_X_GET_Y" &&
            (rewardBps === null ||
              !Number.isFinite(rewardBps) ||
              rewardBps <= 0 ||
              rewardBps > 10_000))
          ? null
          : {
              kind: "BUY_X_GET_Y",
              buy,
              get,
              reward_bps: effectKind === "FREE_ITEM" ? 10_000 : rewardBps!,
            }
      case "EARN_POINTS":
        return amountMinor === null
          ? null
          : {
              kind: "EARN_POINTS",
              mode: "SPEND_RATE",
              spend_per_point: { minor: amountMinor },
            }
      default:
        return null
    }
  })()

  const problem =
    name.trim() === ""
      ? "Give the promotion a name."
      : needsCodes && chosen.length === 0
        ? "Choose what it applies to."
        : effect === null
          ? "Set the discount."
          : endsAt !== null && startsAt !== null && endsAt <= startsAt
            ? "The end date has to be after the start."
            : actor === ""
              ? "Sign in to publish."
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
          coupon_code: code !== "" ? code : null,
          max_discount: null,
          caps: {
            budget: budgetMinor === null ? null : { minor: budgetMinor },
            spent: { minor: 0 },
            max_uses: maxUses.trim() === "" ? null : Number(maxUses),
            used: 0,
          },
          // Beside `caps` rather than in it: every limit in there is about the
          // promotion and is answered from the price book, while this one is
          // about the shopper and is counted from their own history at the
          // centre.
          max_uses_per_customer:
            maxPerCustomer.trim() === "" ? null : Number(maxPerCustomer),
          priority: Number(priority) || 0,
          stacking: "ALONE",
          exclusive_scope: exclusiveScope,
          advisory: false,
          markdown_policy: markdownPolicy,
          // The locked basis: the goods after every discount, before tax. Not
          // a form field, because it is a policy the estate settled rather
          // than a choice a promotion makes — a rule that wanted another
          // basis would be arguing with the loyalty scheme, not configuring
          // itself.
          earn_basis: "POST_DISCOUNT_NET",
          points_combination: pointsCombination,
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
          code !== ""
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

  /// How many of the folded settings are off their defaults, so a closed
  /// "More options" still says that something inside it is set.
  const tuned = [
    members,
    markdownPolicy !== "EXCLUDE",
    exclusiveScope !== "BASKET",
    code !== "",
    Number(minQuantity) > 0,
    (minorOf(minAmount) ?? 0) > 0,
    budget.trim() !== "",
    maxUses.trim() !== "",
    maxPerCustomer.trim() !== "",
    (Number(priority) || 0) !== 0,
  ].filter(Boolean).length

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New promotion"
      id={`v${nextVersion}`}
      width="wide"
      // Two thirds of the glass rather than the `wide` default's 46rem cap:
      // the form and the terms it reads back sit side by side.
      className="md:w-[clamp(32rem,66vw,58rem)]"
      footer={
        <div className="flex items-center justify-between gap-3">
          {/* What is stopping the button, said BESIDE the button — the one
              place somebody looking at a disabled Publish is looking. */}
          <span
            className={cn(
              "min-w-0 truncate text-[0.875rem]",
              problem !== undefined ? "text-bad" : "text-text"
            )}
          >
            {problem ?? reads(effect, scopeKind, chosen, members)}
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
        <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] @3xl:gap-x-8">
          <div className="flex flex-col gap-6">
            <Section title="Promotion">
              <div className="grid gap-3 @lg:grid-cols-2">
                <Field label="Name">
                  <Input
                    value={name}
                    autoFocus
                    placeholder="20% off outerwear"
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                <Field label="Campaign">
                  <PickOne
                    choices={campaigns.map((one) => ({
                      value: one.campaign.campaign_id,
                      label: one.campaign.name,
                    }))}
                    value={campaignId}
                    onChange={setCampaignId}
                    placeholder="None"
                    label="The campaign this offer belongs to"
                  />
                </Field>
              </div>
            </Section>

            <Section title="Discount">
              <Choices
                options={EFFECTS}
                value={effectKind}
                onChange={setEffectKind}
                columns={3}
                className="grid-cols-2"
                label="What this promotion does"
              />

              {effectKind === "PERCENT" ? (
                <Field label="Percent off">
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
              ) : effectKind === "BUY_X_GET_Y" || effectKind === "FREE_ITEM" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Buy">
                      <Stepper
                        value={buyQuantity}
                        onChange={setBuyQuantity}
                        suffix="items"
                        placeholder="2"
                        label="Units to buy in each bundle"
                      />
                    </Field>
                    <Field label={effectKind === "FREE_ITEM" ? "Free" : "Get"}>
                      <Stepper
                        value={getQuantity}
                        onChange={setGetQuantity}
                        suffix="items"
                        placeholder="1"
                        label="Rewarded units in each bundle"
                      />
                    </Field>
                  </div>
                  {effectKind === "BUY_X_GET_Y" && (
                    <Field label="Discount on the items you get">
                      <Dial
                        value={rewardPercentOff}
                        onChange={setRewardPercentOff}
                        max={100}
                        tick={10}
                        suffix="%"
                        marks={[25, 50, 75, 100]}
                        placeholder="100"
                        label="Discount on rewarded units"
                      />
                    </Field>
                  )}
                </>
              ) : (
                <Field
                  label={
                    effectKind === "AMOUNT"
                      ? "Amount off the basket"
                      : effectKind === "FIXED_UNIT_PRICE"
                        ? "Price each"
                        : "Spend per point"
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

              {/* Only under a points offer. A control that does nothing on the
                  four money effects would look authored and change nothing. */}
              {effectKind === "EARN_POINTS" && (
                <Question label="With a better points offer">
                  <Choices
                    options={POINTS}
                    value={pointsCombination}
                    onChange={setPointsCombination}
                    columns={3}
                    className="grid-cols-3"
                    label="What this rate is worth on an item a better rate already reached"
                  />
                </Question>
              )}
            </Section>

            <Section title="Applies to">
              <Choices
                options={SCOPES}
                value={scopeKind}
                onChange={setScopeKind}
                columns={3}
                className="grid-cols-2"
                label="What this promotion matches"
              />

              {scopeKind === "ARTICLE" && (
                <Field label="Articles">
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
                <Field label="SKUs">
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
                  label="Divisions"
                  problem={
                    divisionList.failed
                      ? "The division list is not answering."
                      : undefined
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
                  label="Tags"
                  problem={
                    tagList.failed
                      ? "The tag list is not answering."
                      : undefined
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
            </Section>

            {/* A day, not a minute, at each end: it starts at the first minute
                of the day it runs from and stops after the last minute of the
                day it runs until. */}
            <Section title="Schedule">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Starts">
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
                <Field label="Ends">
                  <Day
                    value={to}
                    onChange={setTo}
                    placeholder="No end date"
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
            </Section>

            {/* Everything below is optional and most offers leave it alone,
                so it is folded away rather than asked on every promotion. */}
            <More count={tuned}>
              <Question label="Who can use it">
                <Choices
                  options={AUDIENCE}
                  value={members ? "MEMBERS" : "EVERYONE"}
                  onChange={(next) => setMembers(next === "MEMBERS")}
                  columns={2}
                  className="grid-cols-2"
                  label="Who this promotion is for"
                />
              </Question>

              <Question label="Items already on sale">
                <Choices
                  options={MARKDOWNS}
                  value={markdownPolicy}
                  onChange={setMarkdownPolicy}
                  columns={2}
                  className="grid-cols-2"
                  label="Whether this promotion applies to marked-down goods"
                />
              </Question>

              {/* Every rule this form writes stands on its own — `stacking` is
                  ALONE above — so this is always the live question: when it
                  applies, what does it push out of the way? */}
              <Question label="Other offers">
                <Choices
                  options={EXCLUSIVES}
                  value={exclusiveScope}
                  onChange={setExclusiveScope}
                  columns={2}
                  className="grid-cols-2"
                  label="How much of the basket this promotion shuts other offers out of"
                />
              </Question>

              <Field label="Coupon code">
                <Input
                  value={couponCode}
                  placeholder="None needed"
                  className="font-mono uppercase placeholder:font-sans placeholder:normal-case"
                  onChange={(event) => setCouponCode(event.target.value)}
                />
              </Field>

              {/* Counted over what the rule MATCHES, not over the basket —
                  `check_conditions` in `engine.rs` sums the matched lines
                  alone, so the labels say "matching" on every scope but the
                  whole cart. */}
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={
                    scopeKind === "WHOLE_CART"
                      ? "Min. items in basket"
                      : "Min. matching items"
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
                      ? "Min. basket value"
                      : "Min. matching value"
                  }
                >
                  <Money
                    value={minAmount}
                    onChange={setMinAmount}
                    prefix="Rp"
                    placeholder="Any"
                    label="Least value of the matching lines"
                  />
                </Field>
              </div>

              <div className="grid gap-3 @lg:grid-cols-3">
                <Field label="Budget">
                  <Money
                    value={budget}
                    onChange={setBudget}
                    prefix="Rp"
                    placeholder="Unlimited"
                    label="Budget"
                  />
                </Field>
                <Field label="Max. baskets">
                  <Stepper
                    value={maxUses}
                    onChange={setMaxUses}
                    min={1}
                    placeholder="Unlimited"
                    label="Most baskets"
                  />
                </Field>
                <Field label="Max. per shopper">
                  <Stepper
                    value={maxPerCustomer}
                    onChange={setMaxPerCustomer}
                    min={1}
                    placeholder="Unlimited"
                    label="Most baskets for one shopper"
                  />
                </Field>
              </div>

              {/* Ascending since D03: the lower number is reached first, and
                  with offers that combine each one works on what the previous
                  one left. */}
              <Field label="Priority" className="max-w-[13rem]">
                <Stepper
                  value={priority}
                  onChange={setPriority}
                  max={99}
                  placeholder="0"
                  label="Priority"
                />
              </Field>
            </More>
          </div>

          {/* The combination, read back. Every control on the left writes one
              field; this is the only place all of them are said together, and
              it is where a promotion that would never have fired gets caught.
              Pinned while the form scrolls, so it is read beside the answers
              that change it. */}
          <div className="@3xl:sticky @3xl:top-0 @3xl:self-start">
            <Section title="Summary">
              <Terms
                headline={
                  effect === null ? "Not complete" : describeEffect(effect)
                }
                name={name}
                empty="Choose a discount and what it applies to."
                clauses={reading?.clauses ?? []}
                hidden={[
                  ...(reading?.hidden ?? []),
                  // Said here rather than under the field: a till keeps no
                  // shopper history, so until the count reaches the shops
                  // the engine refuses this offer at the counter instead of
                  // handing it out unlimited — and it needs the shopper
                  // identified, so it is a members' offer whatever is chosen.
                  maxPerCustomer.trim() !== "" &&
                    `each shopper gets it at most ${count(Number(maxPerCustomer))} times, so the till must identify them`,
                ]}
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
