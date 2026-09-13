import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/// A soft rectangle, not a pill. `rounded-inner` is the radius of every
/// control in this language — a fully round button reads as consumer, and it
/// also stops a control from looking like a status chip at a glance.
///
/// `primary` is the one filled CTA and there is at most one per screen. It is
/// `--cta`, never a hardcoded black and never `bg-accent` written out: those
/// two have swapped places twice in this system, and a till that spells the
/// colour at seventeen call sites is a till that gets left behind when they
/// swap again.
///
/// **Every size here clears 44px.** The console's 32px control is an office
/// control for a mouse; DESIGN.md puts a hard floor under a touch target and
/// this surface is nothing but touch targets. A `sm` that broke the floor would
/// be used, because it looks tidier in a card — so it does not exist. Where a
/// row action wants to look small, it uses `icon` and a small glyph: the target
/// is 44, the drawing inside it is 18.
/// Disabled is a GREY, not a faded colour, and that is a correction the palette
/// forced. Fading the old CTA worked by accident: black at 45% is grey, so a
/// dead button looked dead. Fading the blue one gives a pale lavender bar that
/// reads perfectly well as a light blue button — and the button it happens to
/// most is "take the payment", 56px and full width, the one a cashier hits by
/// reflex without reading. So the state is drawn rather than dimmed: the fill
/// and the label both go neutral, which is what the POS prototype does to every
/// disabled control.
const DISABLED =
  "disabled:pointer-events-none disabled:border-transparent disabled:bg-soft-2 disabled:text-mute disabled:shadow-none disabled:[&_svg]:text-faint"

const button = cva(
  `inline-flex shrink-0 items-center justify-center gap-2 rounded-inner font-medium whitespace-nowrap transition-colors select-none active:brightness-95 ${DISABLED} [&_svg]:shrink-0`,
  {
    variants: {
      variant: {
        primary: "bg-cta text-cta-fg [&_svg]:text-cta-fg",
        ghost:
          "border border-hairline-2 bg-canvas text-text shadow-soft [&_svg]:text-line-ico",
        soft: "bg-soft-2 text-text [&_svg]:text-line-ico",
        quiet: "text-body [&_svg]:text-line-ico",
        danger: "bg-bad-bg text-bad-fg",
      },
      size: {
        /// 44 — the floor, and the ordinary button.
        default: "h-11 px-4 text-control [&_svg]:size-[1.125rem]",
        /// 56 — the one action a screen exists for: take the payment, add the
        /// unit, move the stock. Big enough to hit without looking.
        lg: "h-14 px-6 text-[1rem] [&_svg]:size-5",
        icon: "size-11 [&_svg]:size-[1.125rem]",
      },
      /// Fills its row. A till's primary action is a bar, not a pill floating
      /// in whitespace.
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "ghost", size: "default", block: false },
  },
)

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export function Button({
  className,
  variant,
  size,
  block,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(button({ variant, size, block }), className)}
      {...props}
    />
  )
}

/// The frosted icon chip: a 44px white square with a hairline and a soft
/// shadow, carrying one pale line-icon.
///
/// DESIGN.md gives it three jobs on a phone and this app uses two of them — the
/// app-bar's left and right zones, and the filter control beside a search
/// field. It survives as its own component rather than a `Button` variant
/// because it is the one control whose target is set by the app-bar's height
/// rather than by what is written in it.
export function Chip({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-inner border border-hairline-2 bg-canvas text-line-ico shadow-soft transition-colors select-none active:bg-soft-2 [&_svg]:size-[1.125rem]",
        className,
      )}
      {...props}
    />
  )
}
