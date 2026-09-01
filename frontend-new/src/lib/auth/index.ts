/** Public identity/session boundary for internal backend integrations. */

export { AuthBoundary } from "./boundary"
export {
  AuthProvider,
  useAuth,
  type AuthContextValue,
  type AuthProviderProps,
} from "./provider"
export { AuthService, type AuthServiceOptions } from "./service"
export type {
  AuthAudience,
  AuthPathOverrides,
  AuthPrincipalType,
  AuthRealm,
  AuthSession,
  AuthStatus,
  AuthUser,
  LoginCredentials,
  LoginResult,
  TwoFactorChallenge,
} from "./types"
