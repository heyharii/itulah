import { Check, Plus, Search, SendHorizontal, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { CentralGate } from "@/components/central-gate"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Fab } from "@/components/ui/fab"
import { Field, Input } from "@/components/ui/field"
import { Screen } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { describe } from "@/lib/errors"
import { count, dateText } from "@/lib/format"
import { useLayout } from "@/lib/layout"
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
import { Notices, TabSwitch, tabStatus, type DiscussTab } from "@/screens/news"
import type { ChatConversation, ChatMessage } from "@itulah/contract"

/// Where this shop talks to head office: Chat (people and groups) and Notices
/// (what head office has sent, `news.tsx`).
///
/// No badge anywhere but here. The console shows a count on the rail in every
/// module; this app lives beside a counter with a customer in front of it, so
/// unread shows on the tab and the conversation rows and nowhere over the
/// screen somebody is working in.
export function Discuss() {
  return (
    <CentralGate what="Discuss">
      <DiscussTabs />
    </CentralGate>
  )
}

function DiscussTabs() {
  const [tab, setTab] = useState<DiscussTab>("chat")
  const conversations = useConversations()
  const unread = (conversations.data ?? []).reduce(
    (sum, c) => sum + (c.muted ? 0 : c.unread_count),
    0,
  )

  if (tab === "notices")
    return <Notices tab={tab} onTab={setTab} unread={unread} />
  return (
    <Chat
      tab={tab}
      onTab={setTab}
      unread={unread}
      conversations={conversations}
    />
  )
}

/// The conversations, and the one open.
///
/// Phone: the list is the page — nothing above it but the title — with Chat /
/// Notices as the dock's status chip, the search beside it and "+" for a new
/// chat. A conversation opens as a sheet (the thread, its composer pinned in
/// the foot), the same way a record does everywhere else. Desk: the list and
/// the thread side by side.
function Chat({
  tab,
  onTab,
  unread,
  conversations,
}: {
  tab: DiscussTab
  onTab: (tab: DiscussTab) => void
  unread: number
  conversations: ReturnType<typeof useConversations>
}) {
  const phone = useLayout() === "phone"
  const [openId, setOpenId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [query, setQuery] = useState("")
  const all = conversations.data ?? []
  const needle = query.trim().toLowerCase()
  const rooms =
    needle === ""
      ? all
      : all.filter((room) =>
          `${room.title} ${room.preview ?? ""} ${room.members
            .map((member) => member.display_name)
            .join(" ")}`
            .toLowerCase()
            .includes(needle),
        )
  const current = all.find((c) => c.conversation_id === openId) ?? null

  const list = conversations.isPending ? (
    <LoadingState>Reading the conversations…</LoadingState>
  ) : conversations.isError ? (
    <div className="p-3">
      <Banner tone="bad">{describe(conversations.error)}</Banner>
    </div>
  ) : rooms.length === 0 ? (
    <EmptyState>
      {needle === ""
        ? "No conversations yet."
        : "No conversation matches that."}
    </EmptyState>
  ) : (
    <ul>
      {rooms.map((room) => (
        <RoomRow
          key={room.conversation_id}
          room={room}
          on={room.conversation_id === openId}
          onOpen={() => setOpenId(room.conversation_id)}
        />
      ))}
    </ul>
  )

  return (
    <Screen
      actions={
        <>
          <TabSwitch tab={tab} onTab={onTab} unread={unread} />
          <Button variant="primary" onClick={() => setStarting(true)}>
            <Plus />
            New chat
          </Button>
        </>
      }
    >
      <DockTools
        status={tabStatus(tab, onTab, unread)}
        search={{ value: query, onChange: setQuery, label: "Search chats" }}
      />
      <Fab label="New chat" onClick={() => setStarting(true)} />

      {phone ? (
        <>
          <Card className="overflow-hidden">{list}</Card>
          <Sheet
            open={current !== null}
            onOpenChange={(open) => !open && setOpenId(null)}
            title={current?.title ?? ""}
            caption={current === null ? undefined : memberLine(current)}
            footer={
              current === null ? undefined : (
                <Composer conversationId={current.conversation_id} />
              )
            }
          >
            {current !== null && (
              <ThreadBody key={current.conversation_id} room={current} />
            )}
          </Sheet>
        </>
      ) : (
        <Card className="grid h-[calc(100dvh-10rem)] min-h-[26rem] grid-cols-[20rem_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-r border-hairline">
            <div className="border-b border-hairline p-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-line-ico" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search chats"
                  aria-label="Search chats"
                  className="h-9 w-full rounded-inner border border-hairline-2 bg-canvas pr-8 pl-8 text-[0.875rem] text-ink outline-none placeholder:text-body hover:border-hairline-strong focus:border-accent"
                />
                {query !== "" && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear the search"
                    className="absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-inner text-line-ico hover:bg-soft-2 hover:text-ink"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
          </div>
          <div className="min-h-0 min-w-0">
            {current !== null ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="border-b border-hairline px-4 py-2.5">
                  <p className="truncate text-cell font-medium text-ink">
                    {current.title}
                  </p>
                  {current.kind === "GROUP" && (
                    <p className="truncate text-pill text-mute">
                      {memberLine(current)}
                    </p>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  <ThreadBody key={current.conversation_id} room={current} />
                </div>
                <div className="border-t border-hairline p-3">
                  <Composer conversationId={current.conversation_id} />
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <EmptyState>
                  Pick a conversation or start a new chat.
                </EmptyState>
              </div>
            )}
          </div>
        </Card>
      )}

      <NewChat
        open={starting}
        onOpenChange={setStarting}
        onStarted={(room) => {
          setStarting(false)
          setOpenId(room.conversation_id)
        }}
      />
    </Screen>
  )
}

/// A group's people, by name — the line under a thread's title.
function memberLine(room: ChatConversation): string | undefined {
  return room.kind === "GROUP"
    ? room.members.map((m) => m.display_name).join(", ")
    : undefined
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
          on ? "bg-soft" : "hover:bg-soft active:bg-soft",
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
              <span className="shrink-0 rounded-full bg-accent px-2 text-pill font-medium text-on-dark tabular-nums">
                {count(room.unread_count)}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  )
}

/// The thread's lines: the messages of one conversation, the day they were
/// written over each first one, and the read mark moved while it is on screen.
/// It does not scroll itself — the phone's sheet or the desk's pane around it
/// does.
function ThreadBody({ room }: { room: ChatConversation }) {
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
    <>
      {thread.isPending ? (
        <LoadingState>Reading the conversation…</LoadingState>
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
                i === 0 || dayOf(messages[i - 1].sent_at) !== dayOf(m.sent_at)
              }
            />
          ))}
        </ul>
      )}
      <div ref={end} />
    </>
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

