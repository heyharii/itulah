import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Banknote,
  Barcode,
  Coins,
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
import { endOfDay, isoOf, shift, startOfDay, today } from "@/lib/calendar"
import { FindMany, type Found } from "@/components/ui/find"
import {
  Choices,
  Dial,
  Section,
  Stepper,
  type Tile,
} from "@/components/ui/form"
import { More, Question, Terms } from "@/screens/commercial/controls"
import {
  capsOf,
  conditionsOf,
  describeEffect,
  percent,
  scopeOf,
  termsOf,
  useActor,
} from "@/screens/commercial/shared"
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
///    while the stock still says it is on the shelf. So there is no tile for
///    it: "buy two, get one free" is Buy X get Y at 100%, said on that field.
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

/// A published promotion the form starts from.
///
/// `change` publishes under the SAME `rule_id` in a newer book, which is how
/// the fleet already reads an amendment — `load_rules` keeps the newest book
/// per rule id, the same path pause and resume take — so it is a new version,
/// never an edit of the old one. `duplicate` mints a new id.
export interface RuleSeed {
  readonly mode: "change" | "duplicate"
  readonly rule: Rule
}

/// The form's answers, read off a published rule. Codes stand in for names:
/// the rule carries only codes, and the pickers show what they are given.
function startingPoint(seed: RuleSeed) {
  const rule = seed.rule
  const on = scopeOf(rule).applicability
  const conditions = conditionsOf(rule)
  const caps = capsOf(rule)
  const effect = rule.effect
  const found = (codes: readonly string[]): Found[] =>
    codes.map((code) => ({ value: code, label: code }))
  const text = (value: number | null | undefined) =>
    value === null || value === undefined || value === 0 ? "" : String(value)
  const dayOf = (iso: string | null) =>
    iso === null ? "" : isoOf(new Date(iso))
  return {
    name: seed.mode === "duplicate" ? `${rule.name} (copy)` : rule.name,
    campaignId: rule.campaign_id,
    scopeKind: (on === null ? "WHOLE_CART" : on.on) as ScopeKind,
    articles: on?.on === "ARTICLE" ? found(on.article_codes) : [],
    products: on?.on === "SKU" ? found(on.sku_codes) : [],
    divisions: on?.on === "DIVISION" ? [...on.divisions] : [],
    tags: on?.on === "TAG" ? [...on.tags] : [],
    members: scopeOf(rule).customers.who === "MEMBERS",
    minQuantity: text(conditions.min_quantity),
    minAmount: text(conditions.min_amount.minor),
    from: dayOf(conditions.effective_from),
    to: dayOf(conditions.effective_to),
    effectKind: effect.kind as EffectKind,
    percentOff: effect.kind === "PERCENT" ? String(effect.bps / 100) : "",
    buyQuantity: effect.kind === "BUY_X_GET_Y" ? String(effect.buy) : "2",
    getQuantity: effect.kind === "BUY_X_GET_Y" ? String(effect.get) : "1",
    rewardPercentOff:
      effect.kind === "BUY_X_GET_Y" ? String(effect.reward_bps / 100) : "100",
    amount:
      effect.kind === "AMOUNT"
        ? String(effect.amount.minor)
        : effect.kind === "FIXED_UNIT_PRICE"
          ? String(effect.unit_price.minor)
          : effect.kind === "EARN_POINTS" && effect.mode === "SPEND_RATE"
            ? String(effect.spend_per_point.minor)
            : "",
    // A code unlocks one promotion. A copy that kept it would take the code
    // over from the original.
    couponCode: seed.mode === "duplicate" ? "" : (rule.coupon_code ?? ""),
    budget: text(caps.budget?.minor),
    maxUses: text(caps.max_uses),
    maxPerCustomer: text(rule.max_uses_per_customer),
    priority: String(rule.priority),
    markdownPolicy: (rule.markdown_policy ?? "EXCLUDE") as MarkdownPolicy,
    exclusiveScope: (rule.exclusive_scope ?? "BASKET") as ExclusiveScope,
    pointsCombination: (rule.points_combination ??
      "HIGHEST") as PointsCombination,
  }
}

