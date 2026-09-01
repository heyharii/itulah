import { createFileRoute } from "@tanstack/react-router"
import { zodValidator } from "@tanstack/zod-adapter"
import { z } from "zod"

import { Chat } from "@/components/chat-app/chat"
import { ChatError, ChatPending } from "@/components/chat-app/route-states"
import { chatQueries } from "@/components/chat-app/queries"

/**
 * `active` is the open conversation — a channel id, a DM record id, or the
 * local draft sentinel. Without it a conversation cannot be linked to, which
 * is the whole point of the rail.
 *
 * `showMembers` opens the channel member column, which materially changes the
 * layout, so it travels with the link. It is absent rather than `false` when
 * the column is shut, so a plain `/chat` stays clean.
 */
const searchSchema = z.object({
  active: z.string().optional(),
  showMembers: z.boolean().optional(),
})

export const Route = createFileRoute("/chat")({
  validateSearch: zodValidator(searchSchema),

  /**
   * The channel/DM rail is the critical query. There is no `setInterval`,
   * `EventSource` or `WebSocket` anywhere in chat-app — `message-stream.tsx`
   * only renders, it does not hold a live connection — so the per-conversation
   * message list is a plain one-shot fetch like everything else. It still
   * stays out of the loader: which conversation is `active` can depend on a
   * client-side redirect once the workspace lands (see `chat.tsx`'s "settle
   * on the first thing in the rail" effect), so the screen's own
   * `useDomainQuery` is what actually knows which thread to fetch.
   */
  loader: async ({ context: { queryClient } }) => {
    await queryClient.query({
      ...chatQueries.workspace(),
      staleTime: "static",
    })
  },

  component: Chat,
  pendingComponent: ChatPending,
  errorComponent: ChatError,
})
