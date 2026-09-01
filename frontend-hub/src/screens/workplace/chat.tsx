import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  chatAttachmentUrl,
  conversationFiles,
  listConversations,
  markRead,
  readConversation,
  readMessages,
  sendMessage,
  workplaceKeys,
} from "@/lib/queries/workplace"
import { useIdentity } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import { useAttachments } from "@/screens/workplace/attachments"
import {
  ago,
  bytes,
  clock,
  conversationName,
  dayOf,
  idempotencyKey,
} from "@/screens/workplace/lib"
import { useCollaborationFeed } from "@/screens/workplace/live"
import {
  AttachmentLink,
  Avatar,
  Composer,
  FileTile,
  VirtualList,
} from "@/screens/workplace/parts"
import type { ChatConversation, ChatMessage } from "@itulah/contract"

/// Chat — correspondence, as opposed to the record a discussion is.
///
/// Two panes rather than a list and a sheet, and the difference is deliberate:
/// a conversation is not a record you glance into and dismiss, it is where you
/// stay while you read. So the rooms sit on the left, the messages fill the
/// right, and the composer is pinned at the foot of the pane the way DESIGN.md
/// pins it to a detail rail.
///
/// Which conversation is open still lives in the URL — `?conversation=` — so a
/// room can be linked to, survives a reload, and can be opened by the palette.
///
/// Nothing here holds a socket. `GET /chat/events` is polled by
/// `useCollaborationFeed`, which invalidates this screen's keys as messages
/// arrive; the read marks and the unread counts are the server's arithmetic,
/// never recomputed here.

export function Chat() {
  const conversation = useSheet("conversation")
  const [search, setSearch] = useState("")
  const identity = useIdentity()
  const me = identity.data?.username

  // Mounted here as well as on Discussions: the poll is what keeps this screen
  // live, and a cursor that only advanced on the other screen would leave this
  // one refreshing on nothing.
  useCollaborationFeed()

  const conversations = useQuery({
    queryKey: workplaceKeys.conversations(),
    queryFn: ({ signal }) => listConversations(signal),
  })

  const rooms = useMemo(() => {
    const all = conversations.data ?? []
    const needle = search.trim().toLowerCase()
    if (needle === "") return all
    return all.filter(
      (room) =>
        conversationName(room, me).toLowerCase().includes(needle) ||
        room.participants.some((name) => name.toLowerCase().includes(needle)) ||
        (room.preview?.toLowerCase().includes(needle) ?? false)
    )
  }, [conversations.data, search, me])

  const unread = (conversations.data ?? []).reduce(
    (total, room) => total + room.unread_count,
    0
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Workplace"
        title="Chat"
        sub="Correspondence between people, not a record of a decision."
        actions={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search rooms"
              className="h-8 w-48"
            />
            {unread > 0 && (
              <Pill tone="accent" withDot>
                {count(unread)} unread
              </Pill>
            )}
          </>
        }
      />

      <Card className="flex h-[calc(100vh-11.5rem)] overflow-hidden">
        <div className="flex w-[19rem] shrink-0 flex-col border-r border-hairline">
          {queryState(conversations, {
            loading: "Loading the rooms…",
            render: () =>
              rooms.length === 0 ? (
                <EmptyState>
                  {search.trim() === ""
                    ? "You are not in any conversation yet."
                    : "No room matches that."}
                </EmptyState>
              ) : (
                <VirtualList
                  items={rooms}
                  estimate={64}
                  getKey={(room) => room.conversation_id}
                  className="flex-1"
                >
                  {(room) => (
                    <RoomRow
                      room={room}
                      me={me}
                      selected={room.conversation_id === conversation.value}
                      onOpen={() => conversation.open(room.conversation_id)}
                    />
                  )}
                </VirtualList>
              ),
          })}
        </div>

        {conversation.value === undefined ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState>
              Pick a conversation on the left. The one you open goes in the
              address bar, so it can be sent to somebody.
            </EmptyState>
          </div>
        ) : (
          // Keyed by the room: the read mark this browser has already
          // posted, the open sub-tab and any uploaded-but-unsent attachment all
          // belong to one conversation and must not follow you into the next.
          <Room key={conversation.value} id={conversation.value} me={me} />
        )}
      </Card>
    </PageContent>
  )
}

function RoomRow({
  room,
  me,
  selected,
  onOpen,
}: {
  room: ChatConversation
  me: string | undefined
  selected: boolean
  onOpen: () => void
}) {
  const name = conversationName(room, me)
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-2.5 border-b border-hairline px-3.5 py-2.5 text-left transition-colors",
        selected ? "bg-accent-bg" : "hover:bg-soft"
      )}
    >
      <Avatar name={name} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-meta font-medium text-ink">
            {name}
          </span>
          <span className="shrink-0 text-pill text-mute">
            {ago(room.last_activity_at)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-pill text-body">
            {room.preview === null
              ? "Nobody has said anything yet."
              : `${room.preview_author ?? ""}${room.preview_author ? ": " : ""}${room.preview}`}
          </span>
          {room.unread_count > 0 && (
            <Pill tone="accent">{count(room.unread_count)}</Pill>
          )}
        </span>
      </span>
    </button>
  )
}

