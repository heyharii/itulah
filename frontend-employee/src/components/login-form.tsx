import { useForm } from "@tanstack/react-form"
import { useMutation } from "@tanstack/react-query"
import { Eye, EyeOff } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { auth } from "@/lib/api"
import type { LoginResponse } from "@itulah/contract"
import { ApiError } from "@itulah/contract/client"

/// Sign-in, with the same account as every other surface.
///
/// Username and password, not email: the server's identities are usernames,
/// and an `<input type="email">` would refuse a perfectly valid operator name
/// before the request was ever made. There is no self-service sign-up — the
/// account is issued with the job.
export function LoginForm({
  onSignedIn,
  problem: sessionProblem = null,
  footer,
}: {
  onSignedIn: (session: LoginResponse) => void
  problem?: string | null
  footer?: React.ReactNode
}) {
  const [revealed, setRevealed] = useState(false)

  const signIn = useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      auth.login(credentials.username, credentials.password),
    onSuccess: onSignedIn,
  })

  const form = useForm({
    defaultValues: { username: "", password: "" },
    onSubmit: ({ value }) => signIn.mutate(value),
  })

  const signInProblem =
    signIn.error === null
      ? null
      : signIn.error instanceof ApiError
        ? signIn.error.message
        : "could not reach the server"
  const problem = signInProblem ?? sessionProblem

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
      className="w-full max-w-[21rem]"
    >
      <div className="mb-6 flex items-center gap-2.5">
        <span className="grid size-[1.875rem] place-items-center rounded-inner bg-dark text-[0.6875rem] font-semibold tracking-[0.02em] text-on-dark">
          IT
        </span>
        <div>
          <h1 className="text-hero font-semibold text-ink">My work</h1>
          <p className="text-meta text-body">Sign in to continue.</p>
        </div>
      </div>

      <div className="flex flex-col gap-3.5">
        <form.Field name="username">
          {(field) => (
            <Field label="Username">
              <Input
                name={field.name}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                autoFocus
                required
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="password">
          {(field) => (
            <Field label="Password">
              <div className="relative">
                <Input
                  name={field.name}
                  type={revealed ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  className="pr-11"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setRevealed((on) => !on)}
                  aria-label={revealed ? "Hide password" : "Show password"}
                  className="absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-text"
                >
                  {revealed ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </Field>
          )}
        </form.Field>
      </div>

      {problem !== null && (
        <p role="alert" className="mt-3.5 text-[0.71875rem] text-bad">
          {problem}
        </p>
      )}

      <Button
        type="submit"
        variant="primary"
        size="tap"
        className="mt-5 w-full md:h-10"
        disabled={signIn.isPending}
      >
        {signIn.isPending ? "Signing in…" : "Sign in"}
      </Button>

      <p className="mt-4 text-center text-meta text-mute">
        Use the same account as the till.
      </p>
      {footer}
    </form>
  )
}
