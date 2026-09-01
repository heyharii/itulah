/**
 * Chat's write boundary, built directly on TanStack Query's `useMutation` —
 * with no wrapper in between.
 *
 * Three writes, two shapes:
 *
 *  - `useSendChatMessage` is the strongest variables-based case in the app
 *    (docs/frontend-rules.md §M3): the composer stays open on the same
 *    thread, the new message shows in exactly one place — the stream the
 *    reader is already looking at — and the message list is not
 *    loader-prefetched (see `chat-app/queries.ts`), so there is nothing
 *    stale to protect against, only a request to wait out. `chat.tsx` reads
 *    `variables`/`isPending` off this mutation to render the reader's own
 *    message inline before the round trip completes. No cache write happens
 *    here — the eventual `onSettled` refetch replaces the placeholder with
 *    the server's row, with its real id and timestamp (§M5).
 *
 *  - `useToggleDirectReaction` and `useCreateDirectConversation` stay
 *    "Neither". A reaction's reactor is derived from session claims the
 *    API-key session does not have, so the hub can legitimately 401 it —
 *    `chat.tsx` already shows the server's own error rather than a toggle
 *    this app guessed at, which is the same reasoning as "wait for the
 *    server," just for a correctness reason instead of a money one.
 *    Materialising a DM record ends with the reader being navigated to the
 *    new conversation, which is the "sheet that closes on success" row of
 *    the table: nothing is left on the composer to patch.
 *
 * Keys come from `chatQueries` in `./queries` (§Q1) — not the parallel
 * `chatKeys` object that used to live in `./api` next to the write
 * calls; that duplicate is retired along with them.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"

import {
  createDirectConversation,
  sendChannelMessage,
  sendDirectMessage,
  toggleDirectReaction,
  type ConversationKind,
} from "./api"
import type { Message } from "./data"
import { chatQueries } from "./queries"

export interface SendChatMessageInput {
  body: string
  /** Channel `thread_root_id`; DM comment threads are flat and ignore it. */
  replyTo?: string
}

/** Posts into whichever mount the open conversation belongs to. */
export function useSendChatMessage(
  conversationId: string,
  kind: ConversationKind | null,
) {
  const client = useQueryClient()
  const key = chatQueries.messages(conversationId, kind).queryKey

  return useMutation<Message, Error, SendChatMessageInput>({
    mutationFn: (input) =>
      kind === "channel"
        ? sendChannelMessage(conversationId, input.body, input.replyTo)
        : sendDirectMessage(conversationId, input.body),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: key })
    },
  })
}

export interface ToggleReactionInput {
  messageId: string
  emoji: string
}

/** Reacts to a DM comment. The hub answers with the refreshed thread, but the
 *  cached list is invalidated rather than patched so the two cannot diverge. */
export function useToggleDirectReaction(recordId: string) {
  const client = useQueryClient()
  const key = chatQueries.messages(recordId, "dm").queryKey

  return useMutation<Message[], Error, ToggleReactionInput>({
    mutationFn: (input) => toggleDirectReaction(recordId, input.messageId, input.emoji),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: key })
    },
  })
}

export interface CreateDirectConversationInput {
  partnerId: string
  title: string
  body: string
}

/** Materialises a DM record. A new conversation changes the rail, so this
 *  invalidates the workspace rather than any one message list. */
export function useCreateDirectConversation() {
  const client = useQueryClient()

  return useMutation<string, Error, CreateDirectConversationInput>({
    mutationFn: (input) =>
      createDirectConversation(input.partnerId, input.title, input.body),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: chatQueries.workspace().queryKey })
    },
  })
}
