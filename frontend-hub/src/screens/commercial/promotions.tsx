import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"
import type { RuleStatus } from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { Meter } from "@/components/ui/meter"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { DockedFilters } from "@/components/ui/list-chrome"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  ErrorState,
  Truncated,
} from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count, day, label, money, toneFor } from "@/lib/format"
import {
  CATALOGUE_PAGE,
  commercialFleet,
  commercialKeys,
  commercialUsage,
  promotionCatalogue,
  publishUsageToFleet,
  setRuleStatus,
  type CampaignInput,
  type CampaignRow,
  type PromotionRow,
  type PromotionUsage,
  type PublishReceipt,
  type UsageReceipt,
} from "@/lib/queries/commercial"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { PerformanceHeader } from "@/screens/commercial/performance-header"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Switch } from "@/components/ui/form"
import { RuleForm } from "@/screens/commercial/rule-form"
import { Terms } from "@/screens/commercial/controls"
import {
  capsOf,
  conditionsOf,
  consumed,
  describeCustomers,
  describeEffect,
  describePeriod,
  describeScope,
  percent,
  termsOf,
  useActor,
} from "@/screens/commercial/shared"

/// Promotions — which offers exist, what each has cost, whether it is live, and
/// where it has reached.
///
/// It replaces a screen that listed only *usage*, which meant a promotion that
/// had never fired was simply absent: the list could not tell "we are not
/// running one" from "we are running one and nobody has taken it". The rules
/// come from the books now and the spend is joined onto them, so a promotion
/// with no uses is a row reading zero rather than a row that is not there.
///
/// Three facts about the data are load-bearing.
///
///  1. **There is no rules endpoint.** The list is built by opening every
///     published book (`promotionCatalogue`), which is N+1 and is said out loud
///     under the table. A `GET /commercial/rules` would collapse it.
///  2. **A rule restated in a later book is one promotion amended, not two.**
///     That is the shop's own model — `load_rules` reads `DISTINCT ON (rule_id)
///     … ORDER BY version DESC` — and it is why the switch below can work at
///     all.
///  3. **A budget is a brake, not a gate.** Every shop enforces from the last
///     count it received, so the figure that must not be exceeded is the one on
///     this screen, and "Send counts to shops" is what keeps the brake close to
///     the truth.

/// The two things a column needs from the screen around it.
///
/// A column is declared outside its component so it never closes over props —
/// which leaves the switch, whose whole job is to call back into the screen,
/// with nowhere to reach. TanStack's own `meta` slot is that route, and this is
/// its shape. Read through `unknown` rather than `any`: the slot is untyped by
/// the table, and asserting a shape once here is better than nine unchecked
/// property accesses in the cells.
interface RowActions<T> {
  readonly busy: string | null
  readonly onToggle: (line: T) => void
  /// How many shops there are, for the denominator beside each row. `null`
  /// until the fleet read lands — a numerator on its own is still true.
  readonly shops: number | null
}

function actionsOf<T>(table: unknown): RowActions<T> | undefined {
  return (table as { options?: { meta?: RowActions<T> } }).options?.meta
}

/// One promotion, with what it has actually cost joined on.
interface PromotionLine {
  readonly row: PromotionRow
  readonly usage: PromotionUsage | null
  /// How many shops are charging the book this rule arrived in. Empty is the
  /// interesting case: published, and reaching no till.
  readonly reached: number
}

/// What a promotion has actually been taken up on: how often, and what that
/// gave away.
///
/// One column because it is one answer. `Used` and `Spent` sat apart, which
/// meant reading across the table to learn that five baskets cost Rp 234.000 —
/// and the pair is never read singly. The budget they used to be measured
/// against is in the panel now; a meter is a question about a limit, and most
/// promotions here have none.
function Usage({ usage }: { usage: PromotionUsage | null }) {
  // "Never used" rather than a dash. The dash is this app\'s word for "no
  // value here", and a promotion that has fired nought times HAS a value: the
  // one this screen was built to be able to show.
  if (usage === null || usage.uses === 0)
    return <span className="text-mute">Never used</span>
  return (
    <span className="text-text tabular-nums">
      {count(usage.uses)} use{usage.uses === 1 ? "" : "s"}{" "}
      <span className="text-mute">· {money(usage.spent_minor)}</span>
    </span>
  )
}

