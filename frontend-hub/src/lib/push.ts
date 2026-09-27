import { node } from "@/lib/api"
import { isIos, isStandalone } from "@/lib/pwa"

/// Web Push on this browser: whether it can, whether it has said yes, and
/// saying yes or no.
///
/// The server half is `cloud/push.rs`; the worker that shows what arrives is
/// `src/sw.ts`. What lives here is the browser's side of the handshake and the
/// rules about when to ask.
///
/// # Never on page load
///
/// The permission prompt is shown only from a button the person pressed. A
/// prompt that appears unasked is declined by reflex, and a browser remembers
/// "Block" for good — after which this site cannot even ask again, only tell
/// the person where the setting is.
///
/// # One person per browser
///
/// A shop's tablet is shared. Signing out takes this browser's subscription
/// off the server AND out of the browser (`forgetPushOnSignOut`), so the next
/// person to sign in is asked, not silently enrolled into being woken for the
/// previous one's work. The username that said yes is remembered beside it,
/// so a session that ended without a sign-out — pushed out by a sign-in on
/// another device — is caught on the next open.

/// Why this browser can or cannot be woken, in the order they are checked.
export type PushSupport =
  /// Everything needed is here.
  | "ready"
  /// An iPhone or iPad in Safari: push works only once added to the Home
  /// Screen and opened from there (iOS 16.4+).
  | "ios-needs-install"
  /// No service worker or no Push API — an old browser, a private window in
  /// some, an in-app browser.
  | "unsupported"

export function pushSupport(): PushSupport {
  const capable =
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  if (isIos() && !isStandalone()) return "ios-needs-install"
  return capable ? "ready" : "unsupported"
}

/// The browser's own answer, or `default` when it has not been asked.
export function permission(): NotificationPermission {
  return "Notification" in window ? Notification.permission : "denied"
}

interface PublicKeyAnswer {
  readonly enabled: boolean
  readonly public_key: string | null
  readonly reason: string | null
}

export function pushPublicKey(signal?: AbortSignal) {
  return node.get<PublicKeyAnswer>("/api/v1/push/public-key", { signal })
}

const OWNER = "itulah.push-owner"
const KEY = "itulah.push-key"

function remember(name: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(name)
    else localStorage.setItem(name, value)
  } catch {
    // Storage blocked: the owner check below simply cannot run.
  }
}

function recall(name: string): string | null {
  try {
    return localStorage.getItem(name)
  } catch {
    return null
  }
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/// "Chrome on Android" — what a person will recognise on a list of devices.
function deviceLabel(): string {
  const agent = navigator.userAgent
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\//.test(agent)
      ? "Firefox"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : "Browser"
  const system = isIos()
    ? "iOS"
    : /Android/.test(agent)
      ? "Android"
      : /Windows/.test(agent)
        ? "Windows"
        : /Mac OS X/.test(agent)
          ? "macOS"
          : /Linux/.test(agent)
            ? "Linux"
            : "a computer"
  return `${browser} on ${system}${isStandalone() ? " (app)" : ""}`
}

async function registration(): Promise<ServiceWorkerRegistration> {
  // `ready` never settles when no worker registers — a dev server without
  // one, a browser that refused it — so it is raced against a clock rather
  // than left to hang a button's spinner for ever.
  const timeout = new Promise<never>((_, reject) =>
    window.setTimeout(
      () => reject(new Error("The service worker did not start.")),
      10_000
    )
  )
  return Promise.race([navigator.serviceWorker.ready, timeout])
}

async function tell(subscription: PushSubscription) {
  await node.post("/api/v1/push/subscriptions", {
    ...subscription.toJSON(),
    device_label: deviceLabel(),
  })
}

/// Ask, subscribe, and tell the server. Call from a click only, with the key
/// the control already fetched.
///
/// The browser's question comes FIRST, before any request: a permission prompt
/// is honoured only close to the press that asked for it, and Safari in
/// particular refuses one that waited on the network.
///
/// Resolves to the permission the browser ended on, so the caller can say
/// the right sentence for `denied` without asking again.
export async function enablePush(
  username: string,
  publicKey: string | null | undefined
): Promise<NotificationPermission> {
  if (publicKey === null || publicKey === undefined) {
    throw new Error("Notifikasi push belum diaktifkan di server.")
  }
  const granted = await Notification.requestPermission()
  if (granted !== "granted") return granted

  const worker = await registration()
  let subscription = await worker.pushManager.getSubscription()
  // Subscribed to a key the server no longer signs with — the keys were
  // rotated — is subscribed to nothing: start again.
  if (subscription !== null && recall(KEY) !== publicKey) {
    await subscription.unsubscribe().catch(() => false)
    subscription = null
  }
  subscription ??= await worker.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey),
  })
  await tell(subscription)
  remember(OWNER, username)
  remember(KEY, publicKey)
  return granted
}

