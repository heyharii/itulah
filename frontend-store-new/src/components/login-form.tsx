import { useForm } from "@tanstack/react-form"
import { useMutation } from "@tanstack/react-query"
import { Eye, EyeOff } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { auth } from "@/lib/api"
import type { LoginResponse } from "@itulah/contract"
import { ApiError, type NodeIdentity } from "@itulah/contract/client"

/// Sign-in for the STORE node: the shop's back office, not the counter.
///
/// Username and password, not email: the node's identities are usernames, and
/// an `<input type="email">` would refuse a valid cashier's name before the
/// request was ever made. There is no third-party sign-in and no self-service
/// sign-up — staff are provisioned by a manager.
/// The door's fields: 47px, white, 15px text (see `.door-input`).
const FIELD = "door-input h-[2.9375rem] border-0 text-[0.9375rem]"

export function LoginForm({
  onSignedIn,
  /// A failure belonging to the session rather than to this form — a node that
  /// could not be reached at all.
  problem: sessionProblem = null,
}: {
  onSignedIn: (session: LoginResponse) => void
  problem?: string | null
  /// Still passed by `App`; the door no longer names the server (owner, 2026-09-28).
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

  const signInProblem =
    signIn.error === null
      ? null
      : signIn.error instanceof ApiError
        ? signIn.error.message
        : "could not reach this shop's node"

  const problem = signInProblem ?? sessionProblem

  // The door (hub v2, direction E · Quiet, airy spacing): one white card on a
  // pale drifting backdrop, a big quiet title, two fields and the one action.
  // The card's parts rise one after another (`door-card > *`, keyed by --i).
  return (
    <div className="pt-safe pb-safe relative grid h-full place-items-center overflow-y-auto px-5 py-10">
      <div aria-hidden="true" className="door" />
      <div className="door-card-wrap relative w-full max-w-[28.75rem]">
      <div aria-hidden="true" className="door-aura" />
      <form
        onSubmit={(event) => {
          event.preventDefault()
          form.handleSubmit()
        }}
        className="door-card relative w-full rounded-[2rem] bg-canvas px-7 pt-9 pb-8 sm:px-10 sm:pt-10 sm:pb-10"
      >
        <h1 className="text-[1.75rem] leading-9 font-semibold tracking-[-0.02em] text-ink [--i:0]">
          Sign in
        </h1>

        <div className="my-7 h-px bg-hairline [--i:2]" />

        <div className="flex flex-col gap-5 [--i:3]">
          <form.Field name="username">
            {(field) => (
              <Field label="Username">
                <Input
                  className={FIELD}
                  autoFocus
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
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
                    className={`${FIELD} pr-14`}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  {/* Revealed only while a thumb asks for it, and never logged,
                      never echoed, never put anywhere but this input. */}
                  <button
                    type="button"
                    onClick={() => setRevealed((on) => !on)}
                    aria-label={revealed ? "Hide password" : "Show password"}
                    className="absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center rounded-inner text-line-ico"
                  >
                    {revealed ? (
                      <EyeOff className="size-[1.125rem]" />
                    ) : (
                      <Eye className="size-[1.125rem]" />
                    )}
                  </button>
                </div>
              </Field>
            )}
          </form.Field>
        </div>

        {problem !== null && (
          <p
            role="alert"
            className="mt-5 text-meta text-bad [--i:0]"
          >
            {problem}
          </p>
        )}

        <div className="mt-8 [--i:4]">
          <Button
            variant="primary"
            block
            className="door-action h-[2.9375rem] rounded-[0.75rem] text-[0.9375rem] font-semibold"
            // A submit button, so Enter in either field signs in.
            type="submit"
            disabled={signIn.isPending}
          >
            {signIn.isPending ? "Signing in…" : "Sign in"}
          </Button>
        </div>

      </form>
      </div>
    </div>
  )
}
