import type { CollaborationEvent } from "@itulah/contract"
import { useSyncExternalStore } from "react"

/// The event stream, and the honesty about it that the screens are built on.
///
/// `GET /api/v1/chat/stream` replays from `after=<event_id>` and then follows,
/// which is the whole reason the server numbers events into a table instead of
/// fanning out over a channel: a browser that lost its connection resumes at
/// the last id it actually received rather than silently skipping the gap.
///
/// `EventSource` reconnects on its own, but it reconnects to the URL it was
/// given — it echoes the last id in a `Last-Event-ID` header, and this server
/// reads `after` from the query string. Letting it reconnect by itself would
/// therefore restart from "now" and lose exactly the messages the outage
/// caused. So the connection is managed here: on failure we close it and open
/// a new one with the id in the URL.
///
/// One connection for the whole app, not one per screen. Chat, discussions and
/// the notification bell all read the same stream, and HTTP/1.1 allows six
/// sockets per origin — three of them held open forever by three components
/// listening to the same thing is how a screen ends up unable to load a table.

/// What the connection is doing, in the three states worth telling apart.
export type StreamStatus = "live" | "reconnecting" | "offline"

export interface StreamState {
  readonly status: StreamStatus
  /// The last event id that actually arrived. Shown on screen rather than kept
  /// private: a green dot says "fine" during the seconds when the true answer
  /// is "twelve events behind", and this is the number being caught up to.
  readonly lastEventId: number
}

type Listener = () => void
type EventListener = (event: CollaborationEvent) => void

/// The four kinds the server writes, named in `0040_collaboration.sql` and
/// widened once by `0046_notifications.sql`. `chat.read` is declared there and
/// not yet emitted; it is listed because the constraint lists it, and a
/// subscriber for it costs nothing.
export const EVENT_KINDS = [
  "chat.message",
  "chat.read",
  "discussion.thread",
  "discussion.post",
  "notification",
] as const

const STREAM_PATH = "/api/v1/chat/stream"

/// Back off, but not for long. The far end of an outage is usually a laptop
/// waking up, and fifteen seconds of stale conversation is the most anybody
/// should have to sit through once the network is back.
const RETRY_MS = [1_000, 2_000, 4_000, 8_000, 15_000]

class CollaborationStream {
  private source: EventSource | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private readonly watchers = new Set<Listener>()
  private readonly handlers = new Map<string, Set<EventListener>>()
  private state: StreamState = { status: "offline", lastEventId: 0 }

  snapshot = (): StreamState => this.state

  /// Watch the connection itself. Opening the first watcher opens the stream;
  /// closing the last one closes it, so a browser sitting on a screen that
  /// does not care about live traffic is not holding a socket open.
  watch = (listener: Listener): (() => void) => {
    this.watchers.add(listener)
    if (this.watchers.size === 1) this.open()
    return () => {
      this.watchers.delete(listener)
      if (this.watchers.size === 0) this.close()
    }
  }

  /// Watch one kind of event. The kind matters: a discussion reply and a
  /// message in somebody else's conversation both arrive here, and a screen
  /// that refetched on every one of them would spend the afternoon reloading
  /// lists nobody is looking at.
  on = (kind: string, handler: EventListener): (() => void) => {
    const set = this.handlers.get(kind) ?? new Set<EventListener>()
    set.add(handler)
    this.handlers.set(kind, set)
    // A subscriber is also a watcher: the stream has to be open for its events
    // to arrive, and nothing else guarantees somebody has opened it.
    const stopWatching = this.watch(() => {})
    return () => {
      set.delete(handler)
      stopWatching()
    }
  }

  private set(next: Partial<StreamState>) {
    this.state = { ...this.state, ...next }
    for (const watcher of this.watchers) watcher()
  }

