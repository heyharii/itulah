import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching"
import { NavigationRoute, registerRoute } from "workbox-routing"

import { recordRoute } from "./lib/record-route"

/// The hub's service worker: the app shell, and notifications that arrive
/// while the hub is closed.
///
/// Built by `vite-plugin-pwa` (`injectManifest`, see vite.config.ts), which
/// replaces `self.__WB_MANIFEST` with the list of shell files at build time.
///
/// # Types
///
/// This file is checked by the app's own tsconfig, which has the DOM library
/// and not the WebWorker one — the two declare the same globals differently
/// and cannot share a program. So the few worker-only shapes used here are
/// written out below rather than imported, and `self` is re-declared for this
/// module only.

interface WaitUntil extends Event {
  waitUntil(work: Promise<unknown>): void
}
interface PushArrival extends WaitUntil {
  readonly data: { json(): unknown; text(): string } | null
}
interface NotificationTap extends WaitUntil {
  readonly notification: Notification
  readonly action: string
}
interface WindowClientLike {
  readonly url: string
  readonly focused: boolean
  focus(): Promise<WindowClientLike>
  navigate(url: string): Promise<WindowClientLike | null>
  postMessage(message: unknown): void
}
interface WorkerScope {
  readonly location: Location
  readonly registration: ServiceWorkerRegistration
  readonly navigator: Navigator
  readonly clients: {
    matchAll(options: {
      type: "window"
      includeUncontrolled: boolean
    }): Promise<readonly WindowClientLike[]>
    openWindow(url: string): Promise<WindowClientLike | null>
    claim(): Promise<void>
  }
  readonly __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0]
  skipWaiting(): Promise<void>
  addEventListener(type: "push", listener: (event: PushArrival) => void): void
  addEventListener(
    type: "notificationclick",
    listener: (event: NotificationTap) => void
  ): void
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void
  ): void
}
declare const self: WorkerScope

// ── The shell ───────────────────────────────────────────────────────────────

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// A navigation anywhere in the app is answered with the shell, and the router
// takes it from there — except the two backends behind this origin. A link
// to `/api/v1/files/…` opened in a tab must reach the server, not be handed
// an app that does not know that path.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//, /^\/edge\//],
  })
)

// ── The screens visited ─────────────────────────────────────────────────────

/// Every screen is its own chunk under `/assets/`, fetched the first time it is
/// opened (`routes.tsx`) and not precached — a phone opening Profile should not
/// download Finance. But a chunk that was fetched once is kept here, so the
/// screens a person has used open again with no connection: the New PO form on
/// a buyer's laptop in a warehouse with no signal is the reason.
///
/// Cache first, and safe: a built file's name carries a hash of its contents,
/// so the same name is always the same bytes. The oldest are dropped past
/// `SCREEN_LIMIT` so builds of months ago do not pile up on a device.
const SCREENS = "screens-v1"
const SCREEN_LIMIT = 400

async function keepOnly(cache: Cache, limit: number): Promise<void> {
  const keys = await cache.keys()
  // Oldest first: a cache lists its entries in the order they were put.
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) {
    await cache.delete(key)
  }
}

registerRoute(
  ({ url, request }) =>
    request.method === "GET" &&
    url.origin === self.location.origin &&
    url.pathname.startsWith("/assets/"),
  async ({ request }) => {
    const cache = await caches.open(SCREENS)
    const kept = await cache.match(request)
    if (kept !== undefined) return kept
    const response = await fetch(request)
    if (response.ok) {
      await cache.put(request, response.clone())
      void keepOnly(cache, SCREEN_LIMIT)
    }
    return response
  }
)

// The page's "load the new version" button (`lib/pwa.ts`) sends this.
self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") {
    void self.skipWaiting()
  }
})

// ── Push ────────────────────────────────────────────────────────────────────

/// What the cloud sends (`cloud/push.rs`, `PushMessage`). Read defensively: a
/// worker cached from last month may meet a newer shape.
interface PushMessage {
  v?: number
  notification_id?: string
  kind?: string
  title?: string
  body?: string
  url?: string
  subject_kind?: string | null
  subject_id?: string | null
}

function read(event: PushArrival): PushMessage {
  if (event.data === null) return {}
  try {
    const value = event.data.json()
    return typeof value === "object" && value !== null
      ? (value as PushMessage)
      : {}
  } catch {
    return { body: event.data.text() }
  }
}

/// One search value the way the router writes it. TanStack Router reads each
/// value as JSON when it parses as JSON, so an id like `42` is written quoted —
/// otherwise the sheet would receive the number 42 and refuse it.
function searchValue(value: string): string {
  try {
    JSON.parse(value)
    return encodeURIComponent(JSON.stringify(value))
  } catch {
    return encodeURIComponent(value)
  }
}

/// Where tapping it should land: the record's own screen when there is one,
/// by the same table the bell uses, and the list when there is not.
function destination(message: PushMessage): string {
  const where = recordRoute(
    message.subject_kind ?? null,
    message.subject_id ?? null
  )
  if (where !== null) {
    return where.sheet === undefined
      ? where.to
      : `${where.to}?${where.sheet.key}=${searchValue(where.sheet.value)}`
  }
  // Only a path on this origin, whatever the payload says.
  return typeof message.url === "string" && message.url.startsWith("/")
    ? message.url
    : "/system/notifications"
}

/// The number on the installed app's icon: what is still in the tray. The
/// page corrects it to the true unread count the moment it opens
/// (`lib/push.ts`); this is the honest guess without asking the server.
async function refreshBadge() {
  const nav = self.navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  if (nav.setAppBadge === undefined) return
  const shown = await self.registration.getNotifications()
  try {
    if (shown.length > 0) await nav.setAppBadge(shown.length)
    else await nav.clearAppBadge?.()
  } catch {
    // Badging refused (permission, platform): the tray still has it.
  }
}

self.addEventListener("push", (event) => {
  const message = read(event)
  // Always show something. A push the page asked for with
  // `userVisibleOnly: true` that shows nothing is counted against this site,
  // and enough of them and the browser shows its own generic notice instead.
  const title = message.title?.trim() || "Central Dashboard"
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body: message.body ?? "Ada yang perlu Anda tangani.",
        // The id as the tag: a retried push replaces the one on screen rather
        // than stacking a copy under it.
        tag: message.notification_id ?? undefined,
        icon: "/pwa-192.png",
        badge: "/pwa-badge-96.png",
        data: {
          url: destination(message),
          notificationId: message.notification_id ?? null,
        },
      })
      await refreshBadge()
      // An open tab refreshes its list now rather than at the next event on
      // its stream.
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      for (const client of windows) {
        client.postMessage({
          type: "notification",
          notificationId: message.notification_id ?? null,
        })
      }
    })()
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const data = event.notification.data as { url?: unknown } | null
  const path =
    typeof data?.url === "string" && data.url.startsWith("/") ? data.url : "/"
  const url = new URL(path, self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      const open =
        windows.find((client) => client.focused) ??
        windows.find(
          (client) => new URL(client.url).origin === self.location.origin
        )
      if (open !== undefined) {
        // The page navigates itself with the router (`lib/pwa.ts`), so the
        // screen somebody was on is not reloaded out from under them.
        open.postMessage({ type: "open", url: path })
        await open.focus().catch(() => undefined)
      } else {
        await self.clients.openWindow(url)
      }
      await refreshBadge()
    })()
  )
})
