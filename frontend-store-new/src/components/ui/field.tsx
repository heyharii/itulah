import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

/// A labelled input, and the one place a field's chrome is described.
///
/// Inputs are pills like everything else interactive, `{soft-2}` filled, and
/// they take the indigo focus ring the base layer authors — so a form does not
/// have to restate any of it. Every control here is 48px: a field on a counter
/// is aimed at with a thumb while somebody is talking to you.
export function Field({
  label,
  hint,
  problem,
  children,
  className,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  /// The node's sentence, or a validator's. Never a code.
  problem?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-meta font-medium text-text">{label}</span>
      {children}
      {problem !== undefined && problem !== null ? (
        <span className="text-meta text-bad">{problem}</span>
      ) : hint !== undefined ? (
        <span className="text-meta text-mute">{hint}</span>
      ) : null}
    </label>
  )
}

const control =
  "h-12 w-full rounded-full border border-transparent bg-soft-2 px-4 text-[1rem] text-ink transition-colors outline-none placeholder:text-mute disabled:opacity-45"

export function Input({
  className,
  invalid,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={cn(
        control,
        // A `{bad}` hairline and a soft same-hue ring — the tint grammar of a
        // status pill, not a glow. The submit button is never turned red; the
        // field already said it.
        invalid === true && "border-bad ring-[3px] ring-bad-bg",
        className,
      )}
      {...props}
    />
  )
}

/// A choice from a fixed list.
///
/// A native `<select>` under a pill, not a bespoke listbox — which on a phone
/// brings the platform's own wheel picker, and that is a far better control
/// than anything worth building here.
export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative inline-flex w-full items-center">
      <select
        className={cn(control, "appearance-none pr-11", className)}
        {...props}
      >
        {children}
      </select>
      {/* Pointer-events off: the chevron is decoration over the native control,
          and swallowing the tap would break the picker. */}
      <ChevronDown className="pointer-events-none absolute right-4 size-4 text-line-ico" />
    </span>
  )
}
