import {
  queryOptions,
  useQuery,
  useSuspenseInfiniteQuery,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Plus } from "lucide-react"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { BarSpacer, ColumnsMenu } from "@/components/ui/list-chrome"
import { ListFilters } from "@/components/ui/list-filters"
import { PageHeader } from "@/components/ui/page-header"
import {
  CardFigure,
  CardName,
  type CardSpec,
  PhoneCards,
} from "@/components/ui/phone-cards"
import { Status } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import {
  useFilterState,
  type Filter,
  type FilterField,
  type FilterState,
} from "@/lib/filters"
import { count, day, money, moneyCompact } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { gaContractBookQuery, gaContracts, gaKeys } from "@/lib/queries/ga"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { ContractComposer } from "@/screens/contracts/composer"
import {
  siteOf,
  standingOf,
  useContractParty,
} from "@/screens/contracts/format"
import {
  CONTRACT_GROUPS,
  type ContractGroupCode,
} from "@/screens/contracts/groups"
import { ContractHubSheet } from "@/screens/contracts/hub"
import { StandingPill } from "@/screens/contracts/parts"
import { useFittedVisibility } from "@/screens/procurement/shared"
import type { GaContractRow } from "@itulah/contract"

/// The contract register — every deal behind the bills, on one screen.
///
/// # The list format, as Purchase Orders draws it
///
/// Head, figures, tabs, one bar, a framed table (owner, 17 Oct 2026, option A
/// of `contracts-options.html`). It replaced seven group tabs (zeros and all),
/// an Active/Archived switch in the bar and an eight-column grid that scrolled
/// sideways inside its card at 1440.
///
/// - The tabs are the two datasets: Active, and Ended. "Archived" was the
///   filing, not the state a contract is in (owner, 17 Oct).
/// - The six groups are the Group menu; the value still rides in
///   `?contract-group=`, so a link to one group is still a link somebody can
///   send, and the composer opens on that group.
/// - "Due for renewal" is a switch beside them, because finding what runs out
///   next is the job this register is opened for (owner, 17 Oct: "biar mudah
///   nyarinya"). Pressing the figure turns the same switch on.
/// - The type has a column of its own (owner, 17 Oct: "kontrak ini ga ada
///   jenisnya ya?"); where the contract applies rides under the party.
/// - Billed waits behind Columns. It is Finance's figure, read from posted
///   bill lines, and it reads zero until those lines can point at a contract.
///
/// # What the figures count
///
/// The living register, whatever the bar narrows to: the figures describe the
/// register, the tab counts and the foot describe the list (as Assets does).
/// The server counts them over every contract, not over the pages loaded.
export function Contracts() {
  // The group, the place and the renewal switch are filters in the address
  // bar, the way Purchase Orders keeps them.
  const state = useFilterState(FIELDS)
  const held = (column: string) =>
    state.filters.find((one) => one.column === column)?.values[0] ?? null
  const group = CONTRACT_GROUPS.find((one) => one.group_code === held("group"))
    ?.group_code as ContractGroupCode | undefined
  const due = held("due") === "true"
  const site = held("site")
  const open = useSheet("contract")
  const [shelf, setShelf] = useState<Shelf>("LIVE")
  const [search, setSearch] = useState("")
  const [adding, setAdding] = useState(false)
  const phone = useLayout() === "phone"
  // The search goes to the server, so it waits for the typing to stop.
  const needle = useDebounced(search.trim(), 300)

  const narrow = useMemo<Narrow>(
    () => ({
      q: needle === "" ? undefined : needle,
      group,
      site: site ?? undefined,
    }),
    [needle, group, site]
  )

  return (
    <PageContent>
      <PageHeader
        title="Contracts"
        small
        actions={
          // On a phone the one thing this page makes is its round button.
          phone ? undefined : (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus />
              Add contract
            </Button>
          )
        }
      />

      <Fab label="Add contract" onClick={() => setAdding(true)} />

      <Figures
        onDue={() => {
          setShelf("LIVE")
          state.set([
            ...state.filters.filter((one) => one.column !== "due"),
            { column: "due", operator: "is", values: ["true"] } as Filter,
          ])
        }}
      />

      <Suspense fallback={<LoadingState>Loading contracts…</LoadingState>}>
        <ContractRegister
          narrow={narrow}
          state={state}
          due={due}
          shelf={shelf}
          setShelf={setShelf}
          search={search}
          setSearch={setSearch}
          phone={phone}
          selected={open.value}
          onOpen={open.open}
          onAdd={() => setAdding(true)}
        />
      </Suspense>

      {/* Keyed per group and per record: the composer re-arms on the group it
          is opened from, and the hub drops its end-contract question whenever
          another contract opens. */}
      <ContractComposer
        key={group ?? "all"}
        open={adding}
        group={group ?? ""}
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

/// The two datasets: the living register, and the contracts that have ended.
type Shelf = "LIVE" | "ENDED"

/// What the bar narrows by, before the tab and the switch.
interface Narrow {
  readonly q?: string
  readonly group?: string
  readonly site?: string
}

type ContractScope = Parameters<typeof gaContractBookQuery>[0]

/// The server's own words for "due": inside the reminder days, or past the end.
/// What the register is narrowed by. The group is the chip line; the place is
/// found by name in the search box; the renewal switch is the Active tab's.
const FIELDS: FilterField[] = [
  {
    column: "group",
    label: "Group",
    spec: {
      kind: "option",
      single: true,
      format: (value) =>
        CONTRACT_GROUPS.find((one) => one.group_code === value)?.label ?? value,
      icon: (value) =>
        CONTRACT_GROUPS.find((one) => one.group_code === value)?.icon,
    },
  },
  { column: "site", label: "Location", spec: { kind: "option", single: true } },
  { column: "due", label: "Due for renewal", spec: { kind: "boolean" } },
]

const DUE_STANDINGS = "SEGERA_HABIS,HABIS"

/// One count, asked as a page of one row: the server's `total` and `summary`
/// are the answer. Its own key under the register's prefix, so a save that
/// invalidates the register refreshes the counts with it.
const contractCount = (scope: ContractScope) =>
  queryOptions({
    queryKey: [...gaKeys.contracts(scope), "count"] as const,
    queryFn: ({ signal }) => gaContracts({ ...scope, limit: 1 }, signal),
  })

/// The figures over the register. They do not hold the page up while they are
/// read.
function Figures({ onDue }: { onDue: () => void }) {
  const living = useQuery(contractCount({ archived: false }))
  const summary = living.data?.summary
  const figure = (n: number | undefined) => (n === undefined ? "—" : count(n))
  const dueCount = summary?.due_for_renewal
  const value = summary?.active_value_minor
  return (
    <KpiStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-3">
      <Kpi label="Contracts" value={figure(living.data?.total)} />
      <Kpi
        label="Due for renewal"
        value={
          dueCount !== undefined && dueCount > 0 ? (
            <span className="text-warn-fg">{count(dueCount)}</span>
          ) : (
            figure(dueCount)
          )
        }
        onClick={onDue}
      />
      <Kpi
        label="Contract value"
        value={value === undefined ? "—" : moneyCompact(value)}
        title={value === undefined ? undefined : money(value)}
      />
    </KpiStrip>
  )
}

/// A row of the table: the contract, with its place in words.
///
/// Looked up once on the row rather than in the cell: a column sorts by what
/// is on the screen.
interface ContractLine {
  readonly contract: GaContractRow
  readonly party: string
  /// "Store 01", "DC", "All stores": the site by the name the facets give it.
  readonly place: string
}

/// Columns a reader switches on in Columns; off at first.
const OFF_AT_FIRST = { billed: false }

/// Held at the widths their longest words need at 16px a side ("Expires in
/// 44 days" with its dot and the › a row shows under the pointer, "Rp
/// 1.350.000.000", "Sewa toko/gudang/kantor"), measured on the hub at 1440 and
/// 1280 (17 Oct): the contract takes the rest, about 216px at 1280, and the
/// table never scrolls sideways.
const COLUMNS: ColumnDef<TableSetup, ContractLine>[] = [
  {
    id: "contract",
    accessorFn: (row) => row.party,
    header: "Contract",
    size: 320,
    meta: { grow: 180 },
    // The party, and under it the paper's number and where the deal applies:
    // one quiet line, the only second line in the row. A subscription has no
    // paper number worth reading; its customer number is what the bill says.
    cell: ({ row }) => {
      const { contract, party, place } = row.original
      const number =
        contract.group_code === "LANGGANAN"
          ? (contract.customer_number ?? contract.contract_number)
          : contract.contract_number
      const quiet = [number, place].filter(Boolean).join(" · ")
      return (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-ink" title={party}>
            {party}
          </span>
          <span className="truncate text-mute" title={quiet}>
            {quiet}
          </span>
        </span>
      )
    },
  },
  {
    id: "type",
    accessorFn: (row) => row.contract.contract_type_name,
    header: "Type",
    size: 216,
    cell: ({ row }) => (
      <span
        className="block truncate"
        title={row.original.contract.contract_type_name}
      >
        {row.original.contract.contract_type_name}
      </span>
    ),
  },
  {
    id: "ends",
    // A contract with no end sorts after every date.
    accessorFn: (row) => row.contract.ends_on ?? "9999-12-31",
    header: "Ends",
    size: 124,
    cell: ({ row }) =>
      row.original.contract.ends_on === null ? (
        <span className="text-mute">No end date</span>
      ) : (
        <span className="tabular-nums">
          {day(row.original.contract.ends_on)}
        </span>
      ),
  },
  {
    id: "value",
    accessorFn: (row) => row.contract.contract_value_minor ?? -1,
    header: "Value",
    size: 160,
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.contract.contract_value_minor === null ? (
        <span className="text-mute">—</span>
      ) : (
        <span className="tabular-nums">
          {money(row.original.contract.contract_value_minor)}
        </span>
      ),
  },
  {
    // Finance's figure, read from posted bill lines. Off at first.
    id: "billed",
    accessorFn: (row) => row.contract.billed_minor,
    header: "Billed",
    size: 164,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        {money(row.original.contract.billed_minor)}
      </span>
    ),
  },
  {
    id: "status",
    accessorFn: (row) => standingOf(row.contract).word,
    header: "Status",
    size: 200,
    cell: ({ row }) => {
      const standing = standingOf(row.original.contract)
      return <Status tone={standing.tone}>{standing.word}</Status>
    },
  },
]

/// The living list reads what runs out next first; the ended list, what ended
/// last.
const sortFor = (shelf: Shelf): SortingState => [
  { id: "ends", desc: shelf === "ENDED" },
]

function ContractRegister({
  narrow,
  state,
  shelf,
  setShelf,
  due,
  search,
  setSearch,
  phone,
  selected,
  onOpen,
  onAdd,
}: {
  narrow: Narrow
  state: FilterState
  shelf: Shelf
  setShelf: (shelf: Shelf) => void
  due: boolean
  search: string
  setSearch: (search: string) => void
  phone: boolean
  selected: string | undefined
  onOpen: (contractId: string) => void
  onAdd: () => void
}) {
  const dueOn = due && shelf === "LIVE"
  const scope = useMemo<ContractScope>(
    () => ({
      ...narrow,
      archived: shelf === "ENDED",
      standing: dueOn ? DUE_STANDINGS : undefined,
    }),
    [narrow, shelf, dueOn]
  )
  // The list being replaced stays on screen while the next is read, so a
  // keystroke or a tab does not empty the table to a loading line.
  const asked = useDeferredValue(scope)
  const register = useSuspenseInfiniteQuery(gaContractBookQuery(asked))
  const head = register.data.pages[0]

  // The tab counts and the switch's: over what the bar leaves, before the tab.
  // Until they are read, the open tab borrows the register's own total, and a
  // count not known yet is not drawn rather than drawn as a zero.
  const living = useQuery(contractCount({ ...narrow, archived: false }))
  const ended = useQuery(contractCount({ ...narrow, archived: true }))
  const own = dueOn ? undefined : head?.total
  const liveCount = living.data?.total ?? (shelf === "LIVE" ? own : undefined)
  const endedCount = ended.data?.total ?? (shelf === "ENDED" ? own : undefined)
  const dueCount =
    living.data?.summary.due_for_renewal ??
    (shelf === "LIVE" && !dueOn ? head?.summary.due_for_renewal : undefined)

  const partyName = useContractParty()
  const sites = useMemo(() => head?.facets.sites ?? [], [head])
  const rows = useMemo<ContractLine[]>(() => {
    const names = new Map(
      sites.map((one) => [one.value, one.label ?? one.value])
    )
    return register.data.pages.flatMap((page) =>
      page.rows.map((contract) => ({
        contract,
        party: partyName(contract),
        place:
          contract.site_id === null
            ? siteOf(contract)
            : (names.get(contract.site_id) ?? contract.site_id),
      }))
    )
    // `partyName` is rebuilt every render; the names it reads are not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register.data, sites])

  // Each tab opens on its own order, however the tab was changed (the tabs,
  // the dock, or the Due for renewal figure).
  const [sorting, setSorting] = useState<SortingState>(() => sortFor(shelf))
  const [sortedFor, setSortedFor] = useState(shelf)
  if (sortedFor !== shelf) {
    setSortedFor(shelf)
    setSorting(sortFor(shelf))
  }
  const chooseShelf = (next: Shelf) => setShelf(next)
  /// What fits the card: Billed waits behind Columns.
  const fit = useFittedVisibility(COLUMNS, OFF_AT_FIRST)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: COLUMNS,
        getRowId: (row: ContractLine) => row.contract.contract_id,
        state: { sorting, columnVisibility: fit.shown },
        onSortingChange: setSorting,
        onColumnVisibilityChange: fit.change,
      }),
      // `fit.shown` is rebuilt every render; what it is made of is not.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [rows, sorting, fit.hidden, fit.visibility]
    )
  )

  const narrowed =
    narrow.q !== undefined ||
    narrow.group !== undefined ||
    narrow.site !== undefined

  // Leased out is the one group where the money flows IN: across the groups
  // the foot leaves it out, as the server's figures do, because a sum of both
  // directions is a number nobody can use. Chosen on its own, it is the sum.
  const counted = rows.filter(
    (row) =>
      narrow.group === "DISEWAKAN" || row.contract.group_code !== "DISEWAKAN"
  )
  const total = head?.total ?? rows.length

  // What each group holds, from the server's facets: they count the searched
  // set, so a number stays put while another chip is on.
  const held = new Map(
    (head?.facets.groups ?? []).map((one) => [one.value, one.count])
  )
  const siteWords = new Map(sites.map((one) => [one.value, one.label]))
  const fields = useMemo<FilterField[]>(
    () =>
      FIELDS.filter((field) => field.column !== "due" || shelf === "LIVE").map(
        (field) =>
          field.column === "group"
            ? {
                ...field,
                spec: {
                  ...field.spec,
                  counted: CONTRACT_GROUPS.map((one) => ({
                    value: one.group_code,
                    count: held.get(one.group_code) ?? 0,
                  })),
                },
              }
            : field.column === "site"
              ? {
                  ...field,
                  spec: {
                    ...field.spec,
                    format: (value: string) => siteWords.get(value) ?? value,
                    counted: sites.map((one) => ({
                      value: one.value,
                      count: one.count,
                    })),
                  },
                }
              : field
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [head, shelf]
  )
  const model: FilterState = { ...state, fields }

  return (
    <>
      <SubTabs
        // On a phone the tab is the status chip over the bottom bar.
        className="max-md:hidden"
        tabs={[
          { value: "LIVE", label: <TabLabel text="Active" n={liveCount} /> },
          { value: "ENDED", label: <TabLabel text="Ended" n={endedCount} /> },
        ]}
        value={shelf}
        onChange={(next) => chooseShelf(next as Shelf)}
      />

      {/* One bar: the search (which also finds a place) and the switch that
          finds what needs renewing, then Columns at the right; the six
          groups take the line under it. On a phone they are the dock's. */}
      <div className="max-md:hidden">
        <Toolbar className="group/bar">
          <ListFilters
            model={model}
            search={{
              value: search,
              onChange: setSearch,
              label: "Search contracts",
            }}
          />
          <BarSpacer />
          <ColumnsMenu table={table} />
        </Toolbar>
      </div>

      <DockTools
        search={{
          value: search,
          onChange: setSearch,
          label: "Search contracts",
        }}
        filter={{
          count: model.filters.filter((one) =>
            model.fields.some((field) => field.column === one.column)
          ).length,
          panel: { model: state, filterModel: model },
        }}
        status={{
          value: shelf,
          options: [
            { value: "LIVE", label: "Active", count: liveCount },
            { value: "ENDED", label: "Ended", count: endedCount },
          ],
          onChange: (next) => chooseShelf(next as Shelf),
        }}
      />

      <div aria-busy={asked !== scope || undefined} className="list-swap">
        {rows.length === 0 ? (
          <Card>
            <EmptyState
              action={
                narrowed || dueOn || shelf === "ENDED" ? undefined : (
                  <Button variant="ghost" onClick={onAdd}>
                    Record the first one
                  </Button>
                )
              }
            >
              {dueOn && !narrowed
                ? "Nothing is due for renewal."
                : narrowed || dueOn
                  ? "No contract matches these filters."
                  : shelf === "ENDED"
                    ? "No contract has ended yet."
                    : "Nothing here yet."}
            </EmptyState>
          </Card>
        ) : phone ? (
          <PhoneCards
            rows={rows}
            rowId={(row) => row.contract.contract_id}
            spec={CONTRACT_CARD}
            onOpen={(row) => onOpen(row.contract.contract_id)}
            more={register}
          />
        ) : (
          // `overflow-clip`, not `overflow-hidden`: hidden makes the card a
          // scroll box, and the heading would stick to the card instead of
          // the window.
          <Card ref={fit.ref} className="overflow-clip">
            <DataTable<ContractLine>
              refresh={[register]}
              table={table}
              onRowClick={(row) => onOpen(row.contract.contract_id)}
              isSelected={(row) => row.contract.contract_id === selected}
              more={register}
              // The window scrolls, not the table.
              pageScroll
              summary={{
                contract: (
                  <span>
                    {count(total)}{" "}
                    <span className="font-normal text-body">
                      {total === 1 ? "contract" : "contracts"}
                    </span>
                  </span>
                ),
                value: (
                  <span className="tabular-nums">
                    {money(
                      counted.reduce(
                        (sum, row) =>
                          sum + (row.contract.contract_value_minor ?? 0),
                        0
                      )
                    )}
                  </span>
                ),
                billed: (
                  <span className="tabular-nums">
                    {money(
                      counted.reduce(
                        (sum, row) => sum + row.contract.billed_minor,
                        0
                      )
                    )}
                  </span>
                ),
              }}
            />
          </Card>
        )}
      </div>
    </>
  )
}

