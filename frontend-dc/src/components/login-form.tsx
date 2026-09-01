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

/// Sign-in for the DC node.
///
/// Username and password, not email: the server's identities are usernames
/// (`backend/src/cloud/postgres/users.rs` lower-cases and matches on one), and
/// an `<input type="email">` would refuse a perfectly valid operator name
/// before the request was ever made. There is no third-party sign-in to offer
/// and no self-service sign-up — operators are provisioned by an administrator.
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
        : "could not reach the server"

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>Itulah DC</CardTitle>
          <CardDescription>
            Distribution centre — sign in to continue
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
                    <FieldLabel htmlFor={field.name}>Username</FieldLabel>
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
                    <FieldLabel htmlFor={field.name}>Password</FieldLabel>
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
                  className="font-medium text-destructive"
                >
                  {problem}
                </FieldDescription>
              )}
              <Field>
                <Button type="submit" disabled={signIn.isPending}>
                  {signIn.isPending ? "Signing in…" : "Sign in"}
                </Button>
                <FieldDescription className="text-center">
                  Accounts are issued by an administrator.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
