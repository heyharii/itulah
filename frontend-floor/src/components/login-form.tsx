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

/// Sign-in for the DC node.
///
/// Username and password, not email: the node's identities are usernames, and an
/// `<input type="email">` would refuse a valid picker's name before the request
/// was ever made. There is no third-party sign-in and no self-service sign-up —
/// floor staff are provisioned by a supervisor.
///
/// It matters here more than on most surfaces **who** is signed in: the receiving
/// ceremony refuses a verification by the person who counted, and every movement
/// this app writes names the actor. A shared login on a shared phone is how a
/// warehouse ends up with a delivery counted and verified by the same nobody.
export function LoginForm({
  onSignedIn,
  /// A failure belonging to the session rather than to this form — a node that
  /// could not be reached at all.
  problem: sessionProblem = null,
  /// Which node this phone is talking to. Worth showing before anybody types: a
  /// phone pointed at a shop's till, or at the centre, should say so plainly
  /// rather than offering a Picking tab that will be refused.
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

  // A refused password is the server's sentence to say. A node that is not
  // answering is not: the proxy's "Bad Gateway" reached the login screen
  // verbatim, and nobody on a warehouse floor can act on it.
  const signInProblem =
    signIn.error === null
      ? null
      : signIn.error instanceof ApiError &&
          signIn.error.status > 0 &&
          signIn.error.status < 500
        ? signIn.error.message
        : "Server gudang belum tersambung. Pastikan HP terhubung ke WiFi gudang, lalu coba lagi."

  return (
    <div className="pt-safe pb-safe grid h-full place-items-center px-5">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          form.handleSubmit()
        }}
        className="w-full max-w-[22rem]"
      >
        <Mark className="mb-5 h-11 w-10 text-ink" />
        <h1 className="text-hero font-semibold text-ink">Lantai</h1>
        <p className="mt-1 mb-7 text-meta text-body">
          Masuk ke node gudang ini.
        </p>

        <div className="flex flex-col gap-4">
          <form.Field name="username">
            {(field) => (
              <Field label="Nama pengguna">
                <Input
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
              <Field label="Kata sandi">
                <div className="relative">
                  <Input
                    type={revealed ? "text" : "password"}
                    autoComplete="current-password"
                    className="pr-14"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  {/* Revealed only while a thumb asks for it, and never logged,
                      never echoed, never put anywhere but this input. */}
                  <button
                    type="button"
                    onClick={() => setRevealed((on) => !on)}
                    aria-label={
                      revealed ? "Sembunyikan sandi" : "Tampilkan sandi"
                    }
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

        {(signInProblem ?? sessionProblem) !== null && (
          <p className="mt-4 text-meta text-bad">
            {signInProblem ?? sessionProblem}
          </p>
        )}

        <Button
          variant="primary"
          size="lg"
          block
          className="mt-6"
          disabled={signIn.isPending}
          onClick={() => form.handleSubmit()}
        >
          {signIn.isPending ? "Masuk…" : "Masuk"}
        </Button>

        {/* A courtesy, not a status: failing to name the node is not a sign-in
            problem and must never be reported as one. */}
        {node !== null && (
          <p className="mt-6 text-center font-mono text-[0.6875rem] text-mute">
            {node.node_role} · {node.site_id ?? node.node_id}
            {node.auth === "DISABLED" && " · AUTH DISABLED"}
          </p>
        )}
      </form>
    </div>
  )
}
