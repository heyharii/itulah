/**
 * The bound field components.
 *
 * Each reads its own `FieldApi` out of context, so a screen writes
 * `<form.AppField name="qty">{(f) => <f.NumberField label="Quantity" />}</form.AppField>`
 * and never wires value/onChange/onBlur by hand.
 *
 * **Errors show only once the field has been touched.** Validating on change is
 * what makes a form feel responsive; shouting at someone before they have typed
 * is what makes it feel hostile. `isTouched` is the difference.
 */

import type { ReactNode } from "react"

import { formatIDR } from "@/shared/locale"
import { cn } from "@/lib/utils"
import { useFieldContext } from "./contexts"
import { FieldShell, controlClass } from "./field-shell"

/** Field errors as plain sentences, or none while the user has not engaged. */
function useVisibleErrors(): string[] {
  const field = useFieldContext<unknown>()
  const { isTouched, errors } = field.state.meta
  if (!isTouched) return []
  return errors
    .map((error: unknown) =>
      typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : null
    )
    .filter((message): message is string => Boolean(message))
}

interface BaseProps {
  label: string
  hint?: string
  required?: boolean
  disabled?: boolean
  placeholder?: string
  /**
   * Extra classes on the control itself.
   *
   * Added because the commercial conversion lost `font-mono` on its SKU and
   * article-code inputs — a code column that is not monospaced is measurably
   * harder to scan, and there was no way to say so through the component.
   */
  className?: string
  /**
   * `id` of a `<datalist>` to suggest from.
   *
   * Two SKU fields had to bypass the shared component entirely to keep their
   * autocomplete. A field that forces callers out of the layer to do an
   * ordinary thing is a gap in the layer.
   */
  list?: string
  /** Focused on mount — for the first field of a sheet. */
  autoFocus?: boolean
}

export function TextField({
  label,
  hint,
  required,
  disabled,
  placeholder,
  className,
  list,
  autoFocus,
}: BaseProps) {
  const field = useFieldContext<string>()
  const errors = useVisibleErrors()

  return (
    <FieldShell label={label} hint={hint} required={required} htmlFor={field.name} errors={errors}>
      <input
        id={field.name}
        name={field.name}
        list={list}
        autoFocus={autoFocus}
        value={field.state.value ?? ""}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={errors.length > 0}
        className={cn(controlClass(errors.length > 0), className)}
      />
    </FieldShell>
  )
}

/**
 * A time of day, `HH:MM`.
 *
 * Added because the HR shift editor had `type="time"` inputs and had to bind
 * them through the raw field API for want of a component.
 */
export function TimeField({ label, hint, required, disabled, className }: BaseProps) {
  const field = useFieldContext<string>()
  const errors = useVisibleErrors()

  return (
    <FieldShell label={label} hint={hint} required={required} htmlFor={field.name} errors={errors}>
      <input
        id={field.name}
        name={field.name}
        type="time"
        value={field.state.value ?? ""}
        disabled={disabled}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={errors.length > 0}
        className={cn(controlClass(errors.length > 0), "tabular-nums", className)}
      />
    </FieldShell>
  )
}

export interface MultiOption {
  value: string
  label: string
  hint?: string
}

/**
 * A closed set of values, chosen as chips.
 *
 * Added because three conversions each hand-built one — sourcing's master tags,
 * the forum's tag toggles, the forum's category grid — and each arrived at a
 * slightly different keyboard and selected-state treatment.
 */
