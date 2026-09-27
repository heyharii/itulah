import type { ClockMode, ClockStatus } from "@itulah/contract"
import { Popover } from "@base-ui/react/popover"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { POPUP, POSITIONER } from "@/lib/filter-chrome"
import { useClockControl, useClockStatus } from "@/lib/queries/clock"
import { cn } from "@/lib/utils"

/// The clock chip — one word in the bar saying whether today is real.
///
/// # Why it usually isn't there
///
/// A node reading the wall clock answers `system`, and a chip that said
/// "jam nyata" on every production screen forever would be chrome pretending
/// to be information. So system mode renders NOTHING — the mechanism's
/// presence is announced only when it is actually bending time. The same
/// goes for a node without test controls (403) and for anybody the endpoint
/// won't answer: every failure path collapses to `null`. The bar must never
/// break for an unauthenticated or admin-less user because of a status chip.
///
/// # The time shown
///
/// `virtual_now` arrives as RFC3339 and is rendered in Asia/Jakarta through
/// `Intl`, not sliced by hand — the operator reads the business's own clock,
/// in the business's own locale, and the formatting rules live in exactly
/// one place.

const jakarta = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  dateStyle: "medium",
  timeStyle: "short",
})

function describeMode(mode: ClockMode): string {
  switch (mode.mode) {
    case "system":
      return "Jam mengikuti jam nyata node."
    case "controlled":
      return `Jam dibekukan pada satu titik waktu (${jakarta.format(new Date(mode.at))}).`
    case "scaled":
      return `Jam berjalan ${mode.factor >= 1 ? Math.round(mode.factor) : mode.factor}× lebih cepat dari jam nyata, dikalibrasi dari titik kalibrasi di bawah.`
  }
}

/// `<input type="datetime-local">` speaks local wall time with no zone;
/// appending `:00Z` would be a lie about whose wall. Constructing the Date
/// lets the runtime decide the zone the operator typed in — the same one
/// `toLocaleString` would have shown them — and `.toISOString()` puts it
/// back on the wire as RFC3339, which is what the node parses.
function localInputToDate(value: string): Date | null {
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : at
}

/// The headline the pill carries: the virtual date+time, or the fact that it
/// stopped.
function headline(status: ClockStatus): string {
  if (status.paused) return "dijeda"
  if (status.virtual_now === null) return "jam nyata"
  return jakarta.format(new Date(status.virtual_now))
}

