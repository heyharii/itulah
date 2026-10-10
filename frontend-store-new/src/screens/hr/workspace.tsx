import { Plus, type LucideIcon } from "lucide-react"

import { RelayRefusal } from "@/components/central-gate"
import { Button } from "@/components/ui/button"
import { Fab } from "@/components/ui/fab"
import { Screen } from "@/components/ui/screen"
import { Banner, LoadingState } from "@/components/ui/states"
import { useCloudIdentity, useReach, type StoreScope } from "@/lib/queries/hr"
import { useNodeIdentity } from "@/lib/session"
import { centreState } from "@/screens/hr/centre"

/// Everything an HR screen needs settled before it may ask head office
/// anything: which shop this is, whether the person signed in here is one this
/// node can relay for, and what head office says that person may see.
///
/// It sits in one place rather than in each screen because the alternative is
/// five screens each discovering the same 401 for themselves, at different
/// moments, in whatever shape their own error state happens to take.
///
/// # One sign-in, relayed
///
/// The till's own sign-in is the only one. This shop's node relays HR calls to
/// head office for whoever is signed in (`lib/cloud.ts`), and head office cuts
/// every answer down to this node's place. What this gate still has to refuse
/// is a person the node cannot relay for — the shop's emergency account, or a
/// node with sign-in off — and a head-office account whose posting does not
/// reach this shop.
///
/// # The scope is the node's, and there is no picker
///
/// This till's `site_id` identifies its premises; the cloud relay resolves the
/// site's owning unit and returns it as `ReachView.unit_id`. HR calls use that
/// authoritative unit. A manager posted elsewhere receives `NOWHERE` after
/// the relay bounds reach to the till's unit.
///
/// # The one primary act
///
/// A screen names the one thing it makes (`primary` — "New leave request",
/// "New overtime order"): a filled button in the desk's page header and, on a
/// phone, the round "+" in the dock over the bottom bar (`Fab`) — never a
/// button at the top of the page. It is only drawn once the gate is open: a
/// "New claim" button in front of a sign-in box is a button that can only
/// fail.
///
/// # Moving between People's screens
///
/// There is no strip of fourteen chips any more (a phone does not scroll
/// sideways). The module's screens are rows of the navigation drawer — More,
/// with People opened beneath its row — and, on a desk, of the panel beside the
/// page.
export function HrWorkspace({
  primary,
  children,
}: {
  /// The one thing this screen makes. `label` is the entry point's own words:
  /// "New {thing}".
  primary?: {
    label: string
    onClick: () => void
    icon?: LucideIcon
  }
  children: (scope: StoreScope) => React.ReactNode
}) {
  const where = useNodeIdentity()
  const session = useCloudIdentity()

  const site = where.data?.site_id ?? null
  const signedIn = session.data !== null
  const reach = useReach(site !== null && signedIn)

  // The shop these screens are about, once every question below has been
  // answered yes — worked out here as well as inside `body()` because the
  // header's actions need it and the header is drawn outside the body.
  const view = reach.data
  const scope: StoreScope | null =
    site !== null &&
    signedIn &&
    view?.scope === "ONE_UNIT" &&
    view.unit_id !== null
      ? {
          unit_id: view.unit_id,
          label: view.unit_name ?? view.unit_id,
        }
      : null

  /// The gate, in the order the questions have to be asked. Written as one
  /// function rather than a chain of early returns in the component body
  /// because the page's frame (its title, the dock's act) is drawn in every one
  /// of these states: a person who cannot read the rota can still move to
  /// Team, and a module whose navigation disappears with its content is a
  /// module somebody leaves.
  function body(): React.ReactNode {
    if (where.isPending || session.isPending) {
      return <LoadingState>Checking who is signed in…</LoadingState>
    }

    // A till that cannot say where it is standing cannot be scoped to a shop,
    // and every read below would have to guess at one. The Stock screen has
    // the same dependency and the same answer: say so, and stop.
    if (site === null) {
      return (
        <Banner tone="bad">
          This server has no shop set (
          <code className="font-mono">site_id</code>).
        </Banner>
      )
    }

    if (!signedIn) {
      return <RelayRefusal access={session.access} what="People" />
    }

    return centreState(reach, {
      loading: "Checking access…",
      render: (view) => {
        // A session with no posting behind it reaches nothing at all — a
        // machine account, or a login HR has not finished the paperwork for.
        // Every read below would be refused, so the refusal is stated once
        // here instead of five times in five different words.
        if (view.scope === "NOWHERE") {
          return (
            <Banner tone="bad">This account is not posted to this shop.</Banner>
          )
        }

        // A store HR call must be bounded to exactly one unit. The till's site
        // id names premises and cannot be compared with this unit id; a missing
        // or unbounded relay response is still refused.
        if (view.scope !== "ONE_UNIT" || view.unit_id === null) {
          return (
            <Banner tone="bad">This account is not limited to one shop.</Banner>
          )
        }

        // Every refusal above has been ruled out, so `scope` is set; the
        // fallback only keeps the type honest.
        const here: StoreScope = scope ?? {
          unit_id: view.unit_id,
          label: view.unit_name ?? view.unit_id,
        }

        return (
          <>
            <ScopeLine scope={here} />
            {children(here)}
          </>
        )
      },
    })
  }

  const ready = scope !== null && primary !== undefined
  const Icon = primary?.icon ?? Plus

  return (
    <Screen
      actions={
        ready ? (
          <Button variant="primary" onClick={primary.onClick}>
            <Icon />
            {primary.label}
          </Button>
        ) : undefined
      }
    >
      {/* The phone's one act: the dock's round "+", where the thumb is. */}
      {ready && (
        <Fab label={primary.label} icon={Icon} onClick={primary.onClick} />
      )}
      {body()}
    </Screen>
  )
}

/// Whose numbers these are, and where they came from — one quiet line.
///
/// Every other screen in this app is answered by the machine in the next room,
/// so none of them has to say which machine. These do: a rota is not a fact
/// about this shop's node, and somebody reading one is entitled to know they
/// are looking at the centre — which is also why "head office is not
/// reachable" has to be a sentence this module can say.
function ScopeLine({ scope }: { scope: StoreScope }) {
  return (
    <p className="mb-3 truncate text-meta text-mute">
      {scope.label} · from head office
    </p>
  )
}
