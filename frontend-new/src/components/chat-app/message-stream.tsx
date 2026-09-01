import { Icon, paths } from "@/components/dashboard/parts"
import { PersonAvatar } from "@/components/chat-app/chat-sidebar"
import {
  QUICK_REACTIONS,
  clock,
  dayKey,
  dayLabel,
  fallbackName,
  useChatDirectory,
  type Message,
} from "@/components/chat-app/data"
import { cn } from "@/lib/utils"

/**
 * Go stores a reaction as `emoji -> [user_id]`, so a chip knows exactly who
 * reacted. The tooltip lists them by the names the HR directory publishes.
 */
function Reactions({
  message,
  onToggle,
  names,
}: {
  message: Message
  onToggle: (emoji: string) => void
  names: (ids: string[]) => string
}) {
  if (!message.reactions?.length) return null
  return (
    <div className="flex flex-wrap gap-1 pt-1.5">
      {message.reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          title={names(r.userIds)}
          onClick={() => onToggle(r.emoji)}
          className={cn(
            "inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-[11px] font-medium transition-colors duration-[120ms]",
            r.mine
              ? "border-accent/40 bg-accent-tint text-accent-ink"
              : "border-line-strong bg-surface text-ink-3 hover:border-ink-4 hover:text-ink-2"
          )}
        >
          <span className="text-[12px] leading-none">{r.emoji}</span>
          <span className="font-mono tabular-nums">{r.count}</span>
        </button>
      ))}
    </div>
  )
}

function Attachments({ message }: { message: Message }) {
  if (!message.attachments?.length) return null
  return (
    <div className="flex flex-wrap gap-1 pt-1.5">
      {message.attachments.map((file) => {
        const label = (
          <>
            <Icon
              path={paths.doc}
              size={12}
              width={1.9}
              className="shrink-0 text-ink-4"
            />
            <span className="max-w-[220px] truncate">{file.fileName}</span>
          </>
        )
        return file.url ? (
          <a
            key={file.id}
            href={file.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-line-strong bg-surface px-2 text-[11px] font-medium text-ink-3 transition-colors hover:border-ink-4 hover:text-ink-2"
          >
            {label}
          </a>
        ) : (
          <span
            key={file.id}
            className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-line-strong bg-surface px-2 text-[11px] font-medium text-ink-3"
          >
            {label}
          </span>
        )
      })}
    </div>
  )
}

/** The hover toolbar that Slack-likes park at the top-right of a message. */
function HoverActions({
  onReact,
  onReply,
  allowReply,
  allowReact,
}: {
  onReact: (emoji: string) => void
  onReply: () => void
  allowReply: boolean
  allowReact: boolean
}) {
  if (!allowReply && !allowReact) return null
  return (
    <div className="absolute -top-3.5 right-3 z-10 hidden items-center gap-0.5 rounded-control bg-surface p-0.5 shadow-[0_0_0_1px_var(--line-strong),var(--shadow-card)] group-hover/msg:flex">
      {allowReact &&
        QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={`React ${emoji}`}
            onClick={() => onReact(emoji)}
            className="grid size-[26px] place-items-center rounded-chip text-[13px] transition-colors hover:bg-hover"
          >
            {emoji}
          </button>
        ))}
      {allowReply && (
        <>
          {allowReact && <span className="mx-0.5 h-4 w-px bg-line-strong" />}
          <button
            type="button"
            aria-label="Reply"
            onClick={onReply}
            className="grid size-[26px] place-items-center rounded-chip text-ink-3 transition-colors hover:bg-hover hover:text-ink"
          >
            <Icon path={paths.reply} size={14} width={1.9} />
          </button>
        </>
      )}
    </div>
  )
}

