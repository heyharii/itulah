/**
 * The label, hint and error slot every field shares.
 *
 * The markup is lifted verbatim from `commercial/forms.tsx`'s local `Field` —
 * that kit was already right about spacing and the required marker, and there
 * was no reason to redesign it on the way past. What is new is the error slot,
 * because that file had nowhere to put a per-field message: every problem was
 * collected into one list above the sheet, which on a forty-field form is a
 * scavenger hunt rather than an error message.
 */

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export interface FieldShellProps {
  label: string
  hint?: string
  required?: boolean
  htmlFor?: string
  /** Messages for this field. Empty or absent renders nothing. */
  errors?: string[]
  children: ReactNode
}

export function FieldShell({
  label,
  hint,
  required,
  htmlFor,
  errors,
  children,
}: FieldShellProps) {
  const message = errors?.[0]

  return (
    <div className="pb-3.5 last:pb-0">
      <label
        htmlFor={htmlFor}
        className="block pb-1.5 text-xs font-medium text-ink-2"
      >
        {label}
        {required && <span className="pl-1 text-ember">*</span>}
      </label>

      {children}

      {/* The hint is suppressed while an error is showing: two lines of small
          grey text under one input is noise, and the error is the one the user
          needs. The hint returns once the field is valid. */}
      {message ? (
        <p role="alert" className="pt-1 text-[11px] leading-[1.5] text-ember">
          {message}
        </p>
      ) : (
        hint && (
          <p className="pt-1 text-[11px] leading-[1.5] text-ink-4">{hint}</p>
        )
      )}
    </div>
  )
}

/** Two fields side by side above `sm`, stacked below. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-x-3 sm:grid-cols-2">{children}</div>
}

/** A titled group of fields inside a sheet. */
export function FieldSection({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="border-b border-line pb-4 last:border-b-0 last:pb-0">
      <h3 className="pb-0.5 text-[11px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
        {title}
      </h3>
      {hint && (
        <p className="pb-2 text-[11px] leading-[1.5] text-ink-4">{hint}</p>
      )}
      <div className={cn(!hint && "pt-2")}>{children}</div>
    </section>
  )
}

/** The input shell every text-like control shares, so focus and error states
 *  look the same everywhere without each field restating them. */
export const controlClass = (invalid: boolean) =>
  cn(
    "h-8 w-full rounded-control bg-field px-2.5 text-xs text-ink outline-none",
    "shadow-[inset_0_0_0_1px_var(--line-strong)]",
    "placeholder:text-ink-4",
    "focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]",
    "disabled:opacity-45",
    invalid && "shadow-[inset_0_0_0_1px_var(--ember)]"
  )
