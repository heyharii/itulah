/**
 * Owns the auth workflow against the real internal identity endpoints.
 *
 * Cloud sessions are cookie-first (`retailos_token`/`retailos_refresh` are
 * HttpOnly); store-router sessions currently require a bearer token, which is
 * kept only in memory unless the caller explicitly enables sessionStorage.
 */

import {
  api,
  ApiClient,
  ApiError,
  API_AUDIENCES,
  isApiError,
  parseContract,
  setApiAccessToken,
  storeApi,
} from "../api"
import type {
  AuthPathOverrides,
  AuthRealm,
  AuthSession,
  AuthUser,
  LoginCredentials,
  LoginResult,
  TwoFactorChallenge,
} from "./types"
import { AuthResponseEnvelope } from "./wire"

interface AuthServiceOptions {
  realm?: AuthRealm
  client?: ApiClient
  /** Store token in the current tab only; never use localStorage for tokens. */
  persistToken?: boolean
  storageKey?: string
  /** Resource audience expected from identity responses. */
  audience?: string
  paths?: AuthPathOverrides
}

interface AuthServiceConfig {
  realm: AuthRealm
  backend: "cloud" | "store"
  client: ApiClient
  persistToken: boolean
  storageKey: string
  audience: string
  paths: Required<AuthPathOverrides>
}

const DEFAULT_PATHS: Record<AuthRealm, Required<AuthPathOverrides>> = {
  cloud: {
    login: "/v1/auth/login",
    refresh: "/v1/auth/refresh",
    me: "/v1/auth/me",
    logout: "/v1/auth/logout",
    twoFactorValidate: "/v1/auth/2fa/validate",
  },
  store: {
    login: "/v1/ops/auth/login",
    refresh: "/v1/ops/auth/refresh",
    me: "/v1/ops/auth/me",
    logout: "/v1/ops/auth/logout",
    twoFactorValidate: "/v1/ops/auth/2fa/validate",
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function readAudience(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()]
  return readStringArray(value).map((item) => item.trim()).filter(Boolean)
}

function readExpiresIn(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  const seconds =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new ApiError("Backend returned an invalid token expiry", {
      kind: "client",
      body: value,
      retryable: false,
    })
  }
  return seconds
}

function readUser(value: unknown): AuthUser {
  if (!isRecord(value)) {
    throw new ApiError("Backend returned an invalid user", {
      kind: "client",
      body: value,
      retryable: false,
    })
  }

  const id = readString(value.id)
  const username = readString(value.username) ?? readString(value.email)
  if (!id || !username) {
    throw new ApiError("Backend returned an incomplete user", {
      kind: "client",
      body: value,
      retryable: false,
    })
  }

  return {
    id,
    username,
    name: readString(value.name) ?? readString(value.display_name) ?? username,
    role: readString(value.role),
    permissions: readStringArray(value.permissions),
    storeId: readString(value.store_id) ?? readString(value.default_store_id),
    storeName: readString(value.store_name),
    locationType: readString(value.location_type),
    locationId: readString(value.location_id),
    locationName: readString(value.location_name),
    email: readString(value.email),
    phone: readString(value.phone),
    language: readString(value.language),
    timezone: readString(value.timezone),
    avatarUrl: readString(value.avatar_url),
  }
}

function sessionFromUser(
  realm: AuthRealm,
  user: AuthUser,
  expiresIn: unknown,
  metadata: SessionMetadata = {},
): AuthSession {
  const seconds = readExpiresIn(expiresIn)
  return {
    realm,
    backend: realm === "cloud" ? "cloud" : "store",
    user,
    subjectId: metadata.subjectId,
    principalType: metadata.principalType,
    audience: metadata.audiences?.[0],
    audiences: metadata.audiences,
    scope: metadata.scope,
    entityId: metadata.entityId,
    accessTokenExpiresAt: seconds ? Date.now() + seconds * 1000 : undefined,
  }
}

