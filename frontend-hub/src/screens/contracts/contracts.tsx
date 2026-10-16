import { useSuspenseInfiniteQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Fab } from "@/components/ui/fab"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { BarSpacer, ExpandingSearch } from "@/components/ui/list-chrome"
import { Segmented } from "@/components/ui/segmented"
import { SubTabs } from "@/components/ui/sub-tabs"
import {
  EmptyState,
  LoadingState,
  LoadMore,
  type Pageable,
} from "@/components/ui/states"
import { count, money, moneyCompact, span } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { gaContractBookQuery } from "@/lib/queries/ga"
import { useSheet } from "@/lib/sheets"
import { useDebounced } from "@/lib/use-debounced"
import { ContractComposer } from "@/screens/contracts/composer"
import {
  monthLabel,
  siteOf,
  useContractParty,
} from "@/screens/contracts/format"
import {
  CONTRACT_GROUPS,
  type ContractGroupCode,
} from "@/screens/contracts/groups"
import { ContractHubSheet } from "@/screens/contracts/hub"
import { FinanceMark, StandingPill } from "@/screens/contracts/parts"
import {
  CardFigure,
  CardName,
  type CardSpec,
  PhoneCards,
} from "@/components/ui/phone-cards"
import { FilterSheet } from "@/components/ui/filter-sheet"
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

