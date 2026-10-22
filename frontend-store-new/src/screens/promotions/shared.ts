import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { count, label, moment, sku } from "@/lib/format"
import { offersQuery } from "@/lib/queries"
import type {
  Applicability,
  Effect,
  PriceDropWindow,
  StoreOffer,
  StoreOffers,
  TimeWindow,
} from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// The words and the arithmetic every Promotions screen shares.
///
/// Plain functions and hooks only — the drawn parts are in `parts.tsx`. A
/// `.tsx` that exports a helper beside its components loses fast refresh for
/// the whole file, and four screens import from here.
///
/// **One read feeds the whole module.** Promotions, Campaigns, Price
/// changes and Vouchers are four ways of looking at the same `GET /store/offers` answer,
/// under the same query key — so moving between them never asks the node again,
/// and the four can never disagree about what this shop is running.

/// This shop's offers, as its own node decides them.
///
/// `GET /store/offers` runs the pricing engine's own gate — the same one the
/// till runs — so a rule that is `ACTIVE` but outside its window, at the wrong
/// shop, or under a campaign somebody paused is not in the answer. A board that
/// read the `status` column would advertise every one of those.
export function useOffers() {
  return useQuery({
    ...offersQuery(),
    /// A minute, unlike the rest of this app's five.
    ///
    /// Everything else here is a fact that changes when a publication lands.
    /// This one changes *by the clock*: a promotion ends at midnight whether or
    /// not anybody synced, and a board left open on the counter that still
    /// shows it at 00:05 is worse than no board. The countdowns tick locally;
    /// this is what moves an offer from "starting soon" to "running".
    refetchInterval: 60_000,
  })
}

/// Whether the node holds a price book at all.
///
/// `null` is not "no promotions" — it is "nothing has arrived to say", and a
/// shop reading an empty list as the first when it is the second would tell a
/// customer the sale is off when the sync is what is broken.
export function hasPriceBook(offers: StoreOffers): boolean {
  return offers.publication_version !== null
}

/// Where these figures come from, for under the page title.
///
/// The price book's number, because "is the shop on the latest book?" is the
/// first question when a customer says the poster outside promised something
/// the till will not give. Nothing when there is no book: the page body says
/// so at length, and the same sentence twice, one under the other, reads as
/// two problems.
export function provenance(offers: StoreOffers | undefined): string | null {
  if (offers === undefined || offers.publication_version === null) return null
  return `From price book #${count(offers.publication_version)}, as this shop holds it — the same book the till prices from.`
}

/// Every rule the shop holds, running first. The node already orders each half
/// — running by soonest to end, upcoming by soonest to start — and that is the
/// order a cashier needs, so it is kept rather than re-sorted here.
export function allOffers(offers: StoreOffers): StoreOffer[] {
  return [...offers.running, ...offers.upcoming]
}

// ── Where an offer stands ──────────────────────────────────────────────────

/// The three things an offer can be to somebody at the counter.
///
/// `RUNNING` splits in two here and only here. The engine keeps a Saturday-only
/// promotion `RUNNING` all week, because it IS this week's promotion; but on a
/// Tuesday it will not ring up, and "on" in green would send a cashier to
/// promise it. `live_now` is the node's own answer to "this minute", so the
/// screen does not work it out from the weekdays itself.
export type Standing = "on" | "paused-hours" | "soon"

export function standingOf(offer: StoreOffer): Standing {
  if (offer.state === "UPCOMING") return "soon"
  return offer.live_now ? "on" : "paused-hours"
}

/// The status filter the lists share. Three, because "ended" does not exist
/// on a shop: the node drops an offer the minute it stops, and a shop has no
/// use for a list of offers it can no longer give.
export type Phase = "RUNNING" | "UPCOMING" | "ALL"

export function inPhase(state: string, phase: Phase): boolean {
  return phase === "ALL" || state === phase
}

// ── Time ───────────────────────────────────────────────────────────────────

