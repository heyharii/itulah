import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/// Pills for everything interactive. There is no radius between a pill and a
/// card in this language, so a button never gets `rounded-lg`.
///
/// `dark` is the one black CTA and there is at most one per screen: the black
/// is deliberately not an accent, so the CTA and the indigo never compete for
/// the same meaning.
///
/// **Every size here clears 44px.** The console's 32px pill is an office
/// control for a mouse; DESIGN.md puts a hard floor under a touch target and
/// this surface is nothing but touch targets. A `sm` that broke the floor would
/// be used, because it looks tidier in a card — so it does not exist. Where a
/// row action wants to look small, it uses `icon` and a small glyph: the target
/// is 44, the drawing inside it is 18.
const button = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-colors select-none active:brightness-95 disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        dark: "bg-ink text-on-dark",
        ghost:
          "border border-hairline-2 bg-canvas text-text [&_svg]:text-line-ico",
        soft: "bg-soft-2 text-text [&_svg]:text-line-ico",
        quiet: "text-body [&_svg]:text-line-ico",
        accent: "bg-accent text-on-dark",
        danger: "bg-bad-bg text-bad-fg",
      },
      size: {
        /// 44 — the floor, and the ordinary button.
        default: "h-11 px-4 text-[0.875rem] [&_svg]:size-[1.125rem]",
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

/// The frosted icon chip: a ~44px white squircle with a hairline and a soft
/// shadow, carrying one pale line-icon.
///
/// DESIGN.md gives it three jobs on a phone and this app uses two of them — the
/// app-bar's left and right zones, and the filter control beside a search
/// field. It is a `Chip` rather than a `Button variant`, because its geometry
/// is a squircle and every button in this system is a pill.
export function Chip({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-[0.875rem] border border-hairline bg-canvas text-line-ico shadow-soft transition-colors select-none active:bg-soft-2 [&_svg]:size-[1.125rem]",
        className,
      )}
      {...props}
    />
  )
}
