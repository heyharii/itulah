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
import { Checkbox, Field, Input, Money, Select } from "@/components/ui/field"
import { Fab } from "@/components/ui/fab"
import { FilterSheet } from "@/components/ui/filter-sheet"
import { SwitchPill } from "@/components/ui/form"
import { ListFilters } from "@/components/ui/list-filters"
import { BarSpacer, ColumnsMenu } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, Problem } from "@/components/ui/states"
import { useFilterState, type FilterField } from "@/lib/filters"
import { count, label, money, percentBps } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  financeKeys,
  paymentMethodsQuery,
  savePaymentMethod,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useColumnFit } from "@/screens/finance/column-fit"
import { parseMinor } from "@/screens/finance/chart"
import {
  EditorCard,
  LinkAccountsButton,
  MasterLayout,
} from "@/screens/finance/master-parts"
import { ScreenPending } from "@/screens/finance/pending"
import type { PaymentMethodSetting } from "@itulah/contract"

/// The tenders the company accepts, through which bank or scheme, how each
/// settles and at what MDR (ERPNext Mode of Payment).
///
/// A new e-wallet or a new bank's EDC is a row here and its links, not a
/// release. The tender type is the grammar the day posting knows; the
/// accounts are account links narrowed by the method's bank — the company's
/// own links, qualified by `bank_code` — so "Link accounts" opens those.
const TENDERS = [
  "CASH",
  "DEBIT_CARD",
  "CREDIT_CARD",
  "QRIS",
  "EWALLET",
  "VOUCHER",
  "POINTS",
  "BENEFIT",
] as const

const SETTLEMENTS = [
  "IN_DRAWER",
  "VIA_RECEIVABLE",
  "DIRECT_TO_BANK",
  "NONE",
] as const

const NEEDS_BANK = new Set(["DEBIT_CARD", "CREDIT_CARD", "QRIS", "EWALLET"])

/// Basis points as a person reads a rate: 150 → "1,5%".
function percentOfBps(bps: number): string {
  return percentBps(bps)
}

/// One method per row. On a phone the same columns are the card: the name
/// over its type, bank and way of settling, the rate and the shops under it,
/// and the accounts button (or "Linked") at the right.
const columns: ColumnDef<TableSetup, PaymentMethodSetting>[] = [
  {
    accessorKey: "name",
    header: "Mode of Payment",
    size: 280,
    meta: { card: "title", grow: 200 },
    cell: ({ row }) => (
      <span className="flex items-center gap-2 whitespace-normal">
        <span className="text-ink">{row.original.name}</span>
        {!row.original.is_active && <Pill tone="neutral">Inactive</Pill>}
      </span>
    ),
  },
  {
    accessorKey: "tender_type",
    header: "Type",
    size: 160,
    meta: { card: "meta" },
    cell: ({ row }) => label(row.original.tender_type),
  },
  {
    accessorKey: "bank_code",
    header: "Bank",
    size: 130,
    meta: { card: "meta" },
    cell: ({ row }) =>
      row.original.bank_code === "" ? (
        <span className="text-faint">—</span>
      ) : (
        row.original.bank_code
      ),
  },
  {
    accessorKey: "settlement_mode",
    header: "Settles",
    size: 170,
    meta: { card: "meta" },
    cell: ({ row }) => label(row.original.settlement_mode),
  },
  {
    id: "point",
    accessorFn: (row) =>
      row.point_value_minor === null
        ? null
        : `One point is ${money(row.point_value_minor)}`,
    header: "Point value",
    size: 190,
    meta: { card: "meta", priority: 3 },
    cell: ({ row }) =>
      row.original.point_value_minor === null ? (
        <span className="text-faint">—</span>
      ) : (
        `One point is ${money(row.original.point_value_minor)}`
      ),
  },
  {
    id: "mdr",
    accessorFn: (row) => (row.mdr_bps === 0 ? null : row.mdr_bps),
    header: "MDR",
    size: 100,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) =>
      row.original.mdr_bps === 0 ? (
        <span className="text-faint">—</span>
      ) : (
        percentOfBps(row.original.mdr_bps)
      ),
  },
  {
    id: "shops",
    accessorFn: (row) => row.site_ids.length,
    header: "Shops",
    size: 100,
    meta: { align: "right", card: "metric" },
    // Which shops take it is set per shop, on Shop payment methods; none
    // means no till offers it.
    cell: ({ row }) =>
      row.original.site_ids.length === 0 ? (
        <span className="text-faint" title="No shop takes this method yet">
          0
        </span>
      ) : (
        count(row.original.site_ids.length)
      ),
  },
  {
    id: "accounts",
    accessorFn: (row) => row.unlinked_roles.length,
    header: "Accounts",
    size: 170,
    meta: { align: "right", card: "status" },
    // Only a method that cannot post yet asks for anything here; the rest are
    // linked, and their accounts are one click away in the form.
    cell: ({ row }) =>
      row.original.unlinked_roles.length > 0 ? (
        <LinkAccountsButton
          role={row.original.unlinked_roles[0]}
          sourceType="COMPANY"
          sourceId={row.original.bank_code}
        />
      ) : (
        <span className="text-mute">Linked</span>
      ),
  },
]

