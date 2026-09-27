import { Menu } from "@base-ui/react/menu"
import {
  AlertCircle,
  Copy,
  CornerUpLeft,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RotateCw,
  Trash2,
  X,
} from "lucide-react"
import { memo } from "react"

import { ITEM, POPUP } from "@/lib/filter-chrome"
import { cn } from "@/lib/utils"
import type { OutboxItem } from "@/screens/workplace/chat-store"
import { RichText, plainText, type MentionTarget } from "@/screens/workplace/chat-text"
import { clock, dayOf } from "@/screens/workplace/lib"
import { AttachmentLink, Avatar } from "@/screens/workplace/parts"
import { chatAttachmentUrl } from "@/lib/queries/workplace"
import type {
  ChatMessage,
  ChatReplyPreview,
  StoredFile,
} from "@itulah/contract"

/// One line of a conversation, and everything that can be done to it.
///
/// The actions are the ones every team chat converged on — answer it, react
/// to it, correct it, take it back, pin it, copy it — and they sit where those
/// chats put them: a small bar that appears over the line under the pointer,
/// and the same list behind a `…` that is always visible on a touch screen,
/// where there is no hover to reveal anything.

/// The reactions one tap away. Six, because that is what fits beside a line
/// without covering it, and these six are what a shop floor actually answers
/// with: yes, thanks, funny, surprised, sorry, please.
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const

/// The rest of the palette, behind the smiley. Deliberately short: a picker
/// with two thousand emoji is a second app, and this is a reaction.
export const MORE_REACTIONS = [
  "✅",
  "👀",
  "🔥",
  "🎉",
  "👏",
  "💯",
  "🙌",
  "👌",
  "🤔",
  "😅",
  "😍",
  "🙂",
] as const

export interface MessageActions {
  reply: (message: ChatMessage) => void
  edit: (message: ChatMessage) => void
  remove: (message: ChatMessage) => void
  react: (message: ChatMessage, emoji: string, on: boolean) => void
  pin: (message: ChatMessage, pinned: boolean) => void
  copy: (message: ChatMessage) => void
  jump: (seq: number) => void
}

/// The day a run of messages belongs to, between them.
export function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="flex items-center gap-2 py-2.5">
      <span className="h-px flex-1 bg-hairline" />
      <span className="text-pill text-mute">{dayOf(iso)}</span>
      <span className="h-px flex-1 bg-hairline" />
    </div>
  )
}

/// Where reading stopped when the room was opened.
export function UnreadDivider() {
  return (
    <div className="flex items-center gap-2 py-2.5" role="separator">
      <span className="h-px flex-1 bg-accent" />
      <span className="text-pill font-medium text-accent">New</span>
      <span className="h-px flex-1 bg-accent" />
    </div>
  )
}

