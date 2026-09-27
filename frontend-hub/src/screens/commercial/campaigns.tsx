import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useNavigate, type LinkProps } from "@tanstack/react-router"
import { Check, Circle } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Dialog } from "@/components/ui/dialog"
import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import { cn } from "@/lib/utils"
import { Day } from "@/components/ui/day"
import { Meter } from "@/components/ui/meter"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { DockedFilters } from "@/components/ui/list-chrome"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, ErrorState } from "@/components/ui/states"
import { AppLink } from "@/components/ui/app-link"
import {
  useFilters,
  type Filter,
  type FilterField,
  type Operator,
} from "@/lib/filters"
import { useDebounced } from "@/lib/use-debounced"
import { count, day, label, money, moment } from "@/lib/format"
import { toast } from "@/lib/toast"
import {
  BookWrittenNotPublished,
  campaignById,
  campaignCatalogue,
  campaignOffers,
  campaignPage,
  commercialKeys,
  commercialUsage,
  listPriceBooks,
  minorOf,
  nextBookVersion,
  NOTHING_TO_PUBLISH,
  offerCounts,
  setCampaignStatus,
  type Band,
  type CampaignListScope,
  type CampaignSort,
  writeAndPublish,
  type CampaignInput,
  campaignIntents,
  campaignKeys,
  campaignPlan,
  commercialFleet,
  intentKeys,
  type BookCampaign,
  type CampaignIntent,
  type CampaignRow,
  type PromotionRow,
  type PromotionUsage,
  type PublishReceipt,
} from "@/lib/queries/commercial"
import { queryState } from "@/lib/query-state"
import { PerformanceHeader } from "@/screens/commercial/performance-header"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Switch } from "@/components/ui/form"
import { Named, Quiet } from "@/screens/commercial/parts"
import { endOfDay, shift, startOfDay, today } from "@/lib/calendar"
import { Section, Stepper } from "@/components/ui/form"
import { More, Terms } from "@/screens/commercial/controls"
import {
  consumed,
  describeEffect,
  describeScope,
  percent,
  useActor,
} from "@/screens/commercial/shared"
import { HardCap } from "@/screens/commercial/allocation"
import { CampaignOutcome } from "@/screens/commercial/campaign-outcome"
import { LIMITS_ANCHOR, PLAN_ANCHOR } from "@/screens/commercial/campaign-plan"
import {
  drawMetric,
  metricOf,
  objectiveOf,
} from "@/screens/commercial/objective"

/// Campaigns — the envelope a set of offers is run as one thing inside.
///
/// A campaign is not a bigger promotion. It is one window, one budget and one
/// switch over several rules, and the engine reads it that way: **a rule is
/// live only when both it and its campaign are**. That is the whole reason it
/// is a screen — "stop the Lebaran promo" is one act here and six acts on the
/// Promotions list, and six acts is how one gets left running.
///
/// The header tiles are `<PerformanceHeader>`, reading
/// `GET /api/v1/commercial/performance/campaigns` — every figure on them is an
/// aggregate over `edge_sale_promotion` and `edge_sale` that only the server
/// can compute. That endpoint is written and tested but not yet deployed to
/// this node, so the panel says so rather than inventing numbers in a browser
/// from data it does not hold. The list itself — caps, spend, uses, reach —
/// needs none of it and is live either way.

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

const UNLIMITED = -1

/// The lifecycle the engine actually models. A superset of the four a
/// dashboard usually shows, and worth keeping whole: "cancelled" and "expired"
/// are different endings and only one of them was somebody's decision.
const CAMPAIGN_STATES = [
  { value: "DRAFT", label: "Draft", tone: "neutral" },
  { value: "SCHEDULED", label: "Scheduled", tone: "neutral" },
  { value: "ACTIVE", label: "Live", tone: "ok" },
  { value: "PAUSED", label: "Paused", tone: "warn" },
  { value: "EXPIRED", label: "Ended", tone: "done" },
  { value: "CANCELLED", label: "Cancelled", tone: "done" },
] as const

type CampaignState = (typeof CAMPAIGN_STATES)[number]["value"]

/// A status in the words the list and the sheet use.
function stateOf(status: string) {
  return (
    CAMPAIGN_STATES.find((one) => one.value === status) ?? {
      value: status,
      label: label(status),
      tone: "neutral" as const,
    }
  )
}

/// Where a campaign actually is today, and whether the switch applies.
///
/// Only Live and Paused are a lever: one press between them is safe to walk
/// back. A draft, a scheduled or an ended campaign flipped to Live by a stray
/// click is not, so those read as a pill. An ACTIVE campaign whose window has
/// closed has ended, whatever the stored status says.
///
/// **Mirrored in SQL** as `CAMPAIGN_PHASE` in `postgres/catalogue.rs`, which is
/// what the Status filter asks and counts by — spelled there as the status
/// code whose word this draws: Ended is `EXPIRED`, "Starts …" is `SCHEDULED`.
/// Change one, change both.
function phaseOf(campaign: BookCampaign, now: number) {
  const state = stateOf(campaign.status)
  const ended =
    campaign.valid_to !== null && Date.parse(campaign.valid_to) <= now
  const lever =
    campaign.status === "PAUSED" || (campaign.status === "ACTIVE" && !ended)
  if (campaign.status === "ACTIVE" && ended) {
    return { label: "Ended", tone: "done" as const, lever }
  }
  if (
    campaign.status === "ACTIVE" &&
    campaign.valid_from !== null &&
    Date.parse(campaign.valid_from) > now
  ) {
    return {
      label: `Starts ${day(campaign.valid_from)}`,
      tone: "neutral" as const,
      lever,
    }
  }
  return { label: state.label, tone: state.tone, lever }
}

/// How many shops a switch reached, off `PATCH …/campaigns/{id}` —
/// `dispatch.sent_to`. `null` when the dispatch failed, which the server
/// reports rather than failing the switch (no shop registered yet).
function sentTo(response: unknown): number | null {
  const sent = (response as { dispatch?: { sent_to?: unknown } } | null)
    ?.dispatch?.sent_to
  return Array.isArray(sent) ? sent.length : null
}

function shopsWord(n: number): string {
  return `${count(n)} shop${n === 1 ? "" : "s"}`
}

interface CampaignLine {
  readonly row: CampaignRow
  readonly usage: PromotionUsage | null
  /// How many promotions name this campaign. Counted by the server — the
  /// `campaign` facet of the rules list — rather than held on the campaign: a
  /// rule joins a campaign by naming it, so the membership only exists in one
  /// direction. The rules themselves are read when the sheet opens.
  readonly offers: number
  readonly reached: number
  /// Why it is being run, or `null` where nobody has said. `null` is a finding
  /// rather than a gap: it is the campaign to question or delete.
  readonly intent: CampaignIntent | null
}

/// The objective facet's word for "nobody has said" — the server's `none`,
/// which is not an objective code (those are upper-case and closed).
const NOT_STATED = "none"

/// The number questions the server can carry as an inclusive band. The same
/// set, and the same `bandOf`, as the Promotions screen's — kept beside each
/// list because each list's columns are declared at module level and read
/// them before any shared module would be worth the import.
const BAND_OPERATORS: readonly Operator[] = [
  "is",
  "gte",
  "lte",
  "gt",
  "lt",
  "between",
]

/// A number clause as the whole-number band the server takes, rounded inward.
function bandOf(
  filters: readonly Filter[],
  column: string
): Band | undefined {
  const clause = filters.find((one) => one.column === column)
  if (clause === undefined) return undefined
  const [first, second] = clause.values.map(Number)
  if (first === undefined || !Number.isFinite(first)) return undefined
  switch (clause.operator) {
    case "is":
      return { min: Math.ceil(first), max: Math.floor(first) }
    case "gte":
      return { min: Math.ceil(first) }
    case "gt":
      return { min: Math.floor(first) + 1 }
    case "lte":
      return { max: Math.floor(first) }
    case "lt":
      return { max: Math.ceil(first) - 1 }
    case "between":
      return second === undefined || !Number.isFinite(second)
        ? undefined
        : {
            min: Math.ceil(Math.min(first, second)),
            max: Math.floor(Math.max(first, second)),
          }
    default:
      return undefined
  }
}

