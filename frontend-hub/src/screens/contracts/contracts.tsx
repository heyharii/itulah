import { useInfiniteQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState, LoadMore, type Pageable } from "@/components/ui/states"
import { count, money, span } from "@/lib/format"
import { gaContracts, gaKeys } from "@/lib/queries/ga"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import { ContractComposer } from "@/screens/contracts/composer"
import { monthLabel, partyOf, siteOf } from "@/screens/contracts/format"
import {
  CONTRACT_GROUPS,
  type ContractGroupCode,
} from "@/screens/contracts/groups"
import { ContractHubSheet } from "@/screens/contracts/hub"
import { FinanceMark, StandingPill } from "@/screens/contracts/parts"
import type { GaContractRow, GaContractSummary } from "@itulah/contract"

/// The contract register — every deal behind the bills, on one screen.
///
/// # One row, the groups as chips
///
/// The six groups (Leases, Services, Insurance, Permits, Subscriptions,
/// Leased out) were six sidebar rows, plus two hidden views, until the owner
/// asked for a shorter menu on 2026-09-27. They were always one table read
/// through eight doors that differed by one parameter — and every link into a
/// contract landed on the Leases door whatever the contract was. So there is
/// one Contracts row, and the group is a chip whose value rides in
/// `?contract-group=`; a link to one group is still a link somebody can send.
///
/// # Subscriptions read per place
///
/// A subscription is checked by where it is connected — "what is connected at
/// the warehouse" — and its meter readings live on it, so that chip swaps the
/// columns for the provider, the customer number and the last reading, and
/// sorts by location. It is what the hidden Utilities view used to be; the
/// per-site version of the same list is the Utilities tab on a location.
///
/// # What the strip above the table is allowed to sum
///
/// Nothing the browser holds. The register pages as it scrolls, so a strip
/// summed over the loaded rows would be a figure about the scroll position;
/// the server counts the four figures over every contract the reading
/// matches and sends them beside the first page.
///
/// # Billed reads zero today, and that is honest
///
/// `billed_minor` counts POSTED bill lines pointing at the contract, and the
/// column that lets a bill line point (`contract_id`) lands in tahap 6. Until
/// then the figure is zero because nothing CAN point yet — the mark beside it
/// says the figure is Finance's ledger, and the hub says where it is computed
/// from. Dropping the column until tahap 6 would hide the place the number
/// will live.
type Reading = {
  title: string
  sub: string
  /// The `group=` the register is narrowed by; absent for every group.
  group?: ContractGroupCode
  /// Subscriptions re-sort by site and swap their columns.
  kind: "register" | "utilities"
}

function readingFor(group: ContractGroupCode | undefined): Reading {
  const chosen = CONTRACT_GROUPS.find((one) => one.group_code === group)
  if (chosen === undefined) {
    return {
      kind: "register",
      title: "Contracts",
      sub: "Every deal behind the bills: what we rent, the services we buy, insurance, permits, subscriptions, and what we rent out.",
    }
  }
  return {
    kind: chosen.group_code === "LANGGANAN" ? "utilities" : "register",
    title: `Contracts · ${chosen.label}`,
    sub: GROUP_LEADS[chosen.group_code],
    group: chosen.group_code,
  }
}

/// One sentence per group, under the title.
const GROUP_LEADS: Record<ContractGroupCode, string> = {
  SEWA: "Land, stores, warehouses, offices, staff housing and vehicles the company rents.",
  JASA: "Recurring services such as maintenance and cleaning.",
  ASURANSI: "Property and vehicle policies, with the date each one runs out.",
  IZIN: "Business permits, vehicle papers (STNK/KIR), property tax and billboard tax: everything that expires and has to be renewed.",
  LANGGANAN:
    "Electricity, water, telephone and internet connections, listed by location.",
  DISEWAKAN: "Space and equipment the company rents out to others.",
}

/// How many contracts one page of the register asks for.
const PAGE = 100

