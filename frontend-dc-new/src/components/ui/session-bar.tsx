import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Play, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardStrip } from "@/components/ui/card"
import { ConfirmButton } from "@/components/ui/dialog"
import { Pill } from "@/components/ui/pill"
import { Problem } from "@/components/ui/states"
import { clock } from "@/lib/format"
import { useActor } from "@/lib/session"
import { useSheet } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import type { Session } from "@itulah/contract"

/// **A station is a session**, and this is the control that says so.
///
/// Pick, pack and print all open a round, do work against it and close it. The
/// round is not a modal and not a wizard step: it is a piece of shared state
/// on the server that outlives the screen that opened it, and the ways it goes
/// wrong are all the same shape —
///
///  - a handheld sleeps mid-pick and wakes on a fresh screen, so the picker
///    opens a *second* round and the paperwork says they picked twice;
///  - a shift changes and the round is finished at another bench;
///  - a supervisor is sent a link and has to arrive inside the same round.
///
/// All three are fixed by the same thing: the session id lives in the URL
/// (`?pick=…`, `?pack=…`), and this bar is what reads and writes it. Waking
/// the device is a page load that lands back where the work was.
///
/// The open rounds on this node are listed even when none is chosen, because
/// the abandoned round from before the tablet slept is on that list and
/// picking it up is one tap. Nothing here is `useState`.
export function SessionBar<TSession extends Session>({
  kind,
  /// The URL key this round lives under. `pick` and `pack` are separate keys
  /// on purpose: a packer helping on the racks has both open at once.
  urlKey,
  open,
  isLoading,
  onOpen,
  onClose,
  invalidates,
  children,
  className,
}: {
  /// "Pick" / "Packing". Used in the sentences, so it reads as English.
  kind: string
  /// Narrowed to the two session keys rather than to `SheetKey`: a round is
  /// always identified by an id, and a flag key like `?printer` would
  /// typecheck against the wider type while being nonsense here.
  urlKey: "pick" | "pack"
  /// The rounds this node has open. Filtered by the caller — a station asks
  /// the node for `{ ready: true }`, which on the wire means "still open".
  open: readonly TSession[]
  isLoading: boolean
  onOpen: (actor: string) => Promise<Session>
  onClose: (sessionId: string) => Promise<unknown>
  /// Keys to invalidate after either. Named by the caller because opening a
  /// round changes the list of rounds, and closing one changes that plus
  /// whatever the round was counting.
  invalidates: readonly (readonly unknown[])[]
  /// The round's live totals — `<Fact>`s, usually.
  children?: React.ReactNode
  className?: string
}) {
  const actor = useActor()
  const client = useQueryClient()
  const session = useSheet(urlKey)
  const active = session.value ?? null

  const refresh = () => {
    for (const key of invalidates) {
      void client.invalidateQueries({ queryKey: key })
    }
  }

  const start = useMutation({
    mutationFn: () => onOpen(actor),
    onSuccess: (opened) => {
      // `replace`, not `open`: the screen without a round is not somewhere
      // `back` should return to once one is running.
      session.replace(opened.session_id)
      refresh()
    },
  })

  const finish = useMutation({
    mutationFn: (id: string) => onClose(id),
    onSuccess: () => {
      session.close()
      refresh()
    },
  })

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardStrip>
        <span className="flex-1 text-card-title font-semibold text-ink">
          {kind} round
        </span>
        {active === null ? (
          <Pill tone="neutral">None open</Pill>
        ) : (
          <Pill tone="info" withDot>
            Open
          </Pill>
        )}
      </CardStrip>

      {active === null ? (
        <div className="flex flex-col gap-3 px-4 py-3.5">
          <p className="text-meta text-body">
            {isLoading
              ? `Reading this node's ${kind.toLowerCase()} rounds…`
              : open.length === 0
                ? `Nothing is running. Open a round and every ${kind.toLowerCase()} below is written against it.`
                : `Pick up a round that is already running, or open a new one.`}
          </p>

          {open.map((round) => (
            <button
              key={round.session_id}
              type="button"
              onClick={() => session.open(round.session_id)}
              className="flex min-h-tap items-center gap-3 rounded-inner border border-hairline px-3 py-2 text-left transition-colors hover:bg-soft"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-id text-ink">
                  {round.session_id}
                </span>
                <span className="block truncate text-[0.71875rem] text-mute">
                  {round.actor_id} · started {clock(round.started_at)}
                </span>
              </span>
              <Pill tone="info">Resume</Pill>
            </button>
          ))}

          <Button
            variant="dark"
            disabled={start.isPending}
            onClick={() => start.mutate()}
          >
            <Play />
            {start.isPending
              ? "Opening…"
              : `Open a ${kind.toLowerCase()} round`}
          </Button>
          <Problem error={start.error} />
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate font-mono text-id text-ink">
              {active}
            </span>
            <span className="shrink-0 text-[0.71875rem] text-mute">
              {open.find((round) => round.session_id === active)?.actor_id ??
                actor}
            </span>
          </div>

          {children}

          <ConfirmButton
            label={
              <>
                <Square />
                Close the round
              </>
            }
            title={`Close this ${kind.toLowerCase()} round`}
            description={
              <>
                The round stops accepting work. Everything already recorded
                against it stays exactly where it is — closing a round files it,
                it does not undo it.
              </>
            }
            confirmLabel="Close it"
            pending={finish.isPending}
            onConfirm={() => finish.mutate(active)}
          />
          <Problem error={finish.error} />
        </div>
      )}
    </Card>
  )
}
