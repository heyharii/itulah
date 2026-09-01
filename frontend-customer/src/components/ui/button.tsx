import { cloneElement, isValidElement } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/// Pills, for everything interactive.
///
/// There is no radius between a pill and a 16px card in this language, so a
/// button never gets `rounded-lg`. `dark` is the one black CTA and there is at
/// most one per screen — the black is deliberately not an accent, so the CTA
/// and the indigo never come to mean the same thing.
///
/// The heights are the one place this parts company with the workbench's
/// buttons. DESIGN.md's phone rule is "touch targets ≥ 44px", and the console's
/// 32px pill is a mouse target; a thumb aiming at it is the usual reason a
/// button gets pressed twice.
const button = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        dark: "bg-ink text-on-dark hover:bg-black active:bg-black",
        ghost:
          "border border-hairline-2 bg-canvas text-text hover:bg-soft-2 active:bg-soft-2 [&_svg]:text-line-ico",
        soft: "bg-soft-2 text-text hover:bg-hairline active:bg-hairline [&_svg]:text-line-ico",
        quiet:
          "text-body hover:bg-soft-2 hover:text-ink active:bg-soft-2 [&_svg]:text-line-ico",
      },
      size: {
        default: "h-11 px-5 text-nav [&_svg]:size-4",
        sm: "h-9 px-4 text-meta [&_svg]:size-3.5",
        /// Only for a control sitting inside a line of running text, where a
        /// 44px pill would push the line apart.
        inline: "h-7 px-2.5 text-meta [&_svg]:size-3.5",
        icon: "size-11 [&_svg]:size-5",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "ghost", size: "default", block: false },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  /// Wear the button, but be something else — a router `<Link>`, usually.
  ///
  /// The same escape hatch base-ui's button offered, kept because the
  /// alternative is a `<button>` whose click handler navigates, and that costs
  /// the reader a long-press menu and an address they can copy.
  render?: React.ReactElement<{ className?: string }>
}

export function Button({
  className,
  variant,
  size,
  block,
  render,
  ...props
}: ButtonProps) {
  const classes = cn(button({ variant, size, block }), className)

  if (render !== undefined && isValidElement(render)) {
    return cloneElement(render, {
      ...props,
      className: cn(classes, render.props.className),
    } as never)
  }

  return <button type="button" className={classes} {...props} />
}