/// How many shops are charging the book this promotion arrived in, against how
/// many shops there are.
///
/// The denominator is the point. "10 shops" is a figure you have to already
/// know the size of the estate to read, and it looked the same whether three
/// were missing or none. Zero keeps its warning rather than becoming "0 / 13"
/// in the ordinary type: a published promotion reaching nobody costs nothing
/// and sells nothing, and in a list of live offers it reads as success.
function Reached({ shops, of }: { shops: number; of: number | null }) {
  const total = of === null ? null : ` / ${count(of)}`
  return shops === 0 ? (
    <Pill tone="warn">0{total ?? " shops"}</Pill>
  ) : (
    <span className="text-text tabular-nums">
      {count(shops)}
      {total === null ? " shops" : <span className="text-mute">{total}</span>}
    </span>
  )
}

// Columns are declared outside the component, so they never close over props.
// The switch is the exception the shape allows for: it needs a callback, so it
// is reached through `meta` on the table rather than through a closure here.
const promotionColumns: ColumnDef<TableSetup, PromotionLine>[] = [
  {
    id: "promotion",
    accessorFn: (row) => row.row.name,
    header: "Promotion",
    size: 220,
    meta: { filter: { kind: "text" } },
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.row.name}</span>
    ),
  },
  {
    id: "live",
    accessorFn: (row) => row.row.status,
    header: "Live",
    size: 70,
    enableSorting: false,
    // The switch IS the status. A `Status` pill beside it said the same word
    // twice from two places, which is a disagreement waiting to happen: a green
    // "Active" next to a toggle leaves somebody deciding which of the two is
    // the fact.
    //
    // The clause that used to live on the pill is not here either, and that is
    // deliberate: the tabs above the table ask the same question and ask it
    // better. A facet can only offer the two words the column holds; the tabs
    // also offer ENDED and SCHEDULED, which are not stored anywhere and are
    // read off the dates instead. Two controls for one question is the
    // duplication the pill was removed for.
    cell: ({ row, table }) => {
      const meta = actionsOf<PromotionLine>(table)
      const status = row.original.row.status
      return (
        <Switch
          on={status === "ACTIVE"}
          busy={meta?.busy === row.original.row.rule_id}
          label={`${status === "ACTIVE" ? "Pause" : "Resume"} ${row.original.row.name}`}
          onToggle={() => meta?.onToggle?.(row.original)}
        />
      )
    },
  },
  {
    id: "scope",
    accessorFn: (row) => describeScope(row.row.definition),
    header: "Applies to",
    size: 160,
    // **Not a facet.** The accessor is a sentence `describeScope` composes —
    // "3 products", "Division MENSWEAR", "The whole basket" — so a picker over
    // it would offer one option per rule rather than one per kind of scope,
    // and ticking "2 articles" would narrow to the two unrelated rules that
    // happen to name two articles each. The kind is not on the row to ask
    // about; it is inside `definition.applicability`.
    cell: ({ row }) => (
      <span className="text-text">
        {describeScope(row.original.row.definition)}
        {describeCustomers(row.original.row.definition) === "Members" && (
          <Tag className="ml-1.5">members</Tag>
        )}
      </span>
    ),
  },
  {
    id: "effect",
    accessorFn: (row) => describeEffect(row.row.definition.effect),
    // "Benefit" rather than "What it does": every other column on this row
    // also says what it does, and this is the one that says what the shopper
    // gets.
    header: "Benefit",
    size: 150,
    cell: ({ row }) => (
      <span className="text-text">
        {describeEffect(row.original.row.definition.effect)}
      </span>
    ),
  },
  {
    id: "reached",
    accessorFn: (row) => row.reached,
    header: "Stores",
    size: 110,
    // Published and in force are different things, and this is the clause that
    // separates them: a promotion used 0 times in 13 shops has not caught on,
    // and one used 0 times in 0 shops was never carried anywhere. They look
    // identical until somebody asks.
    meta: {
      align: "right",
      filter: { kind: "number", label: "Stores", unit: "shops" },
    },
    cell: ({ row, table }) => (
      <Reached
        shops={row.original.reached}
        of={actionsOf<PromotionLine>(table)?.shops ?? null}
      />
    ),
  },
  {
    id: "usage",
    accessorFn: (row) => row.usage?.uses ?? 0,
    header: "Usage",
    size: 170,
    // **Sorted and filtered on uses, not on spend.** The cell says both, and
    // only one of them can be the number underneath it. Uses wins because
    // "is 0" is the question this screen was built to be able to answer — a
    // promotion that exists and has never fired. The screen it replaced could
    // not show one at all, because it listed usage and an unused rule has none.
    //
    // Spend is therefore readable here but not sortable. The row that has run
    // past what it was allowed to spend is not found by sorting anyway: the
    // banner above the table names it.
    meta: { filter: { kind: "number", label: "Used", unit: "times" } },
    cell: ({ row }) => <Usage usage={row.original.usage} />,
  },
  {
    id: "period",
    accessorFn: (row) => {
      const to = conditionsOf(row.row.definition).effective_to
      const at = to === null ? Number.NaN : new Date(to).getTime()
      // No end date sorts last. "It does not stop" is not a date, and a
      // sentinel at zero would head up "ending soonest" with every promotion
      // that never ends. Safe as a sentinel only because this column carries
      // no clause — a filter would take `Infinity` at face value, which is the
      // trap the old `Budget` column documented.
      return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at
    },
    header: "Period",
    size: 150,
    // The first column to go when the table is in a narrow card. Every other
    // column answers "is this offer working"; this one answers "until when",
    // which is the question somebody asks after they have picked a row — and
    // the panel behind the row answers it.
    meta: { priority: 2 },
    cell: ({ row }) => {
      const period = describePeriod(row.original.row.definition)
      return period === null ? (
        <span className="text-mute">—</span>
      ) : (
        <span className="text-text">{period}</span>
      )
    },
  },
]

