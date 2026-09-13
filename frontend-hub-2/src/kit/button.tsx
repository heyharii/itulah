import type { ButtonHTMLAttributes } from "react"

import { cn } from "@/lib/cn"

/// The one button.
///
/// `primary` is BLACK, and there is at most one per screen. A page holds a
/// dozen things that mean "selected" and every one of them is the accent; a
/// button in that colour is one more of them. Black is the only ink nothing
/// else uses, so "the one to press" needs no disambiguation.
///
/// Not a pill. A fully round control reads consumer, and it also makes a
/// button look like a status chip at a glance — which matters here, because
/// the chips in this app are outlined and the two would be a hairline apart.
export function Button({
  variant = "ghost",
  icon,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "quiet"
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={cn(
        "h-ctl rounded-ctl text-ctl inline-flex shrink-0 items-center gap-1.5 px-2.5 font-medium whitespace-nowrap transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" &&
          "text-canvas hover:bg-black-hover [&_svg]:text-canvas bg-black",
        variant === "ghost" &&
          "border-line-2 bg-canvas text-ink-2 shadow-btn hover:bg-hover hover:text-ink [&_svg]:text-ink-4 border",
        variant === "quiet" &&
          "text-ink-3 hover:bg-hover hover:text-ink [&_svg]:text-ink-4",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
}