export const MessageRow = memo(function MessageRow({
  message,
  conversationId,
  me,
  members,
  compact,
  canModerate,
  highlighted,
  receipt,
  actions,
}: {
  message: ChatMessage
  conversationId: string
  me: string | undefined
  members: readonly MentionTarget[]
  /// Same author as the line above, a moment later: no face and no name
  /// again, the way a conversation reads.
  compact: boolean
  /// An admin of the group may take back anybody's line.
  canModerate: boolean
  highlighted: boolean
  /// "Seen", under the reader's own latest line only.
  receipt?: React.ReactNode
  actions: MessageActions
}) {
  if (message.kind === "SYSTEM") {
    return (
      <div
        data-seq={message.seq}
        className={cn(
          "flex justify-center py-1.5 transition-colors",
          highlighted && "rounded-inner bg-accent-bg"
        )}
      >
        <span className="max-w-[85%] text-center text-pill text-mute">
          {message.body}
          <span className="ml-1.5 tabular-nums">{clock(message.sent_at)}</span>
        </span>
      </div>
    )
  }

  const mine = message.author === me
  const deleted = message.deleted_at !== null
  const mentioned = me !== undefined && message.mentions.includes(me)

  return (
    <div
      data-seq={message.seq}
      tabIndex={-1}
      className={cn(
        "group/message relative -mx-2 flex gap-2 rounded-inner px-2 transition-colors duration-300 outline-none",
        compact ? "pt-0.5" : "pt-2.5",
        mine && "flex-row-reverse",
        highlighted && "bg-accent-bg/70",
        !highlighted && mentioned && !deleted && "bg-warn-bg/40"
      )}
    >
      {!mine && (
        <div className="w-7 shrink-0">
          {!compact && (
            <Avatar name={message.author_name} size="default" className="mt-[1.125rem]" />
          )}
        </div>
      )}

      <div
        className={cn(
          "flex max-w-[78%] min-w-0 flex-col max-md:max-w-[85%]",
          mine && "items-end"
        )}
      >
        {!compact && (
          <div className={cn("flex items-baseline gap-2", mine && "flex-row-reverse")}>
            <span className="truncate text-meta font-medium text-body">
              {mine ? "You" : message.author_name}
            </span>
            <span className="shrink-0 text-pill text-mute tabular-nums">
              {clock(message.sent_at)}
            </span>
          </div>
        )}

        <div className={cn("relative mt-1 flex max-w-full flex-col", mine && "items-end")}>
          {message.reply_to !== null && !deleted && (
            <Quote reply={message.reply_to} mine={mine} onJump={actions.jump} />
          )}

          {deleted ? (
            <div className="rounded-inner border border-dashed border-hairline-2 px-3 py-1.5 text-[0.875rem] text-mute italic">
              {mine ? "You deleted this message" : "This message was deleted"}
            </div>
          ) : (
            message.body.trim() !== "" && (
              <div
                className={cn(
                  "rounded-inner px-3 py-2 text-[0.875rem] leading-relaxed break-words whitespace-pre-wrap",
                  // Indigo is "mine" the way it is "selected" everywhere else.
                  // Nothing darkens: the other person's bubble is the soft
                  // grey, never a filled dark one.
                  mine ? "bg-accent-bg text-ink" : "bg-soft-2 text-text"
                )}
              >
                <RichText text={message.body} members={members} me={me} />
              </div>
            )
          )}

          {!deleted && message.attachments.length > 0 && (
            <Attachments
              files={message.attachments}
              conversationId={conversationId}
              mine={mine}
            />
          )}

          {!deleted && <Toolbar message={message} mine={mine} canModerate={canModerate} actions={actions} me={me} />}
        </div>

        {(message.edited_at !== null ||
          message.pinned_at !== null ||
          (compact && !deleted)) && (
          <div
            className={cn(
              "mt-0.5 flex items-center gap-1.5 text-pill text-mute",
              mine && "flex-row-reverse"
            )}
          >
            {message.pinned_at !== null && (
              <span className="inline-flex items-center gap-1 text-accent">
                <Pin className="size-3" /> Pinned
              </span>
            )}
            {message.edited_at !== null && !deleted && (
              <span title={`Edited ${clock(message.edited_at)}`}>edited</span>
            )}
            {compact && !deleted && (
              <span className="tabular-nums opacity-0 transition-opacity group-hover/message:opacity-100 pointer-coarse:hidden">
                {clock(message.sent_at)}
              </span>
            )}
          </div>
        )}

        {!deleted && message.reactions.length > 0 && (
          <div className={cn("mt-1 flex flex-wrap gap-1", mine && "justify-end")}>
            {message.reactions.map((reaction) => {
              const reacted = me !== undefined && reaction.users.includes(me)
              return (
                <button
                  key={reaction.emoji}
                  type="button"
                  onClick={() => actions.react(message, reaction.emoji, !reacted)}
                  title={namesOf(reaction.users, members, me)}
                  aria-pressed={reacted}
                  className={cn(
                    "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[0.8125rem] tabular-nums transition-colors",
                    reacted
                      ? "border-accent/40 bg-accent-bg text-accent"
                      : "border-hairline-2 bg-canvas text-body hover:bg-soft-2"
                  )}
                >
                  <span>{reaction.emoji}</span>
                  <span>{reaction.users.length}</span>
                </button>
              )
            })}
          </div>
        )}

        {receipt !== undefined && (
          <div className="mt-0.5 text-pill text-mute">{receipt}</div>
        )}
      </div>
    </div>
  )
})

function namesOf(
  usernames: readonly string[],
  members: readonly MentionTarget[],
  me: string | undefined
): string {
  return usernames
    .map((name) =>
      name === me
        ? "You"
        : (members.find((member) => member.username === name)?.display_name ?? name)
    )
    .join(", ")
}

