import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"
import {
  Banknote,
  CircleDot,
  Droplet,
  Ellipsis,
  Fuel,
  Monitor,
  Plus,
  Receipt,
  Wrench,
  Zap,
} from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { ConfirmButton } from "@/components/ui/dialog"
import { Choices } from "@/components/ui/form"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Pill, Status } from "@/components/ui/pill"
import { MiniCell, MiniTable, SheetSection } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SheetEmpty, SheetQuery } from "@/components/ui/sheet-states"
import { today } from "@/lib/calendar"
import { EMPTY, day, money } from "@/lib/format"
import { listCashDocuments } from "@/lib/queries/cash-documents"
import { listBills } from "@/lib/queries/finance"
import { gaKeys } from "@/lib/queries/ga"
import {
  OPERATING_EXPENSE_KINDS,
  cancelOperatingExpense,
  expenseKindWord,
  linkOperatingExpense,
  recordOperatingExpense,
  submitOperatingExpense,
  type GaOperatingExpensePage,
  type GaOperatingExpenseRow,
} from "@/lib/queries/ga-records"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { procurementKeys, supplierPage } from "@/lib/queries/procurement"
import { toast } from "@/lib/toast"
import {
  blank,
  expenseDetail,
  expenseOdometer,
  expenseQuantity,
  expenseStatus,
  left,
  right,
} from "@/screens/assets/asset-words"
import {
  NameCell,
  OpenRow,
  SectionAside,
  TextAction,
} from "@/screens/assets/asset-sections"
import type { GaAssetRow } from "@itulah/contract"

/// What it costs to run the asset: fuel, oil, tyres, the small things that
/// have no repair or service of their own.
///
/// # Why repairs and services are not offered here
///
/// A repair and a service bill from their own record, and an expense for the
/// same money would be counted twice in Finance. This is for the running costs
/// that GA records one line at a time, for Finance to turn into a bill.

/// The glyph of each kind: the tile in the form and the mark beside the row.
export const EXPENSE_KIND_ICON: Readonly<
  Record<string, React.ComponentType<{ className?: string }>>
> = {
  FUEL: Fuel,
  OIL: Droplet,
  TYRES_PARTS: CircleDot,
  GENSET_FUEL: Zap,
  COMPUTER: Monitor,
  TOOLS: Wrench,
  OTHER: Ellipsis,
}

const UNIT_OF_KIND: Readonly<Record<string, string>> = {
  FUEL: "L",
  OIL: "L",
  GENSET_FUEL: "L",
  TYRES_PARTS: "pcs",
}

// ── the section ─────────────────────────────────────────────────────────────

export function ExpensesSection({
  expenses,
  onOpen,
  onAdd,
}: {
  expenses: UseQueryResult<GaOperatingExpensePage>
  onOpen: (expenseId: string) => void
  onAdd: () => void
}) {
  const page = expenses.data
  // The total of what still counts. The server's own figure is used only when
  // the list was cut short and the rows cannot be summed.
  const total = useMemo(() => {
    if (page === undefined) return undefined
    if (page.rows.length < page.total) return page.amount_total_minor
    return page.rows
      .filter((one) => one.status !== "CANCELLED")
      .reduce((sum, one) => sum + one.amount_minor, 0)
  }, [page])

  return (
    <SheetSection
      title="Operating expenses"
      aside={
        <SectionAside total={total === undefined ? undefined : money(total)}>
          <TextAction aria-label="Add expense" onClick={onAdd}>
            <Plus />
            Expense
          </TextAction>
        </SectionAside>
      }
    >
      <SheetQuery query={expenses} what="expenses">
        {(loaded) =>
          loaded.rows.length === 0 ? (
            <SheetEmpty>No expenses yet.</SheetEmpty>
          ) : (
            <MiniTable
              head={["Date", left("What"), right("Amount"), left("Status")]}
            >
              {loaded.rows.map((row) => {
                const state = expenseStatus(row)
                return (
                  <OpenRow
                    key={row.expense_id}
                    onOpen={() => onOpen(row.expense_id)}
                  >
                    <MiniCell>{day(row.spent_on)}</MiniCell>
                    <MiniCell>
                      <NameCell
                        icon={EXPENSE_KIND_ICON[row.kind] ?? Ellipsis}
                        name={`${expenseKindWord(row.kind)} · ${row.description}`}
                        quiet={expenseDetail(row)}
                      />
                    </MiniCell>
                    <MiniCell align="right">
                      <span
                        className={
                          row.status === "CANCELLED" ? "text-mute" : undefined
                        }
                      >
                        {money(row.amount_minor)}
                      </span>
                    </MiniCell>
                    <MiniCell>
                      <Status tone={state.tone} className="whitespace-normal">
                        {state.word}
                      </Status>
                    </MiniCell>
                  </OpenRow>
                )
              })}
            </MiniTable>
          )
        }
      </SheetQuery>
    </SheetSection>
  )
}

