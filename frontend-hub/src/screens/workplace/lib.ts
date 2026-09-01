import type { ChatConversation } from "@itulah/contract"
import type { Tone } from "@/lib/format"

/// The small answers the workplace screens need and `lib/format.ts` does not
/// carry, kept here rather than pushed into the shared formatter.
///
/// `format.ts` dates things a person reads once — an issue date, a posting
/// date. A conversation is dated differently on purpose: "3h" beside a message
/// in the middle of a thread tells you nothing about what came before it, and
/// "02 Sep 2026" beside every line of a chat is noise. So relative age, clock
/// time and a day divider live here, where the surface that needs them is.

/// How long ago, in the shortest form that is still true.
export function ago(iso: string | null | undefined): string {
  if (!iso) return ""
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (!Number.isFinite(seconds)) return ""
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`
  return `${Math.floor(seconds / 604_800)}w`
}

/// The clock time on a message — a different question from how long ago it
/// was, and the one a thread read top to bottom is actually asking.
export function clock(iso: string | null | undefined): string {
  if (!iso) return ""
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ""
  return at.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
}

/// The day a message belongs to, for the divider between them.
export function dayOf(iso: string | null | undefined): string {
  if (!iso) return ""
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ""
  const today = new Date()
  const sameDayAs = (other: Date) =>
    at.getFullYear() === other.getFullYear() &&
    at.getMonth() === other.getMonth() &&
    at.getDate() === other.getDate()
  if (sameDayAs(today)) return "Today"
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (sameDayAs(yesterday)) return "Yesterday"
  return at.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

/// Bytes, in the unit a person would say out loud.
export function bytes(size: number | null | undefined): string {
  if (size === null || size === undefined) return "—"
  if (size < 1024) return `${size} B`
  if (size < 1_048_576) return `${Math.round(size / 1024)} KB`
  return `${(size / 1_048_576).toFixed(1)} MB`
}

/// The extension, for the small square that stands in for a preview.
export function fileKind(name: string): string {
  const dot = name.lastIndexOf(".")
  if (dot < 0 || dot === name.length - 1) return "FILE"
  return name
    .slice(dot + 1)
    .toUpperCase()
    .slice(0, 4)
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

/// Which of the five categorical tokens paints somebody's tile.
///
/// Derived from the name itself, so one person is the same colour on every
/// screen and in every browser without a single stored preference — and it is
/// an *index into the token family*, not a generated hue: DESIGN.md reserves
/// `a-orange`/`a-green`/`a-blue`/`a-pink`/`a-violet` for data-viz, identity
/// tiles and system tags, and an `hsl()` computed per person would be a colour
/// outside the system.
export const AVATAR_TONES = 5

export function avatarTone(name: string): number {
  let sum = 0
  for (let index = 0; index < name.length; index += 1) {
    sum = (sum * 31 + name.charCodeAt(index)) % 1_000_003
  }
  return sum % AVATAR_TONES
}

/// `open` is in motion, `resolved` is done, `locked` is neither.
///
/// Not `toneFor` from `lib/format.ts`: that maps the retail taxonomy, where
/// "resolved" does not appear and "open" would fall through to neutral. Two
/// words, one screen, so the mapping is stated here rather than smuggled into
/// the shared table.
export function threadTone(status: string): Tone {
  if (status === "resolved") return "ok"
  if (status === "locked") return "neutral"
  return "info"
}

/// What a conversation is called for the person reading it.
///
/// A direct conversation has no name of its own — the server resolves `title`
/// per reader, and this is the fallback for the case where it arrives empty:
/// whoever else is in the room.
export function conversationName(
  conversation: ChatConversation,
  me: string | undefined
): string {
  if (conversation.title.trim() !== "") return conversation.title
  const others = conversation.participants.filter((name) => name !== me)
  return others.length > 0
    ? others.join(", ")
    : conversation.participants.join(", ")
}

/// An idempotency key, minted before the first attempt rather than at the
/// moment of sending.
///
/// This is what makes a resend safe. If the connection drops between the
/// request leaving and the answer arriving, the retry carries the same key and
/// the server returns the message it already wrote instead of writing a second
/// one. Generated where the message is composed, so a retry cannot accidentally
/// mint a fresh one.
export function idempotencyKey(): string {
  if (globalThis.crypto?.randomUUID !== undefined) {
    return globalThis.crypto.randomUUID()
  }
  return `wp-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

/// The event kinds the server writes, named in `0040_collaboration.sql` and
/// widened once by `0046_notifications.sql`.
export const EVENT_KINDS = [
  "chat.message",
  "chat.read",
  "discussion.thread",
  "discussion.post",
  "notification",
] as const

/// What an event says, once `kind` has been read.
///
/// `CollaborationEvent.payload` is `unknown` on purpose — it is shaped by
/// `kind`, so there is no one type to declare — and this is the narrowing every
/// reader of one has to do. Each field is checked rather than asserted: the
/// payload is JSON from a column, and a missing id must mean "no id" and not a
/// query key spelled `undefined`.
export function eventSubject(payload: unknown): {
  conversationId?: string
  threadId?: string
  author?: string
  title?: string
} {
  if (typeof payload !== "object" || payload === null) return {}
  const record = payload as Record<string, unknown>
  const text = (value: unknown) =>
    typeof value === "string" && value !== "" ? value : undefined
  return {
    conversationId: text(record.conversation_id),
    threadId: text(record.thread_id),
    author: text(record.author),
    title: text(record.title),
  }
}
