import { Attachment } from "@/components/collaboration/attachment"
import { PersonAvatar } from "@/components/collaboration/person"
import { attachmentUrl, conversationFiles, conversationFilesKey } from "@/lib/chat"
import type { ChatConversation } from "@itulah/contract"
import { useQuery } from "@tanstack/react-query"

/// Who is in the room, and what has been put in it.
///
/// The files are listed here rather than only inline in the thread because an
/// invoice is looked for later, by somebody who remembers the argument and not
/// the day. They are still reached through the conversation's own route —
/// there is no standalone file URL to hand out, which is what stops a link
/// leaving the room.
export function ConversationAside({
  conversation,
  me,
}: {
  conversation: ChatConversation
  me: string | undefined
}) {
  const files = useQuery({
    queryKey: conversationFilesKey(conversation.conversation_id),
    queryFn: ({ signal }) => conversationFiles(conversation.conversation_id, signal),
  })

  return (
    <aside className="hidden min-h-0 flex-col overflow-y-auto border-l p-3.5 2xl:flex">
      <h3 className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wide uppercase">
        People
      </h3>
      <ul className="mb-5">
        {conversation.participants.map((person) => (
          <li key={person} className="flex items-center gap-2 py-1">
            <PersonAvatar username={person} size="sm" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{person}</span>
            {person === me && (
              <span className="text-muted-foreground text-[10px]">you</span>
            )}
          </li>
        ))}
      </ul>

      <h3 className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wide uppercase">
        Files here
      </h3>
      <div className="flex flex-col gap-1.5">
        {files.isPending ? (
          <p className="text-muted-foreground text-[11px]">Loading…</p>
        ) : (files.data ?? []).length === 0 ? (
          <p className="text-muted-foreground text-[11px]">Nothing attached yet.</p>
        ) : (
          (files.data ?? []).map((file) => (
            <Attachment
              key={file.file_id}
              file={file}
              href={attachmentUrl(conversation.conversation_id, file.file_id)}
              className="max-w-none"
            />
          ))
        )}
      </div>

      <p className="text-muted-foreground mt-3 text-[10px] leading-relaxed">
        Files are fetched through this conversation's own route. There is no
        standalone link to one, so nothing here can be forwarded to somebody who
        was never in the room.
      </p>
    </aside>
  )
}
