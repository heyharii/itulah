import type { CollaborationEvent } from "@itulah/contract"
import type { QueryClient } from "@tanstack/react-query"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"

import {
  EVENT_BATCH,
  collaborationEvents,
  workplaceKeys,
} from "@/lib/queries/workplace"
import { useIdentity } from "@/lib/session"
import { clearOutbox, refreshMessage } from "@/screens/workplace/chat-store"
import { eventSubject } from "@/screens/workplace/lib"

/// Following the collaboration log, and being honest about the lag.
///
/// `GET /api/v1/chat/events?after=N` is the polled twin of the SSE stream: the
/// identical query, so the two cannot drift into showing different histories.
/// This module uses the poll rather than the stream on purpose — the stream is
/// one held-open socket per tab and HTTP/1.1 allows six per origin, and a
/// second and a half of latency on a message is not worth one of them.
///
/// The log is an external system, so it is modelled as one: a module-level
/// store the screens subscribe to, rather than component state accumulated in
/// an effect. That is not only what the lint rule asks for — it is what makes
/// the cursor survive walking from Discussions to Chat. A cursor that reset on
/// unmount would replay the afternoon at the second screen.

export interface CollaborationFeed {
  /// Newest first, and only what arrived while following. Not capped: the panel
  /// scrolls, and dropping the middle of a log to keep it short is how a reader
  /// ends up trusting an incomplete record.
  readonly events: readonly CollaborationEvent[]
  /// False while winding forward from the start of the log, and it doubles as
  /// "have we ever reached the head".
  ///
  /// `after` is absent on a first ask and the server reads that as "start from
  /// now", which answers with nothing and no cursor to resume from — so a
  /// follower that has never connected asks from `0` and winds forward instead.
  /// Until it arrives it is catching up, not listening: what it reads on the
  /// way up is history the screens already show, so none of it is prepended to
  /// the panel and none of it invalidates anything.
  readonly live: boolean
  readonly lastEventId: number
}

const EMPTY: CollaborationFeed = { events: [], live: false, lastEventId: 0 }

let snapshot: CollaborationFeed = EMPTY
/// Who this cursor belongs to. Two people at the same desk share a browser, and
/// the second must not be shown the first's activity — see the reset below.
let owner: string | null = null
const listeners = new Set<() => void>()

function publish(next: CollaborationFeed) {
  snapshot = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): CollaborationFeed {
  return snapshot
}

