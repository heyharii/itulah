import { NextResponse } from "next/server"

import { cacheStats, requestCookieHeader, sessionContext } from "../../../../src/server/data"
import { processMetrics, recordBrowserMetrics, recentBrowserMetrics } from "../../../../src/server/telemetry.mjs"

async function authorized() {
  const cookieHeader = await requestCookieHeader()
  return sessionContext(cookieHeader)
}

export async function GET(request: Request) {
  if (!(await authorized())) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } })
  const url = new URL(request.url)
  const limit = Number(url.searchParams.get("limit") ?? 1000)
  return NextResponse.json({
    process: processMetrics(),
    cache: await cacheStats(),
    browser: recentBrowserMetrics(Number.isFinite(limit) ? limit : 1000),
  }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(request: Request) {
  if (!(await authorized())) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } })
  const length = Number(request.headers.get("content-length") ?? 0)
  if (length > 64 * 1024) return new NextResponse("too large", { status: 413, headers: { "Cache-Control": "no-store" } })
  try {
    const payload = await request.json() as { metrics?: unknown; scenario?: string; runId?: string; route?: string }
    if (JSON.stringify(payload).length > 64 * 1024) throw new Error("payload too large")
    const accepted = await recordBrowserMetrics(payload as never)
    return NextResponse.json({ accepted }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "invalid metrics payload" }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }
}
