import { TicketPercent } from "lucide-react"
import { useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Screen } from "@/components/ui/screen"
import { Tag } from "@/components/ui/tag"
import { count, moment } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  Countdown,
  NoPriceBook,
  OfferDetail,
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

/// Promotions — the rules head office has put on at this shop, running now and
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
export function Promotions() {
  const offers = useOffers()
  return (
    <Screen sub={provenance(offers.data)}>
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

/// Columns are declared once, outside the component, so the table and the
/// phone's card rows are the same declaration read two ways.
const columns: readonly ListColumn<StoreOffer>[] = [
  {
    id: "promotion",
    header: "Promotion",
    className: "min-w-[11rem] whitespace-normal",
    cell: (offer) => (
      <span className="block">
        <span className="flex items-center gap-1.5 font-medium text-ink">
          {offer.name}
          {/* Marked here as well as in its own column, because on a phone the
              column is gone and "needs a code" is the one thing a cashier
              must not find out at the till. */}
          {offer.coupon_code !== null && (
            <TicketPercent
              aria-label="Needs a code"
              className="size-3.5 shrink-0 text-accent"
            />
          )}
        </span>
        {offer.campaign_name !== null && (
          <span className="block text-meta text-mute">
            {offer.campaign_name}
          </span>
        )}
      </span>
    ),
  },
  {
    id: "status",
    header: "Status",
    card: "status",
    cell: (offer) => <OfferPill offer={offer} />,
  },
  {
    id: "benefit",
    // "Benefit" rather than "Effect", as the hub has it: it is the column that
    // says what the shopper gets.
    header: "Benefit",
    cell: (offer) => (
      <span className="font-medium text-ink">
        {describeEffect(offer.effect)}
      </span>
    ),
  },
  {
    id: "scope",
    header: "Applies to",
    className: "min-w-[9rem] whitespace-normal",
    cell: (offer) => (
      // Inline rather than a flex row, so on a narrow table the tag follows
      // the last word instead of squeezing the words into a column.
      <span>
        {describeScope(offer.applies_to)}
        {offer.members_only && (
          <Tag tone="accent" className="ml-1.5 align-middle">
            Members
          </Tag>
        )}
      </span>
    ),
  },
  {
    id: "when",
    header: "When",
    cell: (offer) => {
      // The date under the countdown, so "ends in 3 days" can be checked
      // against the poster without opening the row — and the days and hours
      // beside it, because a Saturday-only offer is the one a cashier gets
      // wrong on a Tuesday.
      const date =
        offer.state === "UPCOMING"
          ? offer.starts_at === null
            ? null
            : moment(offer.starts_at)
          : offer.ends_at === null
            ? null
            : `Until ${moment(offer.ends_at)}`
      const under = [date, slot(offer.weekdays, offer.time_window)]
        .filter((part) => part !== null)
        .join(" · ")
      return (
        <span className="block">
          <Countdown
            state={offer.state}
            startsAt={offer.starts_at}
            endsAt={offer.ends_at}
          />
          {under !== "" && (
            <span className="block text-meta text-mute tabular-nums">
              {under}
            </span>
          )}
        </span>
      )
    },
  },
  {
    id: "code",
    header: "Code",
    // The first column to give way. On a phone, and on a table too narrow to
    // hold every column, the ticket beside the name says a code is needed and
    // the code itself is one press away in the row's detail.
    card: "hide",
    className: "max-lg:hidden",
    cell: (offer) =>
      offer.coupon_code === null ? (
        <span className="text-faint">—</span>
      ) : (
        <Tag tone="accent">{offer.coupon_code}</Tag>
      ),
  },
]

function PromotionList({ offers }: { offers: StoreOffers }) {
  const [phase, setPhase] = useState<Phase>("ALL")
  const [typed, setTyped] = useState("")
  const needle = typed.trim().toLowerCase()

  const every = allOffers(offers)
  const shown = every.filter(
    (offer) => inPhase(offer.state, phase) && offerMatches(offer, needle),
  )

  if (every.length === 0) {
    return (
      <Card>
        <div className="mx-auto flex max-w-[30em] flex-col items-center gap-3 px-4 py-12 text-center">
          <p className="text-meta text-body">
            This shop is not running any promotions, and none is due to start.
          </p>
          {/* A shop with no promotion can still be in a clearance — and a
              cashier who stops at "nothing is on" would miss it. */}
          {offers.price_drops.length > 0 && (
            <AppLink
              to="/promotions/price-changes"
              className="text-meta font-medium text-accent"
            >
              {count(offers.price_drops.length)} price{" "}
              {offers.price_drops.length === 1 ? "change is" : "changes are"} on
              instead
            </AppLink>
          )}
        </div>
      </Card>
    )
  }

  return (
    <>
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

      <Card>
        <ListTable
          roomy
          rows={shown}
          columns={columns}
          rowKey={(offer) => offer.rule_id}
          detail={(offer) => <OfferDetail offer={offer} />}
          empty={
            needle !== ""
              ? `No promotion here matches “${typed.trim()}”.`
              : phase === "RUNNING"
                ? "Nothing is running right now — what this shop has is still to start."
                : "Nothing is due to start. Everything this shop holds is already running."
          }
        />
      </Card>
    </>
  )
}
