import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, moment } from "@/lib/format"
import {
  accountMap,
  financeKeys,
  setAccountMapping,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { useFilters } from "@/lib/filters"
import { tableSetup, type TableSetup } from "@/lib/table"
import { accountMapGaps } from "@/screens/finance/badges"
import { useCategoryName } from "@/screens/finance/hooks"
import {
  AccountAndCategory,
  accountChoiceProblem,
  accountChoiceReady,
  type AccountChoice,
} from "@/screens/finance/parts"
import type { AccountMapping, SemanticKeyDoc } from "@itulah/contract"

/// Which meanings the posting rules can resolve, and which they cannot.
///
/// # Why this screen is a precondition and not configuration
///
/// A posting rule names a *meaning* — `trade_payable` — and the client's chart
/// has a code — `201200100107`. Nothing bridges the two automatically. Until a
/// meaning is mapped for a location, **every posting that needs it is refused
/// and names the key**. So this is not a settings page somebody gets to later;
/// it is the thing that decides whether finance works at all, which is why the
/// headline is how much of it is done.
///
/// # Why completion counts pairs and not rows
///
/// `bank_savings` legitimately has five mappings at one site — one per bank —
/// because the qualifier is part of the key. Counting rows would report that
/// site as five-sixths finished on the strength of one meaning.
///
/// # Why a heading cannot be mapped
///
/// The database carries a composite foreign key on `(account_code, is_group)`,
/// so a heading is refused. The picker shows headings and disables them rather
/// than hiding them: an accountant who cannot find `10110` at all assumes the
/// search is broken.

/// One required meaning, with how far it has got. Derived here rather than on
/// the server because it is a question about this screen — "what is left to do
/// on this page" — and all three pieces it needs are in the one response.
interface KeyRow {
  readonly key: string
  readonly label: string
  readonly expects: string
  readonly qualified: boolean
  readonly needed_for: string
  readonly set: number
  readonly locations: number
  readonly missing: readonly string[]
}

const columns: ColumnDef<TableSetup, KeyRow>[] = [
  {
    accessorKey: "label",
    header: "Meaning",
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
    // Which menu group stops working without it — a closed set of a dozen
    // names, and the only column here that says what a gap COSTS. Somebody
    // fixing payables before month end wants those rows and not the other
    // hundred.
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => (
      <span className="text-body">{row.original.needed_for}</span>
    ),
  },
  {
    accessorKey: "qualified",
    header: "Shape",
    size: 150,
    // `option` and not `boolean`, because the panel labels a boolean Yes and
    // No: "Shape is Yes" is not a sentence, and the two arms already have
    // names the rest of this screen uses.
    meta: {
      filter: {
        kind: "option",
        format: (value) =>
          value === "true" ? "One per qualifier" : "One account",
      },
    },
    cell: ({ row }) =>
      row.original.qualified ? (
        <Pill tone="info">One per qualifier</Pill>
      ) : (
        <span className="text-mute">One account</span>
      ),
  },
  {
    accessorKey: "set",
    header: "Set",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="text-body tabular-nums">
        {count(row.original.set)}/{count(row.original.locations)}
      </span>
    ),
  },
  {
    id: "missing",
    accessorFn: (row) => row.missing.length,
    header: "Unset",
    size: 110,
    // The checkbox above asks "any gap at all"; this asks how big. A meaning
    // unset at eleven locations and one unset at a single shop are different
    // afternoons of work.
    meta: { align: "right", filter: { kind: "number", unit: "locations" } },
    // The decision metric: a meaning missing at eleven locations breaks eleven
    // locations' postings, and it is the first thing to fix.
    cell: ({ row }) =>
      row.original.missing.length === 0 ? (
        <span className="text-ok-fg">Done</span>
      ) : (
        <span className="font-medium text-bad-fg tabular-nums">
          {count(row.original.missing.length)}
        </span>
      ),
  },
]

