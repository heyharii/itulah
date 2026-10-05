import { Menu } from "@base-ui/react/menu"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowDown,
  Bell,
  BellOff,
  ChevronLeft,
  Info,
  MessageSquarePlus,
  MoreHorizontal,
  Pin,
  Search,
  X,
} from "lucide-react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, SavedDialog } from "@/components/ui/dialog"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickMany, PickOne, type Choice } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Problem,
} from "@/components/ui/states"
import { ITEM, POPUP, POSITIONER } from "@/lib/filter-chrome"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { queryState } from "@/lib/query-state"
import { listUsers, systemKeys } from "@/lib/queries/system"
import {
  deleteMessage,
  editMessage,
  listConversations,
  markRead,
  pinMessage,
  reactToMessage,
  readConversation,
  searchChat,
  setConversationPreferences,
  startConversation,
  whoIsTyping,
  workplaceKeys,
} from "@/lib/queries/workplace"
import { useIdentity } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import {
  ChatComposer,
  useChatAttachments,
} from "@/screens/workplace/chat-composer"
import { ChatInfoSheet, type InfoTab } from "@/screens/workplace/chat-info"
import {
  DayDivider,
  MessageRow,
  OutboxRow,
  UnreadDivider,
  type MessageActions,
} from "@/screens/workplace/chat-message"
import {
  discardMessage,
  queueMessage,
  retryMessage,
  upsertMessage,
  useOutbox,
  useThread,
} from "@/screens/workplace/chat-store"
import { plainText } from "@/screens/workplace/chat-text"
import { unreadOf, useDocumentVisible } from "@/screens/workplace/chat-unread"
import {
  ago,
  clock,
  conversationName,
  dayOf,
  eventSubject,
} from "@/screens/workplace/lib"
import {
  useCollaborationFeed,
  type CollaborationFeed,
} from "@/screens/workplace/live"
import { Avatar, type PendingAttachment } from "@/screens/workplace/parts"
import { ApiError } from "@itulah/contract/client"
import type {
  ChatConversation,
  ChatMessage,
  ChatSearchHit,
} from "@itulah/contract"

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
/// What a room can do was set against the open team chats (Mattermost,
/// Rocket.Chat, Zulip): answer a line, react, edit, delete, pin, mention with
/// `@`, see who has read it and who is typing, search, scroll back through
/// the whole history, mute, pin and archive a room, and run a group — name,
/// people, admins. Each of those is the server's; this screen only draws it
/// and says what happened.
///
/// Nothing here holds a socket. `GET /chat/events` is polled by
/// `useCollaborationFeed` — faster while a room is open and the tab is in
/// front — and it invalidates exactly the keys each event touches.

/// How often the log is asked while somebody is in a room and looking at it.
const LIVE_INTERVAL = 1_500

/// How often "who is typing" is asked while a room is open and in front.
const TYPING_INTERVAL = 2_500

/// Two lines from the same person this close together read as one turn.
const GROUP_WITHIN_MS = 5 * 60_000

type RoomFilter = "all" | "unread" | "groups" | "archived"

const FILTERS: readonly { value: RoomFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "groups", label: "Groups" },
  { value: "archived", label: "Archived" },
]

