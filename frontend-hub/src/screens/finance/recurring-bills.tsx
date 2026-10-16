import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { ConfirmButton } from "@/components/ui/dialog"
import { Checkbox, Field, Input, Money } from "@/components/ui/field"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { EmptyState, Problem } from "@/components/ui/states"
import { count, money, percentBps } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  accountDetail,
  billTemplatesQuery,
  financeKeys,
  recordBillTemplate,
  retireBillTemplate,
  type BillTemplateRow,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Code } from "@/screens/finance-final/parts"
import { EXPENSE_LINE_CLASSES } from "@/screens/finance/chart"
import { useCategoryName, useSupplierName } from "@/screens/finance/hooks"
import {
  AccountAndCategory,
  accountChoiceProblem,
  accountChoiceReady,
  SiteName,
  SiteSelect,
  SupplierName,
  SupplierPicker,
  type AccountChoice,
} from "@/screens/finance/parts"
import { ScreenPending } from "@/screens/finance/pending"

/// Recurring Bills: what a supplier is expected to invoice every month.
///
/// The promise and not the paper. A template names the supplier, the expense
/// account and site the cost lands on, the figure expected and the day of the
/// month the bill usually arrives. The cloud's sweep raises a DRAFT bill from
/// each active template every month — posting stays a person's act — and
/// Payment Projection reads the same list to show what is coming before the
/// paper does. The list is the templates' own (`GET /finance/bill-templates`
/// takes no filter; retired ones ride along and are hidden here unless asked
/// for).
///
/// Retiring is the only edit: a promise is written once, and a changed figure
/// is a new promise beside a retired one, so the drafts already raised keep
/// pointing at what was expected when they were.

export function RecurringBills() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Payables" title="Recurring Bills">
          Reading the recurring bills…
        </ScreenPending>
      }
    >
      <RecurringBillsScreen />
    </Suspense>
  )
}

function RecurringBillsScreen() {
  const templates = useSuspenseQuery(billTemplatesQuery())
  const [retired, setRetired] = useState(false)
  const [opened, setOpened] = useState<string | "new" | null>(null)
  const [needle, setNeedle] = useState("")
  const phone = useLayout() === "phone"
  const supplierName = useSupplierName()

  const rows = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return templates.data.filter(
      (row) =>
        (retired || row.active) &&
        (text === "" ||
          [
            row.label,
            supplierName(row.supplier_id, row.supplier_name),
            row.expense_account_code,
            row.note,
          ].some((field) => (field ?? "").toLowerCase().includes(text)))
    )
  }, [templates.data, retired, needle, supplierName])
  const open =
    opened === null || opened === "new"
      ? null
      : (templates.data.find((row) => row.template_id === opened) ?? null)

  /// The promises, and what each is worth every month. On a card the label
  /// names it, who and where follow and the day and the amount stand under it.
  const columns = useMemo<ColumnDef<TableSetup, BillTemplateRow>[]>(
    () => [
      {
        id: "label",
        accessorFn: (row) => row.label,
        header: "Label",
        size: 220,
        enableSorting: false,
        meta: { card: "title", grow: 200 },
        // Prose, so it wraps: at 1440 the table has no slack to spare and a
        // label or an account name is the only thing that can give way without
        // hiding either.
        cell: ({ row }) => (
          <span className="whitespace-normal text-ink">
            {row.original.label}
          </span>
        ),
      },
      {
        id: "supplier",
        accessorFn: (row) => supplierName(row.supplier_id, row.supplier_name),
        header: "Supplier",
        size: 190,
        enableSorting: false,
        meta: { card: "meta" },
        cell: ({ row }) => (
          <span className="whitespace-normal">
            <SupplierName
              id={row.original.supplier_id}
              name={row.original.supplier_name}
            />
          </span>
        ),
      },
      {
        id: "unit",
        accessorFn: (row) => row.site_id,
        header: "Unit",
        size: 130,
        enableSorting: false,
        meta: { card: "meta", priority: 3 },
        cell: ({ row }) => <SiteName id={row.original.site_id} />,
      },
      {
        id: "account",
        accessorFn: (row) => row.expense_account_code,
        header: "Expense account",
        size: 240,
        enableSorting: false,
        meta: { card: "meta", priority: 2 },
        cell: ({ row }) => (
          <span className="whitespace-normal">
            <AccountLabel code={row.original.expense_account_code} />
          </span>
        ),
      },
      {
        id: "day",
        accessorFn: (row) => row.due_day,
        header: "Every month on day",
        size: 170,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) => count(row.original.due_day),
      },
      {
        id: "amount",
        accessorFn: (row) =>
          row.expected_subtotal_minor + row.expected_tax_minor,
        header: "Expected amount",
        size: 150,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) =>
          money(
            row.original.expected_subtotal_minor +
              row.original.expected_tax_minor
          ),
      },
      {
        id: "status",
        accessorFn: (row) => row.active,
        header: "Status",
        size: 110,
        enableSorting: false,
        meta: { card: "status" },
        cell: ({ row }) => (
          <Status tone={row.original.active ? "ok" : "done"}>
            {row.original.active ? "Active" : "Retired"}
          </Status>
        ),
      },
    ],
    [supplierName]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: BillTemplateRow) => row.template_id,
      }),
      [rows, columns]
    )
  )

  return (
    <PageContent>
      {/* The one action stands in the head; a phone has the + at the thumb. */}
      <PageHeader
        crumb="Finance · Payables"
        title="Recurring Bills"
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={() => setOpened("new")}>
              New recurring bill
            </Button>
          )
        }
      />
      <Fab label="New recurring bill" onClick={() => setOpened("new")} />

      <Toolbar className="group/bar">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search recurring bills"
        />
        <Checkbox
          label="Show retired"
          checked={retired}
          onChange={setRetired}
        />
        <Toolbar.Spacer />
        <span className="text-[0.9375rem] text-mute">
          {count(rows.length)}{" "}
          {rows.length === 1 ? "recurring bill" : "recurring bills"}
        </span>
      </Toolbar>

      <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(templates, {
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {needle.trim() !== ""
                  ? `No recurring bill matches “${needle.trim()}”.`
                  : retired || templates.data.length === 0
                    ? "No recurring bill yet. Add the charges a supplier sends every month — rent, internet, freight — and a draft bill is raised for each one."
                    : "Nothing is active. Tick Show retired to see the ones that were stopped."}
              </EmptyState>
            ) : (
              <DataTable<BillTemplateRow>
                refresh={[templates]}
                table={table}
                onRowClick={(row) => setOpened(row.template_id)}
                isSelected={(row) => row.template_id === opened}
                pageScroll
                cardSort={false}
                cardsApart
              />
            ),
        })}
      </Card>

      {opened === "new" && <NewRecurringBill onClose={() => setOpened(null)} />}
      {open !== null && (
        <RecurringBillDetail
          key={open.template_id}
          template={open}
          onClose={() => setOpened(null)}
        />
      )}
    </PageContent>
  )
}

