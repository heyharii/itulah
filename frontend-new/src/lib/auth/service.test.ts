import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ApiError,
  clearApiAccessTokens,
  getApiAccessToken,
  type ApiClient,
} from "../api"
import { AuthService } from "./service"

interface FakeClient {
  backend: "cloud" | "store"
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
}

function fakeClient(backend: FakeClient["backend"]): FakeClient {
  return { backend, get: vi.fn(), post: vi.fn() }
}

function asApiClient(client: FakeClient): ApiClient {
  return client as unknown as ApiClient
}

const user = {
  id: "employee-1",
  username: "operator",
  display_name: "Operator",
  permissions: ["inventory.read"],
}

function tokenResponse(token: string, extra: Record<string, unknown> = {}) {
  return {
    access_token: token,
    expires_in: 900,
    user,
    ...extra,
  }
}

afterEach(() => {
  clearApiAccessTokens()
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

describe("AuthService response contracts", () => {
  it("rejects a malformed access token field before storing anything", async () => {
    const client = fakeClient("cloud")
    client.post.mockResolvedValue({ access_token: 42, user })
    const service = new AuthService({ client: asApiClient(client), persistToken: false })

    await expect(service.login({ username: "operator", password: "pw" })).rejects.toMatchObject({
      kind: "client",
    })
    expect(getApiAccessToken("cloud")).toBeUndefined()
  })

  it("rejects a malformed user envelope before storing the token", async () => {
    const client = fakeClient("cloud")
    client.post.mockResolvedValue(tokenResponse("access-1", { user: [] }))
    const service = new AuthService({ client: asApiClient(client), persistToken: false })

    await expect(service.login({ username: "operator", password: "pw" })).rejects.toMatchObject({
      kind: "client",
    })
    expect(getApiAccessToken("cloud")).toBeUndefined()
  })

  it("rejects a response addressed to another realm", async () => {
    const client = fakeClient("cloud")
    client.post.mockResolvedValue(tokenResponse("store-token", { audience: "store-router" }))
    const service = new AuthService({ client: asApiClient(client), persistToken: false })

    await expect(service.login({ username: "operator", password: "pw" })).rejects.toThrow(
      /another service/,
    )
    expect(getApiAccessToken("cloud")).toBeUndefined()
  })

  it("rejects a non-workforce principal", async () => {
    const client = fakeClient("cloud")
    client.post.mockResolvedValue(tokenResponse("customer-token", { principal_type: "customer" }))
    const service = new AuthService({ client: asApiClient(client), persistToken: false })

    await expect(service.login({ username: "operator", password: "pw" })).rejects.toThrow(
      /workforce app/,
    )
    expect(getApiAccessToken("cloud")).toBeUndefined()
  })
})

describe("AuthService refresh lifecycle", () => {
  it("shares one refresh request across concurrent callers", async () => {
    const client = fakeClient("store")
    let resolveRefresh!: (value: unknown) => void
    const pending = new Promise<unknown>((resolve) => {
      resolveRefresh = resolve
    })
    client.post.mockReturnValue(pending)
    const service = new AuthService({
      client: asApiClient(client),
      persistToken: false,
      realm: "store",
    })

    const first = service.refresh()
    const second = service.refresh()
    expect(client.post).toHaveBeenCalledTimes(1)

    resolveRefresh(tokenResponse("store-access"))
    const [firstSession, secondSession] = await Promise.all([first, second])
    expect(firstSession).toBe(secondSession)
    expect(getApiAccessToken("store")).toBe("store-access")
  })

  it("does not let a refresh response resurrect a session after logout", async () => {
    const client = fakeClient("store")
    let resolveRefresh!: (value: unknown) => void
    const pending = new Promise<unknown>((resolve) => {
      resolveRefresh = resolve
    })
    client.post.mockImplementation((path: string) =>
      path === "/v1/ops/auth/refresh" ? pending : Promise.resolve(undefined),
    )
    const service = new AuthService({
      client: asApiClient(client),
      persistToken: false,
      realm: "store",
    })

    const refresh = service.refresh()
    await Promise.resolve()
    await service.logout()

    resolveRefresh(tokenResponse("stale-store-access"))
    await expect(refresh).resolves.toBeNull()
    expect(getApiAccessToken("store")).toBeUndefined()
  })

  it("keeps the current token when refresh is rate-limited", async () => {
    const client = fakeClient("store")
    client.post.mockRejectedValue(
      new ApiError("slow down", { kind: "http", status: 429, retryable: true }),
    )
    const service = new AuthService({
      client: asApiClient(client),
      persistToken: false,
      realm: "store",
    })

    // The token is intentionally not expired; a retryable 429 is not proof of
    // an anonymous session and must not clear it.
    const { setApiAccessToken } = await import("../api")
    setApiAccessToken("store", "still-valid", { audience: "store-router" })

    await expect(service.refresh()).rejects.toMatchObject({ status: 429 })
    expect(getApiAccessToken("store")).toBe("still-valid")
  })
})