interface SessionMetadata {
  audiences?: string[]
  principalType?: AuthSession["principalType"]
  subjectId?: string
  entityId?: string
  scope?: string[]
}

function responseEnvelope(payload: unknown, path: string): Record<string, unknown> {
  try {
    return parseContract(AuthResponseEnvelope, payload, path)
  } catch (cause) {
    throw new ApiError("Backend returned an invalid authentication response", {
      kind: "client",
      body: payload,
      cause,
      retryable: false,
    })
  }
}

function metadataFromResponse(
  payload: Record<string, unknown>,
  expectedAudience: string,
  expectedRealm: AuthRealm,
): SessionMetadata {
  const responseRealm = readString(payload.realm)
  if (responseRealm && responseRealm !== expectedRealm) {
    throw new ApiError("Authentication response is for another realm", {
      kind: "client",
      body: { realm: responseRealm },
      retryable: false,
    })
  }

  const audiences = readAudience(payload.aud ?? payload.audience)
  if (audiences.length > 0 && !audiences.includes(expectedAudience)) {
    throw new ApiError("Authentication response is for another service", {
      kind: "client",
      body: { audience: audiences },
      retryable: false,
    })
  }

  const rawPrincipal = readString(payload.principal_type)
  const principalType = rawPrincipal as AuthSession["principalType"] | undefined
  if (principalType && principalType !== "workforce") {
    throw new ApiError("This identity cannot sign in to the workforce app", {
      kind: "client",
      body: { principal_type: rawPrincipal },
      retryable: false,
    })
  }

  const tokenUse = readString(payload.token_use)
  if (tokenUse && tokenUse !== "access") {
    throw new ApiError("Backend returned a non-access token", {
      kind: "client",
      body: { token_use: tokenUse },
      retryable: false,
    })
  }

  const scope =
    typeof payload.scope === "string"
      ? payload.scope.split(/\s+/).filter(Boolean)
      : readStringArray(payload.scope)

  return {
    audiences: audiences.length > 0 ? audiences : undefined,
    principalType,
    subjectId: readString(payload.subject_id),
    entityId: readString(payload.entity_id),
    scope: scope.length > 0 ? scope : undefined,
  }
}

function normalizeTokenResponse(
  realm: AuthRealm,
  payload: unknown,
  expectedAudience: string,
  path: string,
): { accessToken: string; session: AuthSession } {
  const envelope = responseEnvelope(payload, path)

  const accessToken =
    readString(envelope.access_token) ?? readString(envelope.token)
  const rawUser = envelope.user
  if (!accessToken || rawUser === undefined) {
    throw new ApiError("Backend returned an incomplete login response", {
      kind: "client",
      body: payload,
      retryable: false,
    })
  }

  return {
    accessToken,
    session: sessionFromUser(
      realm,
      readUser(rawUser),
      envelope.expires_in,
      metadataFromResponse(envelope, expectedAudience, realm),
    ),
  }
}

function normalizeChallenge(
  payload: Record<string, unknown>,
): TwoFactorChallenge | undefined {
  if (payload.requires_2fa !== true) return undefined
  const tempToken = readString(payload.temp_token)
  if (!tempToken) {
    throw new ApiError("Backend returned an incomplete two-factor challenge", {
      kind: "client",
      body: { requires_2fa: payload.requires_2fa },
      retryable: false,
    })
  }
  return { tempToken, message: readString(payload.message) }
}

function isUnauthorized(error: unknown): boolean {
  return isApiError(error) && error.status === 401
}

/* A refresh that a reachable backend rejects means there is no session to
 * restore, not that the backend is down: Internal answers 400
 * "refresh_token is required" when no refresh cookie has been set yet, and
 * 401 once one has expired. Only a transport failure or a 5xx is an outage,
 * and those must still surface as one. */
function isNoSession(error: unknown): boolean {
  if (!isApiError(error) || error.status === undefined) return false
  return error.status === 400 || error.status === 401
}

interface StoredToken {
  version: 1
  realm: AuthRealm
  backend: "cloud" | "store"
  audience: string
  token: string
  expiresAt?: number
}