export function Chat() {
  const conversation = useSheet("conversation")
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<RoomFilter>("all")
  /// Leaving a group says so once the room is gone; the receipt outlives the
  /// room, which unmounts the moment it closes.
  const [leftNote, setLeftNote] = useState<string | null>(null)
  // Not a sheet key, for the reason the Discussions composer is not one
  // either: `?conversation=` names a room that exists, and a half-filled form
  // naming nobody is not a room. What it produces goes in the URL the moment
  // the server answers.
  const [starting, setStarting] = useState(false)
  /// A message to show once its room is open — a search hit, a notification.
  const [target, setTarget] = useState<{
    conversationId: string
    seq: number
    nonce: number
  } | null>(null)
  const layout = useLayout()
  const identity = useIdentity()
  const me = identity.data?.username
  const visible = useDocumentVisible()

  // Mounted here as well as on Discussions: the poll is what keeps this screen
  // live. Faster while a room is open in a tab somebody is looking at.
  const feed = useCollaborationFeed(
    visible && conversation.value !== undefined ? LIVE_INTERVAL : 4_000
  )

  const conversations = useQuery({
    queryKey: workplaceKeys.conversations(),
    queryFn: ({ signal }) => listConversations(signal),
  })

  const needle = search.trim().toLowerCase()
  const rooms = useMemo(() => {
    const all = conversations.data ?? []
    if (needle !== "") {
      // A search looks everywhere, archive included: somebody typing a name
      // is looking for that person, wherever the room was filed.
      return all.filter(
        (room) =>
          conversationName(room, me).toLowerCase().includes(needle) ||
          room.members.some(
            (member) =>
              member.username.toLowerCase().includes(needle) ||
              member.display_name.toLowerCase().includes(needle)
          )
      )
    }
    switch (filter) {
      case "unread":
        return all.filter(
          (room) =>
            !room.archived && (room.unread_count > 0 || room.mention_count > 0)
        )
      case "groups":
        return all.filter((room) => !room.archived && room.kind === "GROUP")
      case "archived":
        return all.filter((room) => room.archived)
      default:
        return all.filter((room) => !room.archived)
    }
  }, [conversations.data, needle, filter, me])

  // Words inside messages, from the server, once there is enough to look for.
  const [query, setQuery] = useState("")
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])
  const hits = useQuery({
    queryKey: workplaceKeys.chatSearch(query, null),
    queryFn: ({ signal }) => searchChat(query, null, signal),
    enabled: query.length >= 2,
  })

  const unread = unreadOf(conversations.data ?? [])
  useUnreadTitle(unread)

  /// Whether the open room was pushed onto history from here — so the
  /// phone's back chevron can go BACK, instead of adding a second copy of the
  /// list on top of the one already there.
  const pushed = useRef(false)
  const openRoom = useCallback(
    (id: string, seq?: number) => {
      pushed.current = true
      conversation.open(id)
      // A plain open forgets any earlier target: coming back to a room must
      // not replay a search hit from ten minutes ago.
      setTarget(
        seq === undefined
          ? null
          : { conversationId: id, seq, nonce: Date.now() }
      )
    },
    [conversation]
  )
  const backToList = () => {
    if (pushed.current) {
      pushed.current = false
      window.history.back()
    } else {
      conversation.close()
    }
  }

  useChatAlerts(
    feed,
    conversations.data,
    conversation.value,
    me,
    visible,
    openRoom
  )
  const alerts = useAlertPermission()

  return (
    <PageContent>
      <PageHeader
        title="Chat"
        sub="Correspondence between people, not a record of a decision."
        actions={
          <>
            {unread > 0 && (
              <Pill tone="accent" withDot>
                {count(unread)} unread
              </Pill>
            )}
            {alerts.askable && (
              <Button
                variant="ghost"
                onClick={alerts.ask}
                title="Be told about new messages while this tab is in the background"
              >
                <Bell />
                {layout === "phone" ? "Alerts" : "Turn on alerts"}
              </Button>
            )}
            {/* One word on a phone. The row beside it is a pill and, some of
                the time, the alerts switch; at 375px the three of them and a
                spelt-out label do not fit, and the label is the part the icon
                already says. */}
            <Button variant="primary" onClick={() => setStarting(true)}>
              <MessageSquarePlus />
              {layout === "phone" ? "New" : "New conversation"}
            </Button>
          </>
        }
      />

      {/* On a phone the two panes take turns, the way every messenger does:
          the rooms, full width, until one is opened — then that room, full
          width, with a way back. Side by side at 375px the room was 104px
          wide and could not hold a sentence. */}
      <Card className="flex h-[calc(100dvh-11.5rem)] overflow-hidden max-md:h-[calc(100dvh-13.5rem-env(safe-area-inset-bottom,0px))]">
        <div
          className={cn(
            "flex w-[20rem] shrink-0 flex-col border-r border-hairline max-md:w-full max-md:border-r-0",
            conversation.value !== undefined && "max-md:hidden"
          )}
        >
          <div className="flex shrink-0 flex-col gap-2 border-b border-hairline p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search people and messages"
                className="h-8 w-full pl-8"
              />
            </div>
            {needle === "" && (
              <Segmented
                options={FILTERS}
                value={filter}
                onChange={setFilter}
              />
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {heldState(conversations, {
              loading: "Loading the rooms…",
              render: () => (
                <>
                  {rooms.length === 0 ? (
                    needle !== "" ? (
                      <p className="px-4 py-3 text-meta text-mute">
                        No room matches that.
                      </p>
                    ) : (
                      <EmptyState
                        action={
                          filter === "all" ? (
                            <Button
                              variant="ghost"
                              onClick={() => setStarting(true)}
                            >
                              Start one
                            </Button>
                          ) : undefined
                        }
                      >
                        {filter === "all"
                          ? "You are not in any conversation yet."
                          : filter === "unread"
                            ? "Nothing unread. You are up to date."
                            : filter === "groups"
                              ? "You are not in any group."
                              : "Nothing archived."}
                      </EmptyState>
                    )
                  ) : (
                    rooms.map((room) => (
                      <RoomRow
                        key={room.conversation_id}
                        room={room}
                        me={me}
                        selected={room.conversation_id === conversation.value}
                        onOpen={() => openRoom(room.conversation_id)}
                      />
                    ))
                  )}
                  {query.length >= 2 && needle !== "" && (
                    <MessageHits
                      hits={hits.data}
                      pending={hits.isPending}
                      error={hits.error}
                      query={query}
                      onOpen={(hit) => openRoom(hit.conversation_id, hit.seq)}
                    />
                  )}
                </>
              ),
            })}
          </div>
        </div>

        {conversation.value === undefined ? (
          <div className="flex flex-1 items-center justify-center max-md:hidden">
            <EmptyState>
              Pick a conversation on the left. The one you open goes in the
              address bar, so it can be sent to somebody.
            </EmptyState>
          </div>
        ) : (
          // Keyed by the room: the read mark this browser has already posted,
          // the reply being written and any uploaded-but-unsent attachment all
          // belong to one conversation and must not follow you into the next.
          <Room
            key={conversation.value}
            id={conversation.value}
            me={me}
            onBack={layout === "phone" ? backToList : undefined}
            onGone={() => conversation.close()}
            onLeftNote={setLeftNote}
            jumpTo={
              target !== null && target.conversationId === conversation.value
                ? target
                : null
            }
          />
        )}
      </Card>

      <StartSheet
        open={starting}
        onClose={() => setStarting(false)}
        me={me}
        // Pushes, like clicking a room in the list: the room now exists, and
        // arriving at it is somewhere `back` should return from.
        onStarted={(id) => openRoom(id)}
      />

      <SavedDialog
        open={leftNote !== null}
        onOpenChange={(next) => {
          if (!next) setLeftNote(null)
        }}
        title={leftNote ?? ""}
      />
    </PageContent>
  )
}

/// `queryState`, except that an answer already on screen stays there.
///
/// Every query on this screen is refreshed by the live feed every second or
/// two, and queries here do not retry: with `queryState` alone one dropped
/// request would swap a whole thread for an error until the next tick. A
/// failed refresh of something already shown is not news; the next event
/// asks again.
function heldState<T>(
  query: Parameters<typeof queryState<T>>[0],
  options: Parameters<typeof queryState<T>>[1]
): React.ReactNode {
  if (query.data !== undefined) return options.render(query.data)
  return queryState(query, options)
}

/// `(3) Chat` in the tab while there is something to read, so a person with
/// the tab in the background can see it from another one.
function useUnreadTitle(unread: number) {
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, "")
    document.title =
      unread > 0 ? `(${unread > 99 ? "99+" : unread}) ${base}` : base
    return () => {
      document.title = document.title.replace(/^\(\d+\+?\) /, "")
    }
  }, [unread])
}

/// Whether the browser may be asked to show alerts, and a way to ask. Asked
/// only when somebody presses the button — a permission prompt on page load
/// is the one every browser has taught people to refuse.
function useAlertPermission() {
  const supported = typeof window !== "undefined" && "Notification" in window
  const [permission, setPermission] = useState<NotificationPermission>(
    supported ? Notification.permission : "denied"
  )
  return {
    askable: supported && permission === "default",
    ask: () => {
      if (!supported) return
      void Notification.requestPermission().then(setPermission)
    },
  }
}

