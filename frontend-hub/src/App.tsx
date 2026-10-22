import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import type { LinkProps } from "@tanstack/react-router"
import { useRouter } from "@tanstack/react-router"
import { Suspense, lazy, useEffect, useRef, useState } from "react"

import { AppShell } from "@/components/shell/app-shell"
import { BusinessChooser, BusinessEyebrow } from "@/components/business-door"
import { BootSkeleton } from "@/components/boot-skeleton"
import { LoginForm } from "@/components/login-form"
import { SignInDoor } from "@/components/sign-in-door"
import { Toasts } from "@/components/ui/toast"
import { cacheKey } from "@/lib/api"
import { onWorkerMessage } from "@/lib/pwa"
import { startPersistence } from "@/lib/query-persist"
import { afterStreamedHydration } from "@/lib/use-mounted"
import { setupKeys, useSetupStatus } from "@/lib/queries/setup"
import {
  clearSignedOutElsewhere,
  signedOutElsewhere,
  useIdentity,
} from "@/lib/session"
import { selectBusiness, useTenancy } from "@/lib/tenancy"
import { deferSetup, useSetupDeferred } from "@/screens/setup/defer"
import { ApiError, type Identity } from "@itulah/contract/client"

/// The invitation screen, for the one URL that reaches it: fetched when such
/// a link is opened rather than carried by every visit.
const JoinPage = lazy(() =>
  import("@/screens/join/join-page").then((module) => ({
    default: module.JoinPage,
  }))
)

