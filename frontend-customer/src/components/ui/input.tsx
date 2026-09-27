import { cn } from "@/lib/utils"

/// A soft well rather than an outlined box: the field is a place to type into,
/// not a frame. 16px text on purpose — anything smaller and iOS zooms the page
/// when the field takes focus.
export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-14 w-full rounded-inner bg-soft-2 px-4 text-[1.0625rem] font-medium text-ink caret-accent transition-[box-shadow,background-color] duration-[var(--t-hover)] ease-[var(--ease-out)] placeholder:font-normal placeholder:text-mute focus-visible:bg-canvas focus-visible:shadow-[0_0_0_2px_var(--accent)] focus-visible:outline-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}