/// The box a message is written in — pinned under the thread: the phone
/// sheet's foot, the desk pane's foot.
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
    <div>
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
          // 16px: iOS zooms the page into any field set smaller.
          className="max-h-32 min-h-11 w-full resize-none rounded-inner bg-soft-2 px-3.5 py-2.5 text-[1rem] text-ink outline-none placeholder:text-mute"
        />
        <Button
          variant="primary"
          aria-label="Send"
          className="relative size-9 px-0 after:absolute after:-inset-1 after:content-['']"
          disabled={body === "" || send.isPending}
          onClick={submit}
        >
          <SendHorizontal />
        </Button>
      </div>
    </div>
  )
}

/// Start a conversation: with one person, or a named group. A sheet at every
/// width — it is a task, not a place to stay — with `[Cancel] [Start chat]` in
/// the foot.
function NewChat({
  open,
  onOpenChange,
  onStarted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStarted: (room: ChatConversation) => void
}) {
  const me = useIdentity().data?.username
  const people = usePeople(open)
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
    kind === "DIRECT"
      ? picked.length === 1
      : picked.length >= 1 && title.trim() !== ""

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          start.reset()
          setPicked([])
          setTitle("")
          setQuery("")
        }
      }}
      title="New chat"
      footer={
        <div className="flex flex-col gap-3">
          {start.isError && <Banner tone="bad">{describe(start.error)}</Banner>}
          <div className="flex items-center justify-end gap-2">
            <Button variant="quiet" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              pending={start.isPending}
              disabled={!ready}
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
      }
    >
      <div className="flex flex-col gap-5">
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
          <Field label="Group name" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        )}
        <Field label="People">
          <Input
            value={query}
            aria-label="Search people"
            placeholder="Search people"
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <div className="-mx-1">
          {people.isPending ? (
            <LoadingState>Reading the people…</LoadingState>
          ) : people.isError ? (
            <Banner tone="bad">{describe(people.error)}</Banner>
          ) : choices.length === 0 ? (
            <EmptyState>Nobody found.</EmptyState>
          ) : (
            <ul>
              {choices.map((u) => {
                const on = picked.includes(u.username)
                return (
                  <li key={u.username}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(u.username)}
                      className={cn(
                        "flex min-h-11 w-full items-center justify-between gap-3 rounded-inner px-3 text-left text-cell transition-colors",
                        on
                          ? "font-medium text-accent"
                          : "text-body hover:bg-soft-2 hover:text-ink",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{u.name}</span>
                      <Check
                        className={cn("size-4 shrink-0", !on && "opacity-0")}
                      />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  )
}

function dayOf(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/// "Today", "Yesterday", then the house date — `06 Oct 2026`.
function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (dayOf(iso) === dayOf(today.toISOString())) return "Today"
  if (dayOf(iso) === dayOf(yesterday.toISOString())) return "Yesterday"
  return dateText(d, { day: "2-digit", month: "short", year: "numeric" })
}

/// The minute, 24-hour.
function clock(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return dateText(d, { hour: "2-digit", minute: "2-digit", hour12: false })
}

/// Today as a time, otherwise the day — for the conversation list.
function shortWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return dayOf(iso) === dayOf(new Date().toISOString())
    ? clock(iso)
    : dateText(d, { day: "2-digit", month: "short", year: "numeric" })
}
