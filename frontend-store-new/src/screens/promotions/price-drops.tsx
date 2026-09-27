import { useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Screen } from "@/components/ui/screen"
import { EmptyState } from "@/components/ui/states"
import { moment } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  Countdown,
  DropPill,
  Fact,
  Facts,
  NoPriceBook,
  PhaseFilter,
  SearchBox,
  Toolbar,
} from "@/screens/promotions/parts"
import {
  dropKey,
  dropReach,
  hasPriceBook,
  inPhase,
  matches,
  slot,
  provenance,
  useOffers,
  type Phase,
} from "@/screens/promotions/shared"
import type { PriceDropWindow, StoreOffers } from "@itulah/contract"

/// Price drops — the markdowns this shop is in, or is about to enter, and when
/// each one stops.
///
/// A markdown is a price, not a discount, so each one is already showing in
/// the catalogue as the new price with the old one struck through. What the
/// catalogue cannot say is the other half a shop floor needs: **when it
/// stops**, how much of the range is in it, and what the business calls it.
///
/// Listed by run rather than by product, as the node groups them: a clearance
/// is one event to a shop and two thousand rows to the database. A run that
/// names a campaign wears the campaign's name; a run that names none is the
/// set of drops that share its dates, and is **not given an invented name**.
export function PriceDrops() {
  const offers = useOffers()
  return (
    <Screen sub={provenance(offers.data)}>
      {queryState(offers, {
        loading: "Reading this shop's price drops…",
        render: (answer) =>
          hasPriceBook(answer) ? <DropList offers={answer} /> : <NoPriceBook />,
      })}
    </Screen>
  )
}

/// The verbs a markdown's countdown says. Not "starts" and "ends": the price
/// on the ticket is what changes, and that is what the cashier has to know.
const VERBS = { start: "Prices drop", end: "Back to full price" }

/// From and Until give way first on a narrow table — the countdown in When
/// says the same thing in the words a shop uses, and the row's detail has
/// both dates.
const columns: readonly ListColumn<PriceDropWindow>[] = [
  {
    id: "drop",
    header: "Price drop",
    className: "min-w-[12rem] whitespace-normal",
    cell: (window) =>
      window.name !== null ? (
        <span className="font-medium text-ink">{window.name}</span>
      ) : (
        // A description, not a name — set in the body grey so it is not read
        // as one.
        <span className="text-body">
          {window.campaign_id === null ? "Not part of a campaign" : "Unnamed"}
        </span>
      ),
  },
  {
    id: "status",
    header: "Status",
    card: "status",
    cell: (window) => <DropPill window={window} />,
  },
  {
    id: "reach",
    header: "Marked down",
    className: "min-w-[8rem] whitespace-normal",
    cell: (window) => (
      <span className="text-ink tabular-nums">{dropReach(window)}</span>
    ),
  },
  {
    id: "from",
    header: "From",
    card: "hide",
    className: "max-lg:hidden",
    cell: (window) => (
      <span className="tabular-nums">{moment(window.starts_at)}</span>
    ),
  },
  {
    id: "until",
    header: "Until",
    card: "hide",
    className: "max-lg:hidden",
    cell: (window) =>
      window.ends_at === null ? (
        <span className="text-mute">No end date</span>
      ) : (
        <span className="tabular-nums">{moment(window.ends_at)}</span>
      ),
  },
  {
    id: "when",
    header: "When",
    cell: (window) => {
      /// When in the week and in the day the price is actually down.
      ///
      /// It matters more here than on a promotion: a promotion outside its
      /// hours simply does not fire, while a markdown outside its hours means
      /// **the ticket on the garment is wrong**.
      const hours = slot(window.weekdays, window.time_window)
      return (
        <span className="block">
          <Countdown
            state={window.state}
            startsAt={window.starts_at}
            endsAt={window.ends_at}
            verbs={VERBS}
          />
          {hours !== null && (
            <span className="block text-meta text-mute">{hours}</span>
          )}
        </span>
      )
    },
  },
]

function DropList({ offers }: { offers: StoreOffers }) {
  const [phase, setPhase] = useState<Phase>("ALL")
  const [typed, setTyped] = useState("")
  const needle = typed.trim().toLowerCase()

  const every = offers.price_drops
  const running = every.filter((one) => one.state === "RUNNING").length
  const shown = every.filter(
    (window) =>
      inPhase(window.state, phase) &&
      matches(needle, window.name, window.terms, dropReach(window)),
  )

  if (every.length === 0) {
    return (
      <Card>
        <EmptyState>
          Nothing at this shop is marked down, and no price drop is due to
          start. Every ticket in the catalogue is at its full price.
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
          upcoming={every.length - running}
        />
        <SearchBox
          value={typed}
          onChange={setTyped}
          placeholder="Search price drops"
        />
      </Toolbar>

      <Card>
        <ListTable
          rows={shown}
          columns={columns}
          rowKey={dropKey}
          detail={(window) => <DropDetail window={window} />}
          empty={
            needle !== ""
              ? `No price drop here matches “${typed.trim()}”.`
              : phase === "RUNNING"
                ? "Nothing is marked down right now — what this shop has is still to start."
                : "No price drop is due to start."
          }
        />
      </Card>

      {/* Where the products are, so nobody goes looking for a list of them
          here: they are the catalogue, with the old price struck through. */}
      <p className="mt-3 text-meta text-mute">
        Marked-down products already carry their new price in the{" "}
        <AppLink
          to="/catalogue"
          className="font-medium text-accent underline-offset-2 hover:underline"
        >
          catalogue
        </AppLink>
        , with the old one struck through. This list is when; the catalogue is
        what.
      </p>
    </>
  )
}

function DropDetail({ window }: { window: PriceDropWindow }) {
  return (
    <Facts>
      <Fact term="Marked down">{dropReach(window)}</Fact>
      <Fact term="From">{moment(window.starts_at)}</Fact>
      <Fact term="Until">
        {window.ends_at === null ? "No end date" : moment(window.ends_at)}
      </Fact>
      <Fact term="Runs">
        {/* Blank has two readings and both are said. The node reports days
            and hours only when every drop in the run agrees on them — so a
            run with none is either all day, every day, or scheduled product
            by product, and naming one hour for all of them would be a
            sentence a cashier acts on and is wrong about. */}
        {slot(window.weekdays, window.time_window) ??
          "Every day, all day — unless its products differ"}
      </Fact>
      <Fact term="Campaign">
        {window.campaign_id === null ? (
          "None — these share their dates, nothing else"
        ) : (
          <AppLink
            to="/promotions/campaigns"
            className="text-accent underline-offset-2 hover:underline"
          >
            {window.name ?? "Open its campaign"}
          </AppLink>
        )}
      </Fact>
      {window.terms !== null && window.terms.trim() !== "" && (
        <Fact term="Terms" wide>
          <span className="whitespace-pre-line text-body">{window.terms}</span>
        </Fact>
      )}
    </Facts>
  )
}
