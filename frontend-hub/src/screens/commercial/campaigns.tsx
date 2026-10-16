import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useNavigate, type LinkProps } from "@tanstack/react-router"
import {
  Check,
  CalendarRange,
  Circle,
  ClipboardList,
  Image as ImageIcon,
  Megaphone,
  Percent,
  Store,
} from "lucide-react"
import {
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { ConfirmButton, Dialog, SavedDialog } from "@/components/ui/dialog"
import { RecordPanel } from "@/components/ui/record-panel"
import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import { cn } from "@/lib/utils"
import { Day } from "@/components/ui/day"
import { ROOMY } from "@/screens/operations/roomy"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { DeskFilterButton, DeskFilterChips } from "@/components/ui/desk-filter"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/states"
import { AppLink } from "@/components/ui/app-link"
import {
  useFilters,
  type Filter,
  type FilterField,
  type Operator,
} from "@/lib/filters"
import { useLayout } from "@/lib/layout"
import { useDebounced } from "@/lib/use-debounced"
import { count, day, label, money, moment } from "@/lib/format"
import {
  BookWrittenNotPublished,
  campaignById,
  campaignCatalogue,
  campaignOffers,
  campaignPagesQuery,
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
import { PerformanceHeader } from "@/screens/commercial/performance-header"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Switch } from "@/components/ui/form"
import { Named, Quiet } from "@/screens/commercial/parts"
import { CardFigure, CardFoot, CardName } from "@/components/ui/phone-cards"
import { endOfDay, isoOf, shift, startOfDay, today } from "@/lib/calendar"
import { Section, Stepper } from "@/components/ui/form"
import { More, Terms } from "@/screens/commercial/controls"
import {
  consumed,
  describeEffect,
  describeScope,
  useActor,
} from "@/screens/commercial/shared"
import { HardCap } from "@/screens/commercial/allocation"
import {
  Block,
  CampaignGoal,
  CampaignResults,
  Gauge,
  GOAL_ANCHOR,
  Pair,
} from "@/screens/commercial/campaign-outcome"
import {
  CampaignPlan,
  LIMITS_ANCHOR,
  PLAN_ANCHOR,
} from "@/screens/commercial/campaign-plan"
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
/// is a screen — "stop the Eid promo" is one act here and six acts on the
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

function storesWord(n: number): string {
  return `${count(n)} store${n === 1 ? "" : "s"}`
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
function bandOf(filters: readonly Filter[], column: string): Band | undefined {
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
    size: 240,
    meta: { grow: 280, card: "hide" },
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
    id: "objective",
    accessorFn: (row) => row.intent?.objective ?? "",
    header: "Objective",
    size: 180,
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
      priority: 2,
      card: "hide",
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
        <span className="text-warn-fg">Not stated</span>
      ) : (
        <span className="text-text">
          {objectiveOf(stated.objective)?.label ?? stated.objective}
        </span>
      )
    },
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
      card: "hide",
      filter: {
        kind: "option",
        label: "Status",
        format: (value: string) => stateOf(value).label,
        operators: ["isAnyOf"],
        single: true,
      },
    },
    // The word only: Pause and Resume are in the row's sheet (owner, 16 Oct:
    // the list fits its page, it does not scroll sideways).
    cell: ({ row }) => {
      const phase = phaseOf(row.original.row.campaign, Date.now())
      return <Status tone={phase.tone}>{phase.label}</Status>
    },
  },
  {
    id: "spent",
    accessorFn: (row) =>
      consumed(row.usage?.spent_minor ?? 0, row.row.campaign.budget_minor) ??
      UNLIMITED,
    header: "Budget used",
    size: 130,
    meta: { card: "hide", align: "right" },
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
    // One figure: the share of the budget gone, amber from 70%, red from
    // 90%. The rupiah are in the sheet.
    cell: ({ row }) => {
      const spent = row.original.usage?.spent_minor ?? 0
      const share = consumed(spent, row.original.row.campaign.budget_minor)
      if (share === null) return <span className="text-mute">No limit</span>
      return (
        <span
          className={
            share >= 0.9
              ? "font-medium text-bad-fg tabular-nums"
              : share >= 0.7
                ? "text-warn-fg tabular-nums"
                : "text-text tabular-nums"
          }
        >
          {Math.round(share * 100)}%
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
      priority: 3,
      align: "right",
      card: "hide",
      filter: {
        kind: "number",
        label: "Stores",
        unit: "stores",
        operators: BAND_OPERATORS,
        single: true,
      },
    },
    cell: ({ row, table }) => {
      const total = actionsOf<CampaignLine>(table)?.shops ?? null
      const reached = row.original.reached
      const of = total === null ? null : ` / ${count(total)}`
      return reached === 0 ? (
        <span className="text-warn-fg tabular-nums">0{of ?? " stores"}</span>
      ) : (
        <span className="text-text tabular-nums">
          {count(reached)}
          {of === null ? " stores" : <span className="text-mute">{of}</span>}
        </span>
      )
    },
  },
  {
    id: "window",
    accessorFn: (row) => row.row.campaign.valid_to ?? "",
    header: "Ends",
    size: 140,
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
      card: "hide",
      align: "right",
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
    // The end only; the start is in the sheet.
    cell: ({ row }) => {
      const to = row.original.row.campaign.valid_to
      return to ? (
        <span className="text-text tabular-nums">{day(to)}</span>
      ) : (
        <span className="text-mute">Open</span>
      )
    },
  },
  // Four columns that exist only on a card (`cardLead`; a phone): the campaign
  // over what it is for, the budget it has used as the figure (in rupiah, the
  // budget and its share under it — numbers, not a bar), a foot that says
  // where it stands, how many offers and stores and when it runs, and Edit,
  // which opens the sheet the card's own tap opens (owner, 2026-10-06).
  {
    id: "head",
    accessorFn: (row) => row.row.campaign.name,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => {
      const campaign = row.original.row.campaign
      const stated = row.original.intent
      const metric = stated === null ? null : metricOf(stated.success_metric)
      const ended = phaseOf(campaign, Date.now()).tone === "done"
      return (
        // `data-campaign` is how a just-published row is found to flash it.
        <span data-campaign={campaign.campaign_id} className="block">
          <CardName
            name={campaign.name}
            muted={ended}
            line={
              stated === null ? (
                <span className="text-warn-fg">Not stated</span>
              ) : (
                <>
                  {objectiveOf(stated.objective)?.label ?? stated.objective}
                  {" · "}
                  {stated.target_direction === "AT_MOST" ? "≤ " : "≥ "}
                  {drawMetric(
                    metric?.unit ?? "count",
                    stated.target_value
                  )}{" "}
                  {metric?.label.toLowerCase() ?? stated.success_metric}
                </>
              )
            }
          />
        </span>
      )
    },
  },
  {
    id: "lead",
    accessorFn: (row) => row.usage?.spent_minor ?? 0,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => {
      const spent = row.original.usage?.spent_minor ?? 0
      const budget = row.original.row.campaign.budget_minor
      const share = consumed(spent, budget)
      return (
        <CardFigure
          value={spent === 0 ? "—" : money(spent)}
          caption={
            share === null
              ? "no limit"
              : `of ${money(budget!)} · ${Math.round(share * 100)}%`
          }
          tone={
            share !== null && share >= 0.9
              ? "bad"
              : share !== null && share >= 0.7
                ? "warn"
                : spent === 0
                  ? "quiet"
                  : undefined
          }
        />
      )
    },
  },
  {
    id: "foot",
    accessorFn: (row) => row.row.campaign.status,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row, table }) => {
      const meta = actionsOf<CampaignLine>(table)
      const campaign = row.original.row.campaign
      const phase = phaseOf(campaign, Date.now())
      const of = meta?.shops ?? null
      const { offers, reached } = row.original
      return (
        <CardFoot
          status={
            phase.lever ? (
              <span className="inline-flex items-center gap-2.5">
                <Switch
                  on={campaign.status === "ACTIVE"}
                  busy={meta?.busy === campaign.campaign_id}
                  label={`${campaign.status === "ACTIVE" ? "Pause" : "Resume"} ${campaign.name}`}
                  onToggle={() => meta?.onToggle?.(row.original)}
                />
                <Status tone={campaign.status === "ACTIVE" ? "ok" : "warn"}>
                  {phase.label}
                </Status>
              </span>
            ) : (
              <Status tone={phase.tone}>{phase.label}</Status>
            )
          }
        >
          {count(offers)} {offers === 1 ? "offer" : "offers"} ·{" "}
          <span className={reached === 0 ? "text-warn-fg" : undefined}>
            {of === null
              ? `${count(reached)} ${reached === 1 ? "store" : "stores"}`
              : `${count(reached)} / ${count(of)} stores`}
          </span>
          <br />
          {campaign.valid_from ? day(campaign.valid_from) : "always"} →{" "}
          {campaign.valid_to ? day(campaign.valid_to) : "open"}
        </CardFoot>
      )
    },
  },
  {
    id: "edit",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { align: "right", card: "status" },
    // No handler of its own: the click reaches the card, whose tap opens the
    // sheet — the button only says so.
    cell: ({ row }) => (
      <Button
        variant="tint"
        size="card"
        aria-label={`Edit ${row.original.row.campaign.name}`}
      >
        Edit
      </Button>
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
  // The title stands at once; the list waits for its first page and streams in
  // with it (the server starts the read too). The head's search and button and
  // the rest of the page come with the list.
  return (
    <Suspense
      fallback={
        <PageContent>
          <PageHeader crumb="Marketing" title="Campaigns" />
          <LoadingState>Loading campaigns…</LoadingState>
        </PageContent>
      }
    >
      <CampaignBook />
    </Suspense>
  )
}

function CampaignBook() {
  const client = useQueryClient()
  const actor = useActor()
  // A phone draws the rows as cards and keeps the search, the filter and New in
  // the drawer over the bottom bar (`DockTools`, `Fab`).
  const phone = useLayout() === "phone"
  /// The search, in the URL like Promotions', so a narrowed list is a link.
  const search = useSheet("q")
  const query = search.value ?? ""
  const setQuery = (next: string) =>
    next === "" ? search.close() : search.replace(next)
  const [writing, setWriting] = useState(false)
  /// The campaign the form starts from — Change or Duplicate — or none for a
  /// blank one. `formKey` makes every opening read its answers afresh.
  const [seed, setSeed] = useState<CampaignSeed | null>(null)
  const [formKey, setFormKey] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<PublishReceipt | null>(null)
  /// A switch or publish that went through, held in the receipt dialog until
  /// it is read. One state for the three writes — pause, end, publish —
  /// because only one of them can land at a time.
  const [switched, setSwitched] = useState<{
    readonly title: string
    readonly note?: string
  } | null>(null)
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
  ///
  /// No clause reads as Live (owner, 16 Oct: the list opens on Live) until
  /// somebody picks All, or takes a Status clause away — then it is every
  /// phase. Held here rather than written into the URL on arrival: a write
  /// while the page hydrates is dropped.
  const clause = filters.filters.find(
    (one) =>
      one.column === "live" &&
      (one.operator === "isAnyOf" || one.operator === "is")
  )
  const [everyPhase, setEveryPhase] = useState(false)
  if (clause !== undefined && !everyPhase) setEveryPhase(true)
  const phases = useMemo(
    () =>
      clause !== undefined ? [...clause.values] : everyPhase ? [] : ["ACTIVE"],
    [clause, everyPhase]
  )

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
  ///
  /// The deferred scope keeps the rows in hand on screen while the next
  /// question is read, so a keystroke does not empty the table.
  const asked = useDeferredValue(scope)
  const list = useSuspenseInfiniteQuery(campaignPagesQuery(asked))
  const first = list.data.pages[0]

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
    () => filters.columnFilters.filter((one) => !SERVER_FILTERED.has(one.id)),
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

  /// The KPI figures, over every campaign the usage counter knows — not only
  /// the pages loaded (owner, 16 Oct: KPIs like Vouchers').
  const totals = useMemo(() => {
    let uses = 0
    let spent = 0
    let near = 0
    for (const one of usage.data ?? []) {
      if (one.kind !== "CAMPAIGN") continue
      uses += one.uses
      spent += one.spent_minor
      if (
        one.budget_minor !== null &&
        one.budget_minor > 0 &&
        one.spent_minor >= one.budget_minor * 0.9
      )
        near += 1
    }
    return { uses, spent, near }
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
      byOrigin.get(originId) ?? siteId ?? "Till not assigned to a store"
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
    () => list.data.pages.flatMap((page) => page.rows.map(lineOf)),
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
    enabled: sheet.value !== undefined && loadedLine === undefined,
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
      const did =
        line.row.campaign.status === "ACTIVE" ? "Paused" : "Live again"
      setSwitched({
        title:
          sent === null
            ? `${did} — no store to send it to yet`
            : `${did} — sent to ${storesWord(sent)}`,
        note: line.row.campaign.name,
      })
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

  /// Pausing stops the discounts at the tills, so it is asked first. Resuming
  /// puts back what somebody already approved of.
  const requestToggle = useCallback(
    (line: CampaignLine) => {
      if (line.row.campaign.status === "ACTIVE") {
        setPausing(line)
        return
      }
      setBusy(line.row.campaign.campaign_id)
      flip(line)
    },
    [flip]
  )

  /// Ending is for good: the status the books call Cancelled, written by the
  /// same switch as Pause. Returns the promise so the confirm waits on it.
  const end = useMutation({
    mutationFn: (line: CampaignLine) =>
      setCampaignStatus({
        campaign: asInput(line.row),
        status: "CANCELLED",
        actorId: actor,
      }),
    onSuccess: (response, line) => {
      const sent = sentTo(response)
      setSwitched({
        title:
          sent === null
            ? "Ended — no store to send it to yet"
            : `Ended — sent to ${storesWord(sent)}`,
        note: line.row.campaign.name,
      })
    },
    onSettled: () => client.invalidateQueries({ queryKey: commercialKeys.all }),
  })

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
          // The card's own columns are drawn on a phone and never on a desk.
          columnVisibility: {
            head: phone,
            lead: phone,
            foot: phone,
            edit: phone,
          },
        },
        manualSorting: true,
        onSortingChange: setSorting,
        meta: {
          busy,
          shops,
          onToggle: requestToggle,
        },
      }),
      [
        lines,
        filters.columns,
        tableFilters,
        sorting,
        busy,
        shops,
        requestToggle,
        phone,
      ]
    )
  )

  /// Open the form, blank or from a published campaign.
  const startForm = (from: CampaignSeed | null) => {
    setSeed(from)
    setFormKey((one) => one + 1)
    setWriting(true)
  }

  /// The Status clause as one-of-a-few — the desk's tabs and the phone's
  /// dock button — with the counts the server gives per phase.
  const statusValue = phases.length === 1 ? phases[0] : "ALL"
  /// Live first — the tab the list opens on (owner, 16 Oct); All last.
  const statusOptions = [
    ...(first?.facets.phases ?? [])
      .filter((one) => one.count > 0 || phases.includes(one.value))
      .map((one) => ({
        value: one.value,
        label: stateOf(one.value).label,
        count: one.count,
      }))
      .sort(
        (a, b) => Number(b.value === "ACTIVE") - Number(a.value === "ACTIVE")
      ),
    { value: "ALL", label: "All", count: everyCount ?? undefined },
  ]
  const setStatus = (next: string) => {
    setEveryPhase(true)
    filters.set([
      ...filters.filters.filter((one) => one.column !== "live"),
      ...(next === "ALL"
        ? []
        : [{ column: "live", operator: "isAnyOf" as const, values: [next] }]),
    ])
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Marketing"
        title="Campaigns"
        // On a phone the search and New are in the drawer over the bottom bar.
        actions={
          phone ? undefined : (
            <>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-9 w-56"
              />
              <DeskFilterButton
                model={filters}
                filterModel={{ ...filters, fields: counted }}
                table={table}
              />
              <Button variant="primary" onClick={() => startForm(null)}>
                New campaign
              </Button>
            </>
          )
        }
      />

      {SHOW_PERFORMANCE && <PerformanceHeader of="campaigns" />}

      {!phone && (
        <KpiStrip className="xl:grid-cols-5">
          <Kpi
            label="Live"
            value={
              first === undefined
                ? "—"
                : count(
                    first.facets.phases.find((one) => one.value === "ACTIVE")
                      ?.count ?? 0
                  )
            }
          />
          <Kpi
            label="Scheduled"
            value={
              first === undefined
                ? "—"
                : count(
                    first.facets.phases.find((one) => one.value === "SCHEDULED")
                      ?.count ?? 0
                  )
            }
          />
          <Kpi label="Spent" value={money(totals.spent)} />
          <Kpi label="Transactions" value={count(totals.uses)} />
          <Kpi
            label="Near budget"
            value={
              <span className={cn(totals.near > 0 && "text-warn-fg")}>
                {count(totals.near)}
              </span>
            }
          />
        </KpiStrip>
      )}

      {toggle.isError && (
        <div className="mb-4">
          <ErrorState error={toggle.error} />
        </div>
      )}

      {receipt && receipt.delivered_to.length === 0 && (
        <Banner tone="warn" className="mb-4" onDismiss={() => setReceipt(null)}>
          Published, but no store is registered yet.
        </Banner>
      )}

      {/* Purchase Orders' shape: search and one filter button on the
          header's line, the clauses in force as chips over the table — which
          stay visible while somebody reads the rows they produced. */}
      <div className="min-w-0">
        <div className="flex min-w-0 flex-col">
          <SubTabs
            className="max-md:hidden"
            tabs={statusOptions.map((one) => ({
              value: one.value,
              label:
                one.count === undefined ? (
                  one.label
                ) : (
                  <>
                    {one.label}{" "}
                    <span className="text-mute tabular-nums">
                      {count(one.count)}
                    </span>
                  </>
                ),
              short: one.label,
            }))}
            value={statusValue}
            onChange={setStatus}
          />
          {!phone && (
            <DeskFilterChips
              model={filters}
              filterModel={{ ...filters, fields: counted }}
              table={table}
            />
          )}
          <Card
            aria-busy={asked !== scope || undefined}
            className="list-swap overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none"
          >
            {needle === "" && everyCount === 0 ? (
              <EmptyState
                action={
                  <Button variant="soft" onClick={() => startForm(null)}>
                    New campaign
                  </Button>
                }
              >
                No campaigns.
              </EmptyState>
            ) : (
              <DataTable<CampaignLine>
                refresh={[list]}
                table={table}
                onRowClick={(row) => sheet.open(row.row.campaign.campaign_id)}
                isSelected={(row) =>
                  row.row.campaign.campaign_id === sheet.value
                }
                more={list}
                empty={
                  filters.filters.length > 0
                    ? "No campaign matches those filters."
                    : "No campaign matches that search."
                }
                cardSort={false}
                cardsApart
                cardLead
                className={`max-h-[calc(100dvh-15rem)] ${ROOMY}`}
              />
            )}
          </Card>
        </div>
      </div>

      <Fab label="New campaign" onClick={() => startForm(null)} />
      {/* On a phone the search, the filter and the sort live in the drawer over
          the bottom bar, not at the top of the list. */}
      <DockTools
        search={{ value: query, onChange: setQuery, label: "Search Campaigns" }}
        filter={{
          count: filters.filters.length,
          panel: {
            model: filters,
            filterModel: { ...filters, fields: counted },
            table,
          },
        }}
        sort={dockSortOf(table)}
        // The Status clause of the filter, as the one-of-a-few button the other
        // lists have: the phases the server counts, with their counts.
        status={{
          value: statusValue,
          options: statusOptions,
          onChange: setStatus,
        }}
      />

      <CampaignSheet
        line={sheetLine}
        subject={sheet.subject}
        rules={openOffers.data ?? null}
        campaigns={everyCampaign}
        shopName={shopName}
        at={list.dataUpdatedAt}
        busy={busy === sheetLine?.row.campaign.campaign_id}
        canWrite={actor !== ""}
        onClose={sheet.close}
        onChange={(line) =>
          startForm({ mode: "change", campaign: line.row.campaign })
        }
        onDuplicate={(line) =>
          startForm({ mode: "duplicate", campaign: line.row.campaign })
        }
        onToggle={requestToggle}
        onEnd={(line) => end.mutateAsync(line)}
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
        Offers inside it stop at the tills.
      </Dialog>

      <CampaignForm
        key={
          seed === null
            ? `new:${formKey}`
            : `${seed.mode}:${seed.campaign.campaign_id}:${formKey}`
        }
        open={writing}
        seed={seed}
        nextVersion={books.data === undefined ? 1 : nextBookVersion(books.data)}
        onClose={() => setWriting(false)}
        onPublished={(published, campaignId) => {
          setReceipt(published)
          setWriting(false)
          const reached = published.delivered_to.length
          setSwitched({
            title:
              reached === 0
                ? "Published — no store to send it to yet"
                : `Published — sent to ${storesWord(reached)}`,
          })
          fresh.current = { id: campaignId, opened: false }
          sheet.open(campaignId)
        }}
      />

      <SavedDialog
        open={switched !== null}
        onOpenChange={(next) => {
          if (!next) setSwitched(null)
        }}
        title={switched?.title ?? ""}
      >
        {switched?.note}
      </SavedDialog>
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
/// The only part of a published campaign that may be edited in place, alongside
/// the switch — a banner describes the offer; it does not decide money. Saving
/// dispatches to the fleet in the same call, on the switch lane.
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
        // Its own status, unchanged: this endpoint takes the switch and the
        // poster together, and sending the current status is how a poster edit
        // says "leave the lever where it is".
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
    <Block icon={ImageIcon} title="Poster">
      {image !== "" && (
        <img
          src={image}
          alt=""
          className="aspect-[3/1] w-full rounded-inner border border-hairline bg-soft-2 object-cover"
        />
      )}
      <div className="flex flex-col gap-5">
        <Field label="Headline" className="gap-2">
          <Input
            value={headline}
            onChange={(event) => setHeadline(event.target.value)}
          />
        </Field>
        <Field label="Image URL" className="gap-2">
          <Input
            value={image}
            onChange={(event) => setImage(event.target.value)}
          />
        </Field>
        {/* A block, not a line: a shop prints a paragraph. */}
        <Field label="Terms" className="gap-2">
          <Textarea
            value={terms}
            rows={3}
            onChange={(event) => setTerms(event.target.value)}
          />
        </Field>
      </div>
      {save.isError && <ErrorState error={save.error} />}
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={!changed || actor === ""}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
        {save.isSuccess && !changed && (
          <span className="text-[0.9375rem] text-mute">Sent to stores.</span>
        )}
      </div>
    </Block>
  )
}

