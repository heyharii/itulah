import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { Fab } from "@/components/ui/fab"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, Problem } from "@/components/ui/states"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  dimensionsQuery,
  financeKeys,
  saveDimension,
  saveDimensionValue,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Code } from "@/screens/finance-final/parts"
import { useColumnFit } from "@/screens/finance/column-fit"
import {
  EditorCard,
  LinkAccountsButton,
  MasterLayout,
  YesNo,
} from "@/screens/finance/master-parts"
import { ScreenPending } from "@/screens/finance/pending"
import type { AccountingDimension, DimensionValue } from "@itulah/contract"

/// How many values of a dimension are in use.
function activeValues(row: AccountingDimension): number {
  return row.values.filter((value) => value.is_active).length
}

/// One dimension per row. On a phone the same columns are the card: the name
/// over its code, the two switches and the value count under it.
const columns: ColumnDef<TableSetup, AccountingDimension>[] = [
  {
    accessorKey: "code",
    header: "Code",
    size: 160,
    meta: { card: "meta" },
    cell: ({ row }) => <Code>{row.original.code}</Code>,
  },
  {
    accessorKey: "name",
    header: "Name",
    size: 320,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => (
      <span className="flex items-center gap-2 whitespace-normal">
        <span className="text-ink">{row.original.name}</span>
        {!row.original.is_active && <Pill tone="neutral">Inactive</Pill>}
      </span>
    ),
  },
  {
    id: "pl",
    accessorFn: (row) => (row.mandatory_for_pl ? "Required" : ""),
    header: "Required on P&L",
    size: 180,
    meta: { align: "center", card: "metric" },
    cell: ({ row }) => (
      <YesNo on={row.original.mandatory_for_pl} yes="Required" />
    ),
  },
  {
    id: "bs",
    accessorFn: (row) => (row.mandatory_for_bs ? "Required" : ""),
    header: "Required on balance sheet",
    size: 230,
    meta: { align: "center", card: "metric" },
    cell: ({ row }) => (
      <YesNo on={row.original.mandatory_for_bs} yes="Required" />
    ),
  },
  {
    id: "values",
    accessorFn: (row) => activeValues(row),
    header: "Values",
    size: 110,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => count(activeValues(row.original)),
  },
]

/// The accounting dimensions a journal line can carry beside its unit —
/// division, cost center, project (ERPNext Accounting Dimension).
///
/// A dimension is a list of values and two switches: whether a profit-and-loss
/// line must name a value, and whether a balance-sheet line must. The switches
/// are refusals at posting, so turning one on is a decision about every
/// automatic flow that writes such a line — the Dimension results report shows
/// what the values are carrying before somebody makes it.
export function Dimensions() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Setup" title="Accounting Dimensions">
          Reading the dimensions…
        </ScreenPending>
      }
    >
      <DimensionsScreen />
    </Suspense>
  )
}

function DimensionsScreen() {
  const phone = useLayout() === "phone"
  const list = useSuspenseQuery(dimensionsQuery())
  const [editing, setEditing] = useState<string | "new" | null>(null)
  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])

  const current =
    editing === null || editing === "new"
      ? null
      : (list.data.find((one) => one.code === editing) ?? null)

  const rows = list.data
  const [measure, fit] = useColumnFit(columns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: AccountingDimension) => row.code,
        state: {
          globalFilter: query,
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
        onColumnVisibilityChange: fit.onChange,
      }),
      // `fit` is new each render: the room is measured, and the columns the
      // card has no room for are given up.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [rows, query, sorting, phone, fit]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Setup"
        title="Accounting Dimensions"
        // The new dimension is the dock's + on a phone.
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={() => setEditing("new")}>
              New dimension
            </Button>
          )
        }
      />

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={query}
          onChange={setQuery}
          label="Search dimensions"
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>

      <Fab label="New dimension" onClick={() => setEditing("new")} />
      <DockTools
        search={{
          value: query,
          onChange: setQuery,
          label: "Search dimensions",
        }}
        sort={dockSortOf(table)}
      />

      <MasterLayout
        list={
          <div ref={measure}>
            <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
              {queryState(list, {
                render: () =>
                  rows.length === 0 ? (
                    <EmptyState>No accounting dimension yet.</EmptyState>
                  ) : (
                    <DataTable<AccountingDimension>
                      table={table}
                      refresh={[list]}
                      onRowClick={(row) => setEditing(row.code)}
                      isSelected={(row) => row.code === editing}
                      empty="No dimension matches the search."
                      pageScroll
                      cardsApart
                      cardSort={false}
                    />
                  ),
              })}
            </Card>
          </div>
        }
        editor={
          editing !== null &&
          (editing === "new" || current !== null) && (
            <DimensionForm
              key={editing}
              dimension={current}
              onDone={() => setEditing(null)}
            />
          )
        }
      />
    </PageContent>
  )
}

