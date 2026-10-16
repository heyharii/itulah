import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Banner } from "@/components/ui/states"
import { gaKeys, recordGaBillRequest } from "@/lib/queries/ga"
import { procurementKeys, supplierPage } from "@/lib/queries/procurement"
import { supplierDisplayName } from "@/screens/procurement/supplier-format"
import { useSupplierName } from "@/screens/procurement/supplier-name"

/// The GA record a bill is for, and what GA already knows about it.
export type BillSource = {
  site_id: string
  /// Null when the record names no supplier (a supply request): the form
  /// asks for one.
  supplier_id: string | null
  supplier_name: string | null
  /// The figure to start from — the approved budget, the estimate — or null.
  amount_minor: number | null
  /// What the bill's one line says it was for.
  memo: string
  repair_id?: string
  supply_request_id?: string
  contract_id?: string
  /// Whether to ask which period of service the bill covers (a contract's
  /// month of cleaning, rent, electricity).
  period?: boolean
}

/// Sending the supplier's bill to Finance, from the record it is for.
///
/// One line, pointing back at the record, with the account left to the
/// server's suggestion: GA says what happened and where, Finance's mapping
/// says which account (brief §8.2). It lands as a DRAFT in Finance's GA inbox;
/// once Finance posts it, the record's "Billed" figure moves.
export function BillRequestForm({
  source,
  onDone,
  onCancel,
}: {
  source: BillSource
  onDone: () => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const supplierName = useSupplierName()
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState<Record<string, string>>({
    supplier: source.supplier_id ?? "",
    invoice_date: today,
    amount: source.amount_minor === null ? "" : String(source.amount_minor),
    tax: "",
  })
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  const vendors = useQuery({
    queryKey: [...procurementKeys.suppliers(), "book", "EXPENSE"],
    queryFn: ({ signal }) => supplierPage({ category: "EXPENSE" }, signal),
    enabled: source.supplier_id === null,
    staleTime: 5 * 60 * 1000,
  })

  const text = (key: string) => (form[key] ?? "").trim()
  const orNull = (key: string) => (text(key) === "" ? null : text(key))
  const ready =
    text("supplier") !== "" &&
    text("invoice_number") !== "" &&
    text("invoice_date") !== "" &&
    text("amount") !== ""

  const send = useMutation({
    mutationFn: () =>
      recordGaBillRequest({
        supplier_id: text("supplier"),
        supplier_name:
          source.supplier_id === null ? null : source.supplier_name,
        invoice_number: text("invoice_number"),
        invoice_date: text("invoice_date"),
        due_date: orNull("due_date"),
        subtotal_minor: Number(text("amount")),
        tax_minor: text("tax") === "" ? 0 : Number(text("tax")),
        note: orNull("note"),
        document_ref: null,
        lines: [
          {
            site_id: source.site_id,
            account_code: null,
            amount_minor: Number(text("amount")),
            category_code: null,
            asset_id: null,
            contract_id: source.contract_id ?? null,
            repair_id: source.repair_id ?? null,
            replacement_id: null,
            supply_request_id: source.supply_request_id ?? null,
            service_period_start: orNull("period_start"),
            service_period_end: orNull("period_end"),
            memo: source.memo,
          },
        ],
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      onDone()
    },
  })

  return (
    <div className="flex flex-col gap-3">
      {send.error instanceof Error && (
        <Banner tone="bad">{send.error.message}</Banner>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {source.supplier_id === null ? (
          <Field label="Supplier" required className="col-span-2">
            <Select
              value={form.supplier ?? ""}
              onChange={(next) => set("supplier", next)}
              aria-label="Supplier"
            >
              <option value="">Choose…</option>
              {(vendors.data?.rows ?? []).map((one) => (
                <option key={one.supplier_id} value={one.supplier_id}>
                  {supplierDisplayName(one)}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Supplier" className="col-span-2">
            <Input
              value={supplierName(source.supplier_id, source.supplier_name)}
              disabled
            />
          </Field>
        )}
        <Field label="Invoice number" required>
          <Input
            value={form.invoice_number ?? ""}
            onChange={(event) => set("invoice_number", event.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Invoice date" required>
          <Input
            type="date"
            value={form.invoice_date ?? ""}
            onChange={(event) => set("invoice_date", event.target.value)}
          />
        </Field>
        <Field label="Amount before tax" required>
          <Money
            value={form.amount ?? ""}
            onChange={(next) => set("amount", next)}
            prefix="Rp"
          />
        </Field>
        <Field label="Tax" aside="empty = none">
          <Money
            value={form.tax ?? ""}
            onChange={(next) => set("tax", next)}
            prefix="Rp"
          />
        </Field>
        <Field label="Due date">
          <Input
            type="date"
            value={form.due_date ?? ""}
            onChange={(event) => set("due_date", event.target.value)}
          />
        </Field>
        <Field label="Note for Finance">
          <Input
            value={form.note ?? ""}
            onChange={(event) => set("note", event.target.value)}
          />
        </Field>
        {source.period === true && (
          <>
            <Field label="Service from">
              <Input
                type="date"
                value={form.period_start ?? ""}
                onChange={(event) => set("period_start", event.target.value)}
              />
            </Field>
            <Field label="Service to">
              <Input
                type="date"
                value={form.period_end ?? ""}
                onChange={(event) => set("period_end", event.target.value)}
              />
            </Field>
          </>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-pill text-mute">
          Finance receives it as a draft and posts it; the account is suggested
          from the record.
        </span>
        <div className="flex items-center gap-2">
          <Button data-cancel variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            pending={send.isPending}
            disabled={!ready}
            onClick={() => send.mutate()}
          >
            {send.isPending ? "Sending…" : "Send to Finance"}
          </Button>
        </div>
      </div>
    </div>
  )
}