/// The line being answered, above the answer. Pressing it goes there.
function Quote({
  reply,
  mine,
  onJump,
}: {
  reply: ChatReplyPreview
  mine: boolean
  onJump: (seq: number) => void
}) {
  const said = reply.deleted
    ? "Deleted message"
    : plainText(reply.body) || (reply.has_attachments ? "📎 Attachment" : "")
  return (
    <button
      type="button"
      onClick={() => onJump(reply.seq)}
      className={cn(
        "mb-1 flex max-w-full min-w-0 flex-col rounded-inner border-l-2 border-accent/60 bg-soft px-2.5 py-1 text-left transition-colors hover:bg-soft-2",
        mine && "self-end"
      )}
    >
      <span className="truncate text-pill font-medium text-accent">
        {reply.author_name}
      </span>
      <span
        className={cn(
          "line-clamp-2 text-[0.8125rem] text-body",
          reply.deleted && "italic text-mute"
        )}
      >
        {said}
      </span>
    </button>
  )
}

/// Photographs as photographs; everything else as a file to download.
function Attachments({
  files,
  conversationId,
  mine,
}: {
  files: readonly StoredFile[]
  conversationId: string
  mine: boolean
}) {
  const images = files.filter(
    (file) => file.available && file.content_type.startsWith("image/")
  )
  const others = files.filter((file) => !images.includes(file))
  return (
    <div className={cn("mt-1 flex max-w-full flex-col gap-1.5", mine && "items-end")}>
      {images.length > 0 && (
        <div className={cn("flex flex-wrap gap-1.5", mine && "justify-end")}>
          {images.map((file) => {
            const href = chatAttachmentUrl(conversationId, file.file_id)
            return (
              <a
                key={file.file_id}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={file.file_name}
                className="block overflow-hidden rounded-inner border border-hairline bg-soft"
              >
                <img
                  src={href}
                  alt={file.file_name}
                  loading="lazy"
                  decoding="async"
                  className="max-h-60 max-w-[16rem] object-cover max-md:max-w-[12rem]"
                />
              </a>
            )
          })}
        </div>
      )}
      {others.map((file) => (
        <div key={file.file_id} className="w-64 max-w-full">
          <AttachmentLink
            name={file.file_name}
            size={file.byte_size}
            available={file.available}
            href={chatAttachmentUrl(conversationId, file.file_id)}
          />
        </div>
      ))}
    </div>
  )
}

/// The bar over a line: three reactions, answer, and the rest behind `…`.
function Toolbar({
  message,
  mine,
  me,
  canModerate,
  actions,
}: {
  message: ChatMessage
  mine: boolean
  me: string | undefined
  canModerate: boolean
  actions: MessageActions
}) {
  const reacted = (emoji: string) =>
    me !== undefined &&
    message.reactions.some(
      (reaction) => reaction.emoji === emoji && reaction.users.includes(me)
    )
  const pinned = message.pinned_at !== null
  const hasWords = message.body.trim() !== ""

  return (
    <div
      className={cn(
        "absolute -top-3.5 z-10 flex items-center gap-0.5 rounded-full border border-hairline-2 bg-canvas p-0.5 shadow-pop",
        "pointer-events-none opacity-0 transition-opacity duration-150",
        "group-hover/message:pointer-events-auto group-hover/message:opacity-100 has-[[data-popup-open]]:pointer-events-auto has-[[data-popup-open]]:opacity-100",
        // No hover under a finger: a tap on the line focuses it (it is
        // `tabIndex=-1`), and a focused line shows its bar. Tapping anywhere
        // else lets it go again.
        "group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100",
        mine ? "right-1" : "left-1"
      )}
    >
      {QUICK_REACTIONS.slice(0, 3).map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`React ${emoji}`}
          onClick={() => actions.react(message, emoji, !reacted(emoji))}
          className="grid size-7 place-items-center rounded-full text-[0.9375rem] transition-transform hover:scale-110 hover:bg-soft-2 pointer-coarse:hidden"
        >
          {emoji}
        </button>
      ))}
      <button
        type="button"
        aria-label="Reply"
        title="Reply"
        onClick={() => actions.reply(message)}
        className="grid size-7 place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-ink pointer-coarse:hidden"
      >
        <CornerUpLeft className="size-3.5" />
      </button>

      <Menu.Root>
        <Menu.Trigger
          aria-label="More actions"
          className="grid size-7 place-items-center rounded-full text-line-ico transition-colors hover:bg-soft-2 hover:text-ink data-[popup-open]:bg-soft-2"
        >
          <MoreHorizontal className="size-4" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align={mine ? "end" : "start"} sideOffset={4} className="z-50">
            <Menu.Popup className={cn(POPUP, "min-w-[13rem]")}>
              <div className="grid grid-cols-6 gap-0.5 px-1 pt-1 pb-1.5">
                {[...QUICK_REACTIONS, ...MORE_REACTIONS].map((emoji) => (
                  <Menu.Item
                    key={emoji}
                    aria-label={`React ${emoji}`}
                    onClick={() => actions.react(message, emoji, !reacted(emoji))}
                    className={cn(
                      "grid size-8 cursor-default place-items-center rounded-md text-[1.0625rem] outline-none data-[highlighted]:bg-soft-2",
                      reacted(emoji) && "bg-accent-bg"
                    )}
                  >
                    {emoji}
                  </Menu.Item>
                ))}
              </div>
              <div className="my-1 h-px bg-hairline" />
              <Menu.Item className={ITEM} onClick={() => actions.reply(message)}>
                <CornerUpLeft className="size-3.5 text-line-ico" /> Reply
              </Menu.Item>
              {hasWords && (
                <Menu.Item className={ITEM} onClick={() => actions.copy(message)}>
                  <Copy className="size-3.5 text-line-ico" /> Copy text
                </Menu.Item>
              )}
              <Menu.Item className={ITEM} onClick={() => actions.pin(message, !pinned)}>
                {pinned ? (
                  <>
                    <PinOff className="size-3.5 text-line-ico" /> Unpin
                  </>
                ) : (
                  <>
                    <Pin className="size-3.5 text-line-ico" /> Pin to the room
                  </>
                )}
              </Menu.Item>
              {mine && (
                <Menu.Item className={ITEM} onClick={() => actions.edit(message)}>
                  <Pencil className="size-3.5 text-line-ico" /> Edit
                </Menu.Item>
              )}
              {(mine || canModerate) && (
                <Menu.Item
                  className={cn(ITEM, "text-bad-fg")}
                  onClick={() => actions.remove(message)}
                >
                  <Trash2 className="size-3.5" /> Delete
                </Menu.Item>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  )
}

