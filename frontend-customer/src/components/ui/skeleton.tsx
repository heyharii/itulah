import { cn } from "@/lib/utils"

/// A shape that holds a value's place while it loads. The sweep is linear —
/// it is constant motion, a progress indicator, and those do not ease.
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-full bg-soft-2 bg-[linear-gradient(90deg,transparent_0%,var(--soft-3)_20%,var(--canvas)_50%,var(--soft-3)_80%,transparent_100%)] bg-[length:200%_100%] motion-safe:animate-[shimmer_1.4s_linear_infinite]",
        className,
      )}
      {...props}
    />
  )
}
