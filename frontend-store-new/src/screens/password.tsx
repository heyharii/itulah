import { useMutation, useQueryClient } from "@tanstack/react-query"
import { KeyRound } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { KeyValue } from "@/components/ui/rows"
import { Screen } from "@/components/ui/screen"
import { Banner } from "@/components/ui/states"
import { cacheKey, node } from "@/lib/api"
import { describe } from "@/lib/errors"
import { label } from "@/lib/format"
import { useGo } from "@/lib/go"
import { homePath } from "@/lib/navigation"
import { unsentCount, useSaleQueue } from "@/lib/sale-queue"
import { useIdentity, useNodeIdentity } from "@/lib/session"
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
///
/// Drawn as the hub's node Account (`frontend-hub/src/screens/operations/node/
/// account.tsx`): the form as a card with its buttons at its foot, and beside
/// it who the node thinks is signed in — the answer to "whose password is this
/// about to change", read before rather than after.
export function Password() {
  const go = useGo()
  const client = useQueryClient()
  const unsent = unsentCount(useSaleQueue())
  const me = useIdentity()
  const where = useNodeIdentity()
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

  /// A node running with sign-in switched off has nobody signed in — every
  /// request is the development principal, which has no password of its own —
  /// so the form is shown but not offered, with the reason above it rather
  /// than a refusal from the node after somebody has typed three passwords.
  const signInOff =
    where.data?.auth === "DISABLED" ||
    (me.data !== undefined &&
      me.data !== null &&
      "source" in me.data &&
      me.data.source === "DEVELOPMENT")

  const mismatch = again !== "" && next !== again
  const ready =
    !signInOff &&
    current !== "" &&
    next !== "" &&
    next === again &&
    !change.isPending

  return (
    <Screen sub="The password you sign in to this till with. Changing it signs you out here.">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          {/* A real form, so Enter submits — guarded by the same `ready` the
              button is, because a disabled button does not stop the Enter
              key and a mismatched confirmation must never reach the node. */}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (ready) {
                change.mutate({ current_password: current, new_password: next })
              }
            }}
          >
            <div className="flex items-center gap-3 border-b border-hairline bg-soft px-4 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-inner border border-hairline-2 bg-canvas text-line-ico">
                <KeyRound className="size-4 stroke-[1.7]" />
              </span>
              <div className="min-w-0">
                <h2 className="text-card-title font-semibold text-ink">
                  Change your password
                </h2>
                <p className="text-meta text-mute">
                  Asks for the current one, so it only ever changes your own.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-4 px-4 py-4">
              {change.isSuccess && (
                <Banner tone="ok">
                  Your password has been changed, and this till has been signed
                  out. Sign in again with the new one.
                </Banner>
              )}
              {signInOff && !change.isSuccess && (
                <Banner tone="info">
                  This node runs with sign-in switched off, so nobody is signed
                  in here and there is no password to change.
                </Banner>
              )}
              {unsent > 0 && !change.isSuccess && !signInOff && (
                <Banner tone="warn">
                  Changing a password signs this till out. The{" "}
                  {unsent === 1 ? "sale" : `${unsent} sales`} still waiting to
                  reach head office {unsent === 1 ? "is" : "are"} saved in this
                  browser and will carry on sending as soon as somebody signs in
                  again — but nothing will send while nobody is.
                </Banner>
              )}
              {change.error !== null && (
                <Banner tone="bad">{describe(change.error)}</Banner>
              )}

              <fieldset disabled={signInOff} className="flex flex-col gap-4">
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
                  // Says that they differ and nothing more. Neither value is
                  // ever shown back, here or anywhere else on this screen.
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
              </fieldset>
            </div>

            {/* The form's buttons at its foot, as the hub's sheet draws them:
                the way out quiet, the one action filled. Full width on a
                phone, where the two are thumbed. */}
            <div className="flex gap-2 border-t border-hairline px-4 py-3 md:justify-end max-md:[&>*]:flex-1">
              <Button variant="ghost" onClick={() => go(homePath)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={!ready}>
                {change.isPending ? "Changing…" : "Change password"}
              </Button>
            </div>
          </form>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="px-4 pt-3.5 pb-1 text-card-title font-semibold text-ink">
              Signed in
            </h2>
            <div className="px-4 pb-3">
              <KeyValue term="Name">{me.data?.display_name ?? "—"}</KeyValue>
              <KeyValue term="Username">
                <span className="font-mono text-id">
                  {me.data?.username ?? "—"}
                </span>
              </KeyValue>
              <KeyValue term="Role">{label(me.data?.role)}</KeyValue>
              <KeyValue term="Account">{accountKind(me.data)}</KeyValue>
              <KeyValue term="Shop">
                <span className="font-mono text-id">
                  {where.data?.site_id ?? "—"}
                </span>
              </KeyValue>
            </div>
          </Card>

          <p className="px-1 text-meta leading-relaxed text-mute">
            A manager resetting a password somebody has forgotten does it at
            head office, not here — this screen asks for the current one, so it
            can only ever change your own. Changing it signs this till out.
          </p>
        </div>
      </div>
    </Screen>
  )
}

/// Which kind of account is signed in, in words — the node's `source`, which
/// only an Edge's answer carries.
function accountKind(identity: Identity | null | undefined): string {
  if (identity === null || identity === undefined) return "—"
  if (!("source" in identity)) return "Head office"
  switch (identity.source) {
    case "CLOUD":
      return "Head office"
    case "DEVELOPMENT":
      return "Sign-in switched off"
    case "LOCAL":
      return "This shop's own"
    default:
      return label(identity.source)
  }
}
