import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Screen } from "@/components/ui/screen"
import { EmptyState } from "@/components/ui/states"
import { count, moment } from "@/lib/format"
import { useGo } from "@/lib/go"
import { catalogueKey, fetchCatalogue } from "@/lib/queries"
import { isDown } from "@/screens/catalogue"
import { money } from "@itulah/contract/money"
import { queryState } from "@/lib/query-state"
import {
  Bullets,
  Countdown,
  DropPill,
  NoPriceBook,
  PhaseFilter,
  SearchBox,
  Toolbar,
  sentences,
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

/// Price changes — the markdowns this shop is in, or is about to enter, and when
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
        loading: "Reading this shop's price changes…",
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
    header: "Price change",
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
          placeholder="Search price changes"
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
              ? `No price change here matches “${typed.trim()}”.`
              : phase === "RUNNING"
                ? "Nothing is marked down right now — what this shop has is still to start."
                : "No price change is due to start."
          }
        />
      </Card>

      <MarkedDownArticles />
    </>
  )
}

function DropDetail({ window }: { window: PriceDropWindow }) {
  const hours = slot(window.weekdays, window.time_window)
  return (
    <div className="flex max-w-[46em] flex-col gap-2 pt-1">
      <h4 className="text-cell font-semibold text-ink">What changes</h4>
      <Bullets
        lines={[
          `${dropReach(window)} change price`,
          window.ends_at === null
            ? `New prices from ${moment(window.starts_at)}, no end date`
            : `New prices ${moment(window.starts_at)} – ${moment(window.ends_at)}, then back to full price`,
          // The node reports days and hours only when every markdown in the run
          // agrees, so none means all day unless the articles differ.
          hours !== null && hours,
          ...sentences(window.terms),
          window.state === "RUNNING"
            ? "Already on the tickets — the articles are listed below."
            : "Not live yet — the articles appear below once it starts.",
        ]}
      />
      {window.campaign_id !== null && (
        <AppLink
          to="/promotions/campaigns"
          className="text-cell font-medium text-accent underline-offset-2 hover:underline"
        >
          Part of {window.name ?? "a campaign"}
        </AppLink>
      )}
    </div>
  )
}

/// The articles that are marked down at this shop right now, one line each: the
/// price on the old ticket, the price it is now, and how much that is.
///
/// Read from the catalogue the till already holds — a markdown is a price, so
/// the articles are the rows priced under their base.
function MarkedDownArticles() {
  const go = useGo()
  const catalogue = useQuery({
    queryKey: catalogueKey(),
    queryFn: ({ signal }) => fetchCatalogue(signal),
    refetchInterval: 60_000,
  })
  const [typed, setTyped] = useState("")
  const needle = typed.trim().toLowerCase()
  const rows = (catalogue.data?.items ?? []).filter(
    (row) =>
      isDown(row) &&
      (needle === "" ||
        `${row.name} ${row.sku_code}`.toLowerCase().includes(needle)),
  )
  const currency = catalogue.data?.currency ?? "IDR"
  if (catalogue.data === undefined || (rows.length === 0 && needle === ""))
    return null

  return (
    <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-card-title font-semibold text-ink">
          Articles at the new price{" "}
          <span className="font-normal text-mute tabular-nums">
            {count(rows.length)}
          </span>
        </h3>
        <SearchBox
          value={typed}
          onChange={setTyped}
          placeholder="Search articles"
        />
      </div>
      <Card>
        <ListTable
          roomy
          rows={rows}
          rowKey={(row) => row.sku_code}
          empty={`No marked-down article matches “${typed.trim()}”.`}
          columns={[
            {
              id: "article",
              header: "Article",
              className: "min-w-[14rem] whitespace-normal",
              cell: (row) => (
                <button
                  type="button"
                  onClick={() => go("/catalogue/product", { sku: row.sku_code })}
                  className="block text-left"
                >
                  <span className="block font-medium text-ink">{row.name}</span>
                  <span className="block font-mono text-id text-mute">
                    {row.sku_code}
                  </span>
                </button>
              ),
            },
            {
              id: "was",
              header: "Was",
              align: "right",
              card: "hide",
              cell: (row) => (
                <span className="text-mute tabular-nums line-through">
                  {money(row.base_unit_price_minor, currency)}
                </span>
              ),
            },
            {
              id: "now",
              header: "Now",
              align: "right",
              card: "status",
              cell: (row) => (
                <span className="font-semibold text-ink tabular-nums">
                  {money(row.unit_price_minor, currency)}
                </span>
              ),
            },
            {
              id: "off",
              header: "Off",
              align: "right",
              card: "meta",
              cell: (row) => (
                <span className="text-bad-fg tabular-nums">
                  −
                  {Math.round(
                    (1 - row.unit_price_minor / row.base_unit_price_minor) *
                      100,
                  )}
                  %
                </span>
              ),
            },
          ]}
        />
      </Card>
    </section>
  )
}
