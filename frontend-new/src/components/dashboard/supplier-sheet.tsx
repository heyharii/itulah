import { useEffect, useState } from "react"
import { useStore } from "@tanstack/react-form"
import { z } from "zod"

import { Icon, paths } from "@/components/dashboard/parts"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import {
  type Supplier,
} from "@/components/dashboard/data"
import { cue } from "@/components/dashboard/use-interaction-sounds"
import { cn } from "@/lib/utils"

import { FieldShell, controlClass, useAppForm, useSheetForm } from "@/shared/form"

const MAX_NOTE = 200

/** What the hub accepts for a supplier write — not the `Supplier` read row,
 *  which carries server-minted fields (`id`, `tags`, `volume`, …) this sheet
 *  never edits and must hand back untouched. */
const supplierInput = z.object({
  name: z.string().trim().min(1, "Give the supplier a name."),
  code: z
    .string()
    .trim()
    .min(1, "Give the supplier a code.")
    .max(50, "Code must be 50 characters or fewer."),
  address: z.string().trim().min(1, "Add the supplier address."),
  status: z.enum(["active", "inactive", "blocked"]),
  notes: z.string().max(MAX_NOTE, "Note is too long."),
})

type SupplierDraft = z.infer<typeof supplierInput>

const emptyDraft = (): SupplierDraft => ({
  name: "",
  code: "",
  address: "",
  status: "active",
  notes: "",
})

const draftFor = (row: Supplier): SupplierDraft => ({
  name: row.name,
  code: row.code ?? row.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 50),
  address: row.address ?? "",
  status: row.status === "inactive" || row.status === "blocked" ? row.status : "active",
  notes: row.notes ?? "",
})

interface SupplierSheetProps {
  open: boolean
  editing: Supplier | null
  onClose: () => void
  onSubmit: (record: Supplier) => void | Promise<void>
}

export function SupplierSheet({ open, editing, onClose, onSubmit }: SupplierSheetProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const { busy, error, run } = useSheetForm(onClose)

  const form = useAppForm({
    defaultValues: emptyDraft(),
    validators: { onChange: supplierInput },
    onSubmitInvalid: () => cue("error"),
    onSubmit: async ({ value }) => {
      await run(async () =>
        onSubmit({
          id:
            editing?.id ??
            `${value.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2, 7)}`,
          name: value.name.trim(),
          code: value.code.trim(),
          address: value.address.trim(),
          status: value.status,
          tags: editing?.tags ?? [],
          days: null,
          strength: "none",
          site: null,
          notes: value.notes.trim(),
          volume: editing?.volume ?? [],
        })
      )
    },
  })

  const name = useStore(form.store, (state) => state.values.name)
  const isDirty = useStore(form.store, (state) => state.isDirty)

  /* The sheet is an external overlay, opened and closed by a parent that
   * keeps `open`/`editing` synchronous — there is no async row fetch here, so
   * an effect-time reset (matched by the original hand-rolled state) never
   * has an async gap to flash a stale value across. Resetting via TanStack's
   * own `reset` — rather than a keyed remount — is what keeps `SheetShell`
   * mounted continuously, so its open/close slide keeps animating. */
  useEffect(() => {
    if (!open) return
    form.reset(editing ? draftFor(editing) : emptyDraft())
    setConfirmDiscard(false)
    cue("bloom")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  // `fields.tsx`'s bound inputs do not forward a ref, so `SheetShell`'s
  // `initialFocus` has nothing to point at. This focuses the name field
  // directly once the slide has started, after `SheetShell`'s own fallback
  // (first button) has already run — see the gap noted in the conversion
  // report.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => document.getElementById("name")?.focus(), 70)
    return () => clearTimeout(t)
  }, [open])

  const close = (force = false) => {
    if (!force && isDirty) {
      if (!confirmDiscard) cue("error")
      setConfirmDiscard(true)
      return
    }
    setConfirmDiscard(false)
    onClose()
  }

  // Cmd/Ctrl+Enter submits from anywhere in the form.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault()
        void form.handleSubmit()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  })

  return (
    <SheetShell
      open={open}
      eyebrow={editing ? "Editing record" : "New record"}
      title={editing ? name || editing.name.split(" — ")[0] : "Add supplier"}
      onRequestClose={() => close()}
      overlay={
        confirmDiscard ? (
          <DiscardBar onKeep={() => setConfirmDiscard(false)} onDiscard={() => close(true)} />
        ) : undefined
      }
      footer={
        <>
          <span className="flex-1" />
          <button type="button" onClick={() => close()} className={sheetButton.secondary}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void form.handleSubmit()}
            disabled={busy}
            className={sheetButton.primary}
          >
            <Icon path={paths.check} size={14} width={2.2} />
            {busy ? "Saving…" : editing ? "Save changes" : "Create supplier"}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
        className="px-[18px] pt-1 pb-[18px]"
      >
        <form.FormError message={error && `Supplier was not saved: ${error}`} />

        <Fieldset legend="Identity" first>
          <form.AppField name="name">
            {(field) => <field.TextField label="Company name" required placeholder="Aurora Scoops" />}
          </form.AppField>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <form.AppField name="code">
              {(field) => (
                <CodeField
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  errors={
                    field.state.meta.isTouched
                      ? field.state.meta.errors
                          .map((error) =>
                            typeof error === "string"
                              ? error
                              : error && typeof error === "object" && "message" in error
                                ? String((error as { message: unknown }).message)
                                : null
                          )
                          .filter((message): message is string => Boolean(message))
                      : []
                  }
                />
              )}
            </form.AppField>
            <form.AppField name="status">
              {(field) => (
                <field.SelectField
                  label="Status"
                  required
                  options={[
                    { value: "active", label: "Active" },
                    { value: "inactive", label: "Inactive" },
                    { value: "blocked", label: "Blocked" },
                  ]}
                />
              )}
            </form.AppField>
          </div>

          <form.AppField name="address">
            {(field) => <field.TextAreaField label="Address" required placeholder="Street, city, province" />}
          </form.AppField>
        </Fieldset>

        <Fieldset legend="Classification">
          <p className="text-[11.5px] leading-[1.45] text-ink-4">
            Categories are enriched by Internal's sourcing data and are not part of the supplier
            write contract. They will appear here after enrichment is available.
          </p>
        </Fieldset>

        <Fieldset legend="Relationship">
          <p className="text-[11.5px] leading-[1.45] text-ink-4">
            Internal masterdata does not expose contact events, relationship strength, or order
            history in this resource. Those metrics remain blank until their canonical endpoints
            are connected.
          </p>
        </Fieldset>

        <Fieldset legend="Notes">
          <form.AppField name="notes">
            {(field) => (
              <field.TextAreaField
                label="Internal note"
                hint="optional"
                placeholder="Anything the team should know before ordering…"
              />
            )}
          </form.AppField>
          <form.Subscribe selector={(state) => state.values.notes}>
            {(notes) => (
              <div
                className={cn(
                  "-mt-2 pb-[13px] text-right font-mono text-[11px]",
                  notes.length > MAX_NOTE ? "text-ember" : "text-ink-4"
                )}
              >
                {notes.length} / {MAX_NOTE}
              </div>
            )}
          </form.Subscribe>
        </Fieldset>
      </form>
    </SheetShell>
  )
}

