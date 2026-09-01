/**
 * The form-level components — the ones bound to the form rather than a field.
 *
 * Each subscribes to the narrowest slice of form state it needs. Reading whole
 * form state in a component body re-renders every field on every keystroke; on
 * a forty-field purchase-order sheet that is the difference between typing and
 * waiting.
 */

import { useFormContext } from "./contexts"

/**
 * Submit, disabled while it cannot or should not fire, and named for what it
 * does at each moment.
 *
 * `Save → Saving… → (toast) Saved`, not `Submit → Loading`. And disabled while
 * submitting, because double-submit is the most common way to create two
 * purchase orders for one delivery.
 */
export function SubmitButton({
  label = "Save",
  busyLabel = `${label}…`,
}: {
  label?: string
  busyLabel?: string
}) {
  const form = useFormContext()

  return (
    <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
      {([canSubmit, isSubmitting]) => (
        <button
          type="submit"
          disabled={!canSubmit || isSubmitting}
          className="h-8 rounded-control bg-ink px-3 text-[12.5px] font-semibold text-page transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {isSubmitting ? busyLabel : label}
        </button>
      )}
    </form.Subscribe>
  )
}

/**
 * The form-level error slot.
 *
 * Only for failures that genuinely belong to the whole form — a refused write,
 * a conflict, a rule spanning several fields. A validation failure that belongs
 * to one field belongs *on* that field: "Validation failed" at the top of a
 * long sheet is not an error message, it is a scavenger hunt.
 */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="text-[11.5px] leading-[1.5] text-ember">
      {message}
    </p>
  )
}

/**
 * Renders only while the form has unsaved changes — for a footer that should
 * say so, or a guard that should warn.
 */
export function WhenDirty({ children }: { children: React.ReactNode }) {
  const form = useFormContext()
  return (
    <form.Subscribe selector={(state) => state.isDirty}>
      {(isDirty) => (isDirty ? <>{children}</> : null)}
    </form.Subscribe>
  )
}
