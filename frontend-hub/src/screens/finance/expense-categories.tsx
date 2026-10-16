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
  expenseCategoriesQuery,
  financeKeys,
  saveExpenseCategory,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Code } from "@/screens/finance-final/parts"
import { useColumnFit } from "@/screens/finance/column-fit"
import {
  EditorCard,
  LinkAccountsButton,
  MasterLayout,
  Reach,
  YesNo,
} from "@/screens/finance/master-parts"
import { ScreenPending } from "@/screens/finance/pending"
import type { ExpenseCategory } from "@itulah/contract"

/// One category per row. On a phone the same columns are the card: the name
/// over its code and note, what it is for and where it lands under them, and
/// the Link accounts button at the right.
const columns: ColumnDef<TableSetup, ExpenseCategory>[] = [
  {
    accessorKey: "code",
    header: "Code",
    size: 210,
    meta: { card: "meta" },
    cell: ({ row }) => <Code>{row.original.code}</Code>,
  },
  {
    accessorKey: "name",
    header: "Name",
    size: 300,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => (
      <span className="flex items-center gap-2 whitespace-normal">
        <span className="text-ink">{row.original.name}</span>
        {!row.original.is_active && <Pill tone="neutral">Inactive</Pill>}
      </span>
    ),
  },
  {
    id: "for_stores",
    accessorFn: (row) => (row.for_stores ? "Yes" : ""),
    header: "Shops",
    size: 100,
    meta: { align: "center", card: "metric" },
    cell: ({ row }) => <YesNo on={row.original.for_stores} />,
  },
  {
    id: "for_claims",
    accessorFn: (row) => (row.for_claims ? "Yes" : ""),
    header: "Claims",
    size: 100,
    meta: { align: "center", card: "metric" },
    cell: ({ row }) => <YesNo on={row.original.for_claims} />,
  },
  {
    accessorKey: "linked_units",
    header: "Account",
    size: 190,
    meta: { card: "metric" },
    cell: ({ row }) => <Reach units={row.original.linked_units} />,
  },
  {
    accessorKey: "note",
    header: "Note",
    size: 240,
    meta: { card: "meta", priority: 3 },
    cell: ({ row }) => <span className="text-mute">{row.original.note}</span>,
  },
  {
    id: "link",
    header: "",
    size: 150,
    enableSorting: false,
    enableHiding: false,
    meta: { align: "right", card: "status" },
    cell: ({ row }) => (
      <LinkAccountsButton
        role="expense"
        sourceType="EXPENSE_CATEGORY"
        sourceId={row.original.code}
      />
    ),
  },
]

/// The kinds of cost a shop or an employee files under (ERPNext Expense
/// Claim Type, and a store's petty-cash heads).
///
/// A category is a name and two doors — shops, claims — and nothing else. Where
/// its cost lands is an account link (role `expense`, source the category), so
/// the account is set on Account links, per scope, like every other decision
/// about where money goes. A category with no link is refused at posting, by
/// name, which is why the reach column is the one to watch.
export function ExpenseCategories() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Setup" title="Expense Categories">
          Reading the categories…
        </ScreenPending>
      }
    >
      <ExpenseCategoriesScreen />
    </Suspense>
  )
}