/// What each kind of event makes stale.
///
/// Named key by key rather than dropping the module's whole namespace: a
/// message in a room nobody has open should move an unread count and nothing
/// else, and invalidating `["workplace"]` on every arrival would have every
/// open screen refetch everything all afternoon.
function react(batch: readonly CollaborationEvent[], client: QueryClient) {
  let threadsChanged = false

  for (const event of batch) {
    const subject = eventSubject(event.payload)
    switch (event.kind) {
      case "chat.message":
        void client.invalidateQueries({
          queryKey: workplaceKeys.conversations(),
          exact: true,
        })
        // A message with an attachment is a new row on the Files screen.
        void client.invalidateQueries({ queryKey: workplaceKeys.files() })
        if (subject.conversationId !== undefined) {
          void client.invalidateQueries({
            queryKey: workplaceKeys.messages(subject.conversationId),
          })
          void client.invalidateQueries({
            queryKey: workplaceKeys.conversationFiles(subject.conversationId),
          })
          void client.invalidateQueries({
            queryKey: workplaceKeys.conversation(subject.conversationId),
          })
        }
        break
      case "chat.read":
        // A read mark moves two things: the reader's own unread counts, which
        // come from the conversation rows, and everybody else's "seen by",
        // which comes from the members on the open room.
        void client.invalidateQueries({
          queryKey: workplaceKeys.conversations(),
          exact: true,
        })
        if (subject.conversationId !== undefined) {
          void client.invalidateQueries({
            queryKey: workplaceKeys.conversation(subject.conversationId),
            exact: true,
          })
        }
        break
      case "chat.update":
        // A message changed in place — edited, deleted, reacted to, pinned.
        // Nobody's unread count moves, so the list is only touched for the
        // preview line a deleted or edited last message changes.
        void client.invalidateQueries({
          queryKey: workplaceKeys.conversations(),
          exact: true,
        })
        if (subject.conversationId !== undefined) {
          // Just the one message, not the window it sits in: a reaction is
          // the busiest change a room has, and re-reading every held line
          // for each of them would be most of this screen's traffic.
          if (subject.seq !== undefined) {
            refreshMessage(client, subject.conversationId, subject.seq).catch(
              () =>
                void client.invalidateQueries({
                  queryKey: workplaceKeys.messages(
                    subject.conversationId ?? ""
                  ),
                })
            )
          }
          void client.invalidateQueries({
            queryKey: workplaceKeys.pins(subject.conversationId),
          })
          if (subject.change === "delete") {
            void client.invalidateQueries({
              queryKey: workplaceKeys.conversationFiles(subject.conversationId),
            })
            void client.invalidateQueries({ queryKey: workplaceKeys.files() })
          }
        }
        break
      case "chat.room":
        // The room itself changed: renamed, or somebody joined or left —
        // possibly this reader, who is then told so by the room's own 404.
        void client.invalidateQueries({
          queryKey: workplaceKeys.conversations(),
        })
        void client.invalidateQueries({ queryKey: workplaceKeys.files() })
        break
      case "discussion.thread":
        // Opened, retitled, pinned, answered, locked — every one of them
        // changes the thread's own header as well as its row on the board.
        threadsChanged = true
        if (subject.threadId !== undefined) {
          void client.invalidateQueries({
            queryKey: workplaceKeys.thread(subject.threadId),
          })
        }
        break
      case "discussion.post":
        threadsChanged = true
        void client.invalidateQueries({ queryKey: workplaceKeys.files() })
        if (subject.threadId !== undefined) {
          void client.invalidateQueries({
            queryKey: workplaceKeys.posts(subject.threadId),
          })
          void client.invalidateQueries({
            queryKey: workplaceKeys.thread(subject.threadId),
          })
        }
        break
      case "notification":
        // Somebody else's screen claimed it: the bell in the top bar, and the
        // full list in System. Both hang off the one key prefix, so one line
        // corrects the count and the newest five together.
        //
        // This is the whole of what the bell rides. It does NOT mount this
        // poll itself — a count in the corner is not worth a request every few
        // seconds from every tab in the company — so live is what you get on
        // the screens where the log is already being followed, and everywhere
        // else the bell refreshes on focus and after half a minute. That is
        // the honest trade, and it is the reason the count is never wrong for
        // longer than it takes to look away and back.
        void client.invalidateQueries({ queryKey: ["system", "notifications"] })
        break
      default:
        break
    }
  }

  if (threadsChanged) {
    // The whole `list` prefix, because it genuinely is everything: the list is
    // keyed by its filter, and a new thread or a new reply reorders every
    // filtered view of it — "most recently argued in" is the sort.
    void client.invalidateQueries({
      queryKey: ["workplace", "discussions", "list"],
    })
    void client.invalidateQueries({ queryKey: workplaceKeys.subjects() })
    void client.invalidateQueries({ queryKey: workplaceKeys.tags() })
  }
}

/// Poll the log, tell the cache what changed, and hand the screen what arrived.
///
/// Mounted on more than one screen at a time is fine: the query key is shared,
/// so Query runs one poll however many components ask for it, and the store
/// below is what they all read.
export function useCollaborationFeed(
  /// How often to ask while at the head of the log. Chat asks faster than the
  /// default while a room is open and the tab is in front — a conversation is
  /// the one place where four seconds reads as a pause.
  interval = 4_000
): CollaborationFeed {
  const client = useQueryClient()
  const identity = useIdentity()
  const me = identity.data?.username ?? ""

  useQuery({
    queryKey: workplaceKeys.events(me),
    queryFn: async ({ signal }) => {
      if (owner !== me) {
        // A different person is signed in. Their log is a different log — the
        // server filters it by audience — so the cursor starts again and the
        // panel does not open on somebody else's afternoon.
        owner = me
        publish(EMPTY)
        clearOutbox()
      }

      // Whether we had already reached the head *before* this batch. A batch
      // read on the way up is history; only what arrives after that is news.
      const following = snapshot.live
      const batch = await collaborationEvents(snapshot.lastEventId, signal)
      const atHead = batch.length < EVENT_BATCH

      publish({
        events:
          following && batch.length > 0
            ? [...batch].reverse().concat(snapshot.events)
            : snapshot.events,
        live: following || atHead,
        lastEventId:
          batch.length > 0
            ? batch[batch.length - 1].event_id
            : snapshot.lastEventId,
      })

      if (following) react(batch, client)
      return { atHead }
    },
    // Nothing to follow until we know whose log it is, which also keeps the
    // poll off the login screen.
    enabled: me !== "",
    // Straight back for the next page while there is more behind us; a slow
    // tick at the head, which is where a browser spends all but its first
    // seconds.
    refetchInterval: (query) =>
      query.state.data?.atHead === false ? 200 : interval,
    // A poll that failed is not news and not an error a screen should carry:
    // the next tick asks again from the same cursor, so nothing is skipped.
    retry: false,
  })

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
