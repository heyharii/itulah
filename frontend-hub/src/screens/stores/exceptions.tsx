import { Suspense, useDeferredValue, useState } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { Toggle } from "@/components/ui/form"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { Segmented } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, LoadingState, Problem } from "@/components/ui/states"
import {
  exceptionKindLabel,
  exceptionsQuery,
  useExceptionSettings,
  useUpdateExceptionSettings,
  type ExceptionSettings,
  type ExceptionState,
} from "@/lib/queries/exceptions"
import { SHOW_MISSING } from "@/lib/features"
import { useLayout } from "@/lib/layout"
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
  // A phone keeps the Thresholds at the foot of the list.
  const phone = useLayout() === "phone"
  const settings = useSheet("exceptions-settings")
  const { bypass } = useSections()

  // The head and the thresholds stand at once; the list waits for the
  // exceptions and streams in with them (the server starts the read too).
  return (
    <PageContent>
      <PageHeader
        crumb="Stores"
        title="Exceptions"
        sub="What goes wrong in a store's own money and goods, read from the data rather than filed by hand."
        actions={
          bypass &&
          !phone && (
            <Button variant="ghost" onClick={() => settings.open(true)}>
              Thresholds
            </Button>
          )
        }
      />

      <Suspense fallback={<LoadingState>Reading exceptions…</LoadingState>}>
        <ExceptionList />
      </Suspense>

      {phone && bypass && (
        <div className="mt-5 flex justify-center">
          <Button variant="soft" onClick={() => settings.open(true)}>
            Thresholds
          </Button>
        </div>
      )}

      <ExceptionSettingsSheet open={settings.isOpen} onClose={settings.close} />
    </PageContent>
  )
}

function ExceptionList() {
  // A phone keeps the state in the drawer over the bottom bar, the store and
  // the kind in its Filters sheet, and reads each exception as a card.
  const phone = useLayout() === "phone"
  const unit = useSheet("exceptions-unit")
  const kind = useSheet("exceptions-kind")
  const state = useSheet("exceptions-state")
  // What a phone's search narrows the list by, and its Filters sheet.
  const [query, setQuery] = useState("")
  const [options, setOptions] = useState(false)

  const stateValue: ExceptionState = state.value ?? "open"

  // Another store, kind or state: the list in hand stays until the next is
  // read — the deferred question keeps it on screen.
  const askedUnit = useDeferredValue(unit.value)
  const askedKind = useDeferredValue(kind.value)
  const askedState = useDeferredValue(stateValue)
  const exceptions = useSuspenseQuery(
    exceptionsQuery({
      unit: askedUnit,
      kind: askedKind,
      state: askedState,
      limit: 200,
    })
  )
  const summary = exceptions.data.summary

  /// What the exceptions are, counted: a tap narrows the list to one kind. A
  /// desk draws them under the toolbar, a phone in its Filters sheet.
  const kinds =
    summary && summary.by_kind.some((row) => row.count > 0) ? (
      <div
        className={
          phone ? "flex flex-wrap gap-1.5" : "mb-4 flex flex-wrap gap-1.5"
        }
      >
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
                  kind.value === row.kind ? "ring-2 ring-accent/40" : undefined
                }
              >
                {exceptionKindLabel(row.kind)} · {row.count}
              </Pill>
            </button>
          ))}
      </div>
    ) : null

  const storePicker = (
    <Select
      value={unit.value ?? ""}
      onChange={(next) => (next === "" ? unit.close() : unit.open(next))}
      aria-label="Store"
      className="w-56 max-md:w-full"
    >
      <option value="">Every store</option>
      {(summary?.by_unit ?? []).map((row) => (
        <option key={row.unit_id} value={row.unit_id}>
          {row.unit_name} ({row.unit_code}) · {row.count}
        </option>
      ))}
    </Select>
  )

  return (
    <>
      {!phone && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Segmented
              options={STATE_OPTIONS}
              value={stateValue}
              onChange={(next) =>
                next === "open" ? state.close() : state.open(next)
              }
            />
            {storePicker}
          </div>
          {kinds}
        </>
      )}

      {/* On a phone the state is the status button of the drawer over the
          bottom bar, beside a search over what is listed, and the store and
          the kind are its ⚙ sheet. */}
      <DockTools
        search={{
          value: query,
          onChange: setQuery,
          label: "Search Exceptions",
        }}
        filter={{
          count:
            (unit.value === undefined ? 0 : 1) +
            (kind.value === undefined ? 0 : 1),
          onOpen: () => setOptions(true),
        }}
        status={{
          value: stateValue,
          options: STATE_OPTIONS,
          onChange: (next) =>
            next === "open" ? state.close() : state.open(next),
        }}
      />
      <BottomSheet open={options} onOpenChange={setOptions} title="Filters">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-4 [&>*:is(select,input,button)]:w-full">
          {storePicker}
          {kinds}
        </div>
      </BottomSheet>

      {/* The thresholds, which a desk keeps in the header: at the foot of the
          list on a phone, for an admin. */}
      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {(() => {
          const page = exceptions.data
          const needle = phone ? query.trim().toLowerCase() : ""
          const items =
            needle === ""
              ? page.items
              : page.items.filter((item) =>
                  `${exceptionKindLabel(item.kind)} ${item.sentence} ${item.unit_name} ${item.unit_code}`
                    .toLowerCase()
                    .includes(needle)
                )
          return page.items.length === 0 ? (
            <EmptyState>
              {stateValue === "open" || stateValue === "unacknowledged"
                ? "No open exceptions — every store is on time."
                : "Nothing matches this filter."}
            </EmptyState>
          ) : items.length === 0 ? (
            <EmptyState>No exception matches that search.</EmptyState>
          ) : (
            <ul
              className={
                phone ? "flex flex-col gap-2.5" : "divide-y divide-hairline"
              }
            >
              {items.map((item) => (
                <ExceptionRow key={item.id} item={item} />
              ))}
            </ul>
          )
        })()}
      </Card>
    </>
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
        <Button data-cancel variant="quiet" onClick={onDone}>
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
