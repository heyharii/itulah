/**
 * Owns React session state and makes auth failures explicit to feature
 * screens. The provider does not render a fake login or silently fail open;
 * applications choose their login/unauthorized UI through AuthBoundary.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react"

import { getErrorMessage, isApiError, type ApiClient } from "../api"
import { AuthService } from "./service"
import type {
  AuthRealm,
  AuthSession,
  AuthStatus,
  AuthUser,
  LoginCredentials,
  LoginResult,
  TwoFactorChallenge,
} from "./types"

interface AuthState {
  status: AuthStatus
  session: AuthSession | null
  challenge: TwoFactorChallenge | null
  error: Error | undefined
}

export interface AuthContextValue extends AuthState {
  user: AuthUser | null
  login: (credentials: LoginCredentials) => Promise<LoginResult>
  verifyTwoFactor: (code: string) => Promise<AuthSession>
  refresh: () => Promise<AuthSession | null>
  logout: () => Promise<void>
  clearError: () => void
}

export interface AuthProviderProps extends PropsWithChildren {
  realm?: AuthRealm
  client?: ApiClient
  persistToken?: boolean
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(getErrorMessage(error))
}

/**
 * Credential/TOTP rejection is an expected form state, not a broken backend.
 * Transport failures and unexpected server errors must still fail closed into
 * the explicit backend-error screen.
 */
function isExpectedCredentialFailure(error: unknown): boolean {
  if (!isApiError(error) || error.kind !== "http") return false
  return error.status === 400 || error.status === 401 || error.status === 403 || error.status === 422
}

export function AuthProvider({
  children,
  realm = "cloud",
  client,
  persistToken,
}: AuthProviderProps) {
  const service = useMemo(
    () => new AuthService({ realm, client, persistToken }),
    [client, persistToken, realm],
  )
  const [state, setState] = useState<AuthState>({
    status: "loading",
    session: null,
    challenge: null,
    error: undefined,
  })

  useEffect(() => {
    let active = true
    setState((current) => ({ ...current, status: "loading", error: undefined }))

    void service.restore().then(
      (session) => {
        if (!active) return
        setState({
          status: session ? "authenticated" : "anonymous",
          session,
          challenge: null,
          error: undefined,
        })
      },
      (error: unknown) => {
        if (!active) return
        setState({
          status: "error",
          session: null,
          challenge: null,
          error: normalizeError(error),
        })
      },
    )

    return () => {
      active = false
    }
  }, [service])

  const login = useCallback(
    async (credentials: LoginCredentials): Promise<LoginResult> => {
      setState((current) => ({
        ...current,
        status: "loading",
        error: undefined,
      }))
      try {
        const result = await service.login(credentials)
        if (result.kind === "two_factor") {
          setState({
            status: "challenge",
            session: null,
            challenge: result.challenge,
            error: undefined,
          })
        } else {
          setState({
            status: "authenticated",
            session: result.session,
            challenge: null,
            error: undefined,
          })
        }
        return result
      } catch (error: unknown) {
        setState((current) => ({
          ...current,
          status: isExpectedCredentialFailure(error) ? "anonymous" : "error",
          challenge: null,
          error: normalizeError(error),
        }))
        throw error
      }
    },
    [service],
  )

  const verifyTwoFactor = useCallback(
    async (code: string): Promise<AuthSession> => {
      if (!state.challenge) {
        throw new Error("There is no pending two-factor challenge")
      }
      setState((current) => ({ ...current, status: "loading", error: undefined }))
      try {
        const session = await service.verifyTwoFactor(state.challenge, code)
        setState({
          status: "authenticated",
          session,
          challenge: null,
          error: undefined,
        })
        return session
      } catch (error: unknown) {
        setState((current) => ({
          ...current,
          status: isExpectedCredentialFailure(error) ? "challenge" : "error",
          error: normalizeError(error),
        }))
        throw error
      }
    },
    [service, state.challenge],
  )

  const refresh = useCallback(async (): Promise<AuthSession | null> => {
    setState((current) => ({ ...current, status: "loading", error: undefined }))
    try {
      const session = await service.restore()
      setState({
        status: session ? "authenticated" : "anonymous",
        session,
        challenge: null,
        error: undefined,
      })
      return session
    } catch (error: unknown) {
      setState((current) => ({
        ...current,
        status: "error",
        error: normalizeError(error),
      }))
      throw error
    }
  }, [service])

  const logout = useCallback(async (): Promise<void> => {
    setState((current) => ({ ...current, status: "loading", error: undefined }))
    try {
      await service.logout()
      setState({ status: "anonymous", session: null, challenge: null, error: undefined })
    } catch (error: unknown) {
      setState({
        status: "error",
        session: null,
        challenge: null,
        error: normalizeError(error),
      })
      throw error
    }
  }, [service])

  const clearError = useCallback(() => {
    setState((current) => ({
      ...current,
      status: current.session ? "authenticated" : "anonymous",
      error: undefined,
    }))
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      user: state.session?.user ?? null,
      login,
      verifyTwoFactor,
      refresh,
      logout,
      clearError,
    }),
    [clearError, login, logout, refresh, state, verifyTwoFactor],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// The provider and its hook form one intentional public context boundary.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider")
  }
  return context
}
