import { useForm } from "@tanstack/react-form"
import { LogOut } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { KeyValue } from "@/components/ui/rows"
import { Banner, Problem } from "@/components/ui/states"
import { setBenchActor, useBenchActor } from "@/lib/bench"
import {
  useActor,
  useChangePassword,
  useIdentity,
  useNodeIdentity,
  useSignOut,
} from "@/lib/session"

/// Who is at this bench, and how they sign out of it.
///
/// Two things live here that an office console would not need:
///
///  - **The bench name.** A DC edge can run with `INVENTORY_AUTH_MODE=disabled`
///    — a bay with no route to the centre, a recovery, a demo. On such a node
///    every write is attributed to the same principal, and receiving then
///    cannot be completed at all: counting and verifying are two people by
///    database constraint, so one name means an accepted count is refused. The
///    browser names the person instead, and an authenticated node ignores it.
///  - **Changing a password ends the session.** The node clears the session
///    and CSRF cookies in the same response, so the login box comes back
///    immediately. Said before it happens, rather than discovered.
export function Account() {
  const identity = useIdentity()
  const where = useNodeIdentity()
  const actor = useActor()
  const signOut = useSignOut()
  const authOff = where.data?.auth === "DISABLED"

  return (
    <PageContent>
      <PageHeader
        crumb="Node"
        title="Account"
        sub="Who this node thinks you are, and what it writes on your work."
      />

      <div className="grid gap-[1.125rem] xl:grid-cols-2 xl:items-start">
        <div className="flex flex-col gap-[1.125rem]">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Signed in</CardTitle>
            </CardHeader>
            <div className="px-4 pt-1 pb-3.5">
              <KeyValue term="Name">
                {identity.data?.display_name ?? "—"}
              </KeyValue>
              <KeyValue term="Username">
                {identity.data?.username ?? "—"}
              </KeyValue>
              <KeyValue term="Role">{identity.data?.role ?? "—"}</KeyValue>
              <KeyValue term="Written on your work">
                <span className="font-mono">{actor}</span>
              </KeyValue>
              <KeyValue term="Node">{where.data?.node_id ?? "—"}</KeyValue>
              <KeyValue term="Site">{where.data?.site_id ?? "—"}</KeyValue>
            </div>
            <div className="border-t border-hairline px-4 py-3">
              <Button
                variant="ghost"
                disabled={signOut.isPending}
                onClick={() => signOut.mutate()}
              >
                <LogOut />
                {signOut.isPending ? "Signing out…" : "Sign out"}
              </Button>
            </div>
          </Card>

          {authOff && <Bench />}
        </div>

        <ChangePassword disabled={authOff} />
      </div>
    </PageContent>
  )
}

/// Naming the person at a bench on a node with sign-in switched off.
function Bench() {
  const bench = useBenchActor()

  const form = useForm({
    defaultValues: { name: bench ?? "" },
    onSubmit: ({ value }) =>
      setBenchActor(value.name.trim() === "" ? null : value.name),
  })

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Who is at this bench</CardTitle>
      </CardHeader>
      <Banner tone="warn" className="mx-4 mt-2">
        Sign-in is switched off on this node, so every write carries the same
        principal. Receiving is two people by database constraint — without a
        name here, a count cannot be accepted at all.
      </Banner>
      <form
        className="flex flex-col gap-3 px-4 py-3.5"
        onSubmit={(event) => {
          event.preventDefault()
          form.handleSubmit()
        }}
      >
        <form.Field name="name">
          {(field) => (
            <Field
              label="Your name"
              hint="Kept on this device, and written into every write this browser makes."
            >
              <Input
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>
        <div className="flex gap-2">
          <Button variant="dark" type="submit">
            Save the name
          </Button>
          {bench !== null && (
            <Button
              variant="quiet"
              onClick={() => {
                setBenchActor(null)
                form.setFieldValue("name", "")
              }}
            >
              Clear it
            </Button>
          )}
        </div>
      </form>
    </Card>
  )
}

function ChangePassword({ disabled }: { disabled: boolean }) {
  const change = useChangePassword()
  const [mismatch, setMismatch] = useState(false)

  const form = useForm({
    defaultValues: { current: "", next: "", again: "" },
    onSubmit: ({ value }) => {
      if (value.next !== value.again) {
        setMismatch(true)
        return
      }
      setMismatch(false)
      change.mutate({ current: value.current, next: value.next })
    },
  })

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Change your password</CardTitle>
      </CardHeader>

      {disabled ? (
        <div className="px-4 py-3.5">
          <Banner tone="info">
            This node runs with sign-in switched off, so there is no password to
            change.
          </Banner>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3 px-4 py-3.5"
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
        >
          <Banner tone="warn">
            Changing it signs you out of this bench straight away — the node
            clears the session in the same response. Have the new one ready.
          </Banner>

          <form.Field name="current">
            {(field) => (
              <Field label="Current password">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="next">
            {(field) => (
              <Field label="New password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="again">
            {(field) => (
              <Field
                label="New password again"
                problem={mismatch ? "These two do not match." : undefined}
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={field.state.value}
                  onChange={(event) => {
                    setMismatch(false)
                    field.handleChange(event.target.value)
                  }}
                />
              </Field>
            )}
          </form.Field>

          <Problem error={change.error} />

          <Button variant="dark" type="submit" disabled={change.isPending}>
            {change.isPending ? "Changing…" : "Change it and sign out"}
          </Button>
        </form>
      )}
    </Card>
  )
}
