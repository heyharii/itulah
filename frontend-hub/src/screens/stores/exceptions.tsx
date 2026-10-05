import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { Toggle } from "@/components/ui/form"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, Problem } from "@/components/ui/states"
import {
  exceptionKindLabel,
  useExceptionSettings,
  useExceptions,
  useUpdateExceptionSettings,
  type ExceptionSettings,
  type ExceptionState,
} from "@/lib/queries/exceptions"
import { SHOW_MISSING } from "@/lib/features"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { useSections } from "@/lib/session"
import { ExceptionRow } from "@/screens/stores/exceptions-shared"

/// The Stores › Exceptions list (0646-0648): everything wrong in a store's
/// own money and goods, across every store within reach — a store manager
/// sees their own only, since the server already narrows it
/// (`postgres::store_exceptions::exceptions_list`).
const STATE_OPTIONS: readonly { value: ExceptionState; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "unacknowledged", label: "Unacknowledged" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
]

export function StoreExceptions() {
  const unit = useSheet("exceptions-unit")
  const kind = useSheet("exceptions-kind")
  const state = useSheet("exceptions-state")
  const settings = useSheet("exceptions-settings")
  const { bypass } = useSections()

  const stateValue: ExceptionState = state.value ?? "open"

  const exceptions = useExceptions({
    unit: unit.value,
    kind: kind.value,
    state: stateValue,
    limit: 200,
  })
  const summary = exceptions.data?.summary

  return (
    <PageContent>
      <PageHeader
        crumb="Stores"
        title="Exceptions"
        sub="What goes wrong in a store's own money and goods, read from the data rather than filed by hand."
        actions={
          bypass && (
            <Button variant="ghost" onClick={() => settings.open(true)}>
              Thresholds
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          options={STATE_OPTIONS}
          value={stateValue}
          onChange={(next) =>
            next === "open" ? state.close() : state.open(next)
          }
        />
        <Select
          value={unit.value ?? ""}
          onChange={(next) => (next === "" ? unit.close() : unit.open(next))}
          aria-label="Store"
          className="w-56"
        >
          <option value="">Every store</option>
          {(summary?.by_unit ?? []).map((row) => (
            <option key={row.unit_id} value={row.unit_id}>
              {row.unit_name} ({row.unit_code}) · {row.count}
            </option>
          ))}
        </Select>
      </div>

      {summary && summary.by_kind.some((row) => row.count > 0) && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {summary.by_kind
            .filter((row) => row.count > 0)
            .map((row) => (
              <button
                key={row.kind}
                type="button"
                onClick={() =>
                  kind.value === row.kind ? kind.close() : kind.open(row.kind)
                }
              >
                <Pill
                  tone={row.bad > 0 ? "bad" : "warn"}
                  className={
                    kind.value === row.kind
                      ? "ring-2 ring-accent/40"
                      : undefined
                  }
                >
                  {exceptionKindLabel(row.kind)} · {row.count}
                </Pill>
              </button>
            ))}
        </div>
      )}

      <Card className="overflow-hidden">
        {queryState(exceptions, {
          loading: "Reading exceptions…",
          render: (page) =>
            page.items.length === 0 ? (
              <EmptyState>
                {stateValue === "open" || stateValue === "unacknowledged"
                  ? "No open exceptions — every store is on time."
                  : "Nothing matches this filter."}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-hairline">
                {page.items.map((item) => (
                  <ExceptionRow key={item.id} item={item} />
                ))}
              </ul>
            ),
        })}
      </Card>

      <ExceptionSettingsSheet open={settings.isOpen} onClose={settings.close} />
    </PageContent>
  )
}

// ---- Thresholds (Admin) -----------------------------------------------------

/// The plain numeric fields of `ExceptionSettings` — every field except
/// `enabled`, `notify_unit_pic` and `also_notify_roles`, which each draw
/// their own control below rather than a number box.
type NumericSetting = Exclude<
  keyof ExceptionSettings,
  "enabled" | "notify_unit_pic" | "also_notify_roles"
>

function ExceptionSettingsSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Exception thresholds"
      caption={
        SHOW_MISSING
          ? "When a shift, a drawer, a deposit, a delivery, a missing item or a checkout counts as an exception."
          : "When a shift, a drawer, a deposit, a delivery or a checkout counts as an exception."
      }
    >
      {open && <ExceptionSettingsForm onDone={onClose} />}
    </Sheet>
  )
}

function ExceptionSettingsForm({ onDone }: { onDone: () => void }) {
  const settings = useExceptionSettings(true)
  if (settings.data === undefined) {
    return (
      <p className="text-meta text-body">
        {settings.isError ? "Could not read the settings." : "Reading…"}
      </p>
    )
  }
  return <ExceptionSettingsFields initial={settings.data} onDone={onDone} />
}

function ExceptionSettingsFields({
  initial,
  onDone,
}: {
  initial: ExceptionSettings
  onDone: () => void
}) {
  const [form, setForm] = useState<ExceptionSettings>(initial)
  const update = useUpdateExceptionSettings()

  const set = <K extends keyof ExceptionSettings>(
    key: K,
    value: ExceptionSettings[K]
  ) => setForm((was) => ({ ...was, [key]: value }))

  const number = (key: NumericSetting, label: string) => (
    <Field label={label}>
      <Input
        type="number"
        min={0}
        value={form[key]}
        onChange={(event) => set(key, Number(event.target.value))}
      />
    </Field>
  )

  return (
    <div className="flex flex-col gap-5">
      <Toggle
        on={form.enabled}
        onToggle={() => set("enabled", !form.enabled)}
        label="Exceptions on"
        note="Off: the sweep finds nothing new and closes nothing already open."
      />

      <div className="grid grid-cols-2 gap-3">
        {number("shift_grace_minutes", "Shift grace (min)")}
        {number("shift_bad_hours", "Shift red after (h)")}
        {number("cash_difference_minor", "Cash difference (Rp)")}
        {number("cash_difference_bad_minor", "Cash difference red (Rp)")}
        {number("deposit_due_days", "Deposit due (days)")}
        {number("deposit_tolerance_minor", "Deposit tolerance (Rp)")}
        {number("deposit_bad_days", "Deposit red (days)")}
        {number("deposit_lookback_days", "Deposit lookback (days)")}
        {number("stage_bad_hours", "Delivery stage red (h)")}
        {SHOW_MISSING &&
          number("missing_open_days", "Missing goods open (days)")}
        {SHOW_MISSING && number("missing_bad_days", "Missing goods red (days)")}
        {number("checkout_bad_hours", "Checkout red after (h)")}
      </div>

      <Toggle
        on={form.notify_unit_pic}
        onToggle={() => set("notify_unit_pic", !form.notify_unit_pic)}
        label="Notify the unit's PIC"
        note={
          form.notify_unit_pic
            ? "The store's own PIC is told, beside the roles below."
            : "Only the roles below are told."
        }
      />

      <Field
        label="Also notify roles"
        hint="Job role codes, comma-separated — OWNER, ADMIN, IT…"
      >
        <Input
          value={form.also_notify_roles.join(", ")}
          onChange={(event) =>
            set(
              "also_notify_roles",
              event.target.value
                .split(",")
                .map((role) => role.trim().toUpperCase())
                .filter((role) => role !== "")
            )
          }
        />
      </Field>

      <Problem error={update.error} />
      <div className="flex justify-end gap-2">
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="primary"
          pending={update.isPending}
          onClick={() => update.mutate(form, { onSuccess: onDone })}
        >
          {update.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </div>
  )
}
