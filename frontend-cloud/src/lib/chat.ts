import { node } from "@/lib/api"
import { subscribeToCollaboration } from "@/lib/collaboration"
import type {
  ChatConversation,
  ChatMessage,
  MarkReadRequest,
  SendMessageRequest,
  StartConversationRequest,
  StoredFile,
} from "@itulah/contract"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

export const conversationsKey = () => ["chat", "conversations"] as const
export const conversationKey = (conversationId: string) =>
  ["chat", "conversation", conversationId] as const
export const messagesKey = (conversationId: string) =>
  ["chat", "messages", conversationId] as const
export const conversationFilesKey = (conversationId: string) =>
  ["chat", "conversation-files", conversationId] as const

export function listConversations(signal?: AbortSignal): Promise<ChatConversation[]> {
  return node.get<ChatConversation[]>("/api/v1/chat/conversations", { signal })
}

export function readConversation(
  conversationId: string,
  signal?: AbortSignal,
): Promise<ChatConversation> {
  return node.get<ChatConversation>(
    `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}`,
    { signal },
  )
}

export function readMessages(
  conversationId: string,
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  return node.get<ChatMessage[]>(
    `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
    { signal },
  )
}

export function startConversation(
  request: StartConversationRequest,
): Promise<ChatConversation> {
  return node.post<ChatConversation>("/api/v1/chat/conversations", request)
}

export function sendMessage(
  conversationId: string,
  request: SendMessageRequest,
): Promise<ChatMessage> {
  return node.post<ChatMessage>(
    `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
    request,
  )
}

/// Move the read mark. The server answers with the conversation, so the unread
/// count on screen is the server's arithmetic and not a second copy of it.
export function markRead(
  conversationId: string,
  lastReadSeq: number,
): Promise<ChatConversation> {
  const request: MarkReadRequest = { last_read_seq: lastReadSeq }
  return node.post<ChatConversation>(
    `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/read`,
    request,
  )
}

export function conversationFiles(
  conversationId: string,
  signal?: AbortSignal,
): Promise<StoredFile[]> {
  return node.get<StoredFile[]>(
    `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/files`,
    { signal },
  )
}

/// Where an attachment's bytes come from.
///
/// The conversation id in the path is the permission, not decoration — the
/// server checks the caller is in the room before it reads a byte. There is no
/// `/files/{id}` to link to instead, deliberately: a URL that worked on its own
/// could be pasted to somebody who was never in the conversation.
export function attachmentUrl(conversationId: string, fileId: string): string {
  return `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(fileId)}`
}

/// An idempotency key, minted before the first attempt rather than at the
/// moment of sending.
///
/// This is what makes drawing the message immediately safe. If the connection
/// drops between the request leaving and the answer arriving, the retry carries
/// the same key and the server returns the message it already wrote instead of
/// writing a second one. Generated where the message is composed, so a resend
/// cannot accidentally mint a fresh one.
export function idempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `im-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

/// What a conversation is called for the person reading it.
///
/// A direct conversation has no name of its own — the server leaves `title`
/// resolved per reader, and this is that resolution for the rare case where
/// the field arrives empty: the other person's name.
export function conversationName(
  conversation: ChatConversation,
  me: string | undefined,
): string {
  if (conversation.title.trim() !== "") return conversation.title
  const other = conversation.participants.filter((name) => name !== me)
  return other.length > 0 ? other.join(", ") : conversation.participants.join(", ")
}

/// Keep the conversation list and any open thread current from the stream.
///
/// The event carries the conversation id, so a message in a room this browser
/// is not looking at moves the unread count and nothing else. Refetching the
/// open thread on every arrival regardless would make somebody else's busy
/// group reload the one you are reading.
export function useChatEvents(openConversationId?: string) {
  const queryClient = useQueryClient()
  useEffect(() => {
    return subscribeToCollaboration("chat.message", (event) => {
      const payload = event.payload as { conversation_id?: string } | null
      const conversationId = payload?.conversation_id
      void queryClient.invalidateQueries({ queryKey: conversationsKey() })
      if (conversationId === undefined) return
      if (conversationId === openConversationId) {
        void queryClient.invalidateQueries({ queryKey: messagesKey(conversationId) })
        void queryClient.invalidateQueries({ queryKey: conversationFilesKey(conversationId) })
      }
    })
  }, [queryClient, openConversationId])
}
