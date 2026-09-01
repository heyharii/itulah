/**
 * Owns the browser-to-backend HTTP boundary for the internal retail services.
 *
 * Calls use the same-origin prefixes used by the retail web proxy by default:
 * `/api` for cloud-hub, `/store-api` for store-router, and `/edge` for dc-edge.
 * An absolute VITE_*_API_URL can be supplied when this app is served without a
 * proxy. VITE_*_HUB/ROUTER/EDGE_URL values belong to Vite's dev proxy and are
 * intentionally not used as browser URLs. Authentication is cookie-first and
 * bearer-token compatible.
 */

import {
  getApiAccessToken,
  getApiAccessTokenRecord,
} from "./token-store"

import type { StandardSchemaV1 } from "@standard-schema/spec"

import { routeLabel, validateContract } from "./contract"

export type ApiBackend = "cloud" | "store" | "edge"

/** Stable resource audiences shared by the browser clients and Go services. */
export type ApiAudience = "cloud-hub" | "store-router" | "dc-edge"

export const API_AUDIENCES: Record<ApiBackend, ApiAudience> = {
  cloud: "cloud-hub",
  store: "store-router",
  edge: "dc-edge",
}

export type QueryValue = string | number | boolean | null | undefined

export type ApiErrorKind = "http" | "network" | "timeout" | "aborted" | "client"

export interface ApiErrorOptions {
  kind?: ApiErrorKind
  status?: number
  body?: unknown
  requestId?: string
  cause?: unknown
  retryable?: boolean
}

/** A normalized failure from a backend request or the browser transport. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | undefined
  readonly body: unknown
  readonly requestId: string | undefined
  readonly retryable: boolean

  constructor(message: string, options: ApiErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = "ApiError"
    this.kind = options.kind ?? "http"
    this.status = options.status
    this.body = options.body
    this.requestId = options.requestId
    this.retryable = options.retryable ?? isRetryableStatus(options.status)
  }

  get unauthorized(): boolean {
    return this.status === 401
  }

  get forbidden(): boolean {
    return this.status === 403
  }
}

export type ApiRequestOptions = Omit<
  RequestInit,
  "body" | "headers" | "signal"
> & {
  /** A JSON value or a native BodyInit such as FormData. */
  body?: unknown
  headers?: HeadersInit
  signal?: AbortSignal
  timeoutMs?: number
  /** Used by public endpoints such as login and health probes. */
  skipAuth?: boolean
  /**
   * Checks the response against a schema instead of casting it.
   *
   * Passing one changes the return type: the method resolves to the schema's
   * output, so a schema that normalises is honoured by the type as well.
   * See `contract.ts` for why a mismatch does not throw in production.
   */
  schema?: StandardSchemaV1
}

export interface ApiClientOptions {
  backend: ApiBackend
  baseUrl: string
  credentials?: RequestCredentials
  defaultHeaders?: HeadersInit
  getAccessToken?: () => string | undefined
  /** Override the service audience for a gateway/deployment alias. */
  audience?: string
  fetchImpl?: typeof globalThis.fetch
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 20_000

const DEFAULT_PREFIXES: Record<ApiBackend, string> = {
  cloud: "/api",
  store: "/store-api",
  edge: "/edge",
}

function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = import.meta.env[name]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

function configuredBaseUrl(backend: ApiBackend): string {
  const envNames =
    backend === "cloud"
      ? ["VITE_CLOUD_API_URL"]
      : backend === "store"
        ? ["VITE_STORE_API_URL"]
        : ["VITE_EDGE_API_URL"]

  return normalizeBaseUrl(
    envValue(...envNames) ?? DEFAULT_PREFIXES[backend],
    DEFAULT_PREFIXES[backend]
  )
}

function normalizeBaseUrl(value: string, defaultPrefix: string): string {
  const trimmed = value.trim().replace(/\/+$/, "")
  if (!trimmed) return defaultPrefix

  // An absolute service origin points at the service root. Internal services
  // mount their HTTP contract below /api, so add it when it was omitted.
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      if (url.pathname === "" || url.pathname === "/") {
        url.pathname = "/api"
      }
      return url.toString().replace(/\/+$/, "")
    } catch {
      // Let the eventual fetch surface a useful transport error for malformed
      // configuration instead of failing during module initialization.
      return trimmed
    }
  }

  return trimmed || defaultPrefix
}

function basePath(baseUrl: string): string {
  if (baseUrl.startsWith("/")) return baseUrl
  try {
    return new URL(baseUrl).pathname.replace(/\/+$/, "") || "/"
  } catch {
    return ""
  }
}

function resolveUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path

  const base = baseUrl.replace(/\/+$/, "")
  let suffix = path.startsWith("/") ? path : `/${path}`
  const prefix = basePath(base)

  // Callers conventionally pass `/v1/...`, but accepting `/api/v1/...` keeps
  // this client safe when a route is copied from backend documentation.
  if (
    prefix &&
    prefix !== "/" &&
    (suffix === prefix || suffix.startsWith(`${prefix}/`))
  ) {
    suffix = suffix.slice(prefix.length) || "/"
  } else if (suffix === "/api" || suffix.startsWith("/api/")) {
    // Backend route documentation uses `/api/v1/...`, while callers normally
    // pass `/v1/...`. Keep copied route paths safe for every client prefix,
    // including `/store-api` and `/edge`; otherwise those clients would send
    // `/store-api/api/v1/...` or `/edge/api/v1/...`.
    suffix = suffix.slice("/api".length) || "/"
  }

  return `${base}${suffix}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function textField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function pickMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body.trim()
  if (isRecord(body)) {
    for (const key of ["message", "error", "detail", "title"]) {
      const message = textField(body[key])
      if (message) return message
    }
  }
  return fallback
}

function pickRequestId(body: unknown, response: Response): string | undefined {
  const headerId = response.headers.get("X-Request-ID")
  if (headerId) return headerId
  if (isRecord(body)) {
    return textField(body.request_id) ?? textField(body.requestId)
  }
  return undefined
}

function isRetryableStatus(status: number | undefined): boolean {
  return (
    status === 408 || status === 425 || status === 429 || (status ?? 0) >= 500
  )
}

function isNativeBody(value: unknown): value is BodyInit {
  if (typeof value === "string") return true
  if (typeof Blob !== "undefined" && value instanceof Blob) return true
  if (typeof FormData !== "undefined" && value instanceof FormData) return true
  if (
    typeof URLSearchParams !== "undefined" &&
    value instanceof URLSearchParams
  ) {
    return true
  }
  if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer)
    return true
  if (
    typeof ReadableStream !== "undefined" &&
    value instanceof ReadableStream
  ) {
    return true
  }
  return false
}

interface UntrustedTokenClaims {
  audiences: string[]
  tokenUse?: string
  expiresAt?: number
}

/**
 * Decode only enough of a JWT to avoid sending an obviously wrong token.
 * Signature verification remains exclusively a backend responsibility; these
 * claims are never used to grant access in the browser.
 */
function inspectJwt(token: string): UntrustedTokenClaims | undefined {
  const parts = token.split(".")
  if (parts.length !== 3 || !parts[1]) return undefined

  try {
    const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")
    const payload = JSON.parse(atob(padded)) as unknown
    if (typeof payload !== "object" || payload === null) return undefined

    const record = payload as Record<string, unknown>
    const audienceValue = record.aud
    const audiences =
      typeof audienceValue === "string"
        ? [audienceValue]
        : Array.isArray(audienceValue)
          ? audienceValue.filter((value): value is string => typeof value === "string")
          : []
    const exp = typeof record.exp === "number" ? record.exp : undefined
    return {
      audiences,
      tokenUse: typeof record.token_use === "string" ? record.token_use : undefined,
      expiresAt: exp !== undefined ? exp * 1000 : undefined,
    }
  } catch {
    // Opaque store-router sessions are not JWTs. A JWT-shaped malformed value
    // is handled by the caller as unsafe rather than being sent as a bearer.
    return { audiences: [], tokenUse: "invalid" }
  }
}

function tokenMatchesAudience(
  token: string,
  expectedAudience: string,
  boundAudience?: string,
  backend?: ApiBackend,
): boolean {
  if (boundAudience && boundAudience !== expectedAudience) return false
  const claims = inspectJwt(token)
  if (!claims) return true // opaque store/device session token
  if (claims.tokenUse !== undefined && claims.tokenUse !== "access") return false
  if (claims.expiresAt !== undefined && claims.expiresAt <= Date.now()) return false
  /* Access tokens issued before aud was mandatory are tolerated only by the
   * cloud compatibility boundary. Store and edge JWTs must be audience-bound. */
  if (claims.audiences.length === 0) return backend === "cloud"
  return claims.audiences.includes(expectedAudience)
}

function serializeBody(body: unknown): {
  value: BodyInit | undefined
  isJson: boolean
} {
  if (body === undefined || body === null)
    return { value: undefined, isJson: false }
  if (isNativeBody(body)) return { value: body, isJson: false }

  try {
    return { value: JSON.stringify(body), isJson: true }
  } catch (cause) {
    throw new ApiError("Request body could not be serialized", {
      kind: "client",
      cause,
      retryable: false,
    })
  }
}

/** Reads the double-submit cookie the hub expects echoed back on writes. */
function readCsrfCookie(): string | undefined {
  if (typeof document === "undefined") return undefined
  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=")
    if (name === "retailos_csrf") return decodeURIComponent(rest.join("="))
  }
  return undefined
}

function requestId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID()
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

interface RequestSignal {
  signal: AbortSignal
  didTimeout: () => boolean
  cleanup: () => void
}

function requestSignal(
  input: AbortSignal | undefined,
  timeoutMs: number
): RequestSignal {
  const controller = new AbortController()
  let timedOut = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const abortFromCaller = () => {
    controller.abort(input?.reason)
  }

  if (input) {
    if (input.aborted) {
      abortFromCaller()
    } else {
      input.addEventListener("abort", abortFromCaller, { once: true })
    }
  }

  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      input?.removeEventListener("abort", abortFromCaller)
    },
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/**
 * The Internal router serves the SPA for unknown paths. Treat that HTML as a
 * contract failure even when its status is 200; otherwise a stale API route
 * can look like a successful JSON response to the calling feature.
 */
function isHtmlResponse(response: Response, payload: unknown): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  if (contentType.includes("text/html")) return true
  if (typeof payload !== "string") return false

  return /^<(?:!doctype\s+html|html(?:\s|>))/i.test(payload.trim())
}

export class ApiClient {
  readonly backend: ApiBackend
  readonly baseUrl: string
  readonly audience: string

  private readonly credentials: RequestCredentials
  private readonly defaultHeaders: HeadersInit | undefined
  private readonly getAccessToken: () => string | undefined
  private readonly usesTokenStore: boolean
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly timeoutMs: number

  constructor(options: ApiClientOptions) {
    this.backend = options.backend
    this.baseUrl = options.baseUrl
    /* cloud-hub is the only browser realm that authenticates with the shared
     * HttpOnly cookie. store-router and dc-edge use bearer/device credentials;
     * omit cookies there so a host-wide `retailos_token` cannot cross realms. */
    this.credentials =
      options.credentials ?? (options.backend === "cloud" ? "include" : "omit")
    this.defaultHeaders = options.defaultHeaders
    this.audience = options.audience?.trim() || API_AUDIENCES[options.backend]
    this.usesTokenStore = options.getAccessToken === undefined
    this.getAccessToken =
      options.getAccessToken ?? (() => getApiAccessToken(options.backend))
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  request<S extends StandardSchemaV1>(
    path: string,
    options: ApiRequestOptions & { schema: S }
  ): Promise<StandardSchemaV1.InferOutput<S>>
  request<T>(path: string, options?: ApiRequestOptions): Promise<T>
  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const {
      body,
      headers: requestHeaders,
      signal: callerSignal,
      timeoutMs = this.timeoutMs,
      skipAuth = false,
      schema,
      ...init
    } = options

    const headers = new Headers(this.defaultHeaders)
    headers.set("Accept", "application/json")

    const serialized = serializeBody(body)
    if (serialized.isJson) headers.set("Content-Type", "application/json")
    if (requestHeaders) {
      new Headers(requestHeaders).forEach((value, key) =>
        headers.set(key, value)
      )
    }

    if (!skipAuth && !headers.has("Authorization")) {
      const record = this.usesTokenStore
        ? getApiAccessTokenRecord(this.backend)
        : undefined
      const accessToken = record?.token ?? this.getAccessToken()
      if (
        accessToken &&
        !tokenMatchesAudience(
          accessToken,
          this.audience,
          record?.audience,
          this.backend,
        )
      ) {
        throw new ApiError(
          `The ${this.backend} access token is not valid for this service`,
          { kind: "client", retryable: false },
        )
      }
      if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`)
    }
    if (!headers.has("X-Request-ID")) headers.set("X-Request-ID", requestId())

    /* Internal double-submits its CSRF token: the non-HttpOnly `retailos_csrf`
     * cookie has to come back as a header on every write, or the request is
     * rejected with a 400 that says nothing about why. Without this the app's
     * own logout fails, and so does every compose action in the UI. */
    const method = (init.method ?? "GET").toUpperCase()
    if (method !== "GET" && method !== "HEAD" && !headers.has("X-CSRF-Token")) {
      if (this.backend === "cloud") {
        const token = readCsrfCookie()
        if (token) headers.set("X-CSRF-Token", token)
      }
    }

    const signals = requestSignal(callerSignal, timeoutMs)
    try {
      const response = await this.fetchImpl(resolveUrl(this.baseUrl, path), {
        ...init,
        body: serialized.value,
        credentials: init.credentials ?? this.credentials,
        headers,
        signal: signals.signal,
      })
      const payload = await readBody(response)

      if (isHtmlResponse(response, payload)) {
        throw new ApiError("The backend returned HTML instead of JSON", {
          kind: "http",
          status: response.status,
          body: payload,
          requestId: pickRequestId(payload, response),
          retryable: isRetryableStatus(response.status),
        })
      }

      if (!response.ok) {
        throw new ApiError(
          pickMessage(
            payload,
            response.statusText || `HTTP ${response.status}`
          ),
          {
            kind: "http",
            status: response.status,
            body: payload,
            requestId: pickRequestId(payload, response),
          }
        )
      }

      /* The one place a response stops being `unknown`. Without a schema this
       * is still the old cast, so adoption can be domain by domain. */
      if (schema)
        return validateContract(schema, payload, routeLabel(path)) as T

      return payload as T
    } catch (cause) {
      if (cause instanceof ApiError) throw cause

      if (signals.didTimeout()) {
        throw new ApiError("The request timed out", {
          kind: "timeout",
          cause,
          retryable: true,
        })
      }

      if (signals.signal.aborted) {
        throw new ApiError("The request was cancelled", {
          kind: "aborted",
          cause,
          retryable: false,
        })
      }

      throw new ApiError("Unable to reach the backend", {
        kind: "network",
        cause,
        retryable: true,
      })
    } finally {
      signals.cleanup()
    }
  }

  get<S extends StandardSchemaV1>(
    path: string,
    options: ApiRequestOptions & { schema: S }
  ): Promise<StandardSchemaV1.InferOutput<S>>
  get<T>(path: string, options?: ApiRequestOptions): Promise<T>
  get<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: "GET" })
  }

  post<S extends StandardSchemaV1>(
    path: string,
    body: unknown,
    options: ApiRequestOptions & { schema: S }
  ): Promise<StandardSchemaV1.InferOutput<S>>
  post<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T>
  post<T>(
    path: string,
    body?: unknown,
    options: ApiRequestOptions = {}
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: "POST", body })
  }

  put<S extends StandardSchemaV1>(
    path: string,
    body: unknown,
    options: ApiRequestOptions & { schema: S }
  ): Promise<StandardSchemaV1.InferOutput<S>>
  put<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T>
  put<T>(
    path: string,
    body?: unknown,
    options: ApiRequestOptions = {}
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: "PUT", body })
  }

  patch<S extends StandardSchemaV1>(
    path: string,
    body: unknown,
    options: ApiRequestOptions & { schema: S }
  ): Promise<StandardSchemaV1.InferOutput<S>>
  patch<T>(
    path: string,
    body?: unknown,
    options?: ApiRequestOptions
  ): Promise<T>
  patch<T>(
    path: string,
    body?: unknown,
    options: ApiRequestOptions = {}
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: "PATCH", body })
  }

  del<S extends StandardSchemaV1>(
    path: string,
    options: ApiRequestOptions & { schema: S }
  ): Promise<StandardSchemaV1.InferOutput<S>>
  del<T>(path: string, options?: ApiRequestOptions): Promise<T>
  del<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: "DELETE" })
  }
}

export const api = new ApiClient({
  backend: "cloud",
  baseUrl: configuredBaseUrl("cloud"),
})

export const storeApi = new ApiClient({
  backend: "store",
  baseUrl: configuredBaseUrl("store"),
})

export const edgeApi = new ApiClient({
  backend: "edge",
  baseUrl: configuredBaseUrl("edge"),
})

/** Build a query string while skipping empty values. */
export function qs(
  params: Record<string, QueryValue | readonly QueryValue[]>
): string {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) {
      if (item === null || item === undefined || item === "") continue
      search.append(key, String(item))
    }
  }

  const result = search.toString()
  return result ? `?${result}` : ""
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/** Convert transport failures into copy suitable for an inline error state. */
export function getErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error.trim()) return error.trim()
  if (isRecord(error)) {
    return (
      textField(error.message) ??
      textField(error.error) ??
      textField(error.detail) ??
      fallback
    )
  }
  return fallback
}

export {
  configuredBaseUrl as getConfiguredBaseUrl,
  resolveUrl as resolveApiUrl,
}
