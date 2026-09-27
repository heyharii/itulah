import type { QueryClient } from "@tanstack/react-query"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import {
  readMessages,
  sendMessage,
  workplaceKeys,
} from "@/lib/queries/workplace"
import { idempotencyKey } from "@/screens/workplace/lib"
import type { PendingAttachment } from "@/screens/workplace/parts"
import type { ChatMessage, ChatReplyPreview } from "@itulah/contract"

/// The state a conversation keeps in the browser: the window of the thread
/// that is loaded, what is on its way out, and what was being typed.
///
/// # The window
///
/// A thread is read from the bottom and scrolled back through, so the cache
/// holds one CONTIGUOUS run of messages, oldest first — never pages keyed by
/// cursor. Pages keyed by cursor are what an infinite query would give, and
/// they go wrong in exactly the way a chat exercises: refetching "the latest
/// 50" after three messages arrived moves that page's floor up by three, the
/// page behind it still ends where it used to, and three messages fall into
/// the gap between them without anything noticing.
///
/// So a refresh asks for everything past the NEWEST message held (`after`) and
/// puts it behind; scrolling back asks for the page `before` the oldest and
/// puts it in front; and a message that changed in place — edited, deleted,
/// reacted to — is fetched on its own when the feed says so
/// (`refreshMessage`), rather than the whole window being read again every
/// time somebody adds a thumbs-up.
/// `seq` starts at 1 and never skips — a deleted message keeps its number —
/// which is what makes "is there more above" the question `oldest > 1`.

/// How many messages a first open, and each scroll back, asks for.
export const THREAD_PAGE = 50

/// Put a freshly read run of messages together with what is already held.
///
/// Everything the new run covers is replaced by it (edits, deletions and
/// reactions arrive this way). What is held from below the run's floor is
/// kept — unless there is a gap between them, in which case the held part is
/// dropped rather than stitched to the new part with a hole in the middle.
export function mergeWindow(
  held: readonly ChatMessage[],
  fresh: readonly ChatMessage[]
): ChatMessage[] {
  if (fresh.length === 0) return [...held]
  const floor = fresh[0].seq
  const below = held.filter((message) => message.seq < floor)
  if (below.length > 0 && below[below.length - 1].seq !== floor - 1) {
    return [...fresh]
  }
  const top = fresh[fresh.length - 1].seq
  const above = held.filter((message) => message.seq > top)
  return [...below, ...fresh, ...above]
}

/// One message changed in place, or arrived at the end.
///
/// Anything that would not keep the window contiguous is left for the next
/// refresh to bring in, rather than stitched in with a gap before it.
export function upsertMessage(
  held: readonly ChatMessage[] | undefined,
  message: ChatMessage
): ChatMessage[] | undefined {
  if (held === undefined) return held
  const at = held.findIndex((one) => one.seq === message.seq)
  if (at >= 0) {
    // The replies that quote it carry their own copy of its words, and an
    // edit or a deletion has to reach those too.
    return held.map((one) =>
      one.seq === message.seq ? message : requote(one, message)
    )
  }
  const newest = held.length > 0 ? held[held.length - 1].seq : 0
  if (message.seq === newest + 1) return [...held, message]
  return [...held]
}

function requote(reply: ChatMessage, quoted: ChatMessage): ChatMessage {
  if (reply.reply_to === null || reply.reply_to.seq !== quoted.seq) return reply
  const deleted = quoted.deleted_at !== null
  return {
    ...reply,
    reply_to: {
      ...reply.reply_to,
      body: deleted ? "" : quoted.body.slice(0, 200),
      deleted,
      has_attachments: !deleted && quoted.attachments.length > 0,
    },
  }
}

/// Whether the held window has this message in it.
function holds(held: readonly ChatMessage[] | undefined, seq: number) {
  return held?.some((message) => message.seq === seq) ?? false
}

/// One message changed in place: fetch just it, and put it where it is.
/// A message outside the held window is not fetched at all — it will be read
/// fresh whenever somebody scrolls to it.
export async function refreshMessage(
  client: QueryClient,
  conversationId: string,
  seq: number
) {
  const key = workplaceKeys.messages(conversationId)
  if (!holds(client.getQueryData<ChatMessage[]>(key), seq)) return
  const [message] = await readMessages(conversationId, {
    after: seq - 1,
    before: seq + 1,
  })
  if (message === undefined || message.seq !== seq) return
  client.setQueryData<ChatMessage[]>(key, (held) => upsertMessage(held, message))
}

