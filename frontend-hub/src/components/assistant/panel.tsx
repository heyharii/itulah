import { Dialog } from "@base-ui/react/dialog"
import { Maximize2, SquarePen, X } from "lucide-react"

import { Transcript } from "@/components/assistant/chat"
import { Composer } from "@/components/assistant/composer"
import { useAssistant } from "@/components/assistant/state"
import { AppLink } from "@/components/ui/app-link"
import { useAssistantCapabilities } from "@/lib/queries/assistant"

/// The assistant, as a panel over whatever is on screen.
///
/// A panel and not a module because the questions it answers are asked about
/// something already in front of somebody: a shop's takings while looking at
/// the shop, a price while looking at the article. Sending them to a separate
/// screen to ask would mean leaving the answer's subject behind — and the
/// server is told which screen the question came from for the same reason.
///
/// It sits on the same white veil as `Sheet`, at the same inset, with the same
/// corners. Nothing in this system darkens.
export function AssistantPanel() {
  const { open, setOpen, conversationId, exchanges, busy, loading, start } =
    useAssistant()
  const capabilities = useAssistantCapabilities()

  const off = capabilities.data?.enabled === false

  return (
    <Dialog.Root open={open} onOpenChange={setOpen} modal={false}>
      <Dialog.Portal>
        <Dialog.Popup className="fixed top-4 right-4 bottom-4 z-40 flex w-[30rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-shell border border-hairline bg-canvas shadow-float">
          <div className="flex shrink-0 items-center gap-2.5 border-b border-hairline px-5 py-[0.875rem]">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-card-title font-semibold text-ink">
                Assistant
              </Dialog.Title>
              <div className="mt-0.5 truncate text-[0.6875rem] text-mute">
                Reads this node. Never writes.
              </div>
            </div>
            {/* The way out of a panel and into the whole conversation. It is
                a link and not a button because the page addresses this chat by
                its id — so what is opened is this conversation, scrolled to
                where it was, and the address bar can be sent to somebody. */}
            {conversationId && (
              <AppLink
                to="/assistant"
                sheet={{ key: "chat", value: conversationId }}
                onClick={() => setOpen(false)}
                aria-label="Open in full"
                title="Open in full"
                className="grid size-7 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
              >
                <Maximize2 className="size-4" />
              </AppLink>
            )}
            {exchanges.length > 0 && (
              <button
                type="button"
                onClick={start}
                aria-label="New chat"
                title="New chat"
                className="grid size-7 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
              >
                <SquarePen className="size-4" />
              </button>
            )}
            <Dialog.Close className="grid size-7 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-[1.125rem]">
            {off ? (
              <p className="text-meta text-body">
                This node has no model key, so the assistant cannot answer here.
                Set{" "}
                <code className="font-mono text-id">OPENROUTER_API_KEY</code> on
                the server and restart it.
              </p>
            ) : exchanges.length === 0 && !loading ? (
              <Opening />
            ) : (
              <Transcript exchanges={exchanges} loading={loading} />
            )}
          </div>

          <div className="shrink-0 border-t border-hairline px-4 py-3">
            <Composer autoFocus />
            <p className="mt-2 px-1 text-[0.6875rem] text-mute">
              {busy
                ? "Working…"
                : "⌘J opens this anywhere · Enter sends · ⇧Enter for a new line"}
            </p>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/// What an empty panel says. Not "How can I help?" — a list of the things it
/// can actually reach, because the useful question is the one somebody did
/// not know they could ask.
function Opening() {
  const { data } = useAssistantCapabilities()
  return (
    <div className="pt-2">
      <p className="text-meta leading-relaxed text-body">
        Ask about anything this node holds — stock, prices, takings, the
        ledger, suppliers, people, and whatever else is in the database.
        Answers are drawn from live reads, the reads are shown, and nothing
        here writes.
      </p>
      <div className="mt-3.5 flex flex-wrap gap-1.5">
        {data?.tools.map((tool) => (
          <span
            key={tool.name}
            className="rounded-full border border-hairline bg-soft px-2 py-0.5 text-[0.6875rem] text-body"
          >
            {tool.title}
          </span>
        ))}
      </div>
    </div>
  )
}