function readStoredToken(
  key: string,
  expected: Pick<StoredToken, "realm" | "backend" | "audience">,
): Omit<StoredToken, "version" | "realm" | "backend" | "audience"> | undefined {
  if (typeof window === "undefined") return undefined
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return undefined
    const value = JSON.parse(raw) as Partial<StoredToken>
    if (
      value.version !== 1 ||
      value.realm !== expected.realm ||
      value.backend !== expected.backend ||
      value.audience !== expected.audience ||
      typeof value.token !== "string" ||
      !value.token.trim()
    ) {
      /* A value written by another realm is deliberately ignored, not
       * hydrated. Leaving it intact also avoids one realm deleting another's
       * session when an integrator accidentally reuses a custom key. */
      return undefined
    }
    if (
      value.expiresAt !== undefined &&
      (typeof value.expiresAt !== "number" ||
        !Number.isFinite(value.expiresAt) ||
        value.expiresAt <= Date.now())
    ) {
      window.sessionStorage.removeItem(key)
      return undefined
    }
    return { token: value.token.trim(), expiresAt: value.expiresAt }
  } catch {
    return undefined
  }
}

function writeStoredToken(key: string, token: StoredToken | null): void {
  if (typeof window === "undefined") return
  try {
    if (token) window.sessionStorage.setItem(key, JSON.stringify(token))
    else window.sessionStorage.removeItem(key)
  } catch {
    // Private browsing/storage policy must not make authentication unusable.
  }
}

export class AuthService {
  private readonly config: AuthServiceConfig
  private refreshInFlight: Promise<AuthSession | null> | undefined
  private operationVersion = 0

  constructor(options: AuthServiceOptions = {}) {
    const realm = options.realm ?? "cloud"
    const backend = realm === "cloud" ? "cloud" : "store"
    const client = options.client ?? (realm === "cloud" ? api : storeApi)
    if (options.client && client.backend !== backend) {
      throw new TypeError(
        `Auth realm ${realm} cannot use the ${client.backend} API client`,
      )
    }
    const defaults = DEFAULT_PATHS[realm]

    this.config = {
      realm,
      backend,
      client,
      // Cookie-backed cloud sessions do not need a JS-readable token. Store
      // sessions default to the current-tab persistence needed for a reload.
      persistToken: options.persistToken ?? realm === "store",
      storageKey:
        options.storageKey ?? `retailos.auth.${realm}.access_token`,
      audience: options.audience?.trim() || API_AUDIENCES[backend],
      paths: { ...defaults, ...options.paths },
    }
  }

  get realm(): AuthRealm {
    return this.config.realm
  }

  async login(credentials: LoginCredentials): Promise<LoginResult> {
    const version = ++this.operationVersion
    const payload = await this.config.client.post<unknown>(
      this.config.paths.login,
      credentials,
      { skipAuth: true },
    )
    const envelope = responseEnvelope(payload, this.config.paths.login)
    const challenge = normalizeChallenge(envelope)
    if (challenge) return { kind: "two_factor", challenge }

    const normalized = normalizeTokenResponse(
      this.config.realm,
      envelope,
      this.config.audience,
      this.config.paths.login,
    )
    if (version !== this.operationVersion) return this.supersededLogin()
    this.saveToken(
      normalized.accessToken,
      normalized.session.accessTokenExpiresAt,
    )
    return { kind: "authenticated", session: normalized.session }
  }

  /** Validate the current cookie/bearer session, refreshing once after 401. */
  async restore(): Promise<AuthSession | null> {
    const version = this.operationVersion
    this.hydrateToken()

    try {
      return await this.current()
    } catch (error: unknown) {
      if (!isUnauthorized(error)) throw error
    }

    const refreshed = await this.refresh()
    if (refreshed) return refreshed
    if (version !== this.operationVersion) return null
    this.clearToken()
    return null
  }

