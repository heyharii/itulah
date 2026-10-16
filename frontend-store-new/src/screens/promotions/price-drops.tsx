import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { CardList } from "@/components/ui/card-list"
import { CardTable } from "@/components/ui/card-table"
import { LeadCard } from "@/components/ui/lead-card"
import { OpenButton } from "@/components/ui/open-rows"
import { Screen } from "@/components/ui/screen"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { count, moment } from "@/lib/format"
import { useGo } from "@/lib/go"
import { useLayout } from "@/lib/layout"
import { isDown } from "@/lib/prices"
import { catalogueQuery } from "@/lib/queries"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { Photograph } from "@/screens/catalogue-parts"
import {
  Bullets,
  Countdown,
  NoPriceBook,
  PhaseFilter,
  PhasePill,
  phaseOptions,
  PhaseStatus,
  SearchBox,
  sentences,
  Summary,
  Toolbar,
} from "@/screens/promotions/parts"
import {
  dropKey,
  dropReach,
  hasPriceBook,
  inPhase,
  leftIn,
  matches,
  slot,
  span,
  urgent,
  useNow,
  useOffers,
  type Phase,
} from "@/screens/promotions/shared"
import type { PriceDropWindow, StoreOffers } from "@itulah/contract"
import { money } from "@itulah/contract/money"

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
///
/// A run is a lead card — the time LEFT as the figure, how much of the range it
/// covers in the foot with its status — and opens a sheet with the dates and the
/// small print. Under the runs, the articles that are at the new price, as
/// cards with the photograph. One search, in the dock on a phone, narrows both.
export function PriceDrops() {
  const offers = useOffers()
  return (
    <Screen>
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

/// How many articles a phone draws before somebody asks for more.
const PAGE = 48

function DropList({ offers }: { offers: StoreOffers }) {
  const phone = useLayout() === "phone"
  const [phase, setPhase] = useState<Phase>("ALL")
  const [typed, setTyped] = useState("")
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const go = useGo()
  const needle = typed.trim().toLowerCase()

  const every = offers.price_drops
  const running = every.filter((one) => one.state === "RUNNING").length
  const shown = every.filter(
    (window) =>
      inPhase(window.state, phase) &&
      matches(needle, window.name, window.terms, dropReach(window)),
  )

  // The articles at the new price: read from the catalogue the till already
  // holds — a markdown is a price, so they are the rows priced under their base.
  const catalogue = useQuery({
    ...catalogueQuery(),
    refetchInterval: 60_000,
  })
  const currency = catalogue.data?.currency ?? "IDR"
  const marked = (catalogue.data?.items ?? []).filter(isDown)
  const articles = marked.filter(
    (row) =>
      needle === "" ||
      `${row.name} ${row.sku_code}`.toLowerCase().includes(needle),
  )

  if (every.length === 0) {
    return (
      <EmptyState>
        Nothing at this shop is marked down, and no price change is due to
        start. Every ticket in the catalogue is at its full price.
      </EmptyState>
    )
  }

  const showRuns = shown.length > 0
  const showArticles = articles.length > 0

  return (
    <>
      <DockTools
        search={{
          value: typed,
          onChange: setTyped,
          label: "Search price changes",
        }}
        status={{
          value: phase,
          options: phaseOptions(running, every.length - running),
          onChange: (next) => setPhase(next as Phase),
        }}
      />
      <Summary
        parts={[
          [running, "active"],
          [every.length - running, "scheduled"],
        ]}
      />

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
          placeholder="Search price changes and articles"
        />
      </Toolbar>

      {!showRuns && !showArticles && (
        <EmptyState>
          {needle !== ""
            ? `No price change here matches “${typed.trim()}”.`
            : phase === "RUNNING"
              ? "Nothing is marked down right now — what this shop has is still to start."
              : "No price change is due to start."}
        </EmptyState>
      )}

      {showRuns && (
        <CardList grid>
          {shown.map((window) => (
            <DropCard
              key={dropKey(window)}
              window={window}
              onOpen={() => setOpenKey(dropKey(window))}
            />
          ))}
        </CardList>
      )}

      {showArticles && (
        <section className={cn(showRuns && "mt-6")}>
          <CardTable
            title="Articles at the new price"
            aside={count(articles.length)}
            rows={phone ? articles.slice(0, limit) : articles}
            rowKey={(row) => row.sku_code}
            empty="No marked-down article matches."
            onOpen={(row) => go("/catalogue", { sku: row.sku_code })}
            columns={[
              {
                id: "article",
                header: "Article",
                className: "min-w-[14rem] whitespace-normal",
                cell: (row) => (
                  <OpenButton id={row.sku_code}>
                    <span className="block font-medium text-ink">
                      {row.name}
                    </span>
                    <span className="block font-mono text-id text-mute">
                      {row.sku_code}
                    </span>
                  </OpenButton>
                ),
              },
              {
                id: "was",
                header: "Was",
                align: "right",
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
                cell: (row) => (
                  <span className="text-bad-fg tabular-nums">
                    −
                    {percentOff(
                      row.unit_price_minor,
                      row.base_unit_price_minor,
                    )}
                    %
                  </span>
                ),
              },
            ]}
            card={(row) => ({
              media: (
                <Photograph
                  sku={row.sku_code}
                  has={row.has_image}
                  name={row.name}
                />
              ),
              title: row.name,
              code: row.sku_code,
              lead: {
                figure: money(row.unit_price_minor, currency),
                // Both numbers, because a was-price with nothing struck through
                // is just a smaller price.
                caption: (
                  <span className="line-through">
                    {money(row.base_unit_price_minor, currency)}
                  </span>
                ),
              },
              foot: {
                info: `${percentOff(row.unit_price_minor, row.base_unit_price_minor)}% off`,
              },
            })}
            foot={
              phone && articles.length > limit ? (
                <div className="mt-4 flex justify-center">
                  <Button onClick={() => setLimit((was) => was + PAGE)}>
                    Show {count(Math.min(PAGE, articles.length - limit))} more
                  </Button>
                </div>
              ) : undefined
            }
          />
        </section>
      )}

      <DropSheet
        window={every.find((window) => dropKey(window) === openKey)}
        onClose={() => setOpenKey(null)}
      />
    </>
  )
}

/// Whole percent, rounded to the nearest: what the ticket says.
function percentOff(now: number, was: number): number {
  return was > 0 ? Math.round((1 - now / was) * 100) : 0
}

/// One run: what it is called, when the price is down, how much of the range is
/// in it — and, as the figure, how long is left of it (or until it starts).
function DropCard({
  window,
  onOpen,
}: {
  window: PriceDropWindow
  onOpen: () => void
}) {
  const now = useNow(true)
  const upcoming = window.state === "UPCOMING"
  const lead = upcoming
    ? { figure: leftIn(window.starts_at, now), caption: "to start" }
    : window.ends_at === null
      ? { figure: "Open", caption: "no end date" }
      : {
          figure: (
            <span className={cn(urgent(window.ends_at, now) && "text-bad-fg")}>
              {leftIn(window.ends_at, now)}
            </span>
          ),
          caption: "left",
        }
  return (
    <LeadCard
      onOpen={onOpen}
      title={window.name ?? "Price change"}
      lines={[
        // The hours matter more here than on a promotion: a promotion outside
        // its hours simply does not fire, while a markdown outside its hours
        // means the ticket on the garment is wrong.
        slot(window.weekdays, window.time_window),
        span(window.starts_at, window.ends_at),
      ]}
      lead={lead}
      foot={{
        info: dropReach(window),
        status: <PhaseStatus state={window.state} />,
      }}
    />
  )
}

/// A run as a record sheet: the dates and the hours, the small print, and a way
/// back to the campaign it belongs to. Nothing sits in the foot — a price change
/// is read, not acted on, at a shop.
///
/// Kept while it slides away, so closing does not blank the record mid-travel.
function DropSheet({
  window,
  onClose,
}: {
  window: PriceDropWindow | undefined
  onClose: () => void
}) {
  const [shown, setShown] = useState<PriceDropWindow | undefined>(undefined)
  if (window !== undefined && window !== shown) setShown(window)
  const record = window ?? shown
  const hours =
    record === undefined ? null : slot(record.weekdays, record.time_window)
  const terms = sentences(record?.terms ?? null)

  return (
    <Sheet
      open={window !== undefined}
      onOpenChange={(next) => !next && onClose()}
      title={record?.name ?? "Price change"}
      badge={
        record === undefined ? undefined : <PhasePill state={record.state} />
      }
    >
      {record !== undefined && (
        <div className="flex flex-col gap-6">
          <Facts>
            <Fact term="Marked down" wide>
              {dropReach(record)}
            </Fact>
            <Fact term="From">{moment(record.starts_at)}</Fact>
            <Fact term="Until">
              {record.ends_at === null ? "No end date" : moment(record.ends_at)}
            </Fact>
            <Fact term="Hours">{hours ?? "All day, every day"}</Fact>
            <Fact term="Countdown" wide>
              <Countdown
                state={record.state}
                startsAt={record.starts_at}
                endsAt={record.ends_at}
                verbs={VERBS}
                className="text-ink"
              />
            </Fact>
          </Facts>
          {terms.length > 0 && (
            <section>
              <h3 className="mb-2.5 text-card-title font-semibold text-ink">
                Terms
              </h3>
              <Bullets lines={terms} />
            </section>
          )}
          {record.campaign_id !== null && (
            <AppLink
              to="/promotions/campaigns"
              className="text-cell font-medium text-accent underline-offset-2 hover:underline"
            >
              Part of {record.name ?? "a campaign"}
            </AppLink>
          )}
        </div>
      )}
    </Sheet>
  )
}