/// Where a promotion stands today — which is a different question from what
/// its status column says.
///
/// `RuleStatus` is `DRAFT | ACTIVE | PAUSED | EXPIRED` and **nothing in the
/// backend ever writes EXPIRED to a rule.** That is not an oversight; it is
/// this shop's position, stated where vouchers say it: a status that means "the
/// date has passed" is wrong from the instant it is written, because it has to
/// be rewritten by something at midnight or it lies. The date passes; the row
/// does not change.
///
/// So ENDED and SCHEDULED are read off the window rather than stored, which is
/// also what makes the Period column load-bearing rather than decorative. A
/// promotion with no window is never either — it starts when it is published
/// and stops when somebody stops it.
type Phase = "ACTIVE" | "PAUSED" | "ENDED" | "SCHEDULED"

const PHASES = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "PAUSED", label: "Paused" },
  { value: "ENDED", label: "Ended" },
  { value: "SCHEDULED", label: "Scheduled" },
] as const

function phaseOf(line: PromotionLine, at: number): Phase {
  // A window that has closed wins over a switch that is off. Both say the
  // offer is not running; only one of them says resuming it would change
  // nothing, and that is the more useful thing to be told.
  if (line.row.status === "EXPIRED") return "ENDED"
  const conditions = conditionsOf(line.row.definition)
  const ends = instant(conditions.effective_to)
  if (ends !== null && ends < at) return "ENDED"
  if (line.row.status !== "ACTIVE") return "PAUSED"
  const starts = instant(conditions.effective_from)
  if (starts !== null && starts > at) return "SCHEDULED"
  return "ACTIVE"
}

/// An instant, or `null` for both "not set" and "not a date". A malformed
/// stored date must not decide which tab a row lands in.
function instant(iso: string | null): number | null {
  if (iso === null) return null
  const at = new Date(iso).getTime()
  return Number.isNaN(at) ? null : at
}

/// The tiles and the time series at the top of this screen, parked.
///
/// **Owner's call, 2026-09-13: hidden until somebody decides which figures
/// belong there.** They were five metrics and a chart shared with the other
/// list in this module, and the two do not ask the same question — "Promo
/// Sales over the last 30 days" is a fact about offers, and a campaign is an
/// envelope with its own window. A header that answers the wrong question
/// confidently is worse than no header.
///
/// **Where those figures went, 2026-09-13:** onto the module's Overview, which
/// asks the question they were answering — what the offers gave away, what came
/// back, and which campaign it went to — over one window and across every
/// campaign and rule at once. A list is for finding one row; a module's money
/// is a fact about the module.
///
/// A flag rather than a deletion or a comment: the wiring stays type-checked
/// and turning it back on is one word. A commented-out block rots, and a
/// deleted one has to be rebuilt from memory.
const SHOW_PERFORMANCE = false

