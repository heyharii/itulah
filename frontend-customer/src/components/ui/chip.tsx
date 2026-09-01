import { cloneElement, isValidElement } from "react"

import { cn } from "@/lib/utils"

/// The frosted icon chip — DESIGN.md's one mobile control shape.
///
/// A 44px white squircle with a hairline and a soft shadow, holding a single
/// pale line-icon. It is what the mobile app-bar is built from, at both ends
/// of its three zones, and 44 is the touch-target floor rather than a
/// decorative size.
export function Chip({
  className,
  render,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  render?: React.ReactElement<{ className?: string }>
}) {
  const classes = cn(
    "inline-flex size-11 shrink-0 items-center justify-center rounded-inner border border-hairline bg-canvas shadow-soft transition-colors hover:bg-soft-2 active:bg-soft-2 [&_svg]:size-[1.125rem] [&_svg]:text-line-ico",
    className,
  )

  if (render !== undefined && isValidElement(render)) {
    return cloneElement(render, {
      ...props,
      className: cn(classes, render.props.className),
    } as never)
  }

  return <button type="button" className={classes} {...props} />
}
