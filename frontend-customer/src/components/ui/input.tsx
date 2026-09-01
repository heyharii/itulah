import { cn } from "@/lib/utils"

/// A pill, like everything else that is interactive.
///
/// 48px tall and 16px of type: anything smaller than 16px makes iOS Safari
/// zoom the page the moment the field takes focus, and a shopper who has been
/// thrown into a zoomed viewport by typing their card number has to pinch
/// their way back out of it.
export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-12 w-full rounded-full border border-hairline-2 bg-canvas px-4 text-[1rem] text-ink transition-colors placeholder:text-mute hover:border-hairline-strong focus-visible:border-accent focus-visible:outline-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}
