import { Attachment } from "@/components/collaboration/attachment"
import { PersonAvatar } from "@/components/collaboration/person"
import { Button } from "@/components/ui/button"
import { attachmentUrl } from "@/lib/chat"
import { clock, dayOf } from "@/lib/collaboration"
import { cn } from "@/lib/utils"
import type { ChatMessage, StoredFile } from "@itulah/contract"
import { useEffect, useRef } from "react"

/// A message this browser has drawn but the server has not confirmed.
///
/// Kept as its own shape rather than being pushed into the message list with a
/// fake `seq`: an invented sequence number is a lie the rest of the screen
/// would then reason about, and `seq` is the one thing in a conversation that
/// is never guessed.
export interface PendingMessage {
  readonly key: string
  readonly idempotencyKey: string
  readonly body: string
  readonly attachments: StoredFile[]
  readonly replyToSeq: number | null
  readonly failed: boolean
}

/// The conversation itself.
///
/// Three decisions from the prototype survive here intact.
///
/// Order comes from `seq`, never from the sender's clock. A till whose time is
/// wrong must not be able to insert itself into the middle of an argument.
///
/// Unread is a line, not a badge. The server sends `last_read_seq` as well as
/// `latest_message_seq`, so the boundary has a position and the line can be
/// drawn exactly where reading stopped. A count alone throws that away.
///
/// A message waiting on the server is shown as waiting. Not hidden, and not
/// drawn as though it had landed: it carries an idempotency key minted before
/// the first attempt, so saying "will be resent with the same key" is a
/// description of what happens and not a reassurance.
export function MessageThread({
  conversationId,
  me,
  messages,
  pending,
  unreadFrom,
  onRetry,
}: {
  conversationId: string
  me: string | undefined
  messages: ChatMessage[]
  pending: PendingMessage[]
  /// Where this reader had got to when they opened the conversation. Frozen at
  /// that moment on purpose — the read mark moves to the bottom a beat later,
  /// and a line that followed it would vanish before it was any use.
  unreadFrom: number | undefined
  onRetry: (message: PendingMessage) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = scroller.current
    if (box === null) return
    box.scrollTop = box.scrollHeight
  }, [conversationId, messages.length, pending.length])

  const seen = new Set<number>()
  let previousAuthor: string | null = null
  let previousDay: string | null = null
  let drewUnreadLine = false

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {messages.length === 0 && pending.length === 0 && (
        <p className="text-muted-foreground py-10 text-center text-xs">
          Nothing has been said here yet.
        </p>
      )}
      {messages.map((message) => {
        seen.add(message.seq)
        const day = dayOf(message.sent_at)
        const newDay = day !== previousDay
        previousDay = day
        const unreadHere =
          !drewUnreadLine &&
          unreadFrom !== undefined &&
          message.seq > unreadFrom &&
          message.author !== me
        if (unreadHere) drewUnreadLine = true
        const grouped = !newDay && !unreadHere && previousAuthor === message.author
        previousAuthor = message.author
        const quoted =
          message.reply_to_seq === null
            ? undefined
            : messages.find((other) => other.seq === message.reply_to_seq)

        return (
          <div key={message.message_id}>
            {newDay && <DayDivider day={day} />}
            {unreadHere && <UnreadLine />}
            <Bubble
              mine={message.author === me}
              author={message.author}
              at={clock(message.sent_at)}
              seq={message.seq}
              grouped={grouped}
              quoted={
                quoted === undefined
                  ? undefined
                  : `${quoted.author}: ${quoted.body.slice(0, 60)}`
              }
              body={message.body}
              attachments={message.attachments}
              conversationId={conversationId}
            />
          </div>
        )
      })}

      {pending.map((message) => (
        <Bubble
          key={message.key}
          mine
          author={me ?? "you"}
          at="sending"
          grouped={false}
          body={message.body}
          attachments={message.attachments}
          conversationId={conversationId}
          note={
            message.failed ? (
              <span className="flex items-center justify-end gap-2">
                <span className="text-destructive">Not sent.</span>
                <Button size="xs" variant="ghost" onClick={() => onRetry(message)}>
                  Send again
                </Button>
              </span>
            ) : (
              "Not on the server yet · a resend carries the same key"
            )
          }
        />
      ))}
    </div>
  )
}

function DayDivider({ day }: { day: string }) {
  return (
    <div className="my-3 flex justify-center">
      <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-[11px]">
        {day}
      </span>
    </div>
  )
}

/// Where reading stopped, drawn at the position the server named.
function UnreadLine() {
  return (
    <div className="my-3 flex items-center gap-2.5">
      <span className="text-destructive shrink-0 text-[11px]">Unread from here</span>
      <span aria-hidden className="bg-destructive/60 h-px flex-1" />
    </div>
  )
}

function Bubble({
  mine,
  author,
  at,
  seq,
  grouped,
  quoted,
  body,
  attachments,
  conversationId,
  note,
}: {
  mine: boolean
  author: string
  at: string
  seq?: number
  grouped: boolean
  quoted?: string
  body: string
  attachments: StoredFile[]
  conversationId: string
  note?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex max-w-[min(42rem,100%)] gap-2 py-0.5",
        mine && "ml-auto flex-row-reverse",
      )}
    >
      <PersonAvatar
        username={author}
        size="sm"
        className={cn(grouped && "invisible")}
      />
      <div className={cn("min-w-0", note !== undefined && "opacity-60")}>
        {!grouped && (
          <div
            className={cn(
              "mb-0.5 flex items-baseline gap-1.5",
              mine && "flex-row-reverse",
            )}
          >
            <span className="text-xs font-medium">{author}</span>
            <span className="text-muted-foreground text-[10px]">{at}</span>
            {seq !== undefined && (
              <span className="text-muted-foreground font-mono text-[10px] opacity-70">
                #{seq}
              </span>
            )}
          </div>
        )}
        {quoted !== undefined && (
          <div className="text-muted-foreground mb-1 truncate border-l-2 py-0.5 pl-2 text-[11px]">
            {quoted}
          </div>
        )}
        {body.trim() !== "" && (
          <div
            className={cn(
              "rounded-xl px-3 py-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap",
              mine ? "bg-primary text-primary-foreground" : "bg-muted",
            )}
          >
            {body}
          </div>
        )}
        {attachments.length > 0 && (
          <div className={cn("mt-1 flex flex-col gap-1", mine && "items-end")}>
            {attachments.map((file) => (
              <Attachment
                key={file.file_id}
                file={file}
                href={attachmentUrl(conversationId, file.file_id)}
              />
            ))}
          </div>
        )}
        {note !== undefined && (
          <div
            className={cn("text-muted-foreground mt-1 text-[10px]", mine && "text-right")}
          >
            {note}
          </div>
        )}
      </div>
    </div>
  )
}
