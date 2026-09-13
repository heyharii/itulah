import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/// The status pill — one grammar for every state in the app.
///
/// OUTLINED, not filled, since 2026-09-10. What reads is the coloured TEXT;
/// the hairline only holds it. That is the whole substance of the change, and
/// it is worth stating why, because the filled version was not wrong so much
/// as too loud for how often it appears: a list of forty rows with a filled
/// chip in three columns is a page of confetti, and the eye has to work out
/// which of the tinted blocks is a status before it can read one. An outline
/// recedes to the weight of the word inside it.
///
/// The border is deliberately much paler than the text — 30% against 100%. A
/// border as strong as its label turns the tag into a BOX, and a box is a
/// container; a label is a fact about the row. Mixed toward the surface rather
/// than set as its own value so one tone edit moves both.
///
/// The tint is not gone, it moved: `--ok-bg` and its siblings still fill
/// meters, chart bands and the warning box inside a sheet — surfaces large
/// enough for a wash to read as a wash.
///
/// `info` is SKY and only ever means in motion — shipped, processing, issued,
/// still receiving. `accent` means selected. They never swap.
const pill = cva(
  "inline-flex h-[1.5625rem] w-max items-center gap-1.5 rounded-inner border bg-canvas px-[0.5625rem] text-pill font-medium whitespace-nowrap",
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
