import type { QueryClient } from "@tanstack/react-query"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useSyncExternalStore } from "react"

import { setAppBadge } from "@/lib/push"
import { onWorkerMessage } from "@/lib/pwa"

/// The signed-in person's notifications as they arrive, over one event
/// stream per tab (`GET /api/v1/notifications/stream`, `http/notifications.rs`).
///
/// # Why a stream here, when the collaboration feed polls
///
/// `screens/workplace/live.ts` polls on purpose: a socket per tab is costly
/// under HTTP/1.1, and a second and a half on a chat message costs nothing.
/// The bell is different. It is on every screen, and the alternative was a
/// poll every minute from every tab all day, most of it answering "nothing".
/// The stream sends nothing when nothing changes, tells every open badge the
/// moment something is read elsewhere, and is what the desktop shell listens
/// to, since Electron cannot receive Web Push.
///
/// # And a poll behind it
///
/// A proxy that buffers, a network that drops idle connections, a server
/// restarting: when the stream is down the screens poll once a minute, which
/// is exactly what they did before (`fallbackInterval`). A stream that died
/// quietly must cost a minute of lag, never a badge that stops moving.
///
/// # Shape
///
/// A module-level store, like the collaboration feed: one `EventSource` however
/// many components ask, opened with the first and closed with the last.

export type StreamState = "idle" | "connecting" | "live" | "down"

interface Snapshot {
  readonly state: StreamState
  /// From the stream's own count; null until it has said.
  readonly unread: number | null
}

let snapshot: Snapshot = { state: "idle", unread: null }
const listeners = new Set<() => void>()
function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next }
  for (const listener of listeners) listener()
}

let source: EventSource | null = null
let users = 0
let client: QueryClient | null = null
let retry: number | undefined
let backoff = 5_000
/// Whether this tab has had the stream before: a reconnect has a gap behind
/// it, a first connect does not (the screens have just fetched).
let wasLive = false
let stopWorkerMessages: (() => void) | null = null

/// Every cache entry that shows a notification: the bell, the bottom bar and
/// the full list under `system`, and the Profile tab's under `me`.
function refresh() {
  void client?.invalidateQueries({ queryKey: ["system", "notifications"] })
  void client?.invalidateQueries({ queryKey: ["me", "notifications"] })
}

function counted(event: MessageEvent) {
  try {
    const data = JSON.parse(event.data as string) as { unread?: unknown }
    if (typeof data.unread === "number") {
      publish({ unread: data.unread })
      setAppBadge(data.unread)
    }
  } catch {
    // A frame this build does not understand is not worth a broken badge.
  }
}

function open() {
  window.clearTimeout(retry)
  publish({ state: "connecting" })
  const stream = new EventSource("/api/v1/notifications/stream")
  source = stream
  stream.addEventListener("ready", (event) => {
    backoff = 5_000
    publish({ state: "live" })
    counted(event)
    // Whatever happened while the stream was down is in the list, not in
    // the stream: ask for it once.
    if (wasLive) refresh()
    wasLive = true
  })
  stream.addEventListener("unread", (event) => {
    counted(event)
    refresh()
  })
  stream.addEventListener("notification", refresh)
  stream.addEventListener("signed-out", () => {
    // The session ended. Stop, and let the fallback poll meet the 401 that
    // brings the sign-in box up.
    close()
    publish({ state: "down" })
  })
  stream.onerror = () => {
    if (stream.readyState === EventSource.CLOSED) {
      // A refusal (401, 5xx, not an event stream) closes it for good. Try
      // again ourselves, slower each time, and poll in the meantime.
      close()
      publish({ state: "down" })
      if (users > 0) {
        retry = window.setTimeout(open, backoff)
        backoff = Math.min(backoff * 2, 5 * 60_000)
      }
    } else {
      // CONNECTING: the browser is already reconnecting on its own.
      publish({ state: "down" })
    }
  }
}

function close() {
  source?.close()
  source = null
}

function join(queryClient: QueryClient) {
  client = queryClient
  users += 1
  if (users === 1) {
    open()
    // A push that arrives while a tab is open refreshes it too, even when the
    // stream is the one that is down.
    stopWorkerMessages = onWorkerMessage((message) => {
      if (message.type === "notification") refresh()
    })
  }
}

function leave() {
  users -= 1
  if (users === 0) {
    window.clearTimeout(retry)
    close()
    stopWorkerMessages?.()
    stopWorkerMessages = null
    publish({ state: "idle" })
  }
}

/// Follow the stream for as long as the calling component is mounted.
export function useNotificationStream(): Snapshot {
  const queryClient = useQueryClient()
  useEffect(() => {
    join(queryClient)
    return leave
  }, [queryClient])
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => snapshot,
    () => snapshot
  )
}

/// The poll a notification query should run: none while the stream is live,
/// a minute otherwise.
export function fallbackInterval(state: StreamState): number | false {
  return state === "live" ? false : 60_000
}
