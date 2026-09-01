/**
 * What the two HR routes render while their loader is in flight, and what
 * they render when it fails.
 *
 * Two screens, two frames: hr-ho's rail carries seven section links, hr-store's
 * carries the store switcher and the roster grid header. Both mirror the real
 * layout — the 240px rail, the 52px header strip — rather than a spinner, for
 * the same reason inventory's does. See `inventory/route-states.tsx`.
 */

import { isApiError } from "@/lib/api"

function Line({ w, h = 12 }: { w: string; h?: number }) {
  return (
    <div
      className="animate-pulse rounded-chip bg-hover"
      style={{ width: w, height: h }}
    />
  )
}

function Rail({ rows }: { rows: string[] }) {
  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-page max-lg:hidden">
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-2.5">
        <div className="size-[22px] animate-pulse rounded-chip bg-hover" />
        <Line w="84px" h={13} />
      </div>
      <div className="flex flex-col gap-1.5 px-3 pt-1">
        {rows.map((w, i) => (
          <div key={i} className="flex h-8 items-center">
            <Line w={w} />
          </div>
        ))}
      </div>
    </aside>
  )
}

function CardGrid() {
  return (
    <div className="flex-1 px-4 pt-4">
      <div className="grid grid-cols-3 gap-2.5">
        {Array.from({ length: 9 }, (_, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-control border border-line p-3"
          >
            <div className="flex items-center gap-2">
              <div className="size-7 shrink-0 animate-pulse rounded-full bg-hover" />
              <Line w={`${58 + ((i * 11) % 26)}%`} />
            </div>
            <Line w="70%" h={9} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function HrHoPending() {
  return (
    <div
      className="grid h-dvh grid-cols-[240px_minmax(0,1fr)] max-lg:grid-cols-[minmax(0,1fr)]"
      aria-busy="true"
      aria-label="Loading head-office people"
    >
      <Rail rows={["46%", "38%", "42%", "50%", "44%", "36%", "40%"]} />
      <div className="flex min-w-0 flex-col">
        <div className="flex h-[52px] shrink-0 items-center gap-3 px-4">
          <Line w="120px" h={13} />
        </div>
        <CardGrid />
      </div>
    </div>
  )
}

export function HrStorePending() {
  return (
    <div
      className="grid h-dvh grid-cols-[240px_minmax(0,1fr)] max-lg:grid-cols-[minmax(0,1fr)]"
      aria-busy="true"
      aria-label="Loading store people"
    >
      <Rail rows={["50%", "40%", "46%", "36%", "44%", "38%"]} />
      <div className="flex min-w-0 flex-col p-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line">
          <div className="flex h-[56px] shrink-0 items-center gap-3 border-b border-line px-3.5">
            <div className="size-[30px] shrink-0 animate-pulse rounded-panel bg-hover" />
            <div className="flex flex-col gap-1.5">
              <Line w="140px" h={12} />
              <Line w="200px" h={9} />
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-px overflow-hidden p-2.5">
            {Array.from({ length: 8 }, (_, i) => (
              <div
                key={i}
                className="grid grid-cols-[180px_repeat(7,minmax(0,1fr))] items-center gap-2 border-b border-line py-2 last:border-b-0"
              >
                <Line w={`${60 + ((i * 9) % 24)}%`} />
                {Array.from({ length: 7 }, (_, j) => (
                  <Line key={j} w="70%" h={9} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ErrorPanel({
  error,
  reset,
  subjectLabel,
}: {
  error: Error
  reset: () => void
  subjectLabel: string
}) {
  const api = isApiError(error) ? error : undefined
  const forbidden = api?.forbidden || api?.unauthorized
  const retryable = api?.retryable ?? true

  return (
    <div className="grid h-dvh place-items-center bg-page px-6">
      <div className="max-w-[420px] text-center">
        <h1 className="text-[15px] font-semibold text-ink">
          {forbidden
            ? `You do not have access to ${subjectLabel}`
            : `${subjectLabel} could not be loaded`}
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
          {forbidden
            ? "Your account is signed in, but it is missing the permission this app needs. Ask an administrator to grant it."
            : (api?.message ?? error.message)}
        </p>
        {api?.requestId && (
          <p className="mt-2 font-mono text-[11px] text-ink-4">
            request {api.requestId}
          </p>
        )}
        {retryable && !forbidden && (
          <button
            type="button"
            onClick={reset}
            className="mt-4 rounded-control bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-page transition-opacity hover:opacity-90"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  )
}

export function HrHoError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  return (
    <ErrorPanel error={error} reset={reset} subjectLabel="head-office people" />
  )
}

export function HrStoreError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  return (
    <ErrorPanel error={error} reset={reset} subjectLabel="the store roster" />
  )
}
