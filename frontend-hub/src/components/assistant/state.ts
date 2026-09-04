import { createContext, use } from "react"

import type { StoredMessage, ToolRun } from "@/lib/queries/assistant"

/// The conversation, held in one place because three things draw it.
///
/// The panel is the conversation, the home screen's prompt bar starts one, and
/// the assistant's own page is the whole of it. If each owned its own state,
/// clicking a suggested prompt on the brief would either open an empty panel
/// or start a second conversation nobody can see. So the session lives above
/// all three, in the shell.
///
/// It is deliberately not in TanStack Query. A turn is not a cached read: it
/// is written once, streamed into, and never refetched — and a query key that
/// changes with every token is a cache doing nothing but allocating.
///
/// **What is kept and what is held.** The server keeps every conversation now
/// (migration `0102`); this holds exactly one — the one somebody is in. Opening
/// a kept chat reads it once and adopts its turns as the live list, so from
/// that moment there is a single copy on the screen. The alternative, drawing
/// stored turns and live ones side by side, is a merge that shows every turn
/// twice the first time the tab is refocused.

/// One exchange, as the panel draws it.
export interface Exchange {
  readonly id: string
  readonly question: string
  /// The answer so far. Empty while the model is still thinking.
  readonly answer: string
  /// The summarised reasoning, if the model showed any.
  readonly thinking: string
  /// Every read the model made for this answer, in the order it made them.
  readonly runs: readonly ToolRun[]
  /// True until the turn ends — the cursor, the shimmer and the disabled
  /// composer all read this.
  readonly streaming: boolean
  /// Set when the turn ended badly. The exchange stays on screen: a question
  /// that failed is still a question that was asked.
  readonly error?: string
}

export interface Session {
  /// Whether the ⌘J panel is up. The page ignores this entirely — it is the
  /// conversation, so it has nothing to open.
  readonly open: boolean
  /// The chat being added to, or null before the first question of a new one.
  readonly conversationId: string | null
  readonly exchanges: readonly Exchange[]
  readonly busy: boolean
  /// True while a kept chat is being read. Distinct from `busy`, which means a
  /// model is writing: one draws a skeleton, the other draws a caret.
  readonly loading: boolean
  setOpen: (open: boolean) => void
  send: (question: string) => void
  stop: () => void
  /// Start a new one. The kept chat stays kept; this only lets go of it.
  start: () => void
  /// Open a kept chat and adopt its turns.
  resume: (id: string) => void
}

export const AssistantContext = createContext<Session | null>(null)

export function useAssistant(): Session {
  const session = use(AssistantContext)
  if (!session) {
    throw new Error("useAssistant outside <AssistantProvider>")
  }
  return session
}

/// A kept transcript, as exchanges.
///
/// The table stores one row per turn — a question, then the answer to it —
/// because a question whose answer failed is still a question that was asked
/// and has to survive on its own. The screen draws them in pairs, so they are
/// paired back here: an answer joins the question above it, and a question
/// with nothing under it yet stands alone.
export function asExchanges(
  messages: readonly StoredMessage[]
): readonly Exchange[] {
  const exchanges: Exchange[] = []
  for (const message of messages) {
    if (message.role === "user") {
      exchanges.push({
        id: message.id,
        question: message.content,
        answer: "",
        thinking: "",
        runs: [],
        streaming: false,
      })
      continue
    }
    const open = exchanges[exchanges.length - 1]
    const answered: Exchange = {
      id: open?.id ?? message.id,
      question: open?.question ?? "",
      answer: message.content,
      thinking: message.thinking ?? "",
      runs: message.runs ?? [],
      streaming: false,
      error: message.error ?? undefined,
    }
    if (open && open.answer === "" && !open.error) {
      exchanges[exchanges.length - 1] = answered
    } else {
      exchanges.push(answered)
    }
  }
  return exchanges
}
