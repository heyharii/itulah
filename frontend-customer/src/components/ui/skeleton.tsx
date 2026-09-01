import { cn } from "@/lib/utils"

/// The shape of something that has not arrived.
///
/// A gradient sweep rather than a pulse — beUI's text-shimmer treatment
/// (https://beui.dev/components/motion/text-animation), which reads as work in
/// progress where an opacity pulse reads as a fault. It travels across
/// `{soft-2}` and stops entirely under `prefers-reduced-motion`, where the
/// still tint says the same thing.
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-inner bg-soft-2 bg-[linear-gradient(90deg,transparent_0%,var(--soft-3)_20%,var(--canvas)_50%,var(--soft-3)_80%,transparent_100%)] bg-[length:200%_100%] motion-safe:animate-[shimmer_1.6s_ease-in-out_infinite]",
        className,
      )}
      {...props}
    />
  )
}
