import { useQuery } from "@tanstack/react-query"
import {
  CalendarClock,
  Clock,
  Sparkles,
  TicketPercent,
  TrendingDown,
} from "lucide-react"
import { useEffect, useState } from "react"

import { Pill } from "@/components/ui/pill"
import { CardList, Screen, Section } from "@/components/ui/screen"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, label, moment } from "@/lib/format"
import { fetchOffers, offersKey } from "@/lib/queries"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import type {
  Applicability,
  Effect,
  PriceDropWindow,
  StoreOffer,
} from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// What this shop is running, and what it is about to run.
///
/// The catalogue answers "how much is this", and it always could: a markdown IS
/// the price, so a clearance shows up as a smaller number on the shelf edge
/// with the old one struck through. A **promotion** is not a price — "buy two
/// get one", "20% off menswear over 500rb" — it is a thing that happens to a
/// whole basket at the counter, and nothing on any product screen can show it.
///
/// So a shop could hold six live offers, delivered on the sync lane, resident in
/// its own SQLite, applied correctly by its own till, with nothing anywhere
/// saying it had them. A cashier asked "what promos are on today?" had nowhere
/// to look, and the poster in the window was the only record.
///
/// **The node decides what is on, not this screen.** `GET /store/offers` runs
/// the pricing engine's own gate — the same one the counter runs — so a rule
/// that is `ACTIVE` but outside its window, at the wrong shop, or under a
/// campaign somebody paused does not appear here. A promotions board that read
/// the `status` column would advertise every one of those.
export function Offers() {
  const offers = useQuery({
    queryKey: offersKey(),
    queryFn: ({ signal }) => fetchOffers(signal),
    /// A minute, unlike the rest of this app's five.
    ///
    /// Everything else here is a fact that changes when a publication lands.
    /// This one changes *by the clock*: a promotion ends at midnight whether or
    /// not anybody synced, and a board left on the counter that still shows it
    /// at 00:05 is worse than no board. The countdown below ticks locally; this
    /// is what moves an offer between the two lists.
    refetchInterval: 60_000,
  })

  return (
    <Screen foot="none">
      {queryState(offers, {
        loading: "Reading what this shop is offering…",
        render: (answer) => {
          const nothing =
            answer.running.length === 0 &&
            answer.upcoming.length === 0 &&
            answer.price_drops.length === 0

          if (nothing) {
            return (
              <EmptyState>
                {answer.publication_version === null
                  ? "No price book has reached this shop yet, so it holds no offers. Check the sync."
                  : "This shop is not running any promotions."}
              </EmptyState>
            )
          }

          return (
            <div className="pt-1 pb-6">
              {answer.running.length > 0 && (
                <Section title="Running now">
                  <CardList>
                    {answer.running.map((offer) => (
                      <OfferCard key={offer.rule_id} offer={offer} />
                    ))}
                  </CardList>
                </Section>
              )}

              {answer.upcoming.length > 0 && (
                <Section title="Starting soon">
                  <CardList>
                    {answer.upcoming.map((offer) => (
                      <OfferCard key={offer.rule_id} offer={offer} />
                    ))}
                  </CardList>
                </Section>
              )}

              {answer.price_drops.length > 0 && (
                <Section title="Price drops">
                  <CardList>
                    {answer.price_drops.map((window) => (
                      <DropCard
                        key={
                          window.campaign_id ??
                          `${window.starts_at}|${window.ends_at ?? ""}`
                        }
                        window={window}
                      />
                    ))}
                  </CardList>
                  {/* Where they already are, so nobody goes looking for a list
                      of marked-down products that this screen deliberately does
                      not draw: they are the catalogue, with the old price
                      struck through. */}
                  <p className="mt-2 text-pill text-mute">
                    Marked-down products carry the new price in the catalogue,
                    with the old one struck through.
                  </p>
                </Section>
              )}

              {answer.publication_version !== null && (
                <p className="mt-4 text-pill text-mute">
                  From price book #{count(answer.publication_version)}, as this
                  shop holds it.
                </p>
              )}
            </div>
          )
        },
      })}
    </Screen>
  )
}

