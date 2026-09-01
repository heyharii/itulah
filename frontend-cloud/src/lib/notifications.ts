import { node } from "@/lib/api"
import type { Notification, NotificationPage } from "@itulah/contract"
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query"
import { useEffect } from "react"

export const notificationsKey = () => ["notifications"] as const

export function listNotifications(
  limit = 50,
  signal?: AbortSignal,
): Promise<NotificationPage> {
  return node.get<NotificationPage>(`/api/v1/notifications?limit=${limit}`, { signal })
}

export function markNotificationRead(notificationId: string): Promise<{ unread: number }> {
  return node.post<{ unread: number }>(
    `/api/v1/notifications/${encodeURIComponent(notificationId)}/read`,
    {},
  )
}

export function markAllNotificationsRead(): Promise<{ cleared: number; unread: number }> {
  return node.post<{ cleared: number; unread: number }>("/api/v1/notifications/read-all", {})
}

/// The list, kept current by the server rather than by asking again.
///
/// The server already has a resumable event stream, so this listens on it and
/// refetches when something addressed to this reader arrives. The poll left
/// underneath is not redundancy for its own sake: `EventSource` cannot carry
/// the session cookie on every deployment shape, and a notification centre
/// that silently stopped updating would be worse than a slow one. The interval
/// is long precisely because the stream is expected to do the work.
export function useNotifications(): UseQueryResult<NotificationPage> {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: notificationsKey(),
    queryFn: ({ signal }) => listNotifications(50, signal),
    refetchInterval: 120_000,
  })

  useEffect(() => {
    // Same stream chat and discussions use. `withCredentials` sends the session
    // cookie, which is what makes the audience filter mean anything.
    const source = new EventSource("/api/v1/chat/stream", { withCredentials: true })
    const wake = () => {
      void queryClient.invalidateQueries({ queryKey: notificationsKey() })
    }
    // Named event, because the stream carries chat and discussion traffic too
    // and refetching this list for a message in somebody's conversation would
    // be noise.
    source.addEventListener("notification", wake)
    return () => {
      source.removeEventListener("notification", wake)
      source.close()
    }
  }, [queryClient])

  return query
}

/// Where a notification leads.
///
/// The server stores the target as a record — `(subject_kind, subject_id)` —
/// so this is the one place that knows which screen shows that record today.
/// A stored URL would have stranded every old notification the day a route was
/// renamed.
export function notificationTarget(
  notification: Notification,
): { to: string; params?: Record<string, string> } | null {
  switch (notification.subject_kind) {
    case "purchase_price_amendment":
      return { to: "/amendments" }
    // Naming a delivery is head office's job and it is done on the sourcing
    // side; until that screen exists, the notification still says what
    // happened and simply does not offer to take you anywhere.
    case "goods_receipt_line":
      return null
    default:
      return null
  }
}
