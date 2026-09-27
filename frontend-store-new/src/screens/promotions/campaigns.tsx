import { Megaphone, Sparkles, TrendingDown } from "lucide-react"

import { Card } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { Screen, Section } from "@/components/ui/screen"
import { EmptyState } from "@/components/ui/states"
import { count } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  CampaignBanner,
  Countdown,
  DropPill,
  NoPriceBook,
  OfferPill,
} from "@/screens/promotions/parts"
import {
  describeEffect,
  dropKey,
  dropReach,
  groupCampaigns,
  hasPriceBook,
  span,
  provenance,
  useOffers,
  type CampaignGroup,
  type Loose,
} from "@/screens/promotions/shared"
import type { PriceDropWindow, StoreOffer, StoreOffers } from "@itulah/contract"

/// Campaigns — the envelopes head office runs its offers in, as this shop has
/// them.
///
/// A campaign is the thing a shopper was shown a poster about: "Lebaran
/// Sale", with a banner, a headline and small print, holding a handful of
/// promotions and a run of price drops. On the Promotions and Price drops
/// screens those members are rows among other rows; here they are put back
/// together, so "what is in the Lebaran sale?" has one place to be answered.
///
/// The hub's Commercial › Campaigns is where a campaign is planned, budgeted
/// and measured. None of that reaches a shop, and none of it should — a shop
/// needs the poster, the dates and what is in it.
export function Campaigns() {
  const offers = useOffers()
  return (
    <Screen sub={provenance(offers.data)}>
      {queryState(offers, {
        loading: "Reading what this shop is offering…",
        render: (answer) =>
          hasPriceBook(answer) ? (
            <CampaignBoard offers={answer} />
          ) : (
            <NoPriceBook />
          ),
      })}
    </Screen>
  )
}

function CampaignBoard({ offers }: { offers: StoreOffers }) {
  const { campaigns, loose } = groupCampaigns(offers)
  const looseCount = loose.offers.length + loose.drops.length

  if (campaigns.length === 0 && looseCount === 0) {
    return (
      <Card>
        <EmptyState>
          Head office has nothing on offer at this shop — no campaign, no
          promotion and no price drop is running or due to start.
        </EmptyState>
      </Card>
    )
  }

  return (
    <>
      {campaigns.length === 0 ? (
        <Card className="mb-5">
          <EmptyState>
            None of what this shop is offering belongs to a campaign — they are
            listed below as they are.
          </EmptyState>
        </Card>
      ) : (
        // Two abreast from a tablet up: a campaign is a poster first, and a
        // poster stretched across 72rem is a strip nobody can make out.
        <div className="mb-6 grid items-start gap-3 md:grid-cols-2">
          {campaigns.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} />
          ))}
        </div>
      )}

      {looseCount > 0 && <LooseSection loose={loose} />}
    </>
  )
}

/// One campaign: its poster, what it is called, when it runs, what it holds.
function CampaignCard({ campaign }: { campaign: CampaignGroup }) {
  const promotions = campaign.offers.length
  const drops = campaign.drops.length
  return (
    <Card>
      {campaign.hasImage && (
        <CampaignBanner campaign={campaign.id} alt={campaign.title} />
      )}
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-card-title font-semibold text-ink">
              {campaign.title}
            </h3>
            {campaign.name !== null && (
              <p className="text-meta text-mute">{campaign.name}</p>
            )}
          </div>
          {campaign.state === "RUNNING" ? (
            <Pill tone="ok">Running</Pill>
          ) : (
            <Pill tone="info">Starting soon</Pill>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta">
          <Countdown
            state={campaign.state}
            startsAt={campaign.startsAt}
            endsAt={campaign.endsAt}
          />
          <span className="text-mute tabular-nums">
            {span(campaign.startsAt, campaign.endsAt)}
          </span>
        </div>

        {campaign.terms !== null && (
          // The small print as the centre wrote it, clamped: it is read in
          // full on the poster, and three lines are enough to recognise it.
          <p className="mt-2 line-clamp-3 text-meta whitespace-pre-line text-body">
            {campaign.terms}
          </p>
        )}

        {/* How much of the campaign is at this shop — which is not always all
            of it: a campaign can carry promotions for shops this is not. */}
        <p className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-meta text-text tabular-nums">
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3.5 text-line-ico" />
            {count(promotions)} {promotions === 1 ? "promotion" : "promotions"}
          </span>
          <span className="inline-flex items-center gap-1">
            <TrendingDown className="size-3.5 text-line-ico" />
            {count(drops)} {drops === 1 ? "price drop" : "price drops"}
          </span>
        </p>
      </div>

      {promotions + drops > 0 && (
        <Members offers={campaign.offers} drops={campaign.drops} />
      )}
    </Card>
  )
}

/// What a campaign holds, one line each — the promotion and what it gives,
/// the price drop and how much of the range it covers.
function Members({
  offers,
  drops,
}: {
  offers: readonly StoreOffer[]
  drops: readonly PriceDropWindow[]
}) {
  return (
    <ul className="border-t border-hairline">
      {offers.map((offer) => (
        <li
          key={offer.rule_id}
          className="flex min-h-11 items-center gap-3 border-b border-hairline px-4 py-2 last:border-b-0"
        >
          <Sparkles className="size-3.5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 text-cell">
            <span className="block truncate text-ink">{offer.name}</span>
            <span className="block truncate text-meta text-body">
              {describeEffect(offer.effect)}
              {offer.coupon_code !== null && ` · code ${offer.coupon_code}`}
            </span>
          </span>
          <OfferPill offer={offer} />
        </li>
      ))}
      {drops.map((window) => (
        <li
          key={dropKey(window)}
          className="flex min-h-11 items-center gap-3 border-b border-hairline px-4 py-2 last:border-b-0"
        >
          <TrendingDown className="size-3.5 shrink-0 text-bad-fg" />
          <span className="min-w-0 flex-1 text-cell">
            <span className="block truncate text-ink">Price drop</span>
            <span className="block truncate text-meta text-body tabular-nums">
              {dropReach(window)}
            </span>
          </span>
          <DropPill window={window} />
        </li>
      ))}
    </ul>
  )
}

/// The offers that belong to no campaign, listed as they are.
///
/// Not grouped into an invented campaign: a heading like "Other offers" over
/// a card with a banner would put a campaign on the screen that nobody at
/// head office ever authored.
function LooseSection({ loose }: { loose: Loose }) {
  const promotions = loose.offers.length
  const drops = loose.drops.length
  return (
    <Section
      title="Not part of a campaign"
      action={
        <span className="text-meta text-mute tabular-nums">
          {[
            promotions > 0
              ? `${count(promotions)} ${promotions === 1 ? "promotion" : "promotions"}`
              : null,
            drops > 0
              ? `${count(drops)} ${drops === 1 ? "price drop" : "price drops"}`
              : null,
          ]
            .filter((part) => part !== null)
            .join(" · ")}
        </span>
      }
    >
      <Card>
        <div className="flex items-center gap-2.5 bg-soft px-4 py-2.5 text-meta text-body">
          <Megaphone className="size-3.5 shrink-0 text-line-ico" />
          On their own, with no poster or small print from head office.
        </div>
        <Members offers={loose.offers} drops={loose.drops} />
      </Card>
    </Section>
  )
}