export function Contracts() {
  const chip = useSheet("contract-group")
  const view = readingFor(chip.value)
  const open = useSheet("contract")
  const [search, setSearch] = useState("")
  const [archived, setArchived] = useState(false)
  const [adding, setAdding] = useState(false)
  // The search is the server's, so it waits for the typing to stop.
  const needle = useDebounced(search.trim(), 300)

  const scope = useMemo(
    () => ({
      q: needle === "" ? undefined : needle,
      group: view.group,
      // The archive is the register's only way back out of the list, so the
      // reading is explicit: the default list is the living register, and the
      // archived contracts are one deliberate click away rather than gone.
      // Sent both ways — an absent `archived` is the server's "both".
      archived,
    }),
    [needle, archived, view.group]
  )

  /// The register, a page at a time as its foot nears view. Its own key under
  /// the register's prefix, so a plain read of the same scope elsewhere
  /// cannot be served a paged answer; `gaKeys.all` still reaches it.
  const register = useInfiniteQuery({
    queryKey: [
      ...gaKeys.contracts(scope),
      "pages",
      view.kind === "utilities" ? "site" : "register",
    ] as const,
    queryFn: ({ pageParam, signal }) =>
      gaContracts(
        {
          ...scope,
          // Subscriptions read by PLACE: the question this reading answers is
          // "what is connected there", and a register order would scatter one
          // site's connections across the table. The server sorts, so the
          // order holds across pages.
          sort: view.kind === "utilities" ? "site" : undefined,
          limit: PAGE,
          cursor: pageParam,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(
    () => register.data?.pages.flatMap((page) => page.rows) ?? [],
    [register.data]
  )
  const head = register.data?.pages[0]

  return (
    <PageContent>
      <PageHeader
        crumb="GA"
        title={view.title}
        sub={view.sub}
        actions={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Number, party or location"
              className="h-8 w-56"
            />
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus />
              Add contract
            </Button>
          </>
        }
      />

      <Toolbar>
        <GroupChips
          here={view.group ?? null}
          counts={head?.facets.groups ?? []}
        />
      </Toolbar>

      {head !== undefined && (
        <SummaryStrip summary={head.summary} total={head.total} view={view} />
      )}

      <Toolbar>
        <Segmented
          options={[
            { value: "LIVE" as const, label: "Active" },
            { value: "ARCHIVED" as const, label: "Archived" },
          ]}
          value={archived ? "ARCHIVED" : "LIVE"}
          onChange={(next) => setArchived(next === "ARCHIVED")}
        />
        <Toolbar.Spacer />
        {head !== undefined && (
          <span className="text-meta text-body">
            <b className="font-medium text-ink">{count(head.total)}</b>{" "}
            {head.total === 1 ? "contract" : "contracts"}
          </span>
        )}
      </Toolbar>

      {queryState(register, {
        loading: "Loading contracts…",
        render: () =>
          rows.length === 0 ? (
            <Card>
              <EmptyState
                action={
                  <Button variant="ghost" onClick={() => setAdding(true)}>
                    Record the first one
                  </Button>
                }
              >
                {archived
                  ? "The archive is empty. An archived contract moves here; it is not deleted."
                  : "No contracts in this reading yet. A contract is recorded from its agreement: its type, its parties, and its term."}
              </EmptyState>
            </Card>
          ) : (
            <ContractTable
              view={view}
              rows={rows}
              onOpen={open.open}
              more={register}
            />
          ),
      })}

      {/* Keyed per chip and per record: the composer re-arms on the group it
          is opened from, and the hub drops its archive question (and its own
          tab) whenever another contract opens. Without the key, a cancelled
          form would leak a Leases type into a Services composer and an
          abandoned archive reason would still be waiting under the next
          contract. */}
      <ContractComposer
        key={view.group ?? "all"}
        open={adding}
        group={view.group ?? ""}
        onClose={() => setAdding(false)}
        onSaved={(contractId) => {
          setAdding(false)
          open.open(contractId)
        }}
      />

      <ContractHubSheet
        key={open.value ?? "none"}
        contractId={open.value}
        open={open.isOpen}
        onClose={open.close}
      />
    </PageContent>
  )
}

/// The six groups, as chips with their counts.
///
/// Links rather than buttons, so the group is in the address bar and a
/// reading of one group is something somebody can send. The counts are the
/// server's facets over the SEARCH rather than over the chip, so every chip
/// keeps its number while another one is lit.
function GroupChips({
  here,
  counts,
}: {
  here: ContractGroupCode | null
  counts: readonly { value: string; count: number }[]
}) {
  const total = counts.reduce((sum, one) => sum + one.count, 0)
  return (
    <nav
      aria-label="Contract groups"
      className="flex flex-wrap items-center gap-1.5"
    >
      <GroupChip label="All" n={total} active={here === null} />
      {CONTRACT_GROUPS.map((group) => (
        <GroupChip
          key={group.group_code}
          group={group.group_code}
          label={group.label}
          icon={group.icon}
          n={counts.find((one) => one.value === group.group_code)?.count ?? 0}
          active={here === group.group_code}
        />
      ))}
    </nav>
  )
}

/// One chip; no `group` is every group.
function GroupChip({
  group,
  label,
  icon: Glyph,
  n,
  active,
}: {
  group?: ContractGroupCode
  label: string
  icon?: React.ComponentType<{ className?: string }>
  n: number
  active: boolean
}) {
  return (
    <AppLink
      to="/contracts"
      sheet={
        group === undefined
          ? undefined
          : { key: "contract-group", value: group }
      }
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-meta font-medium transition-colors",
        active
          ? "border-accent bg-accent-bg text-accent"
          : "border-hairline-2 bg-canvas text-text hover:bg-soft"
      )}
    >
      {Glyph && (
        <Glyph
          className={cn(
            "size-4 stroke-[1.7]",
            active ? "text-accent" : "text-line-ico"
          )}
        />
      )}
      {label}
      <span
        className={cn(
          "text-pill tabular-nums",
          active ? "text-accent" : "text-mute"
        )}
      >
        {count(n)}
      </span>
    </AppLink>
  )
}

/// The strip between the header and the table: the four figures a group is
/// managed by, counted by the server over every contract the reading matches
/// — see the type comment. Leased out is the one group where the money flows
/// IN, so across every group the server leaves it out of what was billed to
/// us: a sum of both directions is a number nobody can use.
function SummaryStrip({
  summary,
  total,
  view,
}: {
  summary: GaContractSummary
  total: number
  view: Reading
}) {
  const billed = summary.billed_minor

  if (view.kind === "utilities") {
    return (
      <KpiStrip className="md:grid-cols-2 xl:grid-cols-2">
        <Kpi label="Connections" value={count(total)} />
        <Kpi
          label={
            <>
              Billed to date <FinanceMark className="ml-1 align-[0.125rem]" />
            </>
          }
          value={money(billed)}
        />
      </KpiStrip>
    )
  }

  return (
    <KpiStrip className="md:grid-cols-2 xl:grid-cols-4">
      <Kpi label="Active" value={count(summary.active)} />
      <Kpi label="Due for renewal" value={count(summary.due_for_renewal)} />
      <Kpi
        label="Active contract value"
        value={money(summary.active_value_minor)}
      />
      {/* The ledger behind the figure is the other desk's either way, hence
          the mark. */}
      <Kpi
        label={
          <>
            {view.group === "DISEWAKAN" ? "Received to date" : "Billed to date"}{" "}
            <FinanceMark className="ml-1 align-[0.125rem]" />
          </>
        }
        value={money(billed)}
      />
    </KpiStrip>
  )
}

/// The register's table, drawn per reading. The columns are the prototype's:
/// the paper's number, the parties, the deal's shape, where it applies, its
/// window and its two money columns — the last marked Finance's, because they
/// are read out of Finance's bill lines, not out of this register.
function ContractTable({
  view,
  rows,
  onOpen,
  more,
}: {
  view: Reading
  rows: readonly GaContractRow[]
  onOpen: (contractId: string) => void
  more: Pageable
}) {
  return (
    <Card className="overflow-hidden">
      {/* The register scrolls INSIDE its own box rather than squeezing the
          columns: eight columns of numbers, names and windows do not fit a
          phone, and a squeezed table overlaps its own cells while the page
          itself starts scrolling sideways. The same answer the asset register
          gives. */}
      <div className="overflow-x-auto">
        {view.kind === "utilities" ? (
          <div className="min-w-[61rem]">
            <div className="grid h-10 grid-cols-[minmax(13rem,1fr)_6.5rem_10rem_9rem_10rem_9rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
              <span>Provider</span>
              <span>Location</span>
              <span>Customer no.</span>
              <span className="text-right">
                Billed <FinanceMark className="ml-1 align-[0.0625rem]" />
              </span>
              <span>Last reading</span>
              <span>Status</span>
            </div>
            {rows.map((row) => (
              <UtilityRow key={row.contract_id} row={row} onOpen={onOpen} />
            ))}
          </div>
        ) : (
          <div className="min-w-[78rem]">
            <div className="grid h-10 grid-cols-[7rem_minmax(12rem,1fr)_10rem_6.5rem_11rem_8.5rem_8.5rem_9rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
              <span>Number</span>
              <span>Party</span>
              <span>Type</span>
              <span>Location</span>
              <span>Term</span>
              <span className="text-right">Contract value</span>
              <span className="text-right">
                {view.group === "DISEWAKAN" ? "Received" : "Billed"}{" "}
                <FinanceMark className="ml-1 align-[0.0625rem]" />
              </span>
              <span>Status</span>
            </div>
            {rows.map((row) => (
              <GroupRow key={row.contract_id} row={row} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
      {/* Outside the sideways-scrolling box, which computes as a vertical
          scroller too — see `<LoadMore>`. The page scrolls. */}
      <LoadMore query={more} />
    </Card>
  )
}

/// One contract, in the register reading.
function GroupRow({
  row,
  onOpen,
}: {
  row: GaContractRow
  onOpen: (contractId: string) => void
}) {
  return (
    <div
      onClick={() => onOpen(row.contract_id)}
      className="grid cursor-pointer grid-cols-[7rem_minmax(12rem,1fr)_10rem_6.5rem_11rem_8.5rem_8.5rem_9rem] items-center gap-3 border-b border-hairline px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-soft"
    >
      <span className="truncate font-mono text-id text-body">
        {row.contract_number ?? "—"}
      </span>
      <div className="min-w-0">
        <span className="block truncate text-cell font-medium text-ink">
          {partyOf(row)}
        </span>
        {row.notes !== null && (
          <span className="block truncate text-pill text-mute">
            {row.notes}
          </span>
        )}
      </div>
      <span className="min-w-0 truncate text-meta text-body">
        {row.contract_type_name}
        {/* The object rides under the type, because it only exists for
            maintenance contracts and a column of mostly-dashes is not a
            column. */}
        {row.objek_name !== null && (
          <span className="block truncate text-pill text-mute">
            Object: {row.objek_name}
          </span>
        )}
      </span>
      <span className="truncate text-meta text-body">{siteOf(row)}</span>
      <span className="truncate text-meta text-body tabular-nums">
        {span(row.starts_on, row.ends_on)}
      </span>
      <span className="truncate text-right text-meta text-body tabular-nums">
        {money(row.contract_value_minor)}
      </span>
      <span className="min-w-0 truncate text-right text-meta text-body tabular-nums">
        {money(row.billed_minor)}
        {/* The rest of the value, while there is a value to rest from. */}
        {row.remaining_minor !== null && (
          <span className="block truncate text-pill text-mute">
            {money(row.remaining_minor)} left
          </span>
        )}
      </span>
      <span>
        <StandingPill row={row} />
      </span>
    </div>
  )
}

/// One connection, in the Subscriptions reading: the place leads, because
/// that is what a facilities person scans for.
function UtilityRow({
  row,
  onOpen,
}: {
  row: GaContractRow
  onOpen: (contractId: string) => void
}) {
  return (
    <div
      onClick={() => onOpen(row.contract_id)}
      className="grid cursor-pointer grid-cols-[minmax(13rem,1fr)_6.5rem_10rem_9rem_10rem_9rem] items-center gap-3 border-b border-hairline px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-soft"
    >
      <div className="min-w-0">
        <span className="block truncate text-cell font-medium text-ink">
          {partyOf(row)}
        </span>
        <span className="block truncate text-pill text-mute">
          {row.contract_type_name}
        </span>
      </div>
      <span className="truncate text-meta text-body">{siteOf(row)}</span>
      <span className="truncate font-mono text-id text-body">
        {row.customer_number ?? "—"}
      </span>
      <span className="truncate text-right text-meta text-body tabular-nums">
        {money(row.billed_minor)}
      </span>
      <span className="min-w-0 truncate text-meta text-body tabular-nums">
        {row.last_usage === null ? (
          "—"
        ) : (
          <>
            {count(row.last_usage)} {row.last_unit}
            <span className="block truncate text-pill text-mute">
              {monthLabel(row.last_usage_period)}
            </span>
          </>
        )}
      </span>
      <span>
        <StandingPill row={row} />
      </span>
    </div>
  )
}
