import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Checkbox, Field, Input, Select } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, label, moment } from "@/lib/format"
import { problemOf } from "@/lib/problem"
import {
  accountLinkHistory,
  accountLinks,
  financeKeys,
  removeAccountLink,
  setAccountLink,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { useFilters } from "@/lib/filters"
import { tableSetup, type TableSetup } from "@/lib/table"
import { usePostingReadiness } from "@/screens/finance/badges"
import { useCategoryName, useSiteName } from "@/screens/finance/hooks"
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
  LocationSelect,
  accountChoiceProblem,
  accountChoiceReady,
  type AccountChoice,
} from "@/screens/finance/parts"
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
/// site, one kind of site, or one site, and the most specific one wins. So a
/// fifteenth shop inherits every link that holds for all shops, and the
/// exception is one row sitting under the rule it overrides.
///
/// # Why the gaps come from the server
///
/// "Does this role reach an account at this site" is answered by the
/// database's own resolution (`account_resolution`), and the readiness matrix
/// is that answer laid out. Working it out again here from the links would be
/// a second opinion about the one thing that decides whether a posting is
/// refused.
///
/// # Why removing a link can be refused
///
/// A link that looks unused may be the only thing deciding three shops. The
/// server names those sites and refuses; "Remove anyway" is for the day
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
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.label}</span>
    ),
  },
  {
    accessorKey: "key",
    header: "Key",
    size: 210,
    cell: ({ row }) => <Tag>{row.original.key}</Tag>,
  },
  {
    accessorKey: "needed_for",
    header: "Needed for",
    size: 240,
    // What a gap COSTS — the column somebody fixing payables before month end
    // filters on.
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => (
      <span className="text-body">{row.original.needed_for}</span>
    ),
  },
  {
    accessorKey: "links",
    header: "Links",
    size: 100,
    meta: { align: "right" },
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
    meta: { align: "right", filter: { kind: "number", unit: "sites" } },
    cell: ({ row }) =>
      row.original.gaps === 0 ? (
        <span className="text-ok-fg">None</span>
      ) : (
        <span className="font-medium text-bad-fg tabular-nums">
          {count(row.original.gaps)}
        </span>
      ),
  },
]

/// A link's scope, as a person says it.
function scopeWords(
  scopeType: string,
  scopeKey: string,
  siteName: (id: string) => string
): string {
  if (scopeType === "ALL") return "All sites"
  if (scopeType === "SITE_KIND") {
    if (scopeKey === "STORE") return "All stores"
    if (scopeKey === "HO") return "Head office"
    return scopeKey
  }
  return siteName(scopeKey)
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
  return useQuery({
    queryKey: financeKeys.accountLinks(null, null),
    queryFn: ({ signal }) => accountLinks({}, signal),
  })
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
  const [query, setQuery] = useState("")
  const [onlyGaps, setOnlyGaps] = useState(false)
  const mapping = useSheet("mapping")
  const linkSource = useSheet("linkSource")
  const preset = decodeLinkSource(linkSource.value)
  const [sorting, setSorting] = useState<SortingState>([
    { id: "gaps", desc: true },
  ])

  const page = useLinkPage()
  const readiness = usePostingReadiness()

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
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, filters.columns, filters.columnFilters, query, sorting]
    )
  )

  const gaps = page.data?.gaps ?? 0

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Account links"
        sub="The posting rules name roles; the client's chart has accounts. A link says which account answers, for every site, one kind of site, or one site."
        actions={
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="h-8 w-48"
          />
        }
      />

      <Toolbar>
        <Checkbox
          label="Only roles with gaps"
          checked={onlyGaps}
          onChange={(next) => setOnlyGaps(next)}
        />
        <FilterPanel model={filters} table={table} />
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute">
          {count(page.data?.total ?? 0)} links · {count(gaps)} role-and-site
          gaps
          {onlyGaps ? " · showing only what is left" : ""}
        </span>
      </Toolbar>

      {preset !== null && presetRoles !== null && (
        <Banner tone="info" className="mb-3" onDismiss={linkSource.close}>
          {presetRoles.size === 0 ? (
            <>
              {sourceWords(preset)} has no link yet, so every role is listed.
              Open the role it should answer — the source is filled in on the
              add form.
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

      {page.data && (
        <>
          {gaps > 0 && (
            <Banner tone="warn" className="mb-3">
              {count(gaps)} role-and-site combinations reach no account. Every
              posting that needs one is refused, and the refusal names the role.{" "}
              <AppLink
                to="/finance/setup/posting-readiness"
                className="underline underline-offset-2"
              >
                See them on Posting readiness
              </AppLink>
            </Banner>
          )}
          <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
            <Kpi label="Roles" value={count(rows.length)} />
            <Kpi label="Links" value={count(page.data.total)} />
            <Kpi label="Locations" value={count(page.data.locations.length)} />
            <Kpi label="Gaps" value={count(gaps)} />
          </KpiStrip>
        </>
      )}

      <Card className="overflow-hidden">
        {queryState(page, {
          loading: "Loading the links…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {onlyGaps
                  ? "Every role reaches an account at every site. Nothing is left to do here."
                  : "The posting rules ask for no roles at all, which means none of them is loaded."}
              </EmptyState>
            ) : (
              <DataTable<RoleRow>
                table={table}
                onRowClick={(row) => mapping.open(row.key)}
                isSelected={(row) => row.key === mapping.value}
                empty="No role matches the search and filters in force."
                className="max-h-[calc(100vh-22rem)]"
              />
            ),
        })}
      </Card>

      <RoleSheet
        role={mapping.value ?? null}
        preset={preset}
        onClose={mapping.close}
      />
    </PageContent>
  )
}

