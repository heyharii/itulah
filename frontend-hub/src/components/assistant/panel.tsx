import { Dialog } from "@base-ui/react/dialog"
import { Maximize2, SquarePen, X } from "lucide-react"

import { Transcript } from "@/components/assistant/chat"
import { Composer } from "@/components/assistant/composer"
import { useAssistant } from "@/components/assistant/state"
import { AppLink } from "@/components/ui/app-link"
import { useAssistantCapabilities } from "@/lib/queries/assistant"
import { cn } from "@/lib/utils"

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
  const barred = capabilities.data?.allowed === false
  const spent = capabilities.data?.budget?.exhausted === true

  return (
    <Dialog.Root open={open} onOpenChange={setOpen} modal={false}>
      <Dialog.Portal>
        <Dialog.Popup
          className={cn(
            "fixed top-4 right-4 bottom-4 z-40 flex w-[30rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-shell border border-hairline bg-canvas shadow-float",
            // In from the edge it lives on, a short way — a panel asked for
            // several times a day earns a quick slide, not a journey — and
            // out faster than it came. Reduced motion keeps only the fade.
            "transition-[translate,opacity] duration-(--t-panel) ease-(--ease-out) data-[ending-style]:duration-(--t-exit)",
            "data-[ending-style]:translate-x-6 data-[ending-style]:opacity-0 data-[starting-style]:translate-x-6 data-[starting-style]:opacity-0",
            "motion-reduce:data-[ending-style]:translate-none motion-reduce:data-[starting-style]:translate-none"
          )}
        >
          <div className="flex shrink-0 items-center gap-2.5 border-b border-hairline px-5 py-[0.875rem]">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-card-title font-semibold text-ink">
                Assistant
              </Dialog.Title>
              <div className="mt-0.5 truncate text-[0.875rem] text-mute">
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
            ) : barred ? (
              <Barred />
            ) : exchanges.length === 0 && !loading ? (
              <Opening />
            ) : (
              <Transcript exchanges={exchanges} loading={loading} />
            )}
          </div>

          {!barred && (
            <div className="shrink-0 border-t border-hairline px-4 py-3">
              <Composer autoFocus />
              <p className="mt-2 px-1 text-[0.875rem] text-mute">
                {spent ? (
                  <BudgetSpent />
                ) : busy ? (
                  "Working…"
                ) : (
                  "⌘J opens this anywhere · Enter sends · ⇧Enter for a new line"
                )}
              </p>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/// What the panel says to somebody the question box is not open to. What it
/// will be when it opens, rather than a bare "not allowed": the rule is about
/// the rollout, not about the person.
export function Barred() {
  return (
    <p className="text-meta leading-relaxed text-body">
      The assistant is open to Admins for now. When head office opens it to
      supervisors, it will answer from the shop you work in and nothing else.
    </p>
  )
}

/// The month's ceiling, reached. Said where the hint under the box usually
/// is, before somebody types a question the node will refuse.
export function BudgetSpent() {
  return (
    <>
      This month's assistant budget is spent. Finance can raise it in Accounts
      settings.
    </>
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
        Ask about anything this node holds — stock, prices, takings, the ledger,
        suppliers, people, and whatever else is in the database. Answers are
        drawn from live reads, the reads are shown, and nothing here writes.
      </p>
      <div className="mt-3.5 flex flex-wrap gap-1.5">
        {data?.tools.map((tool) => (
          <span
            key={tool.name}
            className="rounded-full border border-hairline bg-soft px-2 py-0.5 text-[0.875rem] text-body"
          >
            {tool.title}
          </span>
        ))}
      </div>
    </div>
  )
}
