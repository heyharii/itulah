import { cn } from "@/lib/utils"

/// **The tinted button**: the hub's one secondary, pressable-looking action
/// (client, 18 Oct 2026: "ga suka text yg ga terlihat seperti button"). A
/// supporting action is a tint of the accent, a risky one a tint of red, and
/// the one next step of a place stays the solid `<Button variant="primary">`.
///
/// Built here and not from `Button variant="tint"` / `"danger"`: the White
/// look repaints those as a solid primary and a solid red
/// (white.css `.btn-tint`, `.btn-danger`), which would leave Print, All in and
/// Cannot pick as loud as Submit. So this draws plain `bg-*` / `text-*`
/// classes and carries none of the `btn-*` classes white.css targets.
/// `data-support` keeps a foot from promoting it to the primary
/// (white.css `.foot-lifted`).
const TONE = {
  /// Accent word on the accent's wash: Print, All in, + Add to Koli N.
  accent: "bg-accent-bg text-accent [@media(hover:hover)]:hover:bg-accent/15",
  /// A risk or a take-back: Cannot pick, Take out, Back to Pick, Download PDF.
  bad: "bg-bad-bg text-bad-fg [@media(hover:hover)]:hover:bg-bad-fg/15",
  /// A check that passes: Verify RFID (owner, 21 Oct 2026: "hijau").
  ok: "bg-ok-bg text-ok-fg [@media(hover:hover)]:hover:bg-ok-fg/15",
} as const

const SIZE = {
  /// In a row beside a 44px picture ("Put in", "Put on trip"): 38 high.
  row: "h-[2.375rem] px-3",
  /// Anywhere else (a strip, a head, a foot, a dialog): 36 high.
  md: "h-9 px-3.5",
} as const

export type TintTone = keyof typeof TONE
export type TintSize = keyof typeof SIZE

export interface TintButtonProps extends React.ComponentProps<"button"> {
  /// `accent` is the default; `bad` for one that takes something back.
  tone?: TintTone
  /// `md` (36px) by default; `row` (38px) inside a list row. Both are 44px
  /// under a finger.
  size?: TintSize
  /// A 18px lucide glyph before the word.
  icon?: React.ReactNode
}

export function TintButton({
  tone = "accent",
  size = "md",
  icon,
  className,
  type = "button",
  children,
  ...props
}: TintButtonProps) {
  return (
    <button
      type={type}
      data-support="tint"
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-inner text-[0.9375rem] font-semibold whitespace-nowrap transition-[background-color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-11 [&_svg]:size-[1.125rem] [&_svg]:shrink-0",
        TONE[tone],
        SIZE[size],
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
}
