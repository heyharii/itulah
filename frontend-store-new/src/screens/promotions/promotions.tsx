import { useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { CardList } from "@/components/ui/card-list"
import { Screen } from "@/components/ui/screen"
import { EmptyState } from "@/components/ui/states"
import { count } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  NoPriceBook,
  OfferCard,
  OfferSheet,
  PhaseFilter,
  phaseOptions,
  SearchBox,
  Summary,
  Toolbar,
} from "@/screens/promotions/parts"
import {
  allOffers,
  hasPriceBook,
  inPhase,
  offerMatches,
  useOffers,
  type Phase,
} from "@/screens/promotions/shared"
import type { StoreOffers } from "@itulah/contract"

/// Promotions — the rules head office has put on at this shop, active now and
/// starting soon.
///
/// The catalogue answers "how much is this", and it always could: a markdown IS
/// the price, so a clearance shows up as a smaller number with the old one
/// struck through. A **promotion** is not a price — "buy two get one", "20% off
/// menswear" — it is a thing that happens to a whole basket at the counter,
/// and nothing on any product screen can show it. This is where a cashier
/// asked "what promos are on today?" looks, instead of at the poster in the
/// window.
///
/// The hub's Commercial › Promotions (`frontend-hub/src/screens/commercial/
/// promotions.tsx`) is where these are written; this is the same list read
/// from the other end. What it drops is everything a shop cannot act on — the
/// spend, the rollout, the switch — and what it adds is the one thing the hub
/// does not need: whether the offer will ring up at this till this minute.
///
/// Each offer is a lead card — what it gives is the figure, how long is left in
/// the foot with its status — and opens a sheet with the terms. On a phone the
/// phase is the dock's status chip and the search its field.
export function Promotions() {
  const offers = useOffers()
  return (
    <Screen>
      {queryState(offers, {
        loading: "Reading what this shop is offering…",
        render: (answer) =>
          hasPriceBook(answer) ? (
            <PromotionList offers={answer} />
          ) : (
            <NoPriceBook />
          ),
      })}
    </Screen>
  )
}

function PromotionList({ offers }: { offers: StoreOffers }) {
  const [phase, setPhase] = useState<Phase>("ALL")
  const [typed, setTyped] = useState("")
  const [openId, setOpenId] = useState<string | null>(null)
  const needle = typed.trim().toLowerCase()

  const every = allOffers(offers)
  const shown = every.filter(
    (offer) => inPhase(offer.state, phase) && offerMatches(offer, needle),
  )

  if (every.length === 0) {
    return (
      <EmptyState
        action={
          // A shop with no promotion can still be in a clearance — and a
          // cashier who stops at "nothing is on" would miss it.
          offers.price_drops.length > 0 ? (
            <AppLink
              to="/promotions/price-changes"
              className="text-meta font-medium text-accent"
            >
              {count(offers.price_drops.length)} price{" "}
              {offers.price_drops.length === 1 ? "change is" : "changes are"} on
              instead
            </AppLink>
          ) : undefined
        }
      >
        This shop is not running any promotions, and none is due to start.
      </EmptyState>
    )
  }

  return (
    <>
      <DockTools
        search={{
          value: typed,
          onChange: setTyped,
          label: "Search promotions",
        }}
        status={{
          value: phase,
          options: phaseOptions(offers.running.length, offers.upcoming.length),
          onChange: (next) => setPhase(next as Phase),
        }}
      />
      <Summary
        parts={[
          [offers.running.length, "active"],
          [offers.upcoming.length, "scheduled"],
        ]}
      />

      <Toolbar>
        <PhaseFilter
          value={phase}
          onChange={setPhase}
          running={offers.running.length}
          upcoming={offers.upcoming.length}
        />
        <SearchBox
          value={typed}
          onChange={setTyped}
          placeholder="Search name, code or SKU"
        />
      </Toolbar>

      {shown.length === 0 ? (
        <EmptyState>
          {needle !== ""
            ? `No promotion here matches “${typed.trim()}”.`
            : phase === "RUNNING"
              ? "Nothing is active right now — what this shop has is still to start."
              : "Nothing is due to start. Everything this shop holds is already active."}
        </EmptyState>
      ) : (
        <CardList grid>
          {shown.map((offer) => (
            <OfferCard
              key={offer.rule_id}
              offer={offer}
              onOpen={() => setOpenId(offer.rule_id)}
            />
          ))}
        </CardList>
      )}

      <OfferSheet
        offer={every.find((offer) => offer.rule_id === openId)}
        onClose={() => setOpenId(null)}
      />
    </>
  )
}