const ROOM_TABS = [
  { value: "messages", label: "Messages" },
  { value: "files", label: "Files" },
] as const

/// One conversation: its header, the thread, and the composer at the foot.
function Room({ id, me }: { id: string; me: string | undefined }) {
  const client = useQueryClient()
  const attachments = useAttachments()
  const [tab, setTab] = useState<"messages" | "files">("messages")

  const detail = useQuery({
    queryKey: workplaceKeys.conversation(id),
    queryFn: ({ signal }) => readConversation(id, signal),
  })

  const messages = useQuery({
    queryKey: workplaceKeys.messages(id),
    queryFn: ({ signal }) => readMessages(id, signal),
  })

  const files = useQuery({
    queryKey: workplaceKeys.conversationFiles(id),
    queryFn: ({ signal }) => conversationFiles(id, signal),
    // The panel beside the thread, fetched when somebody asks for it rather
    // than alongside every conversation they click through.
    enabled: tab === "files",
  })

  const send = useMutation({
    mutationFn: (body: string) =>
      sendMessage(id, {
        body,
        // Minted per attempt of *this* send. A retry of the same mutation
        // carries the same key, so a dropped connection cannot write the
        // message twice — the server answers with the one it already wrote.
        idempotency_key: idempotencyKey(),
        reply_to_seq: null,
        attachments: attachments.ids,
      }),
    onSuccess: () => {
      attachments.clear()
      void client.invalidateQueries({ queryKey: workplaceKeys.messages(id) })
      void client.invalidateQueries({
        queryKey: workplaceKeys.conversationFiles(id),
      })
      // The room's preview and its position in the list both just changed.
      void client.invalidateQueries({ queryKey: workplaceKeys.conversations() })
      void client.invalidateQueries({
        queryKey: workplaceKeys.conversation(id),
      })
      // A message with a file on it is a new row on the Files screen.
      void client.invalidateQueries({ queryKey: workplaceKeys.files() })
    },
  })

  const read = useMutation({
    mutationFn: (seq: number) => markRead(id, seq),
    onSuccess: (updated) => {
      // The server answers with the conversation, so the unread count is its
      // arithmetic. Written straight into the cache rather than refetched: the
      // answer in hand IS the new row.
      client.setQueryData(workplaceKeys.conversation(id), updated)
      void client.invalidateQueries({ queryKey: workplaceKeys.conversations() })
    },
  })

  const rows = useMemo(() => messages.data ?? [], [messages.data])
  const newest = rows.length > 0 ? rows[rows.length - 1].seq : 0
  const conversation = detail.data

  // Where reading had stopped when this room was opened, frozen before the
  // effect below moves the mark to the end. Without freezing it the "New" line
  // would be drawn and erased in the same second, which is the one moment it is
  // actually useful.
  //
  // State adjusted during render rather than a ref written during render: React
  // supports this — it re-renders immediately without committing the first pass
  // — and unlike a ref it cannot tear under concurrent rendering. It cannot be
  // a lazy initialiser either: the conversation is not in hand on the first
  // render of a cold open, which is exactly the case the "New" line is for.
  const [markOnOpen, setMarkOnOpen] = useState<number | null>(null)
  if (markOnOpen === null && conversation !== undefined) {
    setMarkOnOpen(conversation.last_read_seq)
  }

  // Reading a conversation is what moves the read mark, so this is a side
  // effect of looking rather than of clicking anything. The ref stops a second
  // post while the first is in flight, and the `>=` guard stops the loop the
  // invalidation above would otherwise start: once the server says the mark is
  // at `newest`, there is nothing left to move.
  const posted = useRef(0)
  useEffect(() => {
    if (conversation === undefined || newest === 0) return
    if (conversation.last_read_seq >= newest) return
    if (posted.current >= newest) return
    posted.current = newest
    read.mutate(newest)
  }, [conversation, newest, read])

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {queryState(detail, {
        loading: "Loading the conversation…",
        render: (room) => (
          <div className="flex shrink-0 items-start gap-2.5 border-b border-hairline px-5 py-3">
            <Avatar name={conversationName(room, me)} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-card-title font-semibold text-ink">
                {conversationName(room, me)}
              </h2>
              <p className="mt-0.5 truncate text-pill text-mute">
                {room.participants.join(" · ")} · read to{" "}
                {count(room.last_read_seq)} of {count(room.latest_message_seq)}
              </p>
            </div>
            <Tag tone={room.kind === "GROUP" ? "accent" : "neutral"}>
              {room.kind}
            </Tag>
          </div>
        ),
      })}

      <div className="px-5 pt-3">
        <SubTabs
          tabs={ROOM_TABS}
          value={tab}
          onChange={(next) => setTab(next as "messages" | "files")}
          className="mb-0"
        />
      </div>

      {tab === "messages" ? (
        <>
          <div className="flex min-h-0 flex-1 flex-col">
            {queryState(messages, {
              loading: "Loading the messages…",
              render: (list) =>
                list.length === 0 ? (
                  <EmptyState>Nobody has said anything in here yet.</EmptyState>
                ) : (
                  <VirtualList
                    items={list}
                    estimate={72}
                    stickToEnd
                    getKey={(message) => message.message_id}
                    className="flex-1 px-5 py-3"
                  >
                    {(message, index) => (
                      <Message
                        message={message}
                        conversationId={id}
                        mine={message.author === me}
                        showDay={
                          index === 0 ||
                          dayOf(list[index - 1].sent_at) !==
                            dayOf(message.sent_at)
                        }
                        unreadFrom={markOnOpen ?? 0}
                      />
                    )}
                  </VirtualList>
                ),
            })}
          </div>

          <div className="shrink-0 border-t border-hairline px-5 py-3">
            {attachments.problem && (
              <Banner tone="bad" className="mb-2">
                {attachments.problem}
              </Banner>
            )}
            {send.error instanceof Error && (
              <Banner tone="bad" className="mb-2">
                {send.error.message}
              </Banner>
            )}
            <Composer
              placeholder="Write a message"
              busy={send.isPending}
              uploading={attachments.uploading}
              attachments={attachments.pending}
              onAttach={attachments.add}
              onRemoveAttachment={attachments.remove}
              onSend={(body) => send.mutate(body)}
            />
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {queryState(files, {
            loading: "Loading the files…",
            render: (stored) =>
              stored.length === 0 ? (
                <EmptyState>
                  Nothing has been attached in this conversation.
                </EmptyState>
              ) : (
                <MiniTable head={["File", "Uploaded by", "Size", "When"]}>
                  {stored.map((file) => (
                    <tr key={file.file_id} className="border-t border-hairline">
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-2.5">
                          <FileTile name={file.file_name} />
                          <div className="min-w-0">
                            {/* The file's other home. `source_id` on the Files
                                screen is this conversation, so the two cross
                                into each other rather than dead-ending. */}
                            <AppLink
                              to="/workplace/files"
                              sheet={{ key: "file", value: file.file_id }}
                              className="block truncate text-[0.8125rem] text-ink hover:text-accent"
                            >
                              {file.file_name}
                            </AppLink>
                            <a
                              href={chatAttachmentUrl(id, file.file_id)}
                              className="font-mono text-[0.65625rem] text-mute hover:text-accent"
                            >
                              {file.available
                                ? "download"
                                : "the bytes are gone"}
                            </a>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 text-right text-[0.78125rem]">
                        {file.uploaded_by}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {bytes(file.byte_size)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {ago(file.uploaded_at)}
                      </td>
                    </tr>
                  ))}
                </MiniTable>
              ),
          })}
        </div>
      )}
    </div>
  )
}

