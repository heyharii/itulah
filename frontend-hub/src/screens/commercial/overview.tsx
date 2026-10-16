import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import {
  BandLegend,
  BandStack,
  Sparkline,
  type ChartBand,
  type ChartRow,
} from "@/components/ui/chart"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Meter } from "@/components/ui/meter"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { SubHead } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { Thumbnail } from "@/components/ui/thumbnail"
import { BAND_NEUTRAL, BAND_TONES } from "@/lib/chart-bands"
import { count, day, money, moment, span } from "@/lib/format"
import {
  changeKeys,
  describeChangeKind,
  listPriceChanges,
  needsAttention,
  type PriceChange,
} from "@/lib/queries/changes"
import {
  campaignCatalogue,
  commercialFleet,
  commercialKeys,
  type BookCampaign,
  type CampaignRow,
} from "@/lib/queries/commercial"
import {
  campaignPerformance,
  performanceKeys,
  rulePerformance,
  type CampaignPerformance,
  type RulePerformance,
} from "@/lib/queries/commercial-performance"
import { listVouchers, voucherKeys } from "@/lib/queries/vouchers"
import { queryState } from "@/lib/query-state"
import { consumed, delta, fold } from "@/screens/commercial/shared"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"
import { CardFigure, CardName, PhoneCard } from "@/components/ui/phone-cards"
import { CardTable, field } from "@/screens/executive/card-table"

/// Commercial's front door.
///
/// ## What changed, and why the old one was replaced
///
/// This screen used to be a worklist and said so in its own comment: a module
/// with four good lists did not need a fifth that re-drew their charts smaller.
/// That argument was right about the *duplication* and wrong about the
/// *altitude*. Every one of the four lists answers a question about its own
/// noun — this promotion, that campaign, this card, that book — and the
/// question nobody could ask anywhere was the one about the module:
///
///   **What are we running, what did it give away, and what came back?**
///
/// It is not a figure any of the four screens holds, because it is the sum of
/// all of them. So it is here, and the two worklists the old screen carried are
/// still here too — compressed into the Prices panel at the foot, which is
/// where a rollout belongs once it is one fact among several rather than the
/// whole page.
///
/// The same decision retires the parked `<PerformanceHeader>` question. Those
/// tiles were hidden on Promotions and Campaigns on 13 Sep because nobody could
/// say which figures belonged at the top of a LIST. The answer is that they do
/// not belong on a list at all: a list is for finding one row, and a module's
/// money is a fact about the whole module.
///
/// ## The four menus, each answered in its own terms
///
///   * **Campaigns** get photographs, because a campaign is the only thing in a
///     price book a SHOPPER is meant to see. `image_url`, `headline` and
///     `terms` have been editable after publication since migration 0087 for
///     exactly this reason, and a board of posters is what those columns are
///     for.
///   * **Promotions** get no photograph and that is not an omission. A
///     promotion is a MECHANIC — "25% off outerwear" — and it has no picture
///     anywhere in the schema to draw. What it borrows is its campaign's:
///     the thumbnail beside a rule says whose poster it is running under, and a
///     rule with no campaign correctly has nothing there.
///   * **Vouchers** get money owed, not money given away. A voucher is TENDER
///     — it sits beside cash at the counter — so the figure that matters is the
///     liability, never a discount rate.
///   * **Prices** get coverage. There is no picture of a price and no chart of
///     one worth drawing at this altitude; the only price question a head
///     office can act on from here is whether the shops are charging what the
///     centre published, which is the fleet reading the old screen already had.
///
/// ## What is deliberately NOT summed
///
/// There is no fleet revenue total, and its absence is load-bearing.
/// `performance.rs` ships none either, and says why: a basket two campaigns
/// both touched would be counted twice. Discount given is exact — a promotion
/// fact is one row per `(sale, rule)` — so **the strip's money comes from the
/// RULES report and never from the campaigns one**, and revenue is only ever
/// drawn against a single campaign, where the server itself computed it.

/// How far back the page looks. Thirty days is what a merchandiser means by
/// "how is it going", and it is the server's own default — passed explicitly
/// anyway so the label on the chart and the window behind it cannot drift
/// apart.
const WINDOW_DAYS = 30

/// A rule that belongs to no campaign, as a band. Not a sixth hue: "no
/// campaign" is not a sixth campaign, it is everything that is not one — the
/// same reading `BAND_NEUTRAL` has everywhere else.
const SOLO = "__solo"