/// Stop being woken on this browser: off the server, then out of the browser.
export async function disablePush(): Promise<void> {
  if (pushSupport() !== "ready") return
  const worker = await registration()
  const subscription = await worker.pushManager.getSubscription()
  if (subscription !== null) {
    await node
      .request("DELETE", "/api/v1/push/subscriptions", {
        endpoint: subscription.endpoint,
      })
      .catch(() => undefined)
    await subscription.unsubscribe().catch(() => false)
  }
  remember(OWNER, null)
  remember(KEY, null)
}

/// Before the session is revoked — the DELETE needs it. Never throws: a
/// sign-out must complete whatever the push service or the network says.
export async function forgetPushOnSignOut(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return
    const worker = await navigator.serviceWorker.getRegistration()
    if (worker === undefined) return
    const subscription = await worker.pushManager?.getSubscription()
    if (subscription === null || subscription === undefined) return
    await node
      .request("DELETE", "/api/v1/push/subscriptions", {
        endpoint: subscription.endpoint,
      })
      .catch(() => undefined)
    await subscription.unsubscribe().catch(() => false)
  } catch {
    // Nothing here may stop a sign-out.
  } finally {
    remember(OWNER, null)
    remember(KEY, null)
  }
}

/// Whether this browser is being woken for `username` right now.
export async function pushEnabledFor(username: string): Promise<boolean> {
  if (pushSupport() !== "ready" || permission() !== "granted") return false
  const worker = await navigator.serviceWorker.getRegistration()
  const subscription = await worker?.pushManager.getSubscription()
  return (
    subscription !== null &&
    subscription !== undefined &&
    recall(OWNER) === username
  )
}

/// On every open: re-tell the server about a subscription it may have lost,
/// or drop one that belongs to somebody else.
///
/// Browsers rotate subscriptions without asking, and the server deletes one a
/// push service called gone; re-registering on open is how both are healed
/// without the person noticing. The owner check is the shared-tablet rule
/// above.
export async function reconcilePush(username: string): Promise<void> {
  if (pushSupport() !== "ready" || permission() !== "granted") return
  const worker = await navigator.serviceWorker.getRegistration()
  const subscription = await worker?.pushManager.getSubscription()
  if (subscription === null || subscription === undefined) return
  if (recall(OWNER) !== username) {
    await subscription.unsubscribe().catch(() => false)
    remember(OWNER, null)
    remember(KEY, null)
    return
  }
  const answer = await pushPublicKey().catch(() => null)
  if (answer === null || !answer.enabled) return
  if (answer.public_key !== recall(KEY)) {
    // Rotated keys: this subscription can never be pushed to. Drop it; the
    // control offers "Aktifkan notifikasi" again.
    await subscription.unsubscribe().catch(() => false)
    remember(OWNER, null)
    remember(KEY, null)
    return
  }
  await tell(subscription).catch(() => undefined)
}

/// The number on the installed app's icon, where the platform has one.
export function setAppBadge(unread: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  if (nav.setAppBadge === undefined) return
  const done =
    unread > 0 ? nav.setAppBadge(unread) : (nav.clearAppBadge?.() ?? null)
  void done?.catch(() => undefined)
}
