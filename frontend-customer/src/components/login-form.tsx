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

/// Sign-in for the node this surface reads from.
///
/// This is not a member login, and the copy is careful not to suggest it is:
/// the system has no customer accounts, so the credential here is the ordinary
/// node account an administrator issues. It exists so that a member's points
/// and purchases are not readable by anyone who guesses a card number. When
/// customer sign-in arrives — a phone number and a one-time code, the way the
/// old PWA did it — this screen is what it replaces.
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
        error instanceof ApiError
          ? error.message
          : "Tidak dapat terhubung ke server.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>Itulah Member</CardTitle>
          <CardDescription>
            Masuk dengan akun perangkat untuk membuka aplikasi member.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="username">Nama pengguna</FieldLabel>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  autoFocus
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Kata sandi</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              {problem !== null && (
                <FieldDescription
                  role="alert"
                  className="text-destructive font-medium"
                >
                  {problem}
                </FieldDescription>
              )}
              <Field>
                <Button type="submit" disabled={busy}>
                  {busy ? "Memproses…" : "Masuk"}
                </Button>
                <FieldDescription className="text-center">
                  Akun diterbitkan oleh administrator.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
