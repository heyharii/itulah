/**
 * Chat query options — the only place a chat cache key exists.
 *
 * There is no polling and no open connection anywhere in this domain — no
 * `setInterval`, `EventSource` or `WebSocket` — so `message-stream.tsx` is
 * just the rendering component, not a live stream. Both reads below are
 * plain one-shot fetches through the same recipe as every other domain.
 *
 * See docs/frontend-rules.md §Q1 and src/components/inventory/queries.ts for
 * the pattern this follows.
 */

import { queryOptions } from "@tanstack/react-query"

import { STALE } from "@/lib/api/stale"
import {
  fetchChannelMessages,
  fetchChatWorkspace,
  fetchDirectReplies,
  type ConversationKind,
} from "./api"

export const chatQueries = {
  all: () => ["chat"] as const,

  /** Channels, direct messages and the people directory — moves while people
   *  watch, same class as forum topics. */
  workspace: () =>
    queryOptions({
      queryKey: [...chatQueries.all(), "workspace"] as const,
      queryFn: ({ signal }) => fetchChatWorkspace(signal),
      ...STALE.operational,
    }),

  /**
   * The open conversation's messages. Channels and DM records are read
   * through different endpoints, so `kind` is part of the fetcher, not the
   * key — the id alone is what makes a thread cache hit on return.
   */
  messages: (conversationId: string, kind: ConversationKind | null) =>
    queryOptions({
      queryKey: [...chatQueries.all(), "messages", conversationId] as const,
      queryFn: ({ signal }) =>
        kind === "channel"
          ? fetchChannelMessages(conversationId, signal)
          : fetchDirectReplies(conversationId, signal),
      enabled: Boolean(conversationId) && kind !== null,
      ...STALE.operational,
    }),
}
