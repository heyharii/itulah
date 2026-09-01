/**
 * Wire schemas for forum's Records-hub surfaces (`/v1/records`, its detail
 * route, `/v1/records/queues`, `/v1/hr/employees` — see the header of
 * `./api.ts`).
 *
 * Two different treatments live in this file, because the calls split into
 * the recipe's two populations:
 *
 * - `RecordDetail` is attached directly via `{ schema }` to the three
 *   `api.get<ApiDetail>(...)` calls (`fetchTopicPosts`, `fetchTopic`, and
 *   inside `hydrate`). Those were an unchecked cast — nothing ever verified
 *   `detail.record` or `detail.comments` looked like what the code assumed —
 *   so this is where a wrong guess actually costs something, and it is
 *   checked (and, in dev/test, thrown) by `validateContract`.
 * - `RecordRow`, `CommentRow`, `QueueRow`, `EmployeeRow` describe the row
 *   shapes fed to `checkContract` after `listFrom()` unwraps a list
 *   response (`fetchAllRecords`, `fetchDirectory`, `fetchQueues`). Those
 *   rows already go through a defensive mapper that drops what it cannot
 *   use (`topicFromApi`, `postFromComment`, …) — `checkContract` only adds
 *   visibility into what got dropped and why.
 *
 * `RecordRow` and `CommentRow` back both treatments: the row shape a list
 * response sends is the same shape a detail response nests, so one schema
 * describes both rather than two schemas drifting apart.
 */

import { z } from "zod"

export const RecordRow = z.object({
  id: z.string().nullish(),
  kind: z.string().nullish(),
  subtype: z.string().nullish(),
  title: z.string().nullish(),
  // Free-form JSON — prose, `{description, fields[]}`, or kind-specific
  // scalars (a bill's amount/vendor). A versioned/variant shape, not a
  // type; `blocksFromBody` in api.ts already reads it defensively.
  body: z.unknown(),
  priority: z.string().nullish(),
  status: z.string().nullish(),
  tags: z.array(z.unknown()).nullish(),
  store_id: z.string().nullish(),
  requester_id: z.string().nullish(),
  anonymous: z.boolean().nullish(),
  routing: z.unknown(),
  watchers: z.array(z.unknown()).nullish(),
  due_date: z.string().nullish(),
  source: z.unknown(),
  created_by: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  closed_at: z.string().nullish(),
})
export type RecordRow = z.infer<typeof RecordRow>

export const CommentRow = z.object({
  id: z.string().nullish(),
  record_id: z.string().nullish(),
  author_id: z.string().nullish(),
  body: z.unknown(),
  is_system: z.boolean().nullish(),
  event_type: z.string().nullish(),
  // `map[emoji][]user_id`.
  reactions: z.unknown(),
  created_at: z.string().nullish(),
})
export type CommentRow = z.infer<typeof CommentRow>

export const QueueRow = z.object({
  value: z.string().nullish(),
  label: z.string().nullish(),
})
export type QueueRow = z.infer<typeof QueueRow>

export const EmployeeRow = z.object({
  id: z.string().nullish(),
  full_name: z.string().nullish(),
  employee_code: z.string().nullish(),
})
export type EmployeeRow = z.infer<typeof EmployeeRow>

/**
 * `GET /v1/records/{id}` — `{record, comments, attachments}`. This is the
 * cast population: the whole object was previously handed straight to the
 * caller as `ApiDetail` with nothing checking it. `attachments` stays
 * `z.unknown()` per row because nothing in this domain reads its shape —
 * only `.length` (see `blocksFromBody`/detail callers) — so describing it
 * further would be asserting a fact this code does not depend on.
 */
export const RecordDetail = z.object({
  record: RecordRow.nullish(),
  comments: z.array(CommentRow).nullish(),
  attachments: z.array(z.unknown()).nullish(),
})
export type RecordDetail = z.infer<typeof RecordDetail>
