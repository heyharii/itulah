import type { ClockControlRequest, ClockStatus } from "@itulah/contract"
import { Popover } from "@base-ui/react/popover"
import { Clock3 } from "lucide-react"
import { useEffect, useState } from "react"

import { useBurst, useJump } from "@/components/shell/use-jump"
import { AnalogClock, Moment, VirtualPill } from "@/components/shell/time-clock"
import { TimeTravelPanel } from "@/components/shell/time-travel-panel"
import { Dialog } from "@/components/ui/dialog"
import { POP_MOTION } from "@/lib/filter-chrome"
import {
  clockProblem,
  useClockControl,
  useClockStatus,
} from "@/lib/queries/clock"
import {
  DAY,
  aheadShort,
  dayLabel,
  flowOf,
  isBent,
  jumpRequest,
  momentLabel,
  serverNow,
  shortDay,
} from "@/lib/time-travel"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"

/// Time travel — the tester's way to live in a later week.
///
/// Shown only where the clock endpoint answers (an Admin on a node with test
/// controls); everywhere else it is nothing at all. While business time is
/// bent the desk header shows the violet "Virtual clock" pill beside the date
/// and the compact button carries it in the warn colour, so nobody forgets
/// that today is not real.
type Pending =
  | {
      kind: "jump"
      target: number
      days: number
      request: ClockControlRequest
    }
  | { kind: "back" }

