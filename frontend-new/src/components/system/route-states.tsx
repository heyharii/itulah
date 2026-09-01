/**
 * What the system route renders while its loader is in flight, and what it
 * renders when it fails.
 *
 * Mirrors the real screen's frame — the 240px rail, the four-item nav list,
 * the 52px header with its search field — rather than a spinner, for the same
 * reason inventory's does. See `inventory/route-states.tsx`.
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

export function SystemPending() {
  return (
    <div
      className="grid h-dvh grid-cols-[240px_minmax(0,1fr)] max-lg:grid-cols-[minmax(0,1fr)]"
      aria-busy="true"
      aria-label="Loading system"
    >
      <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-page max-lg:hidden">
        <div className="flex h-[52px] shrink-0 items-center gap-2 px-2.5">
          <div className="size-[22px] animate-pulse rounded-chip bg-hover" />
          <Line w="84px" h={13} />
        </div>
        <div className="flex flex-col gap-1.5 px-3 pt-1">
          {["Users", "Roles", "Permissions", "Audit log"].map((label) => (
            <div key={label} className="flex h-8 items-center gap-2">
              <div className="size-3.5 shrink-0 animate-pulse rounded-[3px] bg-hover" />
              <Line w={`${40 + label.length}%`} />
            </div>
          ))}
        </div>
      </aside>

      <main className="flex h-full min-h-0 flex-col overflow-hidden p-2 pl-0 max-lg:pl-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-window bg-surface shadow-card">
          <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-3.5">
            <Line w="60px" h={13} />
            <Line w="170px" h={10} />
            <div className="ml-auto">
              <div className="h-[32px] w-[240px] animate-pulse rounded-control bg-hover" />
            </div>
          </div>
          <div className="flex-1 px-4 pt-4">
            <div className="flex flex-col gap-px overflow-hidden rounded-control border border-line">
              {Array.from({ length: 10 }, (_, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[minmax(0,1fr)_120px_90px] items-center gap-2 border-b border-line px-3 py-2.5 last:border-b-0"
                >
                  <Line w={`${50 + ((i * 8) % 36)}%`} />
                  <Line w="62%" />
                  <Line w="70%" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export function SystemError({
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
            ? "You do not have access to system"
            : "System could not be loaded"}
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