/// A desktop alert for a message that arrives while nobody is looking at it:
/// the tab is in the background, or a different room is open. Never for your
/// own words, never for a muted room unless it names you, and never for the
/// history the feed winds through on its way to the present.
function useChatAlerts(
  feed: CollaborationFeed,
  rooms: readonly ChatConversation[] | undefined,
  openId: string | undefined,
  me: string | undefined,
  visible: boolean,
  openRoom: (id: string, seq?: number) => void
) {
  const handled = useRef<number | null>(null)
  const latest = useRef({ rooms, openId, me, visible, openRoom })
  useEffect(() => {
    latest.current = { rooms, openId, me, visible, openRoom }
  })

  useEffect(() => {
    const newest = feed.events[0]?.event_id ?? feed.lastEventId
    if (handled.current === null) {
      // The first look sets the mark. Nothing before it is news.
      handled.current = newest
      return
    }
    const fresh = feed.events.filter(
      (event) => event.event_id > (handled.current ?? 0)
    )
    handled.current = Math.max(handled.current, newest)
    if (!("Notification" in window) || Notification.permission !== "granted")
      return
    const now = latest.current
    for (const event of [...fresh].reverse()) {
      if (event.kind !== "chat.message") continue
      const subject = eventSubject(event.payload)
      if (subject.conversationId === undefined || subject.author === now.me)
        continue
      // A line the room wrote about itself — somebody renamed it, joined —
      // is not somebody writing to you.
      if (subject.messageKind === "SYSTEM") continue
      if (subject.conversationId === now.openId && now.visible) continue
      const room = now.rooms?.find(
        (one) => one.conversation_id === subject.conversationId
      )
      const named = now.me !== undefined && subject.mentions.includes(now.me)
      // Muted means quiet — except when somebody asks for you by name.
      if (room !== undefined && room.muted && !named) continue
      const author =
        room?.members.find((member) => member.username === subject.author)
          ?.display_name ??
        subject.author ??
        "Somebody"
      try {
        const alert = new Notification(room?.title ?? "New message", {
          body: named
            ? `${author} mentioned you`
            : room?.kind === "GROUP"
              ? `${author} wrote in ${room.title}`
              : `${author} sent you a message`,
          // The conversation's id, which is also the tag a pushed message
          // for this room carries (`claim_push_deliveries`): when both the
          // tab and the phone-style push fire, the second replaces the first
          // rather than stacking beside it.
          tag: subject.conversationId,
        })
        const id = subject.conversationId
        const seq = subject.seq
        alert.onclick = () => {
          window.focus()
          latest.current.openRoom(id, seq)
          alert.close()
        }
      } catch {
        // Some browsers only allow alerts from a service worker; the unread
        // count in the tab title still says it.
      }
    }
  }, [feed.events, feed.lastEventId])
}

function MessageHits({
  hits,
  pending,
  error,
  query,
  onOpen,
}: {
  hits: readonly ChatSearchHit[] | undefined
  pending: boolean
  error: Error | null
  query: string
  onOpen: (hit: ChatSearchHit) => void
}) {
  return (
    <div className="border-t border-hairline">
      <p className="px-4 pt-3 pb-1 text-pill font-medium text-mute uppercase">
        Messages
      </p>
      {pending ? (
        <p className="px-4 py-2 text-meta text-mute">Searching…</p>
      ) : error !== null ? (
        <p className="px-4 py-2 text-meta text-bad-fg">{error.message}</p>
      ) : hits === undefined || hits.length === 0 ? (
        <p className="px-4 py-2 text-meta text-mute">
          No message says “{query}”.
        </p>
      ) : (
        hits.map((hit) => (
          <button
            key={`${hit.conversation_id}-${hit.seq}`}
            type="button"
            onClick={() => onOpen(hit)}
            className="flex w-full flex-col gap-0.5 border-b border-hairline px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-soft"
          >
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-meta font-medium text-ink">
                {hit.conversation_title}
              </span>
              <span className="shrink-0 text-pill text-mute">
                {ago(hit.sent_at)}
              </span>
            </span>
            <span className="line-clamp-2 text-[0.8125rem] text-body">
              <span className="text-mute">{hit.author_name}: </span>
              <Highlighted text={plainText(hit.body)} query={query} />
            </span>
          </button>
        ))
      )}
    </div>
  )
}

