import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getRouteApi } from "@tanstack/react-router"

import { Icon, paths } from "@/components/dashboard/parts"
import { Switch } from "@/components/dashboard/nav-sidebar"
import { SheetShell } from "@/components/dashboard/sheet-shell"
import { ChatSidebar, PersonAvatar } from "@/components/chat-app/chat-sidebar"
import { MessageStream } from "@/components/chat-app/message-stream"
import {
  markChannelRead,
  useChatWorkspace,
  useConversationMessages,
  useCreateDirectConversation,
  useSendChatMessage,
  useToggleDirectReaction,
  type ConversationKind,
} from "@/components/chat-app/api"
import {
  ChatDirectoryContext,
  fallbackName,
  type Channel,
  type ChatDirectory,
  type ChatPerson,
  type ConversationId,
  type Message,
  type DirectConversation,
} from "@/components/chat-app/data"
import {
  cue,
  readSoundPreference,
  useInteractionSounds,
  writeSoundPreference,
} from "@/components/dashboard/use-interaction-sounds"
import { PreviewNotice } from "@/components/backend-status"
import { cn } from "@/lib/utils"
import {
  AppShell,
  AppShellSidebar,
  SidebarTrigger,
} from "@/components/app-shell"

const EMPTY_CHANNELS: Channel[] = []
const EMPTY_DIRECT_MESSAGES: DirectConversation[] = []
const EMPTY_DIRECTORY: ChatDirectory = {}
const EMPTY_PEOPLE: ChatPerson[] = []

/**
 * The id of the unsent conversation. Records have no delete route, so picking a
 * person opens a local draft and the `kind: "dm"` record is only created when
 * the first message is actually sent.
 */
const DRAFT_ID = "__draft__"

const route = getRouteApi("/chat")

