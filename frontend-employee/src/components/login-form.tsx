import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { auth } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { LoginResponse } from "@itulah/contract"
import { ApiError } from "@itulah/contract/client"

/// Sign-in, with the same account as every other surface.
///
/// Username and password, not email: the server's identities are usernames,
/// and an `<input type="email">` would refuse a perfectly valid operator name
/// before the request was ever made. There is no self-service sign-up — the
/// account is issued with the job.
///
/// The fields are `h-11` and 16px here rather than the design system's default
/// because this one is typed on a phone: anything smaller is both hard to hit
/// and, at under 16px, enough to make iOS Safari zoom the page on focus and
/// leave the password field off the side of the screen.
export function LoginForm({
  onSignedIn,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  onSignedIn: (session: LoginResponse) => void
}) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      onSignedIn(await auth.login(username, password))
    } catch (error) {
      // The server's message is written for a person; repeating it is more
      // use than a generic failure. Anything else means we never reached it.
      setProblem(
        error instanceof ApiError ? error.message : "could not reach the server"
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>Itulah</CardTitle>
          <CardDescription>Your work — sign in to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="username">Username</FieldLabel>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoFocus
                  required
                  className="h-11 text-base md:text-sm"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="h-11 text-base md:text-sm"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              {problem !== null && (
                <FieldDescription
                  role="alert"
                  className="font-medium text-destructive"
                >
                  {problem}
                </FieldDescription>
              )}
              <Field>
                <Button
                  type="submit"
                  size="lg"
                  className="h-11"
                  disabled={busy}
                >
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
                <FieldDescription className="text-center">
                  Use the same account as the till.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
