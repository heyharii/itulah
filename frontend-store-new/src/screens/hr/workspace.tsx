import { useRouterState } from "@tanstack/react-router"
import { Building2 } from "lucide-react"
import { useEffect, useRef } from "react"

import { RelayRefusal } from "@/components/central-gate"
import { AppLink } from "@/components/ui/app-link"
import { Screen } from "@/components/ui/screen"
import { Banner } from "@/components/ui/states"
import { hrItems } from "@/lib/navigation"
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
/// The shop is read from this till's own `site_id` and nothing on this surface
/// can change it. A store manager has one shop; a unit picker on a till would
/// be a control whose only use is to look at somebody else's.
///
/// # The page header is the screen's, drawn here
///
/// Each screen names what it is for (`sub`, the prototype's lead sentence) and
/// its one primary act (`actions` — "Record a fix", "Order overtime"). They are
/// passed in rather than drawn by the screen because the header belongs to
/// `Screen`, which this gate owns — and the actions are only drawn once the
/// gate is open: a "Record a claim" button in front of a sign-in box is a
/// button that can only fail.
export function HrWorkspace({
  sub,
  actions,
  children,
}: {
  sub?: React.ReactNode
  actions?: React.ReactNode
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
    view !== undefined &&
    view.scope !== "NOWHERE" &&
    !(view.scope === "ONE_UNIT" && view.unit_id !== site)
      ? {
          id: site,
          label: view.unit_id === site ? (view.unit_name ?? site) : site,
        }
      : null

  /// The gate, in the order the questions have to be asked. Written as one
  /// function rather than a chain of early returns in the component body
  /// because the strip above is drawn in every one of these states: a person
  /// who cannot read the rota can still move to Team, and a module whose
  /// navigation disappears with its content is a module somebody leaves.
  function body(): React.ReactNode {
    if (where.isPending || session.isPending) {
      return <Waiting>Checking who is signed in…</Waiting>
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

    if (!signedIn) {
      return (
        <RelayRefusal
          access={session.access}
          what="People — the rota, leave and the month's close —"
        />
      )
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
              This account has no employment record behind it at head office, so
              head office will not say whose rota is whose — the account is
              nobody's, which is what a login issued before HR finished the
              paperwork looks like, or one posted to a different shop. Somebody
              has to be posted to this shop before they can read it.
            </Banner>
          )
        }

        // Posted to a different shop. Not a warning: every read would be
        // refused with "is not posted anywhere that reaches …", and offering
        // the screens anyway would be offering five ways to see that sentence.
        if (view.scope === "ONE_UNIT" && view.unit_id !== site) {
          return (
            <Banner tone="bad">
              This account is posted to{" "}
              <b className="font-semibold">
                {view.unit_name ?? view.unit_id}
              </b>
              , and this till is standing in{" "}
              <b className="font-semibold">{site}</b>. Head office refuses one
              shop's rota to another shop's manager, which is the rule working
              rather than a fault. Sign in with this shop's own account.
            </Banner>
          )
        }

        // Every refusal above has been ruled out, so `scope` is set; the
        // fallback only keeps the type honest.
        const here: StoreScope = scope ?? { id: site, label: site }

        return (
          <>
            <ScopeLine scope={here} who={session.data?.username ?? null} />
            {children(here)}
          </>
        )
      },
    })
  }

  const ready = scope !== null && actions !== undefined

  return (
    <Screen foot="none" sub={sub} actions={ready ? actions : undefined}>
      <HrStrip />
      {/* The header is desk-only, so on a phone the primary act would have
          nowhere to stand. It stands here instead, under the strip. */}
      {ready && (
        <div className="mb-4 flex flex-wrap gap-2 md:hidden [&>*]:flex-1">
          {actions}
        </div>
      )}
      {body()}
    </Screen>
  )
}

/// The module's own navigation, below `md` only.
///
/// This app draws exactly one navigation at every width: the floating
/// squircles on a phone, the column on a counter monitor. An HR screen is a
/// *pushed* screen, and a pushed screen hides the squircles — so on a phone
/// there is nothing, and this is it. Above `md` the sidebar is already showing
/// these same fourteen rows, and a second copy of them would be the
/// duplication that rule exists to prevent. It scrolls sideways, and the
/// current screen is the tinted one.
function HrStrip() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const strip = useRef<HTMLElement>(null)
  // Fourteen chips do not fit a phone, so the current one is brought into
  // view — otherwise opening Training lands on a strip that starts at
  // Overview and shows nothing of where you are.
  useEffect(() => {
    const active = strip.current?.querySelector<HTMLElement>(
      "[data-status=active]",
    )
    active?.scrollIntoView({ block: "nearest", inline: "center" })
  }, [pathname])
  return (
    <nav
      ref={strip}
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
