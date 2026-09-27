import { cva, type VariantProps } from "class-variance-authority"

/// The pill, as a value rather than a component.
///
/// Its own module because a file that exports both a component and a value
/// loses fast refresh — and because `<AppLink>` needs the classes without the
/// element. An anchor that wants to look like a button must BE an anchor:
/// wrapping a `<button>` in an `<a>` is invalid HTML, announces two controls
/// to a screen reader, and on some browsers the keyboard activates the inner
/// one and goes nowhere.
///
/// `primary` is the one filled CTA and there is at most one per screen. It is
/// BLACK, and this is the second time that has been decided — so the previous
/// reversal is worth answering rather than quietly overwriting.
///
/// Black was tried, dropped for indigo, and is now back. What failed the first
/// time was not the black: it was the indigo everywhere else. When the active
/// nav row, the selected cell, the focus ring and half the chrome were all a
/// saturated violet-blue, a black button genuinely did read as a second system
/// sitting on top of the first. Since 2026-09-10 the accent is a plainer blue
/// and it appears in far fewer places — selection only — so the page it stands
/// on is neutral, and black is simply the darkest thing on it.
///
/// The positive argument, which held all along: a screen can hold a dozen
/// things that mean "selected" and every one of them is the accent. A CTA in
/// that same colour is one more of them. Black is the only ink nothing else
/// uses, so "the button to press" needs no disambiguation.
export const button = cva(
  // Pressed, it gives: `scale(0.97)` on `:active`, 120ms, ease-out. Feedback
  // on the finger landing rather than on its lifting is what a native button
  // does, and the label and icon shrink with it so it reads as one object
  // pushed in. `:active` is a real press on touch too — no hover gating.
  //
  // `rounded-inner` (8), not a pill. A fully round control reads as consumer;
  // the reference screens hold a soft rectangle, and it also stops a button
  // from looking like a status chip at a glance.
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-inner font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 disabled:aria-busy:opacity-75 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-cta text-cta-fg hover:bg-cta-hover [&_svg]:text-cta-fg",
        ghost:
          "border border-hairline-2 bg-canvas text-text shadow-soft hover:bg-soft-2 hover:text-ink [&_svg]:text-line-ico",
        soft: "bg-soft-2 text-text hover:bg-hairline [&_svg]:text-line-ico",
        quiet: "text-body hover:bg-soft-2 hover:text-ink [&_svg]:text-line-ico",
        danger: "bg-bad-bg text-bad-fg hover:brightness-97",
      },
      size: {
        // 32, from `--spacing-control` — the one height every control in a
        // toolbar agrees on. `sm` exists only for controls inside a table row.
        // Under a finger every size grows to something a thumb can land
        // on (40, 36, 40) — the desk's 32/28 stay dense for a mouse. The
        // pointer decides, not the width: an iPad is wide and still touched.
        default:
          "h-control px-2.5 text-control pointer-coarse:h-10 pointer-coarse:px-3.5 [&_svg]:size-4",
        sm: "h-[1.75rem] px-2 text-meta pointer-coarse:h-9 pointer-coarse:px-3 [&_svg]:size-3.5",
        icon: "size-control pointer-coarse:size-10 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "ghost", size: "default" },
  }
)

export type ButtonStyle = VariantProps<typeof button>