export function Promotions() {
  const client = useQueryClient()
  const actor = useActor()
  const sheet = useSheet("rule")
  const [query, setQuery] = useState("")
  const [phase, setPhase] = useState<(typeof PHASES)[number]["value"]>("ALL")
  const [writing, setWriting] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [sent, setSent] = useState<UsageReceipt | null>(null)
  const [receipt, setReceipt] = useState<PublishReceipt | null>(null)
  const [sorting, setSorting] = useState<SortingState>([
    { id: "usage", desc: true },
  ])

  const catalogue = useQuery({
    queryKey: commercialKeys.catalogue(),
    queryFn: ({ signal }) => promotionCatalogue(signal),
  })

  const usage = useQuery({
    queryKey: commercialKeys.usage(),
    queryFn: ({ signal }) => commercialUsage(signal),
  })

  /// How many shops there are to reach, which is the denominator beside every
  /// row. Its own small read rather than a figure carried on the catalogue: the
  /// size of the estate is a property of the estate, not of a price book, and
  /// `commercialFleet` is the endpoint this module already has for it.
  const fleet = useQuery({
    queryKey: commercialKeys.fleet(),
    queryFn: ({ signal }) => commercialFleet(signal),
  })
  const shops = fleet.data?.shop_count ?? null

  /// The two halves joined here and nowhere else. The count is an observation
  /// and changes with every sale; the limit is a decision, frozen with the book
  /// that declared it. A rule that has never fired is absent from usage — which
  /// is why the join is left-handed, from the rules.
  const byKey = useMemo(() => {
    const map = new Map<string, PromotionUsage>()
    for (const one of usage.data ?? []) map.set(`${one.kind}:${one.key}`, one)
    return map
  }, [usage.data])

  const promotions: PromotionLine[] = useMemo(
    () =>
      (catalogue.data?.rules ?? []).map((row) => ({
        row,
        usage: byKey.get(`RULE:${row.rule_id}`) ?? null,
        reached: row.book.activated_by.length,
      })),
    [catalogue.data, byKey]
  )

  /// Pause and resume, through the one function that knows how a status is
  /// written. There is no status route on the node, so this publishes a
  /// one-line book restating the rule — see `setRuleStatus`, which is the only
  /// place that has to change when `PATCH …/status` lands.
  const toggle = useMutation({
    mutationFn: (line: PromotionLine) =>
      setRuleStatus({
        rule: line.row.definition,
        status: (line.row.status === "ACTIVE"
          ? "PAUSED"
          : "ACTIVE") as RuleStatus,
        campaign: campaignFor(line, catalogue.data?.campaigns ?? []),
        version: catalogue.data?.next_version ?? 1,
        actorId: actor,
        // A fresh key per flip: two pauses of the same rule an hour apart are
        // two decisions, not one retried.
        idempotencyKey: crypto.randomUUID(),
      }),
    onSettled: () => {
      setBusy(null)
      client.invalidateQueries({ queryKey: commercialKeys.all })
    },
  })

  const idempotencyKey = useMemo(() => crypto.randomUUID(), [])

  const send = useMutation({
    mutationFn: () => publishUsageToFleet(actor, idempotencyKey),
    onSuccess: (result) => {
      setSent(result)
      // Sending does not change what has been given away — these counts come
      // from sales, not from dispatches. The read is refreshed only so the
      // receipt describes the figures now on screen rather than a list somebody
      // has been looking at for an hour.
      client.invalidateQueries({ queryKey: commercialKeys.usage() })
    },
  })

  // `mutate` is stable for the life of the mutation; `toggle` itself is a new
  // object on every status change of the mutation, and depending on it would
  // rebuild the whole table each time somebody flipped a switch.
  const flip = toggle.mutate

  /// Narrowed before the table is built rather than as a column clause, so
  /// every facet count under the Filter button counts the tab somebody is
  /// looking at. A chip saying "3 shops" over a list of thirteen is how a
  /// filter bar loses people\'s trust.
  ///
  /// The instant is the READ\'s, not the render\'s. `Date.now()` in a render is
  /// impure — the compiler says so and it is right: the same rows would land in
  /// different tabs on two renders that happen either side of midnight, with no
  /// state change to explain it. `dataUpdatedAt` is when this list actually came
  /// off the node, it is stable until the next fetch, and "ended as at when we
  /// asked" is the honest reading anyway. It is 0 before the first answer, and
  /// there are no rows to place then.
  const at = catalogue.dataUpdatedAt
  const shown = useMemo(() => {
    if (phase === "ALL") return promotions
    return promotions.filter((line) => phaseOf(line, at) === phase)
  }, [promotions, phase, at])

  const filters = useFilters(promotionColumns)

  const promotionTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: shown,
        columns: filters.columns,
        getRowId: (row: PromotionLine) => row.row.rule_id,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: query,
          sorting,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
        meta: {
          busy,
          shops,
          onToggle: (line: PromotionLine) => {
            setBusy(line.row.rule_id)
            flip(line)
          },
        },
      }),
      [
        shown,
        filters.columns,
        filters.columnFilters,
        query,
        sorting,
        busy,
        shops,
        flip,
      ]
    )
  )

  const overspent = promotions.filter(
    (line) =>
      line.usage !== null &&
      line.usage.budget_minor !== null &&
      line.usage.spent_minor >= line.usage.budget_minor
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Commercial"
        title="Promotions"
        sub="Which offers are running, what each gives the shopper, and how many shops are actually charging it."
        // Search and New promotion sit on the table\'s own toolbar now: they
        // act on the list, and the list is no longer the first thing under this
        // header. What stays is the one action that is about the fleet rather
        // than about the rows — sending the counts the shops enforce from.
        actions={
          <Button
            variant="soft"
            disabled={send.isPending || actor === ""}
            onClick={() => send.mutate()}
          >
            {send.isPending ? "Sending…" : "Send counts to shops"}
          </Button>
        }
      />

      {/* What the offers below actually did, over a window. The list says which
          exist and what they may spend; this says what they spent. */}
      {SHOW_PERFORMANCE && <PerformanceHeader of="rules" />}

      {toggle.isError && (
        <div className="mb-4">
          <ErrorState error={toggle.error} />
        </div>
      )}

      {send.isError && (
        <div className="mb-4">
          <ErrorState error={send.error} />
        </div>
      )}

      {receipt && (
        <Banner
          tone={receipt.delivered_to.length > 0 ? "ok" : "warn"}
          className="mb-4"
          onDismiss={() => setReceipt(null)}
        >
          {receipt.delivered_to.length > 0 ? (
            <>
              Book v{receipt.version} published and queued for{" "}
              {count(receipt.delivered_to.length)} shop
              {receipt.delivered_to.length === 1 ? "" : "s"} (
              {receipt.delivered_to.join(", ")}).
            </>
          ) : (
            <>
              Book v{receipt.version} published, and queued for nobody. No shop
              origin is registered, so this offer will never apply anywhere.
            </>
          )}
        </Banner>
      )}

      {sent && (
        <Banner tone="ok" className="mb-4" onDismiss={() => setSent(null)}>
          Counts as at {day(sent.counted_at)} sent to{" "}
          {count(sent.sent_to.length)} shop
          {sent.sent_to.length === 1 ? "" : "s"}. Until each one takes the
          message, it is still enforcing from the count before this.
        </Banner>
      )}

      {overspent.length > 0 && (
        <Banner tone="bad" className="mb-4">
          {count(overspent.length)} promotion
          {overspent.length === 1 ? " has" : "s have"} reached or passed the
          budget declared for {overspent.length === 1 ? "it" : "them"}. Shops
          stop applying an offer only once they have been told, so send the
          counts before doing anything else.
        </Banner>
      )}

      {/* Rows at the left, filters docked at the right — the same shape as
          every other list in the module. The phase tabs and the search stay
          over the table: they are what somebody reaches for first, and the
          rail is where the fields live. */}
      <div className="grid min-w-0 items-start gap-5 min-[1440px]:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col">
          <Toolbar className="mb-3">
            <Segmented options={PHASES} value={phase} onChange={setPhase} />
            <div className="ml-auto flex items-center gap-2">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search promotions…"
                className="h-8 w-56"
              />
              <Button variant="primary" onClick={() => setWriting(true)}>
                New promotion
              </Button>
            </div>
          </Toolbar>

          {/* Every book was opened to build this list, but only the first five
              hundred rules came back — see `promotionCatalogue`. The clauses
              narrow those rows and no others. */}
          {promotions.length >= CATALOGUE_PAGE && (
            <Truncated limit={CATALOGUE_PAGE} noun="promotions" />
          )}

          <Card className="overflow-hidden">
            {queryState(catalogue, {
              loading: "Opening every published book…",
              render: (data) =>
                shown.length === 0 && phase !== "ALL" ? (
                  <EmptyState>
                    No promotion is{" "}
                    {PHASES.find(
                      (one) => one.value === phase
                    )?.label.toLowerCase()}
                    .
                    {phase === "ENDED" || phase === "SCHEDULED" ? (
                      <>
                        {" "}
                        Both are read off the promotion\'s own dates, and{" "}
                        {count(
                          promotions.filter(
                            (one) => describePeriod(one.row.definition) === null
                          ).length
                        )}{" "}
                        of {count(promotions.length)} promotions here carry no
                        dates at all — one of those never ends and never waits
                        to start.
                      </>
                    ) : null}
                  </EmptyState>
                ) : promotions.length === 0 ? (
                  <EmptyState>
                    No promotion is published. {count(data.book_count)} book
                    {data.book_count === 1 ? "" : "s"} were opened to check — a
                    promotion sitting in an unpublished draft is authored, not
                    running, and is deliberately not listed here.
                  </EmptyState>
                ) : (
                  <DataTable<PromotionLine>
                    table={promotionTable}
                    onRowClick={(row) => sheet.open(row.row.rule_id)}
                    isSelected={(row) => row.row.rule_id === sheet.value}
                    empty="No promotion matches that search."
                    className="max-h-[calc(100vh-19rem)]"
                  />
                ),
            })}
          </Card>

          {catalogue.data && (
            // Where the list comes from, and the one rule worth knowing.
            <p className="mt-2.5 text-[0.71875rem] text-mute">
              Drawn from {count(catalogue.data.book_count)} published book
              {catalogue.data.book_count === 1 ? "" : "s"}. Where one rule is in
              several, the newest wins — as it does at a till.
            </p>
          )}
        </div>

        <DockedFilters model={filters} id="promotions" subject="Promotion" />
      </div>

      <PromotionSheet
        line={promotions.find((one) => one.row.rule_id === sheet.value) ?? null}
        onClose={sheet.close}
      />

      <RuleForm
        open={writing}
        campaigns={catalogue.data?.campaigns ?? []}
        nextVersion={catalogue.data?.next_version ?? 1}
        onClose={() => setWriting(false)}
        onPublished={(published) => {
          setReceipt(published)
          setWriting(false)
        }}
      />
    </PageContent>
  )
}

