import { cloneElement, isValidElement } from "react"
import { ChevronRight } from "lucide-react"

import { MattePicture, type MatteArt } from "@/components/matte"
import { cn } from "@/lib/utils"

/// Rows grouped on one white card, the way a settings screen groups them.
/// No dividers: the rows are spaced, and a line between each would draw a
/// table where the reference draws a list.
export function ListGroup({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-card bg-canvas p-1.5 shadow-soft", className)}
      {...props}
    />
  )
}

/// One row: a matte picture, what it is, optionally a line about it, and on
/// the right either a value or the chevron that says it goes somewhere. The
/// danger row's picture turns red with its words.
///
/// Press feedback is a tint, not a shrink — a row inside a card is part of a
/// surface, and a surface does not pull away from the finger the way a button
/// does. It lands on pointer-down (`:active`) so it is never late.
export function ListRow({
  art,
  title,
  description,
  trailing,
  chevron = false,
  tone = "default",
  render,
  className,
  ...props
}: {
  art?: MatteArt
  title: React.ReactNode
  description?: React.ReactNode
  trailing?: React.ReactNode
  chevron?: boolean
  tone?: "default" | "danger"
  render?: React.ReactElement<{ className?: string }>
  className?: string
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title">) {
  const interactive = render !== undefined || props.onClick !== undefined
  const classes = cn(
    "flex w-full items-center gap-3 rounded-inner px-3 py-2.5 text-left",
    interactive &&
      "transition-colors duration-[var(--t-hover)] ease-[var(--ease-out)] active:bg-soft-2",
    className,
  )
  const body = (
    <>
      {art !== undefined && (
        <MattePicture art={art} tone={tone === "danger" ? "bad" : "deep"} />
      )}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-metric font-medium",
            tone === "danger" ? "text-bad-fg" : "text-ink",
          )}
        >
          {title}
        </span>
        {description !== undefined && (
          <span className="mt-0.5 block text-meta text-body">
            {description}
          </span>
        )}
      </span>
      {trailing}
      {chevron && (
        <ChevronRight aria-hidden className="size-[1.125rem] text-faint" />
      )}
    </>
  )

  if (render !== undefined && isValidElement(render)) {
    return cloneElement(render, { className: classes, children: body } as never)
  }
  if (interactive) {
    return (
      <button type="button" className={classes} {...props}>
        {body}
      </button>
    )
  }
  return <div className={classes}>{body}</div>
}
