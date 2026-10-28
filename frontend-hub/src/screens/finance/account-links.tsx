import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type {
  ColumnDef,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DockTools } from "@/components/shell/dock-tools"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { SwitchPill } from "@/components/ui/form"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { BarSpacer, ColumnsMenu } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, LoadMore, Problem } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { count, label, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { problemOf } from "@/lib/problem"
import {
  accountLinkHistory,
  accountLinksQuery,
  financeKeys,
  postingReadinessQuery,
  removeAccountLink,
  setAccountLink,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { useFilters } from "@/lib/filters"
import { tableSetup, type TableSetup } from "@/lib/table"
import { usePostingReadiness } from "@/screens/finance/badges"
import { useCategoryName, useUnitName } from "@/screens/finance/hooks"
import {
  SOURCE_TYPES,
  decodeLinkSource,
  sourceTypeLabel,
  sourceWords,
  type LinkSource,
} from "@/screens/finance/master-data"
import { SourceIdPicker } from "@/screens/finance/master-parts"
import {
  AccountAndCategory,
  UnitSelect,
  accountChoiceProblem,
  accountChoiceReady,
  type AccountChoice,
} from "@/screens/finance/parts"
import { ScreenPending } from "@/screens/finance/pending"
import { slotsOfRole } from "@/screens/finance/coa-slots"
import { ItemAccounts, SettingCoa } from "@/screens/finance/setting-coa"
import { ApiError } from "@itulah/contract/client"
import type {
  AccountLink,
  AccountLinkPage,
  PostingReadiness,
  ReadinessRow,
  SemanticKeyDoc,
} from "@itulah/contract"

/// Which account answers to each posting role, and for whom.
///
/// # Why links and not a map
///
/// A posting rule names a ROLE — `trade_payable` — and the client's chart has
/// an account. The old map wrote that decision out once per site, 8,330 rows
/// for about six hundred decisions. A link holds for a scope instead: every
/// unit, one kind of unit, or one unit — the books are a unit's since 0605 —
/// and the most specific one wins. So a fifteenth store inherits every link
/// that holds for all stores, and the exception is one row sitting under the
/// rule it overrides.
///
/// # Why the gaps come from the server
///
/// "Does this role reach an account in this unit's books" is answered by the
/// database's own resolution (`account_resolution`), and the readiness matrix
/// is that answer laid out. Working it out again here from the links would be
/// a second opinion about the one thing that decides whether a posting is
/// refused.
///
/// # Why removing a link can be refused
///
/// A link that looks unused may be the only thing deciding three stores. The
/// server names those units and refuses; "Remove anyway" is for the day
/// somebody means exactly that.
///
/// # Why a source
///
/// A decision is kept somewhere: the company's own default, or a master
/// record — an expense category, a pay component, a payment method, a
/// withholding template, a party. Every master screen's "Link accounts" lands
/// here with `?linkSource=TYPE:id`, which narrows the roles to the ones that
/// record already answers and fills the source in on the add form.

interface RoleRow {
  readonly key: string
  readonly label: string
  readonly needed_for: string
  readonly qualified: boolean
  readonly links: number
  readonly gaps: number
}

const columns: ColumnDef<TableSetup, RoleRow>[] = [
  {
    accessorKey: "label",
    header: "Role",
    size: 260,
    meta: { card: "hide" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.label}</span>
    ),
  },
  {
    accessorKey: "key",
    header: "Key",
    size: 210,
    meta: { card: "hide" },
    cell: ({ row }) => <Tag>{row.original.key}</Tag>,
  },
  {
    accessorKey: "needed_for",
    header: "Needed for",
    size: 240,
    // What a gap COSTS — the column somebody fixing payables before month end
    // filters on.
    meta: { card: "hide", filter: { kind: "option" } },
    cell: ({ row }) => (
      <span className="text-body">{row.original.needed_for}</span>
    ),
  },
  {
    accessorKey: "links",
    header: "Links",
    size: 100,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) => (
      <span className="text-body tabular-nums">
        {count(row.original.links)}
      </span>
    ),
  },
  {
    accessorKey: "gaps",
    header: "Gaps",
    size: 110,
    meta: {
      align: "right",
      card: "hide",
      filter: { kind: "number", unit: "units" },
    },
    cell: ({ row }) =>
      row.original.gaps === 0 ? (
        <span className="text-ok-fg">None</span>
      ) : (
        <span className="font-medium text-bad-fg tabular-nums">
          {count(row.original.gaps)}
        </span>
      ),
  },
  // Three columns that exist only on a card (a phone): the role over its key,
  // the gaps it leads with, and what a gap would cost.
  {
    id: "head",
    accessorFn: (row) => `${row.label} ${row.key}`,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[1rem] font-semibold break-words text-ink">
          {row.original.label}
        </span>
        <span className="font-mono text-[0.9375rem] font-normal break-all text-mute">
          {row.original.key}
        </span>
      </span>
    ),
  },
  {
    id: "lead",
    accessorFn: (row) => row.gaps,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "lead" },
    cell: ({ row }) => (
      <span className="flex flex-col items-end tabular-nums">
        <span
          className={
            row.original.gaps === 0
              ? "text-[1.5rem] leading-tight font-semibold tracking-tight text-mute"
              : "text-[1.5rem] leading-tight font-semibold tracking-tight text-bad-fg"
          }
        >
          {row.original.gaps === 0 ? "None" : count(row.original.gaps)}
        </span>
        <span className="text-[0.9375rem] text-mute">
          {row.original.gaps === 1 ? "gap" : "gaps"}
        </span>
      </span>
    ),
  },
  {
    id: "foot",
    accessorFn: (row) => row.needed_for,
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    cell: ({ row }) => (
      <span className="flex flex-col gap-0.5 leading-6">
        <span>{row.original.needed_for}</span>
        <span>
          {count(row.original.links)}{" "}
          {row.original.links === 1 ? "link" : "links"}
        </span>
      </span>
    ),
  },
]

