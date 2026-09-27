import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { X } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import type { RuleStatus } from "@itulah/contract"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ConfirmButton, Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/field"
import { Meter } from "@/components/ui/meter"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { DockedFilters } from "@/components/ui/list-chrome"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, ErrorState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { useDebounced } from "@/lib/use-debounced"
import { count, moment, money } from "@/lib/format"
import { toast } from "@/lib/toast"
import { listTerms, vocabularyKeys } from "@/lib/queries/vocabulary"
import {
  changeKeys,
  eventKeys,
  listPriceChanges,
  listPriceEvents,
} from "@/lib/queries/changes"
import {
  campaignById,
  campaignCatalogue,
  commercialFleet,
  commercialKeys,
  commercialUsage,
  listPriceBooks,
  nextBookVersion,
  promotionById,
  promotionPage,
  publishUsageToFleet,
  setRuleStatus,
  type CampaignInput,
  type CampaignRow,
  type PromotionListScope,
  type PromotionSort,
  type PromotionRow,
  type PromotionUsage,
  type PublishReceipt,
  type ShopActivation,
} from "@/lib/queries/commercial"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { PerformanceHeader } from "@/screens/commercial/performance-header"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Switch } from "@/components/ui/form"
import { HardCap } from "@/screens/commercial/allocation"
import { RuleForm, type RuleSeed } from "@/screens/commercial/rule-form"
import { Terms } from "@/screens/commercial/controls"
import {
  authorable,
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
///  1. **The list pages, and the server narrows it.** `GET /commercial/rules`
///     searches, filters by status and campaign, sorts, and hands back a page
///     at a time; the table scrolls on to the next. Nothing here is computed
///     over "every rule", because the browser never holds every rule.
///  2. **A rule restated in a later book is one promotion amended, not two.**
///     That is the shop's own model — `load_rules` reads `DISTINCT ON (rule_id)
///     … ORDER BY version DESC` — and it is why the switch below can work at
///     all.
///  3. **A budget is a brake, not a gate.** Every shop enforces from the last
///     count it received, so the figure that must not be exceeded is the one on
///     this screen, and "Sync usage counts to shops" is what keeps the brake
///     close to the truth.

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
  /// The instant the phases are read at — the list's, see `at` below.
  readonly at: number
  /// A division or tag code, as a person reads it.
  readonly named: (code: string) => string
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
  /// How many shops reported they could NOT put that book into service. Read
  /// from the rollout, which is the shop's own account — a failure is never a
  /// subtraction.
  readonly failed: number
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
function Reached({
  shops,
  failed,
  of,
}: {
  shops: number
  failed: number
  of: number | null
}) {
  const total = of === null ? null : ` / ${count(of)}`
  // Every shop that has neither applied the book nor said it could not. The
  // fleet is the denominator because a promotion book goes to every shop; a
  // shop that has not reported yet is outstanding whether or not it was told.
  const pending = of === null ? 0 : Math.max(of - shops - failed, 0)
  return (
    <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap tabular-nums">
      {shops === 0 ? (
        <Pill tone="warn">0{total ?? " shops"}</Pill>
      ) : (
        <span className="text-text">
          {count(shops)}
          {total === null ? (
            " shops"
          ) : (
            <span className="text-mute">{total}</span>
          )}
        </span>
      )}
      {pending > 0 && (
        <span className="text-warn-fg">· {count(pending)} pending</span>
      )}
      {failed > 0 && (
        <span className="font-medium text-bad-fg">
          · {count(failed)} failed
        </span>
      )}
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
    // No text clause: the search box above the table asks the server for the
    // name, the id and the coupon code, and a clause here could only narrow
    // the pages already loaded.
    meta: { card: "title", priority: 1 },
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.row.name}</span>
    ),
  },
  {
    id: "live",
    accessorFn: (row) => row.row.status,
    header: "Status",
    size: 130,
    enableSorting: false,
    // The PHASE, the same word the tabs use — not the stored status, which
    // says "on" for a promotion whose end date has passed. The switch is
    // offered only where flipping it changes something: Live and Paused.
    // An ended or scheduled offer is moved by its dates, not by a switch.
    //
    // No clause: the tabs above the table ask this question already.
    meta: { card: "status", priority: 1 },
    cell: ({ row, table }) => {
      const meta = actionsOf<PromotionLine>(table)
      const phase = phaseOf(row.original, meta?.at ?? 0)
      return (
        <span className="inline-flex items-center gap-2">
          {(phase === "ACTIVE" || phase === "PAUSED") && (
            <Switch
              on={phase === "ACTIVE"}
              busy={meta?.busy === row.original.row.rule_id}
              label={`${phase === "ACTIVE" ? "Pause" : "Resume"} ${row.original.row.name}`}
              onToggle={() => meta?.onToggle?.(row.original)}
            />
          )}
          <Pill tone={PHASE_TONE[phase]}>{PHASE_WORD[phase]}</Pill>
        </span>
      )
    },
  },
  {
    id: "scope",
    accessorFn: (row) => describeScope(row.row.definition),
    header: "Applies to",
    size: 160,
    enableSorting: false,
    // **Not a facet.** The accessor is a sentence `describeScope` composes —
    // "3 products", "Division PRIA", "The whole basket" — so a picker over
    // it would offer one option per rule rather than one per kind of scope,
    // and ticking "2 articles" would narrow to the two unrelated rules that
    // happen to name two articles each. The kind is not on the row to ask
    // about; it is inside `definition.applicability`.
    meta: { card: "hide", priority: 3 },
    cell: ({ row, table }) => (
      <span className="text-text">
        {describeScope(
          row.original.row.definition,
          actionsOf<PromotionLine>(table)?.named
        )}
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
    enableSorting: false,
    meta: { card: "meta", priority: 1 },
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
    size: 190,
    // Joined in the browser from the book's rollout, so the server cannot
    // order by it — and sorting the loaded pages would lie about the first row.
    enableSorting: false,
    // Published and in force are different things, and this is the clause that
    // separates them: a promotion used 0 times in 13 shops has not caught on,
    // and one used 0 times in 0 shops was never carried anywhere. They look
    // identical until somebody asks.
    meta: {
      align: "right",
      filter: { kind: "number", label: "Stores", unit: "shops" },
      card: "hide",
      priority: 2,
    },
    cell: ({ row, table }) => (
      <Reached
        shops={row.original.reached}
        failed={row.original.failed}
        of={actionsOf<PromotionLine>(table)?.shops ?? null}
      />
    ),
  },
  {
    id: "usage",
    accessorFn: (row) => row.usage?.uses ?? 0,
    header: "Usage",
    size: 170,
    // Joined from the usage counter, which the rules endpoint does not carry:
    // not a sort the server can answer. The overspend banner, which reads the
    // counter whole, is what finds the row that has run past its budget.
    enableSorting: false,
    // **Sorted and filtered on uses, not on spend.** The cell says both, and
    // only one of them can be the number underneath it. Uses wins because
    // "is 0" is the question this screen was built to be able to answer — a
    // promotion that exists and has never fired. The screen it replaced could
    // not show one at all, because it listed usage and an unused rule has none.
    //
    // Spend is therefore readable here but not sortable. The row that has run
    // past what it was allowed to spend is not found by sorting anyway: the
    // banner above the table names it.
    meta: {
      filter: { kind: "number", label: "Used", unit: "times" },
      card: "metric",
      priority: 2,
    },
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
    enableSorting: false,
    // The first column to go when the table is in a narrow card. Every other
    // column answers "is this offer working"; this one answers "until when",
    // which is the question somebody asks after they have picked a row — and
    // the panel behind the row answers it. On a phone card it is the meta
    // line under the benefit.
    meta: { priority: 2, card: "meta" },
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
/// `RuleStatus` is `DRAFT | ACTIVE | PAUSED | EXPIRED` and **nothing writes
/// EXPIRED when a date passes.** That is this shop's position, stated where
/// vouchers say it: a status that means "the date has passed" is wrong from the
/// instant it is written, because it has to be rewritten by something at
/// midnight or it lies. The date passes; the row does not change. EXPIRED is
/// written only by a person, with End now — a decision, not the clock.
///
/// So ENDED and SCHEDULED are read off the window rather than stored, which is
/// also what makes the Period column load-bearing rather than decorative. A
/// promotion with no window is never either — it starts when it is published
/// and stops when somebody stops it.
type Phase = "ACTIVE" | "PAUSED" | "ENDED" | "SCHEDULED"

const PHASES = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Live" },
  { value: "PAUSED", label: "Paused" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "ENDED", label: "Ended" },
] as const

/// One word per phase, the same on the tabs, the row and the sheet.
const PHASE_WORD: Record<Phase, string> = {
  ACTIVE: "Live",
  PAUSED: "Paused",
  SCHEDULED: "Scheduled",
  ENDED: "Ended",
}

const PHASE_TONE: Record<Phase, "ok" | "warn" | "neutral" | "done"> = {
  ACTIVE: "ok",
  PAUSED: "warn",
  SCHEDULED: "neutral",
  ENDED: "done",
}

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

/// How many promotions one page carries.
const PAGE = 100

/// Which column means which order the endpoint names. A column not in here
/// cannot be sorted — `enableSorting: false` says so on the column — because
/// the table would otherwise sort the pages it holds, not the list.
const SORTS: Record<string, PromotionSort> = {
  promotion: "name",
}

/// The stored statuses a tab can hold, asked of the server.
///
/// A phase is read off the dates as well as the status (see `phaseOf`), and
/// the server filters on status alone — so this is the NARROWEST server
/// request that still contains every row of the tab, and the tab keeps its
/// exact meaning by reading the phase of each row that comes back. Live and
/// Scheduled are both `ACTIVE`; Paused is anything not yet `ACTIVE` or ended;
/// Ended is every status, because nothing writes `EXPIRED` when a date passes.
const PHASE_STATUSES: Record<(typeof PHASES)[number]["value"], string[]> = {
  ALL: [],
  ACTIVE: ["ACTIVE"],
  SCHEDULED: ["ACTIVE"],
  PAUSED: ["PAUSED", "DRAFT"],
  ENDED: [],
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
  /// The search, in the URL like Vouchers', so a narrowed list is a link.
  const search = useSheet("q")
  const query = search.value ?? ""
  const setQuery = (next: string) =>
    next === "" ? search.close() : search.replace(next)
  /// One campaign's rules, when the Campaign screen sent somebody here.
  const campaignFilter = useSheet("campaign")
  /// The form, open — `?new-rule=1`, with `?campaign=` preselected.
  const newRule = useSheet("new-rule")
  const [phase, setPhase] = useState<(typeof PHASES)[number]["value"]>("ALL")
  /// A published promotion the form was opened from: Change or Duplicate.
  const [seed, setSeed] = useState<RuleSeed | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<PublishReceipt | null>(null)
  /// The live promotion somebody asked to pause, waiting on a yes.
  const [pausing, setPausing] = useState<PromotionLine | null>(null)
  /// Nothing chosen is the server's house order, by rule id. It used to open
  /// on Usage, highest first — a join the server does not hold, so it cannot
  /// order a list it hands back a page at a time.
  const [sorting, setSorting] = useState<SortingState>([])

  /// The search, the tab, the campaign and the sort, as the one request that
  /// answers all four. Debounced: every keystroke is a round trip.
  const needle = useDebounced(query.trim(), 300)
  const order = sorting[0]
  const scope = useMemo<PromotionListScope>(
    () => ({
      ...(needle === "" ? {} : { q: needle }),
      ...(PHASE_STATUSES[phase].length === 0
        ? {}
        : { statuses: PHASE_STATUSES[phase] }),
      ...(campaignFilter.value === undefined
        ? {}
        : { campaigns: [campaignFilter.value] }),
      ...(order === undefined || SORTS[order.id] === undefined
        ? {}
        : { sort: SORTS[order.id], desc: order.desc }),
    }),
    [needle, phase, campaignFilter.value, order]
  )

  /// The promotions, a page at a time, the next one fetched as the last rows
  /// come into view.
  const list = useInfiniteQuery({
    queryKey: commercialKeys.rules(scope),
    queryFn: ({ signal, pageParam }) =>
      promotionPage(
        {
          ...scope,
          limit: PAGE,
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })
  const first = list.data?.pages[0]

  /// Every campaign, for the form's picker and for restating a rule's campaign
  /// when it is paused. A menu, not the list being browsed: one capped read,
  /// shared with the Overview under the same key.
  const campaignList = useQuery({
    queryKey: commercialKeys.campaigns(),
    queryFn: ({ signal }) => campaignCatalogue(signal),
  })

  /// The campaign `?campaign=` names, read on its own when the menu above
  /// does not hold it — so the chip says its name, not its id.
  const listedCampaign =
    campaignFilter.value === undefined
      ? undefined
      : campaignList.data?.find(
          (one) => one.campaign.campaign_id === campaignFilter.value
        )
  const namedCampaign = useQuery({
    queryKey: commercialKeys.campaign(campaignFilter.value ?? ""),
    queryFn: ({ signal }) => campaignById(campaignFilter.value ?? "", signal),
    enabled:
      campaignFilter.value !== undefined &&
      campaignList.isSuccess &&
      listedCampaign === undefined,
  })
  const campaigns = useMemo<readonly CampaignRow[]>(() => {
    const menu = campaignList.data ?? []
    const extra = namedCampaign.data
    return extra === null ||
      extra === undefined ||
      menu.some((one) => one.campaign.campaign_id === extra.campaign.campaign_id)
      ? menu
      : [...menu, extra]
  }, [campaignList.data, namedCampaign.data])

  /// The number a new book has to carry to win — every write here needs it.
  const books = useQuery({
    queryKey: commercialKeys.books(),
    queryFn: ({ signal }) => listPriceBooks(signal),
  })
  const nextVersion =
    books.data === undefined ? 1 : nextBookVersion(books.data)

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

  /// What each book's rollout says, for the failures. Settled books included,
  /// because a promotion keeps running from a book long after the Changes list
  /// has stopped calling it work.
  const changes = useQuery({
    queryKey: changeKeys.list(true),
    queryFn: ({ signal }) => listPriceChanges(true, signal),
    staleTime: 30_000,
  })
  const failedByBook = useMemo(
    () =>
      new Map(
        (changes.data ?? []).map((one) => [
          one.publication_id,
          one.rollout.failed,
        ])
      ),
    [changes.data]
  )

  /// The two halves joined here and nowhere else. The count is an observation
  /// and changes with every sale; the limit is a decision, frozen with the book
  /// that declared it. A rule that has never fired is absent from usage — which
  /// is why the join is left-handed, from the rules.
  const byKey = useMemo(() => {
    const map = new Map<string, PromotionUsage>()
    for (const one of usage.data ?? []) map.set(`${one.kind}:${one.key}`, one)
    return map
  }, [usage.data])

  const lineOf = useCallback(
    (row: PromotionRow): PromotionLine => ({
      row,
      usage: byKey.get(`RULE:${row.rule_id}`) ?? null,
      reached: row.book.activated_by.length,
      failed: failedByBook.get(row.book.id) ?? 0,
    }),
    [byKey, failedByBook]
  )

  /// The pages loaded so far — never "every promotion".
  const promotions: PromotionLine[] = useMemo(
    () =>
      (list.data?.pages ?? []).flatMap((page) => page.rows.map(lineOf)),
    [list.data, lineOf]
  )

  /// The campaign a rule belongs to, restated whole. From the menu when it is
  /// there, and read by id when it is not: a rule restated without the
  /// campaign it names is a book the server refuses.
  const campaignOf = async (line: PromotionLine) => {
    const id = line.row.definition.campaign_id
    if (id === null) return null
    const listed = campaignFor(line, campaigns)
    if (listed !== null) return listed
    const fetched = await client.fetchQuery({
      queryKey: commercialKeys.campaign(id),
      queryFn: ({ signal }) => campaignById(id, signal),
    })
    return fetched === null ? null : campaignFor(line, [fetched])
  }

  /// Pause and resume, through the one function that knows how a status is
  /// written. There is no status route on the node, so this publishes a
  /// one-line book restating the rule — see `setRuleStatus`, which is the only
  /// place that has to change when `PATCH …/status` lands.
  const toggle = useMutation({
    mutationFn: async (line: PromotionLine) =>
      setRuleStatus({
        rule: line.row.definition,
        status: (line.row.status === "ACTIVE"
          ? "PAUSED"
          : "ACTIVE") as RuleStatus,
        campaign: await campaignOf(line),
        version: nextVersion,
        actorId: actor,
        // A fresh key per flip: two pauses of the same rule an hour apart are
        // two decisions, not one retried.
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (published, line) => {
      setReceipt(published)
      if (published.delivered_to.length > 0)
        toast.success(
          `${line.row.status === "ACTIVE" ? "Paused" : "Resumed"} — sent to ${shopsWord(published.delivered_to.length)}`
        )
    },
    onSettled: () => {
      setBusy(null)
      client.invalidateQueries({ queryKey: commercialKeys.all })
    },
  })

  /// End a promotion now. `EXPIRED` is a status the engine already has and
  /// refuses at the till like a pause; it goes out the same way a pause does,
  /// as the rule's next version.
  const end = useMutation({
    mutationFn: async (line: PromotionLine) =>
      setRuleStatus({
        rule: line.row.definition,
        status: "EXPIRED",
        campaign: await campaignOf(line),
        version: nextVersion,
        actorId: actor,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (published) => {
      setReceipt(published)
      if (published.delivered_to.length > 0)
        toast.success(
          `Ended — sent to ${shopsWord(published.delivered_to.length)}`
        )
    },
    onSettled: () =>
      client.invalidateQueries({ queryKey: commercialKeys.all }),
  })

  /// Division and tag names, so a scope reads "Pria" rather than `PRIA`. The
  /// same lists the form picks from, cached as long.
  const divisionTerms = useQuery({
    queryKey: vocabularyKeys.list("divisions"),
    queryFn: ({ signal }) => listTerms("divisions", signal),
    staleTime: 5 * 60 * 1000,
  })
  const tagTerms = useQuery({
    queryKey: vocabularyKeys.list("tags"),
    queryFn: ({ signal }) => listTerms("tags", signal),
    staleTime: 5 * 60 * 1000,
  })
  const named = useMemo(() => {
    const words = new Map<string, string>()
    for (const term of [
      ...(divisionTerms.data?.terms ?? []),
      ...(tagTerms.data?.terms ?? []),
    ])
      words.set(term.code, term.label)
    return (code: string) => words.get(code) ?? code
  }, [divisionTerms.data, tagTerms.data])

  const idempotencyKey = useMemo(() => crypto.randomUUID(), [])

  const send = useMutation({
    mutationFn: () => publishUsageToFleet(actor, idempotencyKey),
    onSuccess: () => {
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
  const at = list.dataUpdatedAt
  /// The campaign is narrowed by the server; the tab's statuses are too
  /// (`PHASE_STATUSES`). What is left here is the part of a phase only the
  /// dates can say — an `ACTIVE` rule whose window has closed is Ended, not
  /// Live — read row by row as each page lands.
  const shown = useMemo(() => {
    if (phase === "ALL") return promotions
    return promotions.filter((line) => phaseOf(line, at) === phase)
  }, [promotions, phase, at])

  /// Every promotion the search leaves — within the campaign when narrowed —
  /// whatever the tab. Counted by the server: the status facets are taken over
  /// the search alone, and the campaign facet is that same count per campaign.
  /// `null` until the first page lands.
  const everyCount =
    first === undefined
      ? null
      : campaignFilter.value === undefined
        ? first.facets.statuses.reduce((sum, one) => sum + one.count, 0)
        : (first.facets.campaigns.find(
            (one) => one.value === campaignFilter.value
          )?.count ?? 0)

  /// The All tab carries the server's count. The phase tabs carry none: a
  /// phase is read off the dates and the server counts statuses, so any number
  /// on them would be a count of something else under that tab's name.
  const tabs = PHASES.map((one) => ({
    value: one.value,
    label:
      one.value === "ALL" && everyCount !== null ? (
        <>
          {one.label}{" "}
          <span className="text-mute tabular-nums">{count(everyCount)}</span>
        </>
      ) : (
        one.label
      ),
  }))

  const campaignName =
    campaignFilter.value === undefined
      ? null
      : (listedCampaign?.campaign.name ??
        namedCampaign.data?.campaign.name ??
        campaignFilter.value)

  /// The sheet's promotion: from the pages loaded when it is there, and read
  /// by id when it is not — a link to one rule must not depend on how far
  /// somebody has scrolled.
  const loadedLine =
    sheet.value === undefined
      ? undefined
      : promotions.find((one) => one.row.rule_id === sheet.value)
  const openRule = useQuery({
    queryKey: commercialKeys.rule(sheet.value ?? ""),
    queryFn: ({ signal }) => promotionById(sheet.value ?? "", signal),
    enabled:
      sheet.value !== undefined && list.isSuccess && loadedLine === undefined,
  })
  const sheetLine =
    loadedLine ??
    (sheet.value !== undefined &&
    openRule.data !== undefined &&
    openRule.data !== null &&
    openRule.data.rule_id === sheet.value
      ? lineOf(openRule.data)
      : null)

  const filters = useFilters(promotionColumns)

  const promotionTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: shown,
        columns: filters.columns,
        getRowId: (row: PromotionLine) => row.row.rule_id,
        // The two clauses left — Stores and Usage — are joins the server does
        // not hold, so they narrow the loaded rows. The search and the sort
        // are the server's, and the rows arrive already ordered.
        state: {
          columnFilters: filters.columnFilters,
          sorting,
        },
        manualSorting: true,
        onSortingChange: setSorting,
        meta: {
          busy,
          shops,
          at,
          named,
          onToggle: (line: PromotionLine) => {
            // Pausing stops the discount at every till, so it is asked;
            // resuming is what somebody pressed the switch to do.
            if (line.row.status === "ACTIVE") {
              setPausing(line)
              return
            }
            setBusy(line.row.rule_id)
            flip(line)
          },
        },
      }),
      [
        shown,
        filters.columns,
        filters.columnFilters,
        sorting,
        busy,
        shops,
        at,
        named,
        flip,
      ]
    )
  )

  /// Read off the usage counter, which is whole, rather than off the loaded
  /// pages — an overspent promotion on page four is still overspent.
  const overspent = (usage.data ?? []).filter(
    (one) =>
      one.kind === "RULE" &&
      one.budget_minor !== null &&
      one.spent_minor >= one.budget_minor
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Marketing"
        title="Promotions"
        sub="Which offers are running, what each gives the shopper, and how many shops are actually charging it."
        // Search and New promotion sit on the table\'s own toolbar now: they
        // act on the list, and the list is no longer the first thing under this
        // header. What stays is the one action that is about all shops rather
        // than about the rows — sending the counts the shops enforce from.
        actions={
          <Button
            variant="soft"
            pending={send.isPending}
            disabled={actor === ""}
            onClick={() => send.mutate()}
          >
            {send.isPending ? "Syncing…" : "Sync usage counts to shops"}
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

      {receipt && receipt.delivered_to.length === 0 && (
        <Banner tone="warn" className="mb-4" onDismiss={() => setReceipt(null)}>
          Published, but no shop received it: no shop is registered yet, so
          this change will not apply anywhere.
        </Banner>
      )}

      {overspent.length > 0 && (
        <Banner tone="bad" className="mb-4">
          {count(overspent.length)} promotion
          {overspent.length === 1 ? " has" : "s have"} reached or passed the
          budget declared for {overspent.length === 1 ? "it" : "them"}. Shops
          stop applying an offer only once they have been told, so sync the
          usage counts before doing anything else.
        </Banner>
      )}

      {/* Rows at the left, filters docked at the right — the same shape as
          every other list in the module. The phase tabs and the search stay
          over the table: they are what somebody reaches for first, and the
          rail is where the fields live. */}
      <div className="grid min-w-0 items-start gap-5 dock:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col">
          <Toolbar className="mb-3">
            <Segmented options={tabs} value={phase} onChange={setPhase} />
            {/* The campaign the Campaign screen narrowed this to, said and
                removable — a filter nobody can see is a list that lies. */}
            {campaignName !== null && (
              <span className="inline-flex h-8 items-center gap-1 rounded-full border border-accent/30 bg-accent-bg pr-1 pl-3 text-[0.875rem] text-accent">
                <span className="max-w-[14rem] truncate">
                  Campaign: {campaignName}
                </span>
                <button
                  type="button"
                  aria-label="Show every campaign"
                  onClick={campaignFilter.close}
                  className="grid size-6 place-items-center rounded-full hover:bg-soft-2"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search promotions…"
                className="h-8 w-56"
              />
              <Button variant="primary" onClick={() => newRule.open(true)}>
                New promotion
              </Button>
            </div>
          </Toolbar>

          <Card className="overflow-hidden">
            {queryState(list, {
              loading: "Loading promotions…",
              render: () =>
                campaignName !== null && needle === "" && everyCount === 0 ? (
                  <EmptyState
                    action={
                      <Button
                        variant="primary"
                        onClick={() => newRule.open(true)}
                      >
                        New promotion
                      </Button>
                    }
                  >
                    No promotion belongs to {campaignName} yet.
                  </EmptyState>
                ) : campaignName === null &&
                  needle === "" &&
                  everyCount === 0 ? (
                  <EmptyState>
                    No promotion has been published yet. A promotion is listed
                    here once it has been sent to the shops.
                  </EmptyState>
                ) : shown.length === 0 &&
                  phase !== "ALL" &&
                  needle === "" &&
                  !list.hasNextPage ? (
                  // Only once every page is in: until then the next one may
                  // hold the first row of this tab, and the table below is
                  // already asking for it.
                  <EmptyState>
                    No promotion is{" "}
                    {PHASES.find(
                      (one) => one.value === phase
                    )?.label.toLowerCase()}
                    .
                    {phase === "ENDED" || phase === "SCHEDULED" ? (
                      <>
                        {" "}
                        Both are read off the promotion\'s own dates, and one
                        with no dates at all never ends and never waits to
                        start.
                      </>
                    ) : null}
                  </EmptyState>
                ) : (
                  <DataTable<PromotionLine>
                    table={promotionTable}
                    onRowClick={(row) => sheet.open(row.row.rule_id)}
                    isSelected={(row) => row.row.rule_id === sheet.value}
                    more={list}
                    empty={
                      list.hasNextPage
                        ? "Nothing here on the pages read so far."
                        : "No promotion matches that search."
                    }
                    className="max-h-[calc(100dvh-19rem)]"
                  />
                ),
            })}
          </Card>
        </div>

        <DockedFilters model={filters} id="promotions" subject="Promotion" />
      </div>

      <PromotionSheet
        line={sheetLine}
        fleet={fleet.data?.items ?? []}
        subject={sheet.subject}
        at={at}
        named={named}
        campaigns={campaigns}
        onClose={sheet.close}
        onChange={(line) =>
          setSeed({ mode: "change", rule: line.row.definition })
        }
        onDuplicate={(line) =>
          setSeed({ mode: "duplicate", rule: line.row.definition })
        }
        onEnd={(line) => end.mutate(line)}
        ending={end.isPending}
        endError={end.isError ? end.error : null}
        canWrite={actor !== ""}
      />

      <RuleForm
        // Keyed by where it starts, so the answers are read afresh each time.
        key={
          seed === null
            ? `new:${campaignFilter.value ?? ""}`
            : `${seed.mode}:${seed.rule.rule_id}`
        }
        open={newRule.isOpen || seed !== null}
        campaigns={campaigns}
        nextVersion={nextVersion}
        seed={seed}
        campaignPreset={campaignFilter.value ?? null}
        onClose={() => {
          setSeed(null)
          if (newRule.isOpen) newRule.close()
        }}
        onPublished={(published) => {
          setReceipt(published)
          if (published.delivered_to.length > 0)
            toast.success(
              `Published — sent to ${shopsWord(published.delivered_to.length)}`
            )
          setSeed(null)
          if (newRule.isOpen) newRule.close()
        }}
      />

      {/* Pausing stops the discount at every till, so it waits on a yes.
          Resuming does not: it is what the switch was pressed for. */}
      <Dialog
        open={pausing !== null}
        onOpenChange={(next) => !next && setPausing(null)}
        title={`Pause ${pausing?.row.name ?? "this promotion"}?`}
        confirm="Pause"
        tone="danger"
        onConfirm={() => {
          if (pausing === null) return
          setBusy(pausing.row.rule_id)
          flip(pausing)
          setPausing(null)
        }}
      >
        Every shop stops giving this discount as soon as it receives the
        change. You can resume it with the same switch.
      </Dialog>
    </PageContent>
  )
}

/// A count of shops, in words.
function shopsWord(n: number): string {
  return `${count(n)} shop${n === 1 ? "" : "s"}`
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
  fleet,
  subject,
  at,
  named,
  campaigns,
  onClose,
  onChange,
  onDuplicate,
  onEnd,
  ending,
  endError,
  canWrite,
}: {
  line: PromotionLine | null
  /// Every registered shop, so the Activity tab can name the ones that have
  /// said nothing at all — the row a list of reports can never contain.
  fleet: readonly ShopActivation[]
  /// The record, for its comments and trail.
  subject: { kind: string; id: string } | undefined
  at: number
  named: (code: string) => string
  campaigns: readonly CampaignRow[]
  onClose: () => void
  /// Open the form on this rule, to publish its next version.
  onChange: (line: PromotionLine) => void
  /// Open the form on a copy of it.
  onDuplicate: (line: PromotionLine) => void
  onEnd: (line: PromotionLine) => void
  ending: boolean
  endError: Error | null
  canWrite: boolean
}) {
  const spent = line?.usage?.spent_minor ?? 0
  const share = consumed(spent, line?.usage?.budget_minor ?? null)
  const rule = line?.row.definition
  // Division and tag names from the vocabulary; articles and SKUs stay codes,
  // which is also what a shop's own log says.
  const reading = rule === undefined ? null : termsOf(rule, named)
  const phase = line === null ? null : phaseOf(line, at)
  const campaignId = rule?.campaign_id ?? null
  const campaign =
    campaignId === null
      ? null
      : (campaigns.find((one) => one.campaign.campaign_id === campaignId)
          ?.campaign.name ?? campaignId)
  // The form writes five effects; anything else can be read, not changed.
  const writable = rule !== undefined && authorable(rule) && canWrite
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
              <div className="flex flex-col gap-5">
              <Facts>
                <Fact term="Benefit">{describeEffect(rule.effect)}</Fact>
                <Fact term="Applies to">{describeScope(rule, named)}</Fact>
                {/* A date here and a sentence under Rules, which is the same
                    split as Budget: the facts are scanned, the terms are read.
                    `null` is BOTH ends open, not just the far one — a rule
                    with no window starts when it is published and stops when
                    somebody stops it. */}
                <Fact term="Period">{describePeriod(rule) ?? "Always on"}</Fact>
                <Fact term="Campaign">
                  {campaignId === null ? (
                    "On its own"
                  ) : (
                    <AppLink
                      to="/commercial/campaigns"
                      sheet={{ key: "campaign", value: campaignId }}
                      className="text-accent hover:underline"
                    >
                      {campaign}
                    </AppLink>
                  )}
                </Fact>
                <Fact term="Shoppers">{describeCustomers(rule)}</Fact>
                <Fact term="Gate">
                  {coupon === null ? "Open to every basket" : `Code ${coupon}`}
                </Fact>
                <Fact term="Last changed">
                  {moment(line.row.book.effective_from)}
                </Fact>
              </Facts>

              {/* Ending is not a pause: it is for good, and the only way back
                  is Change with new dates. Offered while it still runs or
                  waits to — an ended offer has nothing left to end. */}
              {(phase === "ACTIVE" ||
                phase === "PAUSED" ||
                phase === "SCHEDULED") && (
                <div className="flex flex-col gap-2">
                  {endError !== null && <ErrorState error={endError} />}
                  <ConfirmButton
                    label={ending ? "Ending…" : "End now"}
                    title={`End ${line.row.name} now?`}
                    description="Every shop stops giving this discount as soon as it receives the change, and it moves to Ended. To run it again, use Change and give it new dates."
                    confirmLabel="End now"
                    tone="danger"
                    variant="danger"
                    pending={ending}
                    disabled={!canWrite}
                    onConfirm={() => onEnd(line)}
                    className="self-start"
                  />
                </div>
              )}
              </div>
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

                {/* Only where the rule declares a limit: there is nothing
                    else to split. */}
                {(caps?.budget != null || caps?.max_uses != null) && (
                  <HardCap kind="RULE" subject={line.row.rule_id} />
                )}
              </div>
            ),
          },
          {
            value: "activity",
            label: `Activity (${count(line.reached)}${
              fleet.length > 0 ? `/${count(fleet.length)}` : ""
            })`,
            content: <Rollout line={line} fleet={fleet} />,
          },
        ]

  return (
    <Sheet
      open={line !== null}
      onOpenChange={(next) => !next && onClose()}
      id={line?.row.rule_id}
      title={line?.row.name ?? "Promotion"}
      tabs={sections}
      subject={subject}
      // Nothing published is edited: Change publishes the next version under
      // the same id, Duplicate a new promotion. Both open the form filled in.
      actions={
        line === null ? undefined : (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={!writable}
              onClick={() => onChange(line)}
            >
              Change
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!writable}
              onClick={() => onDuplicate(line)}
            >
              Duplicate
            </Button>
          </>
        )
      }
      // In the head, not repeated in every section. What a promotion IS — its
      // phase, the word the tabs use, and whether it is gated — is the
      // reader's bearing on every section.
      badge={
        line === null || phase === null ? undefined : (
          <span className="flex flex-wrap items-center gap-1.5">
            <Pill tone={PHASE_TONE[phase]}>{PHASE_WORD[phase]}</Pill>
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

type ShopState = "ACTIVE" | "FAILED" | "PENDING" | "SILENT"

/// One shop's standing on the book a promotion arrived in.
interface ShopStanding {
  readonly origin_id: string
  readonly name: string
  readonly state: ShopState
  /// When the state was reached: applied, failed, or handed over.
  readonly at: string | null
  /// The shop's own words, when it could not apply the book.
  readonly error: string | null
}

/// Worst first: a failure needs a phone call, a shop that has said nothing
/// needs a look, and one in service needs nothing.
const STATE_ORDER: Record<ShopState, number> = {
  FAILED: 0,
  PENDING: 1,
  SILENT: 2,
  ACTIVE: 3,
}

/// Every shop against the book this promotion arrived in: in service, told
/// and not yet applied, tried and failed, or never heard from.
///
/// Built from the book's own event log — the rollout rows as `SENT`,
/// `ACTIVATED` and `FAILED`, each stamped with the shop it came from — laid
/// over the fleet, so a shop with no report at all is still a row. The
/// activations carried on the catalogue are folded in too: they are the same
/// fact, and a log read with a limit must never be what makes a shop that is
/// charging these prices look as if it is not.
function Rollout({
  line,
  fleet,
}: {
  line: PromotionLine
  fleet: readonly ShopActivation[]
}) {
  const book = line.row.book
  const events = useQuery({
    queryKey: eventKeys.list(book.version, null),
    queryFn: ({ signal }) => listPriceEvents(book.version, null, 200, signal),
    staleTime: 30_000,
  })

  const standings = useMemo(() => {
    const names = new Map(
      fleet.map((shop) => [
        shop.origin_id,
        shop.label ?? shop.site_id ?? shop.origin_id,
      ])
    )
    const told = new Map<string, string>()
    const applied = new Map<string, string>()
    const failed = new Map<string, { at: string; error: string | null }>()
    for (const event of events.data ?? []) {
      // The shop is the event's actor on every per-shop kind.
      if (event.publication_id !== book.id || event.actor === null) continue
      if (event.kind === "SENT") told.set(event.actor, event.at)
      else if (event.kind === "ACTIVATED") applied.set(event.actor, event.at)
      else if (event.kind === "FAILED")
        failed.set(event.actor, { at: event.at, error: event.detail })
    }
    for (const shop of book.activated_by)
      applied.set(shop.origin_id, shop.activated_at)

    const origins = new Set([
      ...names.keys(),
      ...told.keys(),
      ...applied.keys(),
      ...failed.keys(),
    ])
    return [...origins]
      .map((origin): ShopStanding => {
        const name = names.get(origin) ?? origin
        const done = applied.get(origin)
        if (done !== undefined)
          return {
            origin_id: origin,
            name,
            state: "ACTIVE",
            at: done,
            error: null,
          }
        const broke = failed.get(origin)
        if (broke !== undefined)
          return {
            origin_id: origin,
            name,
            state: "FAILED",
            at: broke.at,
            error: broke.error,
          }
        const sent = told.get(origin)
        return {
          origin_id: origin,
          name,
          state: sent === undefined ? "SILENT" : "PENDING",
          at: sent ?? null,
          error: null,
        }
      })
      .sort(
        (left, right) =>
          STATE_ORDER[left.state] - STATE_ORDER[right.state] ||
          left.name.localeCompare(right.name)
      )
  }, [events.data, fleet, book])

  const tally = (state: ShopState) =>
    standings.filter((one) => one.state === state).length
  const waiting = tally("PENDING") + tally("SILENT")
  const summary = [
    `${count(tally("ACTIVE"))} in service`,
    waiting > 0 && `${count(waiting)} pending`,
    tally("FAILED") > 0 && `${count(tally("FAILED"))} failed`,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div>
      <SubHead aside={summary}>Shops</SubHead>
      {events.isError && (
        <Banner tone="warn" className="mb-3">
          The rollout log is not answering, so only the shops in service are
          shown.
        </Banner>
      )}
      {standings.length === 0 ? (
        <p className="py-3 text-meta text-mute">No shop is registered.</p>
      ) : (
        <MiniTable
          head={[
            "Shop",
            { label: "Status", align: "left" },
            { label: "When", align: "left" },
          ]}
        >
          {standings.map((shop) => (
            <MiniRow key={shop.origin_id}>
              <MiniCell>
                <span className="block truncate text-ink">{shop.name}</span>
                {shop.error !== null && (
                  <span className="mt-0.5 block text-[0.875rem] leading-relaxed whitespace-normal text-bad-fg">
                    {shop.error}
                  </span>
                )}
              </MiniCell>
              <MiniCell>
                <Pill tone={STATE_TONE[shop.state]}>
                  {STATE_WORD[shop.state]}
                </Pill>
              </MiniCell>
              <MiniCell>
                <span className="text-[0.875rem] text-body tabular-nums">
                  {shop.at === null ? "—" : moment(shop.at)}
                </span>
              </MiniCell>
            </MiniRow>
          ))}
        </MiniTable>
      )}
    </div>
  )
}

const STATE_WORD: Record<ShopState, string> = {
  ACTIVE: "In service",
  FAILED: "Failed",
  PENDING: "Sent, not applied",
  SILENT: "No report",
}

const STATE_TONE: Record<ShopState, "ok" | "bad" | "warn" | "neutral"> = {
  ACTIVE: "ok",
  FAILED: "bad",
  PENDING: "warn",
  SILENT: "neutral",
}
