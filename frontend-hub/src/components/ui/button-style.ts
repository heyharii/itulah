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
        primary: "btn-primary bg-cta text-cta-fg hover:bg-cta-hover [&_svg]:text-cta-fg",
        ghost:
          "btn-ghost border border-hairline-2 bg-canvas text-text shadow-soft hover:bg-soft-2 hover:text-ink [&_svg]:text-line-ico",
        soft: "btn-soft bg-soft-2 text-text hover:bg-hairline [&_svg]:text-line-ico",
        // The button on a record card's foot (Edit, Set up, Pick): accent text on
        // the accent's own wash, as Apple's tinted button. Quieter than `primary`
        // where a list carries twenty of them, and the same on every card
        // (owner, 2026-10-06).
        tint: "btn-tint bg-accent-bg font-semibold text-accent hover:bg-accent-bg/60 [&_svg]:text-accent",
        quiet: "btn-quiet text-body hover:bg-soft-2 hover:text-ink [&_svg]:text-line-ico",
        danger: "btn-danger bg-bad-bg text-bad-fg hover:brightness-97",
        // Calling something off (Cancel, Close Short): solid red with white text, the one
        // place red is a fill (owner, 2026-10-12).
        destructive: "btn-destructive bg-bad-fg text-white hover:brightness-90 [&_svg]:text-white",
      },
      size: {
        // 32, from `--spacing-control` — the one height every control in a
        // toolbar agrees on. `sm` exists only for controls inside a table row.
        // Under a finger every size grows to 44, what a thumb can land on
        // (Apple's least; D1, 2026-10-06) — the desk's 36/28 stay dense for a
        // mouse. The pointer decides, not the width: an iPad is wide and
        // still touched.
        default:
          "h-control px-2.5 text-control pointer-coarse:h-11 pointer-coarse:px-4 [&_svg]:size-4",
        sm: "h-[1.75rem] px-2 text-meta pointer-coarse:h-11 pointer-coarse:px-3.5 [&_svg]:size-3.5",
        // 44 — a form's own button, beside 44px fields (the sign-in first,
        // 2026-09-28). A size rather than a class passed in, because `h-*`
        // from outside cannot beat `h-control`: `cn` does not know the custom
        // spacing names, so both classes stay and the stylesheet's order
        // picks the 32.
        lg: "h-[2.75rem] px-4 text-[0.9375rem] [&_svg]:size-[1.125rem]",
        icon: "size-control pointer-coarse:size-11 [&_svg]:size-4",
        // The foot of a record card: 32 to look at and still 44 to land on —
        // the pseudo-element is the hit area (Apple: a control may draw smaller
        // than its target). The foot's own padding leaves room for it.
        card: "relative h-8 px-3.5 text-control after:absolute after:-inset-1.5 after:content-[''] [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "ghost", size: "default" },
  }
)

export type ButtonStyle = VariantProps<typeof button>
