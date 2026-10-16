import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Choices, Section } from "@/components/ui/form"
import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import {
  gaKeys,
  gaSupplyCategories,
  recordGaSupplyRequest,
  useGaSites,
} from "@/lib/queries/ga"
import { useUnits, type UnitOfMeasure } from "@/lib/queries/units"

/// What the server's own quantity parser (0655) would make of what was
/// typed, read the same way it reads it: the trailing word is the unit —
/// matched against a unit's code or one of its aliases, case-insensitively —
/// and everything before it is the number. Shown as a preview so a person
/// finds out their spelling didn't parse before they submit, not after.
function readQuantity(
  text: string,
  units: readonly UnitOfMeasure[]
): { value: string; unit: UnitOfMeasure } | null {
  const trimmed = text.trim()
  if (trimmed === "") return null
  const at = trimmed.lastIndexOf(" ")
  if (at === -1) return null
  const value = trimmed.slice(0, at).trim()
  const word = trimmed
    .slice(at + 1)
    .trim()
    .toLowerCase()
  if (value === "" || word === "" || Number.isNaN(Number(value))) return null
  const unit = units.find(
    (one) =>
      one.active &&
      (one.code.toLowerCase() === word || one.aliases.includes(word))
  )
  return unit === undefined ? null : { value, unit }
}