/// The words that matched, marked where they are.
function Highlighted({ text, query }: { text: string; query: string }) {
  const lower = text.toLowerCase()
  const needle = query.toLowerCase()
  const parts: React.ReactNode[] = []
  let from = 0
  let at = needle === "" ? -1 : lower.indexOf(needle)
  while (at >= 0) {
    if (at > from) parts.push(text.slice(from, at))
    parts.push(
      <mark key={at} className="rounded-sm bg-warn-bg px-0.5 text-ink">
        {text.slice(at, at + needle.length)}
      </mark>
    )
    from = at + needle.length
    at = lower.indexOf(needle, from)
  }
  if (from < text.length) parts.push(text.slice(from))
  return <>{parts}</>
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
  const client = useQueryClient()
  const name = conversationName(room, me)
  const unread = room.unread_count > 0
  const quiet = room.muted || room.archived

  const preferences = useMutation({
    mutationFn: (change: {
      muted?: boolean
      pinned?: boolean
      archived?: boolean
    }) => setConversationPreferences(room.conversation_id, change),
    onSuccess: (updated) => {
      client.setQueryData(
        workplaceKeys.conversation(room.conversation_id),
        updated
      )
      void client.invalidateQueries({
        queryKey: workplaceKeys.conversations(),
        exact: true,
      })
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const read = useMutation({
    mutationFn: () => markRead(room.conversation_id, room.latest_message_seq),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: workplaceKeys.conversations(),
        exact: true,
      }),
    onError: (error: Error) => toast.error(error.message),
  })

  // `preview_author` is a display name, so "You" is decided against the
  // reader's own display name in this room.
  const myName = room.members.find(
    (member) => member.username === me
  )?.display_name
  const said = room.preview === null ? "" : plainText(room.preview)
  const preview =
    room.preview === null
      ? "Nobody has said anything yet."
      : room.preview_author === null
        ? said
        : `${room.preview_author === myName ? "You" : room.preview_author}: ${said}`

  return (
    <div
      className={cn(
        "group relative border-b border-hairline transition-colors",
        selected ? "bg-accent-bg" : "hover:bg-soft"
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
      >
        <Avatar name={name} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-nav text-ink",
                unread && !quiet ? "font-semibold" : "font-medium"
              )}
            >
              {name}
            </span>
            <span className="shrink-0 text-pill text-mute group-hover:invisible pointer-coarse:group-hover:visible">
              {ago(room.last_activity_at)}
            </span>
          </span>
          <span className="mt-[0.1875rem] flex items-center gap-1.5">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-meta",
                unread && !quiet ? "text-text" : "text-body"
              )}
            >
              {preview}
            </span>
            {room.pinned && <Pin className="size-3 shrink-0 text-line-ico" />}
            {room.muted && (
              <BellOff className="size-3 shrink-0 text-line-ico" />
            )}
            {room.mention_count > 0 && (
              <span
                title={`${room.mention_count} mention${room.mention_count === 1 ? "" : "s"}`}
                className="grid h-[1.125rem] min-w-[1.125rem] shrink-0 place-items-center rounded-full bg-accent px-1 text-[0.75rem] font-semibold text-white"
              >
                @
              </span>
            )}
            {unread && (
              <span
                className={cn(
                  "grid h-[1.125rem] min-w-[1.125rem] shrink-0 place-items-center rounded-full px-1.5 text-[0.75rem] font-semibold tabular-nums",
                  quiet ? "bg-soft-2 text-body" : "bg-accent text-white"
                )}
              >
                {room.unread_count > 99 ? "99+" : room.unread_count}
              </span>
            )}
          </span>
        </span>
      </button>

      <Menu.Root>
        <Menu.Trigger
          aria-label={`Actions for ${name}`}
          className="absolute top-2 right-2 grid size-6 place-items-center rounded text-line-ico opacity-0 transition-opacity group-hover:opacity-100 hover:bg-soft-2 hover:text-ink data-[popup-open]:opacity-100 pointer-coarse:hidden"
        >
          <MoreHorizontal className="size-4" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner
            side="bottom"
            align="end"
            sideOffset={4}
            className={POSITIONER}
          >
            <Menu.Popup className={POPUP}>
              {unread && (
                <Menu.Item className={ITEM} onClick={() => read.mutate()}>
                  Mark as read
                </Menu.Item>
              )}
              <Menu.Item
                className={ITEM}
                onClick={() => preferences.mutate({ pinned: !room.pinned })}
              >
                {room.pinned ? "Unpin" : "Pin to top"}
              </Menu.Item>
              <Menu.Item
                className={ITEM}
                onClick={() => preferences.mutate({ muted: !room.muted })}
              >
                {room.muted ? "Unmute" : "Mute"}
              </Menu.Item>
              <Menu.Item
                className={ITEM}
                onClick={() => preferences.mutate({ archived: !room.archived })}
              >
                {room.archived ? "Move out of the archive" : "Archive"}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  )
}

