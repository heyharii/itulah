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
import { Input, Money, Select } from "@/components/ui/field"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, Problem } from "@/components/ui/states"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  financeKeys,
  financeSettingsQuery,
  setFinanceSetting,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useColumnFit } from "@/screens/finance/column-fit"
import { ScreenPending } from "@/screens/finance/pending"
import type { FinanceSetting } from "@itulah/contract"

/// Accounts Settings: the numbers Finance's rules read — tolerances, windows,
/// thresholds and switches — each changed here rather than in a release.
///
/// Every setting is a number with a unit. A `flag` is 0 or 1, an `IDR` is whole
/// rupiah, anything else is typed as the number it is. The server refuses a
/// value its rule cannot use and says why.
const NAMES: Record<string, string> = {
  assistant_monthly_budget_usd: "Assistant monthly budget",
  assistant_brief_hour: "Morning brief hour",
  "sales.discount_accounting": "Discount accounting",
  "payroll.thr_accrual_months": "THR accrual months",
  "store_expense.manager_limit_minor": "Store manager approval limit",
  "store_expense.code_above_minor": "Expense code above",
  "journal.two_person_from_minor": "Two-person journal threshold",
  mdr_tolerance_minor: "MDR tolerance",
  mdr_tolerance_bps: "MDR tolerance (rate)",
  return_window_days: "Return window",
  "sync.publish_payment_methods": "Send payment methods to shops",
}

/// The DB keeps `numeric`, so "12.0000" can come back for 12.
function tidy(value: string): string {
  if (!/^-?\d+\.\d+$/.test(value)) return value
  return value.replace(/\.?0+$/, "")
}

/// The note as the owner reads it: without the migration numbers the server's
/// copy carries for its own reference.
function noteOf(setting: FinanceSetting): string {
  return (setting.note ?? "").replace(/\s*\(\d{4}\)/g, "")
}

function nameOf(setting: FinanceSetting): string {
  return NAMES[setting.setting_key] ?? setting.setting_key
}

/// One setting per row: its name, the control that changes it, and what it
/// does. On a phone the same columns are the card, the control on the card's
/// whole width under the name and the note.
const columns: ColumnDef<TableSetup, FinanceSetting>[] = [
  {
    id: "setting",
    accessorFn: (row) => nameOf(row),
    header: "Setting",
    size: 260,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="font-medium text-ink" title={row.original.setting_key}>
        {nameOf(row.original)}
      </span>
    ),
  },
  {
    id: "value",
    header: "Value",
    size: 340,
    enableSorting: false,
    enableHiding: false,
    meta: { card: "metric" },
    cell: ({ row }) => <SettingControl setting={row.original} />,
  },
  {
    id: "note",
    accessorFn: (row) => noteOf(row),
    header: "What it does",
    size: 420,
    meta: { card: "meta", grow: 240 },
    cell: ({ row }) => (
      <span className="font-normal whitespace-normal text-body">
        {noteOf(row.original)}
      </span>
    ),
  },
]

export function FinanceSettings() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Accounting Masters"
          title="Accounts Settings"
        >
          Reading the settings…
        </ScreenPending>
      }
    >
      <FinanceSettingsScreen />
    </Suspense>
  )
}

function FinanceSettingsScreen() {
  const phone = useLayout() === "phone"
  const list = useSuspenseQuery(financeSettingsQuery())
  const [needle, setNeedle] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])

  const rows = list.data
  const [measure, fit] = useColumnFit(columns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: FinanceSetting) => row.setting_key,
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

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Accounting Masters"
        title="Accounts Settings"
      />

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search settings"
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>

      <DockTools
        search={{
          value: needle,
          onChange: setNeedle,
          label: "Search settings",
        }}
        sort={dockSortOf(table)}
      />

      <div ref={measure}>
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          {queryState(list, {
            render: () =>
              rows.length === 0 ? (
                <EmptyState>No setting is kept on this node.</EmptyState>
              ) : (
                <DataTable<FinanceSetting>
                  table={table}
                  refresh={[list]}
                  empty="No setting matches the search."
                  pageScroll
                  cardsApart
                  cardFiguresBelow
                  cardSort={false}
                  summary={{
                    setting: (
                      <span>
                        {count(table.getRowModel().rows.length)}{" "}
                        <span className="font-normal text-body">settings</span>
                      </span>
                    ),
                  }}
                />
              ),
          })}
        </Card>
      </div>
    </PageContent>
  )
}

/// The control that changes one setting: the value, its unit and Submit.
function SettingControl({ setting }: { setting: FinanceSetting }) {
  const client = useQueryClient()
  const current = tidy(setting.value)
  const [draft, setDraft] = useState(current)

  const save = useMutation({
    mutationFn: () => setFinanceSetting(setting.setting_key, { value: draft }),
    onSuccess: (saved) => {
      client.setQueryData<FinanceSetting[]>(financeKeys.settings(), (was) =>
        (was ?? []).map((one) =>
          one.setting_key === saved.setting_key ? saved : one
        )
      )
      setDraft(tidy(saved.value))
    },
  })

  const changed = draft.trim() !== current && draft.trim() !== ""

  return (
    <>
      <div className="flex items-center gap-2">
        {setting.unit === "flag" ? (
          <Select
            value={draft}
            onChange={setDraft}
            className="h-8 w-36"
            aria-label={setting.setting_key}
          >
            <option value="0">Off</option>
            <option value="1">On</option>
          </Select>
        ) : setting.unit === "IDR" ? (
          <Money
            value={draft}
            onChange={setDraft}
            prefix="Rp"
            className="h-8 w-36"
            label={setting.setting_key}
          />
        ) : (
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            inputMode="decimal"
            className="h-8 w-24"
            aria-label={setting.setting_key}
          />
        )}
        {setting.unit !== "flag" && setting.unit !== "IDR" && (
          <span className="shrink-0 text-mute">{setting.unit}</span>
        )}
        <Button
          size="sm"
          variant={changed ? "primary" : "quiet"}
          pending={save.isPending}
          disabled={!changed}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>
      <Problem error={save.error} className="mt-1.5" />
    </>
  )
}