/// A message on its way out, or refused on the way.
export function OutboxRow({
  item,
  members,
  me,
  onRetry,
  onDiscard,
}: {
  item: OutboxItem
  members: readonly MentionTarget[]
  me: string | undefined
  onRetry: () => void
  onDiscard: () => void
}) {
  const failed = item.status === "failed"
  return (
    <div className="flex flex-row-reverse gap-2 pt-2.5">
      <div className="flex max-w-[78%] min-w-0 flex-col items-end max-md:max-w-[85%]">
        {item.replyTo !== null && (
          <div className="mb-1 max-w-full rounded-inner border-l-2 border-accent/60 bg-soft px-2.5 py-1 text-left">
            <span className="block truncate text-pill font-medium text-accent">
              {item.replyTo.author_name}
            </span>
            <span className="line-clamp-2 text-[0.8125rem] text-body">
              {plainText(item.replyTo.body)}
            </span>
          </div>
        )}
        {item.body !== "" && (
          <div
            className={cn(
              "rounded-inner bg-accent-bg px-3 py-2 text-[0.875rem] leading-relaxed break-words whitespace-pre-wrap text-ink",
              !failed && "opacity-70",
              failed && "ring-1 ring-bad-fg/40"
            )}
          >
            <RichText text={item.body} members={members} me={me} />
          </div>
        )}
        {item.attachments.length > 0 && (
          <div className="mt-1 flex flex-wrap justify-end gap-1.5">
            {item.attachments.map((file) => (
              <span
                key={file.file_id}
                className="rounded-full bg-soft-2 px-2.5 py-1 text-pill text-body"
              >
                📎 {file.file_name}
              </span>
            ))}
          </div>
        )}
        {failed ? (
          <div className="mt-1 flex flex-wrap items-center justify-end gap-2 text-pill">
            <span className="inline-flex items-center gap-1 text-bad-fg">
              <AlertCircle className="size-3.5" />
              {item.problem ?? "Not sent"}
            </span>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
            >
              <RotateCw className="size-3" /> Retry
            </button>
            <button
              type="button"
              onClick={onDiscard}
              className="inline-flex items-center gap-1 text-mute hover:text-ink"
            >
              <X className="size-3" /> Discard
            </button>
          </div>
        ) : (
          <div className="mt-0.5 text-pill text-mute">Sending…</div>
        )}
      </div>
    </div>
  )
}