export function RuleForm({
  open,
  campaigns,
  nextVersion,
  seed = null,
  campaignPreset = null,
  onClose,
  onPublished,
}: {
  open: boolean
  campaigns: readonly CampaignRow[]
  nextVersion: number
  /// Where the answers start. Read once, on mount — the caller keys the form
  /// by it.
  seed?: RuleSeed | null
  /// The campaign to preselect, from `?campaign=` on the way in.
  campaignPreset?: string | null
  onClose: () => void
  onPublished: (receipt: PublishReceipt) => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const [start] = useState(() => (seed === null ? null : startingPoint(seed)))

  const [name, setName] = useState(start?.name ?? "")
  const [campaignId, setCampaignId] = useState<string | null>(
    start !== null ? start.campaignId : campaignPreset
  )
  const [scopeKind, setScopeKind] = useState<ScopeKind>(
    start?.scopeKind ?? "ARTICLE"
  )
  // One held list per scope, rather than one shared box of text. Switching
  // from articles to divisions and back should not have thrown away the
  // articles,
  // and with a single `codes` string it always did.
  const [articles, setArticles] = useState<readonly Found[]>(
    start?.articles ?? []
  )
  const [products, setProducts] = useState<readonly Found[]>(
    start?.products ?? []
  )
  const [divisions, setDivisions] = useState<readonly string[]>(
    start?.divisions ?? []
  )
  const [tags, setTags] = useState<readonly string[]>(start?.tags ?? [])
  const [members, setMembers] = useState(start?.members ?? false)
  const [minQuantity, setMinQuantity] = useState(start?.minQuantity ?? "")
  const [minAmount, setMinAmount] = useState(start?.minAmount ?? "")
  const [from, setFrom] = useState(start?.from ?? "")
  const [to, setTo] = useState(start?.to ?? "")
  const [effectKind, setEffectKind] = useState<EffectKind>(
    start?.effectKind ?? "PERCENT"
  )
  const [percentOff, setPercentOff] = useState(start?.percentOff ?? "")
  const [buyQuantity, setBuyQuantity] = useState(start?.buyQuantity ?? "2")
  const [getQuantity, setGetQuantity] = useState(start?.getQuantity ?? "1")
  const [rewardPercentOff, setRewardPercentOff] = useState(
    start?.rewardPercentOff ?? "100"
  )
  const [amount, setAmount] = useState(start?.amount ?? "")
  const [couponCode, setCouponCode] = useState(start?.couponCode ?? "")
  const [budget, setBudget] = useState(start?.budget ?? "")
  const [maxUses, setMaxUses] = useState(start?.maxUses ?? "")
  const [maxPerCustomer, setMaxPerCustomer] = useState(
    start?.maxPerCustomer ?? ""
  )
  const [priority, setPriority] = useState(start?.priority ?? "0")
  /// Excluded by default, which is the locked rule and what the shop means by
  /// "not valid on sale items". Stacking on a markdown has to be chosen out
  /// loud — the other way round, it happens silently and shows up in margin.
  const [markdownPolicy, setMarkdownPolicy] = useState<MarkdownPolicy>(
    start?.markdownPolicy ?? "EXCLUDE"
  )
  /// The whole sale by default, which is what every promotion published so far
  /// means. Narrowing an exclusive offer to its own goods is a real decision
  /// and is made here rather than inherited.
  const [exclusiveScope, setExclusiveScope] = useState<ExclusiveScope>(
    start?.exclusiveScope ?? "BASKET"
  )
  /// The best rate takes the item, which is the arithmetic the engine already
  /// did. Adding or compounding gives more points away than any published rule
  /// promised, so neither can be the default.
  const [pointsCombination, setPointsCombination] = useState<PointsCombination>(
    start?.pointsCombination ?? "HIGHEST"
  )
  /// Problems are said at their fields once somebody has pressed Publish, or
  /// has left the name empty — not on the first keystroke.
  const [tried, setTried] = useState(false)
  const [nameLeft, setNameLeft] = useState(false)
  /// What each SKU picked costs, from the search that found it, so the till
  /// preview can ring up a real price instead of a sample.
  const [skuPrices, setSkuPrices] = useState<ReadonlyMap<string, number>>(
    () => new Map()
  )

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
  /// The rule being changed or copied. Whatever the form has no control for —
  /// excluded SKUs, shops, hours, a cap per basket — is carried over from it
  /// rather than dropped.
  const base = seed?.rule ?? null
  const seedEffect = base?.effect ?? null
  const changing = seed?.mode === "change"

  const effect: Effect | null = (() => {
    switch (effectKind) {
      case "PERCENT":
        return bps === null || !Number.isFinite(bps) || bps <= 0
          ? null
          : {
              kind: "PERCENT",
              bps,
              // Kept from the rule being changed; the form has no control for it.
              compound:
                seedEffect?.kind === "PERCENT" ? seedEffect.compound : false,
            }
      case "AMOUNT":
        return amountMinor === null
          ? null
          : { kind: "AMOUNT", amount: { minor: amountMinor } }
      case "FIXED_UNIT_PRICE":
        return amountMinor === null
          ? null
          : { kind: "FIXED_UNIT_PRICE", unit_price: { minor: amountMinor } }
      case "BUY_X_GET_Y":
        return buy === null ||
          get === null ||
          rewardBps === null ||
          !Number.isFinite(rewardBps) ||
          rewardBps <= 0 ||
          rewardBps > 10_000
          ? null
          : { kind: "BUY_X_GET_Y", buy, get, reward_bps: rewardBps }
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

  /// Each refusal, where it belongs. The name once it has been left, the rest
  /// once Publish has been pressed; the dates at once, since both were picked.
  const nameProblem =
    name.trim() === "" ? "Give the promotion a name." : undefined
  const scopeProblem =
    needsCodes && chosen.length === 0 ? "Choose what it applies to." : undefined
  const effectProblem = effect === null ? "Set the discount." : undefined
  const dateProblem =
    endsAt !== null && startsAt !== null && endsAt <= startsAt
      ? "The end date has to be after the start."
      : undefined
  const problem =
    nameProblem ??
    effectProblem ??
    scopeProblem ??
    dateProblem ??
    (actor === "" ? "Sign in to publish." : undefined)

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
          // A paused promotion stays paused through a change; the switch is
          // what resumes it.
          status: changing && base?.status === "PAUSED" ? "PAUSED" : "ACTIVE",
          scope: {
            excluded_sku_codes: [],
            site_ids: [],
            channels: [],
            effect_on: null,
            ...(base === null ? {} : scopeOf(base)),
            // "Everything" has no tile; a rule that said it keeps saying it
            // until somebody picks a scope.
            applicability:
              base !== null &&
              scopeOf(base).applicability === null &&
              scopeKind === "WHOLE_CART"
                ? null
                : applicabilityOf(scopeKind, chosen),
            customers: { who: members ? "MEMBERS" : "EVERYONE" },
          },
          conditions: {
            max_quantity: null,
            max_amount: null,
            days: { iso_weekdays: [] },
            time_window: null,
            ...(base === null ? {} : conditionsOf(base)),
            min_quantity: minQuantity.trim() === "" ? 0 : Number(minQuantity),
            min_amount: { minor: minorOf(minAmount) ?? 0 },
            effective_from: startsAt,
            effective_to: endsAt,
          },
          effect,
          coupon_code: code !== "" ? code : null,
          max_discount: base?.max_discount ?? null,
          caps: {
            budget: budgetMinor === null ? null : { minor: budgetMinor },
            // A change is the same promotion, so what it has spent so far
            // goes with it; a copy starts from nothing.
            spent: changing && base !== null ? capsOf(base).spent : { minor: 0 },
            max_uses: maxUses.trim() === "" ? null : Number(maxUses),
            used: changing && base !== null ? capsOf(base).used : 0,
          },
          // Beside `caps` rather than in it: every limit in there is about the
          // promotion and is answered from the price book, while this one is
          // about the shopper and is counted from their own history at the
          // centre.
          max_uses_per_customer:
            maxPerCustomer.trim() === "" ? null : Number(maxPerCustomer),
          priority: Number(priority) || 0,
          stacking: base?.stacking ?? "ALONE",
          exclusive_scope: exclusiveScope,
          advisory: base?.advisory ?? false,
          markdown_policy: markdownPolicy,
          // The locked basis: the goods after every discount, before tax. Not
          // a form field, because it is a policy the estate settled rather
          // than a choice a promotion makes — a rule that wanted another
          // basis would be arguing with the loyalty scheme, not configuring
          // itself.
          earn_basis: base?.earn_basis ?? "POST_DISCOUNT_NET",
          points_combination: pointsCombination,
          max_points: base?.max_points ?? null,
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
      // A change keeps the id, so the newer book supersedes the old version
      // at every till; anything else is a new promotion.
      const ruleId =
        changing && base !== null
          ? base.rule_id
          : `rule-${crypto.randomUUID().slice(0, 8)}`
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
                // And its shops: left out, the restatement widens the campaign
                // to every shop (see `campaignFor` in promotions.tsx).
                site_ids: campaign.campaign.site_ids ?? [],
              },
            ]

      return writeAndPublish({
        ...NOTHING_TO_PUBLISH,
        version: nextVersion,
        name: `${changing ? "Change" : "Promotion"}: ${name.trim()}`,
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
      setTried(false)
      setNameLeft(false)
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
      title={
        changing
          ? "Change promotion"
          : seed?.mode === "duplicate"
            ? "Duplicate promotion"
            : "New promotion"
      }
      id={changing ? base?.rule_id : undefined}
      width="wide"
      // Two thirds of the glass rather than the `wide` default's 46rem cap:
      // the form and the terms it reads back sit side by side.
      className="md:w-[clamp(32rem,66vw,58rem)]"
      footer={
        <div className="flex items-center justify-between gap-3">
          {/* What is stopping the button, said BESIDE the button — once
              somebody has pressed it. Before that, the offer in one line.
              Wraps rather than truncates: a refusal cut off is not read. */}
          <span
            className={cn(
              "min-w-0 text-[0.875rem] leading-snug",
              tried && problem !== undefined ? "text-bad" : "text-text"
            )}
          >
            {tried && problem !== undefined
              ? problem
              : reads(effect, scopeKind, chosen, members)}
          </span>
          <Button
            variant="primary"
            pending={publish.isPending}
            disabled={actor === ""}
            onClick={() =>
              problem === undefined ? publish.mutate() : setTried(true)
            }
          >
            {publish.isPending ? "Publishing…" : "Publish"}
          </Button>
        </div>
      }
    >
      {/* Nothing published is edited in place: this goes to every shop as
          the promotion's next version, and theirs stops applying. */}
      {changing && base !== null && (
        <Banner tone="info" className="mb-4">
          Publishing sends this to every shop as the new version of “
          {base.name}”; the one they hold now stops applying.
          {base.status === "PAUSED" && " It stays paused until you resume it."}
        </Banner>
      )}

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
                <Field
                  label="Name"
                  required
                  problem={tried || nameLeft ? nameProblem : undefined}
                >
                  <Input
                    value={name}
                    autoFocus
                    placeholder="20% off outerwear"
                    onBlur={() => setNameLeft(true)}
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
                <Field
                  label="Percent off"
                  required
                  problem={tried ? effectProblem : undefined}
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
              ) : effectKind === "BUY_X_GET_Y" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label="Buy"
                      required
                      problem={
                        tried && buy === null ? "At least one." : undefined
                      }
                    >
                      <Stepper
                        value={buyQuantity}
                        onChange={setBuyQuantity}
                        suffix="items"
                        placeholder="2"
                        label="Units to buy in each bundle"
                      />
                    </Field>
                    <Field
                      label="Get"
                      required
                      problem={
                        tried && get === null ? "At least one." : undefined
                      }
                    >
                      <Stepper
                        value={getQuantity}
                        onChange={setGetQuantity}
                        suffix="items"
                        placeholder="1"
                        label="Rewarded units in each bundle"
                      />
                    </Field>
                  </div>
                  {/* "Buy two, get one free" is this at 100% — there is no
                      separate free-item offer (see the top of this file). */}
                  <Field
                    label="Discount on the items you get"
                    aside="100% makes them free"
                    required
                    problem={
                      tried &&
                      buy !== null &&
                      get !== null &&
                      effectProblem !== undefined
                        ? "Between 1% and 100%."
                        : undefined
                    }
                  >
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
                  required
                  problem={tried ? effectProblem : undefined}
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
                <Field
                  label="Articles"
                  required
                  problem={tried ? scopeProblem : undefined}
                >
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
                <Field
                  label="SKUs"
                  required
                  problem={tried ? scopeProblem : undefined}
                >
                  <FindMany
                    chosen={products}
                    onChange={setProducts}
                    queryKey={(needle) => commercialKeys.products(needle, 20)}
                    search={(needle, signal) =>
                      commercialProducts(needle, 20, signal).then((rows) => {
                        // Kept for the till preview, which rings up the
                        // first SKU picked at its own price.
                        setSkuPrices((known) => {
                          const next = new Map(known)
                          for (const row of rows)
                            next.set(row.sku_code, row.unit_price_minor)
                          return next
                        })
                        return rows.map((row) => ({
                          value: row.sku_code,
                          label: row.sku_code,
                          note: [row.article_name, row.color, row.size]
                            .filter(Boolean)
                            .join(" · "),
                          aside: money(row.unit_price_minor),
                        }))
                      })
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
                  required
                  problem={
                    divisionList.failed
                      ? "The division list is not answering."
                      : tried
                        ? scopeProblem
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
                  required
                  problem={
                    tagList.failed
                      ? "The tag list is not answering."
                      : tried
                        ? scopeProblem
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
                <Field label="Ends" problem={dateProblem}>
                  <Day
                    value={to}
                    onChange={setTo}
                    placeholder="No end date"
                    label="The last day this promotion runs"
                    notBefore={from}
                    presets={[
                      { label: "In a week", value: shift(from || today(), 7) },
                      {
                        label: "In a month",
                        value: shift(from || today(), 30),
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
                <Field
                  label="Max. baskets"
                  // One number, two limits: the coupon is published with it.
                  aside={code !== "" ? "Also the code's limit" : undefined}
                >
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
          <div className="flex flex-col gap-6 @3xl:sticky @3xl:top-0 @3xl:self-start">
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

            {/* The same offer as the cashier's receipt shows it: one line,
                rung up. The terms above say when; this says how much. */}
            <Section title="At the till">
              <TillPreview
                effect={effect}
                item={
                  scopeKind === "SKU" && products.length > 0
                    ? products[0].note || products[0].label
                    : scopeKind === "ARTICLE" && articles.length > 0
                      ? articles[0].label
                      : "Sample item"
                }
                price={
                  scopeKind === "SKU" && products.length > 0
                    ? (skuPrices.get(products[0].value) ?? null)
                    : null
                }
                code={code}
                members={members}
                least={Number(minQuantity) || 0}
                spend={minorOf(minAmount) ?? 0}
              />
            </Section>
          </div>
        </div>
      </div>
    </Sheet>
  )
}

/// A price nobody will mistake for a real one when no product is chosen.
const SAMPLE_PRICE = 199_000

/// One line of the offer, rung up the way the effect computes it.
///
/// Presentational and approximate on purpose: it reads the effect the form
/// is about to send and nothing else, so it can be wrong only by rounding —
/// the till rounds per line, this rounds once.
function TillPreview({
  effect,
  item,
  price: known,
  code,
  members,
  least,
  spend,
}: {
  effect: Effect | null
  item: string
  /// The chosen SKU's own price, or `null` for the sample.
  price: number | null
  code: string
  members: boolean
  least: number
  spend: number
}) {
  if (effect === null)
    return (
      <p className="text-[0.875rem] leading-relaxed text-mute">
        Set the discount to see it rung up.
      </p>
    )

  const price = known ?? SAMPLE_PRICE
  const quantity =
    effect.kind === "BUY_X_GET_Y" ? effect.buy + effect.get : Math.max(1, least)
  const gross = price * quantity
  const off = (() => {
    switch (effect.kind) {
      case "PERCENT":
        return Math.round((gross * effect.bps) / 10_000)
      case "AMOUNT":
        return Math.min(effect.amount.minor, gross)
      case "FIXED_UNIT_PRICE":
        return Math.max(price - effect.unit_price.minor, 0) * quantity
      case "BUY_X_GET_Y":
        return Math.round((price * effect.reward_bps) / 10_000) * effect.get
      default:
        return 0
    }
  })()
  // Below the minimum the offer does not fire, and the receipt says so.
  const short = spend > gross
  const discount = short ? 0 : off
  const total = gross - discount
  const points =
    effect.kind === "EARN_POINTS" &&
    effect.mode === "SPEND_RATE" &&
    effect.spend_per_point.minor > 0 &&
    !short
      ? Math.floor(total / effect.spend_per_point.minor)
      : null

  return (
    <div className="rounded-card border border-hairline bg-canvas px-4 py-3.5 font-mono text-[0.875rem] text-text tabular-nums">
      {(code !== "" || members) && (
        <div className="mb-2.5 border-b border-dashed border-hairline pb-2.5 text-mute">
          {members && <p>Scan the member card</p>}
          {code !== "" && (
            <p>
              Ask for code <span className="text-ink">{code}</span>
            </p>
          )}
        </div>
      )}
      <div className="flex justify-between gap-3">
        <span className="min-w-0 truncate">
          {count(quantity)} × {item}
        </span>
        <span className="shrink-0">{money(gross)}</span>
      </div>
      <p className="pl-4 text-mute">
        @ {money(price)}
        {known === null && " · sample price"}
      </p>
      {discount > 0 && (
        <div className="flex justify-between gap-3 text-ok-fg">
          <span className="min-w-0 truncate">{describeEffect(effect)}</span>
          <span className="shrink-0">−{money(discount)}</span>
        </div>
      )}
      {short && (
        <p className="text-warn-fg">
          Under the {money(spend)} minimum — no discount here.
        </p>
      )}
      <div className="mt-2 flex justify-between gap-3 border-t border-dashed border-hairline pt-2 font-semibold text-ink">
        <span>Total</span>
        <span>{money(total)}</span>
      </div>
      {points !== null && (
        <div className="flex justify-between gap-3 text-mute">
          <span>Points earned</span>
          <span>{count(points)}</span>
        </div>
      )}
      {discount > 0 && (
        <p className="mt-1 text-mute">
          Saved {percent(Math.round((discount / gross) * 10_000))}
        </p>
      )}
    </div>
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
