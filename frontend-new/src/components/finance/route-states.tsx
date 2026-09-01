/**
 * What the finance route renders while its loader is in flight, and what it
 * renders when the loader fails.
 *
 * The skeleton mirrors finance's own frame — the 240px rail with its "owed to
 * suppliers" tile, the tab nav, the supplier list, the header strip — rather
 * than a spinner. See inventory's `route-states.tsx`, the reference for this
 * pattern.
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

export function FinancePending() {
  return (
    <div
      className="grid h-dvh grid-cols-[240px_minmax(0,1fr)] max-lg:grid-cols-[minmax(0,1fr)]"
      aria-busy="true"
      aria-label="Loading finance"
    >
      <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-page max-lg:hidden">
        <div className="flex h-[52px] shrink-0 items-center gap-2 px-2.5">
          <div className="size-[22px] animate-pulse rounded-chip bg-hover" />
          <Line w="70px" h={13} />
        </div>
        <div className="px-2 pt-0.5">
          <div className="rounded-panel bg-surface px-3 py-2.5 shadow-btn">
            <Line w="60%" h={9} />
            <div className="mt-2">
              <Line w="46%" h={17} />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 px-3 pt-3">
          {["50%", "62%", "40%", "44%", "36%", "34%"].map((w) => (
            <div key={w} className="flex h-8 items-center">
              <Line w={w} />
            </div>
          ))}
        </div>
        <div className="mt-4 px-3">
          <Line w="40%" h={9} />
          <div className="mt-2.5 flex flex-col gap-2">
            <Line w="66%" />
            <Line w="56%" />
            <Line w="60%" />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-4">
          <Line w="72px" h={13} />
          <Line w="220px" h={10} />
        </div>
        <div className="flex-1 px-4 pt-4">
          <div className="flex flex-col gap-px overflow-hidden rounded-control border border-line">
            {Array.from({ length: 10 }, (_, i) => (
              <div
                key={i}
                className="grid grid-cols-[minmax(0,1fr)_100px_100px_90px] items-center gap-2 border-b border-line px-3 py-2.5 last:border-b-0"
              >
                <Line w={`${52 + ((i * 7) % 34)}%`} />
                <Line w="62%" />
                <Line w="70%" />
                <Line w="54%" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function FinanceError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  /* `ApiError` already separates a transport fault from a refusal, so the
   * boundary can offer the action that matches instead of one Retry button
   * that is wrong half the time. */
  const api = isApiError(error) ? error : undefined
  const forbidden = api?.forbidden || api?.unauthorized
  const retryable = api?.retryable ?? true

  return (
    <div className="grid h-dvh place-items-center bg-page px-6">
      <div className="max-w-[420px] text-center">
        <h1 className="text-[15px] font-semibold text-ink">
          {forbidden
            ? "You do not have access to finance"
            : "Finance could not be loaded"}
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
