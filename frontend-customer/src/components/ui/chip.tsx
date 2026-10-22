import { cloneElement, isValidElement } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/// A round icon button — the back chevron, the card shortcut. White on the
/// page, its glyph in the matte blue; there is no dark surface for it to sit on.
const chip = cva(
  "press inline-flex size-11 shrink-0 items-center justify-center rounded-full [&_svg]:size-5",
  {
    variants: {
      tone: {
        light: "bg-canvas shadow-soft [&_svg]:text-matte-foot",
      },
    },
    defaultVariants: { tone: "light" },
  },
)

export function Chip({
  className,
  render,
  tone,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof chip> & {
    render?: React.ReactElement<{ className?: string }>
  }) {
  const classes = cn(chip({ tone }), className)

  if (render !== undefined && isValidElement(render)) {
    return cloneElement(render, {
      ...props,
      className: cn(classes, render.props.className),
    } as never)
  }

  return <button type="button" className={classes} {...props} />
}
