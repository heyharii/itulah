import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { MessageSquarePlus } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickMany, PickOne, type Choice } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { Segmented } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { queryState } from "@/lib/query-state"
import { listUsers, systemKeys } from "@/lib/queries/system"
import {
  chatAttachmentUrl,
  conversationFiles,
  listConversations,
  markRead,
  readConversation,
  readMessages,
  sendMessage,
  startConversation,
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
  // Not a sheet key, for the reason the Discussions composer is not one
  // either: `?conversation=` names a room that exists, and a half-filled form
  // naming nobody is not a room. What it produces goes in the URL the moment
  // the server answers.
  const [starting, setStarting] = useState(false)
  const layout = useLayout()
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
            {/* One word on a phone. The row beside it is a search field and,
                some of the time, an unread pill; at 375px the three of them
                and a spelt-out label do not fit, and the label is the part
                the icon already says. */}
            <Button variant="primary" onClick={() => setStarting(true)}>
              <MessageSquarePlus />
              {layout === "phone" ? "New" : "New conversation"}
            </Button>
          </>
        }
      />

      <Card className="flex h-[calc(100vh-11.5rem)] overflow-hidden">
        <div className="flex w-[19rem] shrink-0 flex-col border-r border-hairline">
          {queryState(conversations, {
            loading: "Loading the rooms…",
            render: () =>
              rooms.length === 0 ? (
                <EmptyState
                  action={
                    search.trim() === "" ? (
                      <Button variant="ghost" onClick={() => setStarting(true)}>
                        Start one
                      </Button>
                    ) : undefined
                  }
                >
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

      <StartSheet
        open={starting}
        onClose={() => setStarting(false)}
        me={me}
        // Pushes, like clicking a room in the list: the room now exists, and
        // arriving at it is somewhere `back` should return from.
        onStarted={(id) => conversation.open(id)}
      />
    </PageContent>
  )
}

/// Starting one.
///
/// A rail, not the `wide` sheet the thread composer takes: `wide` exists for a
/// form whose widest control is a paragraph somebody writes, and this is a
/// choice of people and at most a name. Nothing is typed into a conversation
/// here — the room opens and the composer at the foot of it is where the first
/// message gets written, which is also why nothing is sent if this is
/// abandoned.
///
/// People are PICKED rather than typed. `/api/v1/auth/users` sits behind
/// nothing but `require_auth`, and everybody holding an account here is staff
/// — the ladder is CASHIER, SUPERVISOR, ADMIN. The old app on `frontend-cloud`
/// made you type a username because it also served buyers, who must not be
/// handed the staff list; that constraint is gone and typing a colleague's
/// login from memory should go with it.
function StartSheet({
  open,
  onClose,
  me,
  onStarted,
}: {
  open: boolean
  onClose: () => void
  me: string | undefined
  onStarted: (conversationId: string) => void
}) {
  const client = useQueryClient()
  const [kind, setKind] = useState<"DIRECT" | "GROUP">("DIRECT")
  const [title, setTitle] = useState("")
  const [people, setPeople] = useState<readonly string[]>([])

  // Only while the sheet is up. The account list is a hundred rows of roles and
  // last-login times, and Chat is not the screen that should be fetching it in
  // the background all day.
  const users = useQuery({
    queryKey: systemKeys.users(),
    queryFn: ({ signal }) => listUsers(signal),
    enabled: open,
  })

  /// Everybody but the reader. The server adds them itself, and a list you can
  /// pick yourself out of makes "a direct conversation is between exactly two
  /// people" arrive as a 400 instead of as a control that never offered it.
  ///
  /// Suspended accounts are dropped for the same reason: `known_users` accepts
  /// them, so the room would be started onto somebody who cannot sign in.
  const choices = useMemo<Choice[]>(
    () =>
      (users.data?.rows ?? [])
        .filter((user) => user.active && user.username !== me)
        .map((user) => ({
          value: user.username,
          label:
            user.display_name.trim() === "" ? user.username : user.display_name,
        })),
    [users.data, me]
  )

  const start = useMutation({
    mutationFn: () =>
      startConversation({
        kind,
        title: kind === "GROUP" ? title.trim() : null,
        participants: [...people],
      }),
    onSuccess: (room) => {
      // The room is on the list now — and for a DIRECT one it may have been
      // there all along, since the server answers with the existing pair
      // rather than a second copy of it.
      void client.invalidateQueries({ queryKey: workplaceKeys.conversations() })
      client.setQueryData(
        workplaceKeys.conversation(room.conversation_id),
        room
      )
      // Emptied on the way out, not on the way in. A form cleared when it
      // opens is cleared by an effect watching a prop; this one is cleared by
      // the thing that actually finished it.
      setTitle("")
      setPeople([])
      onStarted(room.conversation_id)
      onClose()
    },
  })

  /// Shutting it. The picks are deliberately left alone — somebody who closed
  /// this to go and check a colleague's username should find their half-made
  /// room where they left it. The failed attempt is not: a sentence about a
  /// name that no longer stands typed is stale the moment the sheet shuts.
  const close = () => {
    start.reset()
    onClose()
  }

  const ready =
    kind === "DIRECT"
      ? people.length === 1
      : people.length >= 1 && title.trim() !== ""

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && close()}
      title="New conversation"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-pill text-mute">
            Private to whoever is in it.
          </span>
          <Button
            variant="primary"
            disabled={!ready || start.isPending}
            onClick={() => start.mutate()}
          >
            {start.isPending ? "Starting…" : "Start"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-[0.78125rem] leading-relaxed text-body">
          Correspondence, and nothing more. An argument about a purchase order
          belongs in a discussion instead — that one hangs off the record, and
          everybody who comes to the order later can read it.
        </p>

        <Segmented
          options={[
            { value: "DIRECT" as const, label: "One person" },
            { value: "GROUP" as const, label: "A group" },
          ]}
          value={kind}
          onChange={(next) => {
            setKind(next)
            // Narrowing to a direct conversation keeps the first person picked
            // rather than clearing the field: it is the one the room would be
            // with, and dropping it silently would be the sheet undoing work.
            if (next === "DIRECT") setPeople((chosen) => chosen.slice(0, 1))
          }}
        />

        {kind === "GROUP" && (
          <Field
            label="Name"
            hint="A group needs one. A direct conversation does not — it is named by whoever else is in it, which depends on who is looking."
          >
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Receiving DC-01"
            />
          </Field>
        )}

        <Field
          label={kind === "DIRECT" ? "Who" : "Who else"}
          hint={
            kind === "DIRECT"
              ? "One person. Somebody you have already written to opens the room you are both already in, rather than a second one."
              : "Everybody else in the room. You are in it either way."
          }
        >
          {kind === "DIRECT" ? (
            <PickOne
              label="Who"
              choices={choices}
              value={people[0] ?? null}
              onChange={(person) => setPeople(person === null ? [] : [person])}
              placeholder={users.isPending ? "Loading…" : "Nobody yet"}
            />
          ) : (
            <PickMany
              label="Who else"
              choices={choices}
              values={people}
              onChange={setPeople}
              placeholder={users.isPending ? "Loading…" : "Nobody yet"}
              leading={(name) => <Avatar name={name} size="sm" />}
            />
          )}
        </Field>

        {/* The picker would otherwise just be empty, which reads as "there is
            nobody here" rather than "the list did not arrive". */}
        <Problem error={users.error} />
        <Problem error={start.error} />
      </div>
    </Sheet>
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
          <span className="min-w-0 flex-1 truncate text-nav font-medium text-ink">
            {name}
          </span>
          <span className="shrink-0 text-pill text-mute">
            {ago(room.last_activity_at)}
          </span>
        </span>
        <span className="mt-[0.1875rem] flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-meta text-body">
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
        // Who you are talking to, and who else is in the room — nothing else.
        //
        // Two things stood in this header and neither was a fact about the
        // conversation: `GROUP`, a database enum set as a mono code beside a
        // person's name, and "read to 4 of 4", the server's own arithmetic for
        // the unread count. Read state is already said twice over — by the
        // badge on the room in the list, and by the New line in the thread —
        // and a sequence number is not how anybody asks the question. A group
        // now says it is one in words, where its membership is.
        render: (room) => (
          <div className="flex shrink-0 items-center gap-3 border-b border-hairline px-5 py-3">
            <Avatar name={conversationName(room, me)} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-card-title font-semibold text-ink">
                {conversationName(room, me)}
              </h2>
              <p className="mt-[0.1875rem] truncate text-meta text-mute">
                {room.kind === "GROUP" && "Group · "}
                {room.participants.join(", ")}
              </p>
            </div>
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
                              to="/library"
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
            <span className="text-meta font-medium text-body">
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
