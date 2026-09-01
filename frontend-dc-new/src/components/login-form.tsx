import { useForm } from "@tanstack/react-form"
import { useMutation } from "@tanstack/react-query"
import { Eye, EyeOff } from "lucide-react"
import { useState } from "react"

import { Mark } from "@/components/shell/mark"
import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { auth } from "@/lib/api"
import type { LoginResponse } from "@itulah/contract"
import { ApiError, type NodeIdentity } from "@itulah/contract/client"

/// Sign-in for this DC edge node.
///
/// Username and password, not email: the server's identities are usernames, and
/// an `<input type="email">` would refuse a valid operator name before the
/// request was ever made. There is no third-party sign-in and no self-service
/// sign-up — operators are provisioned by an administrator.
export function LoginForm({
  onSignedIn,
  /// A failure belonging to the session rather than to this form — a node that
  /// could not be reached at all.
  problem: sessionProblem = null,
  /// Which node this console is talking to. Worth showing before anybody types:
  /// signing into the wrong node is a mistake you want to catch early.
  node = null,
}: {
  onSignedIn: (session: LoginResponse) => void
  problem?: string | null
  node?: NodeIdentity | null
}) {
  const [revealed, setRevealed] = useState(false)

  /// The request, kept out of the form. "Busy" and "what went wrong" are facts
  /// about a request in flight and the mutation holds both; the form holds what
  /// was typed.
  const signIn = useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      auth.login(credentials.username, credentials.password),
    onSuccess: onSignedIn,
  })

  const form = useForm({
    defaultValues: { username: "", password: "" },
    onSubmit: ({ value }) => signIn.mutate(value),
  })

  // The server's message is written for a person; repeating it is more use than
  // a generic failure. Anything else means we never reached it.
  const signInProblem =
    signIn.error === null
      ? null
      : signIn.error instanceof ApiError
        ? signIn.error.message
        : "could not reach the server"

  return (
    <div className="grid h-full lg:grid-cols-[1.05fr_1fr]">
      {/* The one illustration in the system, given the room it needs. */}
      <div className="hidden place-items-center bg-soft lg:grid">
        <Mark className="h-64 w-56 text-line-ico" />
      </div>

      <div className="grid place-items-center px-6">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
          className="w-full max-w-[21rem]"
        >
          <Mark className="mb-5 h-9 w-8 text-ink lg:hidden" />
          <h1 className="text-hero font-semibold text-ink">
            Distribution centre
          </h1>
          <p className="mt-1 mb-6 text-meta text-body">
            Sign in to the warehouse console.
          </p>

          <div className="flex flex-col gap-3.5">
            <form.Field name="username">
              {(field) => (
                <Field label="Username">
                  <Input
                    autoFocus
                    autoComplete="username"
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
                      type={revealed ? "text" : "password"}
                      autoComplete="current-password"
                      className="pr-11"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setRevealed((on) => !on)}
                      aria-label={revealed ? "Hide password" : "Show password"}
                      className="absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-text"
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

          {(signInProblem ?? sessionProblem) && (
            <p className="mt-3.5 text-[0.71875rem] text-bad">
              {signInProblem ?? sessionProblem}
            </p>
          )}

          <Button
            variant="dark"
            className="mt-5 w-full"
            disabled={signIn.isPending}
            onClick={() => form.handleSubmit()}
          >
            {signIn.isPending ? "Signing in…" : "Sign in"}
          </Button>

          {/* A courtesy, not a status: failing to name the node is not a
              sign-in problem and must never be reported as one. */}
          {node && (
            <p className="mt-5 text-center font-mono text-[0.65625rem] text-mute">
              {node.node_role} · {node.node_id}
              {node.auth === "DISABLED" && " · AUTH DISABLED"}
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
