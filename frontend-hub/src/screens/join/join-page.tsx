import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Eye, EyeOff } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { moment } from "@/lib/format"
import { acceptInvitation, previewInvitation } from "@/lib/queries/invitations"
import type { CloudMe } from "@itulah/contract"
import { ApiError } from "@itulah/contract/client"

/// The public page an invited person lands on: `/join/{token}`.
///
/// Reached signed out, with no cookie and no session to speak of — this is
/// how the person gets one. It stands entirely outside the signed-in shell
/// (see `App.tsx`, which renders it before it ever asks whether anybody is
/// signed in), and it reads nothing from this browser but the token in its
/// own URL.
export function JoinPage({
  token,
  onAccepted,
}: {
  token: string
  /// The server's own `/auth/me` answer, handed straight back so the caller
  /// can write it into the query cache and drop into the app already signed
  /// in — exactly what `LoginForm.onSignedIn` does.
  onAccepted: (me: CloudMe) => void
}) {
  const preview = useQuery({
    queryKey: ["invitations", "accept", token],
    queryFn: ({ signal }) => previewInvitation(token, signal),
    retry: false,
  })

  return (
    <main className="grid h-full place-items-center px-6">
      <div className="w-full max-w-[23rem]">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="grid size-10 place-items-center rounded-[0.625rem] bg-dark text-[1rem] font-semibold text-on-dark">
            C
          </span>
          <h1 className="mt-3.5 text-[1.375rem] font-semibold tracking-[-0.02em] text-ink">
            {preview.data
              ? `Welcome to ${preview.data.company_name}`
              : "You’ve been invited"}
          </h1>
        </div>

        {preview.isPending && (
          <p className="text-center text-meta text-body">
            Checking your invitation…
          </p>
        )}

        {preview.isError && <Expired error={preview.error} />}

        {preview.data && (
          <SetPassword
            token={token}
            preview={preview.data}
            onAccepted={onAccepted}
          />
        )}
      </div>
    </main>
  )
}

function Expired({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError
      ? error.message
      : "This link could not be checked — the server could not be reached."
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-hairline bg-canvas px-5 py-6 text-center shadow-soft">
      <p className="text-[0.9375rem] text-body">{message}</p>
      <p className="text-meta text-mute">Ask your admin for a new link.</p>
    </div>
  )
}

function SetPassword({
  token,
  preview,
  onAccepted,
}: {
  token: string
  preview: {
    readonly name: string
    readonly role_name: string
    readonly unit_name: string
    readonly suggested_username: string
    readonly expires_at: string
  }
  onAccepted: (me: CloudMe) => void
}) {
  const [revealed, setRevealed] = useState(false)

  const accept = useMutation({
    mutationFn: (values: { username: string; password: string }) =>
      acceptInvitation(token, values),
    onSuccess: onAccepted,
  })

  const form = useForm({
    defaultValues: {
      username: preview.suggested_username,
      password: "",
      confirm: "",
    },
    onSubmit: ({ value }) => {
      if (value.password !== value.confirm) return
      accept.mutate({
        username: value.username.trim(),
        password: value.password,
      })
    },
  })

  const problem =
    accept.error instanceof ApiError
      ? accept.error.message
      : accept.isError
        ? "The server could not be reached."
        : null

  return (
    <div className="rounded-card border border-hairline bg-canvas p-5 shadow-soft">
      <p className="text-[0.9375rem] text-body">
        <b className="font-medium text-ink">{preview.name}</b>, invited as{" "}
        <b className="font-medium text-ink">{preview.role_name}</b> at{" "}
        <b className="font-medium text-ink">{preview.unit_name}</b>.
      </p>
      <p className="mt-1 text-meta text-mute">
        This link expires {moment(preview.expires_at)}.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          form.handleSubmit()
        }}
        className="mt-5 flex flex-col gap-3.5"
      >
        <form.Field name="username">
          {(field) => (
            <Field label="Username" required>
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
            <Field label="Password" required hint="At least 8 characters.">
              <div className="relative">
                <Input
                  type={revealed ? "text" : "password"}
                  autoComplete="new-password"
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

        <form.Subscribe
          selector={(state) =>
            state.values.confirm !== "" &&
            state.values.confirm !== state.values.password
          }
        >
          {(mismatch) => (
            <form.Field name="confirm">
              {(field) => (
                <Field
                  label="Confirm password"
                  required
                  problem={mismatch ? "The two do not match." : undefined}
                >
                  <Input
                    type={revealed ? "text" : "password"}
                    autoComplete="new-password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>
          )}
        </form.Subscribe>

        {problem && <p className="text-[0.875rem] text-bad">{problem}</p>}

        <form.Subscribe
          selector={(state) =>
            state.values.username.trim() !== "" &&
            state.values.password.length >= 8 &&
            state.values.confirm === state.values.password
          }
        >
          {(ready) => (
            <Button
              variant="primary"
              className="mt-1.5 h-10 w-full"
              disabled={!ready}
              pending={accept.isPending}
              onClick={() => form.handleSubmit()}
            >
              {accept.isPending ? "Setting up…" : "Set password and sign in"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </div>
  )
}
