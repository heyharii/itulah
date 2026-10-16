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
import { Checkbox, Field, Input, Select } from "@/components/ui/field"
import { Fab } from "@/components/ui/fab"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, Problem } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, label, percentBps } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  financeKeys,
  saveTaxTemplate,
  saveTaxType,
  taxTemplatesQuery,
  taxTypesQuery,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useColumnFit } from "@/screens/finance/column-fit"
import { Code } from "@/screens/finance-final/parts"
import { useLocations } from "@/screens/finance/hooks"
import {
  EditorCard,
  LinkAccountsButton,
  MasterLayout,
  YesNo,
} from "@/screens/finance/master-parts"
import { ScreenPending } from "@/screens/finance/pending"
import type { TaxTemplate, TaxType } from "@itulah/contract"

/// Basis points as a rate: 200 → "2%", 250 → "2,5%".
function rateOf(bps: number): string {
  return percentBps(bps)
}

/// A percentage typed by a person, to basis points: "2", "2.5", "2,5".
function bpsOf(text: string): number | null {
  const cleaned = text.trim().replace(",", ".")
  if (cleaned === "") return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0 || value > 100) return null
  return Math.round(value * 100)
}

// ---------------------------------------------------------------------------
// Tax Withholding Category
// ---------------------------------------------------------------------------

/// One category per row. On a phone the same columns are the card: the name
/// over its code and note, the rate and whether it is final under them, and
/// the Link accounts button at the right.
const templateColumns: ColumnDef<TableSetup, TaxTemplate>[] = [
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
    accessorKey: "code",
    header: "Code",
    size: 180,
    meta: { card: "meta" },
    cell: ({ row }) => <Code>{row.original.code}</Code>,
  },
  {
    accessorKey: "rate_bps",
    header: "Rate",
    size: 110,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => rateOf(row.original.rate_bps),
  },
  {
    id: "is_final",
    accessorFn: (row) => (row.is_final ? "Yes" : ""),
    header: "Final",
    size: 110,
    meta: { align: "center", card: "metric" },
    cell: ({ row }) => <YesNo on={row.original.is_final} />,
  },
  {
    accessorKey: "note",
    header: "Note",
    size: 260,
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
        role="withholding_payable"
        sourceType="TAX_TEMPLATE"
        sourceId={row.original.code}
      />
    ),
  },
]

/// What a supplier payment keeps back, and at what rate (ERPNext Tax
/// Withholding Category). The amount kept back is owed to the tax office on
/// an account link — role `withholding_payable`, source the template.
export function TaxWithholding() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Tax Masters"
          title="Tax Withholding Category"
        >
          Reading the withholding categories…
        </ScreenPending>
      }
    >
      <TaxWithholdingScreen />
    </Suspense>
  )
}

function TaxWithholdingScreen() {
  const phone = useLayout() === "phone"
  const list = useSuspenseQuery(taxTemplatesQuery())
  const [editing, setEditing] = useState<TaxTemplate | "new" | null>(null)
  const [needle, setNeedle] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])

  const rows = list.data
  const [measure, fit] = useColumnFit(templateColumns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: templateColumns,
        getRowId: (row: TaxTemplate) => row.code,
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
        crumb="Finance · Tax Masters"
        title="Tax Withholding Category"
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
      />

      <MasterLayout
        list={
          <div ref={measure}>
            <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
              {queryState(list, {
                render: () =>
                  rows.length === 0 ? (
                    <EmptyState>No withholding category yet.</EmptyState>
                  ) : (
                    <DataTable<TaxTemplate>
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
                            {count(rows.length)}{" "}
                            <span className="font-normal text-body">
                              {rows.length === 1 ? "category" : "categories"}
                            </span>
                          </span>
                        ),
                      }}
                    />
                  ),
              })}
            </Card>
          </div>
        }
        editor={
          editing !== null && (
            <TemplateForm
              key={editing === "new" ? "new" : editing.code}
              template={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )
        }
      />
    </PageContent>
  )
}

