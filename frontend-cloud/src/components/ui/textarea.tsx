import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full resize-none rounded-[var(--os-r-inner,9px)] border border-[var(--os-hairline-2,#e6e6ea)] bg-[var(--os-canvas,#fff)] px-3 py-2 text-[0.8125rem] text-[var(--os-ink,#1d1d1f)] transition-colors outline-none placeholder:text-[var(--os-mute,#a6a6ad)] focus-visible:border-[var(--os-accent,#3c52f0)] focus-visible:ring-2 focus-visible:ring-[var(--os-accent,#3c52f0)]/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[var(--os-bad,#d05151)] aria-invalid:ring-[3px] aria-invalid:ring-[var(--os-bad-bg,#fbeaea)]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