/// Asking for something, as the place that needs it.
///
/// # The category is a card, not a dropdown
///
/// Because the category IS the choice the request turns on: each one proposes
/// the account its bills will charge, and the code rides on the card as its
/// `tag`, so the person asking sees "Rumah tangga · 6042" rather than having
/// to open a dropdown to learn what a word costs (brief §10.2, §9.4). Seven
/// cards fit a column; seven hidden options do not say anything until opened.
///
/// # Read from the server, never written here
///
/// The seven are `ga_supply_category`, seeded by the migration and the same
/// table the request is VALIDATED against — so the form and the validator
/// cannot disagree about what GA may ask for. The two categories that belong
/// to somebody else (Customer Supplies, kantong belanja) are absent from that
/// table by design, which is why no code in this file has to exclude them.
///
/// # Site first after the category
///
/// A request is for a PLACE — the shop that ran out, the mess that needs a
/// kettle — and the site is what makes the cost readable per location later.
/// The requester is a name, not a login: the form may be filled in for
/// somebody standing at the counter.
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
    // Editing a field takes its error back (brief §10.2): a problem sentence
    // survives only while the field itself is still wrong.
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  // The seven GA categories, with their accounts — the server's own list, the
  // same one the request is validated against.
  const categories = useQuery({
    queryKey: gaKeys.supplyCategories(),
    queryFn: ({ signal }) => gaSupplyCategories(signal),
    enabled: open,
    staleTime: Infinity,
  })

  // Sites, from GA's own locations — the same list every GA form offers,
  // because a site is a site in all of them.
  const { sites: siteOptions } = useGaSites(open)

  // For the "reads as" preview beside the quantity field — the same master
  // the server checks the free text against (0655).
  const units = useUnits()
  const activeUnits = useMemo(
    () => units.units.filter((one) => one.active),
    [units.units]
  )
  const quantityPreview = useMemo(
    () => readQuantity(form.quantity ?? "", units.units),
    [form.quantity, units.units]
  )

  const category = form.category ?? categories.data?.[0]?.category_code ?? ""

  const save = useMutation({
    mutationFn: () =>
      recordGaSupplyRequest({
        site_id: form.site ?? "",
        requested_by: (form.requested_by ?? "").trim(),
        category_code: category,
        item: (form.item ?? "").trim(),
        quantity: blank(form.quantity),
        needed_by: blank(form.needed_by),
        estimated_cost_minor:
          (form.estimate ?? "") === "" ? null : Number(form.estimate),
        notes: blank(form.notes),
      }),
    onSuccess: (row) => {
      // A new request moves the overview's new-request list and this screen's
      // own book; the GA namespace drops as one, as every GA write here does.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      setForm({})
      onSaved(row.request_id)
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (category === "") next.category = "Choose a category first."
    if ((form.item ?? "").trim() === "") next.item = "Enter the item first."
    if ((form.site ?? "") === "") next.site = "Choose a location first."
    if ((form.requested_by ?? "").trim() === "")
      next.requested_by = "Enter the requester's name."
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
      width="wide"
      title="Request supplies"
      caption="Consumables for the office, warehouse, stores and mess. The proposed account follows the category; the bill is raised in Finance."
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-pill text-mute">
            {category === ""
              ? "Choose a category first"
              : (categories.data?.find((one) => one.category_code === category)
                  ?.name ?? "Category")}
          </span>
          <div className="flex items-center gap-2">
            <Button data-cancel variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              pending={save.isPending}
              disabled={category === ""}
              onClick={submit}
            >
              {save.isPending ? "Submitting…" : "Submit"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {save.error instanceof Error && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}

        <Section title="Category" aside="each card shows its proposed account">
          {categories.data === undefined ? (
            <p className="text-meta text-mute">
              {categories.isLoading
                ? "Reading the category list…"
                : "No categories."}
            </p>
          ) : (
            <Choices
              label="Category"
              columns={2}
              value={category}
              onChange={(next) => set("category", next)}
              options={categories.data.map((one) => ({
                value: one.category_code,
                label: one.name,
                tag: one.account_code,
              }))}
            />
          )}
          {problems.category !== undefined && problems.category !== "" && (
            <p className="text-pill text-bad">{problems.category}</p>
          )}
        </Section>

        <Section title="Item">
          <Field label="Item" required problem={problems.item || undefined}>
            <Input
              value={form.item ?? ""}
              onChange={(event) => set("item", event.target.value)}
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Quantity"
              aside="free text, e.g. 10 pcs, 2 reams, 5 boxes"
            >
              <Input
                value={form.quantity ?? ""}
                onChange={(event) => set("quantity", event.target.value)}
                list="ga-supply-units"
              />
              {/* Recognised units, so a person types "rim" rather than
                  guessing at "ream". Only a hint — any text still submits,
                  the same as before this master existed. */}
              <datalist id="ga-supply-units">
                {activeUnits.map((one) => (
                  <option key={one.code} value={one.label} />
                ))}
              </datalist>
              <p className="mt-1 text-pill text-mute">
                {quantityPreview !== null
                  ? `Reads as: ${quantityPreview.value} ${quantityPreview.unit.label}`
                  : `Recognised units: ${activeUnits.map((one) => one.label).join(", ")}`}
              </p>
            </Field>
            <Field label="Needed by">
              <Input
                type="date"
                value={form.needed_by ?? ""}
                onChange={(event) => set("needed_by", event.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section title="Location and requester">
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Location"
              required
              problem={problems.site || undefined}
            >
              <Select
                value={form.site ?? ""}
                onChange={(next) => set("site", next)}
                aria-label="Location"
              >
                <option value="">Select…</option>
                {siteOptions.map((one) => (
                  <option key={one.value} value={one.value}>
                    {one.label ?? one.value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Requested by"
              required
              problem={problems.requested_by || undefined}
            >
              <Input
                value={form.requested_by ?? ""}
                onChange={(event) => set("requested_by", event.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section title="Estimate and notes">
          <Field
            label="Estimated cost"
            aside="GA's own estimate; the actual bill follows in Finance"
          >
            <Money
              value={form.estimate ?? ""}
              onChange={(next) => set("estimate", next)}
            />
          </Field>
          <Field label="Notes">
            <Input
              value={form.notes ?? ""}
              onChange={(event) => set("notes", event.target.value)}
            />
          </Field>
        </Section>

        {/* The one sentence this form owes the reader: two categories that look
            like they belong here are somebody else's. */}
        <p className="text-pill text-mute">
          Customer supplies and shopping bags don't go through here: they belong
          to Commercial and Inventory respectively.
        </p>
      </div>
    </Sheet>
  )
}

/// The form's empty string, as the wire spells "not given".
function blank(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}
