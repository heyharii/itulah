/**
 * What the Buying route renders while its loader is in flight, and what it
 * renders when the loader fails.
 *
 * The skeleton mirrors the real screen's frame — the 232px nav rail, the
 * header strip, the toolbar and the row grid — rather than a spinner. See
 * src/components/inventory/route-states.tsx for the reasoning.
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

export function BuyingPending() {
  return (
    <div
      className="grid h-dvh grid-cols-[232px_minmax(0,1fr)] max-lg:grid-cols-[minmax(0,1fr)]"
      aria-busy="true"
      aria-label="Loading buying"
    >
      <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-page max-lg:hidden">
        <div className="flex h-[52px] shrink-0 items-center gap-2 px-2.5">
          <div className="size-[22px] animate-pulse rounded-chip bg-hover" />
          <Line w="70px" h={13} />
        </div>
        <div className="flex flex-col gap-1.5 px-3 pt-1">
          {["60%", "46%", "40%", "52%", "36%"].map((w) => (
            <div key={w} className="flex h-8 items-center">
              <Line w={w} />
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-4">
          <Line w="90px" h={13} />
          <div className="ml-auto flex gap-2">
            <Line w="120px" h={26} />
            <Line w="80px" h={26} />
          </div>
        </div>
        <div className="flex-1 px-4 pt-4">
          <div className="flex flex-col gap-px overflow-hidden rounded-control border border-line">
            {Array.from({ length: 10 }, (_, i) => (
              <div
                key={i}
                className="grid grid-cols-[minmax(0,1fr)_100px_90px_120px] items-center gap-2 border-b border-line px-3 py-2.5 last:border-b-0"
              >
                <Line w={`${50 + ((i * 9) % 36)}%`} />
                <Line w="60%" />
                <Line w="66%" />
                <Line w="54%" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function BuyingError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  const api = isApiError(error) ? error : undefined
  const forbidden = api?.forbidden || api?.unauthorized
  const retryable = api?.retryable ?? true

  return (
    <div className="grid h-dvh place-items-center bg-page px-6">
      <div className="max-w-[420px] text-center">
        <h1 className="text-[15px] font-semibold text-ink">
          {forbidden
            ? "You do not have access to Buying"
            : "Buying could not be loaded"}
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
