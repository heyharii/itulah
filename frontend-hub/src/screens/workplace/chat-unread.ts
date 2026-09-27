import { useQuery } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"

import { listConversations, workplaceKeys } from "@/lib/queries/workplace"
import { useIdentity } from "@/lib/session"
import type { ChatConversation } from "@itulah/contract"

/// How many messages are waiting for this person, for the badge on the Chat
/// icon and the phone's Messages tab.
///
/// The SAME query as the room list — one cache entry, so the badge and the
/// list can never disagree — asked again every half minute from wherever the
/// person is, and immediately whenever the Chat screen's live feed hears of a
/// message. Muted and archived rooms count only when somebody asks for this
/// person by name: that is what muting a room means.
export function unreadOf(rooms: readonly ChatConversation[]): number {
  let total = 0
  for (const room of rooms) {
    total +=
      room.muted || room.archived ? room.mention_count : room.unread_count
  }
  return total
}

export function useChatUnread(): number | null {
  const identity = useIdentity()
  const me = identity.data?.username
  const rooms = useQuery({
    queryKey: workplaceKeys.conversations(),
    queryFn: ({ signal }) => listConversations(signal),
    enabled: me !== undefined,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    select: unreadOf,
  })
  return rooms.data ?? null
}

/// Whether this tab is the one in front. A person who is not looking has not
/// read anything, and a poll nobody sees is a request for nothing.
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, isVisible, () => true)
}

function isVisible() {
  return document.visibilityState === "visible"
}

function subscribeVisibility(listener: () => void) {
  document.addEventListener("visibilitychange", listener)
  window.addEventListener("focus", listener)
  return () => {
    document.removeEventListener("visibilitychange", listener)
    window.removeEventListener("focus", listener)
  }
}
