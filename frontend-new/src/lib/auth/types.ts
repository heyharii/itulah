/**
 * Owns the browser-facing identity vocabulary shared by cloud-hub and
 * store-router sessions. It deliberately omits raw tokens from the public
 * session object so screens only receive the authenticated principal.
 */

import type { ApiBackend } from "../api"

export type AuthRealm = "cloud" | "store"

/** Principal classes used by the shared cloud/store/dc identity contract. */
export type AuthPrincipalType = "workforce" | "customer" | "device" | "service"

/** Resource audiences. A token may be accepted only by its intended service. */
export type AuthAudience = "cloud-hub" | "store-router" | "dc-edge"

export type AuthStatus =
  | "loading"
  | "authenticated"
  | "anonymous"
  | "challenge"
  | "error"

export interface AuthUser {
  id: string
  username: string
  name: string
  role?: string
  permissions: string[]
  storeId?: string
  storeName?: string
  locationType?: string
  locationId?: string
  locationName?: string
  email?: string
  phone?: string
  language?: string
  timezone?: string
  avatarUrl?: string
}

export interface AuthSession {
  realm: AuthRealm
  backend: ApiBackend
  user: AuthUser
  /** Canonical subject UUID when the identity service has provisioned one. */
  subjectId?: string
  /** Principal type is optional during the legacy claims migration. */
  principalType?: AuthPrincipalType
  /** First/primary `aud` value returned by the identity boundary. */
  audience?: string
  /** Full `aud` set when a token is multi-audience. */
  audiences?: string[]
  scope?: string[]
  entityId?: string
  /** Epoch milliseconds when the access token expires, when supplied by API. */
  accessTokenExpiresAt?: number
}

export interface LoginCredentials {
  username?: string
  email?: string
  password?: string
  pin?: string
}

export interface TwoFactorChallenge {
  tempToken: string
  message?: string
}

export type LoginResult =
  | { kind: "authenticated"; session: AuthSession }
  | { kind: "two_factor"; challenge: TwoFactorChallenge }

export interface AuthPathOverrides {
  login?: string
  refresh?: string
  me?: string
  logout?: string
  twoFactorValidate?: string
}
