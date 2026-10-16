import { cn } from "@/lib/utils"

/// The activity / status timeline inside a record.
///
/// Nodes are status semaphores in the same four colours as every pill: `warn`
/// is now/waiting, `info` is in motion, `ok` is done, `neutral` is not reached.
/// Learning the four colours once and reusing them across pills, meters, map
/// markers and these nodes is the whole point of the status grammar.
export interface TimelineEvent {
  readonly id: string
  readonly title: React.ReactNode
  /// "By: …", "Estimated …" — the lines under the title.
  readonly detail?: React.ReactNode
  /// Right-aligned, muted. Absent for a step that has not happened.
  readonly at?: React.ReactNode
  readonly state: "done" | "current" | "todo"
  readonly icon?: React.ReactNode
}

export function Timeline({
  events,
  className,
}: {
  events: readonly TimelineEvent[]
  className?: string
}) {
  return (
    <ol className={cn("flex flex-col", className)}>
      {events.map((event, index) => (
        <li key={event.id} className="relative flex items-start gap-2.5 py-1.5">
          {/* The connector stops at the last node rather than trailing into
              nothing. */}
          {index < events.length - 1 && (
            <span className="absolute top-[1.875rem] left-3 h-[calc(100%-1.5rem)] w-[1.5px] bg-hairline-2" />
          )}
          <span
            className={cn(
              "z-10 grid size-[1.5625rem] shrink-0 place-items-center rounded-[7px] font-mono text-[0.9375rem] font-semibold",
              event.state === "done" && "bg-ok-bg text-ok-fg",
              event.state === "current" && "bg-info text-white",
              event.state === "todo" && "bg-soft-2 text-body"
            )}
          >
            {event.icon ?? index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block text-[0.9375rem] font-medium",
                event.state === "todo" ? "text-mute" : "text-ink"
              )}
            >
              {event.title}
            </span>
            {event.detail && (
              <span className="block text-[0.9375rem] text-mute">
                {event.detail}
              </span>
            )}
          </span>
          {event.at && (
            <span className="shrink-0 text-[0.9375rem] text-body tabular-nums">
              {event.at}
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

/// The horizontal lifecycle ribbon a record wears at the top: where it is in a
/// fixed sequence of states.
///
/// The current step is the single `{dark}` mark in the row — the one place a
/// state, rather than a CTA, is allowed to be black, because it is a position
/// on a track and not something to click.
export function Lifecycle({
  steps,
  className,
}: {
  steps: readonly {
    readonly label: string
    readonly state: "done" | "current" | "todo"
  }[]
  className?: string
}) {
  return (
    <div
      className={cn(
        "mt-0.5 mb-4 flex flex-wrap items-center gap-y-2",
        className
      )}
    >
      {steps.map((step, index) => (
        <div key={step.label} className="flex flex-1 items-center">
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 text-[0.9375rem] font-semibold whitespace-nowrap",
              step.state === "done" && "text-text",
              step.state === "current" && "text-ink",
              step.state === "todo" && "text-mute"
            )}
          >
            <span
              className={cn(
                "grid size-[1.0625rem] shrink-0 place-items-center rounded-full text-[0.9375rem]",
                step.state === "done" && "bg-ok-bg text-ok-fg",
                step.state === "current" && "bg-ink text-white",
                step.state === "todo" && "bg-soft-2 text-faint"
              )}
            >
              {step.state === "done" ? "✓" : index + 1}
            </span>
            {step.label}
          </span>
          {index < steps.length - 1 && (
            <span
              className={cn(
                "mx-1.5 h-0.5 min-w-2 flex-1",
                step.state === "done" ? "bg-ok" : "bg-hairline"
              )}
            />
          )}
        </div>
      ))}
    </div>
  )
}
