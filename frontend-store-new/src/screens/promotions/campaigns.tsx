import { ChevronDown, Sparkles, TrendingDown } from "lucide-react"
import { useState } from "react"

import { Card } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { Screen } from "@/components/ui/screen"
import { EmptyState } from "@/components/ui/states"
import { count } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import {
  CampaignBanner,
  Countdown,
  TimeBar,
  DropPill,
  NoPriceBook,
  OfferDetail,
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
} from "@/screens/promotions/shared"
import type { PriceDropWindow, StoreOffer, StoreOffers } from "@itulah/contract"

/// Campaigns — the envelopes head office runs its offers in, as this shop has
/// them.
///
/// A campaign is the thing a shopper was shown a poster about: "Lebaran
/// Sale", with a banner, a headline and small print, holding a handful of
/// promotions and a run of price drops. On the Promotions and Price changes
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
  const { campaigns } = groupCampaigns(offers)

  if (campaigns.length === 0) {
    return (
      <Card>
        <EmptyState>
          No campaign is running or due to start at this shop. Single
          promotions and price changes are on their own screens.
        </EmptyState>
      </Card>
    )
  }

  // Two abreast from a tablet up: a campaign is a poster first, and a poster
  // stretched across 72rem is a strip nobody can make out.
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {campaigns.map((campaign) => (
        <CampaignCard key={campaign.id} campaign={campaign} />
      ))}
    </div>
  )
}

/// One campaign: its poster, what it is called, when it runs, what it holds.
function CampaignCard({ campaign }: { campaign: CampaignGroup }) {
  const promotions = campaign.offers.length
  const drops = campaign.drops.length
  return (
    <Card className="flex h-full flex-col">
      {campaign.hasImage && (
        <CampaignBanner campaign={campaign.id} alt={campaign.title} />
      )}
      <TimeBar
        state={campaign.state}
        startsAt={campaign.startsAt}
        endsAt={campaign.endsAt}
      />
      <div className="px-4 pt-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-h-[2.75rem] min-w-0">
            <h3 className="line-clamp-2 text-card-title font-semibold text-ink">
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

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-t border-hairline pt-3 text-meta">
          <Countdown
            state={campaign.state}
            startsAt={campaign.startsAt}
            endsAt={campaign.endsAt}
            urgentHours={48}
            className="text-[0.9375rem] font-semibold"
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
            {count(drops)} {drops === 1 ? "price change" : "price changes"}
          </span>
        </p>
      </div>

      {promotions + drops > 0 && (
        <div className="mt-auto">
          <Members offers={campaign.offers} drops={campaign.drops} />
        </div>
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
        <OfferMember key={offer.rule_id} offer={offer} />
      ))}
      {drops.map((window) => (
        <li
          key={dropKey(window)}
          className="flex min-h-14 items-center gap-3 border-b border-hairline px-4 py-3 last:border-b-0"
        >
          <TrendingDown className="size-3.5 shrink-0 text-bad-fg" />
          <span className="min-w-0 flex-1 text-cell">
            <span className="block truncate text-ink">Price change</span>
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

/// One promotion in a campaign. Opens in place to its terms, so what the
/// campaign holds can be read without leaving the poster.
function OfferMember({ offer }: { offer: StoreOffer }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-soft/60"
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
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-line-ico transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="bg-soft px-4 pt-1 pb-4">
          <OfferDetail offer={offer} />
        </div>
      )}
    </li>
  )
}