export function TimeTravel({
  place,
}: {
  /// `header`: the desk's slim header, where the time is always shown — a
  /// button for whoever may move it, plain text for everyone else. `bar`: the
  /// tablet/phone top bar, where it appears only for those who may.
  place: "header" | "bar"
}) {
  const status = useClockStatus()
  const control = useClockControl()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  /// The instant the readout is drawn at, refreshed every 30 seconds — the
  /// label has a minute's resolution and the status poll corrects the rest.
  const [tick, setTick] = useState(() => Date.now())
  /// A clock running faster than real time is watched, so it ticks every
  /// second and the hands visibly sweep; otherwise the minute is all there is.
  const fast =
    status.data !== undefined &&
    status.data.source.mode === "scaled" &&
    !status.data.paused &&
    status.data.source.factor > 1
  const factor =
    status.data?.source.mode === "scaled" ? status.data.source.factor : 1
  useEffect(() => {
    const id = window.setInterval(
      () => setTick(Date.now()),
      fast ? 1_000 : 30_000
    )
    return () => window.clearInterval(id)
  }, [fast])
  const live = status.data !== undefined && !status.isError ? status.data : null
  const business =
    live === null
      ? null
      : serverNow(
          live,
          status.dataUpdatedAt,
          Math.max(tick, status.dataUpdatedAt)
        ).business
  /// A leap of more than ten minutes between two renders is a jump of the
  /// clock, not a tick — scaled up, ten minutes is what a few seconds cover.
  const spin = useJump(business, Math.max(600_000, factor * 4_000))
  /// The virtual clock's dust streaks for a moment after each jump. Here, not
  /// in the pill, so the first jump off the wall clock — which is what mounts
  /// the pill — bursts as well.
  const burst = useBurst(spin)

  if (live === null || business === null) {
    // Nobody may move the clock here (or it has not answered yet): the desk
    // still says what time it is, as text with nothing to press.
    if (place === "bar") return null
    return (
      <span className="inline-flex h-8 items-center gap-2 text-[0.875rem] font-medium text-ink">
        <AnalogClock
          ms={tick}
          jump={null}
          size={18}
          className="text-line-ico"
        />
        <Moment ms={tick} jump={null} />
      </span>
    )
  }
  const data: ClockStatus = live
  const fetchedAt = status.dataUpdatedAt
  const bent = isBent(data)
  const ahead = bent ? aheadShort(data) : null
  const flow = flowOf(data)

  function run(request: ClockControlRequest, done: (s: ClockStatus) => void) {
    setProblem(null)
    control.mutate(request, {
      onSuccess: (next) => {
        setPending(null)
        done(next)
      },
      onError: (error) => {
        const message = clockProblem(error)
        setProblem(message)
        // The panel and the dialog say it where it was asked; a toast only
        // when neither is showing.
        if (pending === null && !open) toast.error(message)
      },
    })
  }

  function announce(next: ClockStatus) {
    toast.success(
      next.virtual_now === null
        ? "Back to real time"
        : `Now ${dayLabel(Date.parse(next.virtual_now))}`
    )
  }

  function jump(to: (businessNow: number) => number, chosen: boolean) {
    const now = serverNow(data, fetchedAt, Date.now())
    const target = to(now.business)
    const days = Math.round((target - now.business) / DAY)
    setProblem(null)
    // From the wall clock the node would accept a past anchor, so the
    // forward-only rule is ours to keep there; on a virtual clock the node
    // refuses it (409) and says so.
    if (target <= now.business && data.source.mode === "system") {
      setProblem("Time only moves forward. Pick a moment after now.")
      return
    }
    const request = jumpRequest(data, target, now.real)
    if (target > now.business && (chosen || days >= 30)) {
      setOpen(false)
      setPending({ kind: "jump", target, days, request })
      return
    }
    run(request, announce)
  }

  const label = bent
    ? `Time travel: virtual clock is ${momentLabel(business)}`
    : "Time travel"

  return (
    <>
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setProblem(null)
        }}
      >
        <Popover.Trigger
          aria-label={label}
          title={label}
          className={cn(
            "relative inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-inner px-2.5 text-[0.875rem] font-medium tabular-nums transition-colors hover:bg-soft-2 data-[popup-open]:bg-soft-2",
            place === "header"
              ? "-mr-2.5 gap-2.5"
              : cn("max-md:px-2", bent && "bg-warn-bg"),
            place === "header"
              ? "text-ink"
              : bent
                ? "text-warn-fg"
                : "text-body hover:text-ink"
          )}
        >
          {place === "header" ? (
            <>
              {/* On the wall's clock: the plain face and the time, nothing
                  else mounted. Bent: the face moves into the pill, at the end
                  the dust flows to. */}
              {bent ? (
                <VirtualPill
                  ms={business}
                  jump={spin}
                  speed={flow.speed}
                  paused={flow.paused}
                  burst={burst}
                />
              ) : (
                <AnalogClock
                  ms={business}
                  jump={spin}
                  size={18}
                  className="text-line-ico"
                />
              )}
              <span>
                <Moment ms={business} jump={spin} />
                {ahead !== null && (
                  <span className="text-mute"> · {ahead}</span>
                )}
              </span>
            </>
          ) : (
            <>
              <Clock3 className="size-4 stroke-[1.7]" />
              {bent ? (
                <span>{shortDay(business)}</span>
              ) : (
                <span className="max-md:hidden">Time</span>
              )}
            </>
          )}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            className="z-50"
            side="bottom"
            align="end"
            sideOffset={8}
            collisionPadding={16}
          >
            <Popover.Popup
              className={cn(
                "w-[24rem] max-w-[calc(100vw-2rem)] rounded-card border border-hairline bg-canvas text-[0.875rem] shadow-pop outline-none",
                POP_MOTION
              )}
            >
              <TimeTravelPanel
                status={data}
                bent={bent}
                business={business}
                jump={spin}
                burst={burst}
                busy={control.isPending}
                problem={problem}
                onJump={jump}
                onBack={() => {
                  setOpen(false)
                  setPending({ kind: "back" })
                }}
                onControl={(request) => run(request, () => undefined)}
                onSpeed={(factor) => {
                  const now = serverNow(data, fetchedAt, Date.now())
                  run(
                    data.source.mode === "system"
                      ? {
                          op: "set_mode",
                          mode: {
                            mode: "scaled",
                            anchor_real: new Date(now.real).toISOString(),
                            anchor_virtual: new Date(
                              now.business
                            ).toISOString(),
                            factor,
                          },
                        }
                      : { op: "rescale", factor },
                    () => toast.success(`Speed ${factor}×`)
                  )
                }}
              />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      <Dialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) {
            setPending(null)
            setProblem(null)
          }
        }}
        title={
          pending?.kind === "back"
            ? "Back to real time?"
            : `Jump to ${pending ? momentLabel(pending.target) : ""}?`
        }
        confirm={pending?.kind === "back" ? "Back to real time" : "Advance"}
        pending={control.isPending}
        problem={problem === null ? null : new Error(problem)}
        onConfirm={() => {
          if (pending === null) return
          if (pending.kind === "back")
            run({ op: "set_mode", mode: { mode: "system" } }, announce)
          else run(pending.request, announce)
        }}
      >
        {pending?.kind === "back"
          ? "Business time returns to the real clock. Records made while it was ahead keep their dates."
          : `Business time moves ${pending?.days ?? 0} days ahead. It cannot be moved back; records made from now on carry the new dates.`}
      </Dialog>
    </>
  )
}
