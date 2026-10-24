import { useQuery } from "@tanstack/react-query"
import { ArrowRightLeft, Check } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { Problem } from "@/components/ui/states"
import { ago, count, dayTime, moment } from "@/lib/format"
import {
  useRequestStoreAction,
  useStoreActionHistory,
  useStoreActionMenu,
  type StoreActionEntry,
} from "@/lib/queries/store-actions"
import {
  serverExtras,
  storeDetail,
  storesKeys,
  type StoreServer,
} from "@/lib/queries/stores"
import { cn } from "@/lib/utils"

/// Replace a store's server, step by step — close the tills, let head office
/// release the machine, uninstall it at the shop, then disconnect it and take
/// the new install code. The facts the steps read (`open_drawers`,
/// `waiting_records`, `released_until`) are the server's own last report, so
/// the sheet re-reads the store every few seconds while it is open.

const POLL_MS = 5_000
const PREPARE_REMOVAL = "prepare_removal"

/// Whether head office's release for removal is still in force: it names a
/// moment that has not come yet.
export function isReleased(until: string | null | undefined): until is string {
  return until != null && Date.parse(until) > Date.now()
}

/// What is true about letting this machine go, in the words the Disconnect
/// question and the Replace sheet both use: released or not, and what it
/// would strand. `clear` is a release with nothing left unsent.
export function removalWords(
  hostname: string,
  waitingRecords: number | null | undefined,
  releasedUntil: string | null | undefined
): { clear: boolean; sentence: string } {
  const waiting = waitingRecords ?? 0
  const stranded = waiting > 0
  if (isReleased(releasedUntil) && !stranded)
    return {
      clear: true,
      sentence: `Released for removal until ${dayTime(releasedUntil)}. Uninstall it on ${hostname} first.`,
    }
  const parts: string[] = []
  if (!isReleased(releasedUntil))
    parts.push(`${hostname} was not prepared for removal.`)
  if (stranded)
    parts.push(
      waiting === 1
        ? "1 record on it has not reached head office; it stays on that PC."
        : `${count(waiting)} records on it have not reached head office; they stay on that PC.`
    )
  return { clear: false, sentence: parts.join(" ") }
}

/// The "Replace server" button of the machine row, and the sheet it opens.
export function ReplaceServerButton({
  unit,
  server,
  onDisconnect,
}: {
  unit: string
  /// The server as the tab last read it; the open sheet reads its own, fresher
  /// copy.
  server: StoreServer
  /// The tab's Disconnect, which issues the new install code and holds it for
  /// the tab to show.
  onDisconnect: () => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const hostname = serverExtras(server).machine?.hostname ?? "server"
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <ArrowRightLeft />
        Replace server
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        size="rail"
        title={`Replace ${hostname}`}
      >
        <ReplaceSteps
          unit={unit}
          open={open}
          fallback={server}
          onDisconnect={onDisconnect}
          onDone={() => setOpen(false)}
        />
      </Sheet>
    </>
  )
}