/// One conversation: its header, the thread, and the composer at the foot.
function Room({
  id,
  me,
  onBack,
  onGone,
  onLeftNote,
  jumpTo,
}: {
  id: string
  me: string | undefined
  /// Back to the rooms — drawn only on a phone, where the list is not beside
  /// the room but behind it.
  onBack?: () => void
  /// The reader is no longer in this room (left, removed, or it is gone).
  onGone: () => void
  /// Said when the leave was the room's own doing — the receipt outlives this
  /// component, which unmounts the moment the room closes.
  onLeftNote: (said: string) => void
  jumpTo: { seq: number; nonce: number } | null
}) {
  const client = useQueryClient()
  const visible = useDocumentVisible()
  const thread = useThread(id)
  const outbox = useOutbox(id)
  const attachments = useChatAttachments()

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [deleting, setDeleting] = useState<ChatMessage | null>(null)
  const [info, setInfo] = useState<InfoTab | null>(null)
  const [searching, setSearching] = useState(false)
  const [highlight, setHighlight] = useState<number | null>(null)
  const [restore, setRestore] = useState<{
    text: string
    nonce: number
  } | null>(null)
  const [dragging, setDragging] = useState(false)

  // The row the list already holds, so the header, the read mark and the first
  // placement of the thread do not wait a round trip for a room that is on
  // screen already. Read as a VALUE rather than passed as a function: with a
  // function, TypeScript unifies it with `queryFn` and infers the query's data
  // as the placeholder's function, so every read of `detail.data` sees
  // `() => ChatConversation | undefined` instead of the conversation.
  const held = client
    .getQueryData<ChatConversation[]>(workplaceKeys.conversations())
    ?.find((one) => one.conversation_id === id)

  const detail = useQuery({
    queryKey: workplaceKeys.conversation(id),
    queryFn: ({ signal }) => readConversation(id, signal),
    placeholderData: held,
  })
  const room = detail.data
  const gone = detail.error instanceof ApiError && detail.error.status === 404

  const typing = useQuery({
    queryKey: workplaceKeys.typing(id),
    queryFn: ({ signal }) => whoIsTyping(id, signal),
    enabled: visible && room !== undefined,
    refetchInterval: TYPING_INTERVAL,
    staleTime: 0,
    // A missed answer is a quiet "nobody", not an error to draw.
    retry: false,
  })

  const messages = thread.messages
  const newest = messages.length > 0 ? messages[messages.length - 1].seq : 0

  // Where reading had stopped when this room was opened, frozen before the
  // effect below moves the mark to the end. Without freezing it the "New" line
  // would be drawn and erased in the same second, which is the one moment it is
  // actually useful.
  //
  // State adjusted during render rather than a ref written during render: React
  // supports this — it re-renders immediately without committing the first pass
  // — and unlike a ref it cannot tear under concurrent rendering.
  const [markOnOpen, setMarkOnOpen] = useState<number | null>(null)
  if (markOnOpen === null && room !== undefined) {
    setMarkOnOpen(room.last_read_seq)
  }

  // Reading a conversation is what moves the read mark — while the tab is in
  // front, because a room left open in a background tab has not been read.
  const read = useMutation({
    mutationFn: (seq: number) => markRead(id, seq),
    onSuccess: (updated) => {
      client.setQueryData(workplaceKeys.conversation(id), updated)
      void client.invalidateQueries({
        queryKey: workplaceKeys.conversations(),
        exact: true,
      })
    },
  })
  const markReadNow = read.mutate
  const posted = useRef(0)

  // Whatever this room left in the system tray — a pushed message, a desktop
  // alert — is answered by looking at the room. Both are tagged with its id.
  useEffect(() => {
    if (!visible) return
    clearTray(id)
  }, [visible, id, newest])
  useEffect(() => {
    if (!visible || room === undefined || newest === 0) return
    if (room.last_read_seq >= newest) return
    if (posted.current >= newest) return
    posted.current = newest
    markReadNow(newest)
  }, [visible, room, newest, markReadNow])

  // ─── Scrolling ───────────────────────────────────────────────────────────

  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  /// The thread as it was at the last layout, so the next one can tell what
  /// changed: older messages in front (hold the reader's place), newer ones
  /// behind (follow them down only if the reader was already at the bottom).
  const snapshot = useRef({
    positioned: false,
    oldest: null as number | null,
    newest: null as number | null,
    pending: 0,
    height: 0,
    top: 0,
  })
  // More unread than the first page holds: scroll back (bounded, in
  // `reach`) to the first of them before the thread is first placed.
  const firstUnreadSeq = markOnOpen === null ? null : markOnOpen + 1
  const needsCatchUp =
    thread.query.data !== undefined &&
    firstUnreadSeq !== null &&
    messages.length > 0 &&
    firstUnreadSeq <= newest &&
    firstUnreadSeq < messages[0].seq
  const [caughtUp, setCaughtUp] = useState(false)
  const catchingUp = needsCatchUp && !caughtUp
  const catchUpStarted = useRef(false)
  const reachOnOpen = thread.reach
  useEffect(() => {
    if (!needsCatchUp || catchUpStarted.current || firstUnreadSeq === null)
      return
    catchUpStarted.current = true
    void reachOnOpen(firstUnreadSeq).finally(() => setCaughtUp(true))
  }, [needsCatchUp, firstUnreadSeq, reachOnOpen])

  const [nearBottom, setNearBottom] = useState(true)
  const [seenUpTo, setSeenUpTo] = useState<number | null>(null)
  if (seenUpTo === null && thread.query.data !== undefined) {
    setSeenUpTo(newest)
  }
  const [farFromBottom, setFarFromBottom] = useState(false)
  const hasOlder = thread.hasOlder
  const loadingOlder = thread.loadingOlder
  const loadOlder = thread.loadOlder

  useLayoutEffect(() => {
    const el = scroller.current
    // Held data, not a successful status: a refresh that failed keeps the
    // thread on screen, and the thread still has to be placed and followed.
    if (el === null || thread.query.data === undefined) return
    // The first placement waits for the room as well as its messages: the
    // unread line it looks for is drawn from the room's read mark.
    if (!snapshot.current.positioned && markOnOpen === null && !detail.isError)
      return
    // More unread than the first page holds: wait for the pages that reach
    // the first unread line, so it is placed where reading stopped rather
    // than at the top of the newest fifty.
    if (!snapshot.current.positioned && catchingUp) return
    const was = snapshot.current
    const oldest = messages.length > 0 ? messages[0].seq : null
    const last = messages.length > 0 ? messages[messages.length - 1] : null
    const latest = last?.seq ?? null
    const wasNearBottom = was.height - was.top - el.clientHeight < 80

    if (!was.positioned) {
      was.positioned = true
      const line = el.querySelector<HTMLElement>("[data-unread-line]")
      el.scrollTop =
        line !== null ? Math.max(0, line.offsetTop - 24) : el.scrollHeight
    } else if (was.oldest !== null && oldest !== null && oldest < was.oldest) {
      // Older messages went in above. Keep the line the reader was on where
      // it was, rather than letting it jump down by the height of a page.
      el.scrollTop = was.top + (el.scrollHeight - was.height)
    } else if (latest !== was.newest || outbox.length !== was.pending) {
      const mine =
        outbox.length > was.pending ||
        (last !== null && latest !== was.newest && last.author === me)
      if (wasNearBottom || mine) el.scrollTop = el.scrollHeight
    }

    was.oldest = oldest
    was.newest = latest
    was.pending = outbox.length
    was.height = el.scrollHeight
    was.top = el.scrollTop
  })

  // A photograph that finishes loading, an edit that made a line longer:
  // the thread grows without a new message. Stay at the bottom if that is
  // where the reader was.
  useEffect(() => {
    const el = scroller.current
    const inner = content.current
    if (el === null || inner === null) return
    const observer = new ResizeObserver(() => {
      const was = snapshot.current
      if (was.positioned && was.height - was.top - el.clientHeight < 80) {
        el.scrollTop = el.scrollHeight
      }
      was.height = el.scrollHeight
      was.top = el.scrollTop
    })
    observer.observe(inner)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /// Until when scrolling near the top does NOT load older messages: a
  /// smooth scroll to a line is made of scroll events, and a page landing in
  /// front halfway through would cut it short.
  const quietUntil = useRef(0)

  const onScroll = () => {
    const el = scroller.current
    if (el === null) return
    snapshot.current.top = el.scrollTop
    snapshot.current.height = el.scrollHeight
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    const near = gap < 80
    setNearBottom(near)
    setFarFromBottom(gap > 400)
    if (near) setSeenUpTo(newest)
    if (
      el.scrollTop < 240 &&
      hasOlder &&
      !loadingOlder &&
      thread.olderError === null &&
      Date.now() > quietUntil.current
    ) {
      void loadOlder()
    }
  }

  const toBottom = () => {
    const el = scroller.current
    if (el === null) return
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }

  // ─── Jumping to one message ──────────────────────────────────────────────

  const reach = thread.reach
  const jump = useCallback(
    async (seq: number) => {
      const found = await reach(seq)
      if (!found) {
        toast.error("That message could not be found.")
        return
      }
      // The page that was just loaded may not be drawn yet: look for the line
      // for a few frames rather than assuming the render has happened.
      let tries = 0
      const look = () => {
        const line = scroller.current?.querySelector<HTMLElement>(
          `[data-seq="${seq}"]`
        )
        if (line === null || line === undefined) {
          tries += 1
          if (tries < 20) requestAnimationFrame(look)
          return
        }
        quietUntil.current = Date.now() + 1_500
        line.scrollIntoView({ block: "center", behavior: "smooth" })
        setHighlight(seq)
        window.setTimeout(
          () => setHighlight((current) => (current === seq ? null : current)),
          2_000
        )
      }
      requestAnimationFrame(look)
    },
    [reach]
  )

  const jumped = useRef<number | null>(null)
  const ready = thread.query.data !== undefined
  useEffect(() => {
    if (jumpTo === null || !ready || jumped.current === jumpTo.nonce) return
    jumped.current = jumpTo.nonce
    void jump(jumpTo.seq)
  }, [jumpTo, ready, jump])

  // ─── What can be done to a message ───────────────────────────────────────

  const writeMessage = useCallback(
    (message: ChatMessage) => {
      client.setQueryData<ChatMessage[]>(workplaceKeys.messages(id), (held) =>
        upsertMessage(held, message)
      )
    },
    [client, id]
  )

  const actions = useMemo<MessageActions>(
    () => ({
      reply: (message) => {
        setEditing(null)
        setReplyTo(message)
      },
      edit: (message) => {
        setReplyTo(null)
        setEditing(message)
      },
      remove: (message) => setDeleting(message),
      react: (message, emoji, on) => {
        // Drawn at once, corrected by the server's answer. A reaction is the
        // one action somebody makes twenty times an hour; waiting a round
        // trip for each would make every one of them feel broken.
        client.setQueryData<ChatMessage[]>(workplaceKeys.messages(id), (held) =>
          held?.map((one) =>
            one.seq === message.seq ? withReaction(one, emoji, on, me) : one
          )
        )
        reactToMessage(id, message.seq, emoji, on)
          .then(writeMessage)
          .catch((error: Error) => {
            toast.error(error.message)
            void client.invalidateQueries({
              queryKey: workplaceKeys.messages(id),
            })
          })
      },
      pin: (message, pinned) => {
        pinMessage(id, message.seq, pinned)
          .then((updated) => {
            writeMessage(updated)
            void client.invalidateQueries({ queryKey: workplaceKeys.pins(id) })
            toast.success(
              pinned ? "Pinned for everybody in the room" : "Unpinned"
            )
          })
          .catch((error: Error) => toast.error(error.message))
      },
      copy: (message) => {
        if (navigator.clipboard === undefined) {
          toast.error("This browser will not copy from here.")
          return
        }
        navigator.clipboard
          .writeText(message.body)
          .then(() => toast.success("Copied"))
          .catch(() => toast.error("This browser will not copy from here."))
      },
      jump: (seq) => void jump(seq),
    }),
    [client, id, me, writeMessage, jump]
  )

  const remove = useMutation({
    mutationFn: (message: ChatMessage) => deleteMessage(id, message.seq),
    onSuccess: (message) => {
      writeMessage(message)
      setDeleting(null)
      if (editing?.seq === message.seq) setEditing(null)
      if (replyTo?.seq === message.seq) setReplyTo(null)
      void client.invalidateQueries({
        queryKey: workplaceKeys.conversations(),
        exact: true,
      })
      void client.invalidateQueries({ queryKey: workplaceKeys.pins(id) })
      void client.invalidateQueries({
        queryKey: workplaceKeys.conversationFiles(id),
      })
      void client.invalidateQueries({ queryKey: workplaceKeys.files() })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const saveEdit = useCallback(
    async (message: ChatMessage, body: string) => {
      const updated = await editMessage(id, message.seq, body)
      writeMessage(updated)
      void client.invalidateQueries({
        queryKey: workplaceKeys.conversations(),
        exact: true,
      })
    },
    [client, id, writeMessage]
  )

  const lastOwn = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.author === me && message.kind === "TEXT") {
        return message.deleted_at === null ? message : null
      }
    }
    return null
  }, [messages, me])

  const send = (body: string, files: readonly PendingAttachment[]) => {
    queueMessage(client, id, {
      body,
      replyTo:
        replyTo === null
          ? null
          : {
              seq: replyTo.seq,
              author: replyTo.author,
              author_name: replyTo.author_name,
              body: replyTo.body.slice(0, 200),
              deleted: false,
              has_attachments: replyTo.attachments.length > 0,
            },
      attachments: files,
    })
    setReplyTo(null)
    // Whoever sends is at the bottom afterwards, wherever they were reading.
    requestAnimationFrame(() => {
      const el = scroller.current
      if (el !== null) el.scrollTop = el.scrollHeight
    })
  }

  // ─── Drawing ─────────────────────────────────────────────────────────────

  if (gone) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <EmptyState
          action={
            <Button variant="ghost" onClick={onGone}>
              Back to the conversations
            </Button>
          }
        >
          You are not in this conversation — you left it, somebody removed you,
          or it no longer exists.
        </EmptyState>
      </div>
    )
  }

  const members = room?.members ?? []
  const group = room?.kind === "GROUP"
  const others = members.filter((member) => member.username !== me)
  const typingNames = (typing.data ?? []).map(
    (name) =>
      members.find((member) => member.username === name)?.display_name ?? name
  )
  const unseen =
    nearBottom || seenUpTo === null
      ? 0
      : messages.filter(
          (message) =>
            message.seq > seenUpTo &&
            message.author !== me &&
            message.kind === "TEXT"
        ).length

  return (
    <div
      className="relative flex min-w-0 flex-1 flex-col"
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("Files")) setDragging(true)
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault()
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragging(false)
        }
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        setDragging(false)
        if (editing !== null) {
          toast.error("Finish editing first — files go on a new message.")
          return
        }
        const files = Array.from(event.dataTransfer.files)
        if (files.length > 0) attachments.addFiles(files)
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-30 grid place-items-center rounded-card border-2 border-dashed border-accent bg-accent-bg/80 text-[0.9375rem] font-medium text-accent">
          Drop to attach
        </div>
      )}

      {heldState(detail, {
        loading: "Loading the conversation…",
        // Who you are talking to, and who else is in the room — or, while
        // somebody is writing, that they are.
        render: (current) => (
          <div className="flex shrink-0 items-center gap-3 border-b border-hairline px-5 py-3 max-md:gap-2 max-md:px-3">
            {onBack !== undefined && (
              <button
                type="button"
                aria-label="Back to conversations"
                onClick={onBack}
                className="-ml-1 grid size-tap shrink-0 place-items-center rounded-full text-line-ico active:bg-soft-2"
              >
                <ChevronLeft className="size-5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setInfo(group ? "members" : "about")}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <Avatar name={conversationName(current, me)} size="lg" />
              <div className="min-w-0 flex-1">
                <h2 className="flex items-center gap-1.5 truncate text-card-title font-semibold text-ink">
                  <span className="truncate">
                    {conversationName(current, me)}
                  </span>
                  {current.muted && (
                    <BellOff
                      className="size-3.5 shrink-0 text-line-ico"
                      aria-label="Muted"
                    />
                  )}
                </h2>
                <p className="mt-[0.1875rem] truncate text-meta text-mute">
                  {typingNames.length > 0 ? (
                    <span className="text-accent">
                      {typingLine(typingNames)}
                    </span>
                  ) : current.kind === "GROUP" ? (
                    `${current.members.length} people · ${others
                      .map((member) => member.display_name)
                      .join(", ")}`
                  ) : (
                    `@${others[0]?.username ?? me ?? ""}`
                  )}
                </p>
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="quiet"
                size="icon"
                aria-label="Search in this conversation"
                title="Search in this conversation"
                aria-pressed={searching}
                onClick={() => setSearching((open) => !open)}
              >
                <Search />
              </Button>
              <Button
                variant="quiet"
                size="icon"
                aria-label="Pinned messages"
                title="Pinned messages"
                onClick={() => setInfo("pinned")}
              >
                <Pin />
              </Button>
              <Button
                variant="quiet"
                size="icon"
                aria-label="About this conversation"
                title="People, files and settings"
                onClick={() => setInfo("about")}
              >
                <Info />
              </Button>
            </div>
          </div>
        ),
      })}

      {searching && (
        <RoomSearch
          conversationId={id}
          onClose={() => setSearching(false)}
          onJump={(seq) => void jump(seq)}
        />
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={onScroll}
          className="relative min-h-0 flex-1 overflow-y-auto px-5 pb-3 max-md:px-3"
        >
          <div ref={content}>
            {thread.query.data === undefined ? (
              thread.query.isError ? (
                <ErrorState
                  error={thread.query.error}
                  onRetry={() => void thread.query.refetch()}
                />
              ) : (
                <LoadingState>Loading the messages…</LoadingState>
              )
            ) : (
              <>
                <div className="flex justify-center py-3">
                  {thread.hasOlder ? (
                    thread.olderError !== null ? (
                      <Button
                        variant="ghost"
                        onClick={() => void thread.loadOlder()}
                      >
                        Could not load earlier messages — try again
                      </Button>
                    ) : (
                      <Button
                        variant="quiet"
                        pending={thread.loadingOlder}
                        onClick={() => void thread.loadOlder()}
                      >
                        {thread.loadingOlder
                          ? "Loading…"
                          : "Load earlier messages"}
                      </Button>
                    )
                  ) : messages.length > 0 ? (
                    <span className="text-pill text-mute">
                      The beginning of this conversation
                    </span>
                  ) : null}
                </div>

                {messages.length === 0 && outbox.length === 0 ? (
                  <EmptyState>
                    Nobody has said anything in here yet. Say hello.
                  </EmptyState>
                ) : (
                  <ThreadLines
                    messages={messages}
                    conversationId={id}
                    me={me}
                    room={room}
                    unreadFrom={markOnOpen}
                    highlight={highlight}
                    actions={actions}
                  />
                )}

                {outbox.map((item) => (
                  <OutboxRow
                    key={item.key}
                    item={item}
                    members={members}
                    me={me}
                    onRetry={() => retryMessage(client, item.key)}
                    onDiscard={() => {
                      const dropped = discardMessage(item.key)
                      if (dropped === undefined) return
                      // Nothing typed or attached is lost by giving up on a
                      // send: the words go back in the box, the files back
                      // beside it.
                      if (dropped.body !== "") {
                        setRestore({ text: dropped.body, nonce: Date.now() })
                      }
                      if (dropped.attachments.length > 0) {
                        attachments.put(dropped.attachments)
                      }
                    }}
                  />
                ))}
              </>
            )}
          </div>
        </div>

        {farFromBottom && (
          <button
            type="button"
            onClick={toBottom}
            className="absolute right-5 bottom-3 z-10 inline-flex h-8 items-center gap-1.5 rounded-full border border-hairline-2 bg-canvas px-3 text-meta font-medium text-text shadow-pop transition-colors hover:bg-soft"
          >
            <ArrowDown className="size-3.5" />
            {unseen > 0 ? `${unseen} new` : "Latest"}
          </button>
        )}
      </div>

      <div className="shrink-0 border-t border-hairline px-5 py-3 max-md:px-3">
        {room !== undefined ? (
          <ChatComposer
            conversationId={id}
            me={me}
            members={members}
            group={group}
            attachments={attachments}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            editing={editing}
            onCancelEdit={() => setEditing(null)}
            onSaveEdit={saveEdit}
            onSend={send}
            onEditLast={() => {
              if (lastOwn !== null) actions.edit(lastOwn)
            }}
            restore={restore}
          />
        ) : (
          <p className="text-meta text-mute">Loading…</p>
        )}
      </div>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title="Delete this message?"
        confirm="Delete"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting !== null) remove.mutate(deleting)
        }}
      >
        {deleting !== null && deleting.author !== me
          ? `${deleting.author_name}'s message is removed for everybody in the room, with its files. Its place stays, marked as deleted.`
          : "It is removed for everybody in the room, with its files. Its place stays, marked as deleted."}
      </Dialog>

      {room !== undefined && (
        <ChatInfoSheet
          open={info !== null}
          onClose={() => setInfo(null)}
          tab={info ?? "about"}
          onTab={setInfo}
          room={room}
          me={me}
          onJump={(seq) => void jump(seq)}
          onLeftNote={onLeftNote}
          onLeft={() => {
            setInfo(null)
            onGone()
          }}
        />
      )}
    </div>
  )
}