export function PaymentMethods() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Payments" title="Mode of Payment">
          Reading the payment methods…
        </ScreenPending>
      }
    >
      <PaymentMethodsScreen />
    </Suspense>
  )
}

function PaymentMethodsScreen() {
  const phone = useLayout() === "phone"
  const [filtering, setFiltering] = useState(false)
  const list = useSuspenseQuery(paymentMethodsQuery())
  const [editing, setEditing] = useState<PaymentMethodSetting | "new" | null>(
    null
  )
  const [inactive, setInactive] = useState(false)
  // ERPNext's own standard filter on Mode of Payment — Type.
  const fields = useMemo<FilterField[]>(
    () => [
      {
        column: "tender",
        label: "Type",
        spec: {
          kind: "option",
          single: true,
          operators: ["isAnyOf"],
          format: label,
        },
      },
    ],
    []
  )
  const typeFilters = useFilterState(fields)
  const tender =
    typeFilters.filters.find((one) => one.column === "tender")?.values[0] ?? ""
  const setTender = (next: string) =>
    typeFilters.set(
      next === ""
        ? []
        : [{ column: "tender", operator: "isAnyOf", values: [next] }]
    )
  const withCounts = useMemo(
    () =>
      fields.map((field) => {
        const held = new Map<string, number>()
        for (const row of list.data)
          held.set(row.tender_type, (held.get(row.tender_type) ?? 0) + 1)
        return {
          ...field,
          spec: {
            ...field.spec,
            counted: [...held].map(([value, n]) => ({ value, count: n })),
          },
        }
      }),
    [fields, list.data]
  )
  const [needle, setNeedle] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])

  const rows = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return list.data
      .filter((row) => inactive || row.is_active)
      .filter((row) => tender === "" || row.tender_type === tender)
      .filter(
        (row) =>
          text === "" ||
          row.name.toLowerCase().includes(text) ||
          row.code.toLowerCase().includes(text) ||
          row.bank_code.toLowerCase().includes(text)
      )
  }, [list.data, inactive, tender, needle])
  const unready = list.data.filter(
    (row) => row.is_active && row.unlinked_roles.length > 0
  ).length

  const [measure, fit] = useColumnFit(columns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: PaymentMethodSetting) => row.code,
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
        crumb="Finance · Payments"
        title="Mode of Payment"
        // The new method is the dock's + on a phone.
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={() => setEditing("new")}>
              New method
            </Button>
          )
        }
      />

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ListFilters
          model={{ ...typeFilters, fields: withCounts }}
          search={{
            value: needle,
            onChange: setNeedle,
            label: "Search methods",
          }}
        />
        <SwitchPill
          on={inactive}
          label="Show inactive"
          onToggle={() => setInactive(!inactive)}
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>

      <Fab label="New method" onClick={() => setEditing("new")} />
      <DockTools
        search={{
          value: needle,
          onChange: setNeedle,
          label: "Search methods",
        }}
        filter={{
          count: inactive ? 1 : 0,
          onOpen: () => setFiltering(true),
        }}
        sort={dockSortOf(table)}
        status={{
          value: tender,
          options: [
            { value: "", label: "All types" },
            ...TENDERS.map((one) => ({ value: one, label: label(one) })),
          ],
          onChange: setTender,
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
                    <EmptyState>
                      {needle.trim() === "" && tender === ""
                        ? "No payment method yet. A sales day cannot post a tender nobody declared."
                        : "No payment method matches the search and filters."}
                    </EmptyState>
                  ) : (
                    <DataTable<PaymentMethodSetting>
                      table={table}
                      refresh={[list]}
                      onRowClick={(row) => setEditing(row)}
                      isSelected={(row) =>
                        editing !== null &&
                        editing !== "new" &&
                        editing.code === row.code
                      }
                      pageScroll
                      cardsApart
                      cardSort={false}
                      summary={{
                        name: (
                          <span>
                            {count(rows.length)}{" "}
                            <span className="font-normal text-body">
                              {rows.length === 1 ? "method" : "methods"}
                            </span>
                          </span>
                        ),
                        accounts:
                          unready > 0 ? (
                            <span className="font-normal text-bad-fg">
                              {count(unready)} cannot post a day yet
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
            <MethodForm
              key={editing === "new" ? "new" : editing.code}
              method={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )
        }
      />
    </PageContent>
  )
}

function MethodForm({
  method,
  onDone,
}: {
  method: PaymentMethodSetting | null
  onDone: () => void
}) {
  const client = useQueryClient()
  const [code, setCode] = useState(method?.code ?? "")
  const [name, setName] = useState(method?.name ?? "")
  const [tender, setTender] = useState(method?.tender_type ?? "DEBIT_CARD")
  const [bank, setBank] = useState(method?.bank_code ?? "")
  // "" is the tender's own default, which the server picks.
  const [settlement, setSettlement] = useState(method?.settlement_mode ?? "")
  const [mdr, setMdr] = useState(String(method?.mdr_bps ?? 0))
  const [pointValue, setPointValue] = useState(
    method?.point_value_minor === null || method === null
      ? ""
      : String(method.point_value_minor)
  )
  const [active, setActive] = useState(method?.is_active ?? true)
  const [note, setNote] = useState(method?.note ?? "")

  const mdrBps = Number.parseInt(mdr.trim() === "" ? "0" : mdr, 10)
  const mdrValid = Number.isInteger(mdrBps) && mdrBps >= 0 && mdrBps <= 10000

  const save = useMutation({
    mutationFn: () =>
      savePaymentMethod({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        tender_type: tender,
        bank_code: bank.trim().toUpperCase(),
        settlement_mode: settlement === "" ? null : settlement,
        mdr_bps: mdrBps,
        point_value_minor: tender === "POINTS" ? parseMinor(pointValue) : null,
        is_active: active,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: financeKeys.paymentMethods() })
      onDone()
    },
  })

  const bankMissing = NEEDS_BANK.has(tender) && bank.trim() === ""

  return (
    <EditorCard
      title={method === null ? "New payment method" : `Edit ${method.code}`}
      onClose={onDone}
    >
      <Problem error={save.error} />
      <Field
        label="Code"
        required
        aside={method === null ? "Never changes" : undefined}
      >
        <Input
          value={code}
          disabled={method !== null}
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      <Field label="Name" required>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Tender">
        <Select value={tender} onChange={setTender}>
          {TENDERS.map((one) => (
            <option key={one} value={one}>
              {label(one)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Bank, scheme or provider"
        required={NEEDS_BANK.has(tender)}
        aside={NEEDS_BANK.has(tender) ? undefined : "Not used"}
        hint="The qualifier its account links are narrowed by, e.g. BCA."
      >
        <Input
          value={bank}
          onChange={(event) => setBank(event.target.value.toUpperCase())}
          disabled={!NEEDS_BANK.has(tender) && bank === ""}
        />
      </Field>
      <Field label="Settles">
        <Select value={settlement} onChange={setSettlement}>
          <option value="">Default for the tender</option>
          {SETTLEMENTS.map((one) => (
            <option key={one} value={one}>
              {label(one)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="MDR"
        aside={mdrValid ? percentOfBps(mdrBps) : undefined}
        problem={mdrValid ? undefined : "Basis points, 0 to 10,000."}
        hint="In basis points: 150 is 1.50%."
      >
        <Input
          value={mdr}
          inputMode="numeric"
          onChange={(event) => setMdr(event.target.value.replace(/\D/g, ""))}
        />
      </Field>
      {tender === "POINTS" && (
        <Field label="Value of one point">
          <Money value={pointValue} onChange={setPointValue} prefix="Rp" />
        </Field>
      )}
      <Checkbox label="Active" checked={active} onChange={setActive} />
      <Field label="Note">
        <Input value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <div className="flex items-center justify-end gap-2">
        {method !== null && method.roles.length > 0 && (
          <LinkAccountsButton
            role={method.unlinked_roles[0] ?? method.roles[0]}
            sourceType="COMPANY"
            sourceId={method.bank_code}
          />
        )}
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={
            code.trim() === "" || name.trim() === "" || bankMissing || !mdrValid
          }
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </EditorCard>
  )
}
