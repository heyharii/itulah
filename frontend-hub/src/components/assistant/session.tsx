import { useQueryClient } from "@tanstack/react-query"
import { useRouterState } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  AssistantContext,
  asExchanges,
  type Exchange,
} from "@/components/assistant/state"
import { node } from "@/lib/api"
import { ask, cacheKey, type ConversationDetail } from "@/lib/queries/assistant"

/// The session's one writer.
///
/// Everything the panel, the page and the brief read is declared in
/// `state.ts`; this file is only the machinery that fills it. They are apart
/// because a file that exports both a provider and the hook that reads it
/// cannot be hot reloaded — and this is the component every screen in the app
/// sits inside.

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [exchanges, setExchanges] = useState<readonly Exchange[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const client = useQueryClient()

  // Which screen the question is being asked from. The server puts it in the
  // system prompt so "these" and "here" mean something.
  const page = useRouterState({ select: (state) => state.location.pathname })

  // Deltas arrive many times a second and each one is two characters. They are
  // accumulated here and flushed on the next frame, so the panel repaints at
  // the screen's rate rather than the model's.
  const pending = useRef<{ text: string; thinking: string }>({
    text: "",
    thinking: "",
  })
  const scheduled = useRef(false)

  const flush = useCallback((id: string) => {
    if (scheduled.current) return
    scheduled.current = true

    const apply = () => {
      scheduled.current = false
      const { text, thinking } = pending.current
      if (!text && !thinking) return
      pending.current = { text: "", thinking: "" }
      setExchanges((current) =>
        current.map((exchange) =>
          exchange.id === id
            ? {
                ...exchange,
                answer: exchange.answer + text,
                thinking: exchange.thinking + thinking,
              }
            : exchange
        )
      )
    }

    // A frame when there are frames, a timer when there are not. A tab that is
    // not visible gets no animation frames at all, and an answer that arrived
    // while somebody was in another tab has to be on the screen when they come
    // back — not still sitting in `pending`. Whichever fires first wins and
    // cancels the other; `scheduled` is what makes the second one a no-op.
    const frame = requestAnimationFrame(() => {
      clearTimeout(timer)
      apply()
    })
    const timer = setTimeout(() => {
      cancelAnimationFrame(frame)
      apply()
    }, 250)
  }, [])

  const stop = useCallback(() => {
    abort.current?.abort()
    abort.current = null
  }, [])

  /// Let go of the current chat. What was said is kept on the server; this
  /// only stops adding to it.
  const start = useCallback(() => {
    stop()
    setConversationId(null)
    setExchanges([])
    setBusy(false)
    setLoading(false)
  }, [stop])

  /// Open a kept chat and adopt its turns as the live list.
  ///
  /// Read through the query cache rather than with a bare fetch, so opening the
  /// same chat twice in a minute costs nothing — and so the sidebar and this
  /// share one copy of it.
  const resume = useCallback(
    (id: string) => {
      if (id === conversationId) return
      stop()
      setConversationId(id)
      setExchanges([])
      setBusy(false)
      setLoading(true)
      client
        .fetchQuery({
          queryKey: cacheKey.conversation(id),
          queryFn: () =>
            node.get<ConversationDetail>(
              `/api/v1/assistant/conversations/${id}`
            ),
          staleTime: 5 * 60_000,
        })
        .then((detail) => {
          // Somebody who moved on while this was in flight must not have the
          // chat they left yanked back onto the screen.
          setConversationId((current) => {
            if (current === id) setExchanges(asExchanges(detail.messages))
            return current
          })
        })
        .catch(() => {
          setConversationId((current) => {
            if (current === id) setExchanges([])
            return current
          })
        })
        .finally(() => setLoading(false))
    },
    [client, conversationId, stop]
  )

  const send = useCallback(
    (question: string) => {
      const asked = question.trim()
      if (!asked || busy) return

      const id = crypto.randomUUID()
      setExchanges((current) => [
        ...current,
        {
          id,
          question: asked,
          answer: "",
          thinking: "",
          runs: [],
          streaming: true,
        },
      ])
      setBusy(true)

      const controller = new AbortController()
      abort.current = controller
      pending.current = { text: "", thinking: "" }

      const settle = (error?: string) => {
        setExchanges((current) =>
          current.map((exchange) =>
            exchange.id === id
              ? { ...exchange, streaming: false, error }
              : exchange
          )
        )
        setBusy(false)
        abort.current = null
        // The list is ordered by when a chat was last added to, and one just
        // was. The chat itself is not invalidated: the turns on screen are the
        // truth for as long as somebody is in it.
        void client.invalidateQueries({
          queryKey: ["assistant", "conversations"],
        })
      }

      ask(
        {
          conversationId: conversationId ?? undefined,
          question: asked,
          page,
        },
        {
          onConversation: (started) => setConversationId(started),
          onText: (text) => {
            pending.current.text += text
            flush(id)
          },
          onThinking: (text) => {
            pending.current.thinking += text
            flush(id)
          },
          onTool: (run) => {
            setExchanges((current) =>
              current.map((exchange) =>
                exchange.id === id
                  ? { ...exchange, runs: [...exchange.runs, run] }
                  : exchange
              )
            )
          },
          onResult: (runId, ok, data) => {
            setExchanges((current) =>
              current.map((exchange) =>
                exchange.id === id
                  ? {
                      ...exchange,
                      runs: exchange.runs.map((run) =>
                        run.id === runId ? { ...run, ok, data } : run
                      ),
                    }
                  : exchange
              )
            )
          },
          onError: (message) => settle(message),
        },
        controller.signal
      )
        .then(() => settle())
        .catch((error: unknown) => {
          // An abort is somebody pressing stop, not a failure to report.
          if (controller.signal.aborted) {
            settle()
            return
          }
          settle(error instanceof Error ? error.message : String(error))
        })
    },
    [busy, client, conversationId, flush, page]
  )

  // A turn outlives the component only if nothing cancels it.
  useEffect(() => stop, [stop])

  const session = useMemo(
    () => ({
      open,
      conversationId,
      exchanges,
      busy,
      loading,
      setOpen,
      send,
      stop,
      start,
      resume,
    }),
    [open, conversationId, exchanges, busy, loading, send, stop, start, resume]
  )

  return <AssistantContext value={session}>{children}</AssistantContext>
}
