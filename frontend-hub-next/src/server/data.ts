import "server-only"

import { createHash } from "node:crypto"
import { cookies } from "next/headers"
import { snapshotCache } from "./snapshot-cache.mjs"

export type Identity = {
  username: string
  display_name: string
  role: string
  role_code: string
  role_name: string
  sections: string[]
  read_only: boolean
}

export type NodeIdentity = {
  node_id: string
  node_role: "CLOUD" | "DC" | "STORE"
  auth: "enabled" | "DISABLED"
  mode?: "single" | "sandbox"
  dc_hosting?: "cloud" | "edge"
}

const apiOrigin = () =>
  (process.env.RUST_API_ORIGIN ?? "http://127.0.0.1:5480").replace(/\/$/, "")
const edgeOrigin = () =>
  (process.env.EDGE_API_ORIGIN ?? apiOrigin()).replace(/\/$/, "")

export async function requestCookieHeader(): Promise<string> {
  return (await cookies()).toString()
}

export function ownerHash(cookieHeader: string, identity: Identity): string {
  return createHash("sha256")
    .update(`${cookieHeader}\n${JSON.stringify(identity)}`)
    .digest("hex")
}

async function rustJson<T>(
  origin: string,
  path: string,
  cookieHeader: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers)
  if (cookieHeader) headers.set("cookie", cookieHeader)
  if (init.body !== undefined && !headers.has("content-type"))
    headers.set("content-type", "application/json")
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    redirect: "manual",
  })
  if (!response.ok) {
    const error = new Error(`Rust API ${response.status} ${path}`)
    Object.assign(error, { status: response.status })
    throw error
  }
  return (await response.json()) as T
}

export async function sessionContext(cookieHeader: string) {
  try {
    const identity = await rustJson<Identity>(
      apiOrigin(),
      "/api/v1/auth/me",
      cookieHeader
    )
    const node = await rustJson<NodeIdentity>(
      apiOrigin(),
      "/api/v1/health",
      ""
    )
    return { identity, node, ownerHash: ownerHash(cookieHeader, identity) }
  } catch {
    return null
  }
}

type EdgeSession = { origin: string; authorization?: string }

async function edgeSession(cookieHeader: string, node: NodeIdentity): Promise<EdgeSession> {
  if (node.dc_hosting === "cloud") return { origin: apiOrigin() }
  const edgeHealth = await rustJson<NodeIdentity>(edgeOrigin(), "/api/v1/health", "")
  const ticket = await rustJson<{ ticket: string }>(
    apiOrigin(),
    "/api/v1/auth/edge-sso-ticket",
    cookieHeader,
    { method: "POST", body: JSON.stringify({ origin_id: edgeHealth.node_id }) }
  )
  const exchanged = await rustJson<{ token: string }>(
    edgeOrigin(),
    "/api/v1/auth/sso/exchange",
    "",
    { method: "POST", body: JSON.stringify({ ticket: ticket.ticket }) }
  )
  return { origin: edgeOrigin(), authorization: `Bearer ${exchanged.token}` }
}

async function cached<T>(
  namespace: string,
  owner: string,
  query: string,
  origin: string,
  path: string,
  cookieHeader: string,
  authorization?: string
) {
  return snapshotCache.getOrLoad(namespace, owner, query, async () => {
    const headers = new Headers()
    if (authorization) headers.set("authorization", authorization)
    return rustJson<T>(origin, path, authorization ? "" : cookieHeader, {
      headers,
    })
  })
}

function purchaseOrderPath(searchParams: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams()
  params.set("status", "ACTIVE,PARTIALLY_RECEIVED")
  params.set("sort", "updated")
  return `/api/v1/purchase-orders?${params.toString()}`
}