/// The campaign a rule belongs to, restated so it can travel with it.
///
/// The server refuses a book whose rule names a campaign that book does not
/// define — a shop drops such a rule, so the offer would apply nowhere. Pausing
/// a rule therefore has to carry its campaign along unchanged.
///
/// ## Unchanged means EVERY field, and this function used to hand-pick seven
///
/// Restating a campaign republishes it to the whole fleet, and any field left
/// out of the restatement is not "unchanged" — it is written as absent. This
/// returned seven fields and dropped the poster, so pausing one promotion under
/// the Lebaran sale republished that sale to thirteen shops with its banner,
/// its headline and its small print blanked. The same fault is documented on
/// the server reader that feeds this (`cloud/postgres/commercial.rs`), which
/// was fixed there and stayed broken here.
///
/// `site_ids` makes it worse rather than merely repeating it: a blanked poster
/// is visible to anyone walking past a till, and a campaign silently widened
/// from six shops to thirteen is visible nowhere until the discounts appear in
/// seven shops that were never meant to have them.
///
/// So the whole row goes, and the one field the server's input does not accept
/// is named here rather than silently dropped.
function campaignFor(
  line: PromotionLine,
  campaigns: readonly CampaignRow[]
): CampaignInput | null {
  const id = line.row.definition.campaign_id
  if (id === null) return null
  const found = campaigns.find((one) => one.campaign.campaign_id === id)
  if (found === undefined) return null
  const whole = found.campaign
  return {
    campaign_id: whole.campaign_id,
    name: whole.name,
    status: whole.status,
    valid_from: whole.valid_from,
    valid_to: whole.valid_to,
    budget_minor: whole.budget_minor,
    max_uses: whole.max_uses,
    image_url: whole.image_url,
    headline: whole.headline,
    terms: whole.terms,
    // `null` is "everywhere", and so is `[]` — but only one of them survives a
    // round trip through `CommercialCampaignInput`, whose field is a plain
    // `Vec<String>`. Sent as the empty list, which the server stores back as
    // null, so restating a fleet-wide campaign leaves it fleet-wide.
    site_ids: whole.site_ids ?? [],
    // `max_uses_per_customer` is NOT here, and cannot be: the server's
    // `CommercialCampaignInput` has no field for it, so no restatement of any
    // campaign anywhere can carry it. Named rather than silently absent, so the
    // next reader meets the gap instead of assuming this list is complete.
  }
}

