import { describe, expect, it } from "vitest"

import { proxyTable } from "../vite.config"

describe("Vite same-origin proxy", () => {
  it("keeps routes usable without inventing credentials", () => {
    const proxy = proxyTable({})

    expect(proxy["/api"].headers).toEqual({})
    expect(proxy["/edge"].headers).toEqual({})
    expect(proxy["/store-api"].headers).toEqual({})
    expect(proxy["/edge"].rewrite("/edge/v1/health")).toBe("/api/v1/health")
    expect(proxy["/store-api"].rewrite("/store-api/v1/items")).toBe(
      "/api/v1/items"
    )
  })

  it("injects only explicitly configured development credentials", () => {
    const proxy = proxyTable({
      CLOUD_HUB_API_KEY: " cloud-key ",
      CLOUD_HUB_USER_ID: " user-1 ",
      CLOUD_HUB_USER_ROLE: " operator ",
      CLOUD_HUB_ACTOR_ID: " actor-1 ",
      EDGE_API_KEY: " edge-key ",
      STORE_API_KEY: " store-key ",
    })

    expect(proxy["/api"].headers).toEqual({
      "X-API-Key": "cloud-key",
      "X-User-ID": "user-1",
      "X-User-Role": "operator",
      "X-Actor-ID": "actor-1",
    })
    expect(proxy["/edge"].headers).toEqual({ "X-API-Key": "edge-key" })
    expect(proxy["/store-api"].headers).toEqual({ "X-API-Key": "store-key" })
  })

  it("does not turn a partial identity into an authorization claim", () => {
    const proxy = proxyTable({
      CLOUD_HUB_API_KEY: "cloud-key",
      CLOUD_HUB_USER_ROLE: "superadmin",
    })

    expect(proxy["/api"].headers).toEqual({ "X-API-Key": "cloud-key" })
  })
})
