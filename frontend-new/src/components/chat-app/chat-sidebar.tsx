import { Link } from "@tanstack/react-router"

import { Icon, paths } from "@/components/dashboard/parts"
import { IconButton } from "@/components/dashboard/nav-sidebar"
import { AppHeading } from "@/components/app-switcher"
import {
  ago,
  avatarGlyph,
  usePerson,
  type Channel,
  type ConversationId,
  type DirectConversation,
} from "@/components/chat-app/data"
import { cn } from "@/lib/utils"

const rowClass =
  "group/row flex h-8 w-full items-center gap-2.5 rounded-control px-2 text-left text-[13px] font-medium transition-colors duration-[110ms]"

/** An avatar coloured from the user id the hub returned. */
export function PersonAvatar({
  id,
  size = 24,
  name,
  className,
}: {
  id: string
  size?: number
  name?: string
  className?: string
}) {
  const person = usePerson(id, name)

  return (
    <span
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <span
        title={person.role ? `${person.name} — ${person.role}` : person.name}
        style={{
          background: person.hue,
          width: size,
          height: size,
          fontSize: size * 0.42,
        }}
        className="grid place-items-center rounded-full font-semibold text-white uppercase select-none"
      >
        {avatarGlyph(person)}
      </span>
    </span>
  )
}

function SectionLabel({
  children,
  onAdd,
}: {
  children: React.ReactNode
  onAdd?: () => void
}) {
  return (
    <div className="mt-3.5 flex h-7 items-center px-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
      {children}
      {onAdd && (
        <IconButton label="New" onClick={onAdd} className="ml-auto size-[22px]">
          <Icon path={paths.plus} size={13} width={2.2} />
        </IconButton>
      )}
    </div>
  )
}

function Unread({ count }: { count?: number }) {
  if (!count) return null
  return (
    <span className="ml-auto grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1.5 font-mono text-[10.5px] font-semibold text-white tabular-nums">
      {count}
    </span>
  )
}

export function ChatSidebar({
  active,
  channels,
  channelsNote,
  directMessages,
  unread,
  lastAt,
  onCollapse,
  onNewMessage,
  footer,
}: {
  active: ConversationId
  channels: Channel[]
  /** Why the channel list is empty, when the hub gave a reason. */
  channelsNote?: string
  directMessages: DirectConversation[]
  unread: Record<string, number>
  lastAt: Record<string, number>
  onCollapse: () => void
  onNewMessage: () => void
  footer?: React.ReactNode
}) {
  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-page">
      <div className="flex h-[52px] shrink-0 items-center gap-1.5 pr-2 pl-2.5">
        <AppHeading app="chat" />
        <IconButton label="Collapse sidebar" onClick={onCollapse}>
          <Icon path={paths.panel} size={17} />
        </IconButton>
      </div>

      <div className="px-2 pb-1">
        <button
          type="button"
          onClick={onNewMessage}
          className="flex h-[32px] w-full items-center gap-2 rounded-control bg-surface px-2.5 text-[13px] font-medium text-ink shadow-btn transition-colors duration-[120ms] hover:bg-hover"
        >
          <Icon
            path={paths.edit}
            size={14}
            width={1.9}
            className="text-ink-3"
          />
          New message
        </button>
      </div>

      <nav className="flex-1 overflow-auto px-2 pb-2">
        <SectionLabel>Channels</SectionLabel>
        {channels.length === 0 ? (
          <div className="px-2 py-2 text-[11px] leading-[1.45] text-ink-4">
            {channelsNote ?? "No channels yet."}
          </div>
        ) : (
          channels.map((c) => {
            const on = active === c.id
            const count = unread[c.id]
            return (
              /* A rail row is a destination, so it is a real link: it
                 middle-clicks, previews on hover and survives a reload. */
              <Link
                key={c.id}
                to="/chat"
                search={(prev) => ({ ...prev, active: c.id })}
                title={c.description || undefined}
                className={cn(
                  rowClass,
                  "text-ink-2 hover:bg-hover hover:text-ink",
                  on && "bg-hover font-semibold text-ink"
                )}
              >
                <span className="grid size-4 shrink-0 place-items-center font-mono text-[15px] leading-none text-ink-4">
                  {/* The hub marks a channel public or private. */}
                  {c.privacy === "private" ? "•" : "#"}
                </span>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                  {c.name}
                </span>
                <Unread count={count} />
              </Link>
            )
          })
        )}

        <SectionLabel onAdd={onNewMessage}>Direct messages</SectionLabel>
        {directMessages.length === 0 ? (
          <div className="px-2 py-2 text-[11px] leading-[1.45] text-ink-4">
            No direct messages yet.
          </div>
        ) : (
          directMessages.map((conversation) => {
            const id = conversation.id
            const on = active === id
            const count = unread[id]
            return (
              <Link
                key={id}
                to="/chat"
                search={(prev) => ({ ...prev, active: id })}
                className={cn(
                  rowClass,
                  "text-ink-2 hover:bg-hover hover:text-ink",
                  on && "bg-hover font-semibold text-ink"
                )}
              >
                <PersonAvatar
                  id={conversation.partnerId ?? conversation.id}
                  name={conversation.partnerName}
                  size={20}
                />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                  {conversation.partnerName}
                </span>
                {count ? (
                  <Unread count={count} />
                ) : (
                  <span className="ml-auto shrink-0 font-mono text-[10.5px] text-ink-4 opacity-0 transition-opacity group-hover/row:opacity-100">
                    {lastAt[id] !== undefined ? ago(lastAt[id]) : ""}
                  </span>
                )}
              </Link>
            )
          })
        )}
      </nav>

      {footer && <div className="shrink-0 p-2">{footer}</div>}
    </aside>
  )
}
