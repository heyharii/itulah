import { cloneElement, isValidElement } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/// A pill, in four weights of emphasis.
///
/// `primary` is the one near-black action a screen holds — at most one. The
/// rest step down: `secondary` is a white pill standing on the grey page,
/// `soft` sits inside a white card, `quiet` is a text link that still has a
/// 44px target.
///
/// Every variant shrinks to 0.97 on press (`.press`): the only feedback a
/// touch screen can give on pointer-down, and the one that makes a button feel
/// like it heard you.
const DISABLED =
  "disabled:pointer-events-none disabled:bg-none disabled:bg-soft-2 disabled:text-mute disabled:shadow-none disabled:[&_svg]:text-faint"

const button = cva(
  `press inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap select-none ${DISABLED} [&_svg]:shrink-0`,
  {
    variants: {
      variant: {
        primary: "cta-fill text-cta-fg [&_svg]:text-cta-fg",
        secondary:
          "bg-canvas text-ink shadow-soft hover:bg-soft [&_svg]:text-ink",
        ghost: "bg-canvas text-ink shadow-soft hover:bg-soft [&_svg]:text-ink",
        soft: "bg-soft-2 text-ink hover:bg-hairline [&_svg]:text-text",
        quiet: "text-body hover:text-ink [&_svg]:text-line-ico",
        danger: "bg-bad-bg text-bad-fg [&_svg]:text-bad-fg",
      },
      size: {
        lg: "h-14 px-7 text-button font-semibold [&_svg]:size-5",
        default: "h-12 px-6 text-nav font-semibold [&_svg]:size-[1.125rem]",
        sm: "h-9 px-4 text-meta font-semibold [&_svg]:size-4",
        inline: "h-8 px-3 text-meta [&_svg]:size-3.5",
        icon: "size-11 [&_svg]:size-5",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "secondary", size: "default", block: false },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  /// Render as another element (a router `Link`) while keeping the button's
  /// styling — Base UI's `render` prop pattern, in a few lines.
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
