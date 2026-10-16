import type { QueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router"

import { App } from "@/App"
import { reachQueryOptions } from "@/lib/queries/people"
import { setupKeys, setupStatusOptions } from "@/lib/queries/setup"
import { deviceHint } from "@/lib/device"
import { LOOK } from "@/lib/look"
import { identityQueryOptions } from "@/lib/session"
import { validateSheetSearch } from "@/lib/sheets"
import { TenancyProvider, tenancyQueryOptions } from "@/lib/tenancy"
// Side-effect imports, not `?url` links: Start finds them in the client
// build's manifest and links the very file the client built, in the first
// HTML. A `?url` import is resolved by the server build too, whose Tailwind
// pass writes a different file — its link pointed at a stylesheet the client
// never emitted, and the page drew unstyled until the scripts ran.
import "@/styles/index.css"
// The All white look, drawn over the components' own classes — see
// `lib/look.ts`. After `index.css`, so it wins.
import "@/styles/white.css"

/// The document route — the one file-based route Start owns. Everything below
/// it (the registry routes, the redirects) is built in code from
/// `lib/navigation.ts`, exactly as before; `routes.tsx` hangs them off
/// `RootRoute` here.
export const RootRoute = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  // Which sheet is open is a search parameter legal on every route below
  // (`lib/sheets.ts`); the root claims it so every match keeps it.
  validateSearch: validateSheetSearch,
  // The SSR pass asks the session's three questions — who, which tenancy,
  // and (once signed in) whether setup is finished — BEFORE rendering, so the
  // first HTML is the door or the shell rather than a skeleton that flips
  // after hydration. In the browser the same calls hit the Query cache
  // (`staleTime: Infinity`): a navigation is a cache read, not a refetch.
  // Identity can answer `null` (nobody) but must not fail the render —
  // `identityQueryOptions` already folds a lapsed session into `null`.
  beforeLoad: async ({ context }) => {
    if (typeof window !== "undefined") return
    const { queryClient } = context
    // All four questions go out at once, so the root's serial step (every
    // loader waits for it) costs one round trip to the node, not two. Setup
    // only means something for somebody signed in: for a stranger its
    // refusal is dropped rather than carried into the page.
    const off = import.meta.env.VITE_TENANCY === "off"
    const [me] = await Promise.all([
      queryClient.ensureQueryData(identityQueryOptions()).catch(() => null),
      queryClient.ensureQueryData(setupStatusOptions(true)).catch(() => null),
      // The sidebar's People items depend on how far the person reaches.
      queryClient.ensureQueryData(reachQueryOptions()).catch(() => null),
      off
        ? null
        : queryClient
            .ensureQueryData(tenancyQueryOptions(queryClient))
            .catch(() => null),
    ])
    if (me === null) {
      queryClient.removeQueries({ queryKey: setupKeys.status() })
      queryClient.removeQueries({ queryKey: reachQueryOptions().queryKey })
    }
  },
  // Every page is somebody's own: the HTML carries their session's answers,
  // so no shared cache (a CDN, a proxy) may keep it.
  headers: () => ({ "Cache-Control": "private, no-store" }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // viewport-fit=cover so full-screen sheets can pad away from the notch
      // and home bar themselves; interactive-widget so Android's keyboard
      // shrinks the layout the way iOS's does, and a bottom-pinned button
      // rises with it. (Carried over from index.html.)
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
      },
      { name: "theme-color", content: "#ffffff" },
      // iOS still reads these rather than the manifest: without
      // `apple-mobile-web-app-capable` "Add to Home Screen" makes a bookmark,
      // and a bookmark cannot receive Web Push.
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Central" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { title: "Central Dashboard" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/pwa-192.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      // The manifest itself is emitted by the build (`pwa` in vite.config.ts);
      // under SSR there is no index.html for the plugin to inject the link
      // into, so it is declared here.
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
})

/// The document. A shell rather than part of the root component, so it is
/// drawn around whatever the root renders — the app, or the root's own error
/// or not-found page — and the response is always a whole HTML page.
function RootDocument({ children }: { children: ReactNode }) {
  const hint = deviceHint()
  return (
    // The look is in the first HTML, so the page is drawn white before any
    // script runs. The look's aids (`data-aid-*`) are a per-device choice the
    // server cannot know: `lib/look.ts` adds them before hydration, so React
    // is told not to fight over this one element's attributes.
    <html
      lang="en"
      data-look={LOOK}
      data-device={hint.phone ? "phone" : "desk"}
      data-vw={hint.width}
      suppressHydrationWarning
    >
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

/// The gate decides between the doors and the shell; the shell (AppShell)
/// renders the matched route inside itself. The Query provider is the SSR
/// integration's own (`router.tsx`), wrapped around the whole router, so it
/// is not repeated here.
function RootComponent() {
  return (
    <TenancyProvider>
      <App />
    </TenancyProvider>
  )
}
