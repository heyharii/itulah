import { Fragment } from "react"

import { cn } from "@/lib/utils"

/// Where a record is in its own life, said once, at the top of the panel.
///
/// A status pill answers "what is it now"; the lifecycle answers "what has it
/// been and what is left", which is the question a buyer looking at a partial
/// receipt actually has. Without it the panel has to spend a fact row on
/// "Status: Partial" and the reader still cannot tell whether that is halfway
/// or nearly done.
///
/// The connector carries the reading, not the dots: it turns `{ok}` behind
/// every step that has been passed and stays `{hairline}` ahead of the
/// current one, so the proportion of green to grey *is* the progress bar. The
/// current step is the one inverted mark — `{ink}` fill, white glyph — which
/// is why it never needs a colour of its own.
export type LifecycleState = "done" | "current" | "todo" | "bad"

export type LifecycleStep = {
  label: React.ReactNode
  state: LifecycleState
}

const DOT: Record<LifecycleState, string> = {
  done: "bg-[var(--os-ok-bg,#d9f4d2)] text-[var(--os-ok,#36b827)]",
  current: "bg-[var(--os-ink,#1d1d1f)] text-[var(--os-on-dark,#fff)]",
  todo: "bg-[var(--os-soft-2,#f3f3f5)] text-[var(--os-faint,#d3d3d8)]",
  bad: "bg-[var(--os-bad-bg,#fbeaea)] text-[var(--os-bad,#d05151)]",
}

const LABEL: Record<LifecycleState, string> = {
  done: "text-[var(--os-text,#46464d)]",
  current: "text-[var(--os-ink,#1d1d1f)]",
  todo: "text-[var(--os-mute,#a6a6ad)]",
  bad: "text-[var(--os-bad,#d05151)]",
}

const GLYPH: Record<LifecycleState, string> = {
  done: "✓",
  current: "●",
  todo: "",
  bad: "✕",
}

export function Lifecycle({
  steps,
  className,
}: {
  steps: readonly LifecycleStep[]
  className?: string
}) {
  return (
    <div
      className={cn(
        "mt-[0.125rem] mb-4 flex flex-wrap items-center gap-y-2",
        className,
      )}
    >
      {steps.map((step, index) => (
        <Fragment key={index}>
          <span
            className={cn(
              "flex items-center gap-[0.3125rem] text-[0.65625rem] font-semibold whitespace-nowrap",
              LABEL[step.state],
            )}
          >
            <span
              aria-hidden
              className={cn(
                "grid size-[1.0625rem] shrink-0 place-items-center rounded-full text-[0.5625rem] leading-none",
                DOT[step.state],
              )}
            >
              {GLYPH[step.state]}
            </span>
            {step.label}
          </span>
          {index < steps.length - 1 && (
            <span
              aria-hidden
              className={cn(
                "mx-[0.3125rem] h-[2px] min-w-[0.5rem] flex-1",
                step.state === "done"
                  ? "bg-[var(--os-ok,#36b827)]"
                  : "bg-[var(--os-hairline,#ececef)]",
              )}
            />
          )}
        </Fragment>
      ))}
    </div>
  )
}
