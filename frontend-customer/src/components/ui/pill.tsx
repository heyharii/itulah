import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/// A short fact set in a capsule — "Gratis", "Ditukar", "+13 poin".
const pill = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-pill font-medium whitespace-nowrap [&_svg]:size-3.5",
  {
    variants: {
      tone: {
        accent: "bg-accent-bg text-info-fg",
        ok: "bg-ok-bg text-ok-fg",
        warn: "bg-warn-bg text-warn-fg",
        bad: "bg-bad-bg text-bad-fg",
        info: "bg-info-bg text-info-fg",
        soft: "bg-soft-2 text-body",
        ink: "bg-ink text-on-dark",
      },
    },
    defaultVariants: { tone: "soft" },
  },
)

export function Pill({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof pill>) {
  return <span className={cn(pill({ tone }), className)} {...props} />
}