function OfferCard({ offer }: { offer: StoreOffer }) {
  const upcoming = offer.state === "UPCOMING"
  const now = useNow(upcoming || offer.ends_at !== null)

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
      {/* A promotion and the price drops beside it wear one face when they are
          one campaign to the business — otherwise the same Lebaran sale reads as
          two unrelated things on one screen. */}
      {offer.campaign_has_image && offer.campaign_id !== null && (
        <Banner campaign={offer.campaign_id} alt={offer.campaign_name ?? ""} />
      )}
      <div className="flex items-start gap-2.5 bg-soft px-3.5 py-3">
        <span className="grid size-[1.6875rem] shrink-0 place-items-center rounded-inner border border-hairline-2 bg-canvas text-accent">
          <Sparkles className="size-[0.9375rem]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-card-title font-semibold text-ink">
            {offer.name}
          </span>
          {/* The envelope, when the business runs several offers as one thing.
              Named on every card in it rather than grouped under a heading:
              five cards under "Lebaran" would imply the five are a sequence,
              and they are not — they are five offers that share one budget. */}
          {offer.campaign_name !== null && (
            <span className="block truncate text-pill text-mute">
              {offer.campaign_name}
            </span>
          )}
        </span>
        {upcoming ? (
          <Pill tone="info">Soon</Pill>
        ) : offer.live_now ? (
          <Pill tone="ok">On</Pill>
        ) : (
          // Inside its dates, outside today's day or hour. Still this week's
          // promotion; simply not this minute.
          <Pill tone="warn">Not now</Pill>
        )}
      </div>

      <div className="px-3.5 py-3">
        <p className="font-medium text-body text-ink">
          {describeEffect(offer.effect)}
        </p>
        <p className="mt-0.5 text-meta text-body">
          {describeScope(offer.applies_to)}
        </p>

        {/* The countdown. Two different sentences and the difference is the
            whole reason this screen exists: one is a deadline a cashier can
            still act on ("ends in 3h 12m" — offer it to the person at the
            counter), the other is a promise not yet kept ("starts in 2 days" —
            do not offer it, and say when). */}
        <div
          className={cn(
            "mt-2.5 flex items-center gap-1.5 text-meta font-medium tabular-nums",
            upcoming
              ? "text-info-fg"
              : urgent(offer.ends_at, now)
                ? "text-bad-fg"
                : "text-body",
          )}
        >
          {upcoming ? (
            <CalendarClock className="size-3.5 shrink-0" />
          ) : (
            <Clock className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 truncate">
            {upcoming
              ? offer.starts_at === null
                ? "Waiting on its campaign"
                : `Starts in ${away(offer.starts_at, now)} · ${moment(offer.starts_at)}`
              : offer.ends_at === null
                ? "No end date"
                : `Ends in ${away(offer.ends_at, now)} · ${moment(offer.ends_at)}`}
          </span>
        </div>

        {(offer.weekdays.length > 0 || offer.time_window !== null) && (
          <p className="mt-1.5 text-pill text-mute">
            {[
              offer.weekdays.length > 0 ? days(offer.weekdays) : null,
              offer.time_window !== null
                ? `${clockAt(offer.time_window.from_minute)}–${clockAt(offer.time_window.to_minute)}`
                : null,
            ]
              .filter((part) => part !== null)
              .join(" · ")}
          </p>
        )}

        {offer.campaign_terms !== null && offer.campaign_terms !== "" && (
          <p className="mt-1.5 text-pill text-mute">{offer.campaign_terms}</p>
        )}

        {(offer.coupon_code !== null ||
          offer.members_only ||
          offer.uses_remaining !== null ||
          offer.budget_remaining_minor !== null) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {offer.coupon_code !== null && (
              <span className="inline-flex items-center gap-1">
                <TicketPercent className="size-3.5 text-accent" />
                <Tag tone="accent">{offer.coupon_code}</Tag>
              </span>
            )}
            {offer.members_only && <Pill tone="accent">Members only</Pill>}
            {offer.uses_remaining !== null && (
              <Pill tone={offer.uses_remaining === 0 ? "bad" : "neutral"}>
                {count(offer.uses_remaining)} left
              </Pill>
            )}
            {offer.budget_remaining_minor !== null && (
              <Pill
                tone={offer.budget_remaining_minor === 0 ? "bad" : "neutral"}
              >
                {money(offer.budget_remaining_minor)} budget
              </Pill>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/// A run of price drops — named and pictured when the business runs it as one
/// thing, anonymous when it is only a set of clearances sharing an end date.
///
/// The two are drawn differently on purpose. A campaign gets a banner because it is
/// something a shopper was shown a poster about; an unnamed window gets a line
/// of text because inventing a name for it would put a promotion on the screen
/// that nobody at head office ever authored.
function DropCard({ window }: { window: PriceDropWindow }) {
  const upcoming = window.state === "UPCOMING"
  const now = useNow(true)
  const what = [
    window.product_count > 0
      ? `${count(window.product_count)} ${window.product_count === 1 ? "product" : "products"}`
      : null,
    window.range_count > 0
      ? `${count(window.range_count)} whole ${window.range_count === 1 ? "style" : "styles"}`
      : null,
  ]
    .filter((part) => part !== null)
    .join(" · ")

  /// When in the week and in the day the price is actually down.
  ///
  /// Drawn for a price drop the way it is drawn for a promotion, and it matters
  /// more here: a promotion outside its hours simply does not fire, while a
  /// clearance outside its hours means **the ticket on the garment is wrong**.
  /// A shop running one needs the hours where it can see them.
  const slot =
    window.weekdays.length > 0 || window.time_window !== null ? (
      <p className="mt-1.5 text-pill text-mute">
        {[
          window.weekdays.length > 0 ? days(window.weekdays) : null,
          window.time_window !== null
            ? `${clockAt(window.time_window.from_minute)}–${clockAt(window.time_window.to_minute)}`
            : null,
        ]
          .filter((part) => part !== null)
          .join(" · ")}
      </p>
    ) : null

  const clock = (
    <p
      className={cn(
        "text-meta tabular-nums",
        upcoming
          ? "text-info-fg"
          : urgent(window.ends_at, now)
            ? "text-bad-fg"
            : "text-body",
      )}
    >
      {upcoming
        ? `Prices drop in ${away(window.starts_at, now)} · ${moment(window.starts_at)}`
        : window.ends_at === null
          ? "No end date"
          : `Back to full price in ${away(window.ends_at, now)} · ${moment(window.ends_at)}`}
    </p>
  )

  if (window.campaign_id === null) {
    return (
      <div className="flex items-start gap-2.5 rounded-card border border-hairline bg-canvas px-3.5 py-3 shadow-soft">
        <span className="grid size-[1.6875rem] shrink-0 place-items-center rounded-inner border border-hairline-2 bg-canvas text-bad-fg">
          <TrendingDown className="size-[0.9375rem]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-card-title font-medium text-ink">{what}</p>
          <div className="mt-1">{clock}</div>
          {slot}
        </div>
        {upcoming ? (
          <Pill tone="info">Soon</Pill>
        ) : (
          <Pill tone="bad">Down</Pill>
        )}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
      {window.has_image && (
        <Banner campaign={window.campaign_id} alt={window.name ?? ""} />
      )}
      <div className="px-3.5 py-3">
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-card-title font-semibold text-ink">
              {window.name}
            </p>
            <p className="mt-0.5 text-meta text-body">{what}</p>
          </div>
          {upcoming ? (
            <Pill tone="info">Soon</Pill>
          ) : (
            <Pill tone="bad">Down</Pill>
          )}
        </div>
        <div className="mt-2">{clock}</div>
        {slot}
        {window.terms !== null && window.terms !== "" && (
          <p className="mt-1.5 text-pill text-mute">{window.terms}</p>
        )}
      </div>
    </div>
  )
}

/// The campaign's poster, through the node's own proxy.
///
/// Never straight at the centre's URL, for the reason a garment's photograph
/// is not either: one banner is shown to everybody in the shop, so it is the
/// single most worthwhile thing in the node's image cache — and pointed at the
/// centre it would be the first thing to go blank when the line drops.
function Banner({ campaign, alt }: { campaign: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={`/api/v1/catalog/campaign-image?campaign=${encodeURIComponent(campaign)}`}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="aspect-[3/1] w-full bg-soft-2 object-cover"
    />
  )
}

/// A clock that ticks only while something on screen is counting.
///
/// A minute, not a second. Nothing here is measured in seconds — the shortest
/// thing a shop cares about is "ends in 12m" — and a per-second re-render of a
/// list of cards is battery a counter tablet spends all day.
function useNow(active: boolean): number {
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
function away(iso: string, now: number): string {
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

/// Under six hours, and it is a thing somebody should act on today.
function urgent(iso: string | null, now: number): boolean {
  if (iso === null) return false
  const left = new Date(iso).getTime() - now
  return left > 0 && left < 6 * 60 * 60_000
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const

/// ISO weekdays as words. Monday is 1, which is what the engine stores.
function days(iso: readonly number[]): string {
  return [...iso]
    .sort((a, b) => a - b)
    .map((day) => WEEKDAYS[day - 1] ?? String(day))
    .join(" ")
}

/// Minutes since midnight, as a clock.
function clockAt(minute: number): string {
  const hours = Math.floor(minute / 60) % 24
  return `${String(hours).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`
}

/// What the offer does, in one line.
///
/// Written against the engine's own `Effect`, so the words on a counter and the
/// arithmetic at the till come from the same declaration. A `kind` this build
/// does not know is described rather than dropped — a newer centre may publish
/// an effect an older shop cannot name, and "a promotion this till cannot
/// describe" is a far better thing to show a cashier than a blank card.
function describeEffect(effect: Effect): string {
  switch (effect.kind) {
    case "PERCENT":
      return `${effect.bps / 100}% off`
    case "AMOUNT":
      return `${money(effect.amount.minor)} off`
    case "FIXED_UNIT_PRICE":
      return `${money(effect.unit_price.minor)} each`
    case "FREE_ITEM": {
      const each =
        effect.every_matched_quantity === null
          ? ""
          : ` for every ${count(effect.every_matched_quantity)}`
      const which =
        effect.sku_code === null ? "free" : `free (${effect.sku_code})`
      return `${count(effect.quantity)} ${which}${each}`
    }
    case "EARN_POINTS":
      return "Earns points"
    default:
      return "A promotion this till cannot describe"
  }
}

/// What it lands on.
function describeScope(scope: Applicability | null): string {
  if (scope === null) return "On the whole basket"
  switch (scope.on) {
    case "SKU":
      return scope.sku_codes.length === 1
        ? `On ${scope.sku_codes[0]}`
        : `On ${count(scope.sku_codes.length)} products`
    case "ARTICLE":
      return scope.article_codes.length === 1
        ? `On every size and colour of ${scope.article_codes[0]}`
        : `On ${count(scope.article_codes.length)} styles`
    case "DIVISION":
      return `On ${scope.divisions.map(label).join(", ")}`
    case "TAG":
      return `On anything tagged ${scope.tags.join(", ")}`
    case "WHOLE_CART":
      return "On the whole basket"
    default:
      return "On part of the range"
  }
}