type ScopeChoice = "ALL" | "STORE" | "HO" | "SITE"

/// One role: its links grouped by source, what each site ends up on, and who
/// changed what.
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
  const siteName = useSiteName()
  const page = useLinkPage()
  const readiness = usePostingReadiness()
  const history = useQuery({
    queryKey: financeKeys.accountLinkHistory(role),
    queryFn: ({ signal }) => accountLinkHistory(role, signal, 30),
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
      className="w-[36rem]"
    >
      {queryState(page, {
        loading: "Loading the links…",
        render: () => (
          <div className="flex flex-col gap-5">
            {doc !== undefined ? (
              <div className="flex flex-col gap-2">
                <p className="text-[0.875rem] text-body">
                  Without this, {doc.needed_for.toLowerCase()} stops working —
                  the posting is refused and names the role.
                </p>
                <p className="rounded-inner bg-soft px-3 py-2 text-[0.875rem] text-body">
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
              <p className="text-[0.875rem] text-bad-fg">
                No link names this role. Every posting that needs it is refused
                at every site.
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
                    siteName={siteName}
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
                render: (changes) =>
                  changes.length === 0 ? (
                    <p className="text-[0.875rem] text-mute">
                      Nobody has changed these links since they were set.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {changes.map((change) => (
                        <div
                          key={change.history_id}
                          className="flex flex-wrap items-baseline gap-x-2 text-[0.875rem]"
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
                              siteName
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
                    </div>
                  ),
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
  const [site, setSite] = useState("")
  const [note, setNote] = useState("")
  const [choice, setChoice] = useState<AccountChoice | null>(null)

  const reset = () => {
    setAdding(false)
    setSourceType(preset?.source_type ?? "COMPANY")
    setSource(preset?.source_id ?? "")
    setScope("ALL")
    setSite("")
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
          scope === "ALL" ? "ALL" : scope === "SITE" ? "SITE" : "SITE_KIND",
        scope_key: scope === "ALL" ? "" : scope === "SITE" ? site : scope,
        account_code: choice!.account_code,
        category_code: choice!.category_code,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: () => {
      reset()
      void onSaved()
    },
  })

  const scopeReady = scope !== "SITE" || site !== ""
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
              <option value="ALL">All sites</option>
              <option value="STORE">All stores</option>
              <option value="HO">Head office</option>
              <option value="SITE">One site</option>
            </Select>
          </Field>
          {scope === "SITE" && (
            <Field label="Site" required>
              <LocationSelect
                value={site}
                onChange={setSite}
                emptyLabel="Choose a site"
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
            <span className="min-w-0 flex-1 text-[0.875rem] text-mute">
              {!sourceReady
                ? `Choose the ${sourceTypeLabel(sourceType).toLowerCase()} this link is for.`
                : !scopeReady
                  ? "Choose the site this link is for."
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
              {add.isPending ? "Saving…" : "Save link"}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

/// The links one source keeps for a role, and what each site ends up on.
function SourceGroup({
  source,
  showSource,
  highlighted,
  links,
  resolved,
  siteName,
  onChanged,
}: {
  source: LinkSource
  showSource: boolean
  highlighted: boolean
  links: readonly AccountLink[]
  resolved: ReadinessRow | undefined
  siteName: (id: string) => string
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
          <span className="text-[0.875rem] font-medium text-ink">
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
                ? "text-[0.875rem] font-medium text-bad-fg"
                : "text-[0.875rem] text-ok-fg"
            }
          >
            {resolved.gaps > 0
              ? `${count(resolved.gaps)} sites unreached`
              : "Every site reached"}
          </span>
        )}
      </div>

      {links.length === 0 ? (
        <p className="text-[0.875rem] text-bad-fg">No link for this source.</p>
      ) : (
        <div className="flex flex-col divide-y divide-hairline">
          {links.map((link) => (
            <LinkRow
              key={link.link_id}
              link={link}
              scope={scopeWords(link.scope_type, link.scope_key, siteName)}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}

      {resolved !== undefined && (
        <div>
          <div className="mb-1.5 text-[0.875rem] font-medium text-text">
            What each site posts to
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {resolved.cells.map((cell) => (
              <div
                key={cell.site_id}
                className="flex min-w-0 items-center gap-2 text-[0.875rem]"
              >
                <span
                  className="min-w-0 flex-1 truncate text-body"
                  title={cell.site_id}
                >
                  {siteName(cell.site_id)}
                </span>
                {cell.account_code === null ? (
                  <Tag tone="bad">—</Tag>
                ) : (
                  <Tag
                    tone={cell.scope_type === "SITE" ? "info" : "neutral"}
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
  // The server's sentence naming the sites a removal would strand, held so
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
      <div className="flex items-center gap-2 text-[0.875rem]">
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
      <div className="flex flex-wrap items-center gap-x-2 text-[0.875rem] text-faint">
        <span className={link.decides_sites === 0 ? "text-warn-fg" : ""}>
          {link.decides_sites === 0
            ? "Decides no site — every one it covers has a more specific link"
            : `Decides ${count(link.decides_sites)} ${link.decides_sites === 1 ? "site" : "sites"}`}
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
            <span className="min-w-0 flex-1 text-[0.875rem] text-mute">
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
