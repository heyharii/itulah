import { cn } from "@/lib/utils"

/// One hairline. Whitespace separates; this divides.
export function Separator({
  className,
  ...props
}: React.HTMLAttributes<HTMLHRElement>) {
  return (
    <hr
      className={cn("h-px w-full border-0 bg-hairline", className)}
      {...props}
    />
  )
}
