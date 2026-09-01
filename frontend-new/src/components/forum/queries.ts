/**
 * Forum query options — the only place a forum cache key exists.
 *
 * See docs/frontend-rules.md §Q1 and src/components/inventory/queries.ts for
 * the pattern this follows.
 */

import { queryOptions } from "@tanstack/react-query"

import { STALE } from "@/lib/api/stale"
import { fetchForumOverview, fetchTopicPosts, type Directory, type ForumFeed } from "./api"

export const forumQueries = {
  all: () => ["forum"] as const,

  /** The board for one feed — topics move while people watch, same as chat. */
  overview: (feed: ForumFeed = "all") =>
    queryOptions({
      queryKey: [...forumQueries.all(), "overview", feed] as const,
      queryFn: ({ signal }) => fetchForumOverview(feed, signal),
      ...STALE.operational,
    }),

  /**
   * One thread's post stream. `directory` is a name lookup carried on the
   * same overview response, not a filter, so it stays out of the key — see
   * the reasoning already in `forum/api.ts`.
   */
  posts: (topicId: string | null, directory: Directory | undefined) =>
    queryOptions({
      queryKey: [...forumQueries.all(), "posts", topicId] as const,
      queryFn: ({ signal }) =>
        topicId && directory
          ? fetchTopicPosts(topicId, directory, signal)
          : Promise.resolve([]),
      enabled: Boolean(topicId && directory),
      ...STALE.operational,
    }),
}
