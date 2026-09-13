import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { node } from "@/lib/api"

/// The assistant, and the figures the home screen opens with.
///
/// Transcribed from `cloud/http/assistant.rs`, which assembles both answers
/// with `json!()` — so like the reports and the sync reads, nothing here is
/// checked against the server at build time. If a field starts reading
/// `undefined`, this file is where it went stale.
///
/// The model itself is never addressed from the browser. `ask` posts to this
/// node and reads an event stream back; the key, the tool catalogue and the
/// loop that runs them all live on the server, so a browser can no more invent
/// a tool call than it can invent a session.

// ---- What the node can do ----------------------------------------------

export interface AssistantTool {
  readonly name: string
  /// What the panel prints on the chip while the call runs, written next to
  /// the tool on the server so the two cannot drift.
  readonly title: string
}

export interface AssistantCapabilities {
  /// False on a node deployed without a key. The panel says so once, plainly,
  /// rather than letting the first question fail.
  readonly enabled: boolean
  readonly model: string
  readonly tools: readonly AssistantTool[]
}

export const cacheKey = {
  capabilities: () => ["assistant", "capabilities"] as const,
  brief: () => ["assistant", "brief"] as const,
  conversations: (search?: string) =>
    ["assistant", "conversations", search ?? ""] as const,
  conversation: (id: string) => ["assistant", "conversation", id] as const,
}

export function useAssistantCapabilities() {
  return useQuery({
    queryKey: cacheKey.capabilities(),
    queryFn: () =>
      node.get<AssistantCapabilities>("/api/v1/assistant/capabilities"),
    // A node does not acquire a key while somebody is looking at it.
    staleTime: 5 * 60_000,
  })
}

// ---- The morning brief -------------------------------------------------

export interface BriefTrade {
  readonly today_minor: number
  readonly yesterday_minor: number
  /// Local dates, `YYYY-MM-DD`, oldest first — a fortnight of them.
  readonly buckets: readonly string[]
  /// The fleet's gross per bucket, in the same order as `buckets`. Parallel
  /// arrays rather than objects because this is a sparkline's input and
  /// nothing else reads it.
  readonly daily_minor: readonly number[]
}

export interface BriefStock {
  /// Sites with at least one holding pool. Counted from the leaves, so a site
  /// that only has rollups does not appear twice.
  readonly sites: number
  readonly on_hand: number
  readonly missing: number
  /// Pieces confirmed lost inside the risk window. A count, not money —
  /// nothing in the pool read is valued.
  readonly lost: number
  /// How long that window is, from the node's own configuration.
  readonly window_days: number
}

export interface BriefMissing {
  readonly count: number
  readonly quantity: number
  /// How long the oldest one has been missing. Null when nothing is.
  readonly oldest_hours: number | null
}

export interface BriefCommercial {
  readonly published_version: number | null
  readonly shop_count: number
  /// Shops not yet running the newest published book.
  readonly behind: number
}

export interface Brief {
  readonly greeting: "morning" | "afternoon" | "evening" | "night"
  readonly who: string
  readonly as_of: string
  readonly trade: BriefTrade
  readonly stock: BriefStock
  readonly missing: BriefMissing
  readonly commercial: BriefCommercial
  /// The questions this screen makes somebody want to ask. Written on the
  /// server, beside the tools that answer them.
  readonly prompts: readonly string[]
}

export function useBrief() {
  return useQuery({
    queryKey: cacheKey.brief(),
    queryFn: () => node.get<Brief>("/api/v1/assistant/brief"),
    // A morning brief is a morning's worth of news. Refetching it on every
    // focus would make the headline figure flicker while somebody reads it.
    staleTime: 60_000,
  })
}

// ---- The chats somebody kept -------------------------------------------

/// One chat, as the sidebar draws it.
export interface Conversation {
  readonly id: string
  readonly title: string
  /// Where it was started, as a path. Null for a chat begun from the panel on
  /// a screen the server was not told about.
  readonly page: string | null
  readonly created_at: string
  readonly updated_at: string
  readonly message_count: number
}

/// One turn as the server kept it. `runs` is the whole of what the tools
/// answered, which is what lets a reopened chat redraw its tables and charts
/// rather than the words alone.
export interface StoredMessage {
  readonly id: string
  readonly seq: number
  readonly role: "user" | "assistant"
  readonly content: string
  readonly thinking: string | null
  readonly runs: readonly ToolRun[]
  readonly error: string | null
  readonly created_at: string
}

