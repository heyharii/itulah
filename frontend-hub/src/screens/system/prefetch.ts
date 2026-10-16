import { warmInfinite, type PrefetchMap } from "@/lib/prefetch"
import { auditFeedQuery } from "@/lib/queries/audit"
import { notificationFeedQuery, usersFeedQuery } from "@/screens/system/data"

/// What System asks first, before the screen is open (`lib/prefetch.ts`). The
/// options are the screens' own (`screens/system/data.ts`,
/// `lib/queries/audit.ts`).
///
/// Never here, on purpose: Store servers and Devices. They are live reads of
/// what the shops' machines report (their heartbeats, "seen 3 m ago"), which
/// change under a person's eyes and are re-read every few seconds anyway.

export const prefetch: PrefetchMap = {
  // The account register opens grouped by store, least recently signed in
  // first. The filter chips (`f`) live in the address bar; a link that carries
  // one asks for exactly that, and the screen does so itself.
  "/system/users": (client, { search }) => {
    if (search.f !== undefined) return
    return warmInfinite(
      client,
      usersFeedQuery({ sort: "last_login", desc: false })
    )
  },
  // The log opens newest first, with nothing narrowed.
  "/system/activity": (client, { search }) => {
    if (search.f !== undefined) return
    return warmInfinite(client, auditFeedQuery({ sort: "at", desc: true }))
  },
  // The feed opens on All, read and unread together.
  "/system/notifications": (client) =>
    warmInfinite(client, notificationFeedQuery(false)),
}
