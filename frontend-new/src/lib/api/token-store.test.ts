import { afterEach, describe, expect, it } from "vitest"

import {
  clearApiAccessToken,
  clearApiAccessTokens,
  getApiAccessToken,
  getApiAccessTokenRecord,
  setApiAccessToken,
} from "./token-store"

afterEach(() => {
  clearApiAccessTokens()
})

describe("token-store", () => {
  it("keeps each backend's token and audience separate", () => {
    setApiAccessToken("cloud", " cloud-token ", { audience: "cloud-hub" })
    setApiAccessToken("store", "store-token", { audience: "store-router" })

    expect(getApiAccessToken("cloud")).toBe("cloud-token")
    expect(getApiAccessToken("store")).toBe("store-token")
    expect(getApiAccessTokenRecord("cloud")).toMatchObject({
      backend: "cloud",
      token: "cloud-token",
      audience: "cloud-hub",
    })
    expect(getApiAccessTokenRecord("edge")).toBeUndefined()
  })

  it("does not return an expired token and removes its record", () => {
    setApiAccessToken("store", "expired", {
      audience: "store-router",
      expiresAt: Date.now() - 1,
    })

    expect(getApiAccessToken("store")).toBeUndefined()
    expect(getApiAccessTokenRecord("store")).toBeUndefined()
  })

  it("clears one backend without disturbing another", () => {
    setApiAccessToken("cloud", "cloud-token")
    setApiAccessToken("edge", "edge-token")

    clearApiAccessToken("cloud")

    expect(getApiAccessToken("cloud")).toBeUndefined()
    expect(getApiAccessToken("edge")).toBe("edge-token")
  })

  it("treats blank values as a clear operation", () => {
    setApiAccessToken("cloud", "token")
    setApiAccessToken("cloud", "   ")

    expect(getApiAccessToken("cloud")).toBeUndefined()
  })
})
