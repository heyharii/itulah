import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/// The status pill: a soft tint carrying same-hue text.
///
/// One grammar for every state in the system, so the four colours are learned
/// once. `accent` is the indigo one — selection and this app's own figure,
/// points — and `info` is the sky one, which only ever means in motion. They
/// are never swapped.
const pill = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-pill font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      tone: {
        accent: "bg-accent-bg text-info-fg",
        ok: "bg-ok-bg text-ok-fg",
        warn: "bg-warn-bg text-warn-fg",
        bad: "bg-bad-bg text-bad-fg",
        info: "bg-info-bg text-info-fg",
        soft: "bg-soft-2 text-body",
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
