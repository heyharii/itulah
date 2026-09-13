import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { ActionBar, Screen, Section } from "@/components/ui/screen"
import { Banner } from "@/components/ui/states"
import { cacheKey, node } from "@/lib/api"
import { describe } from "@/lib/errors"
import { useGo } from "@/lib/go"
import { unsentCount, useSaleQueue } from "@/lib/sale-queue"
import type { ChangePasswordRequest } from "@itulah/contract"
import type { Identity } from "@itulah/contract/client"

/// Changing your own password.
///
/// Three write-only fields and nothing else. **A password is never displayed,
/// never logged, never put in a query string and never held anywhere but the
/// input it was typed into** — there is no reveal control on this screen, and
/// that is a deliberate difference from the login box: the login box reveals so
/// somebody can check what they typed before being locked out over a typo; here
/// the confirmation field does that job without ever putting the characters on
/// a screen a customer can see over a shoulder.
///
/// **Changing a password ends the session.** `edge/http.rs::change_password`
/// answers through `cleared_auth_response`, which clears the session cookie and
/// the CSRF cookie both — so this browser is signed out the moment the node
/// says yes. The screen has to say so and act on it: `useIdentity` is
/// `staleTime: Infinity`, so a shell that was not told would keep drawing a
/// signed-in till while every request behind it answered 401, and the sale
/// queue — which retries a 401 on purpose — would spin against a dead session
/// with no login box in front of anyone.
export function Password() {
  const go = useGo()
  const client = useQueryClient()
  const unsent = unsentCount(useSaleQueue())
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [again, setAgain] = useState("")

  const change = useMutation({
    mutationFn: (request: ChangePasswordRequest) =>
      node.post<unknown>("/api/v1/auth/change-password", request),
    onSuccess: () => {
      setCurrent("")
      setNext("")
      setAgain("")
      // Writing `null` rather than invalidating: the cookies are already gone,
      // so asking `/auth/me` again could only answer 401, and `useIdentity`
      // turns that into `null` anyway — one round trip later, with a signed-in
      // shell on screen in between.
      //
      // The queue is untouched on purpose. It is on disk, it keeps its keys,
      // and it resumes the moment somebody signs in again.
      client.setQueryData<Identity | null>(cacheKey.me(), null)
    },
  })

  const mismatch = again !== "" && next !== again
  const ready =
    current !== "" && next !== "" && next === again && !change.isPending

  return (
    <>
      <Screen foot="none">
        <Section className="pt-4">
          {change.isSuccess && (
            <Banner tone="ok" className="mb-4">
              Your password has been changed, and this till has been signed out.
              Sign in again with the new one.
            </Banner>
          )}
          {unsent > 0 && !change.isSuccess && (
            <Banner tone="warn" className="mb-4">
              Changing a password signs this till out. The{" "}
              {unsent === 1 ? "sale" : `${unsent} sales`} still waiting to reach
              head office {unsent === 1 ? "is" : "are"} saved on this device and
              will carry on sending as soon as somebody signs in again — but
              nothing will send while nobody is.
            </Banner>
          )}
          {change.error !== null && (
            <Banner tone="bad" className="mb-4">
              {describe(change.error)}
            </Banner>
          )}

          <div className="flex flex-col gap-4">
            <Field label="Your current password">
              <Input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            </Field>
            <Field label="New password">
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
                invalid={mismatch}
                value={again}
                onChange={(event) => setAgain(event.target.value)}
              />
            </Field>
          </div>

          <p className="mt-4 text-meta text-mute">
            A manager resetting a password somebody has forgotten does it at
            head office, not here — this screen asks for the current one, so it
            can only ever change your own. Changing it signs this till out.
          </p>
        </Section>
      </Screen>

      <ActionBar>
        <div className="flex gap-2.5">
          <Button size="lg" onClick={() => go("/sell")}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            block
            disabled={!ready}
            onClick={() =>
              change.mutate({ current_password: current, new_password: next })
            }
          >
            {change.isPending ? "Changing…" : "Change password"}
          </Button>
        </div>
      </ActionBar>
    </>
  )
}