/// Close the tray notifications tagged with this room. Best effort: a
/// browser without a service worker, or one that refuses, simply keeps them.
function clearTray(conversationId: string) {
  if (!("serviceWorker" in navigator)) return
  navigator.serviceWorker
    .getRegistration()
    .then((registration) =>
      registration?.getNotifications({ tag: conversationId })
    )
    .then((shown) => shown?.forEach((notification) => notification.close()))
    .catch(() => undefined)
}

/// "Sari is typing…", "Sari and Budi are typing…", "3 people are typing…".
function typingLine(names: readonly string[]): string {
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
  return `${names.length} people are typing…`
}

/// A reaction put on or taken off, before the server has said so.
function withReaction(
  message: ChatMessage,
  emoji: string,
  on: boolean,
  me: string | undefined
): ChatMessage {
  if (me === undefined) return message
  const reactions = message.reactions
    .map((reaction) => {
      if (reaction.emoji !== emoji) return reaction
      const users = reaction.users.filter((user) => user !== me)
      return { ...reaction, users: on ? [...users, me] : users }
    })
    .filter((reaction) => reaction.users.length > 0)
  if (on && !reactions.some((reaction) => reaction.emoji === emoji)) {
    reactions.push({ emoji, users: [me] })
  }
  return { ...message, reactions }
}

