import { useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { CardList } from "@/components/ui/card-list"
import { Screen } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
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

/// Vouchers — the offers at this shop that only work with a code.
///
/// A coupon is a promotion with a lock on it: the till will not apply it until
/// somebody types the code, so a cashier who does not know the code exists
/// cannot give the discount a customer was promised by text message. These are
/// the same rules the Promotions screen lists, narrowed to the ones with a
/// `coupon_code` and drawn around the code — the card's title IS the code, with
/// a button to copy it, because the code is the thing somebody comes here to
/// read. What the voucher gives is the card's figure; what is left of it
/// (uses, budget) is under the name.
///
/// **Gift vouchers are not here, and the screen says so.** A gift card or a
/// credit note issued by head office is a balance, not a rule: it is checked
/// against head office at the moment it is presented, and this shop's node only
/// relays the hold. There is no list of them on the node to draw — and a
/// screen called Vouchers that was silent about them would read as "this shop
/// has none". The sentence is under the list, not over it.
export function Vouchers() {
  const offers = useOffers()
  return (
    <Screen>
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
  const [openId, setOpenId] = useState<string | null>(null)
  const needle = typed.trim().toLowerCase()

  const coded = allOffers(offers).filter((offer) => offer.coupon_code !== null)
  const running = coded.filter((offer) => offer.state === "RUNNING").length
  const shown = coded.filter(
    (offer) => inPhase(offer.state, phase) && offerMatches(offer, needle),
  )

  const gifts = (
    <Banner tone="info" className="mt-4">
      Gift vouchers and credit notes are checked with head office at the till
      and are not listed here.
    </Banner>
  )

  if (coded.length === 0) {
    return (
      <>
        <EmptyState>
          No offer at this shop needs a code. Every promotion active or due here
          is applied by the till on its own.
        </EmptyState>
        {gifts}
      </>
    )
  }

  return (
    <>
      <DockTools
        search={{ value: typed, onChange: setTyped, label: "Search codes" }}
        status={{
          value: phase,
          options: phaseOptions(running, coded.length - running),
          onChange: (next) => setPhase(next as Phase),
        }}
      />
      <Summary
        parts={[
          [running, "active"],
          [coded.length - running, "scheduled"],
        ]}
      />

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
        <EmptyState>
          {needle !== ""
            ? `No code here matches “${typed.trim()}”.`
            : phase === "RUNNING"
              ? "No code works yet — every one this shop holds is still to start."
              : "No code is due to start."}
        </EmptyState>
      ) : (
        <CardList grid>
          {shown.map((offer) => (
            <OfferCard
              key={offer.rule_id}
              offer={offer}
              byCode
              onOpen={() => setOpenId(offer.rule_id)}
            />
          ))}
        </CardList>
      )}

      {gifts}

      <OfferSheet
        offer={coded.find((offer) => offer.rule_id === openId)}
        onClose={() => setOpenId(null)}
      />
    </>
  )
}