export function AccountMap() {
  const [query, setQuery] = useState("")
  const [onlyGaps, setOnlyGaps] = useState(false)
  const mapping = useSheet("mapping")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "missing", desc: true },
  ])

  const map = useQuery({
    queryKey: financeKeys.accountMap(null),
    queryFn: ({ signal }) => accountMap(undefined, signal),
  })

  // The pair arithmetic itself lives in `badges.ts`, because the sidebar badge
  // and the overview's exception queue count the same thing and had each
  // written their own version of it. Three copies is three chances for the
  // number in the sidebar to disagree with the number on this page.
  const gaps = useMemo(() => accountMapGaps(map.data), [map.data])

  const rows = useMemo<KeyRow[]>(() => {
    if (map.data === undefined) return []
    return map.data.required_keys
      .filter(
        (doc) =>
          // The whole list, or only what is left to do. Filtered here and not
          // on the server: the map arrives whole in one response, and asking
          // for a subset of a list already in memory is a second loading state
          // for a checkbox.
          !onlyGaps || (gaps.missingByKey.get(doc.key)?.length ?? 0) > 0
      )
      .map((doc) => {
        const missing = gaps.missingByKey.get(doc.key) ?? []
        return {
          key: doc.key,
          label: doc.label,
          expects: doc.expects,
          qualified: doc.qualified,
          needed_for: doc.needed_for,
          set: gaps.sites.length - missing.length,
          locations: gaps.sites.length,
          missing,
        }
      })
  }, [map.data, gaps, onlyGaps])

  const total = gaps.required
  const done = gaps.set

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: KeyRow) => row.key,
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

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Account map"
        sub="The posting rules name meanings; the client's chart has codes. This is the bridge, and nothing posts across a gap in it."
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
          label="Only meanings with gaps"
          checked={onlyGaps}
          onChange={(next) => setOnlyGaps(next)}
        />
        <FilterPanel model={filters} table={table} />
        <Toolbar.Spacer />
        {/* The effective answer, in words, like every other toolbar here: how
            much of the bridge is built, in the unit the table counts. */}
        <span className="text-[0.71875rem] text-mute">
          {count(done)} of {count(total)} meaning-and-location pairs mapped
          {onlyGaps ? " · showing only what is left" : ""}
        </span>
      </Toolbar>

      {map.data && (
        <>
          {total > done && (
            <Banner tone="warn" className="mb-3">
              {count(total - done)} of {count(total)} meaning-and-location pairs
              have no account. Every posting that needs one of them is refused,
              and the refusal names the key.
            </Banner>
          )}
          <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
            <Kpi label="Mapped" value={`${count(done)} / ${count(total)}`} />
            <Kpi label="Meanings" value={count(rows.length)} />
            <Kpi label="Locations" value={count(map.data.locations.length)} />
            <Kpi
              label="Accounts pointed at"
              value={count(map.data.rows.length)}
            />
          </KpiStrip>
        </>
      )}

      <Card className="overflow-hidden">
        {queryState(map, {
          loading: "Loading the map…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {onlyGaps
                  ? "Every meaning is mapped at every location. Nothing is left to do here."
                  : "The posting rules ask for no meanings at all, which means none of them is loaded."}
              </EmptyState>
            ) : (
              <DataTable<KeyRow>
                table={table}
                onRowClick={(row) => mapping.open(row.key)}
                isSelected={(row) => row.key === mapping.value}
                empty="No meaning matches the search and filters in force."
                className="max-h-[calc(100vh-22rem)]"
              />
            ),
        })}
      </Card>

      <MappingSheet
        semanticKey={mapping.value ?? null}
        onClose={mapping.close}
      />
    </PageContent>
  )
}