/// The thread's lines, with the day and the unread line between them, and
/// consecutive lines from one person gathered into one turn.
function ThreadLines({
  messages,
  conversationId,
  me,
  room,
  unreadFrom,
  highlight,
  actions,
}: {
  messages: readonly ChatMessage[]
  conversationId: string
  me: string | undefined
  room: ChatConversation | undefined
  unreadFrom: number | null
  highlight: number | null
  actions: MessageActions
}) {
  const members = room?.members ?? []
  const canModerate = room?.kind === "GROUP" && room.is_admin
  const others = members.filter((member) => member.username !== me)

  // "Seen" belongs under the reader's own latest line and nowhere else — on
  // every line it would be noise, and on an older one it would be a lie of
  // omission about the newer.
  let lastOwnSeq: number | null = null
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (
      message.kind === "TEXT" &&
      message.deleted_at === null &&
      message.author === me
    ) {
      lastOwnSeq = message.seq
      break
    }
  }
  const firstUnread =
    unreadFrom === null
      ? null
      : (messages.find(
          (message) => message.seq > unreadFrom && message.author !== me
        )?.seq ?? null)

  const lines: React.ReactNode[] = []
  messages.forEach((message, index) => {
    const previous = index > 0 ? messages[index - 1] : null
    const newDay =
      previous === null || dayOf(previous.sent_at) !== dayOf(message.sent_at)
    const unreadHere = message.seq === firstUnread
    if (newDay)
      lines.push(
        <DayDivider key={`day-${message.seq}`} iso={message.sent_at} />
      )
    if (unreadHere) {
      lines.push(
        <div key={`unread-${message.seq}`} data-unread-line>
          <UnreadDivider />
        </div>
      )
    }
    const compact =
      previous !== null &&
      !newDay &&
      !unreadHere &&
      previous.kind === "TEXT" &&
      message.kind === "TEXT" &&
      previous.author === message.author &&
      message.reply_to === null &&
      Date.parse(message.sent_at) - Date.parse(previous.sent_at) <
        GROUP_WITHIN_MS

    let receipt: React.ReactNode = undefined
    if (message.seq === lastOwnSeq && others.length > 0) {
      const seenBy = others.filter(
        (member) => member.last_read_seq >= message.seq
      )
      receipt =
        seenBy.length === 0 ? (
          "Sent"
        ) : room?.kind !== "GROUP" ? (
          "Seen"
        ) : seenBy.length === others.length ? (
          "Seen by everyone"
        ) : (
          <span title={seenBy.map((member) => member.display_name).join(", ")}>
            Seen by {seenBy.length} of {others.length}
          </span>
        )
    }

    lines.push(
      <MessageRow
        key={message.message_id}
        message={message}
        conversationId={conversationId}
        me={me}
        members={members}
        compact={compact}
        canModerate={canModerate}
        highlighted={highlight === message.seq}
        receipt={receipt}
        actions={actions}
      />
    )
  })
  return <>{lines}</>
}