/// An account as its code and the client's own name for it. The row carries
/// only the code, so the name is asked for — once per distinct account,
/// because the templates of a client share a handful.
function AccountLabel({ code }: { code: string }) {
  const account = useQuery({
    queryKey: financeKeys.account(code, null),
    queryFn: ({ signal }) => accountDetail(code, {}, signal),
    staleTime: 5 * 60 * 1000,
  })
  return (
    <>
      <Code>{code}</Code>{" "}
      <span className="ml-1">{account.data?.account.name ?? ""}</span>
    </>
  )
}

// ---------------------------------------------------------------------------
// One recurring bill
// ---------------------------------------------------------------------------

/// The promise read as facts, with the one thing that can be done to it.
function RecurringBillDetail({
  template,
  onClose,
}: {
  template: BillTemplateRow
  onClose: () => void
}) {
  const client = useQueryClient()
  const categoryName = useCategoryName()
  const retire = useMutation({
    mutationFn: () => retireBillTemplate(template.template_id),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: financeKeys.billTemplates() }),
  })

  const facts: readonly [string, React.ReactNode][] = [
    [
      "Supplier",
      <SupplierName
        key="s"
        id={template.supplier_id}
        name={template.supplier_name}
      />,
    ],
    ["Unit", <SiteName key="u" id={template.site_id} />],
    [
      "Expense account",
      <AccountLabel key="a" code={template.expense_account_code} />,
    ],
    [
      "Category",
      template.expense_category_code === null
        ? "—"
        : categoryName(template.expense_category_code),
    ],
    ["Every month on day", count(template.due_day)],
    ["Expected before tax", money(template.expected_subtotal_minor)],
    ["Expected tax", money(template.expected_tax_minor)],
    [
      "Expected amount",
      money(template.expected_subtotal_minor + template.expected_tax_minor),
    ],
    [
      "Tolerance",
      `${percentBps(template.tolerance_bps)} either way before a draft is flagged`,
    ],
    ["Note", template.note ?? "—"],
    ["Recorded by", template.created_by],
  ]

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={template.label}
      caption={template.active ? "Active" : "Retired"}
      size="rail"
      footer={
        <SheetFooter
          onCancel={onClose}
          cancelLabel="Close"
          note={
            template.active
              ? "Drafts already raised stay as they are."
              : undefined
          }
          danger={
            template.active ? (
              <ConfirmButton
                label="Retire"
                variant="danger"
                title="Retire this recurring bill?"
                description="No further draft bill is raised from it and it leaves Payment Projection. Drafts already raised are kept."
                confirmLabel="Retire"
                tone="danger"
                pending={retire.isPending}
                onConfirm={() => retire.mutateAsync()}
              />
            ) : undefined
          }
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Problem error={retire.error} />
        <Facts>
          {facts.map(([term, value]) => (
            <Fact key={term} term={term}>
              {value}
            </Fact>
          ))}
        </Facts>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// New recurring bill
// ---------------------------------------------------------------------------

function NewRecurringBill({ onClose }: { onClose: () => void }) {
  const client = useQueryClient()
  const [label, setLabel] = useState("")
  const [supplier, setSupplier] = useState<{
    supplier_id: string
    name: string
    supplier_code: string
  } | null>(null)
  const [site, setSite] = useState("")
  const [account, setAccount] = useState<AccountChoice | null>(null)
  const [dayOfMonth, setDayOfMonth] = useState("")
  const [subtotal, setSubtotal] = useState("")
  const [tax, setTax] = useState("")
  const [tolerance, setTolerance] = useState("5")
  const [note, setNote] = useState("")

  const save = useMutation({
    mutationFn: () =>
      recordBillTemplate({
        supplier_id: supplier?.supplier_code ?? "",
        supplier_name: supplier?.name ?? null,
        site_id: site,
        expense_account_code: account?.account_code ?? "",
        expense_category_code: account?.category_code ?? null,
        expected_subtotal_minor: Number(subtotal),
        expected_tax_minor: tax === "" ? 0 : Number(tax),
        tolerance_bps: Math.round(Number(tolerance || "0") * 100),
        due_day: Number(dayOfMonth),
        label: label.trim(),
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: financeKeys.billTemplates() })
      onClose()
    },
  })

  const dayValue = Number(dayOfMonth)
  const dayBad =
    dayOfMonth !== "" &&
    (!Number.isInteger(dayValue) || dayValue < 1 || dayValue > 31)
  const toleranceBad =
    tolerance !== "" &&
    (Number.isNaN(Number(tolerance)) ||
      Number(tolerance) < 0 ||
      Number(tolerance) > 100)
  const ready =
    label.trim() !== "" &&
    supplier !== null &&
    site !== "" &&
    accountChoiceReady(account) &&
    dayOfMonth !== "" &&
    !dayBad &&
    subtotal !== "" &&
    Number(subtotal) > 0 &&
    !toleranceBad

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="New recurring bill"
      size="wide"
      footer={
        <SheetFooter
          onCancel={onClose}
          primary={{
            label: "Submit",
            pending: save.isPending,
            disabled: !ready,
            onClick: () => save.mutate(),
          }}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Problem error={save.error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Label" required className="sm:col-span-2">
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
          <Field label="Supplier" required>
            <SupplierPicker
              value={supplier?.supplier_id ?? ""}
              onPick={setSupplier}
            />
          </Field>
          <Field label="Unit" required>
            <SiteSelect
              value={site}
              onChange={setSite}
              emptyLabel="Choose a unit"
            />
          </Field>
          <Field
            label="Expense account"
            required
            className="sm:col-span-2"
            problem={
              account !== null && account.account_code !== ""
                ? accountChoiceProblem(account)
                : undefined
            }
          >
            <AccountAndCategory
              accept={(one) =>
                !one.is_active
                  ? "cancelled"
                  : !EXPENSE_LINE_CLASSES.includes(one.root_class)
                    ? `class ${one.root_class}`
                    : null
              }
              value={account}
              onChange={setAccount}
              categoryLabel="What it is for"
            />
          </Field>
          <Field
            label="Every month on day"
            required
            problem={dayBad ? "A day of the month, 1 to 31." : undefined}
          >
            <Input
              inputMode="numeric"
              value={dayOfMonth}
              onChange={(event) =>
                setDayOfMonth(event.target.value.replace(/\D/g, "").slice(0, 2))
              }
            />
          </Field>
          <Field
            label="Tolerance (%)"
            problem={toleranceBad ? "A percentage, 0 to 100." : undefined}
          >
            <Input
              inputMode="decimal"
              value={tolerance}
              onChange={(event) => setTolerance(event.target.value)}
            />
          </Field>
          <Field label="Expected amount before tax" required>
            <Money value={subtotal} onChange={setSubtotal} prefix="Rp" />
          </Field>
          <Field label="Expected tax">
            <Money value={tax} onChange={setTax} prefix="Rp" />
          </Field>
          <Field label="Note" className="sm:col-span-2">
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </div>
      </div>
    </Sheet>
  )
}
