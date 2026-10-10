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

/// Whether a control is answering a question on a form — standing inside a
/// `<Field>` — rather than in a toolbar or a table cell.
export function useInForm(): boolean {
  return React.useContext(FieldContext) !== null
}

/// A form's box, following Apple's: 44px tall — the least a finger is asked to
/// hit — 15px type, a 10px corner, 14px in from its edge. The type is the size
/// of the label above it, so the two read as a pair and the label, in the
/// heavier weight, leads.
///
/// The airy charcoal direction (owner, 2026-09-28) gave form fields the
/// sign-in's height: a form is filled in — slowly, often on a phone, often at
/// the end of a shift — and a box that size is one a thumb and a tired eye
/// both find. A toolbar's search or a cell being edited in a table keeps its
/// own density: those are read far more than they are typed into. So the
/// switch is the `<Field>` around the control, not a prop every form would
/// have to remember; a caller's own `h-*` still wins, since its classes come
/// last.
///
/// 47px under a thumb (under 48rem) and the hub's 44 from there up — the
/// sign-in's height on a phone, where a form is filled in slowly at the end of
/// a shift. A caller can still say `[--form-box:…]` on a wrapper.
export const FORM_BOX =
  "h-[var(--form-box,2.9375rem)] rounded-[0.625rem] px-3.5 text-[0.9375rem] md:h-[var(--form-box,2.75rem)]"

/// The same box for a control that grows — `<PickMany>`'s chips wrap.
export const FORM_BOX_GROWS =
  "min-h-[var(--form-box,2.9375rem)] rounded-[0.625rem] px-3.5 text-[0.9375rem] md:min-h-[var(--form-box,2.75rem)]"

/// The soft blue halo a form's box wears while it has the caret, red while
/// its answer is refused. Spelled once per way of being focused, because each
/// control says "focused" its own way: a text box by `:focus`, a trigger by
/// `:focus-visible` or an open popup, a box by the input inside it.
export const FORM_HALO =
  "focus:shadow-[0_0_0_4px_rgb(37_99_235/12%)] aria-[invalid=true]:focus:shadow-[0_0_0_4px_rgb(208_81_81/14%)]"
export const FORM_HALO_TRIGGER =
  "focus-visible:shadow-[0_0_0_4px_rgb(37_99_235/12%)] data-[popup-open]:shadow-[0_0_0_4px_rgb(37_99_235/12%)]"
export const FORM_HALO_WITHIN =
  "has-[input:focus-visible]:shadow-[0_0_0_4px_rgb(37_99_235/12%)]"
