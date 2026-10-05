import type { ReactNode } from "react"

import { Screen, Section } from "@/components/ui/screen"
import { Banner } from "@/components/ui/states"
import type { RelayAccess } from "@/lib/cloud"
import { useCloudIdentity } from "@/lib/queries/hr"

/// What a screen answered by head office needs before it asks anything: a
/// person this node can relay for.
///
/// There is no head-office sign-in to offer any more — the till's own sign-in
/// is the only one (`lib/cloud.ts`). So the gate has exactly one refusal to
/// explain, in the words that fit why: an emergency account the centre has
/// never heard of, or a node running with sign-in off. Whether head office is
/// *reachable* is not asked here; the node answers every relayed call with a
/// sentence when the line is down, and the screen's own error state says it.
export function CentralGate({
  what,
  children,
}: {
  what: string
  children: ReactNode
}) {
  const session = useCloudIdentity()

  if (session.isPending) {
    return (
      <Screen>
        <Section title="Head office">
          <p className="text-meta text-body">Checking who is signed in…</p>
        </Section>
      </Screen>
    )
  }

  if (session.data === null) {
    return (
      <Screen>
        <RelayRefusal access={session.access} what={what} />
      </Screen>
    )
  }

  return <>{children}</>
}

/// Why this node will not ask head office for the person signed in here.
export function RelayRefusal({
  access,
  what,
}: {
  access: RelayAccess
  what: string
}) {
  return (
    <Banner tone="bad">
      {access === "local"
        ? `${what} needs a head-office account. Sign out and sign in with yours.`
        : access === "development"
          ? `${what} needs a head-office account. Sign-in is off on this server.`
          : `${what} needs a head-office account. Sign in with yours.`}
    </Banner>
  )
}
