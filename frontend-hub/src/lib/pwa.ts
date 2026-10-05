/// <reference types="vite-plugin-pwa/client" />
import { useSyncExternalStore } from "react"
import { registerSW } from "virtual:pwa-register"

/// The hub as an installed app: its service worker, its updates, and the
/// browser's offer to install it.
///
/// Module-level rather than a component, for the same reason the
/// collaboration feed is (`screens/workplace/live.ts`): these are facts about
/// the browser, not about a screen, and two things can ask at once.

// ── The service worker and its updates ──────────────────────────────────────

/// Register the worker and take a newer build in quietly.
///
/// No prompt (the owner, 2026-10-05: hide the "A new version is available"
/// toast). A waiting build is activated without reloading the page: reloading
/// under somebody halfway through a receipt is not an update, so the tab keeps
/// running what it loaded and the next load — or the next lazy chunk — is the
/// new build. Old chunks stay on the server for exactly that reason. Checked
/// hourly as well as on load, since the hub is left open on a shop's counter
/// for a whole shift.
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      void update(false)
    },
    onRegisteredSW(_url, registration) {
      if (registration === undefined) return
      window.setInterval(
        () => {
          if (navigator.onLine) void registration.update().catch(() => {})
        },
        60 * 60 * 1000
      )
    },
    onRegisterError(error: unknown) {
      // An app that cannot install a worker is still the whole app; it only
      // loses push and the offline shell.
      console.warn("service worker registration failed", error)
    },
  })
}

/// What the worker tells an open tab (`src/sw.ts`): a notification was tapped
/// and this is where it goes, or one just arrived.
export function onWorkerMessage(
  handler: (message: { type: string; url?: string }) => void
): () => void {
  if (!("serviceWorker" in navigator)) return () => {}
  const listener = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; url?: unknown } | null
    if (typeof data?.type !== "string") return
    handler({
      type: data.type,
      url: typeof data.url === "string" ? data.url : undefined,
    })
  }
  navigator.serviceWorker.addEventListener("message", listener)
  return () => navigator.serviceWorker.removeEventListener("message", listener)
}

// ── Where it is running ─────────────────────────────────────────────────────

/// Opened from the home screen or an installed window, not a browser tab.
export function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/// An iPhone or iPad — including an iPad that asks for the desktop site and
/// so calls itself a Mac, which is every iPad since iPadOS 13.
export function isIos(): boolean {
  const agent = navigator.userAgent
  return (
    /iPad|iPhone|iPod/.test(agent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  )
}

// ── Installing ──────────────────────────────────────────────────────────────

/// Chrome and Edge's deferred install offer (`beforeinstallprompt`).
interface InstallOffer extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

let offer: InstallOffer | null = null
let installed = false
const listeners = new Set<() => void>()
function publish() {
  for (const listener of listeners) listener()
}

// Captured at module load, before any screen mounts: the event fires once,
// early, and a listener added later has missed it.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault()
    offer = event as InstallOffer
    publish()
  })
  window.addEventListener("appinstalled", () => {
    offer = null
    installed = true
    publish()
  })
}

/// The Web Install API (`navigator.install()`), where a browser has it.
function webInstall(): (() => Promise<unknown>) | null {
  const nav = navigator as Navigator & { install?: () => Promise<unknown> }
  const install = nav.install
  return typeof install === "function" ? () => install.call(nav) : null
}

export interface Installability {
  /// A button can install it here and now.
  readonly canInstall: boolean
  /// Already running as the installed app.
  readonly installed: boolean
  install(): Promise<boolean>
}

function snapshot(): string {
  return `${offer !== null}:${installed}`
}

export function useInstall(): Installability {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    snapshot,
    snapshot
  )
  const standalone = installed || isStandalone()
  const direct = webInstall()
  return {
    canInstall: !standalone && (offer !== null || direct !== null),
    installed: standalone,
    async install() {
      if (offer !== null) {
        const pending = offer
        offer = null
        publish()
        await pending.prompt()
        const choice = await pending.userChoice
        return choice.outcome === "accepted"
      }
      if (direct !== null) {
        try {
          await direct()
          return true
        } catch {
          return false
        }
      }
      return false
    },
  }
}
