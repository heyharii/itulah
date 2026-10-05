import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { cloud, CENTRAL_KEY_PREFIX } from "@/lib/cloud"
import type {
  ChatConversation,
  ChatMessage,
  SendMessageRequest,
  StartConversationRequest,
  DiscussionPerson,
} from "@itulah/contract"

/// Chat with head office, through the node's relay — the hub's own endpoints
/// (`frontend-hub/src/lib/queries/workplace.ts`), spelled the same so the two
/// can be compared by eye. Text only: no attachments, reactions or edits.

const ROOT = [CENTRAL_KEY_PREFIX, "chat"] as const
export const chatKeys = {
  conversations: () => [...ROOT, "conversations"] as const,
  messages: (id: string) => [...ROOT, "conversations", id, "messages"] as const,
  people: () => [...ROOT, "people"] as const,
}

/// How often the open thread and the list ask again. Polled, not streamed:
/// the relay is request/response, and a shop reads this when it has a moment.
/// react-query pauses both while the tab is hidden.
const THREAD_POLL_MS = 5_000
const LIST_POLL_MS = 20_000

const path = (id: string) =>
  `/api/v1/chat/conversations/${encodeURIComponent(id)}`

export function useConversations(enabled = true) {
  return useQuery({
    queryKey: chatKeys.conversations(),
    queryFn: ({ signal }) =>
      cloud.get<ChatConversation[]>("/api/v1/chat/conversations", { signal }),
    refetchInterval: LIST_POLL_MS,
    enabled,
  })
}

/// The newest hundred, oldest first. Re-read whole on each poll: a hundred
/// short lines is cheaper than a cursor that has to be kept honest.
export function useThread(conversationId: string) {
  return useQuery({
    queryKey: chatKeys.messages(conversationId),
    queryFn: ({ signal }) =>
      cloud.get<ChatMessage[]>(`${path(conversationId)}/messages?limit=100`, {
        signal,
      }),
    refetchInterval: THREAD_POLL_MS,
  })
}

/// The idempotency key is minted by the composer before the first attempt, so
/// a resend after a dropped line lands once.
export function useSend(conversationId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (request: Pick<SendMessageRequest, "body" | "idempotency_key">) =>
      cloud.post<ChatMessage>(`${path(conversationId)}/messages`, {
        ...request,
        reply_to_seq: null,
        attachments: [],
      } satisfies SendMessageRequest),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: chatKeys.messages(conversationId),
      })
      void client.invalidateQueries({ queryKey: chatKeys.conversations() })
    },
  })
}

export function useMarkRead() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (args: { conversationId: string; seq: number }) =>
      cloud.post<ChatConversation>(`${path(args.conversationId)}/read`, {
        last_read_seq: args.seq,
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: chatKeys.conversations() }),
  })
}

export function useStartChat() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (request: StartConversationRequest) =>
      cloud.post<ChatConversation>("/api/v1/chat/conversations", request),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: chatKeys.conversations() }),
  })
}

/// Who a new chat can be started with — the hub's picker reads the same list.
/// Only while the picker is open.
export function usePeople(enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.people(),
    queryFn: ({ signal }) =>
      cloud.get<DiscussionPerson[]>("/api/v1/discussions/people", { signal }),
    enabled,
    staleTime: 60_000,
  })
}
