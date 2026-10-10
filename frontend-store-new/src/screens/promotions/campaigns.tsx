import { ChevronDown } from "lucide-react"
import { useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { CardList } from "@/components/ui/card-list"
import { LeadCard } from "@/components/ui/lead-card"
import { Screen } from "@/components/ui/screen"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { count, moment } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import {
  CampaignBanner,
  Countdown,
  NoPriceBook,
  OfferDetail,
  OfferStatus,
  PhasePill,
  PhaseFilter,
  phaseOptions,
  PhaseStatus,
  SearchBox,
  Summary,
  Toolbar,
} from "@/screens/promotions/parts"
import {
  describeEffect,
  dropKey,
  dropReach,
  groupCampaigns,
  hasPriceBook,
  inPhase,
  leftIn,
  matches,
  span,
  urgent,
  useNow,
  useOffers,
  type CampaignGroup,
  type Phase,
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
/// Each campaign is a lead card: the poster as its thumbnail, the time LEFT of
/// it as the figure (or the time until it starts), what it holds in the foot
/// with its status. It opens a sheet with the poster, the dates, the small
/// print and every promotion and price change in it.
///
/// The hub's Commercial › Campaigns is where a campaign is planned, budgeted
/// and measured. None of that reaches a shop, and none of it should — a shop
/// needs the poster, the dates and what is in it.
export function Campaigns() {
  const offers = useOffers()
  return (
    <Screen>
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
  const [phase, setPhase] = useState<Phase>("ALL")
  const [typed, setTyped] = useState("")
  const [openId, setOpenId] = useState<string | null>(null)
  const needle = typed.trim().toLowerCase()

  if (campaigns.length === 0) {
    return (
      <EmptyState>
        No campaign is active or due to start at this shop. Single promotions
        and price changes are on their own screens.
      </EmptyState>
    )
  }

  const running = campaigns.filter((one) => one.state === "RUNNING").length
  const shown = campaigns.filter(
    (one) =>
      inPhase(one.state, phase) &&
      matches(
        needle,
        one.title,
        one.name,
        one.terms,
        ...one.offers.map((offer) => offer.name),
      ),
  )

  return (
    <>
      <DockTools
        search={{
          value: typed,
          onChange: setTyped,
          label: "Search campaigns",
        }}
        status={{
          value: phase,
          options: phaseOptions(running, campaigns.length - running),
          onChange: (next) => setPhase(next as Phase),
        }}
      />
      <Toolbar>
        <PhaseFilter
          value={phase}
          onChange={setPhase}
          running={running}
          upcoming={campaigns.length - running}
        />
        <SearchBox
          value={typed}
          onChange={setTyped}
          placeholder="Search campaigns"
        />
      </Toolbar>

      <Summary
        parts={[
          [running, "active"],
          [campaigns.length - running, "scheduled"],
        ]}
      />

      {shown.length === 0 ? (
        <EmptyState>
          {needle !== ""
            ? `No campaign here matches “${typed.trim()}”.`
            : phase === "RUNNING"
              ? "No campaign is active right now."
              : "No campaign is due to start."}
        </EmptyState>
      ) : (
        <CardList grid>
          {shown.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              onOpen={() => setOpenId(campaign.id)}
            />
          ))}
        </CardList>
      )}

      <CampaignSheet
        campaign={campaigns.find((one) => one.id === openId)}
        onClose={() => setOpenId(null)}
      />
    </>
  )
}

/// The figure a campaign leads with: how long is left of it, red inside two
/// days — or how long until it starts.
function leadOf(campaign: CampaignGroup, now: number) {
  if (campaign.state === "UPCOMING") {
    return campaign.startsAt === null
      ? { figure: "Soon", caption: "no date yet" }
      : { figure: leftIn(campaign.startsAt, now), caption: "to start" }
  }
  if (campaign.endsAt === null)
    return { figure: "Open", caption: "no end date" }
  return {
    figure: (
      <span className={cn(urgent(campaign.endsAt, now, 48) && "text-bad-fg")}>
        {leftIn(campaign.endsAt, now)}
      </span>
    ),
    caption: "left",
  }
}

/// What a campaign holds at this shop, in a phrase — which is not always all of
/// it: a campaign can carry promotions for shops this is not.
function holds(campaign: CampaignGroup): string {
  const promotions = campaign.offers.length
  const drops = campaign.drops.length
  return `${count(promotions)} ${promotions === 1 ? "promotion" : "promotions"} · ${count(drops)} price ${drops === 1 ? "change" : "changes"}`
}

/// One campaign: its poster, what it is called, when it runs, what it holds.
function CampaignCard({
  campaign,
  onOpen,
}: {
  campaign: CampaignGroup
  onOpen: () => void
}) {
  const now = useNow(true)
  // A poster that will not load is taken away, and the card loses its tile
  // with it rather than showing an empty square.
  const [failed, setFailed] = useState(false)
  return (
    <LeadCard
      onOpen={onOpen}
      media={
        campaign.hasImage && !failed ? (
          <CampaignBanner
            thumb
            campaign={campaign.id}
            alt={campaign.title}
            onFail={() => setFailed(true)}
          />
        ) : undefined
      }
      title={campaign.title}
      lines={[campaign.name, span(campaign.startsAt, campaign.endsAt)]}
      lead={leadOf(campaign, now)}
      foot={{
        info: holds(campaign),
        status: <PhaseStatus state={campaign.state} />,
      }}
    />
  )
}

/// A campaign as a record sheet: its poster, its dates, the small print as the
/// centre wrote it, and everything it holds — each promotion opening in place
/// to its terms, so what the campaign holds can be read without leaving it.
///
/// Kept while it slides away, so closing does not blank the record mid-travel.
function CampaignSheet({
  campaign,
  onClose,
}: {
  campaign: CampaignGroup | undefined
  onClose: () => void
}) {
  const [shown, setShown] = useState<CampaignGroup | undefined>(undefined)
  if (campaign !== undefined && campaign !== shown) setShown(campaign)
  const record = campaign ?? shown

  return (
    <Sheet
      open={campaign !== undefined}
      onOpenChange={(next) => !next && onClose()}
      title={record?.title ?? ""}
      badge={
        record === undefined ? undefined : <PhasePill state={record.state} />
      }
      caption={record?.name ?? undefined}
    >
      {record !== undefined && (
        <div className="flex flex-col gap-6">
          {record.hasImage && (
            <CampaignBanner
              campaign={record.id}
              alt={record.title}
              className="rounded-card border border-hairline"
            />
          )}
          <Facts>
            <Fact term="Starts">
              {record.startsAt === null ? "—" : moment(record.startsAt)}
            </Fact>
            <Fact term="Ends">
              {record.endsAt === null ? "No end date" : moment(record.endsAt)}
            </Fact>
            <Fact term="Countdown" wide>
              <Countdown
                state={record.state}
                startsAt={record.startsAt}
                endsAt={record.endsAt}
                urgentHours={48}
                className="text-ink"
              />
            </Fact>
            {record.terms !== null && (
              <Fact term="Terms" wide>
                <span className="block whitespace-pre-line text-body">
                  {record.terms}
                </span>
              </Fact>
            )}
          </Facts>

          {record.offers.length > 0 && (
            <section>
              <h3 className="mb-2.5 text-card-title font-semibold text-ink">
                Promotions{" "}
                <span className="font-normal text-mute tabular-nums">
                  {count(record.offers.length)}
                </span>
              </h3>
              <ul className="overflow-hidden rounded-card border border-hairline">
                {record.offers.map((offer) => (
                  <OfferMember key={offer.rule_id} offer={offer} />
                ))}
              </ul>
            </section>
          )}

          {record.drops.length > 0 && (
            <section>
              <h3 className="mb-2.5 text-card-title font-semibold text-ink">
                Price changes{" "}
                <span className="font-normal text-mute tabular-nums">
                  {count(record.drops.length)}
                </span>
              </h3>
              <ul className="overflow-hidden rounded-card border border-hairline">
                {record.drops.map((window) => (
                  <DropMember key={dropKey(window)} window={window} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Sheet>
  )
}

/// One price-change run inside a campaign: how much of the range it covers.
function DropMember({ window }: { window: PriceDropWindow }) {
  return (
    <li className="flex min-h-14 items-center gap-3 border-b border-hairline px-3.5 py-3 last:border-b-0">
      <span className="min-w-0 flex-1 text-cell">
        <span className="block truncate text-ink">
          {window.name ?? "Price change"}
        </span>
        <span className="block truncate text-meta text-body tabular-nums">
          {dropReach(window)}
        </span>
      </span>
      <PhaseStatus state={window.state} />
    </li>
  )
}

/// One promotion in a campaign. Opens in place to its terms.
function OfferMember({ offer }: { offer: StoreOffer }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex min-h-14 w-full items-center gap-3 px-3.5 py-3 text-left transition-colors active:bg-soft"
      >
        <span className="min-w-0 flex-1 text-cell">
          <span className="block truncate text-ink">{offer.name}</span>
          <span className="block truncate text-meta text-body">
            {describeEffect(offer.effect)}
            {offer.coupon_code !== null && ` · code ${offer.coupon_code}`}
          </span>
        </span>
        <OfferStatus offer={offer} />
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-line-ico transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="bg-soft px-3.5 pt-1 pb-4">
          <OfferDetail offer={offer} />
        </div>
      )}
    </li>
  )
}
