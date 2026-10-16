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
import { FilterSheet } from "@/components/ui/filter-sheet"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, Problem } from "@/components/ui/states"
import { count, label } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  assetClassesQuery,
  financeKeys,
  saveAssetClass,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useColumnFit } from "@/screens/finance/column-fit"
import {
  EditorCard,
  LinkAccountsButton,
  MasterLayout,
} from "@/screens/finance/master-parts"
import { ScreenPending } from "@/screens/finance/pending"
import type { AssetClass } from "@itulah/contract"

/// The classes an asset is filed under (ERPNext Asset Category).
///
/// A class carries three answers: its kind (what the books call it), its build
/// (which form GA fills in for one), and the life and method an assessment
/// starts from. Its accounts are account links the class code narrows — cost,
/// accumulated depreciation, the charge — so "Link accounts" opens the cost
/// role with the class as its qualifier, and the others are beside it there.
const KINDS = ["PPE", "OE", "INTANGIBLE", "DEFERRED"] as const
const BUILDS = [
  "LAND",
  "BUILDING",
  "TECH",
  "VEHICLE",
  "FFE",
  "IT",
  "AUDIO",
  "OE",
  "SOFTWARE",
  "DEFERRED",
  "CIP",
] as const
const METHODS = ["STRAIGHT_LINE", "DECLINING", "NONE"] as const

/// The cost role a class's links answer first; the charge and the contra sit
/// beside it on Account links. A deferred cost (pre-opening) is amortised like
/// an intangible, so it answers to the same three roles: intangible_asset,
/// accumulated_amortisation, amortisation_expense (domain/depreciation.rs).
function costRole(kind: string): string | null {
  if (kind === "INTANGIBLE" || kind === "DEFERRED") return "intangible_asset"
  if (kind === "PPE" || kind === "OE") return "fixed_asset"
  return null
}

function lifeWords(months: number | null): string {
  if (months === null) return "—"
  if (months % 12 === 0) return `${months / 12} yr`
  return `${months} mo`
}

/// One class per row. On a phone the same columns are the card: the name over
/// its kind and form, the depreciation and the asset count under it, and the
/// Link accounts button at the right.
const columns: ColumnDef<TableSetup, AssetClass>[] = [
  {
    accessorKey: "name",
    header: "Category",
    size: 300,
    meta: { card: "title", grow: 200 },
    // The code rides as the name's title: it is what the chart links key on,
    // not what anyone reads.
    cell: ({ row }) => (
      <span className="flex items-center gap-2 whitespace-normal">
        <span className="text-ink" title={row.original.class_code}>
          {row.original.name}
        </span>
        {!row.original.is_active && <Pill tone="neutral">Inactive</Pill>}
      </span>
    ),
  },
  {
    id: "kind",
    // What it is, once: kind and form together, not two columns of the same
    // two words.
    accessorFn: (row) => `${label(row.kind)} · ${label(row.build)}`,
    header: "Kind",
    size: 200,
    meta: { card: "meta" },
    cell: ({ row }) =>
      `${label(row.original.kind)} · ${label(row.original.build)}`,
  },
  {
    id: "depreciation",
    accessorFn: (row) =>
      row.default_method === null
        ? "Not set"
        : `${label(row.default_method)} · ${lifeWords(row.default_useful_life_months)}`,
    header: "Depreciation",
    size: 240,
    meta: { card: "metric" },
    cell: ({ row }) =>
      row.original.default_method === null ? (
        <span className="text-mute">Not set</span>
      ) : (
        `${label(row.original.default_method)} · ${lifeWords(row.original.default_useful_life_months)}`
      ),
  },
  {
    accessorKey: "asset_count",
    header: "Assets",
    size: 110,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <span className={row.original.asset_count === 0 ? "text-faint" : ""}>
        {count(row.original.asset_count)}
      </span>
    ),
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
        role={costRole(row.original.kind)}
        sourceType="COMPANY"
        sourceId={row.original.class_code}
      />
    ),
  },
]

export function AssetClasses() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Assets" title="Asset Category">
          Reading the asset classes…
        </ScreenPending>
      }
    >
      <AssetClassesScreen />
    </Suspense>
  )
}