export function ClockChip() {
  const status = useClockStatus()
  const control = useClockControl()
  const busy = control.isPending

  // Rescale is a number the node validates; keep it as text until the
  // operator presses, so a half-typed "876." never becomes a zero factor.
  const [factor, setFactor] = useState("876")
  const [scaledAt, setScaledAt] = useState("")
  const [scaledFactor, setScaledFactor] = useState("876")
  const [advanceTo, setAdvanceTo] = useState("")

  // A fetch that failed, a node that answered 403 (controls off) or 404
  // (route absent): all of them mean "no clock to show", and all of them
  // mean the same thing here — draw nothing.
  if (status.isError || status.data === undefined) return null

  const data = status.data

  // System mode adds nothing to a production screen: the operator's watch
  // already agrees with the node. Render nothing rather than a permanent
  // "jam nyata" badge — documented because it looks like the component is
  // missing, and it is, on purpose.
  if (data.source.mode === "system" && !data.paused) return null

  const mode = data.source
  const virtual = data.virtual_now === null ? null : new Date(data.virtual_now)
  const scale =
    mode.mode === "scaled"
      ? mode.factor >= 1
        ? `×${Math.round(mode.factor)}`
        : `×${mode.factor}`
      : null

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`Jam bisnis: ${headline(data)}. Buka kontrol jam.`}
        className="cursor-pointer"
      >
        <Pill
          tone={data.paused ? "warn" : "info"}
          withDot
          className="cursor-pointer"
        >
          {headline(data)}
          {scale && !data.paused && (
            <span className="text-mute tabular-nums">{scale}</span>
          )}
        </Pill>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className={POSITIONER}
          side="bottom"
          align="end"
          sideOffset={8}
        >
          <Popover.Popup className={cn(POPUP, "w-[20rem] p-0")}>
            <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
              <span className="text-[0.875rem] font-semibold text-ink">
                Jam bisnis
              </span>
              {data.paused && <Pill tone="warn">dijeda</Pill>}
            </div>

            <dl className="flex flex-col gap-1.5 px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-[0.875rem] text-mute">Jam virtual</dt>
                <dd className="text-[0.875rem] font-medium text-ink tabular-nums">
                  {virtual === null ? "—" : jakarta.format(virtual)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-[0.875rem] text-mute">Jam nyata</dt>
                <dd className="text-[0.875rem] text-body tabular-nums">
                  {jakarta.format(new Date(data.real_now))}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-[0.875rem] text-mute">Faktor</dt>
                <dd className="text-[0.875rem] text-body tabular-nums">
                  {scale ?? "—"}
                </dd>
              </div>
              {mode.mode === "scaled" && (
                <div className="flex flex-col gap-1 rounded-inner bg-soft px-2.5 py-2">
                  <span className="text-[0.875rem] text-mute">
                    Titik kalibrasi
                  </span>
                  <span className="text-[0.875rem] text-body tabular-nums">
                    virtual {jakarta.format(new Date(mode.anchor_virtual))}
                  </span>
                  <span className="text-[0.875rem] text-body tabular-nums">
                    nyata {jakarta.format(new Date(mode.anchor_real))}
                  </span>
                </div>
              )}
              <p className="mt-1 text-[0.875rem] leading-relaxed text-body">
                {describeMode(mode)}
              </p>
            </dl>

            <div className="flex flex-col gap-2 border-t border-hairline px-3 py-2.5">
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1"
                  disabled={busy}
                  onClick={() =>
                    control.mutate({ op: data.paused ? "resume" : "pause" })
                  }
                >
                  {data.paused ? "Lanjutkan" : "Jeda"}
                </Button>
              </div>

              {/* Rescale the running factor without touching the anchors: the
                  virtual clock keeps its shape, it just moves faster. */}
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  const next = Number(factor)
                  if (!Number.isFinite(next) || next <= 0) return
                  control.mutate({ op: "rescale", factor: next })
                }}
              >
                <Input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  aria-label="Faktor baru"
                  value={factor}
                  onChange={(event) => setFactor(event.target.value)}
                  className="h-[1.75rem] w-20 text-meta tabular-nums"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  type="submit"
                  disabled={busy || Number(factor) <= 0}
                >
                  Ubah faktor
                </Button>
              </form>

              {/* Hand the clock a new anchor pair: from now on, virtual time
                  runs from the moment the operator named. */}
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  const at = localInputToDate(scaledAt)
                  const next = Number(scaledFactor)
                  if (at === null || !Number.isFinite(next) || next <= 0) return
                  control.mutate({
                    op: "set_mode",
                    mode: {
                      mode: "scaled",
                      anchor_real: new Date().toISOString(),
                      anchor_virtual: at.toISOString(),
                      factor: next,
                    },
                  })
                }}
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="datetime-local"
                    aria-label="Waktu virtual tujuan"
                    value={scaledAt}
                    onChange={(event) => setScaledAt(event.target.value)}
                    className="h-[1.75rem] flex-1 text-meta tabular-nums"
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    aria-label="Faktor"
                    value={scaledFactor}
                    onChange={(event) => setScaledFactor(event.target.value)}
                    className="h-[1.75rem] w-16 text-meta tabular-nums"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  type="submit"
                  disabled={
                    busy ||
                    localInputToDate(scaledAt) === null ||
                    Number(scaledFactor) <= 0
                  }
                >
                  Set jam skala
                </Button>
              </form>

              {/* Jump straight to a business moment — a month-end close, an
                  expiry — without waiting for the calendar. */}
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  const at = localInputToDate(advanceTo)
                  if (at === null) return
                  control.mutate({ op: "advance_to", at: at.toISOString() })
                }}
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="datetime-local"
                    aria-label="Maju sampai waktu"
                    value={advanceTo}
                    onChange={(event) => setAdvanceTo(event.target.value)}
                    className="h-[1.75rem] flex-1 text-meta tabular-nums"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    type="submit"
                    disabled={busy || localInputToDate(advanceTo) === null}
                  >
                    Maju ke
                  </Button>
                </div>
              </form>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