function ExpenseCategoriesScreen() {
  const phone = useLayout() === "phone"
  const list = useSuspenseQuery(expenseCategoriesQuery())
  const [editing, setEditing] = useState<ExpenseCategory | "new" | null>(null)
  const [needle, setNeedle] = useState("")
  const [inactive, setInactive] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])

  const rows = useMemo(
    () => list.data.filter((row) => inactive || row.is_active),
    [list.data, inactive]
  )

  const unlinked = rows.filter(
    (row) => row.is_active && row.linked_units === 0
  ).length

  const [measure, fit] = useColumnFit(columns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: ExpenseCategory) => row.code,
        state: {
          globalFilter: needle,
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setNeedle,
        onColumnVisibilityChange: fit.onChange,
      }),
      // `fit` is new each render: the room is measured, and the columns the
      // card has no room for are given up.
      [rows, needle, sorting, fit]
    )
  )
  const shown = table.getRowModel().rows.length

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Setup"
        title="Expense Categories"
        // The new category is the dock's + on a phone.
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={() => setEditing("new")}>
              New category
            </Button>
          )
        }
      />

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search categories"
        />
        <Checkbox
          label="Show inactive"
          checked={inactive}
          onChange={setInactive}
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>

      <Fab label="New category" onClick={() => setEditing("new")} />
      <DockTools
        search={{
          value: needle,
          onChange: setNeedle,
          label: "Search categories",
        }}
        sort={dockSortOf(table)}
        status={{
          value: inactive ? "all" : "active",
          options: [
            {
              value: "active",
              label: "Active",
              count: list.data.filter((row) => row.is_active).length,
            },
            { value: "all", label: "All", count: list.data.length },
          ],
          onChange: (next) => setInactive(next === "all"),
        }}
      />

      <MasterLayout
        list={
          <div ref={measure}>
            <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
              {queryState(list, {
                render: () =>
                  rows.length === 0 ? (
                    <EmptyState>No expense category yet.</EmptyState>
                  ) : (
                    <DataTable<ExpenseCategory>
                      table={table}
                      refresh={[list]}
                      onRowClick={(row) => setEditing(row)}
                      isSelected={(row) =>
                        editing !== null &&
                        editing !== "new" &&
                        editing.code === row.code
                      }
                      empty="No category matches the search."
                      pageScroll
                      cardsApart
                      cardSort={false}
                      summary={{
                        name: (
                          <span>
                            {count(shown)}{" "}
                            <span className="font-normal text-body">
                              {shown === 1 ? "category" : "categories"}
                            </span>
                          </span>
                        ),
                        linked_units:
                          unlinked > 0 ? (
                            <span className="font-normal text-bad-fg">
                              {count(unlinked)} with no account yet
                            </span>
                          ) : undefined,
                      }}
                    />
                  ),
              })}
            </Card>
          </div>
        }
        editor={
          editing !== null && (
            <CategoryForm
              key={editing === "new" ? "new" : editing.code}
              category={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )
        }
      />
    </PageContent>
  )
}

function CategoryForm({
  category,
  onDone,
}: {
  category: ExpenseCategory | null
  onDone: () => void
}) {
  const client = useQueryClient()
  const [code, setCode] = useState(category?.code ?? "")
  const [name, setName] = useState(category?.name ?? "")
  const [forStores, setForStores] = useState(category?.for_stores ?? true)
  const [forClaims, setForClaims] = useState(category?.for_claims ?? false)
  const [active, setActive] = useState(category?.is_active ?? true)
  const [note, setNote] = useState(category?.note ?? "")

  const save = useMutation({
    mutationFn: () =>
      saveExpenseCategory({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        for_stores: forStores,
        for_claims: forClaims,
        is_active: active,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: financeKeys.expenseCategories(),
      })
      onDone()
    },
  })

  return (
    <EditorCard
      title={category === null ? "New category" : `Edit ${category.code}`}
      onClose={onDone}
    >
      <Problem error={save.error} />
      <Field
        label="Code"
        required
        aside={category === null ? "Never changes" : undefined}
      >
        <Input
          value={code}
          disabled={category !== null}
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      <Field label="Name" required>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Checkbox
        label="Shops can file under it"
        checked={forStores}
        onChange={setForStores}
      />
      <Checkbox
        label="Employees can claim under it"
        hint="A claim type in HR is filed under a category that allows claims."
        checked={forClaims}
        onChange={setForClaims}
      />
      <Checkbox label="Active" checked={active} onChange={setActive} />
      <Field label="Note">
        <Input value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <div className="flex items-center justify-end gap-2">
        {category !== null && (
          <LinkAccountsButton
            role="expense"
            sourceType="EXPENSE_CATEGORY"
            sourceId={category.code}
          />
        )}
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={code.trim() === "" || name.trim() === ""}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </EditorCard>
  )
}