function AssetClassesScreen() {
  const phone = useLayout() === "phone"
  const [filtering, setFiltering] = useState(false)
  const list = useSuspenseQuery(assetClassesQuery())
  const classes = list.data.classes as readonly AssetClass[]
  const [editing, setEditing] = useState<AssetClass | "new" | null>(null)
  const [needle, setNeedle] = useState("")
  const [kind, setKind] = useState("")
  const [inactive, setInactive] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])

  const rows = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return (
      classes
        .filter(
          (row) =>
            (inactive || row.is_active) &&
            (kind === "" || row.kind === kind) &&
            (text === "" ||
              row.class_code.toLowerCase().includes(text) ||
              row.name.toLowerCase().includes(text) ||
              (row.legacy_code ?? "").includes(text))
        )
        // The categories that hold assets first: most of the chart's families
        // have none yet, and the ones in use should not be found by scrolling.
        .sort(
          (a, b) =>
            b.asset_count - a.asset_count || a.name.localeCompare(b.name)
        )
    )
  }, [classes, needle, kind, inactive])

  const [measure, fit] = useColumnFit(columns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: AssetClass) => row.class_code,
        state: {
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: fit.onChange,
      }),
      // `fit` is new each render: the room is measured, and the columns the
      // card has no room for are given up.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [rows, sorting, phone, fit]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Assets"
        title="Asset Category"
        // The new class is the dock's + on a phone.
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={() => setEditing("new")}>
              New class
            </Button>
          )
        }
      />

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search classes"
        />
        <Select
          value={kind}
          onChange={setKind}
          className="h-control w-40"
          aria-label="Kind"
        >
          <option value="">All kinds</option>
          {KINDS.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </Select>
        <Checkbox
          label="Show inactive"
          checked={inactive}
          onChange={setInactive}
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>

      <Fab label="New class" onClick={() => setEditing("new")} />
      <DockTools
        search={{
          value: needle,
          onChange: setNeedle,
          label: "Search classes",
        }}
        filter={{
          count: inactive ? 1 : 0,
          onOpen: () => setFiltering(true),
        }}
        sort={dockSortOf(table)}
        status={{
          value: kind,
          options: [
            { value: "", label: "All kinds" },
            ...KINDS.map((one) => ({ value: one, label: one })),
          ],
          onChange: setKind,
        }}
      />
      <FilterSheet open={filtering} onOpenChange={setFiltering}>
        <Checkbox
          label="Show inactive"
          checked={inactive}
          onChange={setInactive}
        />
      </FilterSheet>

      <MasterLayout
        list={
          <div ref={measure}>
            <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
              {queryState(list, {
                render: () =>
                  rows.length === 0 ? (
                    <EmptyState>No class matches the search.</EmptyState>
                  ) : (
                    <DataTable<AssetClass>
                      table={table}
                      refresh={[list]}
                      onRowClick={(row) => setEditing(row)}
                      isSelected={(row) =>
                        editing !== null &&
                        editing !== "new" &&
                        editing.class_code === row.class_code
                      }
                      pageScroll
                      cardsApart
                      cardSort={false}
                      summary={{
                        name: (
                          <span>
                            {count(rows.length)}{" "}
                            <span className="font-normal text-body">
                              {rows.length === 1 ? "class" : "classes"}
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
            <ClassForm
              key={editing === "new" ? "new" : editing.class_code}
              assetClass={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )
        }
      />
    </PageContent>
  )
}

function ClassForm({
  assetClass,
  onDone,
}: {
  assetClass: AssetClass | null
  onDone: () => void
}) {
  const client = useQueryClient()
  const [code, setCode] = useState(assetClass?.class_code ?? "")
  const [name, setName] = useState(assetClass?.name ?? "")
  const [kind, setKind] = useState(assetClass?.kind ?? "PPE")
  const [build, setBuild] = useState(assetClass?.build ?? "FFE")
  const [life, setLife] = useState(
    assetClass?.default_useful_life_months == null
      ? ""
      : String(assetClass.default_useful_life_months)
  )
  const [method, setMethod] = useState(assetClass?.default_method ?? "")
  const [active, setActive] = useState(assetClass?.is_active ?? true)

  const months = life.trim() === "" ? null : Number.parseInt(life, 10)
  const lifeValid = months === null || (Number.isInteger(months) && months > 0)

  const save = useMutation({
    mutationFn: () =>
      saveAssetClass({
        class_code: code.trim().toUpperCase(),
        name: name.trim(),
        kind,
        build,
        default_useful_life_months: months,
        default_method: method === "" ? null : method,
        is_active: active,
      }),
    onSuccess: (classes) => {
      client.setQueryData(financeKeys.assetClasses(), classes)
      onDone()
    },
  })

  return (
    <EditorCard
      title={
        assetClass === null
          ? "New asset class"
          : `Edit ${assetClass.class_code}`
      }
      onClose={onDone}
    >
      <Problem error={save.error} />
      <Field
        label="Code"
        required
        aside={assetClass === null ? "Never changes" : undefined}
      >
        <Input
          value={code}
          disabled={assetClass !== null}
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      <Field
        label="Name"
        required
        hint="The client's own name, never translated."
      >
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind">
          <Select value={kind} onChange={setKind}>
            {KINDS.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Registered on">
          <Select value={build} onChange={setBuild}>
            {BUILDS.map((one) => (
              <option key={one} value={one}>
                {label(one)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Useful life"
          aside="Months"
          problem={lifeValid ? undefined : "A whole number of months."}
        >
          <Input
            value={life}
            inputMode="numeric"
            onChange={(event) => setLife(event.target.value.replace(/\D/g, ""))}
          />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={setMethod}>
            <option value="">Decided per asset</option>
            {METHODS.map((one) => (
              <option key={one} value={one}>
                {label(one)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Checkbox label="Active" checked={active} onChange={setActive} />
      <div className="flex items-center justify-end gap-2">
        {assetClass !== null && (
          <LinkAccountsButton
            role={costRole(assetClass.kind)}
            sourceType="COMPANY"
            sourceId={assetClass.class_code}
          />
        )}
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={code.trim() === "" || name.trim() === "" || !lifeValid}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </EditorCard>
  )
}