/// The Ends clause as the server's day range and open/set test. A value that
/// is not a `YYYY-MM-DD` day is no clause rather than a 400.
function endsOf(filters: readonly Filter[]): CampaignListScope["ends"] {
  const clause = filters.find((one) => one.column === "window")
  if (clause === undefined) return undefined
  if (clause.operator === "isEmpty") return { open: true }
  if (clause.operator === "isNotEmpty") return { open: false }
  const days = clause.values
    .map((one) => one.slice(0, 10))
    .filter((one) => /^\d{4}-\d{2}-\d{2}$/.test(one))
  const [first, second] = days
  if (first === undefined) return undefined
  switch (clause.operator) {
    case "is":
      return { from: first, to: first }
    case "onOrAfter":
      return { from: first }
    case "onOrBefore":
      return { to: first }
    case "between":
      // `YYYY-MM-DD` orders as text, so the smaller string is the earlier day.
      return second === undefined
        ? undefined
        : first <= second
          ? { from: first, to: second }
          : { from: second, to: first }
    default:
      return undefined
  }
}

/// The objective clause as the server's list: codes, `none`, or `stated`.
function objectivesOf(filters: readonly Filter[]): readonly string[] {
  const clause = filters.find((one) => one.column === "objective")
  if (clause === undefined) return []
  if (clause.operator === "isEmpty") return [NOT_STATED]
  if (clause.operator === "isNotEmpty") return ["stated"]
  if (clause.operator === "isAnyOf" || clause.operator === "is")
    return clause.values.map((one) => (one === "" ? NOT_STATED : one))
  return []
}

/// The columns whose clauses the SERVER applies — lifted out of the table's
/// own filters, which could only narrow the rows already loaded.
const SERVER_FILTERED = new Set([
  "live",
  "objective",
  "rules",
  "reached",
  "window",
])

const columns: ColumnDef<TableSetup, CampaignLine>[] = [
  {
    id: "campaign",
    accessorFn: (row) => row.row.campaign.name,
    header: "Campaign",
    size: 210,
    // No text clause: the search box asks the server for the name and the id,
    // and a clause here could only narrow the pages already loaded.
    // The filing code is gone from the row. `backtoschool` under "Back to
    // School" is the same fact twice in a list somebody is scanning for what
    // is live and what it costs — and the id is on the sheet, above the title,
    // where a reader is looking at ONE campaign and may need to quote it.
    cell: ({ row }) => (
      // `data-campaign` is how a just-published row is found to flash it.
      <span
        data-campaign={row.original.row.campaign.campaign_id}
        className="block truncate font-medium text-ink"
      >
        {row.original.row.campaign.name}
      </span>
    ),
  },
  {
    id: "live",
    accessorFn: (row) => row.row.campaign.status,
    header: "Status",
    size: 130,
    enableSorting: false,
    // A switch only where a switch is safe — Live and Paused — and a pill for
    // the other states, which all used to draw as "off" and flip to Live on
    // one click. See `phaseOf`.
    //
    // Campaign keeps the clause a facet, where Promotions moved it to tabs:
    // six states are what a facet is good at.
    //
    // Asked of the SERVER as the PHASE (`phase` on `GET /commercial/campaigns`)
    // rather than the stored status, so "Ended" also finds the ACTIVE campaign
    // whose window has closed — the word the row wears, not the one it was
    // stored with. That is why it offers "is any of" and nothing else, as one
    // clause: that is the question the request can carry. The screen lifts the
    // clause out of the table's own filters and counts the options from the
    // server's phase facets.
    meta: {
      filter: {
        kind: "option",
        label: "Status",
        format: (value: string) => stateOf(value).label,
        operators: ["isAnyOf"],
        single: true,
      },
    },
    cell: ({ row, table }) => {
      const meta = actionsOf<CampaignLine>(table)
      const campaign = row.original.row.campaign
      const phase = phaseOf(campaign, Date.now())
      if (!phase.lever) return <Pill tone={phase.tone}>{phase.label}</Pill>
      return (
        <span className="flex min-w-0 items-center gap-2">
          <Switch
            on={campaign.status === "ACTIVE"}
            busy={meta?.busy === campaign.campaign_id}
            label={`${campaign.status === "ACTIVE" ? "Pause" : "Resume"} ${campaign.name}`}
            onToggle={() => meta?.onToggle?.(row.original)}
          />
          <span className="truncate text-meta text-body">{phase.label}</span>
        </span>
      )
    },
  },
  {
    id: "objective",
    accessorFn: (row) => row.intent?.objective ?? "",
    header: "Objective",
    size: 170,
    // Joined from the intents read for the cell. Not a sort: an objective is a
    // category, and ordering by its code orders nothing anybody asked about.
    enableSorting: false,
    // The column this screen exists for. Everything else here — a window, a
    // budget, a switch, a count of offers — is a CONSTRAINT on promotions, and
    // a thing whose entire content is constraints on another thing is a folder.
    // This is the half that makes it a business initiative.
    //
    // Asked of the SERVER (`objective`), which joins `campaign_intent` and
    // counts every objective — `none` included, the campaign nobody has said
    // the purpose of. Hence "is any of" and the two emptiness tests only.
    meta: {
      filter: {
        kind: "option",
        label: "Objective",
        format: (value: string) =>
          value === NOT_STATED || value === ""
            ? "Not stated"
            : (objectiveOf(value)?.label ?? value),
        operators: ["isAnyOf", "isEmpty", "isNotEmpty"],
        emptyValue: NOT_STATED,
        single: true,
      },
    },
    cell: ({ row }) => {
      const stated = row.original.intent
      return stated === null ? (
        // Not blank. A campaign nobody can say the purpose of is the one to
        // question or delete, and a quiet dash would let it sit there for a
        // year.
        <Pill tone="warn">Not stated</Pill>
      ) : (
        <span className="text-text">
          {objectiveOf(stated.objective)?.label ?? stated.objective}
        </span>
      )
    },
  },
  {
    id: "target",
    accessorFn: (row) => row.intent?.target_value ?? 0,
    header: "Target",
    size: 160,
    enableSorting: false,
    // The LINE, not the distance from it. Where a campaign stands against its
    // target is scored over that campaign's OWN window — Lebaran over
    // Lebaran's dates — and a list cannot do that in one read: thirteen
    // campaigns are thirteen different windows. It is on the row's panel, and a
    // list-wide version wants a scorecard endpoint that scores each campaign
    // over its own dates in one query.
    cell: ({ row }) => {
      const stated = row.original.intent
      if (stated === null) return <span className="text-mute">—</span>
      const metric = metricOf(stated.success_metric)
      return (
        <span className="text-text tabular-nums">
          {stated.target_direction === "AT_MOST" ? "≤ " : "≥ "}
          {drawMetric(metric?.unit ?? "count", stated.target_value)}{" "}
          <span className="text-mute">
            {metric?.label.toLowerCase() ?? stated.success_metric}
          </span>
        </span>
      )
    },
  },
  {
    id: "rules",
    accessorFn: (row) => row.offers,
    header: "Offers",
    size: 80,
    // Sorted and filtered by the SERVER (`offers`, `offers_min`/`offers_max`),
    // which counts the live promotions naming the campaign exactly as the
    // `campaign` facet this cell reads does.
    //
    // "is 0" is a campaign with a window and a budget and nothing to spend it
    // on — published, switchable, and incapable of doing anything. That is a
    // fault, and it is invisible in a list sorted by spend.
    meta: {
      align: "right",
      filter: {
        kind: "number",
        label: "Offers",
        unit: "offers",
        operators: BAND_OPERATORS,
        single: true,
      },
    },
    cell: ({ row }) => count(row.original.offers),
  },
  {
    id: "spent",
    accessorFn: (row) =>
      consumed(row.usage?.spent_minor ?? 0, row.row.campaign.budget_minor) ??
      UNLIMITED,
    header: "Budget used",
    size: 200,
    // Sorted by the SERVER's `budget_used`: this accessor's share, spent ÷
    // budget off the same usage counter, with a campaign that has no limit
    // sorting last whichever way round. (Its `budget` sort is the limit, not
    // what is left of it.)
    //
    // `Budget` and `Spent` were two columns and one answer. Nobody reads a
    // campaign's limit without reading what is left of it, and reading across
    // to do it is how a campaign gets topped up on the wrong figure.
    //
    // No filter: this accessor is a SHARE of the budget rather than an amount,
    // and it carries the `UNLIMITED` sentinel. Somebody typing into it would
    // mean money, and "under 1.000" would answer with every campaign that may
    // spend without limit.
    cell: ({ row }) => {
      const spent = row.original.usage?.spent_minor ?? 0
      const budget = row.original.row.campaign.budget_minor
      const share = consumed(spent, budget)
      if (share === null) {
        return (
          <span className="text-text tabular-nums">
            {money(spent)} <span className="text-mute">· no limit</span>
          </span>
        )
      }
      return (
        <span className="flex items-center gap-2">
          <Meter
            value={share}
            tone={share >= 0.9 ? "bad" : share >= 0.7 ? "warn" : "accent"}
          />
          <span
            className={
              share >= 0.9
                ? "shrink-0 font-medium text-bad-fg tabular-nums"
                : "shrink-0 text-body tabular-nums"
            }
          >
            {money(spent)}
            <span className="text-mute"> / {money(budget!)}</span>
          </span>
        </span>
      )
    },
  },
  {
    id: "reached",
    accessorFn: (row) => row.reached,
    header: "Stores",
    size: 110,
    // Sorted and filtered by the SERVER (`stores`, `stores_min`/`stores_max`),
    // which counts the same `activated_by` this cell counts.
    //
    // "is 0" is the warning pill this cell already draws, asked as a question
    // instead of read one row at a time: a campaign published to nobody.
    meta: {
      align: "right",
      filter: {
        kind: "number",
        label: "Stores",
        unit: "shops",
        operators: BAND_OPERATORS,
        single: true,
      },
    },
    cell: ({ row, table }) => {
      const total = actionsOf<CampaignLine>(table)?.shops ?? null
      const reached = row.original.reached
      const of = total === null ? null : ` / ${count(total)}`
      return reached === 0 ? (
        <Pill tone="warn">0{of ?? " shops"}</Pill>
      ) : (
        <span className="text-text tabular-nums">
          {count(reached)}
          {of === null ? " shops" : <span className="text-mute">{of}</span>}
        </span>
      )
    },
  },
  {
    id: "window",
    accessorFn: (row) => row.row.campaign.valid_to ?? "",
    header: "Runs",
    size: 180,
    // The accessor is the END of the window, so that is what the clause asks
    // about and what the label says. `is empty` is the open-ended campaign —
    // one running until somebody remembers to stop it, which is the row worth
    // finding on a screen about budgets.
    //
    // Asked of the SERVER (`ends_from`/`ends_to`, `ends=open|set`), on the
    // Jakarta day the window ends. The operators are the ones that are an
    // inclusive range or an emptiness test; "before" and "after" are the
    // "on or" pair a day earlier or later, and "not between" is not a range.
    //
    // Last, and first to go when the table is in a narrow card: every column
    // to its left says whether the campaign is working, and this one says
    // until when — which is the question asked after a row is picked.
    meta: {
      priority: 2,
      filter: {
        kind: "date",
        label: "Ends",
        operators: [
          "is",
          "onOrBefore",
          "onOrAfter",
          "between",
          "isEmpty",
          "isNotEmpty",
        ],
        single: true,
      },
    },
    cell: ({ row }) => (
      <span className="text-body">
        {row.original.row.campaign.valid_from
          ? day(row.original.row.campaign.valid_from)
          : "always"}{" "}
        →{" "}
        {row.original.row.campaign.valid_to
          ? day(row.original.row.campaign.valid_to)
          : "open"}
      </span>
    ),
  },
]

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

