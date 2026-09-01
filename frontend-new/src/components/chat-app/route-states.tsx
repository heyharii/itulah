/**
 * What the Chat route renders while its loader is in flight, and what it
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

export function ChatPending() {
  return (
    <div
      className="grid h-dvh grid-cols-[236px_minmax(0,1fr)] max-lg:grid-cols-[minmax(0,1fr)]"
      aria-busy="true"
      aria-label="Loading chat"
    >
      <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-page max-lg:hidden">
        <div className="flex h-[52px] shrink-0 items-center gap-2 px-2.5">
          <div className="size-[22px] animate-pulse rounded-chip bg-hover" />
          <Line w="52px" h={13} />
        </div>
        <div className="flex flex-col gap-1.5 px-3 pt-1">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex h-8 items-center gap-2">
              <div className="size-[20px] shrink-0 animate-pulse rounded-full bg-hover" />
              <Line w={`${40 + ((i * 9) % 34)}%`} />
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden py-2 pr-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-surface shadow-card">
          <div className="flex h-[56px] shrink-0 items-center gap-3 border-b border-line px-4">
            <div className="size-[30px] shrink-0 animate-pulse rounded-panel bg-hover" />
            <Line w="140px" h={13} />
          </div>
          <div className="flex flex-1 flex-col gap-4 px-5 py-4">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="size-[34px] shrink-0 animate-pulse rounded-full bg-hover" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
                  <Line w="110px" h={11} />
                  <Line w={`${44 + ((i * 13) % 40)}%`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function ChatError({
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
            ? "You do not have access to Chat"
            : "Chat could not be loaded"}
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
