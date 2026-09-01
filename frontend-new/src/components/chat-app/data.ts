/*
 * The chat screen's view vocabulary.
 *
 * Backed by the Go cloud-hub (`github.com/retailos/backbone`), which splits this
 * screen across two real collections rather than one chat hub:
 *
 *  - `/api/v1/channels`  — team channels (advisor-plan 025): name, description,
 *    privacy, scope, explicit membership with roles, threaded messages,
 *    mentions, attachments, read cursors and unread counts.
 *  - `/api/v1/records?kind=dm` — the Records hub's DM lens. A record IS the
 *    conversation (its body is the opening message); `/comments` are the
 *    replies and carry emoji reactions as `emoji -> [user_id]`.
 *
 * Display names come from `/api/v1/hr/employees`, the only directory the hub
 * publishes. Anything it does not name keeps its raw id — this module never
 * substitutes a plausible-looking name for one the backend does not have, and
 * there is no presence anywhere in the Go surface, so none is shown.
 */

import { createContext, useContext } from "react"

/** A person as the hub knows them; `hue` is derived, everything else is real. */
export interface ChatPerson {
  id: string
  /** `full_name` from the HR directory, or the raw id when it publishes none. */
  name: string
  /** True when `name` is a real published name rather than the fallback id. */
  named: boolean
  /** `position` from the HR directory — the hub's own job title. */
  role?: string
  /** `department` from the HR directory. */
  department?: string
  hue: string
}

/**
 * One emoji reaction on a record comment. Go stores reactions as
 * `map[emoji][]user_id`, so the reactor list is real — the count is its length
 * and `mine` is membership, never a separate server field.
 */
export interface Reaction {
  emoji: string
  count: number
  mine: boolean
  /** The user ids the hub recorded against this emoji. */
  userIds: string[]
}

/** A file the hub attached to a message. */
export interface MessageAttachment {
  id: string
  fileName: string
  contentType?: string
  sizeBytes?: number
  url?: string
}

export interface Message {
  id: string
  /** '' for a hub system event (`is_system` / a system channel message). */
  authorId: string
  /** Minutes since the message was sent. */
  age: number
  text: string
  /** A hub system event — rendered as a centred note, not a person's turn. */
  isSystem?: boolean
  /** `event_type` on a records system comment (created|status_changed|…). */
  eventType?: string
  /** Channel `thread_root_id`: the message this one is threaded under. */
  replyToId?: string
  /** Resolved user ids the author mentioned (channels only). */
  mentions?: string[]
  reactions?: Reaction[]
  attachments?: MessageAttachment[]
  /** The opening post of a DM record cannot be reacted to or deleted. */
  isOpener?: boolean
}

/** An explicit channel membership: `member` or `admin`. */
export interface ChannelMember {
  id: string
  role: string
}

/** A team channel from `/api/v1/channels`. */
export interface Channel {
  id: string
  name: string
  /** The channel's own `description`; empty when the hub has none. */
  description: string
  /** `public` | `private`. */
  privacy: string
  /** `store` | `dc` | `hq`, plus the scope id it is pinned to. */
  scopeType: string
  scopeId: string
  members: ChannelMember[]
  memberIds: string[]
  unread?: number
  archived: boolean
}

export type ConversationId = string

/** A `kind: "dm"` record — the Records hub's direct-message lens. */
export interface DirectConversation {
  id: ConversationId
  /** The counterpart the hub named (watcher, or the requester when not you). */
  partnerId?: string
  partnerName: string
  /** The record's `title` — the DM's subject line. */
  title: string
  messages: Message[]
  updatedAt: string
  /** Record lifecycle status; `open` is the only legal DM status. */
  status: string
  /** `routing.queue` — the team this thread was addressed to, if any. */
  queue?: string
  tags: string[]
  /** True while the conversation exists only in the composer, unsent. */
  draft?: boolean
}

/**
 * A quick-pick palette for the reaction bar. Go stores reactions under an
 * arbitrary emoji key (`map[string][]string`) and validates nothing, so this
 * list is only what the toolbar offers — it is not a contract limit, and any
 * emoji the hub already holds renders whether or not it appears here.
 */
export const QUICK_REACTIONS = ["👍", "❤️", "🎉", "😄", "🙏", "👀"]

const HUES = [
  "#7b5cfa",
  "#0086fc",
  "#00c978",
  "#ff58ae",
  "#ffbb26",
  "#64c6ff",
  "#ff3e00",
]

/** Stable per-person accent so an avatar keeps its colour across reloads. */
export function hueFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return HUES[hash % HUES.length]
}

/**
 * The label for a user id the HR directory does not cover. The hub publishes no
 * name for these, so the raw id is shown as-is rather than de-slugged into
 * something that would read as a person's name.
 */
export function fallbackName(id: string): string {
  return id || "unknown"
}

/** The avatar glyph: an initial for a named person, else the id's first char. */
export function avatarGlyph(person: ChatPerson): string {
  return (person.name[0] ?? "?").toUpperCase()
}

export type ChatDirectory = Record<string, ChatPerson>

export const ChatDirectoryContext = createContext<ChatDirectory>({})

export function useChatDirectory(): ChatDirectory {
  return useContext(ChatDirectoryContext)
}

export function unknownPerson(id: string): ChatPerson {
  return { id, name: fallbackName(id), named: false, hue: hueFor(id) }
}

export function usePerson(id: string, name?: string): ChatPerson {
  const directory = useChatDirectory()
  const known = directory[id]
  if (known) return name ? { ...known, name } : known
  return name
    ? { id, name, named: true, hue: hueFor(id) }
    : unknownPerson(id)
}

export function conversationTitle(id: ConversationId) {
  return id || "Conversation"
}

/** Compact relative time for the sidebar and message meta. */
export function ago(minutes: number) {
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / (60 * 24))}d`
}

/** Clock time, for the per-message stamp. */
export function clock(minutes: number) {
  const d = new Date(Date.now() - minutes * 60000)
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

/** Which day a message belongs to, for the stream's dividers. */
export function dayKey(minutes: number) {
  const d = new Date(Date.now() - minutes * 60000)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function dayLabel(minutes: number) {
  const key = dayKey(minutes)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - key) / 86400000)
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  return new Date(key).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  })
}
