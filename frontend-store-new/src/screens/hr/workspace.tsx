import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Building2, LogOut } from "lucide-react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { Screen } from "@/components/ui/screen"
import { Banner } from "@/components/ui/states"
import { CENTRAL_KEY_PREFIX, cloudAuth, setCloudToken } from "@/lib/cloud"
import { hrItems } from "@/lib/navigation"
import {
  useCentreNode,
  useCloudIdentity,
  useReach,
  type StoreScope,
} from "@/lib/queries/hr"
import { useNodeIdentity } from "@/lib/session"
import { centreState, describeCentre } from "@/screens/hr/centre"

/// Everything an HR screen needs settled before it may ask head office
/// anything: which shop this is, whether the centre can be reached, whether
/// this browser holds a head-office session, and whether that session is
/// actually allowed to see this shop.
///
/// It sits in one place rather than in each screen because the alternative is
/// five screens each discovering the same 401 for themselves, at different
/// moments, in whatever shape their own error state happens to take.
///
/// # Two sessions, and only one of them is the till's
///
/// Being signed in at this counter is not being signed in at head office. The
/// centre keeps its operators in Postgres and this shop's Edge keeps its own —
/// including the break-glass accounts that exist precisely so a counter can
/// sell when it cannot reach the centre. So a second password here is not an
/// oversight; it is the same separation that makes a shop survivable on its
/// own, seen from the other end. See `lib/cloud.ts` for why the second session
/// cannot be a cookie.
///
/// # The scope is the node's, and there is no picker
///
/// The shop is read from this till's own `site_id` and nothing on this surface
/// can change it. A store manager has one shop; a unit picker on a till would
/// be a control whose only use is to look at somebody else's.
export function HrWorkspace({
  children,
}: {
  children: (scope: StoreScope) => React.ReactNode
}) {
  const where = useNodeIdentity()
  const centre = useCentreNode()
  const session = useCloudIdentity()

  const site = where.data?.site_id ?? null
  // A centre running with authentication off — a laptop rig, a bench — has
  // nobody to sign in as and its login endpoint has nothing to check. It says
  // so itself in `/health`, and believing it beats putting a password box in
  // front of a node that would accept anything.
  const open = centre.data?.auth === "DISABLED"
  const signedIn = (session.data ?? null) !== null
  const reach = useReach(site !== null && (open || signedIn))

  /// The gate, in the order the questions have to be asked. Written as one
  /// function rather than a chain of early returns in the component body
  /// because the strip above is drawn in every one of these states: a person
  /// who cannot read the rota can still move to Team, and a module whose
  /// navigation disappears with its content is a module somebody leaves.
  function body(): React.ReactNode {
    if (where.isPending || centre.isPending) {
      return <Waiting>Finding head office…</Waiting>
    }

    // A till that cannot say where it is standing cannot be scoped to a shop,
    // and every read below would have to guess at one. The Stock screen has
    // the same dependency and the same answer: say so, and stop.
    if (site === null) {
      return (
        <Banner tone="bad">
          This till has not been told which shop it is standing in, so there is
          no place to ask head office about. The node reports no
          <code className="px-1 font-mono">site_id</code>; that is a setting on
          the machine behind the counter, not something this screen can choose.
        </Banner>
      )
    }

    // `useCentreNode` swallows the failure into `null`, so there is no error
    // object to quote — `describeCentre` on nothing is exactly the sentence
    // for a line that is down.
    if (centre.data === null) {
      return <Banner tone="bad">{describeCentre(null)}</Banner>
    }

    if (!open) {
      if (session.isPending) {
        return <Waiting>Checking the head-office session…</Waiting>
      }
      if (!signedIn) return <CentreSignIn site={site} error={session.error} />
    }

    return centreState(reach, {
      loading: "Asking head office what this sign-in may see…",
      render: (view) => {
        // A session with no posting behind it reaches nothing at all — a
        // machine account, or a login HR has not finished the paperwork for.
        // Every read below would be refused, so the refusal is stated once
        // here instead of five times in five different words.
        if (view.scope === "NOWHERE") {
          return (
            <Banner tone="bad">
              This head-office sign-in has no employment record behind it, so
              head office will not say whose rota is theirs — the account is
              nobody's, which is what a machine login looks like and also what a
              login issued before HR finished the paperwork looks like. Somebody
              has to be posted to a place before they can read one.
            </Banner>
          )
        }

        // Posted to a different shop. Not a warning: every read would be
        // refused with "is not posted anywhere that reaches …", and offering
        // the screens anyway would be offering five ways to see that sentence.
        if (view.scope === "ONE_PLACE" && view.place_id !== site) {
          return (
            <Banner tone="bad">
              This head-office sign-in is posted to{" "}
              <b className="font-semibold">
                {view.place_name ?? view.place_id}
              </b>
              , and this till is standing in{" "}
              <b className="font-semibold">{site}</b>. Head office refuses one
              shop's rota to another shop's manager, which is the rule working
              rather than a fault. Sign in with this shop's own account.
            </Banner>
          )
        }

        const scope: StoreScope = {
          id: site,
          label: view.place_id === site ? (view.place_name ?? site) : site,
        }

        return (
          <>
            <ScopeLine scope={scope} who={session.data?.username ?? null} />
            {view.scope === "EVERYWHERE" && (
              <Banner tone="warn" className="mb-4">
                This head-office sign-in reaches every place, not only this
                shop. These screens still ask about{" "}
                <b className="font-semibold">{scope.id}</b> and nothing else —
                but two of the queues take no place at all and are narrowed here
                rather than at the centre, so they say how many rows they
                dropped.
              </Banner>
            )}
            {children(scope)}
          </>
        )
      },
    })
  }

  return (
    <Screen foot="none">
      <HrStrip />
      {body()}
    </Screen>
  )
}

