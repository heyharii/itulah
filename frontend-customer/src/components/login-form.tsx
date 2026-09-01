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
import { useForm } from "@tanstack/react-form"
import { useMutation } from "@tanstack/react-query"

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
  const signIn = useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      auth.login(credentials.username, credentials.password),
    onSuccess: onSignedIn,
  })

  const form = useForm({
    defaultValues: { username: "", password: "" },
    // `mutate` rather than `mutateAsync`: the refusal belongs to the request,
    // not to the form, and is read back off the mutation below. Throwing it
    // through the submit handler would make it a second thing to catch.
    onSubmit: ({ value }) => signIn.mutate(value),
  })

  // The server's message is written for a person; repeating it is more use
  // than a generic failure. Anything else means we never reached it.
  const problem =
    signIn.error === null
      ? null
      : signIn.error instanceof ApiError
        ? signIn.error.message
        : "Tidak dapat terhubung ke server."

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
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
          >
            <FieldGroup>
              <form.Field name="username">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>Nama pengguna</FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      autoComplete="username"
                      autoFocus
                      required
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="password">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>Kata sandi</FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="password"
                      autoComplete="current-password"
                      required
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                    />
                  </Field>
                )}
              </form.Field>
              {problem !== null && (
                <FieldDescription
                  role="alert"
                  className="text-destructive font-medium"
                >
                  {problem}
                </FieldDescription>
              )}
              <Field>
                <Button type="submit" disabled={signIn.isPending}>
                  {signIn.isPending ? "Memproses…" : "Masuk"}
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
