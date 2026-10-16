import { NextRequest, NextResponse } from "next/server"

import { currentSnapshotVersions, requestCookieHeader, sessionContext } from "../../../../src/server/data"

export async function GET(request: NextRequest) {
  const cookieHeader = await requestCookieHeader()
  const context = await sessionContext(cookieHeader)
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } })
  const path = request.nextUrl.searchParams.get("path")
  if (path !== "/procurement/orders" && path !== "/operations/intake") {
    return NextResponse.json({ versions: {}, cacheStates: {} }, { headers: { "Cache-Control": "no-store" } })
  }
  try {
    const result = await currentSnapshotVersions(path, cookieHeader, context)
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } })
  } catch {
    return NextResponse.json({ error: "upstream unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
