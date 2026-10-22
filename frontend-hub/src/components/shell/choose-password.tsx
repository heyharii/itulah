import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { Banner } from "@/components/ui/states"
import { auth, cacheKey, node } from "@/lib/api"
import { problemOf } from "@/lib/problem"
import { changeOwnPassword } from "@/lib/queries/system"
import { useIdentity } from "@/lib/session"

const stateKey = (username: string) =>
  ["auth", "password-state", username] as const

/// "Choose a new password" (owner, 2026-10-18): after an administrator set a
/// temporary password (0980), the person signs in with it once and chooses
/// their own here before the hub opens. The change ends the session (the
/// server's rule), so the hub signs straight back in with the new password.
export function ChoosePassword() {
  const client = useQueryClient()
  const identity = useIdentity()
  const username = identity.data?.username ?? ""
  const state = useQuery({
    queryKey: stateKey(username),
    queryFn: ({ signal }) =>
      node
        .get<{ must_change: boolean }>("/api/v1/auth/password-state", {
          signal,
        })
        // A server from before 0980 has no such question: nothing to change.
        .catch(() => ({ must_change: false })),
    enabled: identity.data != null,
    staleTime: Infinity,
  })
  const [temporary, setTemporary] = useState("")
  const [next, setNext] = useState("")
  const [again, setAgain] = useState("")

  const save = useMutation({
    mutationFn: async () => {
      await changeOwnPassword({
        current_password: temporary,
        new_password: next,
      })
      await auth.login(username, next)
    },
    onSuccess: () => {
      setTemporary("")
      setNext("")
      setAgain("")
      client.setQueryData(stateKey(username), { must_change: false })
      void client.invalidateQueries({ queryKey: cacheKey.me() })
    },
  })

  if (identity.data == null || state.data?.must_change !== true) return null

  const mismatch = again !== "" && again !== next
  const short = next !== "" && next.length < 8
  const ready =
    temporary !== "" && next.length >= 8 && next === again && next !== temporary

  return (
    <div className="fixed inset-0 z-[110] grid place-items-center bg-canvas/80 px-4 backdrop-blur-xl">
      <form
        className="flex w-full max-w-[24rem] flex-col gap-4 rounded-card border border-hairline bg-canvas p-6 shadow-float"
        onSubmit={(event) => {
          event.preventDefault()
          if (ready) save.mutate()
        }}
      >
        <div>
          <h1 className="text-card-title font-semibold text-ink">
            Choose a new password
          </h1>
          <p className="mt-1 text-[0.9375rem] text-body">
            You signed in with a temporary password. Choose your own to
            continue.
          </p>
        </div>
        <Field label="Temporary password">
          <Input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={temporary}
            onChange={(event) => setTemporary(event.target.value)}
          />
        </Field>
        <Field
          label="New password"
          problem={short ? "At least 8 characters." : undefined}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </Field>
        <Field
          label="New password again"
          problem={mismatch ? "The two do not match." : undefined}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(event) => setAgain(event.target.value)}
          />
        </Field>
        {save.error !== null && (
          <Banner tone="bad">{problemOf(save.error)}</Banner>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={!ready}
          pending={save.isPending}
        >
          Save and continue
        </Button>
      </form>
    </div>
  )
}
