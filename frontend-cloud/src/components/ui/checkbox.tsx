"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-[var(--os-hairline-2,#e4e4e8)] bg-[var(--os-canvas,#fff)] transition-colors outline-none focus-visible:border-[var(--os-accent,#3c52f0)] focus-visible:ring-2 focus-visible:ring-[var(--os-accent,#3c52f0)]/20 disabled:cursor-not-allowed disabled:opacity-50 data-checked:border-[var(--os-ink,#1d1d1f)] data-checked:bg-[var(--os-ink,#1d1d1f)] data-checked:text-white",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current [&>svg]:size-3"
      >
        <CheckIcon strokeWidth={2.5} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