export function MessageStream({
  messages,
  onToggleReaction,
  onReply,
  emptyLabel,
  currentUserId,
  allowReply = true,
  allowReact = true,
}: {
  messages: Message[]
  onToggleReaction: (messageId: string, emoji: string) => void
  onReply: (messageId: string) => void
  emptyLabel: string
  currentUserId?: string
  allowReply?: boolean
  /** False where the hub publishes no reaction route (channel messages). */
  allowReact?: boolean
}) {
  const directory = useChatDirectory()
  const nameOf = (id: string) =>
    directory[id]?.name ?? fallbackName(id)
  const namesOf = (ids: string[]) => ids.map(nameOf).join(", ")

  if (!messages.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-4">
        <span className="grid size-[34px] place-items-center rounded-panel bg-inset shadow-[inset_0_0_0_1px_var(--line-strong)]">
          <Icon path={paths.reply} size={16} width={1.8} />
        </span>
        <span className="text-xs">{emptyLabel}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col py-3">
      {messages.map((message, i) => {
        const previous = messages[i - 1]
        const newDay = !previous || dayKey(previous.age) !== dayKey(message.age)

        // A hub system entry (channel `is_system`, or a records event comment)
        // is an event, not somebody's turn — it reads as a centred note.
        if (message.isSystem) {
          return (
            <div key={message.id}>
              {newDay && <DayDivider age={message.age} />}
              <div className="flex items-center gap-2 px-5 py-1.5 text-[11.5px] text-ink-4">
                <span className="h-px w-4 bg-line" />
                <span className="min-w-0 truncate">
                  {message.text || message.eventType || "Event"}
                </span>
                <span className="font-mono text-[10.5px]">
                  {clock(message.age)}
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>
            </div>
          )
        }

        // consecutive messages from one person within a few minutes read as
        // one turn, so only the first carries an avatar and a name
        const grouped =
          !newDay &&
          Boolean(previous) &&
          !previous.isSystem &&
          previous.authorId === message.authorId &&
          Math.abs(previous.age - message.age) < 10
        const quoted = message.replyToId
          ? messages.find((m) => m.id === message.replyToId)
          : undefined
        const mine = Boolean(currentUserId) && message.authorId === currentUserId

        return (
          <div key={message.id}>
            {newDay && <DayDivider age={message.age} />}

            <div
              className={cn(
                "group/msg relative flex gap-3 px-5 transition-colors hover:bg-hover/60",
                grouped ? "py-0.5" : "pt-2.5 pb-0.5"
              )}
            >
              <div className="w-[34px] shrink-0">
                {grouped ? (
                  <span className="hidden pt-1 text-right font-mono text-[10px] text-ink-4 group-hover/msg:block">
                    {clock(message.age).replace(/\s?[AP]M/i, "")}
                  </span>
                ) : (
                  <PersonAvatar id={message.authorId} size={34} />
                )}
              </div>

              <div className="min-w-0 flex-1 pb-1">
                {!grouped && (
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13.5px] font-semibold text-ink">
                      {mine
                        ? "You"
                        : message.authorId
                          ? nameOf(message.authorId)
                          : "Unattributed"}
                    </span>
                    {/* The hub's own job title, when it publishes one. */}
                    {!mine && directory[message.authorId]?.role && (
                      <span className="truncate text-[10.5px] text-ink-4">
                        {directory[message.authorId]?.role}
                      </span>
                    )}
                    <span className="font-mono text-[10.5px] text-ink-4">
                      {clock(message.age)}
                    </span>
                  </div>
                )}

                {quoted && (
                  <div className="mt-1 mb-1 flex items-center gap-1.5 border-l-2 border-line-strong pl-2 text-[11.5px] text-ink-4">
                    <span className="font-medium text-ink-3">
                      {quoted.authorId === currentUserId
                        ? "You"
                        : nameOf(quoted.authorId)}
                    </span>
                    <span className="truncate">{quoted.text}</span>
                  </div>
                )}

                <p
                  className={cn(
                    "text-[13.5px] leading-[1.6] text-ink-2",
                    !grouped && "pt-0.5"
                  )}
                >
                  {message.text}
                </p>

                {message.mentions?.length ? (
                  <div className="pt-1 text-[11px] text-ink-4">
                    Mentioned {namesOf(message.mentions)}
                  </div>
                ) : null}

                <Attachments message={message} />

                <Reactions
                  message={message}
                  names={namesOf}
                  onToggle={(emoji) => onToggleReaction(message.id, emoji)}
                />
              </div>

              <HoverActions
                onReact={(emoji) => onToggleReaction(message.id, emoji)}
                onReply={() => onReply(message.id)}
                allowReply={allowReply}
                // The opening post of a DM record is the record body; the hub
                // exposes no reaction route for it, only for its comments.
                allowReact={allowReact && !message.isOpener}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DayDivider({ age }: { age: number }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <span className="h-px flex-1 bg-line" />
      <span className="rounded-full bg-inset px-2.5 py-1 text-[11px] font-medium text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]">
        {dayLabel(age)}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}
