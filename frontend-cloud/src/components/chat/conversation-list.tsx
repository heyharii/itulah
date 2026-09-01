import { PersonAvatar } from "@/components/collaboration/person"
import { Input } from "@/components/ui/input"
import { ago } from "@/lib/collaboration"
import { conversationName } from "@/lib/chat"
import { cn } from "@/lib/utils"
import type { ChatConversation } from "@itulah/contract"
import { Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"

/// Every room this person is in, busiest first — the server's order, kept.
///
/// The unread number is `latest_message_seq - last_read_seq` as the server
/// worked it out. Recomputing it here from the messages this browser happens
/// to have loaded would give a different answer for any conversation whose
/// tail has not been fetched, which is most of them.
export function ConversationList({
  conversations,
  activeId,
  me,
  loading,
  className,
}: {
  conversations: ChatConversation[]
  activeId: string | undefined
  me: string | undefined
  loading: boolean
  className?: string
}) {
  const [query, setQuery] = useState("")

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === "") return conversations
    return conversations.filter((conversation) => {
      const haystack = [
        conversationName(conversation, me),
        ...conversation.participants,
        conversation.preview ?? "",
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [conversations, query, me])

  return (
    <div className={cn("min-h-0 flex-col md:border-r", className)}>
      <div className="shrink-0 border-b p-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search conversations"
          className="h-8 text-xs"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading ? (
          <p className="text-muted-foreground p-4 text-center text-xs">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground p-4 text-center text-xs">
            {conversations.length === 0
              ? "No conversations yet. Start one with the button above."
              : "Nothing matches that."}
          </p>
        ) : (
          rows.map((conversation) => {
            const name = conversationName(conversation, me)
            const active = conversation.conversation_id === activeId
            return (
              <Link
                key={conversation.conversation_id}
                to="/chat/$conversationId"
                params={{ conversationId: conversation.conversation_id }}
                className={cn(
                  "hover:bg-muted/60 mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                  active && "bg-muted",
                )}
              >
                {conversation.kind === "DIRECT" ? (
                  <PersonAvatar username={name} />
                ) : (
                  <span
                    aria-hidden
                    className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-lg text-xs font-semibold"
                  >
                    {name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{name}</span>
                  <span className="text-muted-foreground block truncate text-[11px]">
                    {conversation.preview === null
                      ? "—"
                      : conversation.kind === "GROUP" && conversation.preview_author !== null
                        ? `${conversation.preview_author}: ${conversation.preview}`
                        : conversation.preview}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-muted-foreground font-mono text-[10px]">
                    {ago(conversation.last_activity_at)}
                  </span>
                  {conversation.unread_count > 0 && (
                    <span className="grid min-w-4 place-items-center rounded-full bg-[var(--os-accent,#3c52f0)] px-1 font-mono text-[10px] leading-4 font-medium text-white">
                      {conversation.unread_count > 99 ? "99+" : conversation.unread_count}
                    </span>
                  )}
                </span>
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}