/// How many campaigns one page carries.
const PAGE = 100

/// Which column means which order the endpoint names. A column not in here
/// cannot be sorted — `enableSorting: false` says so on the column — because
/// the table would otherwise sort the pages it holds, not the list. `Runs`
/// is the END of the window, which is the server's `ends` (no end sorts last).
const SORTS: Record<string, CampaignSort> = {
  campaign: "name",
  window: "ends",
  spent: "budget_used",
  rules: "offers",
  reached: "stores",
}

/// What the list opens on: Budget used, highest first — the order it had
/// before it paged, and the one that puts the campaign closest to its limit
/// at the top.
const DEFAULT_SORT: SortingState = [{ id: "spent", desc: true }]

export function Campaigns() {
  const client = useQueryClient()
  const actor = useActor()
  /// The search, in the URL like Promotions', so a narrowed list is a link.
  const search = useSheet("q")
  const query = search.value ?? ""
  const setQuery = (next: string) =>
    next === "" ? search.close() : search.replace(next)
  const [writing, setWriting] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<PublishReceipt | null>(null)
  /// Budget used, highest first, ordered by the server — which joins the usage
  /// counter now. Cleared, it is the server's house order, by campaign id.
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORT)
  /// Which campaign is open — in the URL, as PATTERN.md wants, so it can be
  /// linked to, survives a reload, and the palette can open it.
  const sheet = useSheet("campaign")
  /// A live campaign somebody asked to pause, waiting on the confirm.
  const [pausing, setPausing] = useState<CampaignLine | null>(null)
  /// The campaign just published: its sheet opens, and when it closes the
  /// row it lands on is flashed so the eye finds it.
  const fresh = useRef<{ id: string; opened: boolean } | null>(null)
  useEffect(() => {
    const held = fresh.current
    if (held === null) return
    if (sheet.value === held.id) {
      held.opened = true
      return
    }
    if (!held.opened) return
    fresh.current = null
    flash(held.id)
  }, [sheet.value])

  const filters = useFilters(columns)

  /// The Status clause, lifted out for the server as the PHASE. At most one
  /// (`single`), and only "is any of" (`operators`) — the one question
  /// `phase=` can carry.
  const phases = useMemo(() => {
    const clause = filters.filters.find(
      (one) =>
        one.column === "live" &&
        (one.operator === "isAnyOf" || one.operator === "is")
    )
    return clause === undefined ? [] : [...clause.values]
  }, [filters.filters])

  /// The other clauses, as the server takes them.
  const objectives = useMemo(
    () => objectivesOf(filters.filters),
    [filters.filters]
  )
  const offerBand = useMemo(
    () => bandOf(filters.filters, "rules"),
    [filters.filters]
  )
  const storeBand = useMemo(
    () => bandOf(filters.filters, "reached"),
    [filters.filters]
  )
  const ends = useMemo(() => endsOf(filters.filters), [filters.filters])

  /// The search, the clauses and the sort, as the one request that answers all
  /// of them. Debounced: every keystroke is a round trip.
  const needle = useDebounced(query.trim(), 300)
  const order = sorting[0]
  const scope = useMemo<CampaignListScope>(
    () => ({
      ...(needle === "" ? {} : { q: needle }),
      ...(phases.length === 0 ? {} : { phases }),
      ...(objectives.length === 0 ? {} : { objectives }),
      ...(offerBand === undefined ? {} : { offers: offerBand }),
      ...(storeBand === undefined ? {} : { stores: storeBand }),
      ...(ends === undefined ? {} : { ends }),
      ...(order === undefined || SORTS[order.id] === undefined
        ? {}
        : { sort: SORTS[order.id], desc: order.desc }),
    }),
    [needle, phases, objectives, offerBand, storeBand, ends, order]
  )

  /// The campaigns, a page at a time, the next one fetched as the last rows
  /// come into view.
  const list = useInfiniteQuery({
    queryKey: commercialKeys.campaignPages(scope),
    queryFn: ({ signal, pageParam }) =>
      campaignPage(
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

  /// Every campaign the search leaves, whatever the status clause — the
  /// server's status facets, which are counted over the search alone. `null`
  /// until the first page lands.
  const everyCount =
    first === undefined
      ? null
      : first.facets.statuses.reduce((sum, one) => sum + one.count, 0)

  /// The Status and Objective fields, carrying the server's tally — the phase
  /// and objective facets, each counted over every filter but its own.
  const counted = useMemo<readonly FilterField[]>(() => {
    const facets = first?.facets
    if (facets === undefined) return filters.fields
    return filters.fields.map((field) =>
      field.column === "live"
        ? { ...field, spec: { ...field.spec, counted: facets.phases } }
        : field.column === "objective"
          ? { ...field, spec: { ...field.spec, counted: facets.objectives } }
          : field
    )
  }, [filters.fields, first])

  /// The table's own clauses, without the ones the server has applied —
  /// which today is all of them. A subtraction rather than nothing, so a
  /// browser-side clause added to a column later still narrows.
  const tableFilters = useMemo(
    () =>
      filters.columnFilters.filter((one) => !SERVER_FILTERED.has(one.id)),
    [filters.columnFilters]
  )

  /// How many offers each campaign holds, counted by the server over every
  /// promotion — not over whichever rules happen to be loaded.
  const offers = useQuery({
    queryKey: commercialKeys.offerCounts(),
    queryFn: ({ signal }) => offerCounts(signal),
  })

  /// Every campaign, for the one control that has to offer campaigns OTHER
  /// than the one being looked at: naming a precedent. A menu rather than the
  /// list being browsed — one capped read, shared with the Overview.
  const campaignMenu = useQuery({
    queryKey: commercialKeys.campaigns(),
    queryFn: ({ signal }) => campaignCatalogue(signal),
  })

  /// The number a new book has to carry to win.
  const books = useQuery({
    queryKey: commercialKeys.books(),
    queryFn: ({ signal }) => listPriceBooks(signal),
  })

  const usage = useQuery({
    queryKey: commercialKeys.usage(),
    queryFn: ({ signal }) => commercialUsage(signal),
  })

  const byKey = useMemo(() => {
    const map = new Map<string, PromotionUsage>()
    for (const one of usage.data ?? []) map.set(`${one.kind}:${one.key}`, one)
    return map
  }, [usage.data])

  /// Every stated objective, in ONE read rather than one per row. A column of
  /// objectives asked per campaign is the N+1 the promotions screen already
  /// documents as its own worst feature.
  const intents = useQuery({
    queryKey: intentKeys.list(),
    queryFn: ({ signal }) => campaignIntents(signal),
  })

  const byCampaign = useMemo(() => {
    const map = new Map<string, CampaignIntent>()
    for (const one of intents.data ?? []) map.set(one.campaign_id, one)
    return map
  }, [intents.data])

  /// The size of the estate, for the denominator beside each row. `null` until
  /// it lands — a numerator on its own is still true.
  const fleet = useQuery({
    queryKey: commercialKeys.fleet(),
    queryFn: ({ signal }) => commercialFleet(signal),
  })
  const shops = fleet.data?.shop_count ?? null

  /// A shop as a person names it, for the sheet's Shops tab. The fleet read
  /// carries the label; an origin with no site is a till not yet assigned.
  const shopName = useMemo(() => {
    const byOrigin = new Map(
      (fleet.data?.items ?? []).map((one) => [one.origin_id, one.label])
    )
    return (originId: string, siteId: string | null) =>
      byOrigin.get(originId) ?? siteId ?? "Till not assigned to a shop"
  }, [fleet.data])

  const lineOf = useCallback(
    (row: CampaignRow): CampaignLine => ({
      row,
      usage: byKey.get(`CAMPAIGN:${row.campaign.campaign_id}`) ?? null,
      offers: offers.data?.get(row.campaign.campaign_id) ?? 0,
      reached: row.book.activated_by.length,
      intent: byCampaign.get(row.campaign.campaign_id) ?? null,
    }),
    [byKey, offers.data, byCampaign]
  )

  /// The pages loaded so far — never "every campaign".
  const lines: CampaignLine[] = useMemo(
    () =>
      (list.data?.pages ?? []).flatMap((page) => page.rows.map(lineOf)),
    [list.data, lineOf]
  )

  /// Every campaign the books declare, for the precedent picker on the sheet.
  const everyCampaign = useMemo(
    () => (campaignMenu.data ?? []).map((one) => one.campaign),
    [campaignMenu.data]
  )

  /// The sheet's campaign: from the pages loaded when it is there, and read by
  /// id when it is not — a link to one campaign, or the one just published,
  /// must not depend on how far somebody has scrolled.
  const loadedLine =
    sheet.value === undefined
      ? undefined
      : lines.find((one) => one.row.campaign.campaign_id === sheet.value)
  const openCampaign = useQuery({
    queryKey: commercialKeys.campaign(sheet.value ?? ""),
    queryFn: ({ signal }) => campaignById(sheet.value ?? "", signal),
    enabled:
      sheet.value !== undefined && list.isSuccess && loadedLine === undefined,
  })
  /// The offers inside the open campaign, asked of the server by campaign —
  /// the Offers tab and the checklist read these, not the loaded rules.
  const openOffers = useQuery({
    queryKey: commercialKeys.campaignRules(sheet.value ?? ""),
    queryFn: ({ signal }) => campaignOffers(sheet.value ?? "", signal),
    enabled: sheet.value !== undefined,
  })
  const sheetLine = useMemo<CampaignLine | null>(() => {
    const base =
      loadedLine ??
      (sheet.value !== undefined &&
      openCampaign.data !== undefined &&
      openCampaign.data !== null &&
      openCampaign.data.campaign.campaign_id === sheet.value
        ? lineOf(openCampaign.data)
        : null)
    if (base === null) return null
    // The count from the offers themselves once they are in: a campaign just
    // given its first offer should not read "none" until the facet catches up.
    return openOffers.data === undefined
      ? base
      : { ...base, offers: openOffers.data.length }
  }, [loadedLine, sheet.value, openCampaign.data, lineOf, openOffers.data])

  /// Pause and resume, through the one function that knows how a status is
  /// written.
  ///
  /// It used to publish a one-line price book restating the campaign, because
  /// the node had no status route. It has one now, and the difference is not
  /// tidiness: a pause carried by a publication only stopped a promotion at the
  /// shops that received that publication, and the shop most likely to miss it
  /// is the shop most likely to still be running the offer. `PATCH` writes the
  /// status and dispatches it on the switch lane in the same call.
  const toggle = useMutation({
    mutationFn: (line: CampaignLine) =>
      setCampaignStatus({
        campaign: asInput(line.row),
        status: line.row.campaign.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
        actorId: actor,
      }),
    onSuccess: (response, line) => {
      const sent = sentTo(response)
      const did = line.row.campaign.status === "ACTIVE" ? "Paused" : "Live again"
      toast.success(
        sent === null
          ? `${did} — no shop to send it to yet`
          : `${did} — sent to ${shopsWord(sent)}`,
        { description: line.row.campaign.name }
      )
    },
    onSettled: () => {
      setBusy(null)
      client.invalidateQueries({ queryKey: commercialKeys.all })
    },
  })

  // `mutate` is stable for the life of the mutation; `toggle` itself is a new
  // object on every status change of the mutation, and depending on it would
  // rebuild the whole table each time somebody flipped a switch.
  const flip = toggle.mutate

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: lines,
        columns: filters.columns,
        getRowId: (row: CampaignLine) => row.row.campaign.campaign_id,
        // The search, every clause and the sort are the server's, and the
        // rows arrive already narrowed and ordered.
        state: {
          columnFilters: tableFilters,
          sorting,
        },
        manualSorting: true,
        onSortingChange: setSorting,
        meta: {
          busy,
          shops,
          onToggle: (line: CampaignLine) => {
            // Pausing stops the discounts at the tills, so it is asked first.
            // Resuming puts back what somebody already approved of.
            if (line.row.campaign.status === "ACTIVE") {
              setPausing(line)
              return
            }
            setBusy(line.row.campaign.campaign_id)
            flip(line)
          },
        },
      }),
      [
        lines,
        filters.columns,
        tableFilters,
        sorting,
        busy,
        shops,
        flip,
      ]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Marketing"
        title="Campaigns"
        sub="One window, one budget and one switch over a set of offers the business runs as one thing."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-44"
            />
            <Button variant="primary" onClick={() => setWriting(true)}>
              New campaign
            </Button>
          </>
        }
      />

      {SHOW_PERFORMANCE && <PerformanceHeader of="campaigns" />}

      {toggle.isError && (
        <div className="mb-4">
          <ErrorState error={toggle.error} />
        </div>
      )}

      {receipt && receipt.delivered_to.length === 0 && (
        <Banner tone="warn" className="mb-4" onDismiss={() => setReceipt(null)}>
          Published, but no shop is registered yet — nothing in this campaign
          applies anywhere until one is.
        </Banner>
      )}

      {/* The module's list shape: rows at the left, filters docked in a column
          at the right. It was a Filter BUTTON over the table, which hides what
          the list is narrowed by behind a click — the rail shows every field
          at once and the chips stay visible while somebody reads the rows they
          produced. Under 1440px it falls below rather than squeezing the
          table. */}
      <div className="grid min-w-0 items-start gap-5 dock:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col">
          <Card className="overflow-hidden">
            {queryState(list, {
              loading: "Loading campaigns…",
              render: () =>
                needle === "" && everyCount === 0 ? (
                  <EmptyState
                    action={
                      <Button variant="soft" onClick={() => setWriting(true)}>
                        New campaign
                      </Button>
                    }
                  >
                    No campaign yet. A promotion does not need one — a campaign
                    is for when several offers share a window and a budget and
                    stop together.
                  </EmptyState>
                ) : (
                  <DataTable<CampaignLine>
                    table={table}
                    onRowClick={(row) =>
                      sheet.open(row.row.campaign.campaign_id)
                    }
                    isSelected={(row) =>
                      row.row.campaign.campaign_id === sheet.value
                    }
                    more={list}
                    empty={
                      filters.filters.length > 0
                        ? "No campaign matches those filters."
                        : "No campaign matches that search."
                    }
                    className="max-h-[calc(100vh-15rem)]"
                  />
                ),
            })}
          </Card>
        </div>

        <DockedFilters
          model={{ ...filters, fields: counted }}
          id="campaigns"
          subject="Campaign"
        />
      </div>

      <CampaignSheet
        line={sheetLine}
        rules={openOffers.data ?? null}
        campaigns={everyCampaign}
        shopName={shopName}
        onClose={sheet.close}
      />

      <Dialog
        open={pausing !== null}
        onOpenChange={(next) => !next && setPausing(null)}
        title={`Pause ${pausing?.row.campaign.name ?? "this campaign"}?`}
        confirm="Pause"
        onConfirm={() => {
          if (pausing !== null) {
            setBusy(pausing.row.campaign.campaign_id)
            flip(pausing)
          }
          setPausing(null)
        }}
      >
        Every offer inside it stops at the tills as soon as each shop receives
        the switch. You can resume it here.
      </Dialog>

      <CampaignForm
        open={writing}
        nextVersion={books.data === undefined ? 1 : nextBookVersion(books.data)}
        onClose={() => setWriting(false)}
        onPublished={(published, campaignId) => {
          setReceipt(published)
          setWriting(false)
          const reached = published.delivered_to.length
          toast.success(
            reached === 0
              ? "Campaign published — no shop to send it to yet"
              : `Campaign published — sent to ${shopsWord(reached)}`
          )
          fresh.current = { id: campaignId, opened: false }
          sheet.open(campaignId)
        }}
      />
    </PageContent>
  )
}

