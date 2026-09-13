import { Building2 } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Screen, Section } from "@/components/ui/screen"
import { useGo } from "@/lib/go"
import { useCentreNode, useCloudIdentity } from "@/lib/queries/hr"

/// Settled before a shop screen may ask head office anything: is the centre
/// reachable, is it even running with authentication on, and does this browser
/// hold a head-office session.
///
/// # Why this borrows HR's hooks instead of asking for itself
///
/// Because HR asked first and asked better. `useCentreNode` knows that a
/// centre running with auth **DISABLED** — a bench, a laptop rig — has nobody
/// to sign in as, and `useCloudIdentity` knows that no token means "not signed
/// in" rather than "ask and collect a 401 on every boot". A second
/// implementation of those two facts would be a second place they are decided,
/// and the screen would look right while being wrong.
///
/// # And why there is no password box here
///
/// There is exactly one head-office sign-in in this app, and it belongs to the
/// module that built it. Two boxes would be two places a password is typed and
/// two places it could be got wrong. When the shell grows a proper central
/// session strip, both this and HR's should move to it.
export function CentralGate({
  what,
  children,
}: {
  /// What the screen behind this gate shows, in a few words — it goes into the
  /// sentence explaining why a second sign-in is being asked for.
  what: string
  children: ReactNode
}) {
  const go = useGo()
  const centre = useCentreNode()
  const session = useCloudIdentity()

  if (centre.isPending || session.isPending) {
    return (
      <Screen>
        <Section title="Head office">
          <p className="text-meta text-body">Asking head office…</p>
        </Section>
      </Screen>
    )
  }

  // Unreachable is a fact about the line, not a reason for a password box.
  if (centre.data === null || centre.data === undefined) {
    return (
      <Screen>
        <Section title="Head office">
          <p className="text-meta text-body">
            {what} is kept at head office, and this till cannot reach it right
            now. Selling is unaffected — the counter runs on its own node.
          </p>
        </Section>
      </Screen>
    )
  }

  const open = centre.data.auth === "DISABLED"
  if (open || session.data !== null) return <>{children}</>

  return (
    <Screen>
      <Section title="Head office">
        <p className="mb-3 text-meta text-body">
          {what} is kept at head office, so it needs a head-office login — not
          the one that opens the till. Sign in from Today, and this list will be
          here when you come back.
        </p>
        <Button variant="primary" onClick={() => go("/hr/today")}>
          <Building2 />
          Sign in to head office
        </Button>
      </Section>
    </Screen>
  )
}