export async function loadInitialData(
  pathname: string,
  searchParams: Record<string, string | string[] | undefined>,
  cookieHeader: string,
  context: NonNullable<Awaited<ReturnType<typeof sessionContext>>>
) {
  const { identity, node, ownerHash: owner } = context
  const queries: Array<{ queryKey: readonly unknown[]; data: unknown; createdAt: number }> = [
    { queryKey: ["auth", "me"], data: identity, createdAt: Date.now() },
    { queryKey: ["node", "identity"], data: node, createdAt: Date.now() },
    { queryKey: ["node", "dc-hosting"], data: node.dc_hosting ?? "edge", createdAt: Date.now() },
  ]
  let versions: Record<string, string> = {}
  let cacheStates: Record<string, string> = {}

  if (pathname === "/procurement/orders") {
    const scope = { statuses: ["ACTIVE", "PARTIALLY_RECEIVED"], sort: "updated" }
    const queryKey = ["procurement", "purchase-orders", "page", scope, "paged"] as const
    const path = purchaseOrderPath(searchParams)
    const list = await cached<unknown>("po-list", owner, path, apiOrigin(), path, cookieHeader)
    queries.push({
      queryKey,
      data: { pages: [list.data], pageParams: [undefined] },
      createdAt: list.createdAt,
    })
    versions.po = list.version
    cacheStates.po = list.state

    const orderId = first(searchParams.order)
    if (orderId && /^[a-zA-Z0-9-]{8,80}$/.test(orderId)) {
      const detailPath = `/api/v1/purchase-orders/${encodeURIComponent(orderId)}`
      const detail = await cached<unknown>(
        "po-detail",
        owner,
        detailPath,
        apiOrigin(),
        detailPath,
        cookieHeader
      )
      queries.push({
        queryKey: ["procurement", "purchase-orders", orderId],
        data: detail.data,
        createdAt: detail.createdAt,
      })
      versions.poDetail = detail.version
      cacheStates.poDetail = detail.state
    }
  }

  if (pathname === "/operations/intake") {
    const dc = await edgeSession(cookieHeader, node)
    const entries = [
      ["purchaseWork", ["dc", "purchase-work"], "/api/v1/dc/purchase-orders", "items"],
      ["verifyQueue", ["dc", "purchase-counts"], "/api/v1/dc/purchase-counts", "items"],
      ["purchaseSummary", ["dc", "purchase-work", "summary"], "/api/v1/dc/purchase-orders/summary", null],
      ["storeInbound", ["dc", "store-inbound", "IN_TRANSIT"], "/api/v1/dc/inbound?status=IN_TRANSIT", "deliveries"],
    ] as const
    for (const [namespace, queryKey, path, envelopeKey] of entries) {
      const result = await cached<Record<string, unknown>>(
        `receiving-${namespace}`,
        owner,
        path,
        dc.origin,
        path,
        cookieHeader,
        dc.authorization
      )
      const data = envelopeKey ? result.data[envelopeKey] : result.data
      queries.push({ queryKey, data, createdAt: result.createdAt })
      versions[namespace] = result.version
      cacheStates[namespace] = result.state
    }

    const poNumber = first(searchParams.delivery)
    if (poNumber) {
      const bookPath = `/api/v1/purchase-orders?q=${encodeURIComponent(poNumber)}`
      const page = await cached<Record<string, unknown>>(
        "po-lookup",
        owner,
        bookPath,
        apiOrigin(),
        bookPath,
        cookieHeader
      )
      const rows = (page.data.rows ?? []) as Array<{ po_number?: string; purchase_order_id?: string }>
      const row = rows.find((candidate) => candidate.po_number === poNumber)
      queries.push({
        queryKey: ["procurement", "purchase-orders", "page", { q: poNumber }],
        data: page.data,
        createdAt: page.createdAt,
      })
      if (row?.purchase_order_id) {
        const detailPath = `/api/v1/purchase-orders/${encodeURIComponent(row.purchase_order_id)}`
        const detail = await cached<unknown>(
          "po-detail",
          owner,
          detailPath,
          apiOrigin(),
          detailPath,
          cookieHeader
        )
        queries.push({
          queryKey: ["procurement", "purchase-orders", row.purchase_order_id],
          data: detail.data,
          createdAt: detail.createdAt,
        })
        versions.receivingDetail = detail.version
        cacheStates.receivingDetail = detail.state
      }
      versions.receivingLookup = page.version
      cacheStates.receivingLookup = page.state
    }
  }

  return { queries, versions, cacheStates }
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export async function currentSnapshotVersions(
  pathname: string,
  cookieHeader: string,
  context: NonNullable<Awaited<ReturnType<typeof sessionContext>>>
) {
  const payload = await loadInitialData(pathname, {}, cookieHeader, context)
  return { versions: payload.versions, cacheStates: payload.cacheStates }
}

export async function invalidateOwner(owner: string) {
  await snapshotCache.invalidateOwner(owner, [
    "po-list",
    "po-detail",
    "po-lookup",
    "receiving-purchaseWork",
    "receiving-verifyQueue",
    "receiving-purchaseSummary",
    "receiving-storeInbound",
  ])
}

export async function cacheStats() {
  return snapshotCache.stats()
}
