import { ArrowLeft, Plus, SendHorizontal } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { CentralGate } from "@/components/central-gate"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { describe } from "@/lib/errors"
import { count } from "@/lib/format"
import {
  useConversations,
  useMarkRead,
  usePeople,
  useSend,
  useStartChat,
  useThread,
} from "@/lib/queries/discuss"
import { useIdentity } from "@/lib/session"
import { cn } from "@/lib/utils"
import { Notices } from "@/screens/news"
import type { ChatConversation, ChatMessage } from "@itulah/contract"

/// Where this shop talks to head office: Chat (people and groups) and Notices
/// (what head office has sent, `news.tsx`).
///
/// No badge anywhere but here. The console shows a count on the rail in every
/// module; this app lives beside a counter with a customer in front of it, so
/// unread shows on the tab and the conversation rows and nowhere over the
/// screen somebody is working in.
type Tab = "chat" | "notices"

export function Discuss() {
  return (
    <CentralGate what="Discuss">
      <DiscussTabs />
    </CentralGate>
  )
}

function DiscussTabs() {
  const [tab, setTab] = useState<Tab>("chat")
  const conversations = useConversations()
  const unread = (conversations.data ?? []).reduce(
    (sum, c) => sum + (c.muted ? 0 : c.unread_count),
    0,
  )
  const tabs = (
    <Segmented<Tab>
      value={tab}
      onChange={setTab}
      className="md:w-auto [&>button]:px-3.5 [&>button]:whitespace-nowrap pointer-coarse:[&>button]:h-tap md:pointer-fine:[&>button]:h-8"
      options={[
        { value: "chat", label: unread > 0 ? `Chat · ${count(unread)}` : "Chat" },
        { value: "notices", label: "Notices" },
      ]}
    />
  )

  if (tab === "notices") return <Notices lead={tabs} />

  return (
    <Screen actions={tabs}>
      <div className="mb-4 md:hidden">{tabs}</div>
      <Chat conversations={conversations} />
    </Screen>
  )
}