/// Looking for words in this room only.
function RoomSearch({
  conversationId,
  onClose,
  onJump,
}: {
  conversationId: string
  onClose: () => void
  onJump: (seq: number) => void
}) {
  const [text, setText] = useState("")
  const [query, setQuery] = useState("")
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [text])
  const hits = useQuery({
    queryKey: workplaceKeys.chatSearch(query, conversationId),
    queryFn: ({ signal }) => searchChat(query, conversationId, signal),
    enabled: query.length >= 2,
  })

  return (
    <div className="shrink-0 border-b border-hairline bg-soft px-5 py-2.5 max-md:px-3">
      <div className="flex items-center gap-2">
        <Search className="size-3.5 shrink-0 text-line-ico" />
        <input
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose()
          }}
          aria-label="Search in this conversation"
          className="h-8 min-w-0 flex-1 bg-transparent text-[0.875rem] text-ink outline-none placeholder:text-mute"
        />
        <button
          type="button"
          aria-label="Close search"
          onClick={onClose}
          className="grid size-7 place-items-center rounded-full text-line-ico hover:bg-soft-2 hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>
      {query.length >= 2 && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-inner border border-hairline bg-canvas">
          {hits.isPending ? (
            <p className="px-3 py-2 text-meta text-mute">Searching…</p>
          ) : hits.isError ? (
            <p className="px-3 py-2 text-meta text-bad-fg">
              {hits.error.message}
            </p>
          ) : (hits.data ?? []).length === 0 ? (
            <p className="px-3 py-2 text-meta text-mute">
              Nothing in here says “{query}”.
            </p>
          ) : (
            (hits.data ?? []).map((hit) => (
              <button
                key={hit.seq}
                type="button"
                onClick={() => onJump(hit.seq)}
                className="flex w-full flex-col gap-0.5 border-b border-hairline px-3 py-2 text-left last:border-b-0 hover:bg-soft"
              >
                <span className="flex items-baseline gap-2 text-pill text-mute">
                  <span className="font-medium text-body">
                    {hit.author_name}
                  </span>
                  <span>
                    {dayOf(hit.sent_at)} {clock(hit.sent_at)}
                  </span>
                </span>
                <span className="line-clamp-2 text-[0.8125rem] text-text">
                  <Highlighted text={plainText(hit.body)} query={query} />
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
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
            pending={start.isPending}
            disabled={!ready}
            onClick={() => start.mutate()}
          >
            {start.isPending ? "Starting…" : "Start"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-[0.875rem] leading-relaxed text-body">
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
            required
            hint="A group needs one. A direct conversation does not — it is named by whoever else is in it, which depends on who is looking."
          >
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
        )}

        <Field
          label={kind === "DIRECT" ? "Who" : "Who else"}
          required
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
            />
          ) : (
            <PickMany
              label="Who else"
              choices={choices}
              values={people}
              onChange={setPeople}
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
