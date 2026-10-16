import { useEffect, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { LoginForm } from "@/components/login-form"
import { Button } from "@/components/ui/button"
import { setEdgeToken } from "@/lib/api"
import {
  edgeLocalLogin,
  useEdgeCloudSignIn,
  useDcHosting,
  useEdgeIdentity,
  useEdgeNodeIdentity,
} from "@/lib/edge-session"
import { useIdentity } from "@/lib/session"
import { ApiError } from "@itulah/contract/client"

/// Where the warehouse lives decides whether there is anything to sign in to.
///
/// Run by the cloud (`dc_hosting: "cloud"`), it is the same server as the rest
/// of the hub and the ordinary session already covers it: children render
/// straight away, and no DC ticket is ever asked for. Run on a DC server, the
/// gate below does its work exactly as before. The split is a component and
/// not an early return inside the gate because the gate's hooks and effects
/// are the DC sign-in itself — in cloud mode they must not run at all.
export function OperationsGate({ children }: { children: React.ReactNode }) {
  const hosting = useDcHosting()
  if (hosting === undefined) {
    return (
      <PageContent>
        <p className="text-meta text-body">
          Checking where the warehouse runs…
        </p>
      </PageContent>
    )
  }
  if (hosting === "cloud") return <>{children}</>
  return <EdgeGate>{children}</EdgeGate>
}

/// A page that only means something on a DC server (its outbox, its local
/// account). In cloud mode it says so in one line instead of asking a node
/// that does not exist.
export function edgeOnly(Screen: () => React.ReactNode): () => React.ReactNode {
  return function EdgeOnly() {
    if (useDcHosting() !== "cloud") return <Screen />
    return (
      <PageContent>
        <p className="text-meta text-body">The warehouse runs in the cloud.</p>
      </PageContent>
    )
  }
}

/// Ensure every Operations screen has a local DC session.
///
/// The only path anybody is expected to take exchanges the already
/// authenticated Cloud session for a short-lived DC ticket. The DC then checks
/// its signed local user policy and creates its own session. There is no DC
/// password to know: a lapsed DC session is exchanged again, silently.
///
/// Local credentials remain, one deliberate click away, for recovery when the
/// Cloud link or the person's DC assignment is unavailable.
///
/// It sits in one place rather than in each screen because the alternative is
/// nineteen screens each discovering the 401 for themselves, at different
/// moments, in whatever shape their own error state happens to take.
function EdgeGate({ children }: { children: React.ReactNode }) {
  const cloud = useIdentity()
  const session = useEdgeIdentity()
  const where = useEdgeNodeIdentity()
  const cloudSignIn = useEdgeCloudSignIn()
  const triedAutomaticSignIn = useRef<string | null>(null)
  const hadSession = useRef(false)
  const [recovery, setRecovery] = useState(false)
  const cloudUsername = cloud.data?.username ?? null
  const edgeUsername = session.data?.username ?? null
  const edgeSource =
    session.data && "source" in session.data ? session.data.source : null

  // A Cloud-projected DC session belongs to the Cloud identity in this tab.
  // When somebody explicitly switches Cloud accounts, discard the old DC
  // bearer and exchange the new identity. A LOCAL break-glass session remains
  // an intentional recovery choice.
  useEffect(() => {
    if (
      cloudUsername &&
      edgeUsername &&
      edgeSource === "CLOUD" &&
      cloudUsername.toLowerCase() !== edgeUsername.toLowerCase()
    ) {
      setEdgeToken(null)
      triedAutomaticSignIn.current = null
      void session.refetch()
    }
  }, [cloudUsername, edgeUsername, edgeSource, session.refetch])

  // A DC session ends underneath the screens — thirty idle minutes, a node
  // restart; `main.tsx` drops the token on the first 401. That is not a
  // person asking to sign in again, so the attempt below is allowed to run
  // once more for the same identity and DC. Declared before it on purpose:
  // effects run in order, and the reset has to land first.
  useEffect(() => {
    if (session.data) {
      hadSession.current = true
      return
    }
    if (session.data === null && hadSession.current) {
      hadSession.current = false
      triedAutomaticSignIn.current = null
      setRecovery(false)
    }
  }, [session.data])

  // Open Operations with the Cloud session already active. The attempt is
  // keyed by identity and DC so rendering twice in React Strict Mode cannot
  // consume two one-time tickets.
  useEffect(() => {
    const originId = where.data?.node_id
    if (
      where.data?.auth === "DISABLED" ||
      !cloudUsername ||
      !originId ||
      cloud.isPending ||
      session.isPending ||
      (session.data ?? null) !== null ||
      cloudSignIn.isPending
    ) {
      return
    }
    const key = `${cloudUsername}:${originId}`
    if (triedAutomaticSignIn.current === key) return
    triedAutomaticSignIn.current = key
    cloudSignIn.mutate({ originId })
  }, [
    cloud.data,
    cloud.isPending,
    cloudUsername,
    session.data,
    session.isPending,
    where.data,
    cloudSignIn.isPending,
    cloudSignIn.mutate,
  ])

  // A lapsed session resolves to `null` rather than an error, so anything left
  // here is the node being unreachable — which, for a machine standing in
  // another building on a link that goes down, is a thing to say plainly
  // rather than a login box that will fail again for reasons nobody can see.
  const problem =
    // The one refusal with a known cause and a known fix, said as such
    // rather than as the server's "not found: registered Edge origin".
    cloudSignIn.error instanceof ApiError &&
    cloudSignIn.error.status === 404 &&
    cloudSignIn.error.message.includes("registered Edge origin")
      ? "This warehouse node is not registered with Central yet. Register it under System › Servers, or use a local recovery account."
      : cloudSignIn.error instanceof ApiError
        ? cloudSignIn.error.message
        : cloudSignIn.error !== null
          ? "could not complete automatic warehouse sign-in"
          : session.error === null
            ? null
            : session.error instanceof ApiError
              ? session.error.message
              : "could not reach the warehouse node"

  // A node running with authentication **off** — a bench, a recovery, a bay
  // with no route to the centre — has nobody to sign in as, and its login
  // endpoint has nothing to check. Putting a password box in front of it would
  // lock the hub out of a warehouse that is deliberately open. The node says
  // so itself in `/health`; this believes it rather than guessing from a 401.
  if (where.data?.auth === "DISABLED") return <>{children}</>

  if (session.isPending) {
    return (
      <PageContent>
        <p className="text-meta text-body">Checking the warehouse session…</p>
      </PageContent>
    )
  }

  if ((session.data ?? null) === null) {
    if (cloud.isPending) {
      return (
        <PageContent>
          <p className="text-meta text-body">
            Checking the Central Dashboard session…
          </p>
        </PageContent>
      )
    }
    if (cloudSignIn.isPending) {
      return (
        <PageContent>
          <p className="text-meta text-body">
            Signing you in to the warehouse…
          </p>
        </PageContent>
      )
    }
    if (recovery) {
      return (
        <PageContent>
          <LoginForm
            title="Warehouse recovery"
            caption={`A local account on ${where.data?.site_id ?? where.data?.node_id ?? "the warehouse node"}, for when the Central Dashboard cannot sign you in there.`}
            signIn={edgeLocalLogin}
            onSignedIn={(signedIn) => {
              // The token is what authorises everything after this, and it is
              // stored before anything re-reads the session — see `lib/api.ts`
              // for why the cookie the node also sets is not used.
              setEdgeToken(signedIn.token)
              // Not `setQueryData` from this response: its `user` is a
              // `SessionUser` and `me` answers the wider `EdgeMe`. Writing the
              // narrow shape under the wide key is how `site_id` reads as
              // undefined on a node that has one.
              void session.refetch()
            }}
          />
          <div className="mt-4 flex justify-center">
            <Button variant="quiet" onClick={() => setRecovery(false)}>
              Back to automatic sign-in
            </Button>
          </div>
        </PageContent>
      )
    }

    // Automatic sign-in did not happen, and this says why rather than asking
    // for a password nobody was ever given: the usual causes — no assignment
    // at this DC, a DC that has not yet received the signing key, a node that
    // cannot be reached — are all fixed somewhere other than a login box.
    const retry = () => {
      if (!where.data) {
        void where.refetch()
        return
      }
      cloudSignIn.mutate({ originId: where.data.node_id })
    }
    return (
      <PageContent>
        <div className="grid h-full place-items-center px-6">
          <div className="w-full max-w-[21rem]">
            <h1 className="text-hero font-semibold text-ink">
              Warehouse sign-in
            </h1>
            <p className="mt-1 text-meta text-body">
              {where.data
                ? `Your Central Dashboard account signs you in to ${where.data.site_id ?? where.data.node_id} automatically when you have access there.`
                : "The warehouse node could not be reached."}
            </p>
            {problem && (
              <p className="mt-3.5 text-[0.9375rem] text-bad">{problem}</p>
            )}
            <Button
              variant="primary"
              className="mt-5 h-9 w-full"
              pending={cloudSignIn.isPending}
              disabled={where.isFetching}
              onClick={retry}
            >
              Try again
            </Button>
            <Button
              variant="quiet"
              className="mt-2 h-9 w-full"
              onClick={() => setRecovery(true)}
            >
              Use a local recovery account
            </Button>
          </div>
        </div>
      </PageContent>
    )
  }

  return <>{children}</>
}