/// A link's scope, as a person says it: `ALL`, a `UNIT_KIND` (`HO`, `STORE`,
/// `ONLINE`) or one `UNIT`.
function scopeWords(
  scopeType: string,
  scopeKey: string,
  unitName: (id: string) => string
): string {
  if (scopeType === "ALL") return "All units"
  if (scopeType === "UNIT_KIND") {
    if (scopeKey === "STORE") return "All stores"
    if (scopeKey === "HO") return "Head office"
    if (scopeKey === "ONLINE") return "Online"
    return label(scopeKey)
  }
  return unitName(scopeKey)
}

function sameSource(
  row: { source_type: string; source_id: string },
  source: LinkSource
): boolean {
  return (
    row.source_type === source.source_type && row.source_id === source.source_id
  )
}

/// One group in a role's sheet: a (source type, source id) pair.
function sourceKey(row: { source_type: string; source_id: string }): string {
  return `${row.source_type}\t${row.source_id}`
}

function useLinkPage() {
  return useQuery(accountLinksQuery())
}

/// Every role the rules name, plus any role a link names that the rules no
/// longer ask for — a link nobody needs is still a link somebody can remove.
function roleRows(
  page: AccountLinkPage,
  readiness: PostingReadiness | undefined
): RoleRow[] {
  const docs = new Map<string, SemanticKeyDoc>()
  for (const doc of page.roles) docs.set(doc.key, doc)
  const keys = [...page.roles.map((doc) => doc.key)]
  for (const link of page.rows)
    if (!keys.includes(link.role)) keys.push(link.role)
  return keys.map((key) => {
    const doc = docs.get(key)
    return {
      key,
      label: doc?.label ?? label(key),
      needed_for: doc?.needed_for ?? "—",
      qualified: doc?.qualified ?? false,
      links: page.rows.filter((link) => link.role === key).length,
      gaps: (readiness?.rows ?? [])
        .filter((row) => row.role === key)
        .reduce((sum, row) => sum + row.gaps, 0),
    }
  })
}

export function AccountLinks() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Master" title="Setting COA">
          Loading the links…
        </ScreenPending>
      }
    >
      <AccountLinksScreen />
    </Suspense>
  )
}