/// The thread of one conversation, and a way to scroll back through it.
export function useThread(conversationId: string) {
  const client = useQueryClient()
  const key = workplaceKeys.messages(conversationId)

  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const held = client.getQueryData<ChatMessage[]>(key)
      const newest =
        held !== undefined && held.length > 0 ? held[held.length - 1].seq : null
      // The tail since the newest message held; the whole first page when
      // nothing is held yet. A tail longer than one request can carry comes
      // back as its newest part, and `mergeWindow` drops what is held rather
      // than joining the two across the gap.
      const fresh =
        newest === null
          ? await readMessages(conversationId, { limit: THREAD_PAGE }, signal)
          : await readMessages(conversationId, { after: newest }, signal)
      // Merged into what is held NOW, not what was held when the request
      // left: a scroll back that landed meanwhile must not be thrown away.
      const now = client.getQueryData<ChatMessage[]>(key) ?? []
      return now.length === 0 ? [...fresh] : mergeWindow(now, fresh)
    },
    // Kept fresh by the event feed, which invalidates this key when the room
    // changes. A refetch on every mount would throw away nothing but would
    // re-read the whole window each time somebody clicks back into the room.
    staleTime: 60_000,
  })

  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState<Error | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)

  const messages = query.data
  const oldest = messages !== undefined && messages.length > 0 ? messages[0].seq : null
  const hasOlder = oldest !== null && oldest > 1

  /// One page further back. Calls while one is already on its way wait for
  /// that one rather than asking twice for the same page.
  const loadOlder = useCallback(async (): Promise<void> => {
    if (inFlight.current !== null) return inFlight.current
    const windowKey = workplaceKeys.messages(conversationId)
    const held = client.getQueryData<ChatMessage[]>(windowKey)
    if (held === undefined || held.length === 0 || held[0].seq <= 1) return
    const before = held[0].seq
    setLoadingOlder(true)
    setOlderError(null)
    const work = (async () => {
      try {
        const page = await readMessages(conversationId, {
          before,
          limit: THREAD_PAGE,
        })
        client.setQueryData<ChatMessage[]>(windowKey, (now) => {
          if (now === undefined || now.length === 0) return now
          const floor = now[0].seq
          const older = page.filter((message) => message.seq < floor)
          // Only a page that meets the window: if a refresh moved the window
          // while this was on its way, joining them would leave a hole, and
          // the next scroll back asks again from the new floor.
          if (older.length === 0 || older[older.length - 1].seq !== floor - 1) {
            return now
          }
          return [...older, ...now]
        })
      } catch (error) {
        setOlderError(error instanceof Error ? error : new Error(String(error)))
      } finally {
        inFlight.current = null
        setLoadingOlder(false)
      }
    })()
    inFlight.current = work
    return work
  }, [client, conversationId])

  /// Scroll back until `seq` is held — for a quoted line, a search hit or a
  /// pin that is further up than what is loaded. Bounded, so a thread of
  /// fifty thousand lines cannot turn one click into a thousand requests.
  const reach = useCallback(
    async (seq: number): Promise<boolean> => {
      const windowKey = workplaceKeys.messages(conversationId)
      // Newer than anything held — an alert or a search hit for a line that
      // arrived since the window was read: bring the window up to date first.
      const held = client.getQueryData<ChatMessage[]>(windowKey)
      if (held !== undefined && held.length > 0 && held[held.length - 1].seq < seq) {
        await client.refetchQueries({ queryKey: windowKey, exact: true })
      }
      for (let step = 0; step < 40; step += 1) {
        const held = client.getQueryData<ChatMessage[]>(windowKey)
        if (held === undefined || held.length === 0) return false
        if (held[0].seq <= seq) return held.some((m) => m.seq === seq)
        await loadOlder()
        const after = client.getQueryData<ChatMessage[]>(windowKey)
        // Nothing came back: stop rather than spin on a failing request.
        if (after === undefined || after.length === 0 || after[0].seq === held[0].seq) {
          return false
        }
      }
      return false
    },
    [client, conversationId, loadOlder]
  )

  return {
    query,
    messages: messages ?? [],
    hasOlder,
    loadingOlder,
    olderError,
    loadOlder,
    reach,
  }
}

// ─── The outbox ──────────────────────────────────────────────────────────────

/// A message somebody has sent that the server has not answered for yet — or
/// answered with a refusal.
///
/// Drawn at the foot of the thread straight away, in the order it was written,
/// so sending feels instant; replaced by the real message when the server
/// answers. The idempotency key is minted ONCE, when the message is written,
/// and every retry sends the same one: if the first attempt did reach the
/// server and only its answer was lost, the retry is answered with the message
/// already written rather than a second copy of it.
export interface OutboxItem {
  readonly key: string
  readonly conversationId: string
  readonly body: string
  readonly replyTo: ChatReplyPreview | null
  readonly attachments: readonly PendingAttachment[]
  readonly status: "sending" | "failed"
  readonly problem: string | null
  readonly createdAt: string
}

/// Module-level for the reason the collaboration feed is: a message on its
/// way out belongs to the conversation, not to the component drawing it. Walk
/// to another room mid-send and back, and it is still there — sent or not.
let outbox: readonly OutboxItem[] = []
const outboxListeners = new Set<() => void>()

function setOutbox(next: readonly OutboxItem[]) {
  outbox = next
  for (const listener of outboxListeners) listener()
}

function patchItem(key: string, patch: Partial<OutboxItem>) {
  setOutbox(outbox.map((item) => (item.key === key ? { ...item, ...patch } : item)))
}

function getOutbox() {
  return outbox
}

function subscribeOutbox(listener: () => void) {
  outboxListeners.add(listener)
  return () => {
    outboxListeners.delete(listener)
  }
}

