import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"

import { invalidateOwner, requestCookieHeader, sessionContext } from "../../../../src/server/data"

const popularPaths = ["/procurement/orders", "/operations/intake"] as const

export async function POST(request: Request) {
  const action = request.headers.get("x-prototype-action")
  if (action !== "invalidate" && action !== "warm-popular") {
    return NextResponse.json({ error: "invalid action" }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }
  const cookieHeader = await requestCookieHeader()
  const context = await sessionContext(cookieHeader)
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } })

  if (action === "warm-popular") {
    const basePath = process.env.NEXT_BASE_PATH ?? ""
    const port = process.env.PORT ?? "3100"
    const origin = `http://127.0.0.1:${port}`
    const warmed = await Promise.all(popularPaths.map(async (pathname) => {
      const response = await fetch(
        `${origin}${basePath}${pathname}?__cacheArm=component`,
        { headers: { cookie: cookieHeader }, cache: "no-store" }
      )
      const html = await response.text()
      if (!response.ok || !html.includes("data-prototype-component-cache-generated")) {
        throw new Error(`prototype route warm failed: ${pathname} HTTP ${response.status}`)
      }
      const generated = html.match(/data-prototype-component-cache-generated="([^"]+)"/)?.[1]
      return { pathname, generated: generated ?? null }
    }))
    return NextResponse.json({ warmed }, { headers: { "Cache-Control": "no-store" } })
  }

  await invalidateOwner(context.ownerHash)
  revalidateTag(`prototype-hub-render-${context.ownerHash}`, { expire: 0 })
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } })
}
