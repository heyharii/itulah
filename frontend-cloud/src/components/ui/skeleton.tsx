import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-[var(--os-r-inner,9px)] bg-[var(--os-soft-2,#f3f3f5)]", className)}
      {...props}
    />
  )
}

export { Skeleton }
