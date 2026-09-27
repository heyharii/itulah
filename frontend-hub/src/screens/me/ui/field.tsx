import { cn } from "@/lib/utils"

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn("flex flex-col gap-[0.4375rem]", className)}>
      <span className="text-[0.875rem] font-medium text-text">{label}</span>
      {children}
      {hint && <span className="text-[0.875rem] text-mute">{hint}</span>}
    </label>
  )
}

// 16px on a touch screen: anything smaller makes iOS Safari zoom on focus.
const control =
  "w-full rounded-inner border border-hairline-2 bg-canvas px-3 text-[0.875rem] text-ink transition-colors outline-none placeholder:text-mute hover:border-hairline-strong focus:border-accent disabled:opacity-50 pointer-coarse:text-[1rem]"

export function Input({
  className,
  ...props
}: React.ComponentPropsWithRef<"input">) {
  return (
    <input
      className={cn(control, "h-10 pointer-coarse:h-tap", className)}
      {...props}
    />
  )
}

/// The hub's own, not a `<select>`: a phone gets the same bottom sheet every
/// other picker in the app opens, and an Android phone gets it too rather than
/// its platform's dialog. Its `onChange` takes the value, not an event.
export { Select } from "@/components/ui/field"
export { Day } from "@/components/ui/day"

/// What the two borrowed controls add to stand at `<Input>`'s height and type
/// size on a touch screen, so a form mixing them reads as one set.
export const TAP = "pointer-coarse:h-tap pointer-coarse:text-[1rem]"

export function Textarea({
  className,
  ...props
}: React.ComponentPropsWithRef<"textarea">) {
  return (
    <textarea
      className={cn(control, "py-2.5 leading-[1.375rem]", className)}
      {...props}
    />
  )
}
