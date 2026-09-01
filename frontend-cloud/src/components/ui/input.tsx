import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/// Form field: inner radius 9px, white, hairline. Search is a pill — set
/// `data-os-search` on that one field only.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-[2.125rem] w-full min-w-0 rounded-[var(--os-r-inner,9px)] border border-[var(--os-hairline-2,#e6e6ea)] bg-[var(--os-canvas,#fff)] px-3 py-1 text-[0.8125rem] text-[var(--os-ink,#1d1d1f)] transition-colors outline-none placeholder:text-[var(--os-mute,#a6a6ad)] focus-visible:border-[var(--os-accent,#3c52f0)] focus-visible:ring-2 focus-visible:ring-[var(--os-accent,#3c52f0)]/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-[0.78125rem] file:font-medium aria-invalid:border-[var(--os-bad,#d05151)] aria-invalid:ring-[3px] aria-invalid:ring-[var(--os-bad-bg,#fbeaea)] data-[os-search]:rounded-full data-[os-search]:border-transparent data-[os-search]:bg-[var(--os-soft-2,#f3f3f5)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
