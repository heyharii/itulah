import { cn } from "@/lib/cn"

/// The outline tag — a label that happens to be enclosed.
///
/// OUTLINED, not filled. A filled version is not wrong so much as too loud for
/// how often it appears: forty rows with a tinted block in three columns is a
/// page of confetti, and the eye has to work out which of the blocks is a
/// status before it can read one. An outline recedes to the weight of the word
/// inside it.
///
/// The border is deliberately much paler than the text. A border as strong as
/// its label turns the tag into a BOX, and a box is a container; a label is a
/// fact about the row.
///
/// The tint is not gone, it moved: `*-wash` still fills meters, chart bands and
/// the warning box inside a sheet — surfaces large enough for a wash to read as
/// a wash.
const TONE = {
  neutral: "border-line-2 text-ink-3",
  ok: "border-ok-ink/30 text-ok-ink",
  warn: "border-warn-ink/30 text-warn-ink",
  bad: "border-bad-ink/30 text-bad-ink",
  info: "border-info-ink/30 text-info-ink",
  blue: "border-blue/30 text-blue",
} as const

export function Tag({
  tone = "neutral",
  className,
  children,
}: {
  tone?: keyof typeof TONE
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "rounded-tag bg-canvas text-ctl inline-flex h-[25px] items-center border px-[9px] font-medium tracking-[-0.005em] whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/// A tag in a colour the DATA carries rather than one the taxonomy assigns —
/// a pot of money, a division, a campaign. `tone` is a CSS colour, and the
/// border is mixed toward the surface from it so one value moves both.
export function ToneTag({
  tone,
  className,
  children,
}: {
  tone: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      style={{
        color: tone,
        borderColor: `color-mix(in oklab, ${tone} 30%, #fff)`,
      }}
      className={cn(
        "rounded-tag bg-canvas text-ctl inline-flex h-[25px] items-center border px-[9px] font-medium tracking-[-0.005em] whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  )
}