// ── Record expense ──────────────────────────────────────────────────────────

/// Recording one expense against this asset. The site and the asset are the
/// asset's own and are not asked.
///
/// The supplier is optional here and required to send the expense on: what is
/// bought at a pump is often recorded on the spot and billed later, and the
/// person at the pump may not know the supplier's name.
export function RecordExpenseSheet({
  asset,
  siteName,
  open,
  onClose,
}: {
  asset: GaAssetRow
  /// The asset's site as people say it.
  siteName: string
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const vehicle = asset.build === "VEHICLE"
  const [form, setForm] = useState<Record<string, string>>({
    kind: vehicle ? "FUEL" : "OTHER",
    unit: vehicle ? "L" : "",
    spent_on: today(),
  })
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  const vendors = useQuery({
    queryKey: [...procurementKeys.suppliers(), "book", "EXPENSE"],
    queryFn: ({ signal }) => supplierPage({ category: "EXPENSE" }, signal),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const quantity = (form.quantity ?? "").trim().replace(",", ".")

  const save = useMutation({
    mutationFn: () =>
      recordOperatingExpense({
        site_id: asset.site_id,
        asset_id: asset.asset_id,
        kind: form.kind ?? "OTHER",
        spent_on: form.spent_on ?? "",
        description: (form.description ?? "").trim(),
        quantity: quantity === "" ? null : quantity,
        unit: quantity === "" ? null : blank(form.unit),
        odometer_km:
          vehicle && (form.odometer ?? "") !== ""
            ? Number(form.odometer)
            : null,
        amount_minor: Number(form.amount ?? 0),
        supplier_id: blank(form.vendor),
        receipt_number: blank(form.receipt),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      toast.success("Expense recorded")
      onClose()
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if ((form.description ?? "").trim() === "")
      next.description = "Write what it was first."
    if (!(Number(form.amount ?? 0) > 0)) next.amount = "Enter the amount."
    if ((form.spent_on ?? "") === "") next.spent_on = "Choose the date."
    if (quantity !== "" && !(Number(quantity) > 0))
      next.quantity = "Enter a number."
    if (Object.keys(next).length > 0) {
      setProblems(next)
      return
    }
    save.mutate()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context={asset.asset_number}
      title="Record expense"
      dirty={(form.description ?? "").trim() !== ""}
      footer={
        <SheetFooter
          error={save.error}
          onCancel={onClose}
          primary={{
            label: "Record expense",
            pendingLabel: "Recording…",
            pending: save.isPending,
            onClick: submit,
          }}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Facts>
          <Fact term="Asset">{asset.name}</Fact>
          <Fact term="Site">{siteName}</Fact>
        </Facts>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <span className="field-label text-[0.9375rem] text-mute">Kind</span>
            <Choices
              label="Kind"
              columns={2}
              className="grid-cols-2"
              value={form.kind ?? "OTHER"}
              onChange={(next) => {
                set("kind", next)
                // The unit the kind is bought in, unless one was chosen.
                const unit = UNIT_OF_KIND[next]
                if ((form.unit ?? "") === "" && unit !== undefined) {
                  set("unit", unit)
                }
              }}
              options={OPERATING_EXPENSE_KINDS.map((one) => ({
                value: one.value,
                label: one.label,
                icon: EXPENSE_KIND_ICON[one.value],
              }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Field
              label="What"
              required
              problem={problems.description || undefined}
            >
              <Input
                value={form.description ?? ""}
                onChange={(event) => set("description", event.target.value)}
              />
            </Field>
          </div>
          <Field label="Date" required problem={problems.spent_on || undefined}>
            <Day
              value={form.spent_on ?? ""}
              onChange={(next) => set("spent_on", next)}
              clearable={false}
            />
          </Field>
          <Field label="Amount" required problem={problems.amount || undefined}>
            <Money
              prefix="Rp"
              value={form.amount ?? ""}
              onChange={(next) => set("amount", next)}
            />
          </Field>
          <Field label="Quantity" problem={problems.quantity || undefined}>
            <Input
              inputMode="decimal"
              value={form.quantity ?? ""}
              onChange={(event) => set("quantity", event.target.value)}
            />
          </Field>
          <Field label="Unit">
            <Select
              value={form.unit ?? ""}
              onChange={(next) => set("unit", next)}
              aria-label="Unit"
            >
              <option value="">—</option>
              <option value="L">L</option>
              <option value="pcs">pcs</option>
            </Select>
          </Field>
          {/* Odometer and receipt pair up on a vehicle; anything else has
              only the receipt, beside Sold by. */}
          {vehicle && (
            <Field label="Odometer">
              <Money
                suffix="km"
                value={form.odometer ?? ""}
                onChange={(next) => set("odometer", next)}
              />
            </Field>
          )}
          <Field label="Receipt no.">
            <Input
              value={form.receipt ?? ""}
              onChange={(event) => set("receipt", event.target.value)}
            />
          </Field>
          <div className={vehicle ? "sm:col-span-2" : undefined}>
            <Field label="Sold by">
              <Select
                value={form.vendor ?? ""}
                onChange={(next) => set("vendor", next)}
                aria-label="Sold by"
              >
                <option value="">Not known yet</option>
                {(vendors.data?.rows ?? []).map((one) => (
                  <option key={one.supplier_id} value={one.supplier_id}>
                    {one.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </div>
    </Sheet>
  )
}

// ── one expense ─────────────────────────────────────────────────────────────

/// One expense: its facts, and while it is only Recorded the three things GA
/// can do with it. Sending it hands Finance a DRAFT bill; linking points it at
/// the bill or BKK Finance already made; cancelling keeps it in the list,
/// struck, with the reason.
export function ExpenseSheet({
  expenseId,
  rows,
  open,
  onClose,
}: {
  expenseId: string | null
  rows: readonly GaOperatingExpenseRow[]
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const nameOf = useNameOfLogin()
  const expense = rows.find((one) => one.expense_id === expenseId)
  const [linking, setLinking] = useState(false)
  // Sending an expense recorded without a seller asks for one first: a bill
  // needs a seller, and this is the moment somebody knows.
  const [choosingSeller, setChoosingSeller] = useState(false)
  const [seller, setSeller] = useState("")
  const [kind, setKind] = useState<"BILL" | "BKK">("BILL")
  const [target, setTarget] = useState("")
  const vendors = useQuery({
    queryKey: [...procurementKeys.suppliers(), "book", "EXPENSE"],
    queryFn: ({ signal }) => supplierPage({ category: "EXPENSE" }, signal),
    enabled: choosingSeller,
  })

  const refresh = () => {
    void client.invalidateQueries({ queryKey: gaKeys.all })
  }
  const send = useMutation({
    mutationFn: () =>
      submitOperatingExpense(
        expenseId ?? "",
        seller === "" ? {} : { supplier_id: seller }
      ),
    onSuccess: () => {
      refresh()
      toast.success("Sent to Finance")
      setChoosingSeller(false)
      setSeller("")
    },
  })
  const link = useMutation({
    mutationFn: () =>
      linkOperatingExpense(
        expenseId ?? "",
        kind === "BILL" ? { invoice_id: target } : { cash_document_id: target }
      ),
    onSuccess: () => {
      refresh()
      toast.success("Linked to Finance")
      setLinking(false)
      setTarget("")
    },
  })
  const cancel = useMutation({
    mutationFn: (reason: string) =>
      cancelOperatingExpense(expenseId ?? "", reason.trim()),
    onSuccess: () => {
      refresh()
      toast.success("Expense cancelled")
      onClose()
    },
  })

  const state = expense === undefined ? undefined : expenseStatus(expense)
  const recorded = expense?.status === "RECORDED"
  const noSupplier = expense !== undefined && expense.supplier_id === null

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      context="Operating expenses"
      id={expense === undefined ? undefined : day(expense.spent_on)}
      title={expense === undefined ? "Expense" : expense.description}
      caption={
        expense === undefined
          ? undefined
          : (expense.asset_name ?? expense.site_name ?? expense.site_id)
      }
      badge={
        state === undefined ? undefined : (
          <Pill tone={state.tone}>{state.word}</Pill>
        )
      }
      footer={
        expense === undefined ? undefined : linking ? (
          <SheetFooter
            error={link.error}
            note={target === "" ? "Choose the bill or BKK first." : undefined}
            onCancel={() => setLinking(false)}
            primary={{
              label: "Link",
              pendingLabel: "Linking…",
              pending: link.isPending,
              disabled: target === "",
              onClick: () => link.mutate(),
            }}
          />
        ) : choosingSeller ? (
          <SheetFooter
            error={send.error}
            onCancel={() => setChoosingSeller(false)}
            primary={{
              label: "Send to Finance",
              pendingLabel: "Sending…",
              pending: send.isPending,
              disabled: seller === "",
              onClick: () => send.mutate(),
            }}
          />
        ) : recorded ? (
          <SheetFooter
            error={send.error}
            start={
              <Button variant="ghost" onClick={() => setLinking(true)}>
                Link to Finance
              </Button>
            }
            danger={
              <ConfirmButton
                label="Cancel expense"
                title="Cancel this expense?"
                description="It stays in the list as cancelled and is not sent to Finance."
                confirmLabel="Cancel expense"
                cancelLabel="Keep expense"
                tone="danger"
                variant="destructive"
                reason={{ label: "Reason" }}
                onConfirm={(reason) => cancel.mutateAsync(reason)}
              />
            }
            primary={{
              label: "Send to Finance",
              pendingLabel: "Sending…",
              pending: send.isPending,
              onClick: () =>
                noSupplier ? setChoosingSeller(true) : send.mutate(),
            }}
          />
        ) : (
          <SheetFooter onCancel={onClose} cancelLabel="Close" />
        )
      }
    >
      {expense === undefined ? null : choosingSeller ? (
        <Field label="Sold by" required>
          <Select value={seller} onChange={setSeller} aria-label="Sold by">
            <option value="">Choose…</option>
            {(vendors.data?.rows ?? []).map((one) => (
              <option key={one.supplier_id} value={one.supplier_id}>
                {one.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : linking ? (
        <FinancePicker
          kind={kind}
          onKind={(next) => {
            setKind(next)
            setTarget("")
          }}
          value={target}
          onChange={setTarget}
        />
      ) : (
        <Facts>
          <Fact term="Kind">{expenseKindWord(expense.kind)}</Fact>
          <Fact term="Amount">{money(expense.amount_minor)}</Fact>
          <Fact term="What" wide>
            {expense.description}
          </Fact>
          {expenseQuantity(expense) !== null && (
            <Fact term="Quantity">{expenseQuantity(expense)}</Fact>
          )}
          {expenseOdometer(expense) !== null && (
            <Fact term="Odometer">{expenseOdometer(expense)}</Fact>
          )}
          <Fact term="Sold by">{expense.supplier_name ?? EMPTY}</Fact>
          <Fact term="Receipt no.">{expense.receipt_number ?? EMPTY}</Fact>
          {expense.invoice_number !== null && (
            <Fact term="Finance bill">{expense.invoice_number}</Fact>
          )}
          {expense.cash_document_number !== null && (
            <Fact term="BKK">{expense.cash_document_number}</Fact>
          )}
          <Fact term="Recorded by">{nameOf(expense.created_by)}</Fact>
          {expense.cancel_reason !== null && (
            <Fact term="Cancelled because" wide>
              {expense.cancel_reason}
            </Fact>
          )}
        </Facts>
      )}
    </Sheet>
  )
}

/// Choosing the Finance record an expense already has: a recent bill, or a BKK.
///
/// The lists belong to Finance and a GA role may not be allowed to read them;
/// when a list cannot be read the field becomes a plain box for the id, so the
/// link can still be made by someone who has the number in front of them.
function FinancePicker({
  kind,
  onKind,
  value,
  onChange,
}: {
  kind: "BILL" | "BKK"
  onKind: (kind: "BILL" | "BKK") => void
  value: string
  onChange: (id: string) => void
}) {
  const [needle, setNeedle] = useState("")
  const text = needle.trim()

  const bills = useQuery({
    queryKey: ["finance", "bills", "ga-expense-link", text],
    queryFn: ({ signal }) =>
      listBills(
        {
          kind: "EXPENSE",
          q: text === "" ? undefined : text,
          sort: "date",
          dir: "desc",
          limit: 30,
        },
        signal
      ),
    enabled: kind === "BILL",
    retry: false,
  })
  const slips = useQuery({
    queryKey: ["finance", "cash-documents", "ga-expense-link"],
    queryFn: ({ signal }) =>
      listCashDocuments({ kind: "PAY", limit: 100 }, signal),
    enabled: kind === "BKK",
    retry: false,
  })

  const failed = kind === "BILL" ? bills.isError : slips.isError
  const choices: readonly {
    id: string
    title: string
    quiet: string
    figure: number
  }[] =
    kind === "BILL"
      ? (bills.data?.rows ?? []).map((one) => ({
          id: one.invoice_id,
          title: one.invoice_number,
          quiet: `${one.supplier_name ?? EMPTY} · ${day(one.invoice_date)}`,
          figure: one.total_minor,
        }))
      : (slips.data ?? [])
          .filter((one) => {
            if (text === "") return true
            const haystack =
              `${one.number ?? ""} ${one.party_name} ${one.memo}`.toLowerCase()
            return haystack.includes(text.toLowerCase())
          })
          .map((one) => ({
            id: one.document_id,
            title: one.number ?? "Draft BKK",
            quiet: `${one.party_name} · ${day(one.doc_date)}`,
            figure: one.amount_minor,
          }))
  const pending = kind === "BILL" ? bills.isPending : slips.isPending

  return (
    <div className="flex flex-col gap-4">
      <Choices
        label="What Finance made"
        columns={2}
        className="grid-cols-2"
        options={[
          { value: "BILL", label: "Bill", icon: Receipt },
          { value: "BKK", label: "BKK", icon: Banknote },
        ]}
        value={kind}
        onChange={onKind}
      />
      {failed ? (
        <Field label={kind === "BILL" ? "Bill id" : "BKK id"} required>
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value.trim())}
          />
        </Field>
      ) : (
        <>
          <Input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            aria-label="Search"
            placeholder="Search"
          />
          <div className="max-h-[22rem] overflow-y-auto rounded-inner border border-hairline">
            {pending ? (
              <p className="px-4 py-6 text-center text-[0.9375rem] text-mute">
                Reading Finance…
              </p>
            ) : choices.length === 0 ? (
              <p className="px-4 py-6 text-center text-[0.9375rem] text-mute">
                Nothing matches.
              </p>
            ) : (
              choices.map((one) => (
                <button
                  key={one.id}
                  type="button"
                  onClick={() => onChange(one.id)}
                  aria-pressed={value === one.id}
                  className="flex w-full items-center justify-between gap-3 border-b border-hairline px-4 py-3 text-left last:border-b-0 hover:bg-soft aria-pressed:bg-accent-bg max-md:min-h-tap"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{one.title}</span>
                    <span className="block truncate text-[0.9375rem] text-mute">
                      {one.quiet}
                    </span>
                  </span>
                  <span className="shrink-0 text-ink tabular-nums">
                    {money(one.figure)}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