function ReplaceSteps({
  unit,
  open,
  fallback,
  onDisconnect,
  onDone,
}: {
  unit: string
  open: boolean
  fallback: StoreServer
  onDisconnect: () => Promise<unknown>
  /// The new code is issued: put the sheet away so the tab shows it.
  onDone: () => void
}) {
  // The same read the tab has, kept fresh while this sheet is up.
  const detail = useQuery({
    queryKey: storesKeys.detail(unit),
    queryFn: ({ signal }) => storeDetail(unit, signal),
    enabled: open,
    refetchInterval: open ? POLL_MS : false,
  })
  const server = serverExtras(detail.data?.store.server ?? fallback)
  const machine = server.machine ?? null

  const menu = useStoreActionMenu(unit)
  const option = menu.data?.items.find(
    (item) => item.key === PREPARE_REMOVAL && item.target === "server"
  )
  const history = useStoreActionHistory(unit)
  const last = history.data?.items.find(
    (entry) => entry.key === PREPARE_REMOVAL
  )
  const request = useRequestStoreAction(unit)

  const [disconnecting, setDisconnecting] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)

  if (machine === null) return null
  const hostname = machine.hostname

  const drawers = server.open_drawers
  const drawersKnown = drawers !== null && drawers !== undefined
  const released = isReleased(server.released_until)
  const asking = last !== undefined && isOnItsWay(last)
  const words = removalWords(
    hostname,
    server.waiting_records,
    server.released_until
  )
  const windows = /windows/i.test(machine.os)

  function prepare() {
    request.mutate({ key: PREPARE_REMOVAL, request: { confirm: true } })
  }

  function disconnect() {
    setDisconnecting(true)
    setFailure(null)
    void onDisconnect()
      .then(onDone, (error: unknown) => setFailure(error))
      .finally(() => setDisconnecting(false))
  }

  return (
    <ol className="flex flex-col divide-y divide-hairline">
      <Step n={1} name="Close the POS" done={drawers === 0}>
        <Value>
          {!drawersKnown
            ? "—"
            : drawers === 0
              ? "All drawers closed"
              : `${count(drawers)} ${drawers === 1 ? "drawer" : "drawers"} open`}
        </Value>
      </Step>

      <Step n={2} name="Prepare for removal" done={released}>
        <Value>
          {released
            ? `Released until ${dayTime(server.released_until)}`
            : "Not released"}
        </Value>
        <div>
          <Button
            variant="primary"
            pending={request.isPending}
            disabled={option?.enabled !== true}
            onClick={prepare}
          >
            {request.isPending ? "Preparing…" : "Prepare for removal"}
          </Button>
        </div>
        {option?.enabled === false && !asking && option.reason_disabled && (
          <Value>{option.reason_disabled}</Value>
        )}
        <Problem error={request.error} />
        {last !== undefined && <Outcome entry={last} />}
      </Step>

      <Step n={3} name={`Uninstall on ${hostname}`}>
        {windows ? (
          <Value>
            Windows: Settings → Apps → Central Store Server → Uninstall
          </Value>
        ) : (
          <p className="font-mono text-[0.9375rem] break-all text-body">
            sudo ./install-store.sh --uninstall
          </p>
        )}
        {released && server.state === "OFFLINE" && server.last_seen_at && (
          <Value>Quiet since {moment(server.last_seen_at)}</Value>
        )}
      </Step>

      <Step n={4} name="Disconnect and get a new code">
        {!words.clear && <Value>{words.sentence}</Value>}
        <Problem error={failure} />
        <div>
          <Button
            variant="destructive"
            pending={disconnecting}
            onClick={disconnect}
          >
            {disconnecting ? "Disconnecting…" : "Disconnect and get a new code"}
          </Button>
        </div>
      </Step>
    </ol>
  )
}

/// A step: its number, its name, a tick once what it asks is true, and what it
/// reads or does underneath.
function Step({
  n,
  name,
  done = false,
  children,
}: {
  n: number
  name: string
  done?: boolean
  children: React.ReactNode
}) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 py-5 first:pt-0 last:pb-0">
      <span
        aria-hidden
        className="grid size-6 place-items-center rounded-full border border-hairline-strong text-[0.9375rem] text-body tabular-nums"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="flex min-h-6 items-center justify-between gap-3">
          <span className="text-[0.9375rem] text-ink">{name}</span>
          {done && (
            <span
              role="img"
              aria-label="Done"
              className="grid size-[1.125rem] shrink-0 place-items-center rounded-full border-[1.5px] border-ok bg-ok text-cta-fg"
            >
              <Check className="size-3" strokeWidth={3} aria-hidden />
            </span>
          )}
        </div>
        {children}
      </div>
    </li>
  )
}

function Value({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.9375rem] text-body tabular-nums">{children}</p>
}

/// Not yet at a final state: the server has been asked and has not answered.
function isOnItsWay(entry: StoreActionEntry): boolean {
  return (
    entry.state === "QUEUED" ||
    entry.state === "SENT" ||
    entry.state === "RUNNING"
  )
}

/// Where the latest Prepare for removal got to: checking, or what came of it.
function Outcome({ entry }: { entry: StoreActionEntry }) {
  if (isOnItsWay(entry)) return <Value>Checking…</Value>
  if (!entry.result_sentence) return null
  return (
    <p
      className={cn(
        "text-[0.9375rem]",
        entry.state === "DONE" ? "text-body" : "text-bad"
      )}
    >
      {entry.result_sentence}
      <span className="text-mute">
        {" "}
        · {ago(entry.finished_at ?? entry.requested_at)}
      </span>
    </p>
  )
}
