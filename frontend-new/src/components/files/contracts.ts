/**
 * Wire schemas for the Document Library (`/v1/documents/library` and its
 * `/facets` route — see the header of `./api.ts`).
 *
 * Both GETs here are `api.get<unknown>` feeding a defensive mapper:
 * `itemsFrom`/`record?.folders` unwrap the list, then `toNode`/`toFolderNode`
 * map each row and return `null` for one they cannot use, which gets
 * filtered out. These schemas are checked against the unwrapped rows via
 * `checkContract`, which only reports — nothing here can turn a bad row into
 * a thrown error, matching what the mapper already does silently.
 *
 * The drive fields (`folder_id`, `trashed_at`, `favourite`, `shared_with`, …)
 * are absent on a hub without migration 734, by design (see api.ts) — hence
 * `.nullish()` on all of them rather than treating an older hub's response as
 * a violation of the schema.
 */

import { z } from "zod"

export const LibraryItemRow = z.object({
  attachment_id: z.string().nullish(),
  record_id: z.string().nullish(),
  file_name: z.string().nullish(),
  content_type: z.string().nullish(),
  size_bytes: z.number().nullish(),
  blob_key: z.string().nullish(),
  url: z.string().nullish(),
  uploaded_by: z.string().nullish(),
  uploaded_at: z.string().nullish(),
  title: z.string().nullish(),
  status: z.string().nullish(),
  tags: z.array(z.unknown()).nullish(),
  source_domain: z.string().nullish(),
  source_entity_type: z.string().nullish(),
  source_entity_id: z.string().nullish(),
  has_text: z.boolean().nullish(),
  text_status: z.string().nullish(),
  extracted_at: z.string().nullish(),
  doc_title: z.string().nullish(),
  doc_summary: z.string().nullish(),
  doc_date: z.string().nullish(),
  doc_language: z.string().nullish(),
  content_url: z.string().nullish(),
  // ── drive fields (migration 734; absent on an older hub) ──
  folder_id: z.string().nullish(),
  trashed_at: z.string().nullish(),
  trashed_by: z.string().nullish(),
  favourite: z.boolean().nullish(),
  shared_with: z.array(z.unknown()).nullish(),
  shared_with_me: z.boolean().nullish(),
})
export type LibraryItemRow = z.infer<typeof LibraryItemRow>

export const FolderRow = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  parent_id: z.string().nullish(),
  created_by: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  trashed_at: z.string().nullish(),
  file_count: z.number().nullish(),
})
export type FolderRow = z.infer<typeof FolderRow>

/**
 * `/v1/documents/library/facets`. A single object of distinct value lists,
 * not a row list — checked via `checkContract` with the payload wrapped in a
 * one-element array, so it shares the same never-throwing reporter as the
 * row lists above instead of a second mechanism just for this one endpoint.
 */
export const FacetsPayload = z.object({
  domains: z.array(z.unknown()).nullish(),
  types: z.array(z.unknown()).nullish(),
  statuses: z.array(z.unknown()).nullish(),
  tags: z.array(z.unknown()).nullish(),
})
export type FacetsPayload = z.infer<typeof FacetsPayload>