  private open() {
    if (this.source !== null) return
    // No `after` on a first connection. The screen already has the current
    // contents from its own queries, and replaying the day at it would be
    // work with nothing to show for it. A reconnection is the opposite case,
    // and that is when the id goes in.
    const url =
      this.state.lastEventId > 0
        ? `${STREAM_PATH}?after=${this.state.lastEventId}`
        : STREAM_PATH
    const source = new EventSource(url, { withCredentials: true })
    this.source = source

    source.onopen = () => {
      this.attempt = 0
      this.set({ status: "live" })
    }
    source.onerror = () => {
      // Close it ourselves rather than letting EventSource retry: its retry
      // goes to the URL it was constructed with, which after the first
      // connection is the one without `after` — the gap would be skipped.
      source.close()
      if (this.source === source) this.source = null
      this.retry()
    }

    for (const kind of EVENT_KINDS) {
      source.addEventListener(kind, (message) => {
        this.receive(kind, message as MessageEvent<string>)
      })
    }
  }

  private receive(kind: string, message: MessageEvent<string>) {
    const eventId = Number(message.lastEventId)
    if (Number.isFinite(eventId) && eventId > this.state.lastEventId) {
      this.set({ status: "live", lastEventId: eventId })
    }
    let payload: unknown = null
    try {
      payload = JSON.parse(message.data) as unknown
    } catch {
      // A frame we cannot read is not a reason to tear the stream down; the
      // id still advanced, so the next reconnect will not ask for it again.
      return
    }
    const event: CollaborationEvent = {
      event_id: eventId,
      kind,
      payload,
      occurred_at: new Date().toISOString(),
    }
    for (const handler of this.handlers.get(kind) ?? []) handler(event)
  }

  private retry() {
    if (this.timer !== null) return
    // "Offline" is what the browser itself reports, and it is a different
    // thing from "the server is not answering". Saying "reconnecting" at a
    // laptop with its lid shut would be a promise nothing is keeping.
    const offline = typeof navigator !== "undefined" && navigator.onLine === false
    this.set({ status: offline ? "offline" : "reconnecting" })
    const wait = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)]
    this.attempt += 1
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.watchers.size > 0) this.open()
    }, wait)
  }

  private close() {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.source?.close()
    this.source = null
    this.attempt = 0
    // The id survives a close on purpose: the next screen to open the stream
    // resumes from where the last one stopped rather than from now.
    this.set({ status: "offline" })
  }
}

const stream = new CollaborationStream()

/// The connection, for the badge that reports it.
export function useCollaborationStream(): StreamState {
  return useSyncExternalStore(stream.watch, stream.snapshot, stream.snapshot)
}

/// Subscribe to one kind of event. Returns nothing — callers react by
/// invalidating a query, which is what keeps one source of truth for what is
/// on screen instead of two.
export function subscribeToCollaboration(kind: string, handler: EventListener): () => void {
  return stream.on(kind, handler)
}

/// Somebody's initials, from a username shaped `sari.m` or a display name.
export function initials(name: string): string {
  const parts = name.split(/[.\s_-]+/).filter(Boolean)
  if (parts.length === 0) return "?"
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

/// A hue derived from the name itself, so one person is the same colour on
/// every screen and in every browser without a single stored preference.
export function hueFor(name: string): number {
  let sum = 0
  for (let index = 0; index < name.length; index += 1) {
    sum = (sum * 31 + name.charCodeAt(index)) % 360
  }
  return sum
}

/// Bytes, in the unit a person would say out loud.
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1_048_576) return `${Math.round(size / 1024)} KB`
  return `${(size / 1_048_576).toFixed(1)} MB`
}

/// How long ago, in the shortest form that is still true. The same rule the
/// notification panel uses, so two lists side by side do not date the same
/// instant differently.
export function ago(value: string): string {
  const seconds = Math.round((Date.now() - Date.parse(value)) / 1000)
  if (!Number.isFinite(seconds)) return ""
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`
  return `${Math.floor(seconds / 604_800)}w`
}

/// The clock time on a message, which is a different question from how long
/// ago it was: a thread reads as a day, and "3h" in the middle of one tells
/// you nothing about what came before it.
export function clock(value: string): string {
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return ""
  return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

/// The day a message belongs to, for the divider between them.
export function dayOf(value: string): string {
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return ""
  const today = new Date()
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate()
  if (sameDay) return "Today"
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const wasYesterday =
    at.getFullYear() === yesterday.getFullYear() &&
    at.getMonth() === yesterday.getMonth() &&
    at.getDate() === yesterday.getDate()
  if (wasYesterday) return "Yesterday"
  return at.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })
}
