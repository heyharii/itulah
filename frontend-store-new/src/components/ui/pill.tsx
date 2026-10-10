import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/// The status pill — one grammar for every state in the app (the hub's,
/// `frontend-hub/src/components/ui/pill.tsx`).
///
/// OUTLINED, not filled. What reads is the coloured TEXT; the hairline only
/// holds it. The filled version was not wrong so much as too loud for how
/// often a pill appears: a list of forty rows with a tinted chip on each is a
/// page of confetti, and the eye has to work out which of the blocks is a
/// status before it can read one. An outline recedes to the weight of the word
/// inside it.
///
/// One status badge per record: a card's foot and a sheet's head each carry
/// exactly one, and the word is the status's own (`toneFor()` in `lib/format`
/// picks the tone).
///
/// The border is deliberately much paler than the text — 30% against 100%. A
/// border as strong as its label turns the tag into a BOX, and a box is a
/// container; a label is a fact about the line.
///
/// The tint is not gone, it moved: `--ok-bg` and its siblings still fill
/// meters and the warning box inside a sheet — surfaces large enough for a
/// wash to read as a wash.
///
/// `info` is SKY and only ever means in motion — shipped, processing, issued,
/// still receiving. `accent` means selected. They never swap.
const pill = cva(
  "inline-flex h-7 w-max items-center gap-1.5 rounded-inner border bg-canvas px-2.5 text-pill font-medium whitespace-nowrap",
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
        /// Finished and nothing left to do — dark grey, filled, so a
        /// completed row reads as settled beside the coloured ones.
        done: "border-body/40 bg-soft-2 text-text",
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
      done: "bg-body",
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

/// A status as a dot and a word — the quiet grammar (direction E, 28 Sep):
/// no outline, no box, so a column of statuses reads as words rather than as
/// a column of chips. The dot carries the tone; the word turns colour only for
/// the states that need somebody (`warn`, `bad`), and a finished one recedes.
export function Status({
  tone = "neutral",
  className,
  children,
}: {
  tone?: NonNullable<VariantProps<typeof dot>["tone"]>
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap",
        tone === "warn"
          ? "text-warn-fg"
          : tone === "bad"
            ? "text-bad-fg"
            : tone === "done"
              ? "text-mute"
              : "text-text",
        className,
      )}
    >
      <span aria-hidden className={cn(dot({ tone }), "size-1.5")} />
      {children}
    </span>
  )
}
