import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import { LiveBadge } from "@/components/collaboration/live-badge"
import { ConversationAside } from "@/components/chat/conversation-aside"
import { ConversationList } from "@/components/chat/conversation-list"
import { Composer } from "@/components/chat/composer"
import {
  MessageThread,
  type PendingMessage,
} from "@/components/chat/message-thread"
import { NewConversation } from "@/components/chat/new-conversation"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import {
  conversationName,
  conversationsKey,
  idempotencyKey,
  listConversations,
  markRead,
  messagesKey,
  readMessages,
  sendMessage,
  useChatEvents,
} from "@/lib/chat"
import { useCollaborationStream } from "@/lib/collaboration"
import { useIdentity } from "@/lib/identity"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import type { StoredFile } from "@itulah/contract"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { ChevronLeft, Plus } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

interface Outgoing extends PendingMessage {
  readonly conversationId: string
}

/// Conversations: the list, the thread, and who is in it.
///
/// One component behind two routes — `/chat` and `/chat/$conversationId` —
/// because they are one screen with a column selected. On a phone the columns
/// take turns: the list until a conversation is chosen, the thread after, with
/// a way back. The URL is what says which, so a conversation can be linked to
/// and survives a reload.
export function ChatView() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const identity = useIdentity()
  const me = identity.data?.username
  const { conversationId } = useParams({ strict: false }) as {
    conversationId?: string
  }
  const [starting, setStarting] = useState(false)
  const [outgoing, setOutgoing] = useState<Outgoing[]>([])
  const { status } = useCollaborationStream()

  useChatEvents(conversationId)

  const conversations = useQuery({
    queryKey: conversationsKey(),
    queryFn: ({ signal }) => listConversations(signal),
    // The stream does the work; this is the floor under it. `EventSource`
    // cannot carry the session cookie on every deployment shape, and a
    // conversation list that had quietly stopped updating would look exactly
    // like a quiet afternoon.
    refetchInterval: 120_000,
  })

  const rows = useMemo(() => conversations.data ?? [], [conversations.data])
  const conversation = rows.find((row) => row.conversation_id === conversationId)

  const messages = useQuery({
    queryKey: messagesKey(conversationId ?? ""),
    queryFn: ({ signal }) => readMessages(conversationId as string, signal),
    enabled: conversationId !== undefined,
  })

  /// Where this reader had got to when the conversation was opened.
  ///
  /// Frozen per room, for one reason: the read mark is moved to the bottom a
  /// moment after the thread appears, and a line drawn from the live value
  /// would disappear in the same breath. The server sent a position; this is
  /// the screen keeping it long enough to be worth having drawn.
  const boundaries = useRef(new Map<string, number>())
  if (conversation !== undefined && !boundaries.current.has(conversation.conversation_id)) {
    boundaries.current.set(conversation.conversation_id, conversation.last_read_seq)
  }
  const unreadFrom =
    conversationId === undefined ? undefined : boundaries.current.get(conversationId)

  const read = useMutation({
    mutationFn: (input: { conversationId: string; seq: number }) =>
      markRead(input.conversationId, input.seq),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: conversationsKey() })
    },
  })
  const readMutate = read.mutate
  useEffect(() => {
    if (conversation === undefined) return
    if (conversation.latest_message_seq <= conversation.last_read_seq) return
    readMutate({
      conversationId: conversation.conversation_id,
      seq: conversation.latest_message_seq,
    })
  }, [
    conversation?.conversation_id,
    conversation?.latest_message_seq,
    conversation?.last_read_seq,
    readMutate,
  ])

  const send = useMutation({
    mutationFn: (message: Outgoing) =>
      sendMessage(message.conversationId, {
        body: message.body,
        idempotency_key: message.idempotencyKey,
        reply_to_seq: message.replyToSeq,
        attachments: message.attachments.map((file) => file.file_id),
      }),
    onSuccess: (_written, message) => {
      setOutgoing((current) => current.filter((other) => other.key !== message.key))
      void queryClient.invalidateQueries({ queryKey: messagesKey(message.conversationId) })
      void queryClient.invalidateQueries({ queryKey: conversationsKey() })
    },
    onError: (_error, message) => {
      // Kept, not dropped. It carries the key it was first sent with, so
      // pressing send again — or the reconnect below doing it — lands once.
      setOutgoing((current) =>
        current.map((other) =>
          other.key === message.key ? { ...other, failed: true } : other,
        ),
      )
    },
  })
  const sendMutate = send.mutate

  const outgoingRef = useRef(outgoing)
  outgoingRef.current = outgoing
  const wasStatus = useRef(status)
  useEffect(() => {
    const before = wasStatus.current
    wasStatus.current = status
    // Coming back from an outage is the moment to resend what did not get out.
    // Safe to do without asking because every one of these carries the key it
    // was minted with: the server returns the message it already wrote rather
    // than writing a second one.
    if (status !== "live" || before === "live") return
    for (const message of outgoingRef.current) {
      if (!message.failed) continue
      setOutgoing((current) =>
        current.map((other) =>
          other.key === message.key ? { ...other, failed: false } : other,
        ),
      )
      sendMutate({ ...message, failed: false })
    }
  }, [status, sendMutate])

  const compose = (input: { body: string; attachments: StoredFile[] }) => {
    if (conversationId === undefined) return
    const message: Outgoing = {
      conversationId,
      key: `${conversationId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      // Minted here, before the first attempt — not inside the request. A
      // resend that generated a fresh key would write the message twice.
      idempotencyKey: idempotencyKey(),
      body: input.body,
      attachments: input.attachments,
      replyToSeq: null,
      failed: false,
    }
    setOutgoing((current) => [...current, message])
    sendMutate(message)
  }

  const known = useMemo(() => {
    const people = new Set<string>()
    for (const row of rows) for (const person of row.participants) people.add(person)
    if (me !== undefined) people.delete(me)
    return [...people]
  }, [rows, me])

  const unread = rows.reduce((total, row) => total + row.unread_count, 0)

  return (
    <AppShell nav={<Nav />}>
      <ScreenHeader
        title="Conversations"
        subtitle={
          conversations.isPending
            ? "loading…"
            : unread > 0
              ? `${unread} unread`
              : `${rows.length} open`
        }
      >
        <LiveBadge />
        <Button size="sm" onClick={() => setStarting(true)}>
          <Plus className="size-3.5" />
          New
        </Button>
      </ScreenHeader>

      <NewConversation open={starting} onOpenChange={setStarting} known={known} />

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[15rem_minmax(0,1fr)] 2xl:grid-cols-[17rem_minmax(0,1fr)_18rem]">
        <ConversationList
          conversations={rows}
          activeId={conversationId}
          me={me}
          loading={conversations.isPending}
          className={cn(conversationId === undefined ? "flex" : "hidden md:flex")}
        />

        <div
          className={cn(
            "min-h-0 flex-col",
            conversationId === undefined ? "hidden md:flex" : "flex",
          )}
        >
          {conversationId === undefined ? (
            <ScreenState>
              Pick a conversation on the left, or start a new one.
            </ScreenState>
          ) : conversations.isError ? (
            <ScreenState tone="problem">
              {conversations.error instanceof ApiError
                ? conversations.error.message
                : "The conversations could not be loaded."}
            </ScreenState>
          ) : conversation === undefined ? (
            <ScreenState tone={conversations.isPending ? "quiet" : "problem"}>
              {conversations.isPending
                ? "Loading…"
                : "That conversation is not one of yours."}
            </ScreenState>
          ) : (
            <>
              <div className="flex h-11 shrink-0 items-center gap-2 border-b px-2.5">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="md:hidden"
                  aria-label="Back to conversations"
                  onClick={() => void navigate({ to: "/chat" })}
                >
                  <ChevronLeft />
                </Button>
                <span className="truncate text-[13px] font-semibold">
                  {conversationName(conversation, me)}
                </span>
                <span className="text-muted-foreground truncate text-[11px]">
                  {conversation.kind === "DIRECT"
                    ? "Direct"
                    : conversation.participants.join(" · ")}
                </span>
              </div>

              {messages.isError ? (
                <ScreenState tone="problem">
                  {messages.error instanceof ApiError
                    ? messages.error.message
                    : "The messages could not be loaded."}
                </ScreenState>
              ) : (
                <MessageThread
                  conversationId={conversation.conversation_id}
                  me={me}
                  messages={messages.data ?? []}
                  pending={outgoing.filter(
                    (message) => message.conversationId === conversation.conversation_id,
                  )}
                  unreadFrom={unreadFrom}
                  onRetry={(message) => {
                    setOutgoing((current) =>
                      current.map((other) =>
                        other.key === message.key ? { ...other, failed: false } : other,
                      ),
                    )
                    sendMutate({ ...(message as Outgoing), failed: false })
                  }}
                />
              )}

              <Composer onSend={compose} />
            </>
          )}
        </div>

        {conversation !== undefined && (
          <ConversationAside conversation={conversation} me={me} />
        )}
      </div>
    </AppShell>
  )
}
