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
import { Checkbox } from "@/components/ui/field"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, Problem } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, label } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  financeKeys,
  payComponentsQuery,
  setPayComponentPosting,
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
import type { PayComponentPosting } from "@itulah/contract"

/// One component per row. On a phone the same columns are the card: the name
/// over its code and kind, what it is under them, and the Link accounts button
/// at the right.
const columns: ColumnDef<TableSetup, PayComponentPosting>[] = [
  {
    accessorKey: "code",
    header: "Code",
    size: 160,
    meta: { card: "meta" },
    cell: ({ row }) => <Code>{row.original.code}</Code>,
  },
  {
    accessorKey: "label",
    header: "Component",
    size: 300,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => (
      <span className="flex items-center gap-2 whitespace-normal">
        <span className="text-ink">{row.original.label}</span>
        {row.original.retired && <Pill tone="neutral">Retired</Pill>}
      </span>
    ),
  },
  {
    accessorKey: "kind",
    header: "Kind",
    size: 110,
    meta: { card: "meta" },
    cell: ({ row }) => label(row.original.kind),
  },
  {
    id: "employer_borne",
    accessorFn: (row) => (row.employer_borne ? "Yes" : ""),
    header: "Employer borne",
    size: 150,
    meta: { align: "center", card: "metric" },
    cell: ({ row }) => <YesNo on={row.original.employer_borne} />,
  },
  {
    id: "paid_from_accrual",
    accessorFn: (row) => (row.paid_from_accrual ? "Yes" : ""),
    header: "From accrual",
    size: 130,
    meta: { align: "center", card: "metric" },
    cell: ({ row }) => <YesNo on={row.original.paid_from_accrual} />,
  },
  {
    accessorKey: "role",
    header: "Role",
    size: 160,
    meta: { card: "metric", priority: 2 },
    cell: ({ row }) => <Tag>{row.original.role}</Tag>,
  },
  {
    accessorKey: "linked_units",
    header: "Account",
    size: 150,
    meta: { card: "metric" },
    cell: ({ row }) => <Reach units={row.original.linked_units} />,
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
        role={row.original.role}
        sourceType="PAY_COMPONENT"
        sourceId={row.original.code}
      />
    ),
  },
]

/// Where each pay component lands: the posting half of a component HR
/// defines.
///
/// HR owns what a component is and how much it pays; Finance owns two facts
/// about how it posts — whether the employer bears it (a BPJS share is a cost
/// and a liability, not a deduction from the employee), and whether it is paid
/// out of an accrual built up month by month (THR) — and its account, which is
/// an account link: role `payroll_expense` for an earning, `payroll_deduction`
/// for a deduction, source the component. A component with no link makes the
/// payroll run that pays it refuse, by name.
export function PayComponents() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Setup" title="Pay Components">
          Reading the pay components…
        </ScreenPending>
      }
    >
      <PayComponentsScreen />
    </Suspense>
  )
}

function PayComponentsScreen() {
  const phone = useLayout() === "phone"
  const list = useSuspenseQuery(payComponentsQuery())
  const [editing, setEditing] = useState<PayComponentPosting | null>(null)
  const [needle, setNeedle] = useState("")
  const [retired, setRetired] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])

  const rows = useMemo(
    () => list.data.filter((row) => retired || !row.retired),
    [list.data, retired]
  )

  const unlinked = rows.filter(
    (row) => !row.retired && row.linked_units === 0
  ).length

  const [measure, fit] = useColumnFit(columns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: PayComponentPosting) => row.code,
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
      <PageHeader crumb="Finance · Setup" title="Pay Components" />

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search components"
        />
        <Checkbox
          label="Show retired"
          checked={retired}
          onChange={setRetired}
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>

      <DockTools
        search={{
          value: needle,
          onChange: setNeedle,
          label: "Search components",
        }}
        sort={dockSortOf(table)}
        status={{
          value: retired ? "all" : "active",
          options: [
            {
              value: "active",
              label: "Active",
              count: list.data.filter((row) => !row.retired).length,
            },
            { value: "all", label: "All", count: list.data.length },
          ],
          onChange: (next) => setRetired(next === "all"),
        }}
      />

      <MasterLayout
        list={
          <div ref={measure}>
            <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
              {queryState(list, {
                render: () =>
                  rows.length === 0 ? (
                    <EmptyState>
                      HR has defined no pay component yet.
                    </EmptyState>
                  ) : (
                    <DataTable<PayComponentPosting>
                      table={table}
                      refresh={[list]}
                      onRowClick={(row) => setEditing(row)}
                      isSelected={(row) => editing?.code === row.code}
                      empty="No component matches the search."
                      pageScroll
                      cardsApart
                      cardSort={false}
                      summary={{
                        label: (
                          <span>
                            {count(shown)}{" "}
                            <span className="font-normal text-body">
                              {shown === 1 ? "component" : "components"}
                            </span>
                          </span>
                        ),
                        linked_units:
                          unlinked > 0 ? (
                            <span className="font-normal text-bad-fg">
                              {count(unlinked)} with no account
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
            <ComponentForm
              key={editing.code}
              component={editing}
              onDone={() => setEditing(null)}
            />
          )
        }
      />
    </PageContent>
  )
}

function ComponentForm({
  component,
  onDone,
}: {
  component: PayComponentPosting
  onDone: () => void
}) {
  const client = useQueryClient()
  const [borne, setBorne] = useState(component.employer_borne)
  const [accrual, setAccrual] = useState(component.paid_from_accrual)

  const save = useMutation({
    mutationFn: () =>
      setPayComponentPosting(component.code, {
        employer_borne: borne,
        paid_from_accrual: accrual,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: financeKeys.payComponents() })
      onDone()
    },
  })

  const changed =
    borne !== component.employer_borne ||
    accrual !== component.paid_from_accrual

  return (
    <EditorCard title={component.label} onClose={onDone}>
      <p className="text-[0.9375rem] text-body">
        <Code>{component.code}</Code> · {label(component.kind)} · answers{" "}
        <Tag>{component.role}</Tag>
      </p>
      <Problem error={save.error} />
      <Checkbox
        label="Employer borne"
        hint="The employer pays it on top of the salary: a cost and a liability, never taken from the employee's pay."
        checked={borne}
        onChange={setBorne}
      />
      <Checkbox
        label="Paid from an accrual"
        hint="Built up month by month and paid out of what was accrued, as THR is — the payment clears the accrual rather than landing as a cost."
        checked={accrual}
        onChange={setAccrual}
      />
      <div className="flex items-center justify-between gap-2 border-t border-hairline pt-3">
        <Reach units={component.linked_units} />
        <span className="flex items-center gap-2">
          <LinkAccountsButton
            role={component.role}
            sourceType="PAY_COMPONENT"
            sourceId={component.code}
          />
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={!changed}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Submitting…" : "Submit"}
          </Button>
        </span>
      </div>
    </EditorCard>
  )
}
