import { Menu } from "@base-ui/react/menu"
import { ChevronDown, MoreHorizontal, Search, SquarePen, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useAssistant } from "@/components/assistant/state"
import { ITEM, POPUP } from "@/lib/filter-chrome"
import {
  useConversations,
  useDiscardConversation,
  useRenameConversation,
  type Conversation,
} from "@/lib/queries/assistant"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"

/// The chats somebody has had, as a column beside the one they are having.
///
/// This is a second sidebar, standing next to the app's own, and that is a
/// deliberate cost. The hub has one navigation column on principle — a rail
/// was removed to get there — and the argument for it is that a person should
/// not have to learn which strip means what. This does not break that: the
/// column on the left is still the only map of the business, and this one is
/// not navigation at all. It is the contents of the screen you are already on,
/// the way a list of receipts is the contents of Sales. A conversation nobody
/// can find again is a conversation that may as well not have been kept, and
/// the model's answers are worth going back to — that is the whole reason they
/// are on the server now.
///
/// It is the page's, not the shell's: it exists on `/assistant` and nowhere
/// else, and it disappears with the screen rather than persisting as chrome.

export function History({
  onPick,
  className,
}: {
  /// Called with the chat to open, or null for a new one. The screen puts it
  /// in the URL; this never navigates itself.
  onPick: (id: string | null) => void
  className?: string
}) {
  const { conversationId } = useAssistant()
  const [searching, setSearching] = useState(false)
  const [needle, setNeedle] = useState("")
  // The server does the matching — it looks inside the turns, which is how
  // somebody actually remembers a conversation — so every keystroke would be a
  // request without this.
  const search = useDebounced(needle, 250)
  const conversations = useConversations(search)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searching) field.current?.focus()
  }, [searching])

  const groups = groupByAge(conversations.data ?? [])

  return (
    <div
      className={cn(
        "flex w-[14.5rem] shrink-0 flex-col border-r border-hairline bg-soft-3 px-2 py-3",
        className
      )}
    >
      <button
        type="button"
        onClick={() => onPick(null)}
        className="mb-3 flex items-center gap-2.5 rounded-lg px-2 py-[0.4375rem] text-nav font-medium text-text transition-colors hover:bg-soft-2 pointer-coarse:min-h-tap"
      >
        <SquarePen className="size-[1.0625rem] shrink-0 stroke-[1.55] text-line-ico" />
        New chat
      </button>

      {/* "Chats" and the search that replaces it. One row, two states: a
          heading nobody needs while they are looking for something, and a
          field nobody needs while they are not. */}
      <div className="relative mb-1 h-8 px-1">
        <div
          aria-hidden={searching}
          className={cn(
            "absolute inset-0 flex items-center gap-1 px-1 text-eyebrow font-semibold text-mute uppercase transition-opacity duration-150",
            searching && "pointer-events-none opacity-0"
          )}
        >
          <ChevronDown className="size-3.5" />
          <span>Chats</span>
        </div>
        <button
          type="button"
          aria-label="Search chats"
          onClick={() => setSearching(true)}
          className={cn(
            "absolute top-0 right-0 grid size-8 place-items-center rounded-lg text-line-ico transition-colors hover:bg-soft-2 hover:text-ink",
            searching && "pointer-events-none opacity-0"
          )}
        >
          <Search className="size-4" />
        </button>
        <div
          className={cn(
            "absolute inset-0 flex items-center gap-1.5 overflow-hidden rounded-lg border border-hairline bg-canvas px-2 transition-opacity duration-150",
            searching ? "opacity-100" : "pointer-events-none opacity-0"
          )}
        >
          <Search className="size-3.5 shrink-0 text-line-ico" />
          <input
            ref={field}
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setNeedle("")
                setSearching(false)
              }
            }}
            placeholder="Search chats"
            aria-label="Search chats"
            className="min-w-0 flex-1 bg-transparent text-meta text-ink outline-none placeholder:text-mute"
          />
          <button
            type="button"
            aria-label="Close search"
            onClick={() => {
              setNeedle("")
              setSearching(false)
            }}
            className="grid size-5 shrink-0 place-items-center rounded text-line-ico transition-colors hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="-mx-1 min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto px-1">
        {conversations.isPending ? (
          <div className="flex flex-col gap-1.5 px-2 py-1">
            {[0, 1, 2, 3, 4].map((row) => (
              <div
                key={row}
                className="h-[1.375rem] animate-pulse rounded bg-soft-2"
                style={{ width: `${[92, 74, 88, 61, 80][row]}%` }}
              />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className="px-2 py-2 text-meta leading-relaxed text-mute">
            {search
              ? "Nothing said in a chat matches that."
              : "Nothing yet. What you ask is kept here."}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.label} className="mb-2 last:mb-0">
              <h3 className="px-2 pt-1.5 pb-1 text-eyebrow font-semibold text-mute uppercase">
                {group.label}
              </h3>
              {group.items.map((conversation) => (
                <Row
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === conversationId}
                  onPick={onPick}
                />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  )
}

function Row({
  conversation,
  active,
  onPick,
}: {
  conversation: Conversation
  active: boolean
  onPick: (id: string | null) => void
}) {
  const rename = useRenameConversation()
  const discard = useDiscardConversation()
  const { conversationId, start } = useAssistant()
  const [editing, setEditing] = useState(false)

  if (editing) {
    // Enter and clicking away both keep the new name; only Escape throws it
    // away. Discarding on blur was the first behaviour and it is the wrong
    // one: somebody who types a name and then clicks the chat they were
    // renaming has done nothing to say they changed their mind, and there is
    // nothing on screen to tell them the name went nowhere.
    //
    // The value is read off the element rather than mirrored in state. One
    // copy, so there is no way for what is on the screen and what gets sent to
    // disagree — and no controlled-input state to keep in step with a list
    // that refetches underneath it.
    const commit = (value: string) => {
      const title = value.trim()
      if (title && title !== conversation.title) {
        rename.mutate({ id: conversation.id, title })
      }
      setEditing(false)
    }
    return (
      <input
        autoFocus
        defaultValue={conversation.title}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            commit(event.currentTarget.value)
          }
          if (event.key === "Escape") {
            event.preventDefault()
            setEditing(false)
          }
        }}
        aria-label="Rename chat"
        className="mb-px w-full rounded-lg border border-accent bg-canvas px-2 py-[0.3125rem] text-meta text-ink outline-none"
      />
    )
  }

  return (
    <div
      className={cn(
        "group relative flex items-center rounded-lg transition-colors",
        active ? "bg-soft-2" : "hover:bg-soft-2"
      )}
    >
      <button
        type="button"
        onClick={() => onPick(conversation.id)}
        title={conversation.title}
        className={cn(
          "min-w-0 flex-1 truncate px-2 py-[0.3125rem] text-left text-meta pointer-coarse:min-h-tap",
          active ? "font-medium text-ink" : "text-text"
        )}
      >
        {conversation.title}
      </button>
      <Menu.Root>
        <Menu.Trigger
          aria-label="Chat actions"
          className="mr-1 grid size-6 shrink-0 place-items-center rounded text-line-ico opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink data-[popup-open]:opacity-100 pointer-coarse:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4}>
            <Menu.Popup className={POPUP}>
              <Menu.Item className={ITEM} onClick={() => setEditing(true)}>
                Rename
              </Menu.Item>
              <Menu.Item
                className={cn(ITEM, "text-bad-fg")}
                onClick={() => {
                  discard.mutate(conversation.id)
                  // Deleting the chat you are in leaves you somewhere that no
                  // longer exists. A new one is the honest place to land.
                  if (conversationId === conversation.id) {
                    start()
                    onPick(null)
                  }
                }}
              >
                Delete
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  )
}

/// Chats under headings, newest first.
///
/// By age and not by month, because the thing somebody is looking for is
/// almost always "the one from this morning" or "the one from last week", and
/// a heading saying September helps with neither.
function groupByAge(
  conversations: readonly Conversation[]
): { label: string; items: Conversation[] }[] {
  const now = Date.now()
  const days = (iso: string) =>
    Math.floor((now - new Date(iso).getTime()) / 86_400_000)
  const buckets: { label: string; within: number; items: Conversation[] }[] = [
    { label: "Today", within: 1, items: [] },
    { label: "This week", within: 7, items: [] },
    { label: "This month", within: 30, items: [] },
    { label: "Earlier", within: Number.POSITIVE_INFINITY, items: [] },
  ]
  for (const conversation of conversations) {
    const age = days(conversation.updated_at)
    const bucket = buckets.find((one) => age < one.within) ?? buckets[3]
    bucket.items.push(conversation)
  }
  return buckets.filter((bucket) => bucket.items.length > 0)
}
