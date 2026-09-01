import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

/// A labelled input, and the one place a field's chrome is described.
///
/// Inputs are pills like everything else interactive, `{soft-2}` filled, and
/// they take the indigo focus ring the base layer authors — so a form does not
/// have to restate any of it.
///
/// **They are 44px, not the hub's 36.** Everything on this surface is pressed
/// with a thumb in a glove, so the touch floor is the default rather than
/// something every form has to remember. A smaller height passed by a caller
/// still wins — `twMerge` resolves it — which is how the two controls that sit
/// inside a dense row stay dense.
export function Field({
  label,
  hint,
  problem,
  children,
  className,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  /// The server's sentence, or a validator's. Never a code.
  problem?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[0.78125rem] font-medium text-text">{label}</span>
      {children}
      {problem ? (
        <span className="text-[0.71875rem] text-bad">{problem}</span>
      ) : hint ? (
        <span className="text-[0.71875rem] text-mute">{hint}</span>
      ) : null}
    </label>
  )
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-tap w-full rounded-full border border-transparent bg-soft-2 px-4 text-[0.84375rem] text-ink transition-colors outline-none",
        "placeholder:text-mute hover:border-hairline-2 hover:bg-soft-3",
        "disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

/// Multi-line input. The one control that is not a pill — a rounded rectangle,
/// because a pill with three lines of text in it reads as a mistake.
export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-inner border border-hairline-2 bg-canvas px-3.5 py-2.5 text-[0.84375rem] text-ink transition-colors outline-none",
        "placeholder:text-mute hover:border-hairline-strong",
        className
      )}
      {...props}
    />
  )
}

/// A choice from a fixed list.
///
/// A native `<select>` under a pill, not a bespoke listbox. Six modules wrote
/// their own before this was promoted, and each one had a slightly different
/// chevron — which is the argument for promoting it rather than for building
/// something cleverer. The native control also brings a phone's own picker,
/// which matters on the handheld and till surfaces that share this kit.
export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative inline-flex w-full items-center">
      <select
        className={cn(
          "h-tap w-full appearance-none rounded-full border border-transparent bg-soft-2 pr-9 pl-4 text-[0.84375rem] text-ink transition-colors outline-none",
          "hover:border-hairline-2 hover:bg-soft-3",
          "disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
      </select>
      {/* Pointer-events off: the chevron is decoration over the native
          control, and swallowing the click would break the picker. */}
      <ChevronDown className="pointer-events-none absolute right-3 size-3.5 text-line-ico" />
    </span>
  )
}
