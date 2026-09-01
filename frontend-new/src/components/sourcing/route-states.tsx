/**
 * What the sourcing route renders while its loader is in flight, and what it
 * renders when the loader fails.
 *
 * The skeleton mirrors the real screen's frame — the 240px rail with "All
 * products"/"Staged", the Categories, Suppliers and Tags groups, the 52px
 * header with its search field and action buttons, the sort row, and a card
 * grid (the default layout) — rather than a spinner. See
 * src/components/inventory/route-states.tsx for the pattern this follows.
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

export function SourcingPending() {
  return (
    <div
      className="grid h-dvh grid-cols-[240px_minmax(0,1fr)] max-lg:grid-cols-[minmax(0,1fr)]"
      aria-busy="true"
      aria-label="Loading sourcing"
    >
      <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-page max-lg:hidden">
        <div className="flex h-[52px] shrink-0 items-center gap-2 px-2.5">
          <div className="size-[22px] animate-pulse rounded-chip bg-hover" />
          <Line w="76px" h={13} />
        </div>
        <div className="flex flex-col gap-1.5 px-3 pt-1">
          <div className="flex h-8 items-center">
            <Line w="56%" />
          </div>
          <div className="flex h-8 items-center">
            <Line w="42%" />
          </div>
        </div>
        <div className="mt-5 px-3">
          <Line w="42%" h={9} />
          <div className="mt-2.5 flex flex-col gap-2">
            <Line w="66%" />
            <Line w="52%" />
            <Line w="60%" />
          </div>
        </div>
        <div className="mt-5 px-3">
          <Line w="36%" h={9} />
          <div className="mt-2.5 flex flex-col gap-2.5">
            <Line w="100%" h={26} />
            <Line w="100%" h={26} />
          </div>
        </div>
        <div className="mt-5 px-3">
          <Line w="24%" h={9} />
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Line w="58px" h={20} />
            <Line w="64px" h={20} />
            <Line w="48px" h={20} />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col p-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-surface shadow-card">
          <div className="flex h-[52px] shrink-0 items-center gap-3 px-3.5">
            <Line w="70px" h={13} />
            <Line w="90px" h={10} />
            <div className="ml-auto flex items-center gap-2">
              <Line w="170px" h={30} />
              <Line w="66px" h={30} />
              <Line w="88px" h={30} />
              <Line w="90px" h={30} />
            </div>
          </div>
          <div className="flex h-10 shrink-0 items-center gap-2 border-t border-b border-line-strong px-3.5">
            <Line w="58px" h={9} />
            <Line w="70px" h={22} />
            <Line w="60px" h={22} />
            <Line w="76px" h={22} />
          </div>
          <div className="grid flex-1 grid-cols-4 gap-2 overflow-hidden p-3.5">
            {Array.from({ length: 16 }, (_, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-card bg-surface shadow-btn"
              >
                <div className="aspect-[3/4] animate-pulse bg-hover" />
                <div className="flex flex-col gap-1.5 p-2.5">
                  <Line w={`${56 + ((i * 6) % 34)}%`} h={10} />
                  <Line w="44%" h={9} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function SourcingError({
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
            ? "You do not have access to sourcing"
            : "Sourcing could not be loaded"}
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