export interface ConversationDetail extends Conversation {
  readonly messages: readonly StoredMessage[]
}

/// The list, optionally narrowed by what was said in them.
export function useConversations(search?: string) {
  const needle = search?.trim() ?? ""
  return useQuery({
    queryKey: cacheKey.conversations(needle),
    queryFn: () =>
      node
        .get<{ items: Conversation[] }>(
          `/api/v1/assistant/conversations${
            needle ? `?q=${encodeURIComponent(needle)}` : ""
          }`
        )
        .then((page) => page.items),
    // The list changes when this person asks something, and this person is the
    // only one who can change it. Refetching it on every focus would be a
    // request to answer a question nobody asked.
    staleTime: 30_000,
  })
}

/// One chat in full. Only fetched for a conversation somebody opened from the
/// list — the one being typed into is in memory, and asking the server for it
/// mid-answer would draw the turn twice.
export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: cacheKey.conversation(id ?? ""),
    queryFn: () =>
      node.get<ConversationDetail>(`/api/v1/assistant/conversations/${id}`),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  })
}

export function useRenameConversation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      node.patch<{ id: string; title: string }>(
        `/api/v1/assistant/conversations/${id}`,
        { title }
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["assistant", "conversations"],
      })
    },
  })
}

/// Put a chat away. Archived on the server, gone from the list here.
export function useDiscardConversation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      node.delete<{ id: string }>(`/api/v1/assistant/conversations/${id}`),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["assistant", "conversations"],
      })
    },
  })
}

// ---- Asking ------------------------------------------------------------

/// One tool call, from the moment the model asks for it to the moment it
/// answers. `data` is the tool's own payload — the shape the matching screen
/// already reads — and is handed to a renderer, never printed as JSON.
export interface ToolRun {
  readonly id: string
  readonly name: string
  readonly input: Record<string, unknown>
  readonly ok?: boolean
  readonly data?: unknown
}

/// What the panel is told while a turn is being written.
///
/// Five callbacks rather than one event union: each one appends to a different
/// part of the screen, and a switch statement in the component would be the
/// same five branches with an extra layer of names on top.
export interface AskHandlers {
  /// Which chat this turn landed in, sent before the first word. A question
  /// asked without a conversation id starts one, and this is how the sidebar
  /// and the address bar find out.
  onConversation?: (id: string, opened: boolean) => void
  onThinking?: (text: string) => void
  onText?: (text: string) => void
  onTool?: (run: ToolRun) => void
  onResult?: (id: string, ok: boolean, data: unknown) => void
  onError?: (message: string) => void
}

export interface Ask {
  /// The chat to continue. Absent starts one.
  readonly conversationId?: string
  readonly question: string
  /// Where it was asked from, so "here" means something.
  readonly page?: string
}

/// Ask, and resolve when the turn is over.
///
/// One question, not a transcript: what came before it is on the server now
/// (see `cloud/http/assistant.rs`), which is what lets the same conversation
/// continue in the panel and on the full page without either of them holding
/// the authoritative copy. Tool results are deliberately never sent back up —
/// the model re-reads what it needs, so a follow-up is never answered from
/// figures that were true an hour ago.
export async function ask(
  request: Ask,
  handlers: AskHandlers,
  signal?: AbortSignal
): Promise<void> {
  await node.stream(
    "/api/v1/assistant/ask",
    {
      conversation_id: request.conversationId,
      question: request.question,
      page: request.page,
    },
    (event, payload) => {
      const data = payload as Record<string, unknown>
      switch (event) {
        case "conversation":
          handlers.onConversation?.(String(data.id ?? ""), data.opened === true)
          break
        case "thinking":
          handlers.onThinking?.(String(data.text ?? ""))
          break
        case "text":
          handlers.onText?.(String(data.text ?? ""))
          break
        case "tool":
          handlers.onTool?.({
            id: String(data.id ?? ""),
            name: String(data.name ?? ""),
            input: (data.input ?? {}) as Record<string, unknown>,
          })
          break
        case "result":
          handlers.onResult?.(
            String(data.id ?? ""),
            data.ok === true,
            data.data
          )
          break
        case "error":
          handlers.onError?.(String(data.message ?? "the assistant stopped"))
          break
        default:
          // `done` closes the stream and needs no handler; anything else is a
          // frame from a newer server this build does not know about yet.
          break
      }
    },
    { signal }
  )
}