/// A clock that ticks only while something on screen is counting.
///
/// Half a minute, not a second. Nothing here is measured in seconds — the
/// shortest thing a shop cares about is "ends in 12m" — and a per-second
/// re-render of a list is battery a counter tablet spends all day.
export function useNow(active = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

/// "3 days", "5h 20m", "12m". Whole units only.
///
/// A countdown that reads "2 days 4 hours 13 minutes" is a countdown nobody
/// reads. Precision rises as the deadline nears, which is also when it starts
/// to matter: days out, a day is enough; inside an hour, the minute is the
/// whole message.
export function away(iso: string, now: number): string {
  const left = new Date(iso).getTime() - now
  if (!Number.isFinite(left)) return "—"
  if (left <= 0) return "moments"
  const minutes = Math.floor(left / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"} ${hours % 24}h`
  return `${days} days`
}

/// Under six hours, and it is a thing somebody should act on today. A
/// campaign poster asks sooner — two days — so `hours` is the caller's.
export function urgent(iso: string | null, now: number, hours = 6): boolean {
  if (iso === null) return false
  const left = new Date(iso).getTime() - now
  return left > 0 && left < hours * 60 * 60_000
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const

/// ISO weekdays as words. Monday is 1, which is what the engine stores.
export function days(iso: readonly number[]): string {
  return [...iso]
    .sort((a, b) => a - b)
    .map((day) => WEEKDAYS[day - 1] ?? String(day))
    .join(" ")
}

/// Minutes since midnight, as a clock.
export function clockAt(minute: number): string {
  const hours = Math.floor(minute / 60) % 24
  return `${String(hours).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`
}

/// "Sat Sun · 12:00–14:00", or `null` for all day, every day.
///
/// `null` rather than "Every day": in a list, the line that is absent is the
/// ordinary case, and the eye only has to stop on the offers that are
/// restricted. A detail panel that must say it spells the default itself.
export function slot(
  weekdays: readonly number[],
  window: TimeWindow | null,
): string | null {
  const parts = [
    weekdays.length > 0 ? days(weekdays) : null,
    window !== null
      ? `${clockAt(window.from_minute)}–${clockAt(window.to_minute)}`
      : null,
  ].filter((part) => part !== null)
  return parts.length === 0 ? null : parts.join(" · ")
}

/// "12 Sep 10:00 – 30 Sep 23:59", with an open end said as such.
export function span(from: string | null, to: string | null): string {
  if (from === null && to === null) return "No dates"
  if (to === null) return `From ${moment(from)}`
  if (from === null) return `Until ${moment(to)}`
  return `${moment(from)} – ${moment(to)}`
}

// ── What it does ───────────────────────────────────────────────────────────

/// Basis points as a percentage — "20%", "12.5%".
export function percent(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`
}

/// What the offer does, in one line.
///
/// Written against the engine's own `Effect`, so the words on a counter and the
/// arithmetic at the till come from the same declaration. A `kind` this build
/// does not know is described rather than dropped — a newer centre may publish
/// an effect an older shop cannot name, and "a promotion this till cannot
/// describe" is a far better thing to show a cashier than a blank row.
export function describeEffect(effect: Effect): string {
  switch (effect.kind) {
    case "PERCENT":
      return `${percent(effect.bps)} off`
    case "AMOUNT":
      return `${money(effect.amount.minor)} off`
    case "FIXED_UNIT_PRICE":
      return `${money(effect.unit_price.minor)} each`
    case "BUY_X_GET_Y":
      // "Get one free" is the case the business advertises most, and "at 100%
      // off" is a sentence nobody says at a counter.
      return effect.reward_bps >= 10_000
        ? `Buy ${count(effect.buy)}, get ${count(effect.get)} free`
        : `Buy ${count(effect.buy)}, get ${count(effect.get)} at ${percent(effect.reward_bps)} off`
    case "FREE_ITEM": {
      const each =
        effect.every_matched_quantity === null
          ? ""
          : ` for every ${count(effect.every_matched_quantity)}`
      const which =
        effect.sku_code === null ? "free" : `free (${sku(effect.sku_code)})`
      return `${count(effect.quantity)} ${which}${each}`
    }
    case "EARN_POINTS":
      switch (effect.mode) {
        case "SPEND_RATE":
          return `1 point per ${money(effect.spend_per_point.minor)}`
        case "FIXED_POINTS":
          return `${count(effect.points)} ${effect.points === 1 ? "point" : "points"}`
        case "POINTS_PER_QUANTITY":
          return `${count(effect.points)} ${effect.points === 1 ? "point" : "points"} per item`
        default:
          return "Earns points"
      }
    default:
      return "A promotion this till cannot describe"
  }
}

/// What the offer gives, as the figure a card leads with and a plain word under
/// it: "20%" over "off", "Rp 50.000" over "off", "Buy 2 get 1" over "free".
///
/// `describeEffect` is the whole sentence; this is the part of it that is read
/// across a counter in a glance. Short on purpose — the figure is 24px and shares
/// its row with a name.
export function benefitOf(effect: Effect): {
  figure: string
  caption: string
} {
  switch (effect.kind) {
    case "PERCENT":
      return { figure: percent(effect.bps), caption: "off" }
    case "AMOUNT":
      return { figure: money(effect.amount.minor), caption: "off" }
    case "FIXED_UNIT_PRICE":
      return { figure: money(effect.unit_price.minor), caption: "each" }
    case "BUY_X_GET_Y":
      return {
        figure: `Buy ${count(effect.buy)} get ${count(effect.get)}`,
        caption:
          effect.reward_bps >= 10_000
            ? "free"
            : `at ${percent(effect.reward_bps)} off`,
      }
    case "FREE_ITEM":
      return {
        figure: "Free",
        caption: `${count(effect.quantity)} ${effect.sku_code === null ? "item" : sku(effect.sku_code)}${
          effect.every_matched_quantity === null
            ? ""
            : ` for every ${count(effect.every_matched_quantity)}`
        }`,
      }
    case "EARN_POINTS":
      switch (effect.mode) {
        case "SPEND_RATE":
          return {
            figure: "1 point",
            caption: `per ${money(effect.spend_per_point.minor)}`,
          }
        case "FIXED_POINTS":
          return {
            figure: `${count(effect.points)} ${effect.points === 1 ? "point" : "points"}`,
            caption: "earned",
          }
        case "POINTS_PER_QUANTITY":
          return {
            figure: `${count(effect.points)} ${effect.points === 1 ? "point" : "points"}`,
            caption: "per item",
          }
        default:
          return { figure: "Points", caption: "earned" }
      }
    default:
      return { figure: "—", caption: "Not described" }
  }
}

/// How long until an instant, as a figure: "3 days", "5h 20m", "12m". The
/// shorter sibling of `away` for a card's lead, where "3 days 4h" would not fit
/// beside a name.
export function leftIn(iso: string, now: number): string {
  const left = new Date(iso).getTime() - now
  if (!Number.isFinite(left)) return "—"
  if (left <= 0) return "Now"
  const minutes = Math.floor(left / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? "day" : "days"}`
}

/// What it lands on, in one line.
export function describeScope(scope: Applicability | null): string {
  if (scope === null) return "The whole basket"
  switch (scope.on) {
    case "SKU":
      return scope.sku_codes.length === 1
        ? `Article ${sku(scope.sku_codes[0])}`
        : `${count(scope.sku_codes.length)} articles`
    case "ARTICLE":
      return scope.article_codes.length === 1
        ? `Every size and colour of ${scope.article_codes[0]}`
        : `${count(scope.article_codes.length)} styles`
    case "DIVISION":
      return scope.divisions.map(label).join(", ")
    case "TAG":
      return `Tagged ${scope.tags.join(", ")}`
    case "WHOLE_CART":
      return "The whole basket"
    default:
      return "Part of the range"
  }
}

/// The codes a scope names — the SKUs, the styles, the divisions, the tags —
/// so the detail can list what the one-line summary counted.
export function scopeCodes(scope: Applicability | null): readonly string[] {
  if (scope === null) return []
  switch (scope.on) {
    case "SKU":
      return scope.sku_codes.map(sku)
    case "ARTICLE":
      return scope.article_codes
    case "DIVISION":
      return scope.divisions
    case "TAG":
      return scope.tags
    default:
      return []
  }
}

/// What a run of price drops covers: "12 products · 3 whole styles".
export function dropReach(window: PriceDropWindow): string {
  const parts = [
    window.product_count > 0
      ? `${count(window.product_count)} ${window.product_count === 1 ? "article" : "articles"}`
      : null,
    window.range_count > 0
      ? `${count(window.range_count)} whole ${window.range_count === 1 ? "style" : "styles"}`
      : null,
  ].filter((part) => part !== null)
  return parts.length === 0 ? "Nothing listed" : parts.join(" · ")
}

/// A stable key for a price-drop window. A campaign names one run at most; an
/// anonymous run is identified by the dates its members share, which is
/// exactly how the node grouped it.
export function dropKey(window: PriceDropWindow): string {
  return (
    window.campaign_id ??
    `${window.starts_at}|${window.ends_at ?? ""}|${window.weekdays.join(",")}`
  )
}

/// Case-blind "does any of this contain what was typed". `needle` arrives
/// already trimmed and lower-cased, once per keystroke rather than per row.
export function matches(needle: string, ...haystack: (string | null)[]) {
  if (needle === "") return true
  return haystack.some(
    (hay) => hay !== null && hay.toLowerCase().includes(needle),
  )
}

/// Everything a search box can reasonably be asked to find an offer by —
/// including the codes inside its scope, because "is 30101010001 on promo?"
/// is the question most often asked of this screen.
export function offerMatches(offer: StoreOffer, needle: string): boolean {
  return matches(
    needle,
    offer.name,
    offer.campaign_name,
    offer.coupon_code,
    describeEffect(offer.effect),
    describeScope(offer.applies_to),
    ...scopeCodes(offer.applies_to),
  )
}

// ── Campaigns ──────────────────────────────────────────────────────────────

/// One campaign as a shop meets it: the envelope, and what is in it here.
///
/// There is no campaign list on the node, and none is needed — every offer
/// and every price-drop run already names the campaign it belongs to and
/// carries its name, its banner and its small print. So a campaign is
/// assembled from its members, which also means **a campaign with nothing
/// running or due at this shop does not appear**: it is head office's
/// campaign, not this shop's.
export interface CampaignGroup {
  readonly id: string
  /// The poster's headline when a price drop carries one, otherwise the
  /// campaign's name.
  readonly title: string
  /// The campaign's own name, when the headline above is something else.
  readonly name: string | null
  readonly hasImage: boolean
  readonly terms: string | null
  readonly offers: readonly StoreOffer[]
  readonly drops: readonly PriceDropWindow[]
  /// `RUNNING` if anything in it is.
  readonly state: "RUNNING" | "UPCOMING"
  /// The earliest start and the latest end among its members, `null` where
  /// no member states one — for the end, where any member is open-ended.
  readonly startsAt: string | null
  readonly endsAt: string | null
}

/// What is left over: the offers and runs that belong to no campaign.
export interface Loose {
  readonly offers: readonly StoreOffer[]
  readonly drops: readonly PriceDropWindow[]
}

export function groupCampaigns(offers: StoreOffers): {
  campaigns: CampaignGroup[]
  loose: Loose
} {
  const byId = new Map<
    string,
    { offers: StoreOffer[]; drops: PriceDropWindow[] }
  >()
  const looseOffers: StoreOffer[] = []
  const looseDrops: PriceDropWindow[] = []
  const bucket = (id: string) => {
    let found = byId.get(id)
    if (found === undefined) {
      found = { offers: [], drops: [] }
      byId.set(id, found)
    }
    return found
  }

  for (const offer of allOffers(offers)) {
    if (offer.campaign_id === null) looseOffers.push(offer)
    else bucket(offer.campaign_id).offers.push(offer)
  }
  for (const window of offers.price_drops) {
    if (window.campaign_id === null) looseDrops.push(window)
    else bucket(window.campaign_id).drops.push(window)
  }

  const campaigns = [...byId.entries()].map(([id, members]) => {
    const headline =
      members.drops.find((one) => one.name !== null)?.name ?? null
    const name =
      members.offers.find((one) => one.campaign_name !== null)?.campaign_name ??
      null
    const title = headline ?? name ?? id
    const starts = [
      ...members.offers.map((one) => one.starts_at),
      ...members.drops.map((one) => one.starts_at),
    ]
    const ends = [
      ...members.offers.map((one) => one.ends_at),
      ...members.drops.map((one) => one.ends_at),
    ]
    const running =
      members.offers.some((one) => one.state === "RUNNING") ||
      members.drops.some((one) => one.state === "RUNNING")
    return {
      id,
      title,
      name: name !== null && name !== title ? name : null,
      hasImage:
        members.offers.some((one) => one.campaign_has_image) ||
        members.drops.some((one) => one.has_image),
      terms:
        members.drops.find((one) => nonEmpty(one.terms))?.terms ??
        members.offers.find((one) => nonEmpty(one.campaign_terms))
          ?.campaign_terms ??
        null,
      offers: members.offers,
      drops: members.drops,
      state: running ? "RUNNING" : "UPCOMING",
      startsAt: earliest(starts),
      endsAt: ends.some((one) => one === null) ? null : latest(ends),
    } satisfies CampaignGroup
  })

  // Running first, the one about to end at the top; then what is coming, the
  // soonest first. The order a shop is asked about them in.
  campaigns.sort((a, b) => {
    if (a.state !== b.state) return a.state === "RUNNING" ? -1 : 1
    return a.state === "RUNNING"
      ? instant(a.endsAt, Infinity) - instant(b.endsAt, Infinity)
      : instant(a.startsAt, Infinity) - instant(b.startsAt, Infinity)
  })

  return { campaigns, loose: { offers: looseOffers, drops: looseDrops } }
}

function nonEmpty(text: string | null): boolean {
  return text !== null && text.trim() !== ""
}

function instant(iso: string | null, otherwise: number): number {
  if (iso === null) return otherwise
  const at = new Date(iso).getTime()
  return Number.isFinite(at) ? at : otherwise
}

function earliest(isos: readonly (string | null)[]): string | null {
  let best: string | null = null
  for (const iso of isos) {
    if (iso !== null && (best === null || instant(iso, 0) < instant(best, 0)))
      best = iso
  }
  return best
}

function latest(isos: readonly (string | null)[]): string | null {
  let best: string | null = null
  for (const iso of isos) {
    if (iso !== null && (best === null || instant(iso, 0) > instant(best, 0)))
      best = iso
  }
  return best
}