export function Contracts() {
  const chip = useSheet("contract-group")
  const view = readingFor(chip.value)
  const open = useSheet("contract")
  const [search, setSearch] = useState("")
  const [archived, setArchived] = useState(false)
  const [adding, setAdding] = useState(false)
  const [filtering, setFiltering] = useState(false)
  const phone = useLayout() === "phone"
  // The search is the server's, so it waits for the typing to stop.
  const needle = useDebounced(search.trim(), 300)

  return (
    <PageContent>
      <PageHeader
        crumb="GA"
        title={view.title}
        sub={view.sub}
        actions={
          // The one thing this page makes stands in its head; the search, the
          // group and the archive are the bar's on a desk and the dock's on a
          // phone, where the one thing this page makes is its round button.
          phone ? undefined : (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus />
              Add contract
            </Button>
          )
        }
      />

      <Fab label="Add contract" onClick={() => setAdding(true)} />
      <DockTools
        search={{
          value: search,
          onChange: setSearch,
          label: "Search contracts",
        }}
        filter={{
          count: view.group === undefined ? 0 : 1,
          onOpen: () => setFiltering(true),
        }}
        status={{
          value: archived ? "ARCHIVED" : "LIVE",
          options: [
            { value: "LIVE", label: "Active" },
            { value: "ARCHIVED", label: "Archived" },
          ],
          onChange: (next) => setArchived(next === "ARCHIVED"),
        }}
      />
      <Suspense
        fallback={
          <>
            <ContractBar
              search={search}
              setSearch={setSearch}
              archived={archived}
              setArchived={setArchived}
            />
            <LoadingState>Loading contracts…</LoadingState>
          </>
        }
      >
        <ContractRegister
          view={view}
          chip={chip}
          archived={archived}
          setArchived={setArchived}
          search={search}
          setSearch={setSearch}
          needle={needle}
          filtering={filtering}
          setFiltering={setFiltering}
          onOpen={open.open}
          onAdd={() => setAdding(true)}
        />
      </Suspense>

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

/// The search at the left, the archive switch and the tally at the right.
function ContractBar({
  search,
  setSearch,
  archived,
  setArchived,
  total,
}: {
  search: string
  setSearch: (search: string) => void
  archived: boolean
  setArchived: (archived: boolean) => void
  /// Every contract the reading matches, once the register has said.
  total?: number
}) {
  return (
    <div className="group/bar mb-3.5 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
      <ExpandingSearch
        value={search}
        onChange={setSearch}
        label="Search contracts"
      />
      <BarSpacer />
      <Segmented
        options={[
          { value: "LIVE" as const, label: "Active" },
          { value: "ARCHIVED" as const, label: "Archived" },
        ]}
        value={archived ? "ARCHIVED" : "LIVE"}
        onChange={(next) => setArchived(next === "ARCHIVED")}
      />
      {total !== undefined && (
        <span className="text-meta text-body">
          <b className="font-medium text-ink">{count(total)}</b>{" "}
          {total === 1 ? "contract" : "contracts"}
        </span>
      )}
    </div>
  )
}

/// The register and everything drawn from its answer: the filter sheet, the
/// figures, the tabs with their counts and the rows. The page's head and its
/// dock stand outside, so they paint before the answer arrives.
function ContractRegister({
  view,
  chip,
  archived,
  setArchived,
  search,
  setSearch,
  needle,
  filtering,
  setFiltering,
  onOpen,
  onAdd,
}: {
  view: Reading
  chip: ReturnType<typeof useSheet<"contract-group">>
  archived: boolean
  setArchived: (archived: boolean) => void
  search: string
  setSearch: (search: string) => void
  /// The search once the typing has stopped: what the server is asked.
  needle: string
  filtering: boolean
  setFiltering: (open: boolean) => void
  onOpen: (contractId: string) => void
  onAdd: () => void
}) {
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

  /// The register, a page at a time as its foot nears view. Read for the scope
  /// as it was a moment ago while a new one is on its way: the rows stay on
  /// screen instead of the register emptying to a loading line on every
  /// search.
  const asked = useDeferredValue(scope)
  const register = useSuspenseInfiniteQuery(
    gaContractBookQuery(asked, view.kind)
  )

  const rows = useMemo(
    () => register.data.pages.flatMap((page) => page.rows),
    [register.data]
  )
  const head = register.data.pages[0]

  return (
    <>
      <FilterSheet
        open={filtering}
        onOpenChange={setFiltering}
        groups={[
          {
            key: "group",
            label: "Group",
            value: view.group ?? null,
            options: [
              {
                value: null,
                label: "All",
                count: (head?.facets.groups ?? []).reduce(
                  (sum, one) => sum + one.count,
                  0
                ),
              },
              ...CONTRACT_GROUPS.map((group) => ({
                value: group.group_code as string | null,
                label: group.label,
                count:
                  (head?.facets.groups ?? []).find(
                    (one) => one.value === group.group_code
                  )?.count ?? 0,
              })),
            ],
            onChange: (next) =>
              next === null ? chip.close() : chip.replace(next),
          },
        ]}
      />

      {head !== undefined && (
        <SummaryStrip summary={head.summary} total={head.total} view={view} />
      )}

      {/* The groups are the page's tabs: one register, read through six doors
          (the phone has them in the dock's Filter sheet). */}
      <SubTabs
        className="max-md:hidden"
        tabs={[
          {
            value: "ALL",
            label: (
              <span>
                All
                <span className="ml-1.5 text-body tabular-nums">
                  {count(
                    (head?.facets.groups ?? []).reduce(
                      (sum, one) => sum + one.count,
                      0
                    )
                  )}
                </span>
              </span>
            ),
          },
          ...CONTRACT_GROUPS.map((group) => ({
            value: group.group_code as string,
            label: (
              <span>
                {group.label}
                <span className="ml-1.5 text-body tabular-nums">
                  {count(
                    (head?.facets.groups ?? []).find(
                      (one) => one.value === group.group_code
                    )?.count ?? 0
                  )}
                </span>
              </span>
            ),
          })),
        ]}
        value={view.group ?? "ALL"}
        onChange={(next) =>
          next === "ALL" ? chip.close() : chip.replace(next)
        }
      />

      {/* One bar: the search at the left, the archive switch and the tally at
          the right. */}
      <ContractBar
        search={search}
        setSearch={setSearch}
        archived={archived}
        setArchived={setArchived}
        total={head?.total}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            action={
              <Button variant="ghost" onClick={onAdd}>
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
          onOpen={onOpen}
          more={register}
        />
      )}
    </>
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
  const phone = useLayout() === "phone"
  const partyName = useContractParty()
  if (phone) {
    const spec: CardSpec<GaContractRow> =
      view.kind === "utilities"
        ? {
            title: (row) => (
              <CardName name={partyName(row)} code={row.customer_number} />
            ),
            meta: [(row) => `${row.contract_type_name} · ${siteOf(row)}`],
            lead: (row) => (
              <CardFigure
                value={
                  <span title={money(row.billed_minor)}>
                    {moneyCompact(row.billed_minor)}
                  </span>
                }
                caption="Billed"
              />
            ),
            foot: (row) =>
              row.last_usage === null
                ? "No reading yet"
                : `${count(row.last_usage)} ${row.last_unit} · ${monthLabel(row.last_usage_period)}`,
            action: (row) => <StandingPill row={row} />,
          }
        : {
            title: (row) => (
              <CardName name={partyName(row)} code={row.contract_number} />
            ),
            meta: [
              (row) =>
                `${row.contract_type_name}${
                  row.objek_name === null ? "" : ` · ${row.objek_name}`
                } · ${siteOf(row)}`,
              (row) =>
                row.remaining_minor === null
                  ? null
                  : `${moneyCompact(row.billed_minor)} ${
                      view.group === "DISEWAKAN" ? "received" : "billed"
                    } · ${moneyCompact(row.remaining_minor)} left`,
            ],
            lead: (row) => (
              <CardFigure
                value={
                  <span title={money(row.contract_value_minor)}>
                    {moneyCompact(row.contract_value_minor)}
                  </span>
                }
                caption="Contract value"
              />
            ),
            foot: (row) => (
              <span className="tabular-nums">
                {span(row.starts_on, row.ends_on)}
              </span>
            ),
            action: (row) => <StandingPill row={row} />,
          }
    return (
      <PhoneCards
        rows={rows}
        rowId={(row) => row.contract_id}
        spec={spec}
        onOpen={(row) => onOpen(row.contract_id)}
        more={more}
      />
    )
  }
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
  const partyName = useContractParty()
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
          {partyName(row)}
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
  const partyName = useContractParty()
  return (
    <div
      onClick={() => onOpen(row.contract_id)}
      className="grid cursor-pointer grid-cols-[minmax(13rem,1fr)_6.5rem_10rem_9rem_10rem_9rem] items-center gap-3 border-b border-hairline px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-soft"
    >
      <div className="min-w-0">
        <span className="block truncate text-cell font-medium text-ink">
          {partyName(row)}
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