/// What is on its way out of one conversation, oldest first.
export function useOutbox(conversationId: string): readonly OutboxItem[] {
  const all = useSyncExternalStore(subscribeOutbox, getOutbox, getOutbox)
  // Filtered on read rather than stored per room: the list is a handful of
  // items at most, and one array is one thing to keep consistent.
  return useMemo(
    () => all.filter((item) => item.conversationId === conversationId),
    [all, conversationId]
  )
}

/// One queue per conversation. Two messages typed in quick succession are
/// sent one after the other, so the server numbers them in the order they
/// were written — sent in parallel, the second could overtake the first.
const queues = new Map<string, Promise<void>>()

function enqueue(conversationId: string, work: () => Promise<void>) {
  const previous = queues.get(conversationId) ?? Promise.resolve()
  const next = previous.then(work, work)
  queues.set(conversationId, next)
  void next.finally(() => {
    if (queues.get(conversationId) === next) queues.delete(conversationId)
  })
}

async function deliver(client: QueryClient, key: string) {
  const item = outbox.find((one) => one.key === key)
  if (item === undefined) return
  patchItem(key, { status: "sending", problem: null })
  try {
    const message = await sendMessage(item.conversationId, {
      body: item.body,
      idempotency_key: item.key,
      reply_to_seq: item.replyTo?.seq ?? null,
      attachments: item.attachments.map((file) => file.file_id),
    })
    const windowKey = workplaceKeys.messages(item.conversationId)
    client.setQueryData<ChatMessage[]>(windowKey, (held) =>
      upsertMessage(held, message)
    )
    // Somebody else's line landed first, so this one could not simply be put
    // at the end. Read the tail before letting go of the outbox row, or the
    // message would vanish from the screen until the next tick.
    if (!holds(client.getQueryData<ChatMessage[]>(windowKey), message.seq)) {
      await client
        .refetchQueries({ queryKey: windowKey, exact: true })
        .catch(() => undefined)
    }
    setOutbox(outbox.filter((one) => one.key !== key))
    void client.invalidateQueries({ queryKey: workplaceKeys.conversations() })
    void client.invalidateQueries({
      queryKey: workplaceKeys.conversation(item.conversationId),
      exact: true,
    })
    if (message.attachments.length > 0) {
      void client.invalidateQueries({
        queryKey: workplaceKeys.conversationFiles(item.conversationId),
      })
      void client.invalidateQueries({ queryKey: workplaceKeys.files() })
    }
  } catch (error) {
    patchItem(key, {
      status: "failed",
      problem:
        error instanceof Error && error.message !== ""
          ? error.message
          : "Not sent. Check the connection and try again.",
    })
  }
}

/// Write a message and start sending it.
export function queueMessage(
  client: QueryClient,
  conversationId: string,
  message: {
    body: string
    replyTo: ChatReplyPreview | null
    attachments: readonly PendingAttachment[]
  }
) {
  const item: OutboxItem = {
    key: idempotencyKey(),
    conversationId,
    body: message.body,
    replyTo: message.replyTo,
    attachments: message.attachments,
    status: "sending",
    problem: null,
    createdAt: new Date().toISOString(),
  }
  setOutbox([...outbox, item])
  enqueue(conversationId, () => deliver(client, item.key))
}

/// Try a refused message again, with the key it was written with.
export function retryMessage(client: QueryClient, key: string) {
  const item = outbox.find((one) => one.key === key)
  if (item === undefined || item.status === "sending") return
  patchItem(key, { status: "sending", problem: null })
  enqueue(item.conversationId, () => deliver(client, key))
}

/// Give up on a refused message. Its words go back to whoever asks — the
/// composer puts them back in the box, so nothing typed is lost.
export function discardMessage(key: string): OutboxItem | undefined {
  const item = outbox.find((one) => one.key === key)
  if (item === undefined || item.status === "sending") return undefined
  setOutbox(outbox.filter((one) => one.key !== key))
  return item
}

/// Everything unsent is somebody else's the moment the person at the desk
/// changes.
export function clearOutbox() {
  setOutbox([])
}

// ─── Drafts ──────────────────────────────────────────────────────────────────

/// What was being typed in each room, kept in this browser.
///
/// Per room, so switching rooms mid-sentence does not lose the sentence and
/// does not carry it into the wrong room. Local storage because that is all
/// it is — a convenience of this desk — and every read and write is guarded:
/// a private window or a full disk turns drafts off, never the chat.
const DRAFT_PREFIX = "itulah.chat.draft."

export function readDraft(owner: string, conversationId: string): string {
  try {
    return localStorage.getItem(`${DRAFT_PREFIX}${owner}.${conversationId}`) ?? ""
  } catch {
    return ""
  }
}

export function writeDraft(owner: string, conversationId: string, text: string) {
  try {
    const key = `${DRAFT_PREFIX}${owner}.${conversationId}`
    if (text.trim() === "") localStorage.removeItem(key)
    else localStorage.setItem(key, text)
  } catch {
    // Drafts are a convenience; losing one is not an error to show.
  }
}
