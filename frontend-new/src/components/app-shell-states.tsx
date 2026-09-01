/**
 * What the whole app renders when a URL matches nothing, and when a render
 * throws above every route boundary.
 *
 * Both were missing. A mistyped URL produced whatever the router does by
 * default — which nobody had looked at — and an error thrown outside a route's
 * own `errorComponent` blanked the entire suite, rail and all.
 *
 * The rail stays visible in both. The user reached one of eighteen apps by a
 * bad link; the other seventeen still work, and taking them away as well is a
 * strictly worse answer than the problem it is reporting.
 */

import { Link, useRouter } from "@tanstack/react-router"

import { isApiError } from "@/lib/api"

function Frame({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="grid h-dvh place-items-center bg-page px-6">
      <div className="max-w-[440px] text-center">
        <h1 className="text-[15px] font-semibold text-ink">{title}</h1>
        {children}
      </div>
    </div>
  )
}

export function AppNotFound() {
  return (
    <Frame title="That page does not exist">
      <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
        The link may be out of date — three apps were merged recently, and
        <code className="px-1 font-mono text-[12px]">/suppliers</code>,
        <code className="px-1 font-mono text-[12px]">/po</code> and
        <code className="px-1 font-mono text-[12px]">/shortlist</code> now live
        inside Buying and Sourcing.
      </p>
      <Link
        to="/"
        className="mt-4 inline-block rounded-control bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-page transition-opacity hover:opacity-90"
      >
        Go to the start
      </Link>
    </Frame>
  )
}

export function AppError({ error }: { error: Error }) {
  const router = useRouter()
  const api = isApiError(error) ? error : undefined

  return (
    <Frame title="Something broke outside the screen you were on">
      <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
        {api?.message ?? error.message}
      </p>
      {api?.requestId && (
        <p className="mt-2 font-mono text-[11px] text-ink-4">
          request {api.requestId}
        </p>
      )}
      <button
        type="button"
        /* `invalidate` re-runs the loaders rather than reloading the document,
         * so the cache, the session and any open sheet survive. A full reload
         * is the heavier answer and rarely the needed one. */
        onClick={() => void router.invalidate()}
        className="mt-4 rounded-control bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-page transition-opacity hover:opacity-90"
      >
        Try again
      </button>
    </Frame>
  )
}
