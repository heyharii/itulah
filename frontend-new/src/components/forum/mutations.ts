/**
 * Forum's write boundary, built directly on TanStack Query's `useMutation` —
 * with no wrapper in between.
 *
 * Two writes, two different shapes from the docs/frontend-rules.md §M3 table:
 *
 *  - `useCreateTopic` backs the "New topic" sheet (`NewTopicSheet` in
 *    forum.tsx), which closes the moment the record is created and navigates
 *    the reader straight to it. There is nothing left on screen for an
 *    optimistic write to update — the "sheet that closes on success" row —
 *    so this is "Neither": `onSettled` invalidation only.
 *
 *  - `usePostReply` is the textbook variables-based case the rules call out
 *    by name: the thread stays open, the reply appears in exactly one place
 *    (the post stream the reader is already looking at), and the worst case
 *    of getting it wrong is a flicker once the real row lands. `forum.tsx`
 *    reads `variables` and `isPending` off the mutation to render the
 *    reader's own reply inline before the server round-trip completes,
 *    rather than mutating any cache. No `onMutate`, no snapshot, no
 *    rollback — that machinery is for the cache-based shape, and this isn't
 *    it.
 *
 * Both invalidate the whole `["forum"]` namespace on settle: a reply changes
 * the row's counter on the board as well as the thread, and opening a topic
 * changes the board too. That is the actual blast radius (§M2), not a
 * shortcut — see the reasoning already recorded in `./api`.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { createTopic, postReply, type NewTopicInput } from "./api"
import { forumQueries } from "./queries"

/** Opens a topic; the board it lands on refetches itself. */
export function useCreateTopic() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: NewTopicInput) => createTopic(input),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: forumQueries.all() })
    },
  })
}

export interface PostReplyInput {
  topicId: string
  body: string
}

/**
 * Posts a reply. Both the thread and the row's reply counter changed, so the
 * whole forum namespace is invalidated — same reasoning `useCreateTopic`
 * uses.
 *
 * No cache write happens here: the variables-based shape means the caller
 * renders its own pending row from `variables`/`isPending`, and the eventual
 * `onSettled` refetch is what replaces it with the server's real post (with
 * its real id and timestamp — §M5, never guessed here).
 */
export function usePostReply() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: PostReplyInput) => postReply(input.topicId, input.body),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: forumQueries.all() })
    },
  })
}