/// One meaning, at every location the books are kept for.
function MappingSheet({
  semanticKey,
  onClose,
}: {
  semanticKey: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [editing, setEditing] = useState<string | null>(null)
  const [qualifier, setQualifier] = useState("")
  const [note, setNote] = useState("")
  // The account AND the category it asks for. One piece of state because they
  // are one answer: a meaning now resolves to a pair, and a mapping that named
  // 6301 without saying which cost would post nothing — the trigger refuses
  // every line it produced.
  const [choice, setChoice] = useState<AccountChoice | null>(null)

  const map = useQuery({
    queryKey: financeKeys.accountMap(null),
    queryFn: ({ signal }) => accountMap(undefined, signal),
    enabled: semanticKey !== null,
  })

  const doc: SemanticKeyDoc | undefined = map.data?.required_keys.find(
    (row) => row.key === semanticKey
  )

  const save = useMutation({
    mutationFn: (input: { site: string; picked: AccountChoice }) =>
      setAccountMapping({
        semantic_key: semanticKey!,
        site_id: input.site,
        // Unqualified meanings send an empty string, not null: the qualifier is
        // part of the primary key, and the server writes `""` for "needs no
        // narrowing".
        qualifier: doc?.qualified ? qualifier.trim() : "",
        account_code: input.picked.account_code,
        // `null` is the answer for an account that declares no family, and it
        // is not the same as "not answered yet" — the trigger refuses a
        // mapping that carries a category the account cannot take.
        category_code: input.picked.category_code,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: () => {
      setEditing(null)
      setQualifier("")
      setNote("")
      setChoice(null)
      client.invalidateQueries({ queryKey: financeKeys.accountMap(null) })
    },
  })

  return (
    <Sheet
      open={semanticKey !== null}
      onOpenChange={(next) => {
        if (!next) {
          setEditing(null)
          onClose()
        }
      }}
      id={semanticKey ?? undefined}
      title={doc?.label ?? "Meaning"}
      className="w-[34rem]"
    >
      {queryState(map, {
        loading: "Loading the map…",
        render: (view) =>
          doc === undefined ? (
            <EmptyState>
              No posting rule asks for “{semanticKey}” any more.
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-5">
              {save.isError && (
                <Banner tone="bad">
                  {save.error instanceof Error
                    ? save.error.message
                    : "The mapping was refused."}
                </Banner>
              )}

              <div className="flex flex-col gap-2">
                <p className="text-[0.78125rem] text-body">
                  Without this, {doc.needed_for.toLowerCase()} stops working —
                  the posting is refused and names the key.
                </p>
                {/* The client's own account, quoted as a hint. Never applied
                    automatically: it is a suggestion for the person mapping it,
                    and their chart is the authority. */}
                <p className="rounded-inner bg-soft px-3 py-2 text-[0.71875rem] text-body">
                  Expected to be{" "}
                  <span className="font-medium text-ink">{doc.expects}</span>
                </p>
                {doc.qualified && (
                  <Pill tone="info">
                    Needs one account per qualifier — a bank per bank, a scheme
                    per scheme
                  </Pill>
                )}
                {/* Said before anybody picks, not after. A meaning that
                    resolves to an account with a family needs a category in
                    the mapping itself — the poster reads BOTH off the map and
                    writes both onto every line it produces — and finding that
                    out from a disabled Save button is finding it out late. */}
                {doc.category_family !== null && (
                  <Pill tone="info">
                    Resolves to a category too — family{" "}
                    <span className="font-mono">{doc.category_family}</span>
                  </Pill>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {view.locations.map((location) => {
                  const set = view.rows.filter(
                    (row) =>
                      row.semantic_key === semanticKey &&
                      row.site_id === location.site_id
                  )
                  return (
                    <div
                      key={location.site_id}
                      className="rounded-inner border border-hairline p-3"
                    >
                      <div className="flex items-center gap-2">
                        <Tag tone={set.length > 0 ? "ok" : "bad"}>
                          {location.site_id}
                        </Tag>
                        <span className="min-w-0 flex-1 truncate text-[0.78125rem] text-ink">
                          {location.name}
                        </span>
                        <span className="shrink-0 text-[0.65625rem] text-mute">
                          {location.kind} · {count(location.account_count)}{" "}
                          accounts
                        </span>
                        <Button
                          size="sm"
                          variant="quiet"
                          onClick={() => {
                            // A choice belongs to the location it was made
                            // for. Carrying it to the next one would offer to
                            // save an account somebody picked for Store 04
                            // against Store 07.
                            setChoice(null)
                            setEditing(
                              editing === location.site_id
                                ? null
                                : location.site_id
                            )
                          }}
                        >
                          {set.length > 0 ? "Add or change" : "Set"}
                        </Button>
                      </div>

                      {set.length === 0 ? (
                        <p className="mt-1.5 text-[0.71875rem] text-bad-fg">
                          Unset. Postings for this meaning are refused here.
                        </p>
                      ) : (
                        <div className="mt-1.5 flex flex-col gap-1">
                          {set.map((row) => (
                            <MappedRow
                              key={`${row.qualifier}-${row.account_code}`}
                              row={row}
                            />
                          ))}
                        </div>
                      )}

                      {editing === location.site_id && (
                        <div className="mt-3 flex flex-col gap-2.5 border-t border-hairline pt-3">
                          {doc.qualified && (
                            <Field
                              label="Qualifier"
                              hint="Which bank, which scheme. Part of the key, so a blank one is a different mapping."
                            >
                              <Input
                                value={qualifier}
                                onChange={(event) =>
                                  setQualifier(event.target.value)
                                }
                              />
                            </Field>
                          )}
                          <Field label="Note" hint="Optional.">
                            <Input
                              value={note}
                              onChange={(event) => setNote(event.target.value)}
                            />
                          </Field>
                          <AccountAndCategory
                            seed={doc.expects.split(" ")[0].replace(/\*$/, "")}
                            value={choice}
                            onChange={setChoice}
                            categoryLabel="Category for this mapping"
                            explain
                          />
                          {doc.qualified && qualifier.trim() === "" && (
                            <p className="text-[0.71875rem] text-warn-fg">
                              This meaning needs a qualifier. Choosing an
                              account without one writes the unnarrowed mapping,
                              which is probably not what you want.
                            </p>
                          )}
                          <div className="flex items-center justify-end gap-2.5">
                            {/* Choosing the account no longer saves on its
                                own. It cannot: an account that declares a
                                family is half an answer until the category
                                beside it is chosen, and a picker that wrote
                                the mapping on the first click would write the
                                half that gets refused. */}
                            <span className="min-w-0 flex-1 text-[0.71875rem] text-mute">
                              {accountChoiceProblem(choice) ??
                                `${choice?.account_code} will carry ${doc.label.toLowerCase()} here.`}
                            </span>
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={
                                !accountChoiceReady(choice) || save.isPending
                              }
                              onClick={() =>
                                choice !== null &&
                                save.mutate({
                                  site: location.site_id,
                                  picked: choice,
                                })
                              }
                            >
                              {save.isPending ? "Saving…" : "Save mapping"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ),
      })}
    </Sheet>
  )
}

function MappedRow({ row }: { row: AccountMapping }) {
  const categoryName = useCategoryName()
  return (
    <div className="flex items-center gap-2 text-[0.71875rem]">
      {row.qualifier !== "" && <Pill tone="neutral">{row.qualifier}</Pill>}
      <span className="font-mono text-[0.65625rem] text-mute">
        {row.account_code}
      </span>
      <span className="min-w-0 flex-1 truncate text-text">
        {row.account_name}
        {/* The client's own word for it, not the code: with forty accounts
            the category is what tells two mappings on 6301 apart, so it is
            the half of this row somebody is actually reading. */}
        {row.category_code !== null && (
          <span className="text-mute">
            {" · "}
            <span title={row.category_code}>
              {categoryName(row.category_code)}
            </span>
          </span>
        )}
      </span>
      <span className="shrink-0 text-[0.65625rem] text-faint">
        {row.set_by} · {moment(row.set_at)}
      </span>
    </div>
  )
}