function DimensionForm({
  dimension,
  onDone,
}: {
  dimension: AccountingDimension | null
  onDone: () => void
}) {
  const client = useQueryClient()
  const [code, setCode] = useState(dimension?.code ?? "")
  const [name, setName] = useState(dimension?.name ?? "")
  const [pl, setPl] = useState(dimension?.mandatory_for_pl ?? false)
  const [bs, setBs] = useState(dimension?.mandatory_for_bs ?? false)
  const [active, setActive] = useState(dimension?.is_active ?? true)

  const save = useMutation({
    mutationFn: () =>
      saveDimension({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        mandatory_for_pl: pl,
        mandatory_for_bs: bs,
        is_active: active,
      }),
    onSuccess: (rows) => {
      client.setQueryData(financeKeys.dimensions(), rows)
      if (dimension === null) onDone()
    },
  })

  return (
    <EditorCard
      title={dimension === null ? "New dimension" : dimension.name}
      onClose={onDone}
      pinLast={dimension === null}
    >
      <Problem error={save.error} />
      <Field
        label="Code"
        required
        aside={dimension === null ? "Never changes" : undefined}
      >
        <Input
          value={code}
          disabled={dimension !== null}
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      <Field label="Name" required>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Checkbox
        label="Required on profit-and-loss lines"
        hint="A line on an income or expense account without a value is refused."
        checked={pl}
        onChange={setPl}
      />
      <Checkbox
        label="Required on balance-sheet lines"
        checked={bs}
        onChange={setBs}
      />
      <Checkbox label="Active" checked={active} onChange={setActive} />
      <div className="flex justify-end">
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={code.trim() === "" || name.trim() === ""}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>

      {dimension !== null && <Values dimension={dimension} />}
    </EditorCard>
  )
}

/// A dimension's values: add one, retire one, bring one back. A division's
/// values are also account-link sources, so they carry "Link accounts".
function Values({ dimension }: { dimension: AccountingDimension }) {
  const client = useQueryClient()
  const [code, setCode] = useState("")
  const [name, setName] = useState("")

  const save = useMutation({
    mutationFn: (value: DimensionValue) =>
      saveDimensionValue(dimension.code, value),
    onSuccess: (rows) => {
      client.setQueryData(financeKeys.dimensions(), rows)
      setCode("")
      setName("")
    },
  })

  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-3">
      <h4 className="text-card-title font-semibold text-ink">Values</h4>
      <Problem error={save.error} />
      {dimension.values.length === 0 ? (
        <p className="text-[0.9375rem] text-mute">No value yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-hairline">
          {dimension.values.map((value) => (
            <div
              key={value.value_code}
              className="flex items-center gap-2 py-1.5 text-[0.9375rem]"
            >
              <Code>{value.value_code}</Code>
              <span
                className={
                  value.is_active
                    ? "min-w-0 flex-1 truncate text-ink"
                    : "min-w-0 flex-1 truncate text-faint line-through"
                }
              >
                {value.name}
              </span>
              {dimension.code === "DIVISION" && value.is_active && (
                <LinkAccountsButton
                  sourceType="DIVISION"
                  sourceId={value.value_code}
                  label="Links"
                />
              )}
              <Button
                size="sm"
                variant="quiet"
                pending={save.isPending}
                onClick={() =>
                  save.mutate({ ...value, is_active: !value.is_active })
                }
              >
                {value.is_active ? "Retire" : "Restore"}
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-end gap-2">
        <Field label="Code" required>
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        <Field label="Name" required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Button
          pending={save.isPending}
          disabled={code.trim() === "" || name.trim() === ""}
          onClick={() =>
            save.mutate({
              value_code: code.trim().toUpperCase(),
              name: name.trim(),
              is_active: true,
            })
          }
        >
          Add
        </Button>
      </div>
    </div>
  )
}
