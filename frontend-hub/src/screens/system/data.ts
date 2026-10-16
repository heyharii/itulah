import { infiniteQueryOptions } from "@tanstack/react-query"

import {
  notificationsPage,
  systemKeys,
  usersPage,
  type UserScope,
} from "@/lib/queries/system"

/// The reads System opens with, as options shared by the screen (which reads
/// them with `useSuspenseInfiniteQuery`) and by its prefetcher
/// (`prefetch.ts`), so the key and the request cannot drift apart.

/// The account register for one question, a page at a time on the server's
/// cursor.
export const usersFeedQuery = (scope: UserScope) =>
  infiniteQueryOptions({
    queryKey: systemKeys.userList(scope),
    queryFn: ({ pageParam, signal }) =>
      usersPage({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

/// What is waiting for the signed-in person, a page at a time. The Unread slice
/// is asked of the server, so it is every unread notification and not the
/// unread ones among the newest fifty.
export const notificationFeedQuery = (unread: boolean) =>
  infiniteQueryOptions({
    queryKey: systemKeys.notificationFeed(unread),
    queryFn: ({ pageParam, signal }) =>
      notificationsPage({ unread, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
