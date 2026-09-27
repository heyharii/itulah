import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const pill = cva(
  "inline-flex h-[1.5625rem] w-max shrink-0 items-center gap-1.5 rounded-inner border bg-canvas px-[0.5625rem] text-pill font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        ok: "border-ok-fg/30 text-ok-fg",
        warn: "border-warn-fg/30 text-warn-fg",
        bad: "border-bad-fg/30 text-bad-fg",
        info: "border-info-fg/30 text-info-fg",
        accent: "border-accent/30 text-accent",
        neutral: "border-hairline-2 text-body",
        new: "border-new-fg/30 text-new-fg",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
)

export type PillTone = NonNullable<VariantProps<typeof pill>["tone"]>

export function Pill({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof pill>) {
  return <span className={cn(pill({ tone }), className)} {...props} />
}
