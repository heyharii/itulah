import { PageContent } from "@/components/shell/app-shell"
import { LoginForm } from "@/components/login-form"
import { edgeAuth, setEdgeToken } from "@/lib/api"
import { useEdgeIdentity, useEdgeNodeIdentity } from "@/lib/edge-session"
import { ApiError } from "@itulah/contract/client"

/// The warehouse's own sign-in, in front of every Operations screen.
///
/// Being signed in to the hub is not being signed in to a DC. The centre keeps
/// its operators in Postgres; an edge node keeps its own — including the
/// break-glass accounts that exist precisely so a warehouse can work when it
/// cannot reach the centre. So a second password is not an oversight here, it
/// is the thing that makes a DC survivable on its own.
///
/// It sits in one place rather than in each screen because the alternative is
/// nineteen screens each discovering the 401 for themselves, at different
/// moments, in whatever shape their own error state happens to take.
export function OperationsGate({ children }: { children: React.ReactNode }) {
  const session = useEdgeIdentity()
  const where = useEdgeNodeIdentity()

  // A lapsed session resolves to `null` rather than an error, so anything left
  // here is the node being unreachable — which, for a machine standing in
  // another building on a link that goes down, is a thing to say plainly
  // rather than a login box that will fail again for reasons nobody can see.
  const problem =
    session.error === null
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
    return (
      <PageContent>
        <LoginForm
          title="Warehouse node"
          caption={
            where.data
              ? `Sign in to ${where.data.site_id ?? where.data.node_id}. This is a separate account from your Cloud Hub sign-in.`
              : "Sign in to the DC node. This is a separate account from your Cloud Hub sign-in."
          }
          problem={problem}
          node={where.data ?? null}
          signIn={(username, password) => edgeAuth.login(username, password)}
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
      </PageContent>
    )
  }

  return <>{children}</>
}