/// A brief tint on the row a new campaign landed on, once its sheet closes.
///
/// Colour only, no travel, so reduced motion keeps it (MOTION.md). Found by
/// the `data-campaign` mark in its name cell — the table takes no row class.
function flash(campaignId: string) {
  const mark = document.querySelector(
    `[data-campaign="${CSS.escape(campaignId)}"]`
  )
  const row = mark?.closest("tr") ?? mark?.parentElement ?? null
  if (row === null || typeof row.animate !== "function") return
  const tint = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent-bg")
    .trim()
  row.animate(
    [
      { backgroundColor: tint || "transparent" },
      { backgroundColor: "transparent" },
    ],
    { duration: 900, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
  )
}

/// The campaign as the command that would restate it.
///
/// **Every field, or the missing one is written as absent.** Restating a
/// campaign republishes it to the whole fleet, and a field left out is not
/// "unchanged" — it is blanked. The poster was lost this way once already
/// (see the server reader in `cloud/postgres/commercial.rs`), and `site_ids`
/// is the worse version of the same fault: a blanked banner is visible to
/// anyone walking past a till, and a campaign silently widened from six shops
/// to thirteen is visible nowhere until the discounts turn up in seven shops
/// that were never meant to have them.
///
/// `max_uses_per_customer` is the one deliberate omission: the server refuses a
/// campaign that carries one, because nothing counts a customer's own history
/// and the limit would never bite. Carrying it through a status flip would make
/// pausing a campaign fail on a field nobody touched.
function asInput(row: CampaignRow): CampaignInput {
  return {
    campaign_id: row.campaign.campaign_id,
    name: row.campaign.name,
    status: row.campaign.status,
    valid_from: row.campaign.valid_from,
    valid_to: row.campaign.valid_to,
    budget_minor: row.campaign.budget_minor,
    max_uses: row.campaign.max_uses,
    // Restated verbatim means the poster too — see `rule-form.tsx`.
    image_url: row.campaign.image_url,
    headline: row.campaign.headline,
    terms: row.campaign.terms,
    // `null` and `[]` both mean everywhere, and only the list survives the trip
    // through `CommercialCampaignInput`, whose field is a plain `Vec<String>`.
    site_ids: row.campaign.site_ids ?? [],
  }
}

/// The poster a shop puts in front of a shopper.
///
/// The only part of a published campaign that may be edited, alongside the
/// switch — and that is not an oversight in the freeze, it is the point. A
/// banner describes the offer; it does not decide money. Migration 0073 froze
/// everything that does, and left these writable so a typo in a headline can be
/// fixed without cutting a price book.
///
/// Saving dispatches to the fleet in the same call, on the switch lane, so the
/// corrected poster reaches the shop floor without waiting for a season.
function Poster({ line }: { line: CampaignLine }) {
  const client = useQueryClient()
  const actor = useActor()
  const campaign = line.row.campaign
  const [headline, setHeadline] = useState(campaign.headline ?? "")
  const [image, setImage] = useState(campaign.image_url ?? "")
  const [terms, setTerms] = useState(campaign.terms ?? "")

  const save = useMutation({
    mutationFn: () =>
      setCampaignStatus({
        campaign: asInput(line.row),
        // Its own status, unchanged. This endpoint takes the switch and the
        // poster together because they are the same two things a published
        // campaign is allowed to change; sending the current status is how a
        // poster edit says "leave the lever where it is".
        status: campaign.status,
        actorId: actor,
        headline,
        image_url: image,
        terms,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: commercialKeys.all }),
  })

  const changed =
    headline !== (campaign.headline ?? "") ||
    image !== (campaign.image_url ?? "") ||
    terms !== (campaign.terms ?? "")

  return (
    <div>
      <SubHead>What the shop shows</SubHead>
      {image !== "" && (
        <img
          src={image}
          alt=""
          className="mb-2.5 aspect-[3/1] w-full rounded-inner border border-hairline bg-soft-2 object-cover"
        />
      )}
      <div className="flex flex-col gap-2.5">
        <Field label="Headline">
          <Input
            value={headline}
            onChange={(event) => setHeadline(event.target.value)}
            placeholder={campaign.name}
          />
        </Field>
        <Field label="Banner image URL">
          <Input
            value={image}
            onChange={(event) => setImage(event.target.value)}
            placeholder="https://…"
          />
        </Field>
        {/* A block, not a line. `CommercialCampaignInput.terms` is one block
            of text on purpose — "terms differ per promotion, per season and per
            regulator, and a schema that modelled them would be wrong on
            arrival" — and a single-line box made that field look like a
            sentence when a shop prints a paragraph. */}
        <Field label="Terms">
          <Textarea
            value={terms}
            rows={3}
            onChange={(event) => setTerms(event.target.value)}
            placeholder="Selama persediaan masih ada. Tidak dapat digabung dengan promo lain."
          />
        </Field>
      </div>
      {save.isError && (
        <div className="mt-2.5">
          <ErrorState error={save.error} />
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={!changed || actor === ""}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Sending…" : "Save and send to shops"}
        </Button>
        {save.isSuccess && !changed && (
          <span className="text-[0.875rem] text-mute">Sent.</span>
        )}
      </div>
    </div>
  )
}

/// What this envelope holds, what it has cost, and how far it has got.
/// One campaign, read back.
///
/// ## Sections: Overview · Offers · Goal & results · Shops
///
/// A campaign is an envelope, and the four questions asked of it are asked by
/// four different people: what is it and what is it costing (Overview), what is
/// inside it (Offers), did it work (Goal & results), and have the shops
/// actually taken it (Shops). Renamed 2026-09-27 from Activities · Measurement ·
/// Activity, which were two near-identical words for two different things.
///
/// **Results are the campaign's own window, never the screen's.** "Did
/// Lebaran hit its target" is asked over Lebaran's dates whatever today is;
/// scoring a finished campaign against the last thirty days would report every
/// past one as a failure the month after it ended. That is why the outcome
/// panel takes the campaign rather than the page's date range.
function CampaignSheet({
  line,
  rules,
  campaigns,
  shopName,
  onClose,
}: {
  line: CampaignLine | null
  /// The promotions filed under this campaign, read for the open sheet.
  /// `null` while they are on their way.
  rules: readonly PromotionRow[] | null
  /// Every campaign in the books. The outcome panel needs them to resolve the
  /// one named as this campaign's precedent, and to read it over ITS window.
  campaigns: readonly BookCampaign[]
  /// A shop as a person names it, from the fleet read.
  shopName: (originId: string, siteId: string | null) => string
  onClose: () => void
}) {
  const spent = line?.usage?.spent_minor ?? 0
  const share = consumed(spent, line?.row.campaign.budget_minor ?? null)
  // Held here only so the checklist can move it; a different campaign opens
  // on its Overview, as the sheet itself would do.
  const campaignId = line?.row.campaign.campaign_id
  const [tab, setTab] = useState<string | null>(null)
  useEffect(() => setTab(null), [campaignId])
  /// Open Goal & results, and bring a part of it into view once it mounts.
  const showGoal = (anchor?: string) => {
    setTab("measurement")
    if (anchor === undefined) return
    window.setTimeout(() => {
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      document
        .getElementById(anchor)
        ?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" })
    }, 80)
  }

  const sections =
    line === null
      ? undefined
      : [
          {
            value: "overview",
            label: "Overview",
            content: (
              <div className="flex flex-col gap-5">
                <NextSteps line={line} onShowGoal={showGoal} />

                <Facts>
                  <Fact term="Runs from">
                    {line.row.campaign.valid_from
                      ? day(line.row.campaign.valid_from)
                      : "Always"}
                  </Fact>
                  <Fact term="Until">
                    {line.row.campaign.valid_to
                      ? day(line.row.campaign.valid_to)
                      : "Open"}
                  </Fact>
                  <Fact term="Budget">
                    {line.row.campaign.budget_minor === null
                      ? "Unlimited"
                      : money(line.row.campaign.budget_minor)}
                  </Fact>
                  <Fact term="Given away">{money(spent)}</Fact>
                  <Fact term="Uses">
                    {count(line.usage?.uses ?? 0)}
                    {line.row.campaign.max_uses === null
                      ? ""
                      : ` / ${count(line.row.campaign.max_uses)}`}
                  </Fact>
                  <Fact term="Customers">
                    {count(line.usage?.customer_count ?? 0)}
                  </Fact>
                  <Fact term="Price change">{line.row.book.name}</Fact>
                </Facts>

                {(line.row.campaign.budget_minor !== null ||
                  line.row.campaign.max_uses !== null) && (
                  <HardCap
                    kind="CAMPAIGN"
                    subject={line.row.campaign.campaign_id}
                  />
                )}

                <Poster line={line} />
              </div>
            ),
          },
          {
            value: "offers",
            label: `Offers (${count(line.offers)})`,
            content: (
              <div>
                <SubHead aside={`${count(line.offers)} offers`}>
                  What is inside it
                </SubHead>
                {rules === null ? (
                  <Quiet>Reading the offers…</Quiet>
                ) : rules.length === 0 ? (
                  <Quiet>No offer in this campaign yet.</Quiet>
                ) : (
                  <MiniTable
                    head={[
                      "Promotion",
                      { label: "Applies to", align: "left" },
                      "Does",
                    ]}
                  >
                    {rules.map((rule) => (
                      <MiniRow key={rule.rule_id}>
                        <MiniCell>
                          <Named
                            name={
                              <AppLink
                                to="/commercial/promotions"
                                sheet={{ key: "rule", value: rule.rule_id }}
                                className="hover:text-accent"
                              >
                                {rule.name}
                              </AppLink>
                            }
                            code={stateOf(rule.status).label}
                          />
                        </MiniCell>
                        <MiniCell>
                          <span className="text-[0.875rem] text-body">
                            {describeScope(rule.definition)}
                          </span>
                        </MiniCell>
                        <MiniCell align="right">
                          <span className="text-[0.875rem] text-text">
                            {describeEffect(rule.definition.effect)}
                          </span>
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                )}
                {/* No dead ends. Pausing the campaign stops every offer at
                    once; pausing just one is done on Promotions. */}
                <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-meta">
                  <NewOfferLink
                    campaignId={line.row.campaign.campaign_id}
                    className="text-accent hover:underline"
                  >
                    New offer in this campaign
                  </NewOfferLink>
                  {line.offers > 0 && (
                    <AppLink
                      to="/commercial/promotions"
                      sheet={{
                        key: "campaign",
                        value: line.row.campaign.campaign_id,
                      }}
                      className="text-accent hover:underline"
                    >
                      See them on Promotions
                    </AppLink>
                  )}
                </div>
              </div>
            ),
          },
          {
            value: "measurement",
            label: "Goal & results",
            content: (
              <div className="flex flex-col gap-5">
                <CampaignOutcome
                  campaign={line.row.campaign}
                  campaigns={campaigns}
                />

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
            value: "shops",
            label: `Shops (${count(line.row.book.activated_by.length)})`,
            content: (
              <div>
                <SubHead>In service at</SubHead>
                {line.row.book.activated_by.length === 0 ? (
                  <Quiet>Not in service at any shop yet.</Quiet>
                ) : (
                  <MiniTable
                    head={[
                      "Shop",
                      { label: "Since", align: "left" },
                      "Rules received",
                    ]}
                  >
                    {line.row.book.activated_by.map((activation) => (
                      <MiniRow key={activation.origin_id}>
                        <MiniCell>
                          <Named
                            name={shopName(
                              activation.origin_id,
                              activation.site_id
                            )}
                          />
                        </MiniCell>
                        <MiniCell>
                          <span className="text-[0.875rem] text-body">
                            {moment(activation.activated_at)}
                          </span>
                        </MiniCell>
                        <MiniCell align="right">
                          {count(activation.price_rule_count)}
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                )}
              </div>
            ),
          },
        ]

  const phase =
    line === null ? null : phaseOf(line.row.campaign, Date.now())

  return (
    <Sheet
      open={line !== null}
      onOpenChange={(next) => !next && onClose()}
      id={line?.row.campaign.campaign_id}
      title={line?.row.campaign.name ?? "Campaign"}
      tabs={sections}
      tab={tab}
      onTabChange={setTab}
      badge={
        phase === null ? undefined : (
          <Pill tone={phase.tone}>{phase.label}</Pill>
        )
      }
    >
      {null}
    </Sheet>
  )
}

/// What a new campaign still needs, at the top of its Overview.
///
/// Asked just in time rather than on the create form: an offer and a goal are
/// what make an envelope do something and be judged, so those two are the
/// checklist, and it goes away once both are done. The plan and a spending
/// limit are offered beside them as optional.
function NextSteps({
  line,
  onShowGoal,
}: {
  line: CampaignLine
  /// Opens Goal & results, scrolled to `anchor` when one is given.
  onShowGoal: (anchor?: string) => void
}) {
  const id = line.row.campaign.campaign_id
  const plan = useQuery({
    queryKey: campaignKeys.plan(id),
    queryFn: ({ signal }) => campaignPlan(id, signal),
    retry: false,
  })

  const hasOffer = line.offers > 0
  const hasGoal = line.intent !== null
  if (hasOffer && hasGoal) return null

  const planned = (plan.data?.activities.length ?? 0) > 0
  // A budget is frozen at publish; after that, a limit on what is given away
  // is the same line drawn at the centre.
  const budgeted =
    line.row.campaign.budget_minor !== null ||
    (plan.data?.guardrails ?? []).some(
      (one) =>
        one.measure === "SPEND_MINOR" || one.measure === "SPEND_PER_DAY_MINOR"
    )

  const go = (anchor?: string) => () => onShowGoal(anchor)

  return (
    <div className="rounded-card border border-hairline px-3.5 py-3">
      <div className="mb-1.5 text-eyebrow font-medium text-body">
        Next steps
      </div>
      <ul className="flex flex-col">
        <Step
          done={hasOffer}
          label="Add an offer"
          action={
            <NewOfferLink
              campaignId={id}
              className="text-accent hover:underline"
            >
              Add
            </NewOfferLink>
          }
        />
        <Step
          done={hasGoal}
          label="Set a goal"
          action={<StepButton onClick={go()}>Set</StepButton>}
        />
        <Step
          done={planned}
          optional
          label="Plan the activities"
          action={<StepButton onClick={go(PLAN_ANCHOR)}>Plan</StepButton>}
        />
        <Step
          done={budgeted}
          optional
          label="Set a budget"
          action={<StepButton onClick={go(LIMITS_ANCHOR)}>Set</StepButton>}
        />
      </ul>
    </div>
  )
}

function Step({
  done,
  optional,
  label,
  action,
}: {
  done: boolean
  optional?: boolean
  label: string
  action: React.ReactNode
}) {
  return (
    <li className="flex items-center gap-2.5 py-1">
      {done ? (
        <Check aria-hidden className="size-4 shrink-0 text-ok-fg" />
      ) : (
        <Circle aria-hidden className="size-4 shrink-0 text-line-ico" />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[0.875rem]",
          done ? "text-mute" : "text-ink"
        )}
      >
        <span className="sr-only">{done ? "Done: " : "To do: "}</span>
        {label}
        {optional === true && <span className="text-mute"> · optional</span>}
      </span>
      {!done && <span className="shrink-0 text-[0.875rem]">{action}</span>}
    </li>
  )
}

function StepButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-accent hover:underline"
    >
      {children}
    </button>
  )
}

/// The promotion form on Promotions, with this campaign already chosen:
/// `/commercial/promotions?new-rule=1&campaign=…`. Two search keys, which
/// `<AppLink sheet>` cannot carry, so it is built here — a real link, so it
/// still opens in a new tab.
function NewOfferLink({
  campaignId,
  className,
  children,
}: {
  campaignId: string
  className?: string
  children: React.ReactNode
}) {
  const navigate = useNavigate()
  const href = `/commercial/promotions?new-rule=1&campaign=${encodeURIComponent(campaignId)}`
  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return
        event.preventDefault()
        // The same URL as the href, through the router so the page does not
        // reload. Cast for the reason `lib/navigate.ts` gives.
        void navigate({
          to: "/commercial/promotions" as LinkProps["to"],
          search: { "new-rule": true, campaign: campaignId } as never,
        })
      }}
    >
      {children}
    </a>
  )
}

/// Writing an envelope.
///
/// A campaign-only book is a legal book: the server's "must change something"
/// check counts campaigns as well as prices, so an envelope can be published
/// before anything is put in it — which is the order people actually work in.
///
/// **Only the minimum up front** (owner, 2026-09-27): a name, the dates and
/// the shops. Status, budget and a basket cap are folded under More options;
/// the goal is not asked here at all — it is the sheet's checklist, asked once
/// the campaign exists, by the same editor that changes it later.
function CampaignForm({
  open,
  nextVersion,
  onClose,
  onPublished,
}: {
  open: boolean
  nextVersion: number
  onClose: () => void
  /// With the id the campaign was published under, so its sheet can open.
  onPublished: (receipt: PublishReceipt, campaignId: string) => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const [name, setName] = useState("")
  const [status, setStatus] = useState<CampaignState>("ACTIVE")
  const [from, setFrom] = useState(() => today())
  const [to, setTo] = useState("")
  const [budget, setBudget] = useState("")
  const [maxUses, setMaxUses] = useState("")
  // The three a SHOPPER reads. They ride on the campaign and nowhere else —
  // `PublicationCampaign` says so in as many words: a price rule describes a
  // number, a markdown describes a garment, a campaign describes an event, and
  // a shop cannot put "Lebaran Sale, ends Sunday" on a screen out of an id and
  // a percentage. Until now nothing wrote them at creation, so every campaign
  // reached thirty shops with a blank banner and had to be opened again to fix
  // it.
  const [headline, setHeadline] = useState("")
  const [image, setImage] = useState("")
  const [terms, setTerms] = useState("")
  // Empty is everywhere, which is what a campaign that names no shop has
  // always meant.
  const [stores, setStores] = useState<readonly string[]>([])

  /// The tail of the id, held so the id does not move between attempts.
  ///
  /// The id used to be minted inside the mutation, which meant a retry after a
  /// halted publish asked for a second campaign under a second id — two
  /// envelopes for one intention. Only the random tail is held: the readable
  /// half still follows the name, because an id that travels to every till and
  /// shows on a panel should be sayable out loud.
  const [tail, setTail] = useState(() => crypto.randomUUID().slice(0, 4))

  const fleet = useQuery({
    queryKey: commercialKeys.fleet(),
    queryFn: ({ signal }) => commercialFleet(signal),
  })

  const campaignId = `${slug(name)}-${tail}`

  // A whole day each end, so "until 30 September" includes the thirtieth. A
  // `datetime-local` left at 00:00 quietly meant it did not.
  const validFrom = from === "" ? null : startOfDay(from)
  const validTo = to === "" ? null : endOfDay(to)
  const windowBroken =
    validFrom !== null &&
    validTo !== null &&
    new Date(validTo) <= new Date(validFrom)
  const budgetMinor = budget.trim() === "" ? null : minorOf(budget)

  /// A fresh key for each attempt, made where the command is built rather than
  /// held for the life of the sheet.
  ///
  /// Reusing one key across attempts is what an idempotency key is usually for,
  /// and here it would be wrong: a halted publish leaves a book behind, so the
  /// *next* attempt asks for a higher version — a different payload under the
  /// same key, which `command_deduplication` refuses outright. The guard
  /// against a double click is the disabled button, and the guard against a
  /// lost response is the version check, which refuses a second book at a
  /// number already taken.
  const publish = useMutation({
    // The id rides as the mutation's variable, so the one reported on success
    // is the one that was published even if the name was edited meanwhile.
    mutationFn: (id: string) =>
      writeAndPublish({
        ...NOTHING_TO_PUBLISH,
        version: nextVersion,
        name: `Campaign: ${name.trim()}`,
        effective_from: validFrom ?? new Date().toISOString(),
        effective_to: null,
        campaigns: [
          {
            // Readable, and unique enough: the id travels to every till and
            // shows on the sheet, so a slug beats a uuid nobody can say out
            // loud.
            campaign_id: id,
            name: name.trim(),
            status,
            valid_from: validFrom,
            valid_to: validTo,
            budget_minor: budgetMinor,
            max_uses: maxUses.trim() === "" ? null : Number(maxUses),
            // Empty is `null`, never "". A shop draws the campaign's internal
            // name when there is no headline, and an empty string is a headline
            // that happens to be blank.
            image_url: image.trim() === "" ? null : image.trim(),
            headline: headline.trim() === "" ? null : headline.trim(),
            terms: terms.trim() === "" ? null : terms.trim(),
            // A shared CONSTRAINT, not a default. An offer inside this campaign
            // runs where BOTH lists allow, so naming six here cannot be widened
            // back to thirteen by a rule that names thirteen — the same way the
            // window above already binds.
            site_ids: stores,
          },
        ],
        actor_id: actor,
        idempotency_key: crypto.randomUUID(),
      }),
    onError: () => {
      // A halted publish still wrote a book, so the number this form is asking
      // for is now taken.
      client.invalidateQueries({ queryKey: commercialKeys.books() })
    },
    onSuccess: (receipt, id) => {
      client.invalidateQueries({ queryKey: commercialKeys.all })
      onPublished(receipt, id)
      setName("")
      setBudget("")
      setMaxUses("")
      setTo("")
      setHeadline("")
      setImage("")
      setTerms("")
      setStores([])
      setStatus("ACTIVE")
      setTail(crypto.randomUUID().slice(0, 4))
    },
  })

  const problem =
    actor === ""
      ? "Sign in to publish."
      : name.trim() === ""
        ? "Give the campaign a name."
        : windowBroken
          ? "The end date has to be after the start."
          : budget.trim() !== "" && budgetMinor === null
            ? "The budget has to be whole rupiah."
            : undefined

  const halted =
    publish.error instanceof BookWrittenNotPublished ? publish.error : null

  /// How many settings inside each fold are set — the folds say so while
  /// they are closed.
  const shown = [headline, terms, image].filter(
    (one) => one.trim() !== ""
  ).length
  const optioned =
    Number(status !== "ACTIVE") +
    Number(budget.trim() !== "") +
    Number(maxUses.trim() !== "")
  const everyShop =
    stores.length > 0 &&
    stores.length ===
      (fleet.data?.items ?? []).filter((one) => one.site_id !== null).length

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New campaign"
      id={`v${nextVersion}`}
      width="wide"
      // Two thirds of the glass, and the same panel the promotion form gets:
      // the two are written together and joined to each other, and a campaign
      // opening half the width of the offer it holds reads as a lesser thing.
      className="md:w-[clamp(32rem,66vw,58rem)]"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              "min-w-0 truncate text-[0.875rem]",
              problem !== undefined ? "text-bad" : "text-text"
            )}
          >
            {problem ??
              readsCampaign(
                status,
                from === "" ? null : from,
                to === "" ? null : to,
                budgetMinor
              )}
          </span>
          <Button
            variant="primary"
            pending={publish.isPending}
            disabled={problem !== undefined}
            onClick={() => publish.mutate(campaignId)}
          >
            {publish.isPending ? "Publishing…" : "Publish"}
          </Button>
        </div>
      }
    >
      {halted !== null ? (
        <Banner tone="bad" className="mb-4">
          {halted.message}
        </Banner>
      ) : publish.isError ? (
        <div className="mb-4">
          <ErrorState error={publish.error} />
        </div>
      ) : null}

      {/* Measured on the sheet, not on the window — this panel is 66vw at a
          desk and the whole glass on a phone. */}
      <div className="@container">
        <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] @3xl:gap-x-8">
          <div className="flex flex-col gap-6">
            <Section title="Campaign">
              <Field label="Name" required>
                <Input
                  value={name}
                  autoFocus
                  placeholder="Lebaran"
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
            </Section>

            {/* A whole day each end, so "until 30 September" includes the
                thirtieth. */}
            <Section title="Schedule">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Starts">
                  <Day
                    value={from}
                    onChange={setFrom}
                    placeholder="Straight away"
                    label="The day this campaign starts"
                    presets={[
                      { label: "Today", value: today() },
                      { label: "Tomorrow", value: shift(today(), 1) },
                      { label: "In a week", value: shift(today(), 7) },
                    ]}
                  />
                </Field>
                <Field
                  label="Ends"
                  problem={
                    windowBroken
                      ? "The end date has to be after the start."
                      : undefined
                  }
                >
                  <Day
                    value={to}
                    onChange={setTo}
                    placeholder="No end date"
                    label="The last day this campaign runs"
                    notBefore={from}
                    presets={[
                      { label: "In a week", value: shift(from ?? today(), 7) },
                      {
                        label: "In a month",
                        value: shift(from === "" ? today() : from, 30),
                      },
                    ]}
                  />
                </Field>
              </div>
            </Section>

            {/* Naming none means everywhere. Naming some is a CONSTRAINT, not a
                default: an offer inside this campaign runs where both its own
                list and this one allow. */}
            <Section title="Shops">
              <Stores
                chosen={stores}
                onToggle={(id) =>
                  setStores((held) =>
                    held.includes(id)
                      ? held.filter((one) => one !== id)
                      : [...held, id]
                  )
                }
                onClear={() => setStores([])}
                shops={fleet.data?.items ?? []}
              />
            </Section>

            <div className="flex flex-col gap-2.5">
              {/* Settings most campaigns leave alone: it goes out Live, with
                  no budget and no basket cap. The limits are shared by every
                  offer inside, not given to each; a per-customer limit is not
                  offered — the server refuses one on a campaign. */}
              <More label="More options" count={optioned}>
                {/* Ended and Cancelled are not a way to start. */}
                <Field label="Status">
                  <Select
                    value={status}
                    onChange={(next) => setStatus(next as CampaignState)}
                  >
                    {CAMPAIGN_STATES.filter(
                      (one) => one.value !== "EXPIRED" && one.value !== "CANCELLED"
                    ).map((one) => (
                      <option key={one.value} value={one.value}>
                        {one.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid gap-3 @lg:grid-cols-2">
                  <Field label="Budget">
                    <Money
                      value={budget}
                      onChange={setBudget}
                      prefix="Rp"
                      placeholder="Unlimited"
                      label="Budget for the whole window"
                    />
                  </Field>
                  <Field label="Max. baskets">
                    <Stepper
                      value={maxUses}
                      onChange={setMaxUses}
                      min={1}
                      placeholder="Unlimited"
                      label="Most baskets"
                    />
                  </Field>
                </div>
              </More>

              {/* The three a SHOPPER reads. They ride on the campaign and
                  nowhere else — a campaign is the one thing in a price book a
                  shopper is meant to read. Empty headline means shops show the
                  name above. */}
              <More label="What shoppers see" count={shown}>
                <Field label="Headline">
                  <Input
                    value={headline}
                    placeholder={
                      name.trim() === ""
                        ? "Diskon Lebaran — sampai 30 September"
                        : name.trim()
                    }
                    onChange={(event) => setHeadline(event.target.value)}
                  />
                </Field>
                <Field label="Terms">
                  <Textarea
                    value={terms}
                    rows={3}
                    placeholder={
                      "Selama persediaan masih ada.\nTidak dapat digabung dengan promo lain."
                    }
                    onChange={(event) => setTerms(event.target.value)}
                  />
                </Field>
                <Field label="Banner image URL">
                  <Input
                    value={image}
                    placeholder="https://…"
                    onChange={(event) => setImage(event.target.value)}
                  />
                </Field>
              </More>
            </div>
          </div>

          {/* The poster as the shop will print it, and under it what the
              envelope does to whatever is filed inside — the half people get
              wrong, because a campaign looks like a bigger promotion and is
              not one. Pinned while the form scrolls. */}
          <div className="@3xl:sticky @3xl:top-0 @3xl:self-start">
            <Section title="Summary">
              <Terms
                headline={
                  headline.trim() !== ""
                    ? headline.trim()
                    : validFrom === null
                      ? "Open ended"
                      : validTo === null
                        ? `From ${day(validFrom)}`
                        : `${day(validFrom)} – ${day(validTo)}`
                }
                name={name}
                prose={terms}
                empty="Name the campaign to see its summary."
                clauses={[
                  name.trim() !== "" &&
                    "An offer filed under it runs only while this campaign is active.",
                  validFrom !== null &&
                    validTo !== null &&
                    "Offers inside it cannot run outside these dates.",
                  stores.length > 0 &&
                    `Runs in ${count(stores.length)} shop${stores.length === 1 ? "" : "s"} only.`,
                  // Naming all of them and naming none behave identically today
                  // and diverge the moment a new shop opens.
                  everyShop &&
                    "Every shop is named, so a shop opened later is not included.",
                  budgetMinor !== null &&
                    `${money(budgetMinor)} is shared by every offer inside it.`,
                  maxUses.trim() !== "" &&
                    `${count(Number(maxUses))} baskets across every offer inside it.`,
                  "Offers join it by naming this campaign on their own form.",
                ]}
                foot={
                  headline.trim() === "" && terms.trim() === ""
                    ? "No headline: shops will show the campaign name."
                    : undefined
                }
              />
            </Section>
          </div>
        </div>
      </div>
    </Sheet>
  )
}

/// The envelope in one line, for the foot of the sheet.
///
/// Read off the same four answers the campaign will carry, so it cannot
/// describe something the button will not publish.
function readsCampaign(
  status: CampaignState,
  from: string | null,
  to: string | null,
  budgetMinor: number | null
): string {
  const window =
    from === null
      ? to === null
        ? "open ended"
        : `until ${day(endOfDay(to))}`
      : `${day(startOfDay(from))} → ${to === null ? "open" : day(endOfDay(to))}`
  return `${stateOf(status).label} · ${window} · ${
    budgetMinor === null ? "unlimited" : money(budgetMinor)
  }`
}

/// The shops a campaign runs in, as a row of switches rather than a list box.
///
/// Thirteen of them, which is small enough that seeing all thirteen at once is
/// the affordance — a multi-select would hide twelve behind a click to save
/// space this panel has. "Everywhere" is the absence of a choice rather than a
/// fourteenth option: naming every shop and naming none behave identically at
/// the till, and only one of them survives a shop being opened next year.
///
/// **It reports the shop toggled, never the whole new list.** Handing back a
/// list computed from `chosen` looks simpler and is wrong: two chips pressed in
/// one tick both read the list as it was before either press, so the second
/// overwrites the first and one of the two shops is silently dropped. React
/// batches, and a closure over state is a closure over stale state. Reporting
/// the single change lets the holder apply it functionally, which cannot race.
function Stores({
  chosen,
  onToggle,
  onClear,
  shops,
}: {
  chosen: readonly string[]
  onToggle: (siteId: string) => void
  onClear: () => void
  shops: readonly { site_id: string | null; label: string | null }[]
}) {
  const everywhere = chosen.length === 0
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={onClear}
        className={cn(
          "rounded-full border px-2.5 py-1 text-meta transition-colors",
          everywhere
            ? "border-accent bg-accent-bg font-medium text-accent"
            : "border-hairline text-mute hover:text-ink"
        )}
      >
        Everywhere
      </button>
      {shops.map((shop) => {
        const id = shop.site_id
        if (id === null) return null
        const on = chosen.includes(id)
        return (
          <button
            key={id}
            type="button"
            onClick={() => onToggle(id)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-meta transition-colors",
              on
                ? "border-accent bg-accent-bg font-medium text-accent"
                : "border-hairline text-body hover:text-ink"
            )}
          >
            {shop.label ?? id}
          </button>
        )
      })}
    </div>
  )
}

/// A campaign id somebody can read off a shelf ticket.
function slug(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return cleaned === "" ? "campaign" : cleaned.slice(0, 24)
}
