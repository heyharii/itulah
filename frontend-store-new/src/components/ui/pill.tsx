import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/// The status pill — one grammar for every state in the app.
///
/// The tint carries the meaning and the text is a darker cut of the same hue:
/// the saturated token (`--ok`, `--warn`) is for the dot, the meter and the
/// glyph, and at 11px on a tint it fails contrast, which is why each tone has a
/// second, readable foreground.
///
/// `info` is SKY and only ever means in motion — shipped, processing, issued,
/// still receiving. `accent` is INDIGO and means selected. They never swap.
const pill = cva(
  "inline-flex h-[1.3125rem] w-max items-center gap-1.5 rounded-full px-2 text-pill font-semibold whitespace-nowrap",
  {
    variants: {
      tone: {
        ok: "bg-ok-bg text-ok-fg",
        warn: "bg-warn-bg text-warn-fg",
        bad: "bg-bad-bg text-bad-fg",
        info: "bg-info-bg text-info-fg",
        accent: "bg-accent-bg text-info-fg",
        neutral: "bg-soft-2 text-body",
        new: "bg-new-bg text-new-fg",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
)

const dot = cva("size-[5px] shrink-0 rounded-full", {
  variants: {
    tone: {
      ok: "bg-ok",
      warn: "bg-warn",
      bad: "bg-bad",
      info: "bg-info",
      accent: "bg-accent",
      neutral: "bg-mute",
      new: "bg-new-fg",
    },
  },
  defaultVariants: { tone: "neutral" },
})

export interface PillProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof pill> {
  /// Record-card pills are text-only in the reference; a leading dot is for
  /// dense dashboards and legends, where the tint alone is too small to read.
  readonly withDot?: boolean
}

export function Pill({
  className,
  tone,
  withDot,
  children,
  ...props
}: PillProps) {
  return (
    <span className={cn(pill({ tone }), className)} {...props}>
      {withDot && <span className={dot({ tone })} />}
      {children}
    </span>
  )
}
