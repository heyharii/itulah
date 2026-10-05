import type { ClockControlRequest, ClockStatus } from "@itulah/contract"
import { ChevronRight } from "lucide-react"
import { useState } from "react"

import { ParticleField } from "@/components/shell/particle-field"
import {
  AnalogClock,
  Moment,
  SpaceClock,
  VirtualLabel,
} from "@/components/shell/time-clock"
import type { Jump } from "@/components/shell/use-jump"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Input } from "@/components/ui/field"
import {
  aheadLabel,
  businessDay,
  DAY,
  flowOf,
  dayStart,
  nextMonthStart,
  speedLabel,
} from "@/lib/time-travel"

/// Where the clock's disc sits in the card (0–1), which is where the dust
/// is heading: 16px in from the right, below the label.
const CARD_AIM = { x: 0.84, y: 0.6 }

const QUICK: readonly {
  label: string
  to: (now: number) => number
}[] = [
  { label: "+1 day", to: (now) => now + DAY },
  { label: "+7 days", to: (now) => now + 7 * DAY },
  { label: "+30 days", to: (now) => now + 30 * DAY },
  { label: "Next month", to: nextMonthStart },
]

/// The body of the Time travel popover: the business moment, the jumps, the
/// way back, and — folded away — the speed controls.
export function TimeTravelPanel({
  status,
  bent,
  business,
  jump,
  burst,
  busy,
  problem,
  onJump,
  onBack,
  onControl,
  onSpeed,
}: {
  status: ClockStatus
  bent: boolean
  business: number
  jump: Jump | null
  /// The clock has just jumped: the dust streaks for a moment.
  burst: boolean
  busy: boolean
  problem: string | null
  onJump: (to: (now: number) => number, chosen: boolean) => void
  onBack: () => void
  onControl: (request: ClockControlRequest) => void
  onSpeed: (factor: number) => void
}) {
  const [factor, setFactor] = useState("")
  const speed = speedLabel(status)
  const flow = flowOf(status)
  const nextFactor = Number(factor)
  const factorOk =
    factor.trim() !== "" &&
    Number.isFinite(nextFactor) &&
    nextFactor >= 1 &&
    nextFactor <= 60_000

  return (
    <div className="flex flex-col">
      <div className="px-5 pt-4 pb-4">
        <h2 className="text-[0.9375rem] font-semibold text-ink">Time travel</h2>
        {bent ? (
          // The virtual clock: the face in its disc at the right, the dust
          // streaming in to it from the card's edges, the label above it.
          <div className="space-bg relative isolate mt-3 overflow-hidden rounded-card">
            <ParticleField
              target={CARD_AIM}
              speed={flow.speed}
              burst={burst}
              paused={flow.paused}
            />
            <div className="relative flex flex-col gap-3 px-4 py-3.5">
              <VirtualLabel jump={jump} />
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-[1.125rem] leading-tight font-semibold tracking-[-0.01em] text-space-ink">
                    <Moment ms={business} jump={jump} wrap />
                  </p>
                  <p className="text-[0.875rem] text-space-ink-2">
                    {aheadLabel(status).replace("Virtual · ", "")}
                  </p>
                  {speed && (
                    <p className="text-[0.875rem] text-space-ink-2">{speed}</p>
                  )}
                </div>
                <SpaceClock
                  ms={business}
                  jump={jump}
                  size={72}
                  pad={8}
                  ticks
                  weight={0.9}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-4">
            <AnalogClock
              ms={business}
              jump={jump}
              size={72}
              ticks
              weight={0.9}
              className="text-ink"
            />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-[1.125rem] leading-tight font-semibold tracking-[-0.01em] text-ink">
                <Moment ms={business} jump={jump} />
              </p>
              <p className="text-[0.875rem] text-mute">{aheadLabel(status)}</p>
              {speed && <p className="text-[0.875rem] text-mute">{speed}</p>}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 border-t border-hairline px-5 py-4">
        <div className="grid grid-cols-2 gap-2.5">
          {QUICK.map((quick) => (
            <Button
              key={quick.label}
              variant="ghost"
              className="h-10"
              disabled={busy}
              onClick={() => onJump(quick.to, false)}
            >
              {quick.label}
            </Button>
          ))}
        </div>

        {/* One control for a chosen day: the calendar the rest of the app
            uses, with yesterday and everything before it dead. Choosing a
            day goes to its midnight, through the same confirm step. */}
        <Day
          value=""
          label="Pick a date"
          clearable={false}
          notBefore={businessDay(business + DAY)}
          onChange={(iso) => {
            if (iso !== "") onJump(() => dayStart(iso), true)
          }}
          className="h-10"
        />

        {problem && (
          <p role="alert" className="text-[0.875rem] text-bad-fg">
            {problem}
          </p>
        )}

        {bent && (
          <Button
            variant="quiet"
            className="-mx-2.5 h-10 self-start"
            disabled={busy}
            onClick={onBack}
          >
            Back to real time
          </Button>
        )}
      </div>

      <details className="group border-t border-hairline">
        <summary className="flex h-10 cursor-pointer list-none items-center gap-1.5 px-5 text-[0.875rem] text-mute select-none hover:text-ink [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 stroke-[1.7] transition-transform group-open:rotate-90" />
          Advanced
        </summary>
        <div className="flex flex-col gap-2 px-5 pb-4">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (factorOk) onSpeed(nextFactor)
            }}
          >
            <Input
              type="number"
              inputMode="decimal"
              step="any"
              min="1"
              max="60000"
              aria-label="Speed, times real"
              value={factor}
              onChange={(event) => setFactor(event.target.value)}
              className="min-w-0 flex-1 tabular-nums"
            />
            <Button type="submit" variant="ghost" disabled={busy || !factorOk}>
              Set speed
            </Button>
          </form>
          {bent && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                onControl({ op: status.paused ? "resume" : "pause" })
              }
            >
              {status.paused ? "Resume" : "Pause"}
            </Button>
          )}
        </div>
      </details>
    </div>
  )
}