export function Chat() {
  /* Channels come from /api/v1/channels, direct messages from the Records
   * hub's DM lens (/api/v1/records?kind=dm) — two separate Go mounts with
   * different auth, assembled into one screen by the adapter. */
  const liveChat = useChatWorkspace()

  /* The open conversation and the member column are navigation: a chat you
   * cannot paste a link to is the bug this screen most obviously had. */
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const active: ConversationId = search.active ?? ""
  const showMembers = search.showMembers ?? false

  const [threads, setThreads] = useState<Record<ConversationId, Message[]>>({})
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [draft, setDraft] = useState("")
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [railHidden, setRailHidden] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pickQuery, setPickQuery] = useState("")
  const [soundOn, setSoundOn] = useState(readSoundPreference)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendBusy, setSendBusy] = useState(false)
  const [pendingPartner, setPendingPartner] = useState<ChatPerson | null>(null)

  useInteractionSounds(soundOn)

  const streamRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  /** Opening a conversation is a real destination, so it is pushed. */
  const openConversation = useCallback(
    (id: ConversationId) => {
      void navigate({
        search: (prev) => ({ ...prev, active: id || undefined }),
      })
    },
    [navigate],
  )

  const channels: Channel[] = liveChat.data?.channels ?? EMPTY_CHANNELS
  const directMessages: DirectConversation[] =
    liveChat.data?.directMessages ?? EMPTY_DIRECT_MESSAGES
  const directory = liveChat.data?.directory ?? EMPTY_DIRECTORY
  const currentUserId = liveChat.data?.currentUserId ?? ""
  const people = liveChat.data?.people ?? EMPTY_PEOPLE
  const channelsError = liveChat.data?.channelsError
  const channel = channels.find((c) => c.id === active)
  const direct = channel
    ? undefined
    : directMessages.find((item) => item.id === active)
  const drafting = active === DRAFT_ID && pendingPartner !== null

  const kind: ConversationKind | null = channel ? "channel" : direct ? "dm" : null
  const conversationId = channel?.id ?? direct?.id ?? ""

  /* The open thread is its own cache entry, so coming back to a conversation
   * is served from memory and a send only refetches the thread it landed in. */
  const liveMessages = useConversationMessages(conversationId, kind)
  const sendMessage = useSendChatMessage(conversationId, kind)
  const reactToMessage = useToggleDirectReaction(conversationId)
  const createConversation = useCreateDirectConversation()

  /* A DM record's own body is the opening post and is not one of the comments
   * the thread route returns, so it is carried over from the workspace read. */
  const messages = useMemo(() => {
    const fallback = threads[active] ?? []
    const live = liveMessages.data
    if (!live) return fallback
    if (kind !== "dm") return live
    const replies = [...live].sort((left, right) => right.age - left.age)
    const opener = fallback.find((message) => message.isOpener)
    return opener ? [opener, ...replies] : replies
  }, [active, kind, liveMessages.data, threads])

  /*
   * Variables-based optimism (§M3) — the strongest case in the app, per
   * docs/frontend-rules.md: the composer stays on the same thread, and the
   * new message shows in exactly one place, the stream already on screen.
   * Built straight from `sendMessage`'s own `variables`/`isPending`, never
   * written into the cache — the placeholder id and "just now" age are
   * discarded the moment `onSettled`'s refetch lands the server's real
   * message, with its real id and timestamp (§M5).
   */
  const pendingMessage = useMemo<Message | null>(() => {
    if (!sendMessage.isPending || !sendMessage.variables) return null
    return {
      id: "pending-message",
      authorId: currentUserId,
      age: 0,
      text: sendMessage.variables.body,
      replyToId: sendMessage.variables.replyTo,
    }
  }, [sendMessage.isPending, sendMessage.variables, currentUserId])

  const messagesWithPending = useMemo(
    () => (pendingMessage ? [...messages, pendingMessage] : messages),
    [messages, pendingMessage]
  )

  const nameOf = (id: string) => directory[id]?.name ?? fallbackName(id)

  // Replace the rendered threads with the server response. The component only
  // keeps transient composer state locally.
  useEffect(() => {
    const resource = liveChat.data
    if (!resource) return
    // A request result replaces stale transient view state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThreads(resource.messages)
    setUnread(resource.unread)
  }, [liveChat.data])

  /* A bare /chat, or a link to a conversation the hub does not serve, settles
   * on the first thing in the rail. This replaces rather than pushes: it is a
   * correction to the address, not somewhere the user chose to go. */
  useEffect(() => {
    const resource = liveChat.data
    if (!resource || active === DRAFT_ID) return
    const known =
      resource.channels.some((item) => item.id === active) ||
      resource.directMessages.some((item) => item.id === active)
    if (known) return
    const first =
      resource.channels[0]?.id ?? resource.directMessages[0]?.id ?? ""
    if (first === active) return
    void navigate({
      search: (prev) => ({ ...prev, active: first || undefined }),
      replace: true,
    })
  }, [active, liveChat.data, navigate])

  /** The newest message age per conversation, for the sidebar's hover stamp.
   * An empty thread is simply absent so the rail renders no stamp at all. */
  const lastAt = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(threads)
          .filter(([, list]) => list.length > 0)
          .map(([id, list]) => [id, Math.min(...list.map((m) => m.age))])
      ),
    [threads]
  )

  /* Opening a conversation clears its badge. This watches `unread` as well as
   * `active` because with the selection coming from the URL the effect can run
   * before the workspace has landed — on a cold load of `?active=…` the count
   * arrives after the conversation is already open. */
  useEffect(() => {
    if (!active || !unread[active]) return
    // Only channels carry a read cursor on this backend; a failed POST just
    // leaves the channel unread on the next reload rather than surfacing an
    // error over a passive action.
    void markChannelRead(active).catch(() => undefined)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUnread((u) => {
      if (!u[active]) return u
      const next = { ...u }
      delete next[active]
      return next
    })
  }, [active, unread])

  // switching conversations drops whatever was half-typed for the last one
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReplyTo(null)
    setDraft("")
  }, [active])

  /* Park the view at the newest message. Keyed on the message count as well as
   * the conversation so a cold load still lands at the bottom once the thread
   * arrives, rather than at the top of an empty scroller. */
  const messageCount = messagesWithPending.length
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const el = streamRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [active, messageCount])

  const send = async () => {
    const text = draft.trim()
    if (!text || sendBusy) return

    setSendError(null)
    setSendBusy(true)
    try {
      if (drafting && pendingPartner) {
        // First send materialises the DM record. Its subject line is the
        // opening message, which is also stored as the record body.
        const id = await createConversation.mutateAsync({
          partnerId: pendingPartner.id,
          title: text.slice(0, 120),
          body: text,
        })
        setPendingPartner(null)
        setDraft("")
        openConversation(id)
        cue("success")
        return
      }

      if (!conversationId || !kind) {
        setSendError("Select a conversation before sending")
        return
      }

      // Re-read rather than append: the hub may interleave system messages,
      // and a threaded reply only reads correctly next to its root. The write
      // invalidates this conversation's message key, which does exactly that.
      await sendMessage.mutateAsync({ body: text, replyTo: replyTo ?? undefined })
      setDraft("")
      setReplyTo(null)
      cue("success")
    } catch (error: unknown) {
      setSendError(
        error instanceof Error ? error.message : "Message could not be sent"
      )
    } finally {
      setSendBusy(false)
    }
  }

  /**
   * Reactions exist only on records comments. The hub derives the reactor from
   * session claims, so this can legitimately fail for an API-key caller — the
   * server's own message is shown rather than a guessed local toggle.
   */
  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!direct) return
    try {
      await reactToMessage.mutateAsync({ messageId, emoji })
      setSendError(null)
    } catch (error: unknown) {
      setSendError(
        error instanceof Error ? error.message : "Reaction could not be saved"
      )
    }
  }

  const startDirect = (person: ChatPerson) => {
    const existing = directMessages.find((item) => item.partnerId === person.id)
    if (existing) {
      openConversation(existing.id)
      return
    }
    setPendingPartner(person)
    openConversation(DRAFT_ID)
    setSendError(null)
    requestAnimationFrame(() => composerRef.current?.focus())
  }

  const quoted = replyTo ? messages.find((m) => m.id === replyTo) : undefined

  const pickables = useMemo(() => {
    const q = pickQuery.trim().toLowerCase()
    const channelItems = channels
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .map((c) => ({
        id: c.id,
        kind: "channel" as const,
        label: c.name,
        hint: c.description || `${c.memberIds.length} members · ${c.privacy}`,
        personId: "",
        person: null as ChatPerson | null,
      }))
    const directItems = directMessages
      .filter(
        (item) =>
          !q ||
          item.partnerName.toLowerCase().includes(q) ||
          item.title.toLowerCase().includes(q)
      )
      .map((item) => ({
        id: item.id,
        kind: "person" as const,
        label: item.partnerName,
        hint: item.title,
        personId: item.partnerId ?? item.id,
        person: null as ChatPerson | null,
      }))
    // Everyone the HR directory lists as active. This is the hub's only
    // roster — there is no separate chat people endpoint.
    const openDms = new Set(
      directMessages.map((item) => item.partnerId).filter(Boolean)
    )
    const peopleItems = people
      .filter((person) => !openDms.has(person.id))
      .filter(
        (person) =>
          !q ||
          person.name.toLowerCase().includes(q) ||
          (person.role ?? "").toLowerCase().includes(q)
      )
      .map((person) => ({
        id: `new:${person.id}`,
        kind: "person" as const,
        label: person.name,
        hint: person.role
          ? `${person.role}${person.department ? ` · ${person.department}` : ""}`
          : "Start a direct message",
        personId: person.id,
        person,
      }))
    return [...channelItems, ...directItems, ...peopleItems]
  }, [channels, directMessages, people, pickQuery])

  const headerTitle = channel
    ? channel.name
    : direct
      ? direct.partnerName
      : drafting && pendingPartner
        ? pendingPartner.name
        : "No conversation selected"

  return (
    <ChatDirectoryContext.Provider value={directory}>
    <AppShell
      label="Chat navigation"
      railWidth={236}
      cols={
        railHidden
          ? "grid-cols-[0px_minmax(0,1fr)]"
          : "grid-cols-[236px_minmax(0,1fr)]"
      }
    >
      <AppShellSidebar className={cn(railHidden && "invisible")}>
        <ChatSidebar
          active={active}
          channels={channels}
          channelsNote={
            channelsError ? `Channels ${channelsError}.` : undefined
          }
          directMessages={directMessages}
          unread={unread}
          lastAt={lastAt}
          onCollapse={() => setRailHidden((v) => !v)}
          onNewMessage={() => {
            setPickQuery("")
            setPicking(true)
          }}
          footer={
            <button
              type="button"
              role="switch"
              aria-checked={soundOn}
              data-sound-silent
              onClick={() => {
                const next = !soundOn
                setSoundOn(next)
                writeSoundPreference(next)
                if (next) cue("toggle")
              }}
              className="flex h-[34px] w-full items-center gap-[9px] rounded-control px-2 text-xs font-medium text-ink-2 transition-colors duration-[120ms] hover:bg-hover hover:text-ink"
            >
              <Icon path={paths.sound} className="shrink-0 text-ink-4" />
              Interaction sounds
              <Switch on={soundOn} />
            </button>
          }
        />
      </AppShellSidebar>

      <main
        className={cn(
          "flex min-h-0 min-w-0 flex-col overflow-hidden py-2 pr-2 max-lg:pl-2",
          railHidden && "pl-2"
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-surface shadow-card">
          {liveChat.isLoading && !liveChat.data ? (
            <div className="shrink-0 border-b border-line bg-inset px-4 py-2 text-[11.5px] text-ink-3">
              Loading channels and direct messages…
            </div>
          ) : liveChat.errorMessage && !liveChat.data ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-ember/20 bg-ember/5 px-4 py-2 text-[11.5px] text-ink-3">
              <span className="min-w-0 flex-1 truncate">
                Workspace unavailable: {liveChat.errorMessage}
              </span>
              <button
                type="button"
                onClick={liveChat.reload}
                className="shrink-0 rounded-control bg-surface px-2 py-1 text-[11px] font-medium text-ink shadow-btn hover:bg-hover"
              >
                Retry
              </button>
            </div>
          ) : (
            <PreviewNotice title="Workspace boundary">
              Channels come from cloud-hub&rsquo;s <code>/v1/channels</code>{" "}
              mount and direct messages from the Records hub&rsquo;s DM lens
              (<code>/v1/records?kind=dm</code>); names, positions and
              departments come from <code>/v1/hr/employees</code>.
              {channelsError
                ? ` The channel rail is empty here because it ${channelsError} — the DM side is unaffected.`
                : ""}{" "}
              The hub publishes no presence and no read cursor for DM records,
              so neither is shown.
            </PreviewNotice>
          )}

          {/* who or what you are talking to */}
          <div className="flex h-[56px] shrink-0 items-center gap-3 border-b border-line pr-2.5 pl-4">
            <SidebarTrigger className="-ml-1" />
            {channel ? (
              <span className="grid size-[30px] shrink-0 place-items-center rounded-panel bg-inset font-mono text-[16px] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
                {channel.privacy === "private" ? "•" : "#"}
              </span>
            ) : direct ? (
              <PersonAvatar
                id={direct.partnerId ?? direct.id}
                name={direct.partnerName}
                size={30}
              />
            ) : drafting && pendingPartner ? (
              <PersonAvatar id={pendingPartner.id} size={30} />
            ) : null}

            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold tracking-[-0.01em]">
                {headerTitle}
              </div>
              <div className="truncate text-[11.5px] text-ink-4">
                {channel ? (
                  // The channel's own description; the hub's scope and privacy
                  // stand in when it has none.
                  channel.description ||
                  [
                    channel.privacy,
                    channel.scopeType && channel.scopeId
                      ? `${channel.scopeType}:${channel.scopeId}`
                      : channel.scopeId,
                    `${channel.memberIds.length} member${channel.memberIds.length === 1 ? "" : "s"}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                ) : direct ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="truncate">{direct.title}</span>
                    {direct.queue && <span>· {direct.queue}</span>}
                    {direct.tags.map((tag) => (
                      <span key={tag}>· {tag}</span>
                    ))}
                  </span>
                ) : drafting && pendingPartner ? (
                  <span>
                    New direct message
                    {pendingPartner.role ? ` · ${pendingPartner.role}` : ""} —
                    sent as one record on the first message
                  </span>
                ) : null}
              </div>
            </div>

            {channel && (
              <button
                type="button"
                onClick={() =>
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      showMembers: showMembers ? undefined : true,
                    }),
                    replace: true,
                  })
                }
                aria-pressed={showMembers}
                className={cn(
                  "inline-flex h-[30px] items-center gap-1.5 rounded-control px-2 text-xs font-medium transition-colors duration-[120ms]",
                  showMembers
                    ? "bg-accent-tint text-accent-ink"
                    : "text-ink-3 hover:bg-hover hover:text-ink"
                )}
              >
                <span className="flex -space-x-1.5">
                  {channel.memberIds.slice(0, 3).map((id) => (
                    <PersonAvatar
                      key={id}
                      id={id}
                      size={20}
                      className="rounded-full ring-2 ring-surface"
                    />
                  ))}
                </span>
                <span className="font-mono tabular-nums">
                  {channel.memberIds.length}
                </span>
              </button>
            )}
          </div>

          <div className="flex min-h-0 flex-1">
            <div
              ref={streamRef}
              className="min-h-0 flex-1 [scrollbar-color:var(--line-strong)_transparent] overflow-auto"
            >
              <MessageStream
                messages={drafting ? [] : messagesWithPending}
                onToggleReaction={toggleReaction}
                onReply={(id) => {
                  setReplyTo(id)
                  composerRef.current?.focus()
                }}
                emptyLabel={
                  drafting && pendingPartner
                    ? `No messages with ${pendingPartner.name} yet — the conversation is created when you send.`
                    : active
                      ? `No messages in ${headerTitle} yet — say something.`
                      : "Select a conversation to start talking."
                }
                currentUserId={currentUserId}
                // Channels thread replies via `thread_root_id`; a DM record's
                // comment thread is flat, so there is nothing to reply *to*.
                allowReply={Boolean(channel)}
                // Only records comments have a reaction route.
                allowReact={Boolean(direct)}
              />
            </div>

            {channel && showMembers && (
              <aside className="hidden w-[212px] shrink-0 flex-col overflow-auto border-l border-line lg:flex">
                <div className="px-3.5 pt-4 pb-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
                  Members
                </div>
                {channel.members.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => {
                      const conversation = directMessages.find(
                        (item) => item.partnerId === member.id
                      )
                      if (conversation) {
                        openConversation(conversation.id)
                        return
                      }
                      const person = people.find((p) => p.id === member.id)
                      if (person) startDirect(person)
                    }}
                    disabled={member.id === currentUserId}
                    className="flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-hover disabled:pointer-events-none"
                  >
                    <PersonAvatar id={member.id} size={26} />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-ink">
                        {member.id === currentUserId
                          ? "You"
                          : nameOf(member.id)}
                      </span>
                      {/* The channel's own membership role, plus the position
                          the HR directory publishes for that person. */}
                      <span className="block truncate text-[11px] text-ink-4">
                        {[member.role, directory[member.id]?.role]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </button>
                ))}
              </aside>
            )}
          </div>

          {/* composer */}
          <div className="shrink-0 border-t border-line p-3">
            {quoted && (
              <div className="mb-2 flex items-center gap-2 rounded-control bg-inset py-1.5 pr-1.5 pl-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
                <Icon
                  path={paths.reply}
                  size={13}
                  width={1.9}
                  className="shrink-0 text-ink-4"
                />
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3">
                  Replying to{" "}
                  <span className="font-medium text-ink-2">
                    {quoted.authorId === currentUserId
                      ? "You"
                      : nameOf(quoted.authorId)}
                  </span>
                  : {quoted.text}
                </span>
                <button
                  type="button"
                  aria-label="Cancel reply"
                  onClick={() => setReplyTo(null)}
                  className="grid size-[22px] shrink-0 place-items-center rounded-chip text-ink-4 transition-colors hover:bg-hover-2 hover:text-ink"
                >
                  <Icon path={paths.close} size={12} width={2.4} />
                </button>
              </div>
            )}

            <div className="rounded-control bg-field shadow-[inset_0_0_0_1px_var(--line-strong)] transition-[box-shadow,background-color] duration-[140ms] focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-tint)]">
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                placeholder={
                  channel
                    ? `Message #${channel.name}`
                    : direct
                      ? `Message ${direct.partnerName}`
                      : drafting && pendingPartner
                        ? `Message ${pendingPartner.name}`
                        : "Select a conversation"
                }
                disabled={!channel && !direct && !drafting}
                className="min-h-[46px] w-full resize-y bg-transparent px-3 py-2.5 text-[13.5px] leading-[1.6] font-medium outline-none placeholder:font-normal placeholder:text-ink-4"
              />
              <div className="flex items-center gap-2 px-2 pb-2">
                <span className="pl-1 font-mono text-[10.5px] text-ink-4">
                  ⏎ to send · ⇧⏎ for a new line
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={!draft.trim() || sendBusy}
                  aria-label="Send message"
                  className="inline-flex h-[28px] items-center gap-1.5 rounded-control bg-accent px-2.5 text-xs font-medium text-white shadow-[0_1px_2px_rgb(0_134_252/.3)] transition-[filter] hover:brightness-105 disabled:pointer-events-none disabled:opacity-45"
                >
                  {sendBusy ? "Sending…" : "Send"}
                  <Icon path={paths.arrowUp} size={13} width={2.4} />
                </button>
              </div>
            </div>
            {sendError && (
              <div className="pt-2 text-[11.5px] text-ember" role="status">
                {sendError}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* jump to any channel or person */}
      <SheetShell
        open={picking}
        eyebrow="New message"
        title="Jump to a conversation"
        onRequestClose={() => setPicking(false)}
      >
        <div className="px-[18px] pt-4 pb-[18px]">
          <label className="mb-3 flex h-[34px] items-center gap-2 rounded-control bg-field px-2.5 text-ink-4 shadow-[inset_0_0_0_1px_var(--line-strong)] focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
            <Icon path={paths.search} size={14} width={1.9} />
            <input
              value={pickQuery}
              onChange={(e) => setPickQuery(e.target.value)}
              placeholder="Search channels and people…"
              aria-label="Search conversations"
              className="w-full text-[13px] font-medium outline-none placeholder:font-normal placeholder:text-ink-4"
            />
          </label>

          <div className="flex flex-col gap-0.5">
            {pickables.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setPicking(false)
                  if (item.person) {
                    startDirect(item.person)
                    return
                  }
                  openConversation(item.id)
                }}
                className="flex items-center gap-2.5 rounded-control px-2 py-2 text-left transition-colors hover:bg-hover"
              >
                {item.kind === "channel" ? (
                  <span className="grid size-[26px] shrink-0 place-items-center rounded-chip bg-inset font-mono text-[14px] text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
                    #
                  </span>
                ) : (
                  <PersonAvatar
                    id={item.personId}
                    name={item.label}
                    size={26}
                  />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {item.label}
                  </span>
                  <span className="block truncate text-[11px] text-ink-4">
                    {item.hint}
                  </span>
                </span>
              </button>
            ))}
            {!pickables.length && (
              <div className="py-8 text-center text-xs text-ink-4">
                Nothing matches that.
              </div>
            )}
          </div>
        </div>
      </SheetShell>
    </AppShell>
    </ChatDirectoryContext.Provider>
  )
}