/// `/join/{token}` out of the address bar, once, at mount — the invited
/// person's own link, and the one URL this app answers before it has asked
/// anybody to sign in.
/// Read from the router's location rather than `window`, so the server
/// renders the same page the browser will hydrate.
function joinTokenFromLocation(pathname: string): string | null {
  const match = /^\/join\/([^/?#]+)/.exec(pathname)
  return match ? decodeURIComponent(match[1]) : null
}

/// `?business=<slug>` out of the address bar, once, at mount — a link shared
/// so a teammate lands straight on the right business's door on a sandbox
/// server. `null` on any server that was never given one; nothing below acts
/// on it unless tenancy also turns out to be `"sandbox"`.
function businessSlugFromLocation(searchStr: string): string | null {
  return new URLSearchParams(searchStr).get("business")
}

/// Removes `?business=` from the address bar without a reload or a history
/// entry — the same courtesy `JoinPage.onAccepted` pays `/join/{token}`.
function stripBusinessParam() {
  const url = new URL(window.location.href)
  url.searchParams.delete("business")
  window.history.replaceState(
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`
  )
}

/// `/n/{token}` out of the address bar, once, at mount — the page a Surat Jalan
/// Retur's QR opens. Public like the join link: no session is asked for.
function noteTokenFromLocation(pathname: string): string | null {
  const match = /^\/n\/([^/?#]+)/.exec(pathname)
  return match ? decodeURIComponent(match[1]) : null
}

/// `/p/{token}` out of the address bar, once, at mount — the page a printed
/// PO's QR opens (0971). Public, as the surat jalan's.
function orderTokenFromLocation(pathname: string): string | null {
  const match = /^\/p\/([^/?#]+)/.exec(pathname)
  return match ? decodeURIComponent(match[1]) : null
}

/// A printed PO's public page, fetched only by whoever scans one.
const PurchaseOrderPage = lazy(() =>
  import("@/screens/public/purchase-order-page").then((module) => ({
    default: module.PurchaseOrderPage,
  }))
)

/// The surat jalan's public page, fetched only by whoever scans one.
const ReturnNotePage = lazy(() =>
  import("@/screens/public/return-note-page").then((module) => ({
    default: module.ReturnNotePage,
  }))
)

/// Fetched only when a company has not finished setting up, which is once.
const Onboarding = lazy(() =>
  import("@/screens/setup/onboarding").then((module) => ({
    default: module.Onboarding,
  }))
)

export function App() {
  const queryClient = useQueryClient()
  const router = useRouter()

  // The device's stored cache is read in once the whole page is hydrated —
  // the shell AND every section streamed in after it — not before: a stored
  // answer landing ahead of a section's hydration would draw what the server
  // drew as loading, and the server's answers are newer anyway.
  useEffect(
    () => afterStreamedHydration(() => startPersistence(queryClient)),
    [queryClient]
  )

  // An invited person's own link, outside the signed-in shell entirely and
  // checked before anything else below asks whether somebody is signed in —
  // a person setting their password for the first time has no session for
  // that question to be about. Read once, at mount: after acceptance this is
  // set back to `null` and the address bar is corrected to `/` without a
  // reload, the way `LoginForm.onSignedIn` hands off into the ordinary app.
  const [joinToken, setJoinToken] = useState(() =>
    joinTokenFromLocation(router.state.location.pathname)
  )

  // Three states, not two. While the session query is pending nobody has been
  // asked anything: showing a login box during that moment makes an
  // already-signed-in operator type their password for nothing.
  const session = useIdentity()

  // Whether this server is a sandbox hosting many businesses at all. `single`
  // on every production deployment — the default this app has always had —
  // so nothing below changes what a normal sign-in looks like.
  const tenancy = useTenancy()

  // A shared `?business=<slug>` link, handled once tenancy is known to be a
  // sandbox: select it, drop whatever session that might have ended, and
  // clean the address bar. `linkSlug` is read once at mount, the way
  // `joinToken` is, and `handled` stops the effect from selecting twice under
  // strict mode's double-invoke.
  // A surat jalan's page names its own business to the API (`?business=`), and
  // must not select it for this browser: the person scanning it may be signed
  // in to another business in the same browser.
  const [noteToken] = useState(() =>
    noteTokenFromLocation(router.state.location.pathname)
  )
  const [orderToken] = useState(() =>
    orderTokenFromLocation(router.state.location.pathname)
  )
  const [linkSlug] = useState(() =>
    noteToken === null && orderToken === null
      ? businessSlugFromLocation(router.state.location.searchStr)
      : null
  )
  const [resolvingLink, setResolvingLink] = useState(linkSlug !== null)
  const linkHandled = useRef(false)
  useEffect(() => {
    if (linkSlug === null || linkHandled.current || tenancy.isPending) return
    linkHandled.current = true
    if (tenancy.mode !== "sandbox") {
      // A normal server has no businesses to select — the parameter is left
      // for whatever route reads it, if any, and the door behaves as today.
      setResolvingLink(false)
      return
    }
    selectBusiness(linkSlug)
      // A stale or mistyped code: fall through to the ordinary chooser
      // rather than stopping the app from loading at all.
      .catch(() => undefined)
      .finally(() => {
        stripBusinessParam()
        queryClient.setQueryData<Identity | null>(cacheKey.me(), null)
        void tenancy.refresh().then(() => setResolvingLink(false))
      })
  }, [linkSlug, tenancy.isPending, tenancy.mode, tenancy.refresh, queryClient])

  // Whether the company has been set up at all. Asked once there is somebody
  // signed in, and only answered for whoever may set it up: anybody else, or
  // a server that predates the endpoint, gets an error here and simply the
  // app — the wizard is never what stands between a cashier and their work.
  const signedIn = (session.data ?? null) !== null
  const setup = useSetupStatus(signedIn)
  const deferred = useSetupDeferred()

  // The landing screen starts moving the moment the session is known, not
  // when the router first mounts it: its chunk and its first data are in
  // flight while the sign-in handoff is still on screen, so the first
  // navigation is a paint rather than a wait (owner, 2026-10-10: "loading
  // hanya kalau terpaksa"). It yields to the same quiet rules as every other
  // prefetch — `prefetchRoute` is fire-and-forget and the loader of the real
  // navigation re-asks with the right search anyway.
  const preloadedLanding = useRef(false)
  useEffect(() => {
    if (!signedIn || preloadedLanding.current) return
    preloadedLanding.current = true
    void import("@/lib/navigation")
      .then((nav) =>
        router.preloadRoute({ to: nav.landingPath as LinkProps["to"] })
      )
      .catch(() => {})
  }, [signedIn, router])

  // A notification tapped while the app is open: the worker hands over where
  // it leads and the router goes there, rather than the worker reloading the
  // page out from under whatever was on screen (`src/sw.ts`).
  useEffect(
    () =>
      onWorkerMessage((message) => {
        if (message.type === "open" && message.url?.startsWith("/")) {
          void router.navigate({ href: message.url })
        }
      }),
    [router]
  )

  // A lapsed session resolves to `null` rather than an error, so anything left
  // here is the node being unreachable or refusing for some other reason. A
  // bare login box would fail again for a cause nobody watching could see.
  const problem =
    session.error === null
      ? null
      : session.error instanceof ApiError
        ? session.error.message
        : "could not reach the server"

  // A printed PO's own link: public, read-only, outside the shell entirely.
  if (orderToken !== null) {
    return (
      <Suspense fallback={null}>
        <PurchaseOrderPage token={orderToken} />
      </Suspense>
    )
  }

  // A surat jalan's own link: public, read-only, outside the shell entirely.
  if (noteToken !== null) {
    return (
      <Suspense fallback={null}>
        <ReturnNotePage token={noteToken} />
      </Suspense>
    )
  }

  // A join link from a sandbox server carries its business; the invitation
  // lives in that business, so it is chosen before the page asks about it.
  if (joinToken !== null && !resolvingLink) {
    return (
      <>
        <JoinPage
          token={joinToken}
          onAccepted={(me) => {
            // The response already carries who the server just signed in as —
            // writing it is what clears the login box on an ordinary sign-in
            // too, and re-asking `/auth/me` here would be a request the
            // browser has no fresher cookie to answer differently.
            queryClient.setQueryData<Identity | null>(cacheKey.me(), me)
            window.history.replaceState(null, "", "/")
            setJoinToken(null)
          }}
        />
        <Toasts />
      </>
    )
  }

  if (session.isPending || tenancy.isPending || resolvingLink) {
    return <BootSkeleton />
  }

  if ((session.data ?? null) === null) {
    // Sandbox, nobody has chosen a business yet: the door is a chooser rather
    // than a form — there is no account to sign in to until one is picked.
    if (tenancy.mode === "sandbox" && tenancy.business === null) {
      return (
        <SignInDoor>
          <BusinessChooser
            inviteRequired={tenancy.inviteRequired}
            onSelected={() => void tenancy.refresh()}
            onCreated={(signedIn) => {
              clearSignedOutElsewhere()
              queryClient.setQueryData<Identity | null>(
                cacheKey.me(),
                signedIn.user as Identity
              )
              if (signedIn.user.role_code === undefined)
                void queryClient.invalidateQueries({ queryKey: cacheKey.me() })
            }}
          />
        </SignInDoor>
      )
    }

    return (
      <SignInDoor>
        <LoginForm
          door
          title="Sign in"
          titleOnPhone={false}
          caption="Use the account your administrator set up for you."
          footnote="Forgot your password? Ask your admin for a temporary password."
          className="flex-1"
          problem={problem ?? signedOutElsewhere()}
          // The sandbox names which business this form signs in to, and offers
          // a way out of it. A normal server has nothing here, exactly as
          // before.
          eyebrow={
            tenancy.mode === "sandbox" && tenancy.business ? (
              <BusinessEyebrow business={tenancy.business} />
            ) : undefined
          }
          onSignedIn={(signedIn) => {
            clearSignedOutElsewhere()
            // Writing the answer rather than waiting for a refetch clears the
            // login box without a flicker: the login response already carries
            // the person the server just authenticated. Cloud's `login` now
            // answers with the same `role_code`/`role_name`/`sections`/
            // `read_only` `/auth/me`'s `CloudMe` does, so this is believed
            // outright rather than for a moment. An Edge login, or a Cloud
            // node that predates the fields, omits them — `role_code` is the
            // one that matters, since a fail-open `useSections`/`useCanWrite`
            // treat its absence as "not yet answered" — and only then is
            // `/auth/me` asked to fill in the rest.
            queryClient.setQueryData<Identity | null>(
              cacheKey.me(),
              signedIn.user as Identity
            )
            if (signedIn.user.role_code === undefined)
              void queryClient.invalidateQueries({ queryKey: cacheKey.me() })
          }}
        />
      </SignInDoor>
    )
  }

  if (setup.isPending) {
    return <BootSkeleton />
  }

  if (setup.data !== undefined && !setup.data.finished && !deferred) {
    return (
      <main className="h-full">
        <Suspense fallback={null}>
          <Onboarding
            status={setup.data}
            onDefer={() => deferSetup(true)}
            onDone={() =>
              void queryClient.invalidateQueries({
                queryKey: setupKeys.status(),
              })
            }
          />
        </Suspense>
        <Toasts />
      </main>
    )
  }

  // Mounted only once there is a session: the screens all read the signed-in
  // user's own data, so a router running behind the login screen would fire a
  // page of requests that can only answer 401.
  //
  // The toaster sits beside it rather than inside a screen: a receipt outlives
  // the sheet that produced it, and a component that unmounts on the same
  // click cannot show one.
  return (
    <>
      <SignedInShell />
      <Toasts />
    </>
  )
}

/// Everything behind the sign-in door: the shell (navigation, sheets, the
/// palette) with the router's matched screen inside it, and the quiet work a
/// signed-in session starts — the idle warm-up of the most-used screens
/// (`startPrefetch`), the offline reference cache, and the offline purchase
/// order outbox. Their modules stay lazy: the dynamic imports below keep them
/// out of the entry bundle, so a signed-out first visit does not pay for them
/// (measured 2026-10-10: ~130 KB gzipped of the old entry chunk).
function SignedInShell() {
  const client = useQueryClient()
  // After every streamed section has hydrated: the reference cache and the
  // warm-up both write answers into the cache, and an answer landing ahead of
  // a section's hydration would draw what the server drew as loading. A
  // cancelled wait (strict mode's second run) simply waits again.
  useEffect(() => afterStreamedHydration(() => start(client)), [client])
  return <AppShell />
}

/// The quiet work a signed-in session starts. Each `start*` is idempotent.
function start(client: QueryClient) {
  void Promise.all([
    import("@/lib/prefetch"),
    import("@/lib/offline/reference"),
    import("@/lib/offline/po-outbox"),
  ]).then(
    ([prefetch, reference, outbox]) => {
      prefetch.startPrefetch(client)
      reference.hydrateReference(client)
      outbox.startOutbox(client)
    },
    () => {
      // A failed warm-up is nothing: the screens ask for their own data,
      // and the outbox retries when the module loads again.
    }
  )
}
