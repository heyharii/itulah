import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Day } from "@/components/ui/day"
import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import { Choices } from "@/components/ui/form"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { today } from "@/lib/calendar"
import { gaKeys, recordGaSupplyRequest, useGaSites } from "@/lib/queries/ga"
import { useUnits } from "@/lib/queries/units"
import { useIdentity } from "@/lib/session"
import {
  categoryIcon,
  readQuantityNumber,
  supplyCategoriesQuery,
} from "@/screens/supplies/book-data"

/// Asking for something, as the place that needs it.
///
/// # The category is a tile, not a dropdown
///
/// Seven answers, each with its own mark, all on view: the eye finds the
/// printer for stationery before it reads the word. The account the bills will
/// charge is not asked here and not shown: it follows the category, and
/// Finance's map owns it. Nothing is chosen at first — a category picked for
/// the person is a cost booked under the wrong heading — and the request cannot
/// go until one is.
///
/// # Read from the server, never written here
///
/// The seven are `ga_supply_category`, seeded by the migration and the same
/// table the request is VALIDATED against — so the form and the validator
/// cannot disagree about what GA may ask for. The two categories that belong to
/// somebody else (Customer Supplies, shopping bags) are absent from that table
/// by design, which is why no code in this file has to exclude them.
///
/// # How many, and in what
///
/// A number and a unit, never one box of free text. "1.000 pcs" typed into a
/// single box was filed as 1, because the server takes the dot for a decimal
/// point; the number box here reads the way an Indonesian types it ("1.000" is
/// a thousand) and sends it plain ("1000 PCS"). A unit counted whole (pieces,
/// boxes) takes digits only; one that is not (kilograms, litres) takes a
/// decimal.
///
/// # A place and a name
///
/// A request is for a PLACE — the shop that ran out, the mess that needs a
/// kettle — and the place is what makes the cost readable per location later.
/// The requester is a name, prefilled with whoever is signed in: the form may be
/// filled in for somebody standing at the counter.
export function SupplyComposer({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: (requestId: string) => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({})
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    // Editing a field takes its error back: a problem sentence survives only
    // while the field itself is still wrong.
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  const categories = useQuery({ ...supplyCategoriesQuery(), enabled: open })
  const { sites } = useGaSites(open)
  const units = useUnits()
  const me = useIdentity().data?.display_name ?? ""

  const activeUnits = units.units.filter((one) => one.active)
  const unitCode = form.unit ?? units.baseUnit
  const unit = units.units.find((one) => one.code === unitCode)
  const requester = form.requested_by ?? me

  /// Typed into anything but the person's own name.
  const dirty = [
    "item",
    "quantity",
    "needed_by",
    "category",
    "site",
    "estimate",
    "notes",
  ].some((key) => (form[key] ?? "") !== "")

  const leave = () => {
    setForm({})
    setProblems({})
    onClose()
  }

  const save = useMutation({
    mutationFn: () => {
      const amount = readQuantityNumber(form.quantity ?? "") ?? 0
      return recordGaSupplyRequest({
        site_id: form.site ?? "",
        requested_by: requester.trim(),
        category_code: form.category ?? "",
        item: (form.item ?? "").trim(),
        // Plain digits and a point, so the server's own reading of the text
        // (which takes a dot for a decimal point) agrees with the one typed.
        quantity: `${amount} ${unitCode}`,
        needed_by: blank(form.needed_by),
        estimated_cost_minor:
          (form.estimate ?? "") === "" ? null : Number(form.estimate),
        notes: blank(form.notes),
      })
    },
    onSuccess: (row) => {
      // A new request moves the overview's new-request list and this screen's
      // own book; the GA namespace drops as one, as every GA write here does.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      setForm({})
      setProblems({})
      onSaved(row.request_id)
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    const amount = readQuantityNumber(form.quantity ?? "")
    if ((form.item ?? "").trim() === "") next.item = "Enter the item first."
    if (amount === null || amount <= 0) next.quantity = "Enter how many."
    else if (unit?.whole_number === true && !Number.isInteger(amount))
      next.quantity = `${unit.label} is counted in whole numbers.`
    if ((form.category ?? "") === "") next.category = "Choose a category."
    if ((form.site ?? "") === "") next.site = "Choose a location."
    if (requester.trim() === "") next.requested_by = "Enter who asks for it."
    setProblems(next)
    if (Object.keys(next).length > 0) return
    save.mutate()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && leave()}
      size="rail"
      title="New supply request"
      dirty={dirty}
      footer={
        <SheetFooter
          error={save.error}
          onCancel={leave}
          primary={{
            label: "Request supplies",
            pending: save.isPending,
            pendingLabel: "Requesting…",
            onClick: submit,
          }}
        />
      }
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label="Item"
          required
          problem={problems.item || undefined}
          className="sm:col-span-2"
        >
          <Input
            value={form.item ?? ""}
            onChange={(event) => set("item", event.target.value)}
            autoFocus
          />
        </Field>

        <Field
          label="Quantity"
          required
          problem={problems.quantity || undefined}
        >
          <div className="flex">
            <Input
              value={form.quantity ?? ""}
              onChange={(event) => set("quantity", event.target.value)}
              inputMode={unit?.whole_number === false ? "decimal" : "numeric"}
              placeholder="0"
              aria-label="Quantity"
              className="relative min-w-0 flex-1 rounded-r-none focus:z-10"
            />
            <Select
              value={unitCode}
              onChange={(next) => set("unit", next)}
              aria-label="Unit"
              className="-ml-px w-28 shrink-0 rounded-l-none"
            >
              {activeUnits.map((one) => (
                <option key={one.code} value={one.code}>
                  {one.label}
                </option>
              ))}
            </Select>
          </div>
        </Field>

        <Field label="Needed by">
          <Day
            value={form.needed_by ?? ""}
            onChange={(next) => set("needed_by", next)}
            notBefore={today()}
            label="Needed by"
          />
        </Field>

        <Field
          label="Category"
          required
          problem={problems.category || undefined}
          className="sm:col-span-2"
        >
          {categories.data === undefined ? (
            <p className="text-[0.9375rem] text-mute">
              {categories.isLoading
                ? "Reading the categories…"
                : "No categories."}
            </p>
          ) : (
            <Choices
              label="Category"
              columns={2}
              value={form.category ?? ""}
              onChange={(next) => set("category", next)}
              options={categories.data.map((one) => ({
                value: one.category_code,
                label: one.name,
                icon: categoryIcon(one.category_code),
              }))}
            />
          )}
        </Field>

        <Field label="Location" required problem={problems.site || undefined}>
          <Select
            value={form.site ?? ""}
            onChange={(next) => set("site", next)}
            aria-label="Location"
          >
            <option value="">Choose…</option>
            {sites.map((one) => (
              <option key={one.value} value={one.value}>
                {one.label ?? one.value}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Estimate">
          <Money
            prefix="Rp"
            value={form.estimate ?? ""}
            onChange={(next) => set("estimate", next)}
          />
        </Field>

        <Field
          label="Requested by"
          required
          problem={problems.requested_by || undefined}
          className="sm:col-span-2"
        >
          <Input
            value={requester}
            onChange={(event) => set("requested_by", event.target.value)}
          />
        </Field>

        <Field label="Notes" className="sm:col-span-2">
          <Textarea
            rows={3}
            value={form.notes ?? ""}
            onChange={(event) => set("notes", event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}

/// The form's empty string, as the wire spells "not given".
function blank(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}
