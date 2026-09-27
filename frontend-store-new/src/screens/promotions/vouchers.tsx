import { TicketPercent } from "lucide-react"
import { useState } from "react"

import { Card, CardStrip } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { Screen } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, moment } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  CopyCode,
  Countdown,
  NoPriceBook,
  OfferPill,
  PhaseFilter,
  SearchBox,
  Toolbar,
} from "@/screens/promotions/parts"
import {
  allOffers,
  describeEffect,
  describeScope,
  hasPriceBook,
  inPhase,
  offerMatches,
  slot,
  provenance,
  useOffers,
  type Phase,
} from "@/screens/promotions/shared"
import type { StoreOffer, StoreOffers } from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// Vouchers — the offers at this shop that only work with a code.
///
/// A coupon is a promotion with a lock on it: the till will not apply it until
/// somebody types the code, so a cashier who does not know the code exists
/// cannot give the discount a customer was promised by text message. These are
/// the same rules the Promotions screen lists, narrowed to the ones with a
/// `coupon_code` and drawn around the code — because the code is the thing
/// somebody comes here to read.
///
/// **Gift vouchers are not here, and the screen says so.** A gift card or a
/// credit note issued by head office is a balance, not a rule: it is checked
/// against head office at the moment it is presented, and this shop's node only
/// relays the hold. There is no list of them on the node to draw — and a
/// screen called Vouchers that was silent about them would read as "this shop
/// has none".
export function Vouchers() {
  const offers = useOffers()
  return (
    <Screen sub={provenance(offers.data)}>
      <Banner tone="info" className="mb-4">
        Gift vouchers and credit notes issued by head office are not listed
        here. The till checks each one with head office when it is presented —
        this shop only passes the hold along, and keeps no list of them.
      </Banner>
      {queryState(offers, {
        loading: "Reading this shop's codes…",
        render: (answer) =>
          hasPriceBook(answer) ? (
            <CodeBoard offers={answer} />
          ) : (
            <NoPriceBook />
          ),
      })}
    </Screen>
  )
}

function CodeBoard({ offers }: { offers: StoreOffers }) {
  const [phase, setPhase] = useState<Phase>("ALL")
  const [typed, setTyped] = useState("")
  const needle = typed.trim().toLowerCase()

  const coded = allOffers(offers).filter((offer) => offer.coupon_code !== null)
  const running = coded.filter((offer) => offer.state === "RUNNING").length
  const shown = coded.filter(
    (offer) => inPhase(offer.state, phase) && offerMatches(offer, needle),
  )

  if (coded.length === 0) {
    return (
      <Card>
        <EmptyState>
          No offer at this shop needs a code. Every promotion running or due
          here is applied by the till on its own.
        </EmptyState>
      </Card>
    )
  }

  return (
    <>
      <Toolbar>
        <PhaseFilter
          value={phase}
          onChange={setPhase}
          running={running}
          upcoming={coded.length - running}
        />
        <SearchBox
          value={typed}
          onChange={setTyped}
          placeholder="Search codes"
        />
      </Toolbar>

      {shown.length === 0 ? (
        <Card>
          <EmptyState>
            {needle !== ""
              ? `No code here matches “${typed.trim()}”.`
              : phase === "RUNNING"
                ? "No code works yet — every one this shop holds is still to start."
                : "No code is due to start."}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid items-start gap-3 md:grid-cols-2">
          {shown.map((offer) => (
            <CodeCard key={offer.rule_id} offer={offer} />
          ))}
        </div>
      )}
    </>
  )
}

/// One code: the code itself in the strip, where the eye lands, and what it
/// does under it.
function CodeCard({ offer }: { offer: StoreOffer }) {
  const hours = slot(offer.weekdays, offer.time_window)
  // Always a string here — `CodeBoard` keeps only the offers that have one —
  // but narrowed rather than asserted.
  const code = offer.coupon_code ?? ""
  return (
    <Card>
      <CardStrip className="gap-2 px-3.5 py-3 md:gap-3">
        {/* The tile goes on a phone, where the width is the code's. */}
        <span className="grid size-[1.6875rem] shrink-0 place-items-center rounded-inner border border-hairline-2 bg-canvas text-accent max-md:hidden">
          <TicketPercent className="size-[0.9375rem]" />
        </span>
        <span className="min-w-0 flex-1">
          <CopyCode code={code} size="lg" />
        </span>
        <OfferPill offer={offer} />
      </CardStrip>

      <div className="px-3.5 py-3">
        <p className="text-card-title font-semibold text-ink">
          {describeEffect(offer.effect)}
        </p>
        <p className="mt-0.5 text-meta text-body">
          {describeScope(offer.applies_to)}
        </p>
        <p className="mt-1.5 text-meta text-mute">
          {offer.name}
          {offer.campaign_name !== null && ` · ${offer.campaign_name}`}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta">
          <Countdown
            state={offer.state}
            startsAt={offer.starts_at}
            endsAt={offer.ends_at}
          />
          <span className="text-mute tabular-nums">
            {offer.state === "UPCOMING"
              ? offer.starts_at !== null && moment(offer.starts_at)
              : offer.ends_at !== null && `Until ${moment(offer.ends_at)}`}
          </span>
        </div>
        {hours !== null && (
          <p className="mt-0.5 text-meta text-mute">{hours}</p>
        )}

        {(offer.members_only ||
          offer.uses_remaining !== null ||
          offer.budget_remaining_minor !== null) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {offer.members_only && <Pill tone="accent">Members only</Pill>}
            {offer.uses_remaining !== null && (
              <Pill tone={offer.uses_remaining === 0 ? "bad" : "neutral"}>
                <span className="tabular-nums">
                  {count(offer.uses_remaining)}{" "}
                  {offer.uses_remaining === 1 ? "use" : "uses"} left
                </span>
              </Pill>
            )}
            {offer.budget_remaining_minor !== null && (
              <Pill
                tone={offer.budget_remaining_minor <= 0 ? "bad" : "neutral"}
              >
                <span className="tabular-nums">
                  {money(offer.budget_remaining_minor)} budget left
                </span>
              </Pill>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