/// One promotion, whole.
///
/// Campaign had a detail sheet and this did not, which made the list read as
/// the end of the road: a rule's scope was a phrase in a column and its
/// conditions were nowhere at all. They are the two things somebody asks about
/// when a promotion has not fired — what it matches, and what has to be true
/// before it will.
///
/// The engine's own document is the source for all of it. Nothing here derives
/// a second opinion about what a rule does; it reads `definition`, which is the
/// same JSON the till applies.
/// One promotion, read back.
///
/// ## Why this is sections and not one scroll
///
/// It was one scroll: status, facts, budget meter, terms, shops. Honest, and
/// the wrong shape for the questions actually asked of it — "why did this not
/// fire" (terms), "is it working" (spend and uses) and "has it reached the
/// shops" (activation) are three different people on three different days, and
/// a single column made each of them read the other two's answer on the way
/// past.
///
/// The sections are the owner's, ruled 2026-09-13: **Overview · Rules ·
/// Coupons · Performance · Activity**. Nothing here is new data — every block
/// below already existed on that scroll. What changed is which question each
/// one is filed under.
///
/// They are `Sheet`'s own `tabs` rather than a `<SubTabs>` inside the body, so
/// the strip sits outside the scroll: the sections do not scroll away from each
/// other, and switching does not leave somebody halfway down a different one.
///
/// **Coupons appears only when there is a coupon**, which is the rule as given.
/// A section that is present and empty on nine promotions out of ten teaches
/// the reader to stop looking at it, and then it is missed on the tenth.
function PromotionSheet({
  line,
  onClose,
}: {
  line: PromotionLine | null
  onClose: () => void
}) {
  const spent = line?.usage?.spent_minor ?? 0
  const share = consumed(spent, line?.usage?.budget_minor ?? null)
  const rule = line?.row.definition
  // Codes rather than words: a published rule carries what it matches on, and
  // the master list that turns `MENSWEAR` into "Menswear" is not fetched for a
  // panel — so the code is shown, which is also what a shop's own log says.
  const reading = rule === undefined ? null : termsOf(rule)
  const coupon =
    rule?.coupon_code !== undefined &&
    rule.coupon_code !== null &&
    rule.coupon_code !== ""
      ? rule.coupon_code
      : null
  const caps = rule === undefined ? null : capsOf(rule)

  // The budget figure, resolved once. The counter's number first and the
  // rule's own where nothing has been counted yet: a promotion that has never
  // fired has no usage row at all, and reading only that made a rule capped at
  // five million report "Unlimited" beside terms that say it stops there.
  const budget =
    line === null
      ? null
      : (line.usage?.budget_minor ?? caps?.budget?.minor ?? null)

  const sections =
    line === null || rule === undefined || reading === null
      ? undefined
      : [
          {
            value: "overview",
            label: "Overview",
            content: (
              <Facts>
                <Fact term="Benefit">{describeEffect(rule.effect)}</Fact>
                <Fact term="Applies to">{describeScope(rule)}</Fact>
                {/* A date here and a sentence under Rules, which is the same
                    split as Budget: the facts are scanned, the terms are read.
                    `null` is BOTH ends open, not just the far one — a rule
                    with no window starts when it is published and stops when
                    somebody stops it. */}
                <Fact term="Period">{describePeriod(rule) ?? "Always on"}</Fact>
                <Fact term="Campaign">{rule.campaign_id ?? "On its own"}</Fact>
                <Fact term="Shoppers">{describeCustomers(rule)}</Fact>
                <Fact term="Gate">
                  {coupon === null ? "Open to every basket" : `Code ${coupon}`}
                </Fact>
                <Fact term="From">{line.row.book.name}</Fact>
              </Facts>
            ),
          },
          {
            value: "rules",
            label: "Rules",
            content: (
              /* What has to be true before it fires, in the same words the
                 composer showed while it was being written — one `termsOf`,
                 read here and previewed there, so "what did I publish" and
                 "what does this do" cannot answer differently.

                 It replaces a four-row table of the same conditions. The table
                 was honest and unreadable: a promotion that never fired is
                 explained by the COMBINATION — a minimum, a window and a
                 coupon, each unremarkable on its own — and four rows of
                 figures is the one shape that hides a combination. */
              <div>
                <SubHead aside="as it reads">Its terms</SubHead>
                <Terms
                  headline={describeEffect(rule.effect)}
                  name={line.row.name}
                  clauses={reading.clauses}
                  hidden={reading.hidden}
                  empty="This rule names nothing it applies to."
                />
              </div>
            ),
          },
          ...(coupon === null
            ? []
            : [
                {
                  value: "coupons",
                  label: "Coupons",
                  content: (
                    <div className="flex flex-col gap-5">
                      <Facts>
                        <Fact term="Code">
                          <Tag tone="warn">{coupon}</Tag>
                        </Fact>
                        <Fact term="Times presented">
                          {count(line.usage?.uses ?? 0)}
                        </Fact>
                        <Fact term="Shoppers who used it">
                          {count(line.usage?.customer_count ?? 0)}
                        </Fact>
                        <Fact term="Uses allowed">
                          {caps?.max_uses === undefined ||
                          caps?.max_uses === null
                            ? "Unlimited"
                            : count(caps.max_uses)}
                        </Fact>
                      </Facts>
                      {/* Said out loud because the counter is the only place
                          these numbers come from, and a coupon nobody has
                          presented looks exactly like a coupon that does not
                          work. */}
                      <p className="text-meta text-mute">
                        One code, counted at the centre from the sales the shops
                        have reported. A till enforces the limit with the count
                        it last received, so a code at its ceiling can still be
                        taken once or twice before every shop hears — the number
                        that binds is this one.
                      </p>
                    </div>
                  ),
                },
              ]),
          {
            value: "performance",
            label: "Performance",
            content: (
              <div className="flex flex-col gap-5">
                <Facts>
                  <Fact term="Budget">
                    {budget === null ? "Unlimited" : money(budget)}
                  </Fact>
                  <Fact term="Spent">{money(spent)}</Fact>
                  <Fact term="Used">{count(line.usage?.uses ?? 0)}</Fact>
                  <Fact term="Customers">
                    {count(line.usage?.customer_count ?? 0)}
                  </Fact>
                </Facts>

                {share !== null && (
                  <div>
                    <SubHead aside={percent(Math.round(share * 10_000))}>
                      Budget
                    </SubHead>
                    <Meter
                      value={share}
                      tone={
                        share >= 0.9 ? "bad" : share >= 0.7 ? "warn" : "accent"
                      }
                    />
                  </div>
                )}
              </div>
            ),
          },
          {
            value: "activity",
            label: `Activity (${count(line.row.book.activated_by.length)})`,
            content: (
              <div>
                <SubHead aside={count(line.reached)}>In service at</SubHead>
                {line.row.book.activated_by.length === 0 ? (
                  // Published and reaching nobody looks exactly like success
                  // everywhere else on this screen, so it is said in words.
                  <p className="py-3 text-meta text-mute">
                    No shop has put the book carrying this promotion into
                    service, so it is applying nowhere yet.
                  </p>
                ) : (
                  <MiniTable head={["Shop", { label: "Since", align: "left" }]}>
                    {line.row.book.activated_by.map((shop) => (
                      <MiniRow key={shop.origin_id}>
                        <MiniCell>{shop.site_id ?? shop.origin_id}</MiniCell>
                        <MiniCell>{day(shop.activated_at)}</MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                )}
              </div>
            ),
          },
        ]

  return (
    <Sheet
      open={line !== null}
      onOpenChange={(next) => !next && onClose()}
      id={line?.row.rule_id}
      title={line?.row.name ?? "Promotion"}
      tabs={sections}
      // In the head, not repeated in every section. What a promotion IS — live
      // or stopped, gated or open — is the reader's bearing on all five, and
      // five copies of it is how two of them come to disagree.
      badge={
        line === null ? undefined : (
          <span className="flex flex-wrap items-center gap-1.5">
            <Pill tone={toneFor(line.row.status)}>
              {label(line.row.status)}
            </Pill>
            {/* Only the gate, never its absence. "Open to all" is not a
                property a promotion has — it is the ordinary case wearing a
                badge, and a row of them taught nobody anything. */}
            {coupon !== null && <Tag tone="warn">Needs code {coupon}</Tag>}
          </span>
        )
      }
    >
      {null}
    </Sheet>
  )
}