  async current(): Promise<AuthSession> {
    const payload = await this.config.client.get<unknown>(this.config.paths.me)
    const envelope = responseEnvelope(payload, this.config.paths.me)
    const rawUser =
      isRecord(envelope.user) ? envelope.user : envelope
    return sessionFromUser(
      this.config.realm,
      readUser(rawUser),
      envelope.expires_in,
      metadataFromResponse(envelope, this.config.audience, this.config.realm),
    )
  }

  async refresh(): Promise<AuthSession | null> {
    if (this.refreshInFlight) return this.refreshInFlight

    const version = this.operationVersion
    const operation = this.performRefresh(version)
    this.refreshInFlight = operation
    try {
      return await operation
    } finally {
      if (this.refreshInFlight === operation) this.refreshInFlight = undefined
    }
  }

  private async performRefresh(version: number): Promise<AuthSession | null> {
    try {
      const payload = await this.config.client.post<unknown>(
        this.config.paths.refresh,
        undefined,
        // Cloud refresh authenticates with its HttpOnly refresh cookie. The
        // store-router refresh endpoint instead validates the old bearer token.
        { skipAuth: this.config.realm === "cloud" },
      )
      const envelope = responseEnvelope(payload, this.config.paths.refresh)
      const normalized = normalizeTokenResponse(
        this.config.realm,
        envelope,
        this.config.audience,
        this.config.paths.refresh,
      )
      if (version !== this.operationVersion) return null
      this.saveToken(
        normalized.accessToken,
        normalized.session.accessTokenExpiresAt,
      )
      return normalized.session
    } catch (error: unknown) {
      if (isNoSession(error)) {
        if (version === this.operationVersion) this.clearToken()
        return null
      }
      throw error
    }
  }

  async verifyTwoFactor(
    challenge: TwoFactorChallenge,
    code: string,
  ): Promise<AuthSession> {
    if (this.config.realm !== "cloud") {
      throw new ApiError("Two-factor validation is not available for store sessions", {
        kind: "client",
        retryable: false,
      })
    }

    const version = ++this.operationVersion
    const payload = await this.config.client.post<unknown>(
      this.config.paths.twoFactorValidate,
      { temp_token: challenge.tempToken, totp_code: code },
      { skipAuth: true },
    )
    const normalized = normalizeTokenResponse(
      this.config.realm,
      payload,
      this.config.audience,
      this.config.paths.twoFactorValidate,
    )
    if (version !== this.operationVersion) {
      throw new ApiError("Authentication state changed during verification", {
        kind: "client",
        retryable: false,
      })
    }
    this.saveToken(
      normalized.accessToken,
      normalized.session.accessTokenExpiresAt,
    )
    return normalized.session
  }

  async logout(): Promise<void> {
    ++this.operationVersion
    try {
      await this.config.client.post<unknown>(this.config.paths.logout)
    } finally {
      this.clearToken()
    }
  }

  private hydrateToken(): void {
    if (!this.config.persistToken) return
    const token = readStoredToken(this.config.storageKey, {
      realm: this.config.realm,
      backend: this.config.backend,
      audience: this.config.audience,
    })
    if (token) {
      setApiAccessToken(this.config.backend, token.token, {
        audience: this.config.audience,
        expiresAt: token.expiresAt,
      })
    }
  }

  private saveToken(token: string, expiresAt?: number): void {
    setApiAccessToken(this.config.backend, token, {
      audience: this.config.audience,
      expiresAt,
    })
    if (this.config.persistToken) {
      writeStoredToken(this.config.storageKey, {
        version: 1,
        realm: this.config.realm,
        backend: this.config.backend,
        audience: this.config.audience,
        token,
        expiresAt,
      })
    }
  }

  private clearToken(): void {
    setApiAccessToken(this.config.backend, undefined)
    if (this.config.persistToken) writeStoredToken(this.config.storageKey, null)
  }

  private supersededLogin(): never {
    throw new ApiError("Authentication state changed during login", {
      kind: "client",
      retryable: false,
    })
  }
}

export type { AuthServiceOptions }