function TemplateForm({
  template,
  onDone,
}: {
  template: TaxTemplate | null
  onDone: () => void
}) {
  const client = useQueryClient()
  const [code, setCode] = useState(template?.code ?? "")
  const [name, setName] = useState(template?.name ?? "")
  const [rate, setRate] = useState(
    template === null ? "" : String(template.rate_bps / 100)
  )
  const [final, setFinal] = useState(template?.is_final ?? false)
  const [active, setActive] = useState(template?.is_active ?? true)
  const [note, setNote] = useState(template?.note ?? "")

  const bps = bpsOf(rate)

  const save = useMutation({
    mutationFn: () =>
      saveTaxTemplate({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        rate_bps: bps ?? 0,
        is_final: final,
        is_active: active,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: (rows) => {
      client.setQueryData(financeKeys.taxTemplates(), rows)
      onDone()
    },
  })

  return (
    <EditorCard
      title={
        template === null ? "New withholding category" : `Edit ${template.code}`
      }
      onClose={onDone}
    >
      <Problem error={save.error} />
      <Field
        label="Code"
        required
        aside={template === null ? "Never changes" : undefined}
      >
        <Input
          value={code}
          disabled={template !== null}
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      <Field label="Name" required>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field
        label="Rate"
        required
        aside="%"
        problem={
          rate.trim() !== "" && bps === null
            ? "A percentage between 0 and 100."
            : undefined
        }
      >
        <Input
          value={rate}
          inputMode="decimal"
          onChange={(event) => setRate(event.target.value)}
        />
      </Field>
      <Checkbox
        label="Final"
        hint="A final tax settles the supplier's liability; nothing is credited against it later."
        checked={final}
        onChange={setFinal}
      />
      <Checkbox label="Active" checked={active} onChange={setActive} />
      <Field label="Note">
        <Input value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <div className="flex items-center justify-end gap-2">
        {template !== null && (
          <LinkAccountsButton
            role="withholding_payable"
            sourceType="TAX_TEMPLATE"
            sourceId={template.code}
          />
        )}
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={code.trim() === "" || name.trim() === "" || bps === null}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </EditorCard>
  )
}

// ---------------------------------------------------------------------------
// Tax types
// ---------------------------------------------------------------------------

/// One tax per row. On a phone the same columns are the card: the name over
/// its code, what it is under them, and the Link accounts button at the right.
const typeColumns: ColumnDef<TableSetup, TaxType>[] = [
  {
    accessorKey: "name",
    header: "Name",
    size: 300,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => (
      <span className="flex items-center gap-2 whitespace-normal">
        <span className="text-ink">{row.original.name}</span>
        {!row.original.active && <Pill tone="neutral">Inactive</Pill>}
      </span>
    ),
  },
  {
    accessorKey: "code",
    header: "Code",
    size: 160,
    meta: { card: "meta" },
    cell: ({ row }) => <Code>{row.original.code}</Code>,
  },
  {
    accessorKey: "nature",
    header: "Nature",
    size: 150,
    meta: { card: "metric" },
    cell: ({ row }) => label(row.original.nature),
  },
  {
    accessorKey: "semantic_key",
    header: "Role",
    size: 240,
    meta: { card: "metric" },
    cell: ({ row }) => <Tag>{row.original.semantic_key}</Tag>,
  },
  {
    accessorKey: "authority",
    header: "Authority",
    size: 150,
    meta: { card: "metric" },
    cell: ({ row }) => row.original.authority,
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
        role={row.original.semantic_key}
        sourceType="COMPANY"
        sourceId=""
      />
    ),
  },
]

/// The taxes the company owes or claims per period — PPh 21, 23, 25, 29, PPN,
/// PBB — each named by the role its account answers to. Adding one used to
/// take a migration.
export function TaxTypes() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Tax Masters" title="Tax Types">
          Reading the tax types…
        </ScreenPending>
      }
    >
      <TaxTypesScreen />
    </Suspense>
  )
}