/// One campaign, read back as three tabs: Details (Campaign, Offers, Goal,
/// Results, Plan, Poster), Stores and Activity. Change, Duplicate, Pause and
/// End sit in the head. No comments.
///
/// **Results are the campaign's own window, never the screen's.** "Did
/// Eid hit its target" is asked over Eid's dates whatever today is.
function CampaignSheet({
  line,
  subject,
  rules,
  campaigns,
  shopName,
  at,
  busy,
  canWrite,
  onClose,
  onChange,
  onDuplicate,
  onToggle,
  onEnd,
}: {
  line: CampaignLine | null
  /// The record's `{kind,id}`, for the Activity tab. Not passed to the Sheet,
  /// which would add a Comments tab.
  subject: { kind: string; id: string } | undefined
  /// The instant the phase is read at — the list's, as the rows read it. A
  /// clock read during render gives two answers on two renders.
  at: number
  /// The promotions filed under this campaign, read for the open sheet.
  /// `null` while they are on their way.
  rules: readonly PromotionRow[] | null
  /// Every campaign in the books, for the goal's precedent picker.
  campaigns: readonly BookCampaign[]
  /// A shop as a person names it, from the fleet read.
  shopName: (originId: string, siteId: string | null) => string
  busy: boolean
  canWrite: boolean
  onClose: () => void
  onChange: (line: CampaignLine) => void
  onDuplicate: (line: CampaignLine) => void
  onToggle: (line: CampaignLine) => void
  onEnd: (line: CampaignLine) => Promise<unknown>
}) {
  const spent = line?.usage?.spent_minor ?? 0
  const uses = line?.usage?.uses ?? 0
  const budget = line?.row.campaign.budget_minor ?? null
  const maxUses = line?.row.campaign.max_uses ?? null
  // The tab is remembered WITH the campaign it was picked on, so opening a
  // different one reads as no pick — its Details — without an effect resetting
  // it one render late.
  const campaignId = line?.row.campaign.campaign_id
  const [picked, setPicked] = useState<{
    campaignId: string | undefined
    tab: string | null
  }>({ campaignId: undefined, tab: null })
  const tab = picked.campaignId === campaignId ? picked.tab : null
  const setTab = (next: string | null) => setPicked({ campaignId, tab: next })
  /// Bring a part of Details into view once it mounts.
  const show = (anchor: string) => {
    setTab("details")
    window.setTimeout(() => {
      const still = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches
      document.getElementById(anchor)?.scrollIntoView({
        block: "start",
        behavior: still ? "auto" : "smooth",
      })
    }, 80)
  }

  const phase = line === null ? null : phaseOf(line.row.campaign, at)
  const stores = line?.row.campaign.site_ids ?? []

  const details =
    line === null ? undefined : (
      <div className="flex flex-col gap-8 pb-6">
        <NextSteps line={line} onShow={show} />

        <Block icon={Megaphone} title="Campaign">
          <Facts className="gap-y-5">
            <Fact term="Status">{phase?.label}</Fact>
            <Fact term="Period">
              {line.row.campaign.valid_from
                ? day(line.row.campaign.valid_from)
                : "Always"}{" "}
              →{" "}
              {line.row.campaign.valid_to
                ? day(line.row.campaign.valid_to)
                : "Open"}
            </Fact>
            <Fact term="Stores">
              {stores.length === 0 ? "Everywhere" : count(stores.length)}
            </Fact>
          </Facts>
          {budget === null ? (
            <Pair label="Given away">
              {money(spent)}{" "}
              <span className="font-normal text-mute">· No budget</span>
            </Pair>
          ) : (
            <Gauge
              label="Budget used"
              figures={`${money(spent)} / ${money(budget)}`}
              ratio={budget > 0 ? spent / budget : 1}
            />
          )}
          {maxUses === null ? (
            <Pair label="Transactions">{count(uses)}</Pair>
          ) : (
            <Gauge
              label="Transactions"
              figures={`${count(uses)} / ${count(maxUses)}`}
              ratio={maxUses > 0 ? uses / maxUses : 1}
            />
          )}
          {(budget !== null || maxUses !== null) && (
            <HardCap kind="CAMPAIGN" subject={line.row.campaign.campaign_id} />
          )}
        </Block>

        <Block
          icon={Percent}
          title="Offers"
          aside={
            <NewOfferLink
              campaignId={line.row.campaign.campaign_id}
              className="text-accent hover:underline"
            >
              New offer
            </NewOfferLink>
          }
        >
          {rules === null ? (
            <Quiet>Loading…</Quiet>
          ) : rules.length === 0 ? (
            <Quiet>No offers.</Quiet>
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
                  <MiniCell className="py-4">
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
                  <MiniCell className="py-4">
                    <span className="text-[0.9375rem] text-body">
                      {describeScope(rule.definition)}
                    </span>
                  </MiniCell>
                  <MiniCell align="right" className="py-4">
                    <span className="text-[0.9375rem] text-ink">
                      {describeEffect(rule.definition.effect)}
                    </span>
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          )}
        </Block>

        <CampaignGoal campaign={line.row.campaign} campaigns={campaigns} />
        <CampaignResults campaign={line.row.campaign} />
        <CampaignPlan campaignId={line.row.campaign.campaign_id} />
        <Poster line={line} />
      </div>
    )

  const storesTab =
    line === null ? undefined : (
      <div className="pb-6">
        {line.row.book.activated_by.length === 0 ? (
          <Quiet>No stores yet.</Quiet>
        ) : (
          <MiniTable
            head={["Store", { label: "Since", align: "left" }, "Offers"]}
          >
            {line.row.book.activated_by.map((activation) => (
              <MiniRow key={activation.origin_id}>
                <MiniCell className="py-4">
                  <Named
                    name={shopName(activation.origin_id, activation.site_id)}
                  />
                </MiniCell>
                <MiniCell className="py-4">
                  <span className="text-[0.9375rem] text-body">
                    {moment(activation.activated_at)}
                  </span>
                </MiniCell>
                <MiniCell align="right" className="py-4">
                  {count(activation.price_rule_count)}
                </MiniCell>
              </MiniRow>
            ))}
          </MiniTable>
        )}
      </div>
    )

  const ongoing =
    line !== null &&
    (line.row.campaign.status === "ACTIVE" ||
      line.row.campaign.status === "PAUSED" ||
      line.row.campaign.status === "SCHEDULED" ||
      line.row.campaign.status === "DRAFT") &&
    phase?.label !== "Ended"

  return (
    <Sheet
      open={line !== null}
      onOpenChange={(next) => !next && onClose()}
      id={line?.row.campaign.campaign_id}
      title={line?.row.campaign.name ?? "Campaign"}
      tabs={
        line === null
          ? undefined
          : [
              { value: "details", label: "Details", content: details },
              {
                value: "stores",
                label: `Stores (${count(line.row.book.activated_by.length)})`,
                content: storesTab,
              },
              {
                value: "activity",
                label: "Activity",
                content:
                  subject === undefined ? undefined : (
                    <RecordPanel subject={subject} />
                  ),
              },
            ]
      }
      tab={tab}
      onTabChange={setTab}
      // Nothing published is edited: Change publishes the next version under
      // the same id, Duplicate a new campaign. Both open the form filled in.
      actions={
        line === null ? undefined : (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canWrite}
              onClick={() => onChange(line)}
            >
              Change
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canWrite}
              onClick={() => onDuplicate(line)}
            >
              Duplicate
            </Button>
            {phase?.lever === true && (
              <Button
                variant="ghost"
                size="sm"
                pending={busy}
                disabled={!canWrite}
                onClick={() => onToggle(line)}
              >
                {line.row.campaign.status === "ACTIVE" ? "Pause" : "Resume"}
              </Button>
            )}
            {/* Ending is not a pause: it is for good, and the only way back is
                Change with new dates. */}
            {ongoing && (
              <ConfirmButton
                label="End now"
                title={`End ${line.row.campaign.name} now?`}
                description="Every offer inside it stops at the tills for good."
                confirmLabel="End now"
                tone="danger"
                variant="danger"
                size="sm"
                disabled={!canWrite}
                onConfirm={() => onEnd(line)}
              />
            )}
          </>
        )
      }
      badge={
        phase === null ? undefined : (
          <Status tone={phase.tone}>{phase.label}</Status>
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
  onShow,
}: {
  line: CampaignLine
  /// Scrolls Details to the part with this id.
  onShow: (anchor: string) => void
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

  const go = (anchor: string) => () => onShow(anchor)

  return (
    <div className="rounded-card border border-hairline px-5 py-5">
      <div className="mb-3 text-[0.9375rem] font-semibold text-ink">
        Next steps
      </div>
      <ul className="flex flex-col gap-1">
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
          action={<StepButton onClick={go(GOAL_ANCHOR)}>Set</StepButton>}
        />
        <Step
          done={planned}
          optional
          label="Plan activities"
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
    <li className="flex min-h-10 items-center gap-3">
      {done ? (
        <Check aria-hidden className="size-4 shrink-0 text-ok-fg" />
      ) : (
        <Circle aria-hidden className="size-4 shrink-0 text-line-ico" />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[0.9375rem]",
          done ? "text-mute" : "text-ink"
        )}
      >
        <span className="sr-only">{done ? "Done: " : "To do: "}</span>
        {label}
        {optional === true && <span className="text-mute"> · optional</span>}
      </span>
      {!done && <span className="shrink-0 text-[0.9375rem]">{action}</span>}
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

/// A published campaign the form starts from.
///
/// `change` publishes under the SAME `campaign_id` in a newer book, which is
/// how the fleet already reads an amendment — a campaign row is restated per
/// book and the newest wins — so it is a new version, never an edit of the old
/// one, and the offers that name the id stay inside it. `duplicate` mints a
/// new id and copies no offers.
export interface CampaignSeed {
  readonly mode: "change" | "duplicate"
  readonly campaign: BookCampaign
}

/// The form's answers, read off a published campaign.
function startingPoint(seed: CampaignSeed) {
  const campaign = seed.campaign
  const dayOf = (iso: string | null) =>
    iso === null ? "" : isoOf(new Date(iso))
  return {
    name: seed.mode === "duplicate" ? `${campaign.name} (copy)` : campaign.name,
    // An ended campaign starts again Live; one still running keeps its switch.
    status: (campaign.status === "EXPIRED" || campaign.status === "CANCELLED"
      ? "ACTIVE"
      : campaign.status) as CampaignState,
    from: dayOf(campaign.valid_from),
    to: dayOf(campaign.valid_to),
    budget: campaign.budget_minor === null ? "" : String(campaign.budget_minor),
    maxUses: campaign.max_uses === null ? "" : String(campaign.max_uses),
    headline: campaign.headline ?? "",
    image: campaign.image_url ?? "",
    terms: campaign.terms ?? "",
    stores: [...(campaign.site_ids ?? [])],
  }
}

/// Writing an envelope.
///
/// A campaign-only book is a legal book: the server's "must change something"
/// check counts campaigns as well as prices, so an envelope can be published
/// before anything is put in it — which is the order people actually work in.
///
/// **Only the minimum up front** (owner, 2026-09-27): a name, the dates and
/// the stores. The goal is not asked here at all — it is the sheet's
/// checklist, asked once the campaign exists.
///
/// The same shape as New promotion: icon headings, the form on the left and a
/// Summary card pinned on the right.
function CampaignForm({
  open,
  nextVersion,
  seed,
  onClose,
  onPublished,
}: {
  open: boolean
  nextVersion: number
  /// Where the answers start. Read once, on mount — the caller keys the form
  /// by it.
  seed: CampaignSeed | null
  onClose: () => void
  /// With the id the campaign was published under, so its sheet can open.
  onPublished: (receipt: PublishReceipt, campaignId: string) => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const [start] = useState(() => (seed === null ? null : startingPoint(seed)))
  const changing = seed?.mode === "change"
  const [name, setName] = useState(start?.name ?? "")
  const [status, setStatus] = useState<CampaignState>(start?.status ?? "ACTIVE")
  const [from, setFrom] = useState(() => start?.from ?? today())
  const [to, setTo] = useState(start?.to ?? "")
  const [budget, setBudget] = useState(start?.budget ?? "")
  const [maxUses, setMaxUses] = useState(start?.maxUses ?? "")
  // The three a SHOPPER reads. They ride on the campaign and nowhere else —
  // a shop cannot put "Eid Sale, ends Sunday" on a screen out of an id and
  // a percentage.
  const [headline, setHeadline] = useState(start?.headline ?? "")
  const [image, setImage] = useState(start?.image ?? "")
  const [terms, setTerms] = useState(start?.terms ?? "")
  // Empty is everywhere, which is what a campaign that names no store has
  // always meant.
  const [stores, setStores] = useState<readonly string[]>(start?.stores ?? [])
  /// Problems are said at their fields once somebody has pressed Publish.
  const [tried, setTried] = useState(false)

  /// The tail of the id, held so the id does not move between attempts.
  ///
  /// The id used to be minted inside the mutation, which meant a retry after a
  /// halted publish asked for a second campaign under a second id — two
  /// envelopes for one intention. Only the random tail is held: the readable
  /// half still follows the name. A change keeps the id it already has.
  const [tail] = useState(() => crypto.randomUUID().slice(0, 4))

  const fleet = useQuery({
    queryKey: commercialKeys.fleet(),
    queryFn: ({ signal }) => commercialFleet(signal),
  })

  const campaignId =
    changing && seed !== null
      ? seed.campaign.campaign_id
      : `${slug(name)}-${tail}`

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
  /// Reusing one key across attempts would be wrong: a halted publish leaves a
  /// book behind, so the *next* attempt asks for a higher version — a
  /// different payload under the same key, which `command_deduplication`
  /// refuses outright. The guard against a double click is the disabled
  /// button, and against a lost response the version check.
  const publish = useMutation({
    // The id rides as the mutation's variable, so the one reported on success
    // is the one that was published even if the name was edited meanwhile.
    mutationFn: (id: string) =>
      writeAndPublish({
        ...NOTHING_TO_PUBLISH,
        version: nextVersion,
        name: `${changing ? "Change" : "Campaign"}: ${name.trim()}`,
        effective_from: validFrom ?? new Date().toISOString(),
        effective_to: null,
        campaigns: [
          {
            // Readable, and unique enough: the id travels to every till and
            // shows on the sheet, so a slug beats a uuid nobody can say out
            // loud. A change restates the id it already has.
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
            // back to thirteen by a rule that names thirteen.
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
    },
  })

  const nameProblem = name.trim() === "" ? "Give it a name." : undefined
  const windowProblem = windowBroken ? "Ends before it starts." : undefined
  const budgetProblem =
    budget.trim() !== "" && budgetMinor === null
      ? "Whole rupiah only."
      : undefined
  const problem =
    actor === ""
      ? "Sign in to publish."
      : (nameProblem ?? windowProblem ?? budgetProblem)

  const halted =
    publish.error instanceof BookWrittenNotPublished ? publish.error : null

  /// How many settings inside the poster fold are set.
  const shown = [headline, terms, image].filter(
    (one) => one.trim() !== ""
  ).length
  const everyShop =
    stores.length > 0 &&
    stores.length ===
      (fleet.data?.items ?? []).filter((one) => one.site_id !== null).length

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={
        changing
          ? "Change campaign"
          : seed?.mode === "duplicate"
            ? "Duplicate campaign"
            : "New campaign"
      }
      id={changing ? seed?.campaign.campaign_id : `v${nextVersion}`}
      width="workspace"
      // The form and the summary it reads back sit side by side, each with
      // room — the same panel New promotion gets.
      className="md:w-[clamp(32rem,92vw,80rem)]"
      footer={
        <div className="flex items-center justify-between gap-4">
          {/* Nothing until the form can be published, then the offer in one
              line; what is stopping the button is said BESIDE it, once
              somebody has pressed it. */}
          <span
            className={cn(
              "min-w-0 text-[0.9375rem] leading-snug",
              tried && problem !== undefined ? "text-bad" : "text-text"
            )}
          >
            {tried && problem !== undefined
              ? problem
              : problem === undefined
                ? readsCampaign(
                    status,
                    from === "" ? null : from,
                    to === "" ? null : to,
                    budgetMinor
                  )
                : null}
            {changing &&
              seed?.campaign.status === "PAUSED" &&
              !(tried && problem !== undefined) && (
                <span className="text-mute"> · Stays paused</span>
              )}
          </span>
          <Button
            className="ml-auto"
            variant="primary"
            pending={publish.isPending}
            disabled={actor === ""}
            onClick={() =>
              problem === undefined
                ? publish.mutate(campaignId)
                : setTried(true)
            }
          >
            {publish.isPending ? "Publishing…" : "Publish"}
          </Button>
        </div>
      }
    >
      {halted !== null ? (
        <Banner tone="bad" className="mb-5">
          {halted.message}
        </Banner>
      ) : publish.isError ? (
        <div className="mb-5">
          <ErrorState error={publish.error} />
        </div>
      ) : null}

      {/* Measured on the sheet, not on the window. */}
      <div className="@container">
        <div className="grid gap-8 @3xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] @3xl:gap-x-10">
          <div className="flex flex-col gap-10">
            <Section title="Campaign" icon={Megaphone}>
              <div className="grid gap-5 @lg:grid-cols-2">
                <Field
                  className="gap-2"
                  label="Name"
                  required
                  problem={tried ? nameProblem : undefined}
                >
                  <Input
                    value={name}
                    autoFocus
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                {/* Ended and Cancelled are not a way to start. */}
                <Field className="gap-2" label="Status">
                  <Select
                    value={status}
                    onChange={(next) => setStatus(next as CampaignState)}
                  >
                    {CAMPAIGN_STATES.filter(
                      (one) =>
                        one.value !== "EXPIRED" && one.value !== "CANCELLED"
                    ).map((one) => (
                      <option key={one.value} value={one.value}>
                        {one.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </Section>

            {/* A whole day each end, so "until 30 September" includes the
                thirtieth. The budget and the limit are shared by every offer
                inside, not given to each; a per-customer limit is not offered
                — the server refuses one on a campaign. */}
            <Section title="Schedule and budget" icon={CalendarRange}>
              <div className="grid gap-5 @lg:grid-cols-2">
                <Field className="gap-2" label="Starts">
                  <Day
                    value={from}
                    onChange={setFrom}
                    label="The day this campaign starts"
                    presets={[
                      { label: "Today", value: today() },
                      { label: "Tomorrow", value: shift(today(), 1) },
                      { label: "In a week", value: shift(today(), 7) },
                    ]}
                  />
                </Field>
                <Field
                  className="gap-2"
                  label="Ends"
                  problem={tried ? windowProblem : undefined}
                >
                  <Day
                    value={to}
                    onChange={setTo}
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
                <Field
                  className="gap-2"
                  label="Budget"
                  problem={tried ? budgetProblem : undefined}
                >
                  <Money
                    value={budget}
                    onChange={setBudget}
                    prefix="Rp"
                    label="Budget for the whole window"
                  />
                </Field>
                <Field className="gap-2" label="Transactions limit">
                  <Stepper
                    value={maxUses}
                    onChange={setMaxUses}
                    min={1}
                    label="Most transactions"
                  />
                </Field>
              </div>
            </Section>

            {/* Naming none means everywhere. Naming some is a CONSTRAINT, not a
                default: an offer inside this campaign runs where both its own
                list and this one allow. */}
            <Section
              title="Stores"
              icon={Store}
              aside={stores.length === 0 ? "Everywhere" : undefined}
            >
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

            {/* The three a SHOPPER reads. Empty headline means stores show the
                name above. */}
            <More label="Poster" count={shown}>
              <Field className="gap-2" label="Headline">
                <Input
                  value={headline}
                  onChange={(event) => setHeadline(event.target.value)}
                />
              </Field>
              <Field className="gap-2" label="Terms">
                <Textarea
                  value={terms}
                  rows={3}
                  onChange={(event) => setTerms(event.target.value)}
                />
              </Field>
              <Field className="gap-2" label="Image URL">
                <Input
                  value={image}
                  onChange={(event) => setImage(event.target.value)}
                />
              </Field>
            </More>
          </div>

          {/* The combination, read back. Pinned while the form scrolls, so it
              is read beside the answers that change it. */}
          <div className="flex flex-col gap-10 rounded-card border border-hairline bg-soft p-6 @3xl:sticky @3xl:top-0 @3xl:self-start">
            <Section title="Summary" icon={ClipboardList}>
              <Terms
                variant="rows"
                headline=""
                name={name}
                empty="Nothing to show yet."
                clauses={[]}
                rows={[
                  [
                    name.trim() !== "" && {
                      label: "Name",
                      value: name.trim(),
                    },
                    { label: "Status", value: stateOf(status).label },
                    {
                      label: "Period",
                      value:
                        validFrom !== null && validTo !== null
                          ? `${day(validFrom)} – ${day(validTo)}`
                          : validFrom !== null
                            ? `From ${day(validFrom)}`
                            : validTo !== null
                              ? `Until ${day(validTo)}`
                              : "Always on",
                    },
                    {
                      label: "Stores",
                      value:
                        stores.length === 0
                          ? "Everywhere"
                          : everyShop
                            ? `All ${count(stores.length)}`
                            : count(stores.length),
                    },
                  ].filter((row) => row !== false),
                  [
                    budgetMinor !== null && {
                      label: "Budget",
                      value: money(budgetMinor),
                    },
                    maxUses.trim() !== "" && {
                      label: "Transactions",
                      value: count(Number(maxUses)),
                    },
                    headline.trim() !== "" && {
                      label: "Headline",
                      value: headline.trim(),
                    },
                  ].filter((row) => row !== false),
                ]}
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

/// The stores a campaign runs in, as tiles rather than a list box.
///
/// "Everywhere" is the absence of a choice rather than another option: naming
/// every store and naming none behave identically at the till, and only one of
/// them survives a store being opened next year.
///
/// **It reports the store toggled, never the whole new list.** Two tiles
/// pressed in one tick both read the list as it was before either press, so
/// the second would overwrite the first. Reporting the single change lets the
/// holder apply it functionally, which cannot race.
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
  const tile = (on: boolean) =>
    cn(
      "flex min-h-12 items-center rounded-inner border px-4 py-2 text-left text-[0.9375rem] transition-colors",
      on
        ? "border-accent bg-accent-bg font-medium text-accent"
        : "border-hairline text-body hover:text-ink"
    )
  return (
    <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3">
      <button
        type="button"
        aria-pressed={everywhere}
        onClick={onClear}
        className={tile(everywhere)}
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
            aria-pressed={on}
            onClick={() => onToggle(id)}
            className={tile(on)}
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
