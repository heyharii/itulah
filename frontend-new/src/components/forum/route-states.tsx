/**
 * What the Forum route renders while its loader is in flight, and what it
 * renders when the loader fails. See
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

export function ForumPending() {
  return (
    <div
      className="grid h-dvh grid-cols-[236px_minmax(0,1fr)] max-lg:grid-cols-[minmax(0,1fr)]"
      aria-busy="true"
      aria-label="Loading forum"
    >
      <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-page max-lg:hidden">
        <div className="flex h-[52px] shrink-0 items-center gap-2 px-2.5">
          <div className="size-[22px] animate-pulse rounded-chip bg-hover" />
          <Line w="60px" h={13} />
        </div>
        <div className="flex flex-col gap-1.5 px-3 pt-1">
          {["50%", "40%", "60%"].map((w) => (
            <div key={w} className="flex h-8 items-center">
              <Line w={w} />
            </div>
          ))}
        </div>
        <div className="mt-5 px-3">
          <Line w="44%" h={9} />
          <div className="mt-2.5 flex flex-col gap-2">
            <Line w="72%" />
            <Line w="54%" />
            <Line w="64%" />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-4">
          <Line w="66px" h={13} />
          <Line w="150px" h={10} />
        </div>
        <div className="flex-1 flex-col gap-px px-4 pt-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-line px-1 py-3 last:border-b-0"
            >
              <div className="size-[30px] shrink-0 animate-pulse rounded-full bg-hover" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Line w={`${44 + ((i * 11) % 40)}%`} h={13} />
                <Line w="66%" h={10} />
              </div>
              <Line w="54px" h={10} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ForumError({
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
            ? "You do not have access to the forum"
            : "The forum could not be loaded"}
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
