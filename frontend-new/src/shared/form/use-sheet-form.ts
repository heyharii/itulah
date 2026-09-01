/**
 * The save runner every sheet shares.
 *
 * This is the part of `commercial/forms.tsx`'s `useSaver` worth keeping: one
 * in-flight attempt, one error sentence, and the sheet closes itself on success
 * rather than telling its parent to reload. What it adds is the piece that file
 * had nowhere to put — mapping a server's per-field complaints back onto the
 * fields that caused them.
 *
 * On seeding: TanStack Form seeds from `defaultValues`, which it reads once.
 * `useDraft` in the old file re-seeded during render so a reopened sheet never
 * showed the previous record's values for a frame. The equivalent here is a
 * `key` on the form component, keyed by whatever identifies the opening:
 *
 * ```tsx
 * {open && <PriceListSheet key={open.id ?? "create"} row={open} />}
 * ```
 *
 * That is not a workaround — remounting is exactly what "this is a different
 * record" means, and it converges in one commit instead of flashing.
 */

import { useState } from "react"

import { getErrorMessage, isApiError } from "@/lib/api"

export interface SheetFormResult {
  /** True while a save is in flight. Bind the submit button to this. */
  busy: boolean
  /** The form-level failure, if the last attempt produced one. */
  error: string | null
  clearError: () => void
  /**
   * Run a save. Resolves to `true` when it landed, `false` when it was refused
   * — so a caller can close the sheet on success without a second try/catch.
   */
  run: (work: () => Promise<unknown>) => Promise<boolean>
  /**
   * Per-field messages the server returned, keyed by field name. Feed these to
   * the form's `onServer` validator so they land on the field rather than in a
   * sentence above forty inputs.
   */
  fieldErrors: Record<string, string>
}

/**
 * Reads a 422-style body for field complaints.
 *
 * The hub is not consistent about this yet — some handlers return
 * `{errors: {field: msg}}`, some `{fields: […]}`, some only a sentence. This
 * reads the shapes that exist and returns nothing rather than guessing, because
 * a field error attached to the wrong field is worse than none.
 */
function readFieldErrors(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object") return {}
  const record = body as Record<string, unknown>

  const direct = record.errors ?? record.fields ?? record.field_errors
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(direct as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value
      else if (Array.isArray(value) && typeof value[0] === "string") out[key] = value[0]
    }
    return out
  }

  if (Array.isArray(direct)) {
    const out: Record<string, string> = {}
    for (const entry of direct) {
      if (!entry || typeof entry !== "object") continue
      const item = entry as Record<string, unknown>
      const field = item.field ?? item.name ?? item.path
      const message = item.message ?? item.detail ?? item.error
      if (typeof field === "string" && typeof message === "string") out[field] = message
    }
    return out
  }

  return {}
}

export function useSheetForm(onSaved: () => void): SheetFormResult {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    /* One attempt at a time. A second submit while the first is in flight is
     * how one delivery becomes two purchase orders. */
    if (busy) return false

    setBusy(true)
    setError(null)
    setFieldErrors({})

    try {
      await work()
      onSaved()
      return true
    } catch (cause: unknown) {
      const fields = isApiError(cause) ? readFieldErrors(cause.body) : {}
      setFieldErrors(fields)
      /* When the server named the fields, the sentence above the form would
       * only repeat what is already marked on them. */
      setError(Object.keys(fields).length > 0 ? null : getErrorMessage(cause))
      return false
    } finally {
      setBusy(false)
    }
  }

  return {
    busy,
    error,
    clearError: () => setError(null),
    run,
    fieldErrors,
  }
}
