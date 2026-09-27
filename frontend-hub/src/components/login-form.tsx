import { useForm } from "@tanstack/react-form"
import { useMutation } from "@tanstack/react-query"
import { Eye, EyeOff } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { auth } from "@/lib/api"
import type { LoginResponse } from "@itulah/contract"
import { ApiError } from "@itulah/contract/client"

/// Sign-in for the CLOUD node.
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
  /// How to sign in, for a surface that talks to more than one node.
  ///
  /// Defaults to the cloud, which is what the app's own login screen wants.
  /// Operations passes the edge node's instead: the two backends keep separate
  /// accounts, and the form has no business knowing which one it is serving —
  /// only that a username and a password go somewhere and a session comes
  /// back. Storing whatever the answer carries is the caller's job.
  signIn: signInWith = (username: string, password: string) =>
    auth.login(username, password),
  /// What this box is the door to. Defaults to the centre.
  ///
  /// Said rather than implied, because the hub now has two doors and they look
  /// identical: an operator asked for a password in the middle of the
  /// warehouse screens, under a heading saying "Central Dashboard", would
  /// reasonably type the one they have already used — and be told it is wrong,
  /// by a machine they were not told they were talking to.
  title = "Central Dashboard",
  caption = "Sign in to the central dashboard.",
}: {
  onSignedIn: (session: LoginResponse) => void
  problem?: string | null
  signIn?: (username: string, password: string) => Promise<LoginResponse>
  title?: string
  caption?: string
}) {
  const [revealed, setRevealed] = useState(false)

  /// The request, kept out of the form. "Busy" and "what went wrong" are facts
  /// about a request in flight and the mutation holds both; the form holds what
  /// was typed.
  const signIn = useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      signInWith(credentials.username, credentials.password),
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
    <div className="grid h-full place-items-center px-6">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          form.handleSubmit()
        }}
        className="w-full max-w-[21rem]"
      >
        <h1 className="text-hero font-semibold text-ink">{title}</h1>
        <p className="mt-1 mb-6 text-meta text-body">{caption}</p>

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
                    onChange={(event) => field.handleChange(event.target.value)}
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
          <p className="mt-3.5 text-[0.875rem] text-bad">
            {signInProblem ?? sessionProblem}
          </p>
        )}

        <Button
          variant="primary"
          className="mt-5 h-9 w-full"
          pending={signIn.isPending}
          onClick={() => form.handleSubmit()}
        >
          {signIn.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  )
}