/**
 * The one field the generic `TextField` cannot express: the value is
 * upper-cased as the user types, not just on save. Built from the same
 * `FieldShell`/`controlClass` the shared layer's own fields use, so it looks
 * identical to a bound one without needing a change to `shared/form`.
 */
function CodeField({
  value,
  onChange,
  onBlur,
  errors,
}: {
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  errors: string[]
}) {
  return (
    <FieldShell label="Supplier code" required htmlFor="code" errors={errors}>
      <input
        id="code"
        name="code"
        value={value}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        onBlur={onBlur}
        placeholder="SUP-001"
        autoComplete="off"
        aria-invalid={errors.length > 0}
        className={controlClass(errors.length > 0)}
      />
    </FieldShell>
  )
}

/** The discard confirmation — a step in the footer, not a second dialog. */
function DiscardBar({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  return (
    <div className="absolute right-3.5 bottom-[62px] left-3.5 z-5 flex animate-rise items-center gap-2 rounded-panel bg-surface py-2.5 pr-2.5 pl-[13px] text-xs font-medium shadow-[0_0_0_1px_var(--line-strong),var(--shadow-overlay)]">
      Discard your changes?
      <span className="flex-1" />
      <button
        type="button"
        onClick={onKeep}
        className="inline-flex h-[26px] items-center rounded-control bg-surface px-2 text-xs font-medium text-ink shadow-btn transition-colors hover:bg-hover"
      >
        Keep editing
      </button>
      <button
        type="button"
        onClick={onDiscard}
        className="inline-flex h-[26px] items-center rounded-control bg-ember px-2 text-xs font-medium text-white transition-[filter] hover:brightness-105"
      >
        Discard
      </button>
    </div>
  )
}

function Fieldset({
  legend,
  first,
  children,
}: {
  legend: string
  first?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn("py-4", !first && "border-t border-line")}>
      <div className="pb-3 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
        {legend}
      </div>
      {children}
    </div>
  )
}