/// The module's own navigation, below `md` only.
///
/// This app draws exactly one navigation at every width: the floating
/// squircles on a phone, the column on a counter monitor. An HR screen is a
/// *pushed* screen, and a pushed screen hides the squircles — so on a phone
/// there is nothing, and this is it. Above `md` the column is already showing
/// these same five rows, and a second copy of them would be the duplication
/// that rule exists to prevent.
function HrStrip() {
  return (
    <nav
      aria-label="People"
      className="-mx-4 mb-4 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-4 py-1 md:hidden [&::-webkit-scrollbar]:hidden"
    >
      {hrItems.map((item) => {
        const Icon = item.icon
        return (
          <AppLink
            key={item.path}
            to={item.path}
            className="flex h-11 shrink-0 items-center gap-2 rounded-inner border border-hairline bg-canvas px-3.5 text-nav font-medium text-body shadow-soft data-[status=active]:border-accent/30 data-[status=active]:bg-accent-bg data-[status=active]:font-semibold data-[status=active]:text-accent"
          >
            <Icon className="size-[1.0625rem] shrink-0 stroke-[1.55]" />
            {item.label}
          </AppLink>
        )
      })}
    </nav>
  )
}

/// Whose numbers these are, and where they came from.
///
/// Every other screen in this app is answered by the machine in the next room,
/// so none of them has to say which machine. These do: a rota is not a fact
/// about this shop's node, and somebody reading one is entitled to know they
/// are looking at the centre — which is also why "head office is not
/// reachable" has to be a sentence this module can say.
function ScopeLine({ scope, who }: { scope: StoreScope; who: string | null }) {
  const client = useQueryClient()
  return (
    <div className="mb-4 flex items-center gap-2.5 rounded-card border border-hairline bg-soft px-3.5 py-2.5">
      <Building2 className="size-[1.0625rem] shrink-0 stroke-[1.55] text-line-ico" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-cell font-medium text-ink">
          {scope.label}
        </div>
        <div className="truncate text-meta text-mute">
          Head office{who === null ? "" : ` · ${who}`}
        </div>
      </div>
      {who !== null && (
        <Button
          variant="quiet"
          size="icon"
          aria-label="Sign out of head office"
          onClick={() => {
            setCloudToken(null)
            // Everything fetched under that session, and nothing else. The
            // cashier is still signed in at the counter and must not watch the
            // till reload around them.
            client.removeQueries({ queryKey: [CENTRAL_KEY_PREFIX] })
          }}
        >
          <LogOut />
        </Button>
      )}
    </div>
  )
}

function Waiting({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[28em] px-4 py-12 text-center">
      <p className="text-meta text-body">{children}</p>
    </div>
  )
}

/// Head office's own sign-in, in front of every HR screen.
///
/// **Never displays, stores or logs the password.** There is no reveal control
/// — the till's own login box has one because a cashier types a password at
/// arm's length on a counter tablet, and this box is typed once a day by one
/// person who is standing over it.
function CentreSignIn({ site, error }: { site: string; error: unknown }) {
  const client = useQueryClient()

  const signIn = useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      cloudAuth.login(credentials.username, credentials.password),
    onSuccess: (response) => {
      // The token authorises everything after this, and it is set before
      // anything re-reads the session: nothing may observe a signed-in
      // identity through a client that is not yet carrying it.
      setCloudToken(response.token)
      client.invalidateQueries({ queryKey: [CENTRAL_KEY_PREFIX] })
    },
  })

  const form = useForm({
    defaultValues: { username: "", password: "" },
    onSubmit: ({ value }) => signIn.mutate(value),
  })

  // A lapsed session resolves to `null` rather than throwing, so anything left
  // in `error` is the centre refusing or the line being down — worth saying
  // above the box, because a bare box would fail again for a cause nobody
  // watching could see. This attempt's own failure wins over the session's:
  // it is the newer answer and the one the person just caused.
  const failure = signIn.error ?? error
  const problem = failure === null ? null : describeCentre(failure)

  return (
    <Card className="p-4">
      <h2 className="text-card-title font-semibold text-ink">Head office</h2>
      <p className="mt-1 mb-4 text-meta text-body">
        The rota, leave and the month's close are held at the centre — this
        shop's node has none of them. Signing in here does not touch the counter
        session, and it ends when this tab is reloaded.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          form.handleSubmit()
        }}
        className="flex flex-col gap-4"
      >
        <form.Field name="username">
          {(field) => (
            <Field label="Username">
              <Input
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="password">
          {(field) => (
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>
        {problem !== null && <p className="text-meta text-bad">{problem}</p>}
        <Button
          variant="primary"
          size="lg"
          block
          type="submit"
          disabled={signIn.isPending}
        >
          {signIn.isPending ? "Signing in…" : "Sign in to head office"}
        </Button>
      </form>
      <p className="mt-4 text-center font-mono text-meta text-mute">{site}</p>
    </Card>
  )
}
