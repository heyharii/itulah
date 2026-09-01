import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // motion-reduce turns the pulse off outright: for someone who has asked
      // for less motion, a silently-throbbing placeholder is still motion.
      className={cn("motion-reduce:animate-none animate-pulse rounded-none bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
