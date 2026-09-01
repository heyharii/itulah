/**
 * What the articles route renders while its loader is in flight, and what it
 * renders when the loader fails.
 *
 * The skeleton mirrors the real screen's frame — the 240px rail with "All
 * articles", the Divisions and Tags groups, the 52px header with its search
 * field and grid/table toggle, and a card grid (the default layout) — rather
 * than a spinner. See src/components/inventory/route-states.tsx for the
 * pattern this follows.
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

export function ArticlesPending() {
  return (
    <div
      className="grid h-dvh grid-cols-[240px_minmax(0,1fr)] max-lg:grid-cols-[minmax(0,1fr)]"
      aria-busy="true"
      aria-label="Loading articles"
    >
      <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-page max-lg:hidden">
        <div className="flex h-[52px] shrink-0 items-center gap-2 px-2.5">
          <div className="size-[22px] animate-pulse rounded-chip bg-hover" />
          <Line w="72px" h={13} />
        </div>
        <div className="flex flex-col gap-1.5 px-3 pt-1">
          <div className="flex h-8 items-center">
            <Line w="52%" />
          </div>
        </div>
        <div className="mt-5 px-3">
          <Line w="40%" h={9} />
          <div className="mt-2.5 flex flex-col gap-2">
            <Line w="70%" />
            <Line w="58%" />
            <Line w="64%" />
            <Line w="46%" />
          </div>
        </div>
        <div className="mt-5 px-3">
          <Line w="30%" h={9} />
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Line w="54px" h={20} />
            <Line w="70px" h={20} />
            <Line w="46px" h={20} />
            <Line w="62px" h={20} />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3.5">
          <Line w="60px" h={13} />
          <Line w="150px" h={10} />
          <div className="ml-auto flex items-center gap-2">
            <Line w="220px" h={32} />
            <Line w="60px" h={28} />
          </div>
        </div>
        <div className="grid flex-1 grid-cols-3 gap-2 overflow-hidden p-3.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
          {Array.from({ length: 24 }, (_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-card bg-surface shadow-btn"
            >
              <div className="aspect-square animate-pulse bg-hover" />
              <div className="flex flex-col gap-1.5 p-2">
                <Line w={`${58 + ((i * 5) % 32)}%`} h={10} />
                <Line w="46%" h={9} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ArticlesError({
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
            ? "You do not have access to the article master"
            : "Articles could not be loaded"}
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
