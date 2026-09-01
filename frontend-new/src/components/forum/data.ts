/*
 * The shapes the forum screens render, plus the small formatters they share.
 *
 * Every value in these shapes comes from the Go cloud-hub's Records engine via
 * `./api`; this module deliberately holds no fixture rows, so there is only
 * ever one authority for what the forum shows.
 */

export interface Category {
  id: string
  label: string
  hue: string
  count: number
}

export interface ForumTag {
  id: string
  label: string
  count: number
}

export interface Participant {
  id: string
  name: string
  hue: string
}

export interface Post {
  id: string
  author: Participant
  /** Minutes since the post was written. */
  age: number
  /** Simple block model, so the stream renders rich content without markdown. */
  blocks: PostBlock[]
  /** How many people reacted to this comment (records: `reactions`). */
  likes: number
}

export type PostBlock =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "quote"; author: string; text: string }

export interface Topic {
  id: string
  title: string
  /** The record's `routing.queue` — the team the thread is addressed to. */
  category: string
  /** The record kind: ticket | document | surat | bill | contract. */
  kind: string
  /** The template key the record was raised from, when it had one. */
  subtype: string
  /** The business object the record cross-links to (`source.entity_id`). */
  subjectId: string
  storeId: string
  /** The kind's own lifecycle status: open, in_progress, issued, due, … */
  status: string
  statusLabel: string
  /** True when `status` closes the record (resolved/closed/archived/paid/…). */
  terminal: boolean
  priority: string
  tags: string[]
  participants: Participant[]
  /** Human (non-system) comments on the record. */
  replies: number
  /** How many people watch this record. */
  watching: number
  /** Minutes since the last activity. */
  activity: number
  /** Minutes since the topic was opened. */
  created: number
  /** The newest reply, or the opening body when there are none. */
  preview: string
  posts: Post[]
}

/** Compact relative time for the list and post headers: 37m, 3h, 2d, 5mo. */
export function ago(minutes: number) {
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`
  if (minutes < 60 * 24 * 30) return `${Math.round(minutes / (60 * 24))}d`
  return `${Math.round(minutes / (60 * 24 * 30))}mo`
}

/** A calendar-ish label for the timeline rail. */
export function dayLabel(minutes: number) {
  const d = new Date(Date.now() - minutes * 60000)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)