function AccountLinksScreen() {
  const phone = useLayout() === "phone"
  const [query, setQuery] = useState("")
  const [onlyGaps, setOnlyGaps] = useState(false)
  const mapping = useSheet("mapping")
  const linkSource = useSheet("linkSource")
  const preset = decodeLinkSource(linkSource.value)
  // 7Soft's 23 slots first; the hub's own list of posting roles beside it. A
  // master's "Link accounts" arrives with a source, which is a roles question.
  const [tab, setTab] = useState(preset === null ? "slots" : "roles")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "gaps", desc: true },
  ])
  const [visibility, setVisibility] = useState<VisibilityState>({})

  const page = useSuspenseQuery(accountLinksQuery())
  const readiness = useSuspenseQuery(postingReadinessQuery())

  // The roles the narrowed-to source already answers. Empty means the record
  // has no link at all yet, and then every role is offered: which one it
  // should answer is exactly what somebody came here to decide.
  const presetRoles = useMemo(() => {
    if (preset === null || page.data === undefined) return null
    const roles = new Set<string>()
    for (const link of page.data.rows)
      if (sameSource(link, preset)) roles.add(link.role)
    for (const row of readiness.data?.rows ?? [])
      if (sameSource(row, preset)) roles.add(row.role)
    return roles
    // `preset` is rebuilt every render; its text is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkSource.value, page.data, readiness.data])

  const rows = useMemo<RoleRow[]>(() => {
    if (page.data === undefined) return []
    return roleRows(page.data, readiness.data).filter(
      (row) =>
        (!onlyGaps || row.gaps > 0) &&
        (presetRoles === null ||
          presetRoles.size === 0 ||
          presetRoles.has(row.key))
    )
  }, [page.data, readiness.data, onlyGaps, presetRoles])

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: RoleRow) => row.key,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: query,
          sorting,
          // The card's own columns are drawn on a phone and never on a desk.
          columnVisibility: {
            ...visibility,
            head: phone,
            lead: phone,
            foot: phone,
          },
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
        onColumnVisibilityChange: setVisibility,
      }),
      [
        rows,
        filters.columns,
        filters.columnFilters,
        query,
        sorting,
        phone,
        visibility,
      ]
    )
  )

  const gaps = page.data?.gaps ?? 0

  return (
    <PageContent>
      <PageHeader crumb="Finance · Master" title="Setting COA" />

      <SubTabs
        tabs={[
          { value: "slots", label: "Setting COA" },
          { value: "items", label: "Item · Account" },
          { value: "roles", label: "Posting roles" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "slots" && (
        <SettingCoa
          page={page.data}
          readiness={readiness.data}
          onOpenRole={(role) => mapping.open(role)}
        />
      )}

      {tab === "items" && (
        <ItemAccounts
          page={page.data}
          readiness={readiness.data}
          onOpenRole={(role) => mapping.open(role)}
        />
      )}

      {tab === "roles" && (
        <>
          {page.data && (
            <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
              <Kpi label="Roles" value={count(rows.length)} />
              <Kpi label="Links" value={count(page.data.total)} />
              <Kpi label="Units" value={count(page.data.locations.length)} />
              <Kpi label="Gaps" value={count(gaps)} />
            </KpiStrip>
          )}

          {preset !== null && presetRoles !== null && (
            <Banner tone="info" className="mb-3" onDismiss={linkSource.close}>
              {presetRoles.size === 0 ? (
                <>
                  {sourceWords(preset)} has no link yet, so every role is
                  listed. Open the role it should answer — the source is filled
                  in on the add form.
                </>
              ) : (
                <>
                  Showing the {count(presetRoles.size)}{" "}
                  {presetRoles.size === 1 ? "role" : "roles"} linked from{" "}
                  <span className="font-medium">{sourceWords(preset)}</span>.
                </>
              )}
            </Banner>
          )}

          {page.data && gaps > 0 && (
            <Banner tone="warn" className="mb-3">
              {count(gaps)} role-and-unit combinations reach no account. Every
              posting that needs one is refused, and the refusal names the role.{" "}
              <AppLink
                to="/finance/setup/posting-readiness"
                className="underline underline-offset-2"
              >
                See them on Posting readiness
              </AppLink>
            </Banner>
          )}

          {/* Search, the status, the filters and the order are the dock's on a
          phone. */}
          {phone ? (
            <DockTools
              search={{
                value: query,
                onChange: setQuery,
                label: "Search roles",
              }}
              filter={{
                count: filters.filters.length,
                panel: { model: filters, table },
              }}
              sort={dockSortOf(table)}
              status={{
                value: onlyGaps ? "gaps" : "all",
                options: [
                  { value: "all", label: "All roles" },
                  { value: "gaps", label: "With gaps" },
                ],
                onChange: (next) => setOnlyGaps(next === "gaps"),
              }}
            />
          ) : (
            <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2">
              <FilterPanel
                model={filters}
                table={table}
                search={{
                  value: query,
                  onChange: setQuery,
                  label: "Search roles",
                }}
              />
              <SwitchPill
                on={onlyGaps}
                label="Only roles with gaps"
                onToggle={() => setOnlyGaps(!onlyGaps)}
              />
              <BarSpacer />
              <span className="text-[0.9375rem] text-mute">
                {count(page.data?.total ?? 0)} links · {count(gaps)}{" "}
                role-and-unit gaps
                {onlyGaps ? " · showing only what is left" : ""}
              </span>
              <ColumnsMenu table={table} />
            </div>
          )}

          <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            {queryState(page, {
              render: () =>
                rows.length === 0 ? (
                  <EmptyState>
                    {onlyGaps
                      ? "Every role reaches an account in every unit. Nothing is left to do here."
                      : "The posting rules ask for no roles at all, which means none of them is loaded."}
                  </EmptyState>
                ) : (
                  <DataTable<RoleRow>
                    refresh={[page, readiness]}
                    table={table}
                    onRowClick={(row) => mapping.open(row.key)}
                    isSelected={(row) => row.key === mapping.value}
                    empty="No role matches the search and filters in force."
                    pageScroll
                    cardsApart
                    cardLead
                    cardSort={false}
                  />
                ),
            })}
          </Card>
        </>
      )}

      <RoleSheet
        role={mapping.value ?? null}
        preset={preset}
        onClose={mapping.close}
      />
    </PageContent>
  )
}

type ScopeChoice = "ALL" | "STORE" | "HO" | "UNIT"

/// One role: its links grouped by source, what each unit ends up on, and who
/// changed what.
/// How many link changes one page of a role's history asks for.
const HISTORY_PAGE = 30

function RoleSheet({
  role,
  preset,
  onClose,
}: {
  role: string | null
  /// The source the screen is narrowed to, filled in on the add form.
  preset: LinkSource | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const unitName = useUnitName()
  const page = useLinkPage()
  const readiness = usePostingReadiness()
  // A page at a time, read on as the sheet scrolls — it used to stop at the
  // last thirty changes with nothing saying so. The endpoint answers a bare
  // list, so a full page is the only sign of another, and its last
  // `history_id` is where the next one starts.
  const history = useInfiniteQuery({
    queryKey: [...financeKeys.accountLinkHistory(role), "pages"],
    queryFn: ({ pageParam, signal }) =>
      accountLinkHistory(role, signal, HISTORY_PAGE, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) =>
      last.length < HISTORY_PAGE
        ? undefined
        : last[last.length - 1]?.history_id,
    enabled: role !== null,
  })

  const refresh = () =>
    client.invalidateQueries({ queryKey: financeKeys.accountLinksAll })

  const doc = page.data?.roles.find((one) => one.key === role)
  const links = (page.data?.rows ?? []).filter((link) => link.role === role)
  const readinessRows = (readiness.data?.rows ?? []).filter(
    (row) => row.role === role
  )
  // Every (source type, source id) the role is decided from, the narrowed-to
  // one first so the reader lands on it.
  const groups = new Map<string, LinkSource>()
  for (const row of [...links, ...readinessRows])
    groups.set(sourceKey(row), {
      source_type: row.source_type,
      source_id: row.source_id,
    })
  const sources = [...groups.entries()]
    .sort(([a, first], [b, second]) => {
      if (preset !== null) {
        if (sameSource(first, preset) && !sameSource(second, preset)) return -1
        if (sameSource(second, preset) && !sameSource(first, preset)) return 1
      }
      return a.localeCompare(b)
    })
    .map(([, source]) => source)
  const showSource =
    doc?.qualified === true ||
    sources.some((one) => one.source_id !== "" || one.source_type !== "COMPANY")
  const suggestions = [
    ...new Set(
      sources
        .filter((one) => one.source_type === "COMPANY")
        .map((one) => one.source_id)
    ),
  ]

  return (
    <Sheet
      open={role !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={role ?? undefined}
      title={doc?.label ?? (role === null ? "Role" : label(role))}
      className="w-[36rem] max-md:w-full"
    >
      {queryState(page, {
        loading: "Loading the links…",
        render: () => (
          <div className="flex flex-col gap-5">
            {doc !== undefined ? (
              <div className="flex flex-col gap-2">
                {role !== null && slotsOfRole(role).length > 0 && (
                  <p className="text-[0.9375rem] text-body">
                    Setting COA:{" "}
                    <span className="font-medium text-ink">
                      {slotsOfRole(role).join(" · ")}
                    </span>
                  </p>
                )}
                <p className="text-[0.9375rem] text-body">
                  Without this, {doc.needed_for.toLowerCase()} stops working —
                  the posting is refused and names the role.
                </p>
                <p className="rounded-inner bg-soft px-3 py-2 text-[0.9375rem] text-body">
                  Expected to be{" "}
                  <span className="font-medium text-ink">{doc.expects}</span>
                </p>
                {doc.qualified && (
                  <Pill tone="info">
                    One account per source — a bank per bank, a class per class
                  </Pill>
                )}
                {doc.category_family !== null && (
                  <Pill tone="info">
                    Resolves to a category too — family{" "}
                    <span className="font-mono">{doc.category_family}</span>
                  </Pill>
                )}
              </div>
            ) : (
              <Banner tone="info">
                No posting rule asks for “{role}” any more. Its links still
                resolve, and can be removed.
              </Banner>
            )}

            {role !== null && (
              // Keyed so a choice made for one role, or for one source, never
              // carries over to another: a source chosen for `cash` saved
              // against `bank_giro` is the mistake this screen exists to
              // prevent.
              <AddLinkForm
                key={`${role}\t${preset === null ? "" : sourceKey(preset)}`}
                role={role}
                expects={doc?.expects}
                preset={preset}
                showSource={showSource}
                suggestions={suggestions}
                onSaved={refresh}
              />
            )}

            {sources.length === 0 ? (
              <p className="text-[0.9375rem] text-bad-fg">
                No link names this role. Every posting that needs it is refused
                in every unit.
              </p>
            ) : (
              sources.map((source) => {
                const ofSource = links.filter((link) =>
                  sameSource(link, source)
                )
                const resolved = readinessRows.find((row) =>
                  sameSource(row, source)
                )
                return (
                  <SourceGroup
                    key={sourceKey(source)}
                    source={source}
                    showSource={showSource}
                    highlighted={preset !== null && sameSource(source, preset)}
                    links={ofSource}
                    resolved={resolved}
                    unitName={unitName}
                    onChanged={refresh}
                  />
                )
              })
            )}

            <div>
              <h4 className="mb-2 text-card-title font-semibold text-ink">
                History
              </h4>
              {queryState(history, {
                loading: "Reading the history…",
                render: (data) => {
                  const changes = data.pages.flat()
                  return changes.length === 0 ? (
                    <p className="text-[0.9375rem] text-mute">
                      Nobody has changed these links since they were set.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {changes.map((change) => (
                        <div
                          key={change.history_id}
                          className="flex flex-wrap items-baseline gap-x-2 text-[0.9375rem]"
                        >
                          <span className="font-medium text-ink">
                            {label(change.action)}
                          </span>
                          <span className="text-body">
                            {change.source_id !== "" &&
                              `${change.source_id} · `}
                            {scopeWords(
                              change.scope_type,
                              change.scope_key,
                              unitName
                            )}
                          </span>
                          <span className="font-mono text-mute">
                            {change.old_account_code ?? "—"} →{" "}
                            {change.new_account_code ?? "—"}
                          </span>
                          <span className="ml-auto text-faint">
                            {change.changed_by} · {moment(change.changed_at)}
                          </span>
                          {change.note && (
                            <span className="w-full text-mute">
                              {change.note}
                            </span>
                          )}
                        </div>
                      ))}
                      {/* Inside the sheet's body, which is the box that
                          scrolls. */}
                      <LoadMore query={history} />
                    </div>
                  )
                },
              })}
            </div>
          </div>
        ),
      })}
    </Sheet>
  )
}

/// The "Add a link" row and its form.
///
/// Opens by itself when the screen arrived narrowed to a source: somebody who
/// pressed "Link accounts" on a category came to add exactly this.
function AddLinkForm({
  role,
  expects,
  preset,
  showSource,
  suggestions,
  onSaved,
}: {
  role: string
  expects: string | undefined
  preset: LinkSource | null
  showSource: boolean
  suggestions: readonly string[]
  onSaved: () => Promise<void>
}) {
  const [adding, setAdding] = useState(preset !== null)
  const [sourceType, setSourceType] = useState(preset?.source_type ?? "COMPANY")
  const [source, setSource] = useState(preset?.source_id ?? "")
  const [scope, setScope] = useState<ScopeChoice>("ALL")
  const [unit, setUnit] = useState("")
  const [note, setNote] = useState("")
  const [choice, setChoice] = useState<AccountChoice | null>(null)

  const reset = () => {
    setAdding(false)
    setSourceType(preset?.source_type ?? "COMPANY")
    setSource(preset?.source_id ?? "")
    setScope("ALL")
    setUnit("")
    setNote("")
    setChoice(null)
  }

  const add = useMutation({
    mutationFn: () =>
      setAccountLink({
        role,
        source_type: sourceType,
        source_id: source.trim(),
        scope_type:
          scope === "ALL" ? "ALL" : scope === "UNIT" ? "UNIT" : "UNIT_KIND",
        scope_key: scope === "ALL" ? "" : scope === "UNIT" ? unit : scope,
        account_code: choice!.account_code,
        category_code: choice!.category_code,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: () => {
      reset()
      void onSaved()
    },
  })

  const scopeReady = scope !== "UNIT" || unit !== ""
  // A master record is the whole point of a non-company source; a link from
  // "some expense category" is a decision about nothing.
  const sourceReady = sourceType === "COMPANY" || source.trim() !== ""
  const askSourceId =
    sourceType !== "COMPANY" || showSource || (preset?.source_id ?? "") !== ""

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-card-title font-semibold text-ink">Links</h4>
        <Button
          size="sm"
          variant={adding ? "quiet" : "ghost"}
          onClick={() => (adding ? reset() : setAdding(true))}
        >
          {adding ? "Cancel" : "Add a link"}
        </Button>
      </div>

      {adding && (
        <div className="flex flex-col gap-2.5 rounded-inner border border-hairline p-3">
          <Problem error={add.error} />
          <Field
            label="Decided by"
            aside="Where the decision is kept"
            hint="The company's default, or a master record that answers for itself."
          >
            <Select
              value={sourceType}
              onChange={(next) => {
                setSourceType(next)
                setSource("")
              }}
            >
              {SOURCE_TYPES.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </Select>
          </Field>
          {askSourceId && (
            <Field
              label={
                sourceType === "COMPANY"
                  ? "Qualifier"
                  : sourceTypeLabel(sourceType)
              }
              required={sourceType !== "COMPANY"}
              aside={
                sourceType === "COMPANY"
                  ? "Which bank, which class"
                  : sourceType === "PARTY"
                    ? "TYPE:id"
                    : undefined
              }
              hint={
                sourceType === "COMPANY"
                  ? "Part of the key: a blank qualifier is a different link."
                  : undefined
              }
            >
              <SourceIdPicker
                sourceType={sourceType}
                value={source}
                onChange={setSource}
                suggestions={sourceType === "COMPANY" ? suggestions : []}
              />
            </Field>
          )}
          <Field label="Holds for">
            <Select
              value={scope}
              onChange={(next) => setScope(next as ScopeChoice)}
            >
              <option value="ALL">All units</option>
              <option value="STORE">All stores</option>
              <option value="HO">Head office</option>
              <option value="UNIT">One unit</option>
            </Select>
          </Field>
          {scope === "UNIT" && (
            <Field label="Unit" required>
              <UnitSelect
                value={unit}
                onChange={setUnit}
                emptyLabel="Choose a unit"
              />
            </Field>
          )}
          <Field label="Note">
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <AccountAndCategory
            seed={expects?.split(" ")[0].replace(/\*$/, "")}
            value={choice}
            onChange={setChoice}
            categoryLabel="Category for this link"
            explain
          />
          <div className="flex items-center justify-end gap-2.5">
            <span className="min-w-0 flex-1 text-[0.9375rem] text-mute">
              {!sourceReady
                ? `Choose the ${sourceTypeLabel(sourceType).toLowerCase()} this link is for.`
                : !scopeReady
                  ? "Choose the unit this link is for."
                  : (accountChoiceProblem(choice) ??
                    `${choice?.account_code} will answer here.`)}
            </span>
            <Button
              variant="primary"
              size="sm"
              pending={add.isPending}
              disabled={
                !accountChoiceReady(choice) || !scopeReady || !sourceReady
              }
              onClick={() => add.mutate()}
            >
              {add.isPending ? "Submitting…" : "Submit"}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

/// The links one source keeps for a role, and what each unit ends up on.
function SourceGroup({
  source,
  showSource,
  highlighted,
  links,
  resolved,
  unitName,
  onChanged,
}: {
  source: LinkSource
  showSource: boolean
  highlighted: boolean
  links: readonly AccountLink[]
  resolved: ReadinessRow | undefined
  unitName: (id: string) => string
  onChanged: () => Promise<void>
}) {
  return (
    <div
      className={
        highlighted
          ? "flex flex-col gap-2.5 rounded-inner border border-accent p-3"
          : "flex flex-col gap-2.5 rounded-inner border border-hairline p-3"
      }
    >
      <div className="flex items-center gap-2">
        {source.source_type === "COMPANY" && source.source_id === "" ? (
          <span className="text-[0.9375rem] font-medium text-ink">
            {showSource ? "Company default" : "The role"}
          </span>
        ) : (
          <>
            {source.source_type !== "COMPANY" && (
              <Pill tone="info">{sourceTypeLabel(source.source_type)}</Pill>
            )}
            <Pill tone="neutral">
              {source.source_id === "" ? "—" : source.source_id}
            </Pill>
          </>
        )}
        <span className="flex-1" />
        {resolved !== undefined && (
          <span
            className={
              resolved.gaps > 0
                ? "text-[0.9375rem] font-medium text-bad-fg"
                : "text-[0.9375rem] text-ok-fg"
            }
          >
            {resolved.gaps > 0
              ? `${count(resolved.gaps)} ${resolved.gaps === 1 ? "unit" : "units"} unreached`
              : "Every unit reached"}
          </span>
        )}
      </div>

      {links.length === 0 ? (
        <p className="text-[0.9375rem] text-bad-fg">No link for this source.</p>
      ) : (
        <div className="flex flex-col divide-y divide-hairline">
          {links.map((link) => (
            <LinkRow
              key={link.link_id}
              link={link}
              scope={scopeWords(link.scope_type, link.scope_key, unitName)}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}

      {resolved !== undefined && (
        <div>
          <div className="mb-1.5 text-[0.9375rem] font-medium text-text">
            What each unit posts to
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {resolved.cells.map((cell) => (
              <div
                key={cell.unit_id}
                className="flex min-w-0 items-center gap-2 text-[0.9375rem]"
              >
                <span className="min-w-0 flex-1 truncate text-body">
                  {unitName(cell.unit_id)}
                </span>
                {cell.account_code === null ? (
                  <Tag tone="bad">—</Tag>
                ) : (
                  <Tag
                    tone={cell.scope_type === "UNIT" ? "info" : "neutral"}
                    title={
                      cell.scope_type === null
                        ? undefined
                        : `Decided by a ${label(cell.scope_type).toLowerCase()} link`
                    }
                  >
                    {cell.account_code}
                  </Tag>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/// One link, with the two things a person does to it: point it elsewhere, or
/// take it away.
function LinkRow({
  link,
  scope,
  onChanged,
}: {
  link: AccountLink
  scope: string
  onChanged: () => Promise<void>
}) {
  const categoryName = useCategoryName()
  const [editing, setEditing] = useState(false)
  const [choice, setChoice] = useState<AccountChoice | null>(null)
  // The server's sentence naming the units a removal would strand, held so
  // "Remove anyway" is offered only after somebody has read it.
  const [stranding, setStranding] = useState<string | null>(null)

  const change = useMutation({
    mutationFn: () =>
      setAccountLink({
        role: link.role,
        source_type: link.source_type,
        source_id: link.source_id,
        scope_type: link.scope_type,
        scope_key: link.scope_key,
        account_code: choice!.account_code,
        category_code: choice!.category_code,
        note: link.note,
      }),
    onSuccess: async () => {
      setEditing(false)
      setChoice(null)
      await onChanged()
    },
  })

  const remove = useMutation({
    mutationFn: (force: boolean) => removeAccountLink(link.link_id, force),
    onSuccess: async () => {
      setStranding(null)
      await onChanged()
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409)
        setStranding(error.message)
    },
  })

  return (
    <div className="flex flex-col gap-1.5 py-2 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2 text-[0.9375rem]">
        <Pill tone={link.scope_type === "ALL" ? "neutral" : "info"}>
          {scope}
        </Pill>
        <span className="font-mono text-mute">{link.account_code}</span>
        <span className="min-w-0 flex-1 truncate text-text">
          {link.account_name}
          {link.category_code !== null && (
            <span className="text-mute">
              {" · "}
              <span title={link.category_code}>
                {categoryName(link.category_code)}
              </span>
            </span>
          )}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 text-[0.9375rem] text-faint">
        <span className={link.decides_units === 0 ? "text-warn-fg" : ""}>
          {link.decides_units === 0
            ? "Decides no unit — every one it covers has a more specific link"
            : `Decides ${count(link.decides_units)} ${link.decides_units === 1 ? "unit" : "units"}`}
        </span>
        <span>
          · {link.set_by} · {moment(link.set_at)}
        </span>
        {link.note && <span className="text-mute">· {link.note}</span>}
        <span className="flex-1" />
        <Button
          size="sm"
          variant="quiet"
          onClick={() => {
            setChoice(null)
            setEditing(!editing)
          }}
        >
          {editing ? "Cancel" : "Change account"}
        </Button>
        <Button
          size="sm"
          variant="quiet"
          pending={remove.isPending}
          onClick={() => remove.mutate(false)}
        >
          Remove
        </Button>
      </div>

      {stranding !== null ? (
        <Banner tone="warn">
          <span className="block">{stranding}</span>
          <span className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="danger"
              pending={remove.isPending}
              onClick={() => remove.mutate(true)}
            >
              Remove anyway
            </Button>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => setStranding(null)}
            >
              Keep it
            </Button>
          </span>
        </Banner>
      ) : (
        remove.isError && <Banner tone="bad">{problemOf(remove.error)}</Banner>
      )}

      {editing && (
        <div className="flex flex-col gap-2.5 border-t border-hairline pt-2.5">
          <Problem error={change.error} />
          <AccountAndCategory
            seed={link.account_code}
            value={choice}
            onChange={setChoice}
            categoryLabel="Category for this link"
            explain
          />
          <div className="flex items-center justify-end gap-2.5">
            <span className="min-w-0 flex-1 text-[0.9375rem] text-mute">
              {accountChoiceProblem(choice) ??
                `${scope} will post to ${choice?.account_code}.`}
            </span>
            <Button
              variant="primary"
              size="sm"
              pending={change.isPending}
              disabled={!accountChoiceReady(choice)}
              onClick={() => change.mutate()}
            >
              {change.isPending ? "Saving…" : "Move link"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
