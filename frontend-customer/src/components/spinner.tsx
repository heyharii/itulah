import { cn } from "@/lib/utils"

/// A fast spinner makes waiting feel shorter than a slow one (Emil: perceived
/// performance). 700ms a turn, linear. It takes the colour of the text it sits
/// in, so the same one is white on a primary button and blue on a pastel one.
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-4 shrink-0 rounded-full border-2 border-current border-r-transparent motion-safe:animate-[spin_0.7s_linear_infinite]",
        className,
      )}
    />
  )
}
