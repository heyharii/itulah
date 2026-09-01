/**
 * The suite's form layer.
 *
 * `useAppForm` is the only entry point a screen needs. It hands back a form
 * whose fields already know how to render themselves:
 *
 * ```tsx
 * const form = useAppForm({
 *   defaultValues: { name: "", price: undefined as number | undefined },
 *   validators: { onSubmit: priceListInput },   // a Standard Schema — zod works directly
 *   onSubmit: async ({ value }) => { await save(value) },
 * })
 *
 * <form onSubmit={(e) => { e.preventDefault(); void form.handleSubmit() }}>
 *   <form.AppField name="name">{(f) => <f.TextField label="Name" required />}</form.AppField>
 *   <form.AppField name="price">{(f) => <f.MoneyField label="Price" />}</form.AppField>
 *   <form.SubmitButton />
 * </form>
 * ```
 *
 * Why this exists: `commercial/forms.tsx` held eight sheets in 3,211 lines,
 * each re-deriving the same label/hint/required markup on top of one big
 * `useState` draft. That shape has three costs the sheets were paying without
 * naming them — every keystroke re-rendered the whole sheet, no error could
 * attach to the field that caused it, and only two sheets in the whole app
 * warned before discarding an unsaved draft.
 *
 * What it deliberately keeps from that file: seeding a draft per opening rather
 * than from an effect, and one in-flight save with one error sentence. Those
 * were solved correctly there — see `useSheetForm` below.
 *
 * ## Two traps, both found the hard way
 *
 * **Optional numbers.** `useAppForm` infers its value type from the literal
 * shape of `defaultValues`, and `satisfies` does not widen an optional key. A
 * zod `z.number().optional()` produces `{ amt?: number }`, while the form needs
 * `{ amt: number | undefined }` — a *required* key holding `undefined`. Two
 * separate conversions hit this independently. Annotate explicitly:
 *
 * ```ts
 * const defaultValues: Draft = { amt: row?.amt }   // not `… satisfies Draft`
 * ```
 *
 * **Seeding a reopened sheet.** Two shapes, and the right one depends on
 * whether the record arrives asynchronously:
 *
 * - **Async** (the row is fetched when the sheet opens): key the inner form on
 *   the opening — `<TheForm key={editId ?? "create"} />`. Remounting is what
 *   "this is a different record" means, and it converges in one commit rather
 *   than flashing the previous record's values.
 * - **Sync** (the row arrives as a prop): `form.reset(next)` in an effect on
 *   open. There is no async gap to flash across, and `SheetShell` stays mounted
 *   so its open/close transition keeps animating — a remount kills it.
 *
 * See docs/frontend-rules.md Part 6.
 */

import { createFormHook } from "@tanstack/react-form"

import { fieldContext, formContext } from "./contexts"
import {
  DateField,
  MoneyField,
  MultiSelectField,
  NumberField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
  TimeField,
} from "./fields"
import { FormError, SubmitButton, WhenDirty } from "./form-parts"

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    TextAreaField,
    NumberField,
    MoneyField,
    SelectField,
    DateField,
    TimeField,
    SwitchField,
    MultiSelectField,
  },
  formComponents: {
    SubmitButton,
    FormError,
    WhenDirty,
  },
})

export { fieldContext, formContext, useFieldContext, useFormContext } from "./contexts"
export { FieldRow, FieldSection, FieldShell, controlClass } from "./field-shell"
export type { FieldShellProps } from "./field-shell"
export type { MultiOption, SelectOption } from "./fields"
export { useSheetForm } from "./use-sheet-form"
export { useUnsavedGuard, type UnsavedGuardOptions } from "./use-unsaved-guard"
export type { SheetFormResult } from "./use-sheet-form"