const ruleKey = (rule: RulePerformance) => rule.rule_id
const changeKey = (change: PriceChange) => change.publication_id

export function CommercialOverview() {
  // A phone gets the four figures in a two-by-two and the promotions that gave
  // away most as cards, nothing sideways (owner, 2026-10-06).
  const phone = useLayout() === "phone"
  const navigate = useNavigate()
  /// The window ends at the top of the NEXT hour, not on this millisecond.
  /// Both ends are in the performance keys, and a clock read at mount made
  /// every visit a new key — the two heaviest reads on the page refetched each
  /// time somebody came back to it. Rounded up rather than down, so nothing
  /// sold this hour is left out: the stretch after now holds no sales yet.
  const scope = useMemo(() => {
    const to = new Date()
    to.setUTCMinutes(60, 0, 0)
    const from = new Date(to.getTime() - WINDOW_DAYS * 86_400_000)
    return { from: from.toISOString(), to: to.toISOString() }
  }, [])
  /// What is running is asked of the real clock, not of the window's rounded
  /// end — a campaign that closes at half past is not still on at the hour.
  const now = useMemo(() => new Date().getTime(), [])

  const campaigns = useQuery({
    queryKey: performanceKeys.campaigns(scope),
    queryFn: ({ signal }) => campaignPerformance(scope, signal),
    retry: false,
  })
  const rules = useQuery({
    queryKey: performanceKeys.rules(scope),
    queryFn: ({ signal }) => rulePerformance(scope, signal),
    retry: false,
  })
  // The posters. The performance report knows what a campaign EARNED and
  // nothing about what it looks like — the banner, the headline and the small
  // print live in the price book, and only this read carries them.
  const books = useQuery({
    queryKey: commercialKeys.campaigns(),
    queryFn: ({ signal }) => campaignCatalogue(signal),
  })
  const vouchers = useQuery({
    queryKey: voucherKeys.list({ limit: 1 }),
    queryFn: ({ signal }) => listVouchers({ limit: 1 }, signal),
  })
  const changes = useQuery({
    queryKey: changeKeys.list(false),
    queryFn: ({ signal }) => listPriceChanges(false, signal),
  })
  const fleet = useQuery({
    queryKey: commercialKeys.fleet(),
    queryFn: ({ signal }) => commercialFleet(signal),
  })

  const ruleRows = useMemo(() => rules.data?.rules ?? [], [rules.data])
  const campaignRows = useMemo(
    () => campaigns.data?.campaigns ?? [],
    [campaigns.data]
  )

  // Exact, and the only total on this page that is. See the module note.
  const given = useMemo(() => fold(ruleRows), [ruleRows])
  const gaveBefore = useMemo(
    () => fold(ruleRows.map((one) => one.previous)),
    [ruleRows]
  )
  const movement = delta(given.benefit_minor, gaveBefore.benefit_minor)

  const posters = usePosters(books.data)
  // The window's own end, not a fresh clock. Whether a campaign is running
  // is then measured at the same instant the figures beside it were, and a
  // re-render cannot flip a card from Running to Ended while its numbers go
  // on describing a window that included it.
  const board = useBoard(campaignRows, posters, now)
  const stack = useStack(campaignRows, ruleRows, board.colourOf)
  // The board opens on what is on or coming — every campaign ever run is a
  // history, and it is one press away.
  const [showEnded, setShowEnded] = useState(false)
  const current = board.rows.filter((row) => !isOver(row, now))
  const ended = board.rows.length - current.length
  const onBoard = showEnded ? board.rows : current

  const outstanding = changes.data ?? []
  const attention = outstanding.filter(needsAttention)
  const shops = fleet.data?.items ?? []
  const silent = shops.filter((shop) => !shop.has_ever_activated)
  const behind = shops.filter(
    (shop) => shop.has_ever_activated && (shop.behind_by ?? 0) > 0
  )
  const ledger = vouchers.data?.ledger

  /// The eight promotions that gave most away and the six changes most in need
  /// of somebody — the rest are a link away.
  const earning = useMemo(() => stack.earning.slice(0, 8), [stack.earning])
  const unfinished = useMemo(() => attention.slice(0, 6), [attention])

  const leadFigures = (
    <>
      <Kpi
        label="Given away"
        value={money(rules.isPending ? undefined : given.benefit_minor)}
        delta={
          rules.isPending
            ? undefined
            : movement === null
              ? gaveBefore.benefit_minor === 0 && given.benefit_minor > 0
                ? "new this period"
                : undefined
              : `${movement > 0 ? "+" : ""}${movement}% vs previous ${WINDOW_DAYS} days`
        }
        // Up is not good here. Every other strip in this app reads a rise as
        // progress; this one is margin let go of, so a bigger number is a
        // bigger bill and the arrow has to agree with the sentence.
        tone={movement === null ? "flat" : movement > 0 ? "down" : "up"}
      />
      <Kpi
        label="Baskets touched"
        value={count(rules.isPending ? undefined : given.sale_count)}
        delta={
          rules.isPending
            ? undefined
            : `${count(ruleRows.length)} promotions earning`
        }
      />
      <Kpi
        label="Campaigns running"
        value={count(campaigns.isPending ? undefined : board.live.length)}
        delta={
          board.rows.length > board.live.length
            ? `${count(board.rows.length - board.live.length)} not running`
            : undefined
        }
      />
      <Kpi
        label="Vouchers outstanding"
        value={money(ledger?.outstanding_minor)}
        delta={ledger ? `${count(ledger.outstanding_count)} cards` : undefined}
      />
    </>
  )

  /// The promotions that gave most away, one to a row. The campaign's poster
  /// stands beside a rule: see the module note — a rule has no picture, and
  /// borrowing its envelope's is the truthful way to show which one it runs
  /// under.
  const earningColumns = [
    field<RulePerformance>("promotion", "Promotion", (rule) => (
      <div className="flex items-center gap-3">
        <Thumbnail
          url={
            rule.campaign_id === null
              ? null
              : (board.posterOf(rule.campaign_id) ?? null)
          }
          className="size-8 shrink-0 rounded-inner"
        />
        <span className="min-w-0 max-w-[14rem]">
          <span className="block truncate text-ink">
            {rule.name ?? rule.rule_id}
          </span>
          <span className="block truncate text-[0.9375rem] text-mute">
            {rule.campaign_id === null
              ? "No campaign"
              : (board.nameOf(rule.campaign_id) ?? rule.campaign_id)}
          </span>
        </span>
      </div>
    )),
    field<RulePerformance>(
      "shape",
      "Shape",
      (rule) => (
        <Sparkline
          values={rule.series.map((one) => one.benefit_minor)}
          colour={
            rule.campaign_id === null
              ? BAND_NEUTRAL
              : board.colourOf(rule.campaign_id)
          }
          className="w-16"
        />
      ),
      { priority: 3 }
    ),
    field<RulePerformance>(
      "given",
      "Given Away",
      (rule) => money(rule.benefit_minor),
      { right: true, by: (rule) => rule.benefit_minor }
    ),
    field<RulePerformance>(
      "baskets",
      "Baskets",
      (rule) => count(rule.sale_count),
      { right: true, by: (rule) => rule.sale_count, priority: 2 }
    ),
  ]

  /// The price changes still waiting on somebody. Two different problems,
  /// never merged into "late": a failure is a till that tried and could not;
  /// a closed window with shops waiting is work the calendar did not do.
  const unfinishedColumns = [
    field<PriceChange>("change", "Unfinished", (change) => (
      <>
        <span className="block truncate text-ink">{change.name}</span>
        <span className="block truncate text-[0.9375rem] text-mute">
          {describeChangeKind(change.kind)} · {day(change.effective_from)}
        </span>
      </>
    )),
    field<PriceChange>(
      "why",
      "Why",
      (change) =>
        change.rollout.failed > 0 ? (
          <Status tone="bad">Reported a failure</Status>
        ) : (
          <Status tone="warn">Closed, stores waiting</Status>
        ),
      { card: "status" }
    ),
    field<PriceChange>(
      "stores",
      "Stores",
      (change) => (
        <span className="tabular-nums">
          {count(change.rollout.activated)}/{count(change.rollout.target)}
        </span>
      ),
      { right: true, by: (change) => change.rollout.activated }
    ),
  ]

  return (
    <PageContent>
      <PageHeader crumb="Marketing" title="Overview" />

      {/* Six reads land at six different moments, and a tile whose query has
          not answered yet draws an em dash rather than a nought. "Rp 0 given
          away" is a sentence somebody can act on and it would be false for as
          long as the slowest of these takes — `money(undefined)` and
          `count(undefined)` are already "—" for exactly this. */}
      <KpiStrip>
        {leadFigures}
        {!phone && (
          <>
            <Kpi
              label="Changes need attention"
              value={count(changes.isPending ? undefined : attention.length)}
              delta={
                changes.isPending
                  ? undefined
                  : `of ${count(outstanding.length)} outstanding`
              }
              tone={attention.length > 0 ? "down" : "flat"}
            />
            <Kpi
              label="Stores behind on prices"
              value={count(
                fleet.isPending ? undefined : behind.length + silent.length
              )}
              delta={
                fleet.isPending
                  ? undefined
                  : silent.length > 0
                    ? `${count(silent.length)} never reported`
                    : `of ${count(fleet.data?.shop_count ?? 0)}`
              }
              tone={behind.length + silent.length > 0 ? "down" : "flat"}
            />
          </>
        )}
      </KpiStrip>

      {phone ? (
        <div className="mb-6">
          <SubHead
            aside={`${day(scope.from)} – ${day(new Date(now).toISOString())}`}
          >
            Gave away most
          </SubHead>
          {queryState(rules, {
            loading: "Loading…",
            render: () =>
              stack.earning.length === 0 ? (
                <EmptyState>Nothing given away.</EmptyState>
              ) : (
                <ul className="mt-3 flex flex-col gap-2.5">
                  {stack.earning.slice(0, 3).map((rule) => (
                    <PhoneCard
                      key={rule.rule_id}
                      onOpen={() =>
                        void navigate({
                          to: "/commercial/promotions",
                          search: { rule: rule.rule_id },
                        } as never)
                      }
                      head={
                        <CardName
                          name={rule.name ?? rule.rule_id}
                          line={
                            rule.campaign_id === null
                              ? "No campaign"
                              : (board.nameOf(rule.campaign_id) ??
                                rule.campaign_id)
                          }
                        />
                      }
                      lead={
                        <CardFigure
                          value={money(rule.benefit_minor)}
                          caption={`${count(rule.sale_count)} ${rule.sale_count === 1 ? "basket" : "baskets"}`}
                        />
                      }
                    />
                  ))}
                </ul>
              ),
          })}
        </div>
      ) : (
        <Card className="mb-6 p-6">
          <SubHead
            aside={`${day(scope.from)} – ${day(new Date(now).toISOString())}`}
          >
            What the offers gave away
          </SubHead>
          {queryState(rules, {
            loading: "Loading…",
            render: () =>
              stack.rows.length === 0 ? (
                <EmptyState>Nothing given away.</EmptyState>
              ) : (
                <>
                  <BandLegend bands={stack.bands} />
                  <BandStack
                    rows={stack.rows}
                    bands={stack.bands}
                    format={money}
                    titleOf={(bucket) => day(bucket)}
                    labelOf={(bucket) => bucket.slice(5).replace("-", "/")}
                    totalLabel="All offers"
                  />
                </>
              ),
          })}
        </Card>
      )}

      <div className="mb-6">
        <SubHead
          aside={
            <span className="flex gap-4">
              {ended > 0 && (
                <button
                  type="button"
                  aria-pressed={showEnded}
                  onClick={() => setShowEnded((was) => !was)}
                  className="text-accent hover:underline"
                >
                  {showEnded ? "Hide ended" : `Show ended (${count(ended)})`}
                </button>
              )}
              <AppLink to="/commercial/campaigns" className="text-accent">
                Open Campaigns
              </AppLink>
            </span>
          }
        >
          Campaigns
        </SubHead>
        {queryState(campaigns, {
          loading: "Loading…",
          render: () =>
            onBoard.length === 0 ? (
              <EmptyState>
                {board.rows.length === 0
                  ? "No campaigns."
                  : "No live campaigns."}
              </EmptyState>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
                {onBoard.map((row) => (
                  <CampaignCard key={row.campaign_id} row={row} />
                ))}
              </div>
            ),
        })}
      </div>

      {/* `min-w-0` on the children, not decoration: a grid item's default
          `min-width: auto` lets it be sized by its widest content, so the
          promotion table inside would widen its own column past the viewport
          and take the page with it — the scroll has to happen in the card. */}
      <div className="mb-6 grid items-start gap-6 min-[1100px]:grid-cols-[1.35fr_1fr] [&>*]:min-w-0">
        {!phone && (
          <Card className="p-6">
            <SubHead
              aside={
                <AppLink to="/commercial/promotions" className="text-accent">
                  Open Promotions
                </AppLink>
              }
            >
              Promotions doing the work
            </SubHead>
            {queryState(rules, {
              loading: "Loading…",
              render: () =>
                stack.earning.length === 0 ? (
                  <EmptyState>Nothing discounted.</EmptyState>
                ) : (
                  <>
                    {/* Under the card's own padding, so a row's text stands
                        where the heading's does. */}
                    <div className="-mx-3.5">
                      <CardTable<RulePerformance>
                        columns={earningColumns}
                        rows={earning}
                        getRowId={ruleKey}
                        apart={false}
                        // The promotion, on its own screen.
                        onRowClick={(rule) =>
                          void navigate({
                            to: "/commercial/promotions",
                            search: { rule: rule.rule_id },
                          } as never)
                        }
                      />
                    </div>
                    <More
                      hidden={stack.earning.length - 8}
                      to="/commercial/promotions"
                    />
                  </>
                ),
            })}
          </Card>
        )}

        <Card className="p-6">
          <SubHead
            aside={
              <AppLink to="/commercial/vouchers" className="text-accent">
                Open Vouchers
              </AppLink>
            }
          >
            What the business still owes
          </SubHead>
          {queryState(vouchers, {
            loading: "Loading…",
            render: (book) =>
              book.ledger.issued_count === 0 ? (
                <EmptyState>No vouchers.</EmptyState>
              ) : (
                <>
                  <div className="mb-2 text-[1.375rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
                    {money(book.ledger.outstanding_minor)}
                  </div>
                  <div className="mb-5 text-[0.9375rem] text-mute">
                    {count(book.ledger.outstanding_count)} live cards of{" "}
                    {count(book.ledger.issued_count)} issued
                  </div>
                  <Share
                    total={book.ledger.issued_minor}
                    parts={[
                      {
                        key: "outstanding",
                        label: "Still owed",
                        value: book.ledger.outstanding_minor,
                        colour: "var(--accent)",
                      },
                      {
                        key: "redeemed",
                        label: "Spent",
                        value: book.ledger.redeemed_minor,
                        colour: "var(--a-green)",
                      },
                      {
                        key: "voided",
                        label: "Written off",
                        value: book.ledger.voided_minor,
                        colour: BAND_NEUTRAL,
                      },
                    ]}
                    format={money}
                  />
                  {/* Expiry is not a status — a stale card is still ACTIVE
                      with a balance, and the ledger reports it separately for
                      that reason. It is a slice of "still owed" above, never a
                      fourth segment beside it. */}
                  {book.ledger.expired_count > 0 && (
                    <p className="mt-5 border-t border-hairline pt-4 text-[0.9375rem] text-bad-fg">
                      {money(book.ledger.expired_minor)} on{" "}
                      {count(book.ledger.expired_count)} cards past their date.
                    </p>
                  )}
                </>
              ),
          })}
        </Card>
      </div>

      <Card className="p-6">
        <SubHead
          aside={
            <span className="flex gap-4">
              <AppLink to="/commercial/prices" className="text-accent">
                Open Prices
              </AppLink>
              <AppLink to="/commercial/changes" className="text-accent">
                Open Changes
              </AppLink>
            </span>
          }
        >
          Prices
        </SubHead>
        <div className="grid items-start gap-5 min-[900px]:grid-cols-[1fr_1.2fr] [&>*]:min-w-0">
          {queryState(fleet, {
            loading: "Loading…",
            render: (data) => (
              <div>
                <Share
                  total={data.shop_count}
                  parts={[
                    {
                      key: "current",
                      label: "Up to date",
                      value: Math.max(
                        0,
                        data.shop_count - behind.length - silent.length
                      ),
                      colour: "var(--ok)",
                    },
                    {
                      key: "behind",
                      label: "Behind",
                      value: behind.length,
                      colour: "var(--warn)",
                    },
                    {
                      key: "silent",
                      label: "Never reported",
                      value: silent.length,
                      colour: "var(--bad)",
                    },
                  ]}
                  format={(value) =>
                    `${count(value)} store${value === 1 ? "" : "s"}`
                  }
                />
                {/* The silent shops by name, deliberately. A shop that has
                    never reported is not "a bit behind": nothing is known
                    about what it charges at all, and it is the row an ordering
                    by lateness would bury. */}
                {(silent.length > 0 || behind.length > 0) && (
                  <ul className="mt-5 space-y-3 border-t border-hairline pt-4">
                    {[...silent, ...behind].slice(0, 5).map((shop) => (
                      <li
                        key={shop.origin_id}
                        className="flex items-baseline justify-between gap-3 text-[0.9375rem]"
                      >
                        {shop.site_id === null ? (
                          <span className="truncate text-text">
                            {shop.label ?? "Till not assigned to a store"}
                          </span>
                        ) : (
                          <AppLink
                            to="/commercial/prices"
                            sheet={{ key: "shop", value: shop.site_id }}
                            className="truncate text-text hover:text-accent"
                          >
                            {shop.label ?? shop.site_id}
                          </AppLink>
                        )}
                        <span className="shrink-0 text-[0.9375rem] text-mute">
                          {shop.has_ever_activated
                            ? `${count(shop.behind_by ?? 0)} price change${(shop.behind_by ?? 0) === 1 ? "" : "s"} behind · ${moment(shop.activated_at)}`
                            : "never reported"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <More
                  hidden={silent.length + behind.length - 5}
                  to="/commercial/changes"
                />
              </div>
            ),
          })}

          {queryState(changes, {
            loading: "Loading…",
            render: () =>
              attention.length === 0 ? (
                <EmptyState>
                  {outstanding.length === 0
                    ? "No price work outstanding."
                    : `${count(outstanding.length)} rolling out.`}
                </EmptyState>
              ) : (
                <>
                  <div className="-mx-3.5">
                    <CardTable<PriceChange>
                      columns={unfinishedColumns}
                      rows={unfinished}
                      getRowId={changeKey}
                      apart={false}
                      // The change, on its own screen.
                      onRowClick={(change) =>
                        void navigate({
                          to: "/commercial/changes",
                          search: { book: change.publication_id },
                        } as never)
                      }
                    />
                  </div>
                  <More
                    hidden={attention.length - 6}
                    to="/commercial/changes"
                  />
                </>
              ),
          })}
        </div>
      </Card>
    </PageContent>
  )
}

// ── the board ──────────────────────────────────────────────────────────────

/// One campaign as the board draws it: what the book says it looks like, and
/// what the sale facts say it did.
interface BoardRow extends CampaignPerformance {
  readonly image_url: string | null
  readonly headline: string | null
  readonly colour: string
  readonly running: boolean
}

/// The poster for each campaign, keyed by its business id.
///
/// One row per campaign already: `campaignCatalogue` takes the newest
/// publication that declares each id, in SQL, by the same rule a till resolves
/// it with. Picking a row here would be a second opinion about which of four
/// books is the live statement of the Eid sale.
function usePosters(
  rows: readonly CampaignRow[] | undefined
): Map<string, BookCampaign> {
  return useMemo(
    () =>
      new Map(
        (rows ?? []).map((row) => [row.campaign.campaign_id, row.campaign])
      ),
    [rows]
  )
}

function useBoard(
  rows: readonly CampaignPerformance[],
  posters: Map<string, BookCampaign>,
  /// The instant "running" is judged at — the end of the window the figures
  /// were measured over. See the call site.
  now: number
) {
  return useMemo(() => {
    const running = (row: CampaignPerformance) => {
      if (row.status !== "ACTIVE") return false
      const from = row.valid_from === null ? null : Date.parse(row.valid_from)
      const to = row.valid_to === null ? null : Date.parse(row.valid_to)
      return (from === null || from <= now) && (to === null || to > now)
    }

    // Ordered by what it GAVE AWAY, not by name or by date. The campaign
    // spending the most is the one somebody would want to look at first, and
    // the ordering is then the same fact the chart's bands are stacked by — so
    // the board reads in the order of the colours above it.
    const ordered = [...rows].sort((left, right) => {
      const money = right.benefit_minor - left.benefit_minor
      if (money !== 0) return money
      const live = Number(running(right)) - Number(running(left))
      if (live !== 0) return live
      return (left.name ?? left.campaign_id).localeCompare(
        right.name ?? right.campaign_id
      )
    })

    const colourFor = new Map<string, string>()
    // Only the ones that actually traded get a hue. A colour handed to a
    // campaign that took nothing is a legend entry for an empty band.
    const earning = ordered.filter((row) => row.benefit_minor > 0)
    earning.slice(0, BAND_TONES.length).forEach((row, index) => {
      colourFor.set(row.campaign_id, BAND_TONES[index])
    })

    const board: BoardRow[] = ordered.map((row) => {
      const poster = posters.get(row.campaign_id)
      return {
        ...row,
        image_url: poster?.image_url ?? null,
        headline: poster?.headline ?? null,
        colour: colourFor.get(row.campaign_id) ?? BAND_NEUTRAL,
        running: running(row),
      }
    })

    return {
      rows: board,
      live: board.filter((row) => row.running),
      colourOf: (id: string) => colourFor.get(id) ?? BAND_NEUTRAL,
      posterOf: (id: string) => posters.get(id)?.image_url ?? null,
      nameOf: (id: string) =>
        rows.find((row) => row.campaign_id === id)?.name ?? null,
      /// Which campaigns earned a hue, biggest first — the chart's bands.
      banded: earning.slice(0, BAND_TONES.length),
      tail: earning.slice(BAND_TONES.length),
    }
  }, [rows, posters, now])
}

/// The daily stack: what each campaign gave away, per day, with everything
/// that belongs to no campaign as one neutral band.
///
/// Built from BOTH reports on purpose. The campaign report cannot see a rule
/// that names no campaign — half the offers in an ordinary book — and the rule
/// report cannot see a clearance, which is a campaign-level giveaway recorded
/// per line rather than per rule. Taking the campaigns from one and the
/// orphans from the other is the only reading where the column height is the
/// module's whole bill.
function useStack(
  campaigns: readonly CampaignPerformance[],
  rules: readonly RulePerformance[],
  colourOf: (id: string) => string
) {
  return useMemo(() => {
    const earning = [...rules]
      .filter((rule) => rule.benefit_minor > 0)
      .sort((left, right) => right.benefit_minor - left.benefit_minor)

    const banded = [...campaigns]
      .filter((row) => row.benefit_minor > 0)
      .sort((left, right) => right.benefit_minor - left.benefit_minor)
    const named = banded.slice(0, BAND_TONES.length)
    const tail = banded.slice(BAND_TONES.length)
    const solo = earning.filter((rule) => rule.campaign_id === null)

    const byDay = new Map<string, Record<string, number>>()
    const put = (day: string, key: string, value: number) => {
      const held = byDay.get(day) ?? {}
      held[key] = (held[key] ?? 0) + value
      byDay.set(day, held)
    }
    for (const row of named) {
      for (const point of row.series) {
        put(
          point.day,
          row.campaign_id,
          point.benefit_minor + point.clearance_minor
        )
      }
    }
    for (const row of tail) {
      for (const point of row.series) {
        put(point.day, SOLO, point.benefit_minor + point.clearance_minor)
      }
    }
    for (const rule of solo) {
      for (const point of rule.series) put(point.day, SOLO, point.benefit_minor)
    }

    const bands: ChartBand[] = named.map((row) => ({
      key: row.campaign_id,
      label: row.name ?? row.campaign_id,
      colour: colourOf(row.campaign_id),
    }))
    if (solo.length > 0 || tail.length > 0) {
      bands.push({
        key: SOLO,
        label:
          tail.length > 0
            ? `No campaign, and ${count(tail.length)} smaller`
            : "No campaign",
        colour: BAND_NEUTRAL,
      })
    }

    const rows: ChartRow[] = [...byDay.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([bucket, values]) => ({
        bucket,
        ...Object.fromEntries(
          bands.map((band) => [band.key, values[band.key] ?? 0])
        ),
      }))

    return { rows, bands, earning }
  }, [campaigns, rules, colourOf])
}

function CampaignCard({ row }: { row: BoardRow }) {
  const spend = consumed(row.benefit_minor, row.budget_minor)
  return (
    <AppLink
      to="/commercial/campaigns"
      sheet={{ key: "campaign", value: row.campaign_id }}
      className="group block overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft transition-colors hover:border-hairline-2"
    >
      <div className="relative">
        <Thumbnail
          url={row.image_url}
          fallback="No banner"
          className="aspect-[16/7] w-full"
        />
        {/* The band's colour, on the poster. It is the only thing tying this
            card to its column in the chart above, and without it five cards
            and five bands are two unrelated lists of the same names. */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1"
          style={{ background: row.colour }}
        />
      </div>
      <div className="p-5">
        <div className="mb-4 flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-[0.9375rem] font-semibold text-ink">
              {row.headline ?? row.name ?? row.campaign_id}
            </span>
            <span className="block truncate text-[0.9375rem] text-mute">
              {row.headline && row.name ? `${row.name} · ` : ""}
              {span(row.valid_from, row.valid_to)}
            </span>
          </span>
          <Status tone={row.running ? "ok" : "neutral"}>
            {row.running ? "Running" : describeStatus(row.status)}
          </Status>
        </div>

        {row.sale_count === 0 ? (
          <p className="text-[0.9375rem] text-mute">No sales.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4 text-[0.9375rem]">
              <Figure label="Given away" value={money(row.benefit_minor)} />
              {/* Per campaign, this IS the server's own figure rather than a
                  sum of overlapping rows — so it can be drawn here and not in
                  the strip above. It is still influenced revenue: the whole
                  basket counts whenever the campaign touched it. */}
              <Figure
                label="Promo sales"
                value={money(row.basket_revenue_minor)}
              />
              <Figure label="Baskets" value={count(row.sale_count)} />
            </div>
            {spend !== null && (
              <div className="mt-4 flex items-center gap-3">
                <Meter
                  value={spend}
                  tone={spend > 0.9 ? "bad" : spend > 0.7 ? "warn" : "accent"}
                />
                <span className="shrink-0 text-[0.9375rem] text-mute tabular-nums">
                  {Math.round(spend * 100)}% of {money(row.budget_minor)}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </AppLink>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="block min-w-0">
      <span className="block truncate text-[0.9375rem] text-mute">{label}</span>
      <span className="block truncate font-semibold text-ink tabular-nums">
        {value}
      </span>
    </span>
  )
}

/// Over: ended or cancelled, or past its window whatever the status says.
/// Paused, draft and scheduled stay on the board — each is still a decision
/// somebody may come back to.
function isOver(row: CampaignPerformance, now: number): boolean {
  if (row.status === "EXPIRED" || row.status === "CANCELLED") return true
  return row.valid_to !== null && Date.parse(row.valid_to) <= now
}

/// The rest of a list the panel shows only the top of, one click away.
function More({ hidden, to }: { hidden: number; to: string }) {
  if (hidden <= 0) return null
  return (
    <AppLink
      to={to}
      className="mt-4 inline-block text-[0.9375rem] text-accent hover:underline"
    >
      +{count(hidden)} more
    </AppLink>
  )
}

/// A campaign's state, in the words the board needs.
///
/// "Running" is computed from the window rather than read off the status, so
/// only the five endings it cannot describe come through here — and CANCELLED
/// and EXPIRED stay different, because only one of them was somebody's
/// decision.
function describeStatus(status: string | null): string {
  switch (status) {
    case "ACTIVE":
      return "Not in window"
    case "SCHEDULED":
      return "Scheduled"
    case "PAUSED":
      return "Paused"
    case "EXPIRED":
      return "Ended"
    case "CANCELLED":
      return "Cancelled"
    case "DRAFT":
      return "Draft"
    default:
      return "Unknown"
  }
}

// ── one whole, split into named parts ──────────────────────────────────────

interface Part {
  readonly key: string
  readonly label: string
  readonly value: number
  readonly colour: string
}

/// A single total broken into its parts, as one bar and a key beneath it.
///
/// Two things on this page are shaped like this and nothing else is: a voucher
/// book is what is owed plus what is gone, and a fleet is the shops on the
/// newest book plus the shops that are not. Three meters would draw them as
/// three unrelated proportions of three different wholes, which is exactly
/// what they are not.
function Share({
  total,
  parts,
  format,
}: {
  total: number
  parts: readonly Part[]
  format: (value: number) => string
}) {
  const shown = parts.filter((part) => part.value > 0)
  const scale = total > 0 ? total : shown.reduce((sum, p) => sum + p.value, 0)
  return (
    <div>
      <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-soft-2">
        {shown.map((part) => (
          <span
            key={part.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              background: part.colour,
              width: `${scale > 0 ? (part.value / scale) * 100 : 0}%`,
            }}
          />
        ))}
      </div>
      <dl className="mt-4 space-y-2">
        {parts.map((part) => (
          <div
            key={part.key}
            className={cn(
              "flex items-baseline justify-between gap-3 text-[0.9375rem]",
              part.value === 0 && "text-mute"
            )}
          >
            <dt className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="size-[5px] shrink-0 rounded-full"
                style={{ background: part.colour }}
              />
              <span className="truncate text-text">{part.label}</span>
            </dt>
            <dd className="shrink-0 font-medium text-ink tabular-nums">
              {format(part.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
