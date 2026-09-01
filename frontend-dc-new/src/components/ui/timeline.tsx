import { cn } from "@/lib/utils"

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
              "flex shrink-0 items-center gap-1.5 text-[0.65625rem] font-semibold whitespace-nowrap",
              step.state === "done" && "text-text",
              step.state === "current" && "text-ink",
              step.state === "todo" && "text-mute"
            )}
          >
            <span
              className={cn(
                "grid size-[1.0625rem] shrink-0 place-items-center rounded-full text-[0.5625rem]",
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
