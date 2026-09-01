/**
 * Wire schemas for the chat-app's three real backend surfaces (channels,
 * DM records, and the HR directory — see the header of `./api.ts`).
 *
 * Every GET here already goes `api.get<unknown>` into `listOf<T>()`, whose
 * row type (`Api*` in api.ts) is a bag of `?: unknown` fields, then into a
 * per-row mapper (`personFrom`, `channelFrom`, …) that returns `null` for a
 * row it cannot use and gets filtered out. That is already safe at runtime —
 * a malformed row just vanishes. What it is not is *observable*: nothing
 * records that it happened. These schemas exist to be run through
 * `checkContract` right after `listOf`, so a silently dropped row shows up
 * in the console instead of just shrinking a list by one.
 *
 * Field names match the wire (snake_case), and every field is optional or
 * nullish here even where the mapper effectively requires it (e.g. an id) —
 * the mapper's own `if (!id) return null` is the real gate. Being any
 * stricter here would just duplicate that check in a second vocabulary.
 */

import { z } from "zod"

export const ChatEmployeeRow = z.object({
  id: z.string().nullish(),
  full_name: z.string().nullish(),
  position: z.string().nullish(),
  department: z.string().nullish(),
  status: z.string().nullish(),
})
export type ChatEmployeeRow = z.infer<typeof ChatEmployeeRow>

export const ChannelRow = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  privacy: z.string().nullish(),
  scope_type: z.string().nullish(),
  scope_id: z.string().nullish(),
  created_by: z.string().nullish(),
  created_at: z.string().nullish(),
  archived_at: z.string().nullish(),
})
export type ChannelRow = z.infer<typeof ChannelRow>

export const ChannelMemberRow = z.object({
  user_id: z.string().nullish(),
  role: z.string().nullish(),
  removed_at: z.string().nullish(),
})
export type ChannelMemberRow = z.infer<typeof ChannelMemberRow>

export const ChannelMessageRow = z.object({
  id: z.string().nullish(),
  channel_id: z.string().nullish(),
  author_id: z.string().nullish(),
  body: z.string().nullish(),
  thread_root_id: z.string().nullish(),
  is_system: z.boolean().nullish(),
  mentions: z.array(z.unknown()).nullish(),
  attachments: z.array(z.unknown()).nullish(),
  created_at: z.string().nullish(),
  edited_at: z.string().nullish(),
  deleted_at: z.string().nullish(),
})
export type ChannelMessageRow = z.infer<typeof ChannelMessageRow>

/**
 * A `/v1/records?kind=dm` row. Forum's `/v1/records` is the same Records-hub
 * engine and the same wire object, but declares its own `RecordRow` in
 * forum/contracts.ts — it reads a wider set of fields (`priority`,
 * `store_id`, `due_date`, `source`, `closed_at`) that a DM row never carries.
 * Two schemas of the same backend shape, each scoped to what its domain
 * actually reads, rather than one shared schema neither owns.
 */
export const RecordRow = z.object({
  id: z.string().nullish(),
  kind: z.string().nullish(),
  subtype: z.string().nullish(),
  title: z.string().nullish(),
  // Raw JSON: bare prose or `{ text }`, per `bodyText` in api.ts. Not
  // narrowed further — a versioned shape, not a type, per the recipe.
  body: z.unknown(),
  status: z.string().nullish(),
  tags: z.array(z.unknown()).nullish(),
  requester_id: z.string().nullish(),
  anonymous: z.boolean().nullish(),
  routing: z.unknown(),
  watchers: z.array(z.unknown()).nullish(),
  created_by: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
})
export type RecordRow = z.infer<typeof RecordRow>

export const CommentRow = z.object({
  id: z.string().nullish(),
  record_id: z.string().nullish(),
  author_id: z.string().nullish(),
  body: z.string().nullish(),
  is_system: z.boolean().nullish(),
  event_type: z.string().nullish(),
  // `map[emoji][]user_id` — an object keyed by emoji, not a fixed shape.
  reactions: z.unknown(),
  created_at: z.string().nullish(),
})
export type CommentRow = z.infer<typeof CommentRow>

export const AttachmentRow = z.object({
  id: z.string().nullish(),
  comment_id: z.string().nullish(),
  file_name: z.string().nullish(),
  content_type: z.string().nullish(),
  size_bytes: z.number().nullish(),
  url: z.string().nullish(),
})
export type AttachmentRow = z.infer<typeof AttachmentRow>
