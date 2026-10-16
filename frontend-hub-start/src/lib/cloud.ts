import { createMiddleware, createServerFn } from "@tanstack/react-start"

// ── How this surface reads the cloud node ────────────────────────────────
//
// Reads that must appear in the SSR HTML run as server functions on the Start
// server. The middleware below lifts the incoming request's session cookie
// into their context, and the handler forwards it — server to server — to the
// cloud node. The browser never talks to the cloud for these reads: it gets
// the answer inside the HTML.
//
// The same server function called from the BROWSER (a later navigation, a
// refetch) is a same-origin RPC, and the browser attaches its cookie itself.
// One function, one query key, correct on both sides — the seed and the live
// read are the same key, so Query never holds two copies of one number.
//
// Writes and the SSE streams stay where frontend-hub has them: browser →
// same-origin /api → node. The dev proxy (vite.config.ts) and the production
// reverse proxy keep that path alive for EventSource and mutations.

/// Where the cloud node is, from the Start server's point of view. Point it at
/// a local node in development; in production the Start server sits beside it
/// behind one origin, per the deployment rule in the vite config.
const cloudBase = process.env.ITULAH_CLOUD_URL ?? "http://127.0.0.1:8080"

/// The request's cookie header, whatever it carries. Nothing here decides
/// identity — the cloud node does, on every read; an expired or revoked
/// session comes back 401 and the route reacts.
export const sessionCookie = createMiddleware().server(({ next, request }) => {
  return next({ context: { cookie: request.headers.get("cookie") ?? "" } })
})

export class Unauthorized extends Error {
  constructor() {
    super("no session")
    this.name = "Unauthorized"
  }
}

async function cloudGet<T>(path: string, cookie: string): Promise<T> {
  const response = await fetch(`${cloudBase}${path}`, {
    headers: { cookie },
    // The node's own SPA redirect must never be followed by a data read.
    redirect: "error",
  })
  if (response.status === 401) throw new Unauthorized()
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return (await response.json()) as T
}

/// The signed-in identity, or null. Used by the route gate — server-side on
/// the first paint, RPC on the client afterwards.
export const whoAmI = createServerFn({ method: "GET" })
  .middleware([sessionCookie])
  .handler(async ({ context }) => {
    try {
      return await cloudGet<{ id: string; username: string }>(
        "/api/v1/auth/me",
        context.cookie
      )
    } catch (error) {
      if (error instanceof Unauthorized) return null
      throw error
    }
  })

// ── The morning brief ────────────────────────────────────────────────────
//
// The wire types, transcribed from `frontend-hub/src/lib/queries/assistant.ts`
// — that file is the surface's own statement of what this endpoint sends.

export interface BriefTrade {
  readonly today_minor: number
  readonly yesterday_minor: number
  /// Local dates, `YYYY-MM-DD`, oldest first — a fortnight of them.
  readonly buckets: readonly string[]
  /// The fleet's gross per bucket, in the same order as `buckets`.
  readonly daily_minor: readonly number[]
}

export interface BriefStock {
  readonly sites: number
  readonly on_hand: number
  readonly missing: number
  readonly lost: number
  readonly window_days: number
}

export interface BriefMissing {
  readonly count: number
  readonly quantity: number
  readonly oldest_hours: number | null
}

export interface BriefCommercial {
  readonly published_version: number | null
  readonly shop_count: number
  readonly behind: number
}

export interface Brief {
  readonly greeting: "morning" | "afternoon" | "evening" | "night"
  readonly who: string
  readonly as_of: string
  readonly trade: BriefTrade
  readonly stock: BriefStock
  readonly missing: BriefMissing
  readonly commercial: BriefCommercial
  readonly prompts: readonly string[]
}

/// The same query key frontend-hub uses (`["assistant", "brief"]`), so the
/// day a screen is migrated over whole, its cache survives the move.
export const briefKey = ["assistant", "brief"] as const

export const brief = createServerFn({ method: "GET" })
  .middleware([sessionCookie])
  .handler(({ context }) =>
    cloudGet<Brief>("/api/v1/assistant/brief", context.cookie)
  )