function Chat({
  conversations,
}: {
  conversations: ReturnType<typeof useConversations>
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const rooms = conversations.data ?? []
  const current = rooms.find((c) => c.conversation_id === openId) ?? null

  // On a phone the list is the screen until somebody picks a conversation.
  const showThread = current !== null && !starting

  return (
    <Card className="grid h-[calc(100dvh-14rem)] min-h-[26rem] md:grid-cols-[20rem_minmax(0,1fr)]">
      <div
        className={cn(
          "flex min-h-0 flex-col border-hairline md:border-r",
          (showThread || starting) && "max-md:hidden",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
          <span className="text-cell font-medium text-ink">Conversations</span>
          <Button
            variant="ghost"
            className="h-8 px-2.5 text-meta pointer-coarse:h-tap"
            onClick={() => setStarting(true)}
          >
            <Plus />
            New chat
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {conversations.isPending ? (
            <LoadingState>Asking head office…</LoadingState>
          ) : conversations.isError ? (
            <div className="p-3">
              <Banner tone="bad">{describe(conversations.error)}</Banner>
            </div>
          ) : rooms.length === 0 ? (
            <EmptyState>No conversations yet.</EmptyState>
          ) : (
            <ul>
              {rooms.map((room) => (
                <RoomRow
                  key={room.conversation_id}
                  room={room}
                  on={room.conversation_id === openId && !starting}
                  onOpen={() => {
                    setStarting(false)
                    setOpenId(room.conversation_id)
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <div
        className={cn(
          "min-h-0 min-w-0",
          !showThread && !starting && "max-md:hidden",
        )}
      >
        {starting ? (
          <NewChat
            onCancel={() => setStarting(false)}
            onStarted={(room) => {
              setStarting(false)
              setOpenId(room.conversation_id)
            }}
          />
        ) : current !== null ? (
          <Thread
            key={current.conversation_id}
            room={current}
            onBack={() => setOpenId(null)}
          />
        ) : (
          <div className="flex h-full items-center justify-center max-md:hidden">
            <EmptyState>Pick a conversation or start a new chat.</EmptyState>
          </div>
        )}
      </div>
    </Card>
  )
}

function RoomRow({
  room,
  on,
  onOpen,
}: {
  room: ChatConversation
  on: boolean
  onOpen: () => void
}) {
  const unread = room.unread_count > 0
  return (
    <li className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors pointer-coarse:min-h-tap",
          on ? "bg-soft" : "hover:bg-soft",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={cn(
                "truncate text-cell",
                unread ? "font-medium text-ink" : "text-body",
              )}
            >
              {room.title}
            </span>
            <span className="shrink-0 text-pill text-mute tabular-nums">
              {shortWhen(room.last_activity_at)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="truncate text-meta text-mute">
              {room.preview === null
                ? "No messages yet"
                : room.preview_author !== null && room.kind === "GROUP"
                  ? `${room.preview_author}: ${room.preview}`
                  : room.preview}
            </span>
            {unread && (
              <span className="shrink-0 rounded-full bg-accent px-2 text-pill font-medium text-white tabular-nums">
                {count(room.unread_count)}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  )
}

function Thread({
  room,
  onBack,
}: {
  room: ChatConversation
  onBack: () => void
}) {
  const me = useIdentity().data?.username
  const thread = useThread(room.conversation_id)
  const markRead = useMarkRead()
  const messages = useMemo(() => thread.data ?? [], [thread.data])
  const latest = messages.length === 0 ? 0 : messages[messages.length - 1].seq

  // Move the read mark when the thread is on screen and has something newer
  // than it. Remembered per mount so a failed call is not retried in a loop.
  const marked = useRef(room.last_read_seq)
  useEffect(() => {
    if (latest > marked.current && document.visibilityState === "visible") {
      marked.current = latest
      markRead.mutate({ conversationId: room.conversation_id, seq: latest })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest, room.conversation_id])

  // Stay at the foot as new lines arrive.
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" })
  }, [latest])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2.5 md:px-4">
        <Button
          variant="quiet"
          aria-label="Back to conversations"
          className="-ml-1 h-8 px-2 md:hidden pointer-coarse:h-tap"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0">
          <p className="truncate text-cell font-medium text-ink">{room.title}</p>
          {room.kind === "GROUP" && (
            <p className="truncate text-pill text-mute">
              {room.members.map((m) => m.display_name).join(", ")}
            </p>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-5">
        {thread.isPending ? (
          <LoadingState>Loading…</LoadingState>
        ) : thread.isError ? (
          <Banner tone="bad">{describe(thread.error)}</Banner>
        ) : messages.length === 0 ? (
          <EmptyState>Say hello.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {messages.map((m, i) => (
              <Bubble
                key={m.message_id}
                message={m}
                mine={m.author === me}
                showName={
                  room.kind === "GROUP" &&
                  m.author !== me &&
                  messages[i - 1]?.author !== m.author
                }
                newDay={
                  i === 0 ||
                  dayOf(messages[i - 1].sent_at) !== dayOf(m.sent_at)
                }
              />
            ))}
          </ul>
        )}
        <div ref={end} />
      </div>

      <Composer conversationId={room.conversation_id} />
    </div>
  )
}

function Bubble({
  message,
  mine,
  showName,
  newDay,
}: {
  message: ChatMessage
  mine: boolean
  showName: boolean
  newDay: boolean
}) {
  const system = message.kind === "SYSTEM"
  return (
    <>
      {newDay && (
        <li className="my-2 text-center text-pill text-mute">
          {dayLabel(message.sent_at)}
        </li>
      )}
      {system ? (
        <li className="py-1 text-center text-meta text-mute">{message.body}</li>
      ) : (
        <li className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
          {showName && (
            <span className="mb-0.5 px-1 text-pill text-mute">
              {message.author_name}
            </span>
          )}
          <div
            className={cn(
              "max-w-[85%] rounded-card px-3.5 py-2 md:max-w-[70%]",
              mine ? "bg-cta text-cta-fg" : "bg-soft-2 text-ink",
            )}
          >
            {message.deleted_at !== null ? (
              <p className="text-meta italic opacity-70">Message deleted</p>
            ) : (
              <p className="text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap">
                {message.body}
              </p>
            )}
            <p
              className={cn(
                "mt-0.5 text-right text-pill tabular-nums",
                mine ? "text-cta-fg/70" : "text-mute",
              )}
            >
              {clock(message.sent_at)}
            </p>
          </div>
        </li>
      )}
    </>
  )
}

function Composer({ conversationId }: { conversationId: string }) {
  const [text, setText] = useState("")
  // Minted once per message, kept across a failed attempt, replaced on success.
  const key = useRef(crypto.randomUUID())
  const send = useSend(conversationId)
  const body = text.trim()

  const submit = () => {
    if (body === "" || send.isPending) return
    send.mutate(
      { body, idempotency_key: key.current },
      {
        onSuccess: () => {
          setText("")
          key.current = crypto.randomUUID()
        },
      },
    )
  }

  return (
    <div className="border-t border-hairline p-3">
      {send.isError && (
        <Banner tone="bad" className="mb-2">
          {describe(send.error)}
        </Banner>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          rows={1}
          aria-label="Message"
          placeholder="Write a message"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends under a keyboard; on a phone it is a new line and
            // the button sends.
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              window.matchMedia("(pointer: fine)").matches
            ) {
              e.preventDefault()
              submit()
            }
          }}
          className="max-h-32 min-h-12 w-full resize-none rounded-inner bg-soft-2 px-4 py-3 text-[1rem] text-ink outline-none placeholder:text-mute"
        />
        <Button
          variant="primary"
          aria-label="Send"
          className="size-12 px-0"
          disabled={body === "" || send.isPending}
          onClick={submit}
        >
          <SendHorizontal />
        </Button>
      </div>
    </div>
  )
}

function NewChat({
  onCancel,
  onStarted,
}: {
  onCancel: () => void
  onStarted: (room: ChatConversation) => void
}) {
  const me = useIdentity().data?.username
  const people = usePeople(true)
  const start = useStartChat()
  const [kind, setKind] = useState<"DIRECT" | "GROUP">("DIRECT")
  const [title, setTitle] = useState("")
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState<readonly string[]>([])

  const choices = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (people.data ?? [])
      .filter((u) => u.username !== me)
      .map((u) => ({ username: u.username, name: u.name }))
      .filter(
        (u) =>
          q === "" ||
          u.name.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q),
      )
  }, [people.data, me, query])

  const toggle = (username: string) =>
    setPicked((now) =>
      kind === "DIRECT"
        ? [username]
        : now.includes(username)
          ? now.filter((x) => x !== username)
          : [...now, username],
    )

  const ready =
    kind === "DIRECT" ? picked.length === 1 : picked.length >= 1 && title.trim() !== ""

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2.5 md:px-4">
        <Button
          variant="quiet"
          aria-label="Cancel"
          className="-ml-1 h-8 px-2 pointer-coarse:h-tap"
          onClick={onCancel}
        >
          <ArrowLeft />
        </Button>
        <p className="text-cell font-medium text-ink">New chat</p>
      </div>
      <div className="flex flex-col gap-3 p-3 md:p-4">
        <Segmented<"DIRECT" | "GROUP">
          value={kind}
          onChange={(next) => {
            setKind(next)
            setPicked((now) => (next === "DIRECT" ? now.slice(0, 1) : now))
          }}
          options={[
            { value: "DIRECT", label: "Person" },
            { value: "GROUP", label: "Group" },
          ]}
        />
        {kind === "GROUP" && (
          <Input
            value={title}
            aria-label="Group name"
            placeholder="Group name"
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
        <Input
          value={query}
          aria-label="Search people"
          placeholder="Search people"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-hairline">
        {people.isPending ? (
          <LoadingState>Loading…</LoadingState>
        ) : people.isError ? (
          <div className="p-3">
            <Banner tone="bad">{describe(people.error)}</Banner>
          </div>
        ) : choices.length === 0 ? (
          <EmptyState>Nobody found.</EmptyState>
        ) : (
          <ul>
            {choices.map((u) => {
              const on = picked.includes(u.username)
              return (
                <li
                  key={u.username}
                  className="border-b border-hairline last:border-b-0"
                >
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(u.username)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-cell pointer-coarse:min-h-tap",
                      on ? "bg-soft font-medium text-ink" : "text-body hover:bg-soft",
                    )}
                  >
                    {u.name}
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 rounded-full",
                        on ? "bg-accent" : "bg-hairline-strong",
                      )}
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="border-t border-hairline p-3">
        {start.isError && (
          <Banner tone="bad" className="mb-2">
            {describe(start.error)}
          </Banner>
        )}
        <Button
          variant="primary"
          block
          disabled={!ready || start.isPending}
          onClick={() =>
            start.mutate(
              {
                kind,
                title: kind === "GROUP" ? title.trim() : null,
                participants: [...picked],
              },
              { onSuccess: onStarted },
            )
          }
        >
          {start.isPending ? "Starting…" : "Start chat"}
        </Button>
      </div>
    </div>
  )
}

function dayOf(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (dayOf(iso) === dayOf(today.toISOString())) return "Today"
  if (dayOf(iso) === dayOf(yesterday.toISOString())) return "Yesterday"
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long" })
}

function clock(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
}

/// Today as a time, otherwise the day — for the conversation list.
function shortWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return dayOf(iso) === dayOf(new Date().toISOString())
    ? clock(iso)
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}
