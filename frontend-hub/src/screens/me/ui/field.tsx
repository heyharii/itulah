import { INVALID, useFieldAria } from "@/components/ui/field-state"
import { cn } from "@/lib/utils"

/// The hub's own `<Field>`, not a copy of it. The copy that stood here had
/// neither `problem` nor `required`, so a form in this kit could not say an
/// answer was wrong or that one was wanted — and the label was already the
/// same class for class.
export { Field } from "@/components/ui/field"

// 16px on a touch screen: anything smaller makes iOS Safari zoom on focus.
const control = cn(
  "w-full rounded-inner border border-hairline-2 bg-canvas px-3 text-[0.875rem] text-ink transition-colors outline-none placeholder:text-mute hover:border-hairline-strong focus:border-accent disabled:opacity-50 pointer-coarse:text-[1rem]",
  INVALID
)

export function Input({
  className,
  invalid,
  ...props
}: React.ComponentPropsWithRef<"input"> & { invalid?: boolean }) {
  const aria = useFieldAria({
    invalid: invalid ?? ariaFlag(props["aria-invalid"]),
    describedBy: props["aria-describedby"],
  })
  return (
    <input
      {...props}
      {...aria}
      className={cn(control, "h-10 pointer-coarse:h-tap", className)}
    />
  )
}

function ariaFlag(
  value: React.AriaAttributes["aria-invalid"]
): boolean | undefined {
  if (value === undefined) return undefined
  return value === true || value === "true"
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
  invalid,
  ...props
}: React.ComponentPropsWithRef<"textarea"> & { invalid?: boolean }) {
  const aria = useFieldAria({
    invalid: invalid ?? ariaFlag(props["aria-invalid"]),
    describedBy: props["aria-describedby"],
  })
  return (
    <textarea
      {...props}
      {...aria}
      className={cn(control, "py-2.5 leading-[1.375rem]", className)}
    />
  )
}