function Message({
  message,
  conversationId,
  mine,
  showDay,
  unreadFrom,
}: {
  message: ChatMessage
  conversationId: string
  mine: boolean
  showDay: boolean
  /// The server's read mark. The first message past it gets the line, which is
  /// where a person picks the conversation back up.
  unreadFrom: number
}) {
  const isFirstUnread = !mine && message.seq === unreadFrom + 1
  return (
    <div className="pb-2.5">
      {showDay && (
        <div className="mb-2.5 flex items-center gap-2">
          <span className="h-px flex-1 bg-hairline" />
          <span className="text-pill text-mute">{dayOf(message.sent_at)}</span>
          <span className="h-px flex-1 bg-hairline" />
        </div>
      )}
      {isFirstUnread && (
        <div className="mb-2.5 flex items-center gap-2">
          <span className="h-px flex-1 bg-accent" />
          <span className="text-pill font-medium text-accent">New</span>
          <span className="h-px flex-1 bg-accent" />
        </div>
      )}

      <div className={cn("flex gap-2", mine && "flex-row-reverse")}>
        {!mine && <Avatar name={message.author} size="sm" className="mt-4" />}
        <div className={cn("max-w-[80%] min-w-0", mine && "items-end")}>
          <div
            className={cn(
              "flex items-baseline gap-2",
              mine && "flex-row-reverse"
            )}
          >
            <span className="text-pill font-medium text-body">
              {mine ? "You" : message.author}
            </span>
            <span className="text-pill text-mute tabular-nums">
              {clock(message.sent_at)}
            </span>
          </div>
          <div
            className={cn(
              "mt-1 rounded-inner px-3 py-2 text-[0.84375rem] leading-relaxed whitespace-pre-wrap",
              // Indigo is "mine" the way it is "selected" everywhere else.
              // Nothing darkens: the other person's bubble is the soft grey,
              // never a filled dark one.
              mine ? "bg-accent-bg text-ink" : "bg-soft-2 text-text"
            )}
          >
            {message.body}
          </div>

          {message.attachments.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-1.5">
              {message.attachments.map((file) => (
                <AttachmentLink
                  key={file.file_id}
                  name={file.file_name}
                  size={file.byte_size}
                  available={file.available}
                  href={chatAttachmentUrl(conversationId, file.file_id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