export function MultiSelectField({
  label,
  hint,
  required,
  disabled,
  options,
  className,
}: BaseProps & { options: MultiOption[] }) {
  const field = useFieldContext<string[]>()
  const errors = useVisibleErrors()
  const selected = field.state.value ?? []

  const toggle = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value]
    field.handleChange(next)
  }

  return (
    <FieldShell label={label} hint={hint} required={required} errors={errors}>
      <div className={cn("flex flex-wrap gap-1.5", className)} role="group">
        {options.map((option) => {
          const on = selected.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              title={option.hint}
              onClick={() => toggle(option.value)}
              onBlur={field.handleBlur}
              className={cn(
                "inline-flex h-[26px] items-center rounded-control px-2 text-[11.5px] font-medium transition-colors",
                on
                  ? "bg-accent-tint text-accent-ink shadow-[inset_0_0_0_1.5px_var(--accent)]"
                  : "text-ink-3 shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-hover hover:text-ink",
                disabled && "opacity-45"
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </FieldShell>
  )
}

export function TextAreaField({
  label,
  hint,
  required,
  disabled,
  placeholder,
  rows = 3,
}: BaseProps & { rows?: number }) {
  const field = useFieldContext<string>()
  const errors = useVisibleErrors()

  return (
    <FieldShell label={label} hint={hint} required={required} htmlFor={field.name} errors={errors}>
      <textarea
        id={field.name}
        name={field.name}
        rows={rows}
        value={field.state.value ?? ""}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={errors.length > 0}
        className={cn(controlClass(errors.length > 0), "h-auto py-1.5 leading-[1.55]")}
      />
    </FieldShell>
  )
}

export function NumberField({
  label,
  hint,
  required,
  disabled,
  placeholder,
  min,
  max,
  step,
}: BaseProps & { min?: number; max?: number; step?: number }) {
  const field = useFieldContext<number | undefined>()
  const errors = useVisibleErrors()

  return (
    <FieldShell label={label} hint={hint} required={required} htmlFor={field.name} errors={errors}>
      <input
        id={field.name}
        name={field.name}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={field.state.value ?? ""}
        disabled={disabled}
        placeholder={placeholder}
        /* An empty box is `undefined`, not 0. They mean different things, and
         * collapsing them is how "no quantity entered" becomes "zero units". */
        onChange={(event) =>
          field.handleChange(event.target.value === "" ? undefined : event.target.valueAsNumber)
        }
        onBlur={field.handleBlur}
        aria-invalid={errors.length > 0}
        className={cn(controlClass(errors.length > 0), "tabular-nums")}
      />
    </FieldShell>
  )
}

/**
 * Money, in integer minor units — see docs/money-contract.md.
 *
 * The input carries the raw integer; the formatted value sits beside it as a
 * read-back rather than inside it. Formatting a field while it is being typed
 * fights the caret, and every implementation that tries it eventually eats a
 * keystroke.
 *
 * `currencyMark` defaults on, but a label that already says "(Rp)" should turn
 * it off — the commercial conversion ended up saying Rp twice on one field,
 * because the label was kept verbatim and the component added its own.
 */
export function MoneyField({
  label,
  hint,
  required,
  disabled,
  placeholder,
  className,
  currencyMark = true,
}: BaseProps & { currencyMark?: boolean }) {
  const field = useFieldContext<number | undefined>()
  const errors = useVisibleErrors()
  const value = field.state.value

  return (
    <FieldShell label={label} hint={hint} required={required} htmlFor={field.name} errors={errors}>
      <div className="relative">
        {currencyMark && (
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[11px] font-medium text-ink-4">
            Rp
          </span>
        )}
        <input
          id={field.name}
          name={field.name}
          type="number"
          inputMode="numeric"
          step={1}
          value={value ?? ""}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) =>
            field.handleChange(event.target.value === "" ? undefined : event.target.valueAsNumber)
          }
          onBlur={field.handleBlur}
          aria-invalid={errors.length > 0}
          className={cn(
            controlClass(errors.length > 0),
            currencyMark && "pl-8",
            "tabular-nums",
            className
          )}
        />
      </div>
      {value !== undefined && Number.isFinite(value) && (
        <p className="pt-1 font-mono text-[10.5px] text-ink-4 tabular-nums">
          {formatIDR(value)}
        </p>
      )}
    </FieldShell>
  )
}

export interface SelectOption {
  value: string
  label: string
}

export function SelectField({
  label,
  hint,
  required,
  disabled,
  options,
  placeholder,
}: BaseProps & { options: SelectOption[] }) {
  const field = useFieldContext<string>()
  const errors = useVisibleErrors()

  return (
    <FieldShell label={label} hint={hint} required={required} htmlFor={field.name} errors={errors}>
      <select
        id={field.name}
        name={field.name}
        value={field.state.value ?? ""}
        disabled={disabled}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={errors.length > 0}
        className={controlClass(errors.length > 0)}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  )
}

export function DateField({ label, hint, required, disabled }: BaseProps) {
  const field = useFieldContext<string>()
  const errors = useVisibleErrors()

  return (
    <FieldShell label={label} hint={hint} required={required} htmlFor={field.name} errors={errors}>
      <input
        id={field.name}
        name={field.name}
        type="date"
        value={field.state.value ?? ""}
        disabled={disabled}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={errors.length > 0}
        className={cn(controlClass(errors.length > 0), "tabular-nums")}
      />
    </FieldShell>
  )
}

/** A checkbox with its label beside it — the shape `commercial/forms.tsx`
 *  called `Toggle`, kept because it reads better in a dense sheet than a
 *  labelled row with the control on the far right. */
export function SwitchField({
  label,
  hint,
  disabled,
}: {
  label: string
  hint?: ReactNode
  disabled?: boolean
}) {
  const field = useFieldContext<boolean>()

  return (
    <label className={cn("flex items-start gap-2.5 py-1.5", disabled && "opacity-45")}>
      <input
        type="checkbox"
        checked={Boolean(field.state.value)}
        disabled={disabled}
        onChange={(event) => field.handleChange(event.target.checked)}
        onBlur={field.handleBlur}
        className="mt-[2px] size-[15px] shrink-0 accent-[var(--accent)]"
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-ink">{label}</span>
        {hint && (
          <span className="block text-[11px] leading-[1.5] text-ink-4">{hint}</span>
        )}
      </span>
    </label>
  )
}
