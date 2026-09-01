/**
 * Owns the application session boundary. Protected screens are rendered only
 * after the internal cloud session is restored; an unavailable backend or a
 * rejected login remains visible instead of falling back to local fixtures.
 */

import { useState, type FormEvent, type ReactNode } from "react"

import { LoginForm, type LoginValues } from "@/components/login-form"
import { AuthBoundary, useAuth } from "@/lib/auth"
import { getErrorMessage } from "@/lib/api"

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">{children}</div>
    </main>
  )
}

function LoginScreen() {
  const auth = useAuth()

  const handleLogin = async (values: LoginValues) => {
    await auth.login({ email: values.email, password: values.password })
  }

  return (
    <Centered>
      <LoginForm onLogin={handleLogin} errorMessage={auth.error?.message} />
    </Centered>
  )
}

function TwoFactorScreen() {
  const auth = useAuth()
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = code.replace(/\s/g, "")
    if (!/^\d{6}$/.test(normalized)) {
      setError("Enter the six-digit code from your authenticator.")
      return
    }

    setBusy(true)
    setError(undefined)
    try {
      await auth.verifyTwoFactor(normalized)
    } catch (reason: unknown) {
      setError(getErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Centered>
      <form
        onSubmit={submit}
        className="flex w-full flex-col gap-5 rounded-3xl border border-border bg-card p-6"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Two-factor verification
          </h1>
          <p className="text-sm text-muted-foreground">
            {auth.challenge?.message ?? "Enter the code to finish signing in."}
          </p>
        </div>
        {(error || auth.error) && (
          <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error ?? auth.error?.message}
          </p>
        )}
        <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
          Authenticator code
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            disabled={busy}
            className="h-11 rounded-xl border border-input bg-background px-3 text-center font-mono text-lg tracking-[0.35em] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Six-digit authenticator code"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Verifying…" : "Verify and continue"}
        </button>
      </form>
    </Centered>
  )
}

function LoadingScreen() {
  return (
    <Centered>
      <div className="rounded-3xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Restoring your session…
      </div>
    </Centered>
  )
}

function BackendErrorScreen({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <Centered>
      <section className="flex flex-col gap-4 rounded-3xl border border-destructive/25 bg-card p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Backend unavailable
          </h1>
          <p className="text-sm text-muted-foreground">
            Slowdown cannot verify the session, so protected data stays hidden.
          </p>
        </div>
        <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error.message}
        </p>
        <button
          type="button"
          onClick={retry}
          className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Retry connection
        </button>
      </section>
    </Centered>
  )
}

export function AuthGate({ children }: { children: ReactNode }) {
  return (
    <AuthBoundary
      loading={<LoadingScreen />}
      unauthenticated={<LoginScreen />}
      challenge={<TwoFactorScreen />}
      error={(error, retry) => <BackendErrorScreen error={error} retry={retry} />}
    >
      {children}
    </AuthBoundary>
  )
}

