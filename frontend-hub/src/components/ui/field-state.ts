import * as React from "react"

/// What a `<Field>` knows about the question it frames, handed down to the
/// control inside it.
///
/// Its own module for the reason `button-style.ts` is one: a file that exports
/// a component and a hook loses fast refresh.
///
/// Before this, `<Field problem>` drew a red sentence under a box that stayed
/// grey — the box never learned it was wrong, a screen reader was never told,
/// and every form that wanted the red border wrote `aria-invalid` and
/// `border-bad` by hand. Six screens did; the rest showed the sentence alone.
/// Now the field says it once and every control in this kit reads it.
export interface FieldState {
  /// Whether the answer in it has been refused — by a validator or the server.
  readonly invalid: boolean
  /// Whether the form cannot be sent without an answer here.
  readonly required: boolean
  /// The ids of the sentences under the control — the problem, or the hint.
  readonly describedBy: string | undefined
}

export const FieldContext = React.createContext<FieldState | null>(null)

/// The ARIA a control wears, from its own props first and the enclosing
/// `<Field>` second.
///
/// A control's own `invalid` wins, so a cell in a table — which has no field
/// around it — can still say it is wrong, and a field can hold two controls of
/// which only one is.
export function useFieldAria(own: {
  invalid?: boolean
  required?: boolean
  describedBy?: string
}): {
  "aria-invalid": true | undefined
  "aria-required": true | undefined
  "aria-describedby": string | undefined
} {
  const field = React.useContext(FieldContext)
  const invalid = own.invalid ?? field?.invalid ?? false
  const required = own.required ?? field?.required ?? false
  const describedBy =
    [own.describedBy, field?.describedBy].filter(Boolean).join(" ") || undefined
  return {
    "aria-invalid": invalid ? true : undefined,
    "aria-required": required ? true : undefined,
    "aria-describedby": describedBy,
  }
}

/// The red a refused control is drawn in, for the box that carries
/// `aria-invalid` itself.
///
/// Written with `hover:` and `focus:` spelled out because the field's own
/// hover and focus borders would otherwise paint over it the moment somebody
/// went back to fix the answer — which is exactly when it must stay red.
export const INVALID =
  "aria-[invalid=true]:border-bad aria-[invalid=true]:hover:border-bad aria-[invalid=true]:focus:border-bad aria-[invalid=true]:focus-visible:border-bad"

/// The same, for a wrapper whose control is inside it — a combobox's input
/// group, a stepper's group.
export const HAS_INVALID =
  "has-[[aria-invalid=true]]:border-bad has-[[aria-invalid=true]]:hover:border-bad"
