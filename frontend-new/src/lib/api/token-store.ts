/**
 * Owns short-lived access tokens used by the API clients.
 *
 * Tokens are kept in memory by default. The store-router has no HttpOnly cookie
 * flow yet, so the auth service may explicitly hydrate one from sessionStorage
 * for the current browser tab. There is deliberately no localStorage fallback.
 *
 * The map is keyed by backend rather than by "current user". This is important:
 * a cloud access token must never be the implicit bearer for store-router or
 * dc-edge requests. The optional binding metadata lets clients also reject an
 * obviously wrong audience or an expired token before it reaches fetch().
 */

import type { ApiBackend } from "./client"

export interface ApiAccessTokenOptions {
  /** Resource-server audience the token was obtained for. */
  audience?: string
  /** Epoch milliseconds; expired records are removed on read. */
  expiresAt?: number
}

export interface ApiAccessTokenRecord {
  backend: ApiBackend
  token: string
  audience?: string
  expiresAt?: number
}

const tokens = new Map<ApiBackend, ApiAccessTokenRecord>()

export function getApiAccessToken(backend: ApiBackend): string | undefined {
  const record = getApiAccessTokenRecord(backend)
  return record?.token
}

export function getApiAccessTokenRecord(
  backend: ApiBackend,
): ApiAccessTokenRecord | undefined {
  const record = tokens.get(backend)
  if (!record) return undefined

  if (record.expiresAt !== undefined && record.expiresAt <= Date.now()) {
    tokens.delete(backend)
    return undefined
  }

  return { ...record }
}

export function setApiAccessToken(
  backend: ApiBackend,
  token: string | null | undefined,
  options: ApiAccessTokenOptions = {},
): void {
  const normalized = typeof token === "string" ? token.trim() : ""
  if (!normalized) {
    tokens.delete(backend)
    return
  }

  const expiresAt =
    typeof options.expiresAt === "number" && Number.isFinite(options.expiresAt)
      ? options.expiresAt
      : undefined
  if (expiresAt !== undefined && expiresAt <= Date.now()) {
    tokens.delete(backend)
    return
  }

  tokens.set(backend, {
    backend,
    token: normalized,
    audience: options.audience?.trim() || undefined,
    expiresAt,
  })
}

export function clearApiAccessToken(backend: ApiBackend): void {
  tokens.delete(backend)
}

export function clearApiAccessTokens(): void {
  tokens.clear()
}