/// A tab's word and its count, the count quiet (as Articles draws it). A
/// count still being read is left out.
function TabLabel({ text, n }: { text: string; n: number | undefined }) {
  return (
    <span>
      {text}
      {n !== undefined && (
        <span className="ml-1.5 text-body tabular-nums">{count(n)}</span>
      )}
    </span>
  )
}

/// The same row as a phone card: the party and its number, the type and the
/// place; the value as the lead, the end date in the foot and the status
/// where the thumb rests.
const CONTRACT_CARD: CardSpec<ContractLine> = {
  title: (row) => (
    <CardName name={row.party} code={row.contract.contract_number} />
  ),
  meta: [(row) => `${row.contract.contract_type_name} · ${row.place}`],
  lead: (row) => (
    <CardFigure
      value={
        row.contract.contract_value_minor === null ? (
          "—"
        ) : (
          <span title={money(row.contract.contract_value_minor)}>
            {moneyCompact(row.contract.contract_value_minor)}
          </span>
        )
      }
      caption="Value"
    />
  ),
  foot: (row) =>
    row.contract.ends_on === null ? (
      "No end date"
    ) : (
      <span className="tabular-nums">Ends {day(row.contract.ends_on)}</span>
    ),
  action: (row) => <StandingPill row={row.contract} />,
}
