import { PanelLeft, Sparkles } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Transcript } from "@/components/assistant/chat"
import { Composer } from "@/components/assistant/composer"
import { Barred, BudgetSpent } from "@/components/assistant/panel"
import { useAssistant } from "@/components/assistant/state"
import { AppLink } from "@/components/ui/app-link"
import { History } from "@/screens/assistant/history"
import { atLeast, useLayout } from "@/lib/layout"
import {
  useAssistantCapabilities,
  useBrief,
  useConversations,
} from "@/lib/queries/assistant"
import { useSheet } from "@/lib/sheets"
import { useIdentity } from "@/lib/session"
import { cn } from "@/lib/utils"

/// The assistant, as the whole screen rather than a panel over one.
///
/// The panel came first and stays, because most questions are asked *about*
/// something already in front of somebody and sending them elsewhere to ask
/// would leave the subject behind. This is the other half of that: the
/// questions that are the work rather than a footnote to it — the ones with
/// six turns, a table to read, a chart to look at twice — and 30rem is not
/// enough room for any of them.
///
/// Both are the same session (`components/assistant/state.ts`), so a chat
/// started in the panel is continued here by pressing one button, and the
/// answer that was half-written when it moved is still half-written.
///
/// **Which chat is open lives in the URL.** `?chat=` and not component state,
/// for the reason the whole `sheets.ts` registry exists: a conversation
/// somebody wants to show a colleague has to be a link.
export function AssistantChat() {
  const { conversationId, exchanges, busy, loading, resume, start } =
    useAssistant()
  const chat = useSheet("chat")
  const capabilities = useAssistantCapabilities()
  const layout = useLayout()
  const wide = atLeast(layout, "desktop")

  // The URL is what says which conversation this is, and this is the one place
  // that reads it.
  //
  // It compares the URL against **the last URL this effect acted on**, not
  // against the session's current chat, and that is the whole of why it works.
  // Comparing against the session loses two ways round: pressing "new chat"
  // clears the session a render before the address bar catches up, so the
  // effect sees a stale `?chat=` and dutifully reloads the conversation
  // somebody just left; and a chat that has just been started by asking has an
  // id before the URL does, so the effect sees an empty URL and throws the
  // answer away mid-sentence. A record of what was last acted on has neither
  // failure: each URL state is handled exactly once.
  const acted = useRef<string | null>(null)
  useEffect(() => {
    const named = chat.value ?? null
    if (named === acted.current) return
    acted.current = named
    // `resume` is a no-op for the chat already open, which is what makes the
    // line below safe when the id in the URL is one this session just wrote.
    if (named) resume(named)
    else start()
  }, [chat.value, resume, start])

  // A chat started by asking — from the empty state, or in the panel — has no
  // id until the server answers with one. When it does, the address bar
  // catches up, replacing rather than pushing: the empty screen before the
  // first question is not somewhere `back` should return to.
  useEffect(() => {
    if (conversationId && conversationId !== chat.value) {
      acted.current = conversationId
      chat.replace(conversationId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  const empty = exchanges.length === 0 && !loading
  const off = capabilities.data?.enabled === false
  const barred = capabilities.data?.allowed === false
  const spent = capabilities.data?.budget?.exhausted === true
  // Only the narrow bar draws this, and only from the list that is already
  // cached for the sidebar — asking the server for one title would be a second
  // request for a string this app is holding two components away.
  const chats = useConversations()
  const title =
    chats.data?.find((one) => one.id === conversationId)?.title ?? null

  return (
    <div className="flex h-full min-h-0 w-full">
      {wide && (
        <History
          onPick={(id) => {
            if (id === null) {
              start()
              chat.close()
              return
            }
            chat.open(id)
          }}
        />
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!wide && <NarrowBar title={title} />}

        {off ? (
          <Missing />
        ) : barred ? (
          <div className="grid flex-1 place-items-center px-6">
            <div className="max-w-[26rem] text-center">
              <Barred />
            </div>
          </div>
        ) : empty ? (
          <Opening spent={spent} />
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Transcript
                exchanges={exchanges}
                loading={loading}
                space="page"
                className="mx-auto w-full max-w-[46rem] px-5 py-7"
              />
            </div>
            <div className="shrink-0 px-5 pb-5">
              <div className="mx-auto w-full max-w-[46rem]">
                <Composer autoFocus />
                <p className="mt-2 px-1 text-[0.875rem] text-mute">
                  {spent ? (
                    <BudgetSpent />
                  ) : busy ? (
                    "Working…"
                  ) : (
                    "Enter sends · ⇧Enter for a new line · answers are drawn from live reads"
                  )}
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/// The screen before the first question.
///
/// A greeting, the box, and three things worth asking. The prompts are the
/// server's — written beside the tools that answer them — because the useful
/// suggestion is the one somebody did not know they could ask, and a list
/// written in the browser goes stale the week a tool is added.
function Opening({ spent }: { spent: boolean }) {
  const { send } = useAssistant()
  const identity = useIdentity()
  const brief = useBrief()
  const layout = useLayout()
  // Centred on a desk, near the top on a phone. A vertically centred composer
  // on a 812px screen is a composer the on-screen keyboard covers the moment
  // it is tapped, and a greeting nobody reads because it has scrolled.
  const centred = atLeast(layout, "desktop")
  const prompts = brief.data?.prompts ?? []
  const name = identity.data?.display_name?.split(" ")[0]

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-y-auto px-5",
        centred ? "justify-center py-8" : "justify-start pt-6 pb-8"
      )}
    >
      <div className="mx-auto w-full max-w-[42rem]">
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em]">
          {name && <span className="block text-mute">Hello {name}</span>}
          <span className="block text-ink">What can I help you with?</span>
        </h1>

        <Composer
          autoFocus
          className="mt-6 px-4 py-3.5"
          placeholder="Ask anything about this business…"
        />

        {prompts.length > 0 && (
          <ul className="mt-5 flex flex-col">
            {prompts.slice(0, 4).map((prompt) => (
              <li key={prompt}>
                <button
                  type="button"
                  onClick={() => send(prompt)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-meta text-text transition-colors hover:bg-soft-2 hover:text-ink pointer-coarse:min-h-tap"
                >
                  <Sparkles className="size-4 shrink-0 text-line-ico" />
                  <span className="min-w-0 flex-1">{prompt}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-5 px-2 text-[0.875rem] leading-relaxed text-mute">
          {spent ? (
            <BudgetSpent />
          ) : (
            <>
              It reads this node — stock, prices, takings, the ledger, and
              anything else in the database — and writes nothing. Every read it
              makes is shown under the answer.
            </>
          )}
        </p>
        <AppLink
          to="/assistant/glossary"
          className="mt-1 inline-block px-2 text-[0.875rem] text-mute underline-offset-2 hover:text-ink hover:underline"
        >
          The words it reads your questions with
        </AppLink>
      </div>
    </div>
  )
}

/// A node deployed without a model key. Said once, plainly, rather than
/// letting the first question fail.
function Missing() {
  return (
    <div className="grid flex-1 place-items-center px-6">
      <p className="max-w-[26rem] text-center text-meta leading-relaxed text-body">
        This node has no model key, so the assistant cannot answer here. Set{" "}
        <code className="font-mono text-id">OPENROUTER_API_KEY</code> on the
        server and restart it.
      </p>
    </div>
  )
}

/// On a phone the chat list is not a column — there is no room for two. It is
/// a drawer, opened from the one control that would otherwise not exist.
function NarrowBar({ title }: { title: string | null }) {
  const chat = useSheet("chat")
  const { start } = useAssistant()
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Past chats"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
        >
          <PanelLeft className="size-[1.125rem] stroke-[1.7]" />
        </button>
        {/* The chat's own name, not the word "Assistant". A phone has no room
            for the column that would otherwise say which conversation this is,
            and the shell's bar directly above already names the node — two bars
            that both say where you are and neither of which says which chat is
            two bars too many. */}
        <span className="min-w-0 flex-1 truncate text-card-title font-semibold text-ink">
          {title ?? "New chat"}
        </span>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 flex">
          <History
            className={cn("h-full")}
            onPick={(id) => {
              if (id === null) {
                start()
                chat.close()
              } else {
                chat.open(id)
              }
              setOpen(false)
            }}
          />
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="bg-scrim flex-1"
          />
        </div>
      )}
    </>
  )
}