function TaxTypesScreen() {
  const list = useSuspenseQuery(taxTypesQuery())
  const [editing, setEditing] = useState<TaxType | "new" | null>(null)
  const phone = useLayout() === "phone"
  const [needle, setNeedle] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])

  const rows = list.data
  const [measure, fit] = useColumnFit(typeColumns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: typeColumns,
        getRowId: (row: TaxType) => row.code,
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
        crumb="Finance · Tax Masters"
        title="Tax Types"
        // The new tax type is the dock's + on a phone.
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={() => setEditing("new")}>
              New tax type
            </Button>
          )
        }
      />

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search tax types"
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>

      <Fab label="New tax type" onClick={() => setEditing("new")} />
      <DockTools
        search={{
          value: needle,
          onChange: setNeedle,
          label: "Search tax types",
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
                    <EmptyState>No tax type yet.</EmptyState>
                  ) : (
                    <DataTable<TaxType>
                      table={table}
                      refresh={[list]}
                      onRowClick={(row) => setEditing(row)}
                      isSelected={(row) =>
                        editing !== null &&
                        editing !== "new" &&
                        editing.code === row.code
                      }
                      empty="No tax type matches the search."
                      pageScroll
                      cardsApart
                      cardSort={false}
                      summary={{
                        name: (
                          <span>
                            {count(rows.length)}{" "}
                            <span className="font-normal text-body">
                              {rows.length === 1 ? "tax type" : "tax types"}
                            </span>
                          </span>
                        ),
                      }}
                    />
                  ),
              })}
            </Card>
          </div>
        }
        editor={
          editing !== null && (
            <TaxTypeForm
              key={editing === "new" ? "new" : editing.code}
              tax={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )
        }
      />
    </PageContent>
  )
}

function TaxTypeForm({
  tax,
  onDone,
}: {
  tax: TaxType | null
  onDone: () => void
}) {
  const client = useQueryClient()
  const roles = useLocations()
  const [code, setCode] = useState(tax?.code ?? "")
  const [name, setName] = useState(tax?.name ?? "")
  const [nature, setNature] = useState(tax?.nature ?? "PAYABLE")
  const [role, setRole] = useState(tax?.semantic_key ?? "")
  const [authority, setAuthority] = useState(tax?.authority ?? "DJP")
  const [active, setActive] = useState(tax?.active ?? true)
  const [note, setNote] = useState(tax?.note ?? "")

  const save = useMutation({
    mutationFn: () =>
      saveTaxType({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        nature,
        semantic_key: role.trim(),
        authority: authority.trim() === "" ? "DJP" : authority.trim(),
        active,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: financeKeys.taxTypes() })
      onDone()
    },
  })

  return (
    <EditorCard
      title={tax === null ? "New tax type" : `Edit ${tax.code}`}
      onClose={onDone}
    >
      <Problem error={save.error} />
      <Field
        label="Code"
        required
        aside={tax === null ? "Never changes" : undefined}
      >
        <Input
          value={code}
          disabled={tax !== null}
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      <Field label="Name" required>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Nature">
        <Select value={nature} onChange={setNature}>
          <option value="PAYABLE">Payable — owed to the tax office</option>
          <option value="CREDIT">Credit — claimed against one</option>
        </Select>
      </Field>
      <Field
        label="Role"
        required
        hint="The posting role its account answers to on Account links."
      >
        <Input
          value={role}
          onChange={(event) => setRole(event.target.value)}
          list="tax-type-roles"
        />
        <datalist id="tax-type-roles">
          {(roles.data?.roles ?? []).map((one) => (
            <option key={one.key} value={one.key}>
              {one.label}
            </option>
          ))}
        </datalist>
      </Field>
      <Field label="Authority">
        <Input
          value={authority}
          onChange={(event) => setAuthority(event.target.value)}
        />
      </Field>
      <Checkbox label="Active" checked={active} onChange={setActive} />
      <Field label="Note">
        <Input value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <div className="flex items-center justify-end gap-2">
        {tax !== null && (
          <LinkAccountsButton
            role={tax.semantic_key}
            sourceType="COMPANY"
            sourceId=""
          />
        )}
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={
            code.trim() === "" || name.trim() === "" || role.trim() === ""
          }
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </EditorCard>
  )
}
