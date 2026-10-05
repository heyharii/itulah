import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Search,
} from "lucide-react"
import { Popover } from "@base-ui/react/popover"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, SavedDialog } from "@/components/ui/dialog"
import { Field, Input, Money } from "@/components/ui/field"
import { RecordPanel } from "@/components/ui/record-panel"
import { SubHead } from "@/components/ui/rows"
import { PickMany, PickOne, type Choice } from "@/components/ui/pick"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Thumbnail } from "@/components/ui/thumbnail"
import { ago, count, money } from "@/lib/format"
import { asJpeg, PICTURE_TYPES } from "@/lib/image"
import { problemOf } from "@/lib/problem"
import { POPUP } from "@/lib/filter-chrome"
import { cn } from "@/lib/utils"
import { articleKeys } from "@/lib/queries/articles"
import {
  nameSuggestionKeys,
  suggestNames,
} from "@/lib/queries/name-suggestions"
import { colourKeys, listColours } from "@/lib/queries/colours"
import { ColourSwatch } from "@/screens/master/colour-picker"
import {
  articleImage,
  issueSetupSession,
  listSetupSessions,
  listSuppliers,
  procurementKeys,
  setupSessionDetail,
  supplierItemImage,
  uploadArticleImage,
  type SetupSession,
  type SetupSessionRow,
  type UnidentifiedReceipt,
  catalogueVocabulary,
  openSetupSession,
  openSplitSetup,
  type NewSetupPart,
  type NewSetupSession,
  type NewSplitSetup,
} from "@/lib/queries/procurement"
import { ArticleTabStrip, SplitMenu } from "@/screens/procurement/setup-split"
import {
  filledCells,
  findClashes,
  MAX_ARTICLE_TABS,
  piecesIn,
  splitTab,
  tabLabel,
  type ArticleTab,
  type Clash,
  type SplitMode,
} from "@/screens/procurement/setup-split-model"
import { queryState } from "@/lib/query-state"
import { useSheet, type SheetSearch } from "@/lib/sheets"
import {
  supplierDisplayName,
  titled,
} from "@/screens/procurement/supplier-format"
import { useSupplierName } from "@/screens/procurement/supplier-name"
import { useAwaitingIdentity } from "@/screens/procurement/queue"
import type { CatalogueVocabulary } from "@itulah/contract"
import {
  baseFrom,
  digits,
  markupFrom,
  syncPricing,
  type Pricing,
} from "@/screens/procurement/line-pricing-model"
import {
  termLabel,
  useActor,
  useIdempotencyKey,
} from "@/screens/procurement/shared"

/// Article setups — head office giving a delivery its identity.
///
/// Goods arrive against an order carrying the SUPPLIER's code and whatever the
/// buyer wrote on the line. Neither is an identity: an article code is ours,
/// eight digits minted from our own sequence, and a SKU is that code plus a
/// colour digit and a size. A session is where somebody decides what the thing
/// actually is, and issuing it mints the article, its SKUs and their EPCs and
/// sends the tagging job down — all in one transaction, because a serial range
/// drawn and not sent is a hole in the numbering nothing will ever fill.
///
/// **Filling the form in IS issuing it.** There were two presses here — open
/// the session, then find it again and issue it — and the second one asked a
/// question nobody had a second answer to: everything the mint needed had been
/// typed on the form already, so the press was a person confirming a decision
/// they had just finished making. One press does both writes now.
///
/// They are still two writes and not one transaction, so the second can fail
/// on its own. That is what `SetupOutcome` is for: a delivery that got its
/// identity and then did not mint is handed to the person as the session it
/// became, with the server's reason attached, rather than disappearing between
/// two sheets.
///
/// Colour is ONE digit. Ten colourways is the ceiling and it is enforced where
/// the image key is built, which is why the photographs below are per colourway
/// rather than per SKU: every size of the red shirt is the same red shirt.

/// Ten colourways, and there is no eleventh: the colour of a SKU is ONE digit
/// of an eleven-digit code. Not a setting — the shape of the number, enforced
/// again by `article_colour`'s primary key.
const COLOURWAY_CEILING = 10

/// What one press of "Set up and send to tagging" ended up doing.
///
/// The identity is saved first and the mint runs against the session it made,
/// which means the second half can fail with the first half already committed.
/// That is an outcome and not an error: the delivery HAS an identity, the
/// receipt has left the queue, and a screen that threw here would be throwing
/// away the only thing that says so. So it is returned, carrying the session
/// either way and the server's sentence when there is one.
type SetupOutcome =
  | { readonly kind: "issued"; readonly session: SetupSession }
  | {
      readonly kind: "stalled"
      readonly session: SetupSession
      readonly problem: string
    }
  | ({ readonly kind: "split" } & SplitOutcome)

/// What the form hands over: one article, as it always was, or the line split
/// into several sibling articles (owner, 2026-10-02).
type SetupSubmission =
  | { readonly kind: "one"; readonly request: NewSetupSession }
  | { readonly kind: "split"; readonly request: NewSplitSetup }

/// A split's press, article by article: the sessions open together or not at
/// all, then each is minted on its own. Those that minted, and those that
/// opened and did not — each of which is a "Not minted" session from here on,
/// run again from its own record under its own key.
interface SplitOutcome {
  readonly issued: readonly SetupSession[]
  readonly stalled: readonly {
    readonly session: SetupSession
    readonly problem: string
  }[]
}

/// That outcome, as the session sheet needs it: which session it is about, why
/// the mint did not run if it did not, and the job it sent if it did.
interface Handover {
  readonly session_id: string
  /// The server's sentence. Null when the mint ran.
  readonly problem: string | null
  /// The tagging job the mint produced. The session knows it too once the
  /// read of it lands; carried so the sentence naming it is on the sheet the
  /// moment it opens rather than one round trip later.
  readonly job: string | null
}

/// Where the pane is pointed: a session's record, a delivery's form, and which
/// PO the rail is narrowed to. All three live in the URL, so a link to any of
/// them works cold.
interface Target {
  readonly setup?: string
  readonly receipt?: string
  readonly setupFor?: string
}

/// The New articles page's work area: POs on the left and, beside them, one
/// card per delivery line still waiting for an identity on the PO the rail
/// stands on. A card opens the form in a sheet, with Previous and Next to walk
/// the cards on screen without closing it.
///
/// Was a sheet over Articles until 2026-10-02, when the owner gave it its own
/// menu row under Merchandise; then three panes (suppliers · lines · form)
/// until his cards prototype of the same day
/// (`new-articles-rail-cards-options.html`, option A: cards open a sheet). The
/// rail grouped by supplier for a while that day, then went back to PO.
///
/// The URL keys still each point at one thing:
///
///  - `?setupFor=<PO number>` — the rail, narrowed to that PO.
///  - `?receipt=<line>` — the sheet, on that delivery's form.
///  - `?setup=<session>` — the sheet, on that session's record. It is the link
///    an article's detail follows back to the delivery that minted it, and the
///    only way back to a session that opened and did not mint.
export function SetupWorkspace() {
  const navigate = useNavigate()
  const client = useQueryClient()
  /// Which setup session the sheet is showing.
  const session = useSheet("setup")
  /// Which delivery is being given an identity. A separate key from `setup`:
  /// this line has no session yet, and filling the form is what makes one.
  const chosen = useSheet("receipt")
  /// Which PO the rail is narrowed to, by its number; absent is All.
  const poFilter = useSheet("setupFor")
  const supplierOf = useSupplierName()
  const [query, setQuery] = useState("")

  /// How the last press of Submit ended, for the record the sheet hands over
  /// to. Not in the URL: it is what just happened in front of one person, not
  /// a property of the record.
  const [handover, setHandover] = useState<Handover | null>(null)
  /// The form holds something typed. Moving to another delivery or PO,
  /// or closing the sheet, asks "Discard this draft?" first; `pending` is the
  /// move waiting on it.
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState<Target | null>(null)

  /// The words a division may be named with. Fetched here rather than in the
  /// form, so moving to the next delivery does not start a request the person
  /// is then waiting on.
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
  })

  const receipts = useAwaitingIdentity()
  const sessions = useQuery({
    queryKey: procurementKeys.setups(),
    queryFn: ({ signal }) => listSetupSessions(signal),
  })
  /// The session the sheet is on, for its title. The same key the record
  /// reads, so this costs no second request.
  const record = useQuery({
    queryKey: procurementKeys.setup(session.value ?? ""),
    queryFn: ({ signal }) => setupSessionDetail(session.value!, signal),
    enabled: session.isOpen,
  })

  const waiting = useMemo(() => receipts.data ?? [], [receipts.data])
  /// Sessions that opened and did not mint. Routinely empty: one press does
  /// both writes, and only the second one failing leaves a session here.
  const stalled = useMemo(() => sessions.data ?? [], [sessions.data])

  /// The POs the queue is standing in, with how many lines of each and whose
  /// they are. Newest number first, so the order holds while lines leave.
  /// A receipt carries the supplier's code; the book turns it into the name
  /// the company writes, "Garmen Nusantara, PT".
  const orders = (() => {
    const counts = new Map<string, number>()
    const owners = new Map<string, string>()
    for (const row of waiting) {
      counts.set(row.po_number, (counts.get(row.po_number) ?? 0) + 1)
      if (!owners.has(row.po_number)) owners.set(row.po_number, row.supplier_id)
    }
    return [...counts]
      .map(([number, tally]) => {
        const owner = owners.get(number) ?? ""
        return { number, tally, supplier: supplierOf(owner, owner, owner) }
      })
      .sort((a, b) =>
        b.number.localeCompare(a.number, undefined, { numeric: true })
      )
  })()

  /// The PO actually being shown. The URL can name one that has just been
  /// emptied — setting up its last line takes it out of the queue — and a
  /// rail filtered to nothing would read as a queue that had gone.
  const here =
    poFilter.value !== undefined &&
    orders.some((one) => one.number === poFilter.value)
      ? poFilter.value
      : null
  const hereOrder = orders.find((one) => one.number === here)

  const needle = query.trim().toLowerCase()
  const shown = useMemo(
    () =>
      waiting
        .filter((row) => here === null || row.po_number === here)
        .filter(
          (row) =>
            needle === "" ||
            `${row.article_name} ${row.po_number} ${row.supplier_article_code}`
              .toLowerCase()
              .includes(needle)
        ),
    [waiting, here, needle]
  )
  /// Not-minted sessions, after the waiting cards. A session row does not
  /// carry its PO, so they stand on every rail, as they always did.
  const stalledShown = useMemo(
    () =>
      stalled.filter(
        (row) =>
          needle === "" ||
          `${row.article_name} ${row.article_code}`
            .toLowerCase()
            .includes(needle)
      ),
    [stalled, needle]
  )

  /// Every card in the order drawn, as where each points the sheet: what
  /// Previous and Next walk, and what "2 of 7" counts.
  const cards = useMemo<readonly Target[]>(
    () => [
      ...shown.map((row) => ({ receipt: row.receipt_line_id })),
      ...stalledShown.map((row) => ({ setup: row.session_id })),
    ],
    [shown, stalledShown]
  )

  /// Which delivery the form is for. Looked up in the whole queue, not just
  /// the cards on screen, so a `?receipt=` link opens even when the search
  /// or the rail would hide its card. A session on screen wins.
  const active = session.isOpen
    ? null
    : (waiting.find((row) => row.receipt_line_id === chosen.value) ?? null)
  const sheetOpen = session.isOpen || active !== null
  const at = cards.findIndex((card) =>
    session.isOpen
      ? card.setup === session.value
      : card.receipt !== undefined && card.receipt === active?.receipt_line_id
  )

  /// An empty queue gets one sentence, not an empty rail beside no cards.
  const nothingWaiting =
    !receipts.isPending &&
    waiting.length === 0 &&
    stalled.length === 0 &&
    !session.isOpen

  /// Every key at once, in ONE navigation: three separate writes would each
  /// build on a `prev` the one before had already changed.
  const point = (next: Target) =>
    navigate({
      to: ".",
      replace: true,
      search: (prev: SheetSearch) => ({
        ...prev,
        setup: next.setup,
        receipt: next.receipt,
        setupFor: next.setupFor,
      }),
      viewTransition: false,
    })

  /// A move the person asked for, held behind the discard prompt while the
  /// form has a draft in it.
  const go = (next: Target) => {
    if (dirty) setPending(next)
    else void point(next)
  }

  const railNow = poFilter.value
  const step = (by: number) => {
    const next = cards[at + by]
    if (at !== -1 && next !== undefined) go({ setupFor: railNow, ...next })
  }

  /// After a delivery has its identity: on to the next waiting card — the
  /// one after it, else the one before — or the sheet closes on the last.
  const advance = (done: string) => {
    client.setQueryData<UnidentifiedReceipt[]>(
      procurementKeys.unidentified(),
      (rows) => rows?.filter((row) => row.receipt_line_id !== done)
    )
    const index = shown.findIndex((row) => row.receipt_line_id === done)
    const next =
      index === -1
        ? shown[0]
        : (shown[index + 1] ?? (index > 0 ? shown[index - 1] : undefined))
    void point({
      setupFor: railNow,
      receipt: next?.receipt_line_id,
    })
  }

  /// The codes a press minted, held in the receipt dialog until they are
  /// read (the owner, 2026-10-04). The queue keeps moving behind it — the
  /// advance runs first, and the numbers stay up over whatever card is next.
  const [minted, setMinted] = useState<readonly string[] | null>(null)

  return (
    <>
      {nothingWaiting ? (
        <Card>
          <EmptyState>Nothing waiting.</EmptyState>
        </Card>
      ) : (
        // `@container`, so the rail and the cards split on the width the page
        // actually got rather than on the window.
        <Card className="@container flex flex-col p-5 min-[100rem]:p-7">
          <div className="grid items-start gap-6 [--rail-a:13rem] [--rail-gap:1.75rem] [--rail-pr:1.5rem] min-[100rem]:gap-8 min-[100rem]:[--rail-a:15rem] min-[100rem]:[--rail-gap:2.5rem] min-[100rem]:[--rail-pr:2rem] @3xl:grid-cols-[var(--rail-a)_minmax(0,1fr)] @3xl:gap-x-(--rail-gap)">
            <aside
              aria-label="Purchase orders"
              className="min-w-0 @3xl:sticky @3xl:top-4 @3xl:max-h-[calc(100dvh-6rem)] @3xl:overflow-y-auto @3xl:border-r @3xl:border-hairline @3xl:pr-(--rail-pr)"
            >
              <div className="flex min-w-0 flex-col gap-1.5 max-md:-mx-1 max-md:[scrollbar-width:none] max-md:flex-row max-md:items-stretch max-md:overflow-x-auto max-md:px-1 max-md:pb-1 max-md:[&::-webkit-scrollbar]:hidden">
                <span className="px-3 pb-2 text-[0.875rem] font-semibold tracking-[0.06em] text-mute uppercase max-md:hidden">
                  PO
                </span>
                <RailRow
                  label="All"
                  tally={waiting.length}
                  on={here === null}
                  onClick={() => go({})}
                />
                {orders.map((one) => (
                  <RailRow
                    key={one.number}
                    label={one.number}
                    sub={one.supplier}
                    mono
                    tally={one.tally}
                    on={here === one.number}
                    onClick={() => go({ setupFor: one.number })}
                  />
                ))}
              </div>
            </aside>

            <section
              aria-label="Items waiting"
              className="flex min-w-0 flex-col gap-5"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-3">
                {hereOrder === undefined ? (
                  <h3 className="min-w-0 truncate text-[1.0625rem] font-semibold tracking-[-0.02em] text-ink">
                    All POs
                  </h3>
                ) : (
                  <>
                    <h3 className="min-w-0 truncate font-mono text-[1.0625rem] font-semibold text-ink">
                      {hereOrder.number}
                    </h3>
                    <span className="min-w-0 truncate text-[0.9375rem] text-mute">
                      {hereOrder.supplier}
                    </span>
                  </>
                )}
                <span className="text-[0.9375rem] text-mute tabular-nums">
                  {count(cards.length)}
                </span>
                <span className="flex-1" />
                {waiting.length + stalled.length > 0 && (
                  <span className="relative block w-full @xl:w-72">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-line-ico" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      aria-label="Search the items waiting"
                      className="h-10 w-full rounded-inner border border-hairline-2 bg-canvas pr-3 pl-9 text-[0.9375rem] text-ink outline-none placeholder:text-body focus:border-accent"
                    />
                  </span>
                )}
              </div>

              {cards.length === 0 ? (
                <EmptyState>
                  {receipts.isPending
                    ? "Reading the queue…"
                    : waiting.length === 0 && stalled.length === 0
                      ? "Nothing waiting."
                      : "Nothing here matches that."}
                </EmptyState>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] items-start gap-4">
                  {shown.map((row) => (
                    <WaitingCard
                      key={row.receipt_line_id}
                      row={row}
                      supplier={supplierOf(
                        row.supplier_id,
                        row.supplier_id,
                        row.supplier_id
                      )}
                      showPo={here === null}
                      on={row.receipt_line_id === active?.receipt_line_id}
                      onOpen={() =>
                        go({
                          setupFor: railNow,
                          receipt: row.receipt_line_id,
                        })
                      }
                    />
                  ))}
                  {/* A session still open is a mint that did not run: the
                  delivery has its identity and is out of the queue, and
                  nothing but a person pressing the button on its record will
                  finish it. */}
                  {stalledShown.map((row) => (
                    <StalledCard
                      key={row.session_id}
                      row={row}
                      on={row.session_id === session.value}
                      onOpen={() =>
                        go({ setupFor: railNow, setup: row.session_id })
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        </Card>
      )}

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          if (!open) go({ setupFor: railNow })
        }}
        width="wide"
        title={
          active !== null
            ? active.article_name
            : (record.data?.article_name ?? "New article")
        }
        caption={
          active !== null ? (
            <>
              {supplierOf(
                active.supplier_id,
                active.supplier_id,
                active.supplier_id
              )}
              {" · "}
              <span className="font-mono">{active.po_number}</span>
              {" · "}
              {count(active.quantity)} pcs
            </>
          ) : record.data !== undefined ? (
            <span className="font-mono">{record.data.article_code}</span>
          ) : undefined
        }
        actions={
          at !== -1 && cards.length > 1 ? (
            <>
              <span className="mr-1 hidden text-[0.875rem] whitespace-nowrap text-mute tabular-nums md:inline">
                {count(at + 1)} of {count(cards.length)}
              </span>
              <Button
                size="icon"
                aria-label="Previous"
                title="Previous"
                disabled={at === 0}
                onClick={() => step(-1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                size="icon"
                aria-label="Next"
                title="Next"
                disabled={at === cards.length - 1}
                onClick={() => step(1)}
              >
                <ChevronRight />
              </Button>
            </>
          ) : undefined
        }
      >
        {/* Where this card stands among the ones on the page, as the
        prototype's step bar: one segment per card, the open one inked. */}
        {at !== -1 && cards.length > 1 && (
          <div aria-hidden className="-mt-2 mb-6 flex gap-1">
            {cards.map((card, index) => (
              <span
                key={card.receipt ?? card.setup}
                className={cn(
                  "h-1.5 min-w-0 flex-1 rounded-full transition-colors",
                  index === at ? "bg-ink" : "bg-hairline-2"
                )}
              />
            ))}
          </div>
        )}
        {session.value !== undefined ? (
          <SessionRecord
            id={session.value}
            // Only for the session the press actually made: opening a
            // different one from the cards is a different question, and it
            // must not inherit this one's answer.
            handover={
              handover !== null && handover.session_id === session.value
                ? handover
                : null
            }
          />
        ) : active !== null ? (
          <DeliverySetup
            receipt={active}
            vocabulary={vocabulary.data}
            onDirty={setDirty}
            onDone={(outcome) => {
              if (outcome.kind === "issued") {
                // Minted: named in the receipt dialog by its code, and the
                // queue goes on to the next card behind it rather than to a
                // record of it.
                setMinted([outcome.session.article_code])
                advance(active.receipt_line_id)
                return
              }
              if (outcome.kind === "split") {
                // Several articles: named in the receipt dialog by the codes
                // the server minted, and on to the next card. One that did
                // not mint is opened instead, with the reason — the rest
                // wait under Not minted.
                const codes = outcome.issued.map((one) => one.article_code)
                if (codes.length > 0) setMinted(codes)
                const first = outcome.stalled[0]
                if (first === undefined) {
                  advance(active.receipt_line_id)
                  return
                }
                setHandover({
                  session_id: first.session.session_id,
                  problem:
                    outcome.stalled.length > 1
                      ? `${first.problem} ${count(outcome.stalled.length - 1)} more of these articles are under Not minted.`
                      : first.problem,
                  job: null,
                })
                void point({
                  setupFor: railNow,
                  setup: first.session.session_id,
                })
                return
              }
              // The identity saved and the mint did not run: the record the
              // press made, in the same sheet, with where it runs again.
              setHandover({
                session_id: outcome.session.session_id,
                problem: outcome.problem,
                job: outcome.session.tagging_job_id ?? null,
              })
              void point({
                setupFor: railNow,
                setup: outcome.session.session_id,
              })
            }}
          />
        ) : null}
      </Sheet>
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title="Discard This Draft?"
        confirm="Discard"
        cancel="Keep editing"
        tone="danger"
        onConfirm={() => {
          const next = pending
          setPending(null)
          setDirty(false)
          if (next !== null) void point(next)
        }}
      >
        Nothing has been saved.
      </Dialog>
      <SavedDialog
        open={minted !== null}
        onOpenChange={(next) => {
          if (!next) setMinted(null)
        }}
        title={
          minted !== null &&
          (minted.length === 1 ? (
            <>Article created · {minted[0]}</>
          ) : (
            <>
              {count(minted.length)} articles created · {codeSpan(minted)}
            </>
          ))
        }
      />
    </>
  )
}

/// Codes minted together, as one span when they run on — `00000010–00000012`
/// — and listed when something else drew a code between them.
function codeSpan(codes: readonly string[]): string {
  const sorted = [...codes].sort()
  const consecutive = sorted.every(
    (code, index) => index === 0 || Number(code) === Number(sorted[0]) + index
  )
  return sorted.length > 1 && consecutive
    ? `${sorted[0]}–${sorted[sorted.length - 1]}`
    : sorted.join(", ")
}

/// One row of the PO rail: which order it is and whose, how many lines are
/// under it, and whether the rail is standing on it.
function RailRow({
  label,
  sub,
  tally,
  on,
  mono,
  onClick,
}: {
  label: string
  /// The supplier, muted under the order number.
  sub?: string
  tally: number
  on: boolean
  mono?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={on}
      // The rail is thirteen rem and an order number is sixteen characters,
      // so the longest of them can lose their tail. The whole of it is here
      // for anybody who needs to read it off.
      title={sub === undefined ? label : `${label} · ${sub}`}
      className={cn(
        "flex min-h-10 w-full items-center gap-2 rounded-inner px-3 text-left transition-colors min-[100rem]:min-h-11",
        // A phone lays the rail along the top as chips to swipe.
        "max-md:w-auto max-md:min-w-36 max-md:shrink-0 max-md:border max-md:border-hairline",
        sub !== undefined && "py-2",
        on
          ? "bg-soft-2 text-ink max-md:border-ink"
          : "text-text hover:bg-soft-2"
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "truncate text-[0.9375rem]",
            mono && "font-mono text-id",
            (on || mono) && "font-medium"
          )}
        >
          {label}
        </span>
        {sub !== undefined && (
          <span className="truncate text-[0.875rem] text-mute">{sub}</span>
        )}
      </span>
      <span className="shrink-0 text-[0.875rem] text-mute tabular-nums">
        {count(tally)}
      </span>
    </button>
  )
}

/// The frame every card on the page shares: the photograph on top, the name,
/// a muted line under it, and a foot with the status word, the pieces and how
/// long it has waited. A button, the whole of it — the card IS the way in.
function SetupCard({
  image,
  name,
  division,
  sub,
  status,
  warn,
  pieces,
  since,
  on,
  onOpen,
}: {
  image: string | null
  name: string
  division: string | null
  sub: React.ReactNode
  /// Only said when something is wrong ('Not minted'); a card that merely
  /// waits for its form says nothing.
  status?: string
  warn?: boolean
  pieces: number
  since: string
  on: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={on}
      className={cn(
        "flex min-h-14 min-w-0 flex-col overflow-hidden rounded-card border bg-canvas text-left shadow-soft transition-colors outline-none focus-visible:border-accent max-md:flex-row",
        on ? "border-accent/50" : "border-hairline hover:border-hairline-2"
      )}
    >
      <Thumbnail
        url={image}
        name={name}
        division={division}
        className="aspect-[3/2] w-full border-b border-hairline max-md:aspect-auto max-md:w-24 max-md:shrink-0 max-md:self-stretch max-md:border-r max-md:border-b-0"
      />
      <span className="flex min-w-0 flex-col gap-1 px-4 pt-3.5 pb-4 max-md:flex-1 max-md:px-3.5 max-md:py-3">
        <span className="truncate text-[0.9375rem] font-semibold text-ink">
          {name}
        </span>
        <span className="flex min-w-0 flex-col text-[0.875rem] text-mute">
          {sub}
        </span>
        <span className="mt-3 flex min-w-0 items-center gap-3 border-t border-hairline pt-3 text-[0.875rem] max-md:mt-1.5 max-md:pt-2">
          {status ? (
            <span
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 truncate",
                warn ? "text-warn-fg" : "text-body"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  warn ? "bg-warn" : "bg-accent"
                )}
              />
              {status}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <span className="shrink-0 text-ink tabular-nums">
            {count(pieces)} pcs
          </span>
          <span className="shrink-0 text-mute tabular-nums">{ago(since)}</span>
        </span>
      </span>
    </button>
  )
}

/// The picture of a delivery line: the PO line's own (`image_url`), else the one
/// kept on the supplier's item. Null when there is neither — the Thumbnail then
/// draws the garment placeholder. One answer for the card and for the form.
function useLineImage(row: UnidentifiedReceipt): string | null {
  const own = row.image_url !== null && row.image_url !== ""
  const kept = useQuery({
    queryKey: procurementKeys.itemImage(
      row.supplier_id,
      row.supplier_article_code
    ),
    queryFn: ({ signal }) =>
      supplierItemImage(row.supplier_id, row.supplier_article_code, signal),
    enabled: !own,
    // A photograph does not change; a presigned URL expires. As the item's
    // own sheet reads it, so the two share one answer.
    staleTime: 10 * 60 * 1000,
    retry: false,
  })
  return own ? row.image_url : (kept.data?.url ?? null)
}

/// One delivery line waiting for its identity. The photograph is the PO
/// line's own (`image_url`), else the one kept on the supplier's item, else
/// the garment placeholder the Thumbnail draws from the name.
function WaitingCard({
  row,
  supplier,
  showPo,
  on,
  onOpen,
}: {
  row: UnidentifiedReceipt
  /// The supplier's name, as the book writes it.
  supplier: string
  /// The PO number, on the All rail only — on one PO's rail every card
  /// would say the same thing.
  showPo: boolean
  on: boolean
  onOpen: () => void
}) {
  const image = useLineImage(row)
  return (
    <SetupCard
      image={image}
      name={row.article_name}
      division={row.division_code}
      sub={
        <>
          <span className="block truncate">{supplier}</span>
          {showPo && (
            <span className="block truncate font-mono">{row.po_number}</span>
          )}
        </>
      }
      pieces={row.quantity}
      since={row.verified_at}
      on={on}
      onOpen={onOpen}
    />
  )
}

/// A session that opened and did not mint. Its row carries no photograph
/// and no supplier, so the placeholder and the article code stand in.
function StalledCard({
  row,
  on,
  onOpen,
}: {
  row: SetupSessionRow
  on: boolean
  onOpen: () => void
}) {
  return (
    <SetupCard
      image={null}
      name={row.article_name}
      division={row.division_code}
      sub={<span className="font-mono">{row.article_code}</span>}
      status="Not minted"
      warn
      pieces={row.receipt_quantity}
      since={row.created_at}
      on={on}
      onOpen={onOpen}
    />
  )
}

// ---------------------------------------------------------------------------

/// One colourway of one article, as a row of the grid below.
export interface MatrixColour {
  /// What the caller keys this row by — a colour code before the SKUs exist,
  /// a colour digit afterwards. Never drawn: a row says "Biru", because that
  /// is the word somebody holding the garment would use.
  readonly key: string
  readonly label: string
}

/// One size, as a column of it.
export interface MatrixSize {
  /// `02`. What the variant is stored under.
  readonly code: string
  /// `S`. What everybody calls it.
  readonly label: string
}

/// The colour x size grid a delivery is actually split on.
///
/// Colour down, size across, totals on both outside edges. The flat
/// `Colour | Size | Pieces` list this replaced asked the same question one line
/// at a time: four colours in six sizes was twenty-four rows read downward, and
/// "how many smalls arrived" was a sum somebody did in their head. A delivery
/// is not a list — it is a grid, on the buyer's order sheet and in the boxes
/// that turn up, and this is the one place in the app that has to be told so.
///
/// A cell is one SKU said in words: the article, this row's colour, this
/// column's size — "Kemeja Biru XL". Neither the colour digit nor the size
/// code appears anywhere on it. Those are halves of an eleven-digit number the
/// system mints and nobody says out loud, and a row headed `digit 0` asks a
/// merchandiser to translate before they can count.
///
/// At most ten rows, forever: a colour is ONE digit of that number. Sizes are
/// open-ended, so the grid scrolls sideways inside its own box rather than
/// pushing the sheet wider, and the colour column is frozen against that
/// scroll — a row of figures with no colour beside it is a row of figures.
export function Matrix({
  colours,
  sizes,
  columnClass = "w-[5.5rem]",
  cell,
  rowTotal,
  columnTotal,
  total,
  columnHead,
  rowHead,
  cellProps,
}: {
  readonly colours: readonly MatrixColour[]
  readonly sizes: readonly MatrixSize[]
  /// How wide one size column is. A cell holding a number box needs less room
  /// than one holding a minted SKU's serial range.
  readonly columnClass?: string
  readonly cell: (colour: MatrixColour, size: MatrixSize) => React.ReactNode
  /// The "All" column and row. Optional since 2026-09-28: the article
  /// sheet draws the same grid for PRICES, and a sum of prices is not a
  /// figure anybody reads. Without `rowTotal` neither edge is drawn.
  readonly rowTotal?: (colour: MatrixColour) => React.ReactNode
  readonly columnTotal?: (size: MatrixSize) => React.ReactNode
  readonly total?: React.ReactNode
  /// What a size column's header shows, in place of the plain label. Added
  /// for the pricing grid's pencil — "price every XL at" — without asking
  /// every OTHER caller to carry a button it never wanted.
  readonly columnHead?: (size: MatrixSize) => React.ReactNode
  /// The same, for a colour row's header.
  readonly rowHead?: (colour: MatrixColour) => React.ReactNode
  /// Extra attributes for one body `<td>` — the pricing grid uses this for
  /// `className` (to make the cell a hover `group`) and nothing else needs it
  /// yet, so it stays this narrow rather than a general `render` override.
  readonly cellProps?: (
    colour: MatrixColour,
    size: MatrixSize
  ) => React.TdHTMLAttributes<HTMLTableCellElement>
}) {
  return (
    // Full width, with every figure column held to a figure's worth and the
    // colour column taking whatever is left.
    //
    // It used to be `w-fit`, so a delivery that came in two sizes drew a
    // two-column grid a fifth of the way across the pane with a stretch of
    // empty ground beside it — which read as a table that had failed to load
    // rather than as a small one.
    //
    // `min-w-fit` is what keeps that honest when the sizes outrun the room:
    // the declared widths win, the box scrolls, and the frozen colour column
    // below is the reason that is readable.
    <div className="w-full overflow-x-auto rounded-inner border border-hairline">
      {/* Fixed layout and separated borders, the same as the pricelist grid:
          a matrix is read across as much as down, and without a rule between
          the columns the eye loses which size a figure belongs to halfway
          along the row. */}
      <table className="w-full min-w-fit table-fixed border-separate border-spacing-0 text-cell">
        <colgroup>
          {/* No width on the colour column: under `table-fixed` the one
              undeclared column takes what the others leave. The slack goes
              HERE, to the column holding words, rather than to the figures —
              stretching a size column strands its number in the middle of a
              gap wide enough for a sentence, and stretching the total column
              leaves a hole between the last size and the sum. */}
          <col />
          {sizes.map((size) => (
            <col key={size.code} className={columnClass} />
          ))}
          {rowTotal && <col className="w-[5.5rem]" />}
        </colgroup>

        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-20 h-9 border-r border-b border-hairline bg-canvas px-3 text-left text-cell font-normal text-body"
            >
              Colour
            </th>
            {sizes.map((size, at) => (
              <th
                key={size.code}
                scope="col"
                className={cn(
                  "h-9 border-b border-hairline bg-canvas px-2 text-right text-cell font-normal text-body",
                  // From the second on: the first already has the frozen
                  // colour column's own rule to its left, and two hairlines
                  // side by side draw one two-pixel line.
                  at > 0 && "border-l"
                )}
              >
                {columnHead ? columnHead(size) : size.label}
              </th>
            ))}
            {rowTotal && (
              <th
                scope="col"
                className="h-9 border-b border-l border-hairline bg-canvas px-3 text-right text-cell font-medium text-ink"
              >
                All
              </th>
            )}
          </tr>
        </thead>

        <tbody>
          {colours.map((colour) => (
            <tr key={colour.key}>
              <th
                scope="row"
                className="sticky left-0 z-10 border-t border-r border-hairline bg-canvas px-3 py-1.5 text-left font-normal"
              >
                {rowHead ? (
                  rowHead(colour)
                ) : (
                  <span className="block truncate text-[0.875rem] font-medium text-ink">
                    {colour.label}
                  </span>
                )}
              </th>
              {sizes.map((size, at) => {
                const extra = cellProps?.(colour, size) ?? {}
                return (
                  <td
                    key={size.code}
                    {...extra}
                    className={cn(
                      "h-9 border-t border-hairline px-2 text-right align-middle tabular-nums",
                      at > 0 && "border-l",
                      extra.className
                    )}
                  >
                    {cell(colour, size)}
                  </td>
                )
              })}
              {rowTotal && (
                <td className="h-9 border-t border-l border-hairline px-3 text-right text-[0.875rem] font-medium text-ink tabular-nums">
                  {rowTotal(colour)}
                </td>
              )}
            </tr>
          ))}
        </tbody>

        {rowTotal && (
          <tfoot>
            <tr>
              <th
                scope="row"
                className="h-9 border-t border-r border-hairline bg-soft-2 px-3 text-left text-cell font-normal text-body"
              >
                All
              </th>
              {sizes.map((size, at) => (
                <td
                  key={size.code}
                  className={cn(
                    "h-9 border-t border-hairline bg-soft-2 px-2 text-right text-[0.875rem] text-text tabular-nums",
                    at > 0 && "border-l"
                  )}
                >
                  {columnTotal?.(size)}
                </td>
              ))}
              <td className="h-9 border-t border-l border-hairline bg-soft-2 px-3 text-right text-[0.875rem] font-semibold text-ink tabular-nums">
                {total}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/// One session: what it minted, and — for one that did not — the button that
/// mints it.
///
/// Setting a delivery up mints it in the same press, so a session reached from
/// the composer is normally already issued and this sheet is a record: the
/// article code, the SKUs, the serial ranges their tags were drawn from and
/// the job that went to the warehouse. The footer button is not the routine
/// path any more and is not gone either — a mint that failed leaves its
/// session open, sessions opened before the two presses became one are still
/// open, and both are sent from here.
/// One setup session, read in the right-hand pane of the panel.
///
/// It was a `<Sheet>` of its own until 2026-09-13 — the third of three that a
/// setup passed through. The owner's instruction was one panel: the queue on
/// the left, and whatever that row is on the right, so nothing opens over
/// anything else. What was the sheet's header is the first line of the record
/// now, and what was its footer is the action bar at the foot of the pane.
/// The purchase price each issued session was set up at, so its record can
/// say what the markup is over cost. The session itself does not carry it.
const purchaseBySession = new Map<string, number>()

function SessionRecord({
  id,
  handover,
}: {
  id: string
  /// How the press that made this session ended, when it was that press that
  /// put this record on screen. Null when it was a link, the queue, or a
  /// second look.
  handover: Handover | null
}) {
  const client = useQueryClient()
  const actor = useActor()
  const idempotency = useIdempotencyKey()

  const detail = useQuery({
    queryKey: procurementKeys.setup(id),
    queryFn: ({ signal }) => setupSessionDetail(id, signal),
  })

  /// The mint, for a session that has not had one.
  ///
  /// The session is a VARIABLE rather than read from the prop, so that what
  /// this mutation is holding says which session it is holding it about. This
  /// sheet is one component that several sessions pass through — the stalled
  /// ones especially, since they are worked through one after another — and a
  /// result with no subject on it is a sentence about the last session drawn
  /// under the heading of the next.
  const issue = useMutation({
    mutationFn: (target: string) =>
      issueSetupSession(target, actor, idempotency.key),
    onSuccess: (_, target) => {
      // The session is no longer open, so the queue changes; the record itself
      // gains a job and a serial range. `setups()` is a prefix of the
      // unidentified queue's key, and that is deliberate — a receipt that has
      // been worked out leaves both lists at once.
      void client.invalidateQueries({ queryKey: procurementKeys.setups() })
      void client.invalidateQueries({ queryKey: procurementKeys.setup(target) })
      idempotency.rotate()
    },
  })

  /// Whether what the mutation is holding is about the session on screen.
  const mine = issue.variables === id

  const colours = useMemo(() => {
    const seen = new Map<string, string>()
    for (const variant of detail.data?.variants ?? []) {
      if (!seen.has(variant.colour_digit))
        seen.set(variant.colour_digit, variant.colour_label)
    }
    return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [detail.data])

  /// The photograph of each colourway, read once here rather than by each row
  /// separately — the article's own picture is the first colourway that has
  /// one, so the same answers decide both.
  const photographs = useQueries({
    queries: colours.map(([digit]) => ({
      queryKey: procurementKeys.articleImage(
        detail.data?.article_code ?? "",
        digit
      ),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        articleImage(detail.data?.article_code ?? "", digit, signal),
      enabled: detail.data !== undefined,
      staleTime: 10 * 60 * 1000,
    })),
  })
  /// Built plainly rather than memoised: it is at most ten entries — a colour
  /// is one digit of the SKU — and a dependency list over an array of query
  /// results cannot be written as the simple expressions the rule wants.
  const photographOf = new Map(
    colours.map(([digit], at) => [digit, photographs[at]?.data?.url ?? null])
  )
  /// The article's picture, which is simply the first colourway that has one.
  /// Nothing is drawn when none of them does: a placeholder the size of a
  /// photograph is a hole in the record, not a picture.
  const cover =
    colours.map(([digit]) => photographOf.get(digit)).find((url) => url) ?? null

  /// The words a division and a tag are READ by. The record stores codes —
  /// `ANAK_LAKI`, `KAUS_KAKI` — because a code is what survives a rename; a person
  /// reads "Anak Laki-laki" and "Kaus Kaki", which is what the form they filled in
  /// showed them. The same query the panel already made, so this costs
  /// nothing.
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
  })

  /// Who sent it, by name. The record carries the supplier's CODE — `SUP02` —
  /// which is what the delivery was booked against; the book of suppliers is
  /// what turns it into a name, so renaming a supplier does not leave old
  /// records saying the old thing.
  const suppliers = useQuery({
    queryKey: procurementKeys.suppliers(),
    queryFn: ({ signal }) => listSuppliers(undefined, signal),
    staleTime: 30 * 60 * 1000,
  })
  const supplierName = (code: string) => {
    const found = (suppliers.data ?? []).find(
      (one) =>
        one.supplier_code.toLowerCase() === code.toLowerCase() ||
        one.supplier_id === code
    )
    return found === undefined ? code : supplierDisplayName(found)
  }

  const variants = detail.data?.variants ?? []
  const sizeColumns = useMemo(() => {
    const seen = new Map<string, string>()
    for (const one of detail.data?.variants ?? []) {
      if (!seen.has(one.size_code)) seen.set(one.size_code, one.size_label)
    }
    return [...seen.entries()].map(([code, label]) => ({ code, label }))
  }, [detail.data])
  const variantAt = new Map(
    variants.map((one) => [`${one.colour_digit}|${one.size_code}`, one])
  )
  const prices = variants.map((one) => one.base_price_minor)
  const baseMin = prices.length > 0 ? Math.min(...prices) : 0
  const baseMax = prices.length > 0 ? Math.max(...prices) : 0
  const tally = new Map<number, number>()
  for (const price of prices) tally.set(price, (tally.get(price) ?? 0) + 1)
  const baseMode = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
  const purchase = purchaseBySession.get(id) ?? null
  const markupText =
    purchase !== null && purchase > 0 && prices.length > 0
      ? `${(((baseMode - purchase) / purchase) * 100).toFixed(1).replace(".", ",")}%`
      : "—"

  return (
    // Measured on the PANE, not the sheet and not the window: this column is
    // what the rail beside it leaves over, so a breakpoint reading the sheet
    // would lay a two-column grid out in one column's worth of room.
    <div className="@container flex min-w-0 flex-col">
      {queryState(detail, {
        loading: "Loading the session…",
        render: (session) => (
          <div className="flex flex-col gap-5">
            {/* What the sheet header used to say, with the article's own
                picture beside it.

                The picture is the first colourway that has one, and there is
                nothing in its place when none of them does: a grey box the
                size of a photograph is a hole in the record rather than a
                picture of anything. */}
            <div className="flex min-w-0 items-center gap-3.5">
              {cover !== null && (
                <img
                  src={cover}
                  alt={session.article_name}
                  className="size-14 shrink-0 rounded-inner border border-hairline object-cover"
                />
              )}
              {/* The name, and only the name. The code was a mono line over
                  it — a second identifier standing above the first, in the
                  position a title goes. It is a fact about the article like
                  the division and the supplier are, so it is filed with
                  them. */}
              <h3 className="min-w-0 flex-1 truncate text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink">
                {session.article_name}
              </h3>
            </div>

            {/* The one thing that can go wrong and needs a person.

                The success banners are gone on the owner's word of
                2026-09-13: "minted, job on its way" told somebody what they
                had just watched happen, in a record that says so itself — the
                grid below is full of serial ranges, which is what having
                minted LOOKS like. A failure is different. The delivery has an
                identity, the receipt is out of the queue, nothing was drawn,
                and nothing but the button below will finish it. */}
            {!mine && handover !== null && handover.problem !== null && (
              <Banner tone="bad">
                The delivery has its identity, but nothing was minted against
                it: no SKUs, no serial ranges, no tagging job. The session is
                open and the button below sends it again. The server said:{" "}
                {handover.problem}
              </Banner>
            )}
            {mine && issue.isError && (
              <Banner tone="bad">{(issue.error as Error).message}</Banner>
            )}

            {/* The same facts, in the same order and grid, as the form this
                record was filled in on — read-only. */}
            <Facts className="@xl:grid-cols-2">
              <Fact term="Supplier">
                {session.supplier_code
                  ? supplierName(session.supplier_code)
                  : "—"}
              </Fact>
              <Fact term="Division">
                {termLabel(vocabulary.data?.divisions, session.division_code)}
              </Fact>
              <Fact term="Tags">
                {session.tags.length === 0
                  ? "—"
                  : session.tags
                      .map((tag) => termLabel(vocabulary.data?.tags, tag))
                      .join(" · ")}
              </Fact>
              <Fact term="Article Code">
                <span className="font-mono text-id">
                  {session.article_code}
                </span>
              </Fact>
              <Fact term="Base Price">
                {session.variants.length === 0
                  ? "—"
                  : baseMin === baseMax
                    ? money(baseMode)
                    : `${money(baseMin)} – ${money(baseMax)}`}
              </Fact>
              <Fact term="Markup">
                {markupText}
                {purchase !== null && (
                  <span className="ml-2 text-[0.875rem] text-mute">
                    Purchase price {money(purchase)}
                  </span>
                )}
              </Fact>
            </Facts>

            <div>
              <SubHead>Variants</SubHead>
              {session.variants.length === 0 ? (
                <p className="mt-3 text-meta text-mute">
                  Nothing has been minted yet. Issuing the session draws the
                  SKUs, their serial ranges and their EPCs in one transaction.
                </p>
              ) : (
                <div className="mt-3">
                  <Matrix
                    colours={colours.map(([digit, label]) => ({
                      key: digit,
                      label,
                    }))}
                    sizes={sizeColumns}
                    columnClass="w-36"
                    rowHead={(colour) => (
                      <span className="flex min-w-0 items-center gap-2.5">
                        <ColourwayPhoto
                          articleCode={session.article_code}
                          digit={colour.key}
                          label={colour.label}
                          url={photographOf.get(colour.key) ?? null}
                          articleName={session.article_name}
                          division={session.division_code}
                        />
                        <span className="min-w-0 flex-1 truncate text-[0.875rem] font-medium text-ink">
                          {colour.label}
                        </span>
                      </span>
                    )}
                    cellProps={() => ({ className: "h-auto px-2.5 py-2.5" })}
                    cell={(colour, size) => {
                      const one = variantAt.get(`${colour.key}|${size.code}`)
                      if (one === undefined)
                        return <span className="text-mute">—</span>
                      return (
                        <span
                          title={one.sku_code}
                          className="flex flex-col items-end gap-0.5"
                        >
                          <span className="text-[0.9375rem] text-ink">
                            {count(one.quantity)}
                          </span>
                          <span className="text-[0.875rem] whitespace-nowrap text-mute">
                            {money(one.base_price_minor)}
                          </span>
                          <span className="font-mono text-[0.875rem] text-mute">
                            {one.sku_code}
                          </span>
                        </span>
                      )
                    }}
                    rowTotal={(colour) =>
                      count(
                        session.variants
                          .filter((one) => one.colour_digit === colour.key)
                          .reduce((sum, one) => sum + one.quantity, 0)
                      )
                    }
                    columnTotal={(size) =>
                      count(
                        session.variants
                          .filter((one) => one.size_code === size.code)
                          .reduce((sum, one) => sum + one.quantity, 0)
                      )
                    }
                    total={count(
                      session.variants.reduce(
                        (sum, one) => sum + one.quantity,
                        0
                      )
                    )}
                  />
                </div>
              )}
            </div>

            {/* The mint, for a session that opened and did not run one. It was
                the sheet's footer; this panel's footer belongs to the queue as
                much as to the record, so the button that acts on THIS record
                stands at the foot of it. */}
            {session.status === "OPEN" && (
              <div className="sticky bottom-0 -mx-1 flex flex-col gap-2.5 border-t border-hairline bg-canvas px-1 pt-3.5 pb-1 @xl:flex-row @xl:items-center @xl:justify-between">
                <p className="min-w-0 text-[0.875rem] leading-relaxed text-mute">
                  Nothing has been drawn against this session yet. Minting draws
                  the SKUs, their serial ranges and their EPCs in one
                  transaction and sends the tagging job to {session.site_id}.
                </p>
                <Button
                  variant="primary"
                  className="w-full shrink-0 @xl:w-auto @xl:min-w-[13rem]"
                  pending={mine && issue.isPending}
                  disabled={actor === ""}
                  onClick={() => issue.mutate(id)}
                >
                  {mine && issue.isPending ? "Submitting…" : "Submit"}
                </Button>
              </div>
            )}

            {/* The record's own surroundings — who touched it, what was said
                about it. `<Sheet>` appends this itself when it is given a
                subject, and it cannot here: it would land under BOTH columns
                rather than under the record it belongs to. */}
            <RecordPanel subject={{ kind: "article_setup", id }} />
          </div>
        ),
      })}
    </div>
  )
}

/// One colourway's photograph, at the head of its row in the variant grid.
///
/// It was a card in a "Colourways" block at the foot of the record: the colour
/// name again, the storage key in mono, and a button. All three were noise —
/// the name is the row this now sits in, and `catalogue/00000001/0.jpg` is
/// where the file lands, which is the app's business and nobody else's. What
/// is left is the picture, and a way to put one there.
///
/// The bytes never pass through the node: it hands out a URL that authorises
/// exactly this key for an hour, and the browser PUTs straight to the bucket.
function ColourwayPhoto({
  articleCode,
  digit,
  label: colourLabel,
  url,
  articleName,
  division,
}: {
  articleCode: string
  digit: string
  label: string
  articleName: string
  division: string
  /// What the record already read for this colourway, so the row does not ask
  /// again — the article's own picture is the first of these, so they are read
  /// once for both.
  url: string | null
}) {
  const client = useQueryClient()

  const upload = useMutation({
    // Converted on the way in, not refused at the picker: the store is JPEG
    // and almost everything a person has to hand is a PNG. See `lib/image`.
    mutationFn: async (file: File) =>
      uploadArticleImage(articleCode, digit, await asJpeg(file)),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: procurementKeys.articleImage(articleCode, digit),
      }),
  })

  return (
    <label
      title={
        upload.isError
          ? (upload.error as Error).message
          : url
            ? `Replace the photograph of ${colourLabel}`
            : `Add a photograph of ${colourLabel}`
      }
      className={cn(
        "group/photo relative grid size-9 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-inner border transition-colors",
        upload.isError
          ? "border-bad"
          : "border-hairline-2 hover:border-hairline-strong",
        url ? "border-hairline" : "bg-soft-2"
      )}
    >
      {url ? (
        <img src={url} alt={colourLabel} className="size-full object-cover" />
      ) : (
        <>
          <Thumbnail
            url={null}
            name={articleName}
            division={division}
            fallback="—"
            className="size-full"
          />
          <Camera className="absolute size-3.5 text-line-ico opacity-0 transition-opacity group-hover/photo:opacity-100" />
        </>
      )}
      {upload.isPending && (
        <span className="absolute inset-0 grid place-items-center bg-canvas/75 text-[0.875rem] font-medium text-body">
          …
        </span>
      )}
      <input
        type="file"
        accept={PICTURE_TYPES}
        className="sr-only"
        disabled={upload.isPending}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) upload.mutate(file)
          event.target.value = ""
        }}
      />
    </label>
  )
}

/// Give one delivery its identity.
///
/// This sheet is the step the whole chain was waiting on. Goods are received
/// and accepted at the DC, they reach head office with the supplier's own code
/// and nothing of ours, and until somebody answers "what IS this" they have no
/// article, therefore no SKU, therefore no tag, no price and no sale. The DC's
/// tagging queue says as much in its empty state: head office issues these
/// when goods are accepted.
///
/// Almost everything is prefilled from what the buyer already wrote on the
/// order. The two things only a person can say are which colours arrived and
/// how the pieces split across colour and size — and the second is checked
/// against the quantity the warehouse actually counted, because a session that
/// declared more pieces than turned up would mint stock that does not exist.
///
/// Finishing the form mints it. The form is the whole of what the mint needs,
/// so the second press this used to end at could only ever agree with the
/// first one.
/// One delivery being told what it is, in the right-hand pane.
///
/// It was a `<Sheet>` of its own until 2026-09-13 — the second of three a
/// setup passed through, opened by clicking a row in a sheet that then closed.
/// The owner's instruction was one panel with the form already on screen: a
/// queue whose whole purpose is to be worked through should not cost a click
/// per delivery before there is anything to fill in.
function DeliverySetup({
  receipt,
  vocabulary,
  onDone,
  onDirty,
}: {
  receipt: UnidentifiedReceipt
  vocabulary?: CatalogueVocabulary
  onDone: (outcome: SetupOutcome) => void
  /// Whether the form holds something typed that closing would lose.
  onDirty: (dirty: boolean) => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const idempotency = useIdempotencyKey()
  /// A split's keys, one per article in tab order, held across retries of the
  /// same press exactly as the single key is: a retry happens only when the
  /// sessions did not open, so no key has been spent yet.
  const splitKeys = useRef<string[]>([])
  const splitKey = (index: number) =>
    (splitKeys.current[index] ??= crypto.randomUUID())

  /// One press, two writes: save the identity, then mint against it.
  ///
  /// The mint is not retried here and not rolled back either — neither is
  /// available. A session cannot be un-opened, and a retry from a form the
  /// person is watching would either mint twice or look like it had. What it
  /// does instead is stop being an error: the caller is handed the session, is
  /// told the mint did not run and why, and the sheet that opens on it is the
  /// one with the button that runs it.
  const setUp = useMutation({
    mutationFn: async (submission: SetupSubmission): Promise<SetupOutcome> => {
      if (submission.kind === "split") {
        // Every article opens, or none does — one transaction. Then each is
        // minted on its own, in order; one that does not mint does not stop
        // the next, and becomes a "Not minted" session like a single one.
        const opened = await openSplitSetup(submission.request)
        const issued: SetupSession[] = []
        const stalled: { session: SetupSession; problem: string }[] = []
        for (const [index, session] of opened.entries()) {
          try {
            issued.push(
              await issueSetupSession(
                session.session_id,
                submission.request.created_by,
                splitKey(index)
              )
            )
          } catch (error) {
            stalled.push({
              session,
              problem: problemOf(error) ?? "The server could not be reached.",
            })
          }
        }
        return { kind: "split", issued, stalled }
      }
      const request = submission.request
      const opened = await openSetupSession(request)
      try {
        return {
          kind: "issued",
          session: await issueSetupSession(
            opened.session_id,
            request.created_by,
            idempotency.key
          ),
        }
      } catch (error) {
        return {
          kind: "stalled",
          session: opened,
          problem: problemOf(error) ?? "The server could not be reached.",
        }
      }
    },
    onSuccess: (outcome) => {
      if (outcome.kind === "issued")
        purchaseBySession.set(
          outcome.session.session_id,
          receipt.purchase_price_minor
        )
      if (outcome.kind === "split") {
        for (const one of outcome.issued)
          purchaseBySession.set(one.session_id, receipt.purchase_price_minor)
        // Out of the queue at once: a split goes on to the next delivery
        // rather than to a record, and this form must not stand there
        // pressable until the refetch lands.
        client.setQueryData<UnidentifiedReceipt[]>(
          procurementKeys.unidentified(),
          (rows) =>
            rows?.filter(
              (row) => row.receipt_line_id !== receipt.receipt_line_id
            )
        )
      }
      // The queue this line was in and the sessions it passed through, in one
      // call: `setups()` is a prefix of the unidentified queue's key, and a
      // receipt that has been worked out leaves both lists at once.
      void client.invalidateQueries({ queryKey: procurementKeys.setups() })
      // Merchandise, Articles lists the new articles at once.
      void client.invalidateQueries({ queryKey: articleKeys.all })
      // Rotated on both outcomes, because nothing retries from here: the sheet
      // closes either way, and a stalled session is minted again from its own
      // sheet under its own key. Holding this one would only carry a spent key
      // into the NEXT delivery's mint.
      idempotency.rotate()
      splitKeys.current = []
      onDone(outcome)
    },
  })

  return (
    <SessionComposer
      // Keyed on the line, so moving to the next delivery starts clean rather
      // than carrying the last one's colours into this one. It matters more
      // here than it did behind a sheet: the rail beside this makes switching
      // deliveries one click.
      key={receipt.receipt_line_id}
      receipt={receipt}
      vocabulary={vocabulary}
      actor={actor}
      // The identity itself failing to save. The mint failing after it saved
      // is not a problem this form can restate — the delivery is no longer
      // waiting, so the pane has moved on to the session that is.
      problem={problemOf(setUp.error)}
      busy={setUp.isPending}
      onSubmit={(submission) => setUp.mutate(submission)}
      onDirty={onDirty}
    />
  )
}

// ---------------------------------------------------------------------------
// Pricing the grid — the owner's word of 2026-09-28.
//
// A SKU's markup and its price are the same decision said two ways, so one
// box in the grid takes either: "209000" or "90%" both land on the same
// rupiah. These are plain functions rather than `line-pricing-model` exports
// because they work off the PURCHASE price cell by cell, where that file's
// `Pricing` works off one purchase price for a whole line.

/// Digits only, the way a person typing a price means them — `"Rp 209.000"`
/// and `"209000"` are the same answer.
function onlyDigits(text: string): string {
  return text.replace(/[^\d]/g, "")
}

function formatThousands(value: number): string {
  return value.toLocaleString("id-ID")
}

/// A price box's live formatting, on every keystroke: digits regroup with
/// dots, a `%` is kept and cuts off anything typed after it.
function liveFormatSkuPrice(raw: string): string {
  if (raw.includes("%")) return raw.replace(/[^\d,.%]/g, "").replace(/%.*/, "%")
  const n = onlyDigits(raw)
  return n === "" ? "" : formatThousands(Number(n))
}

/// What a price box's text means, in rupiah — `null` while it means nothing
/// yet (empty, or a bare "%").
function parseSkuPrice(raw: string, purchase: number): number | null {
  if (raw.includes("%")) {
    const pct = Number.parseFloat(raw.replace(",", ".").replace(/[^\d.-]/g, ""))
    return Number.isFinite(pct) ? baseFrom(purchase, pct) : null
  }
  const n = onlyDigits(raw)
  return n === "" ? null : Number(n)
}

/// The markup a price is over cost, rounded to one decimal — `markupFrom`
/// already does this rounding for `line-pricing`, so a SKU's own price and a
/// line's base price read the same percentage the same way.
function skuMarkup(purchase: number, price: number): string {
  return markupFrom(purchase, price) || "0"
}

/// The other half of what is being typed, live, under the box — "= Rp
/// 199.500" while typing a markup, "= 104,8% markup" while typing a price.
function counterpartText(raw: string, purchase: number): string {
  const n = parseSkuPrice(raw, purchase)
  if (n === null) return ""
  return raw.includes("%")
    ? `= Rp ${formatThousands(n)}`
    : `= ${skuMarkup(purchase, n).replace(".", ",")}% markup`
}

/// One colour x size grid, prefilled from the PO's own split — the pieces it
/// already named, and the prices that differ from the line's. Skips a variant
/// with no colour or no size: the grid is colour x size, and there is no cell
/// for either half missing.
function prefillFromReceipt(receipt: UnidentifiedReceipt): {
  colours: string[]
  sizes: string[]
  pieces: Record<string, string>
  ownPrice: Record<string, number>
} {
  const seenColours: string[] = []
  const seenSizes: string[] = []
  for (const variant of receipt.variants) {
    if (variant.colour_code === null || variant.size_code === null) continue
    if (!seenColours.includes(variant.colour_code))
      seenColours.push(variant.colour_code)
    if (!seenSizes.includes(variant.size_code))
      seenSizes.push(variant.size_code)
  }
  const colours = seenColours.slice(0, COLOURWAY_CEILING)
  const pieces: Record<string, string> = {}
  const ownPrice: Record<string, number> = {}
  for (const variant of receipt.variants) {
    if (variant.colour_code === null || variant.size_code === null) continue
    if (!colours.includes(variant.colour_code)) continue
    const key = `${variant.colour_code}|${variant.size_code}`
    pieces[key] = String(variant.quantity)
    if (
      variant.base_price_minor !== null &&
      variant.base_price_minor !== receipt.base_price_minor
    )
      ownPrice[key] = variant.base_price_minor
  }
  return { colours, sizes: seenSizes, pieces, ownPrice }
}

/// The box shared by the count and the price line: 47px like every form field
/// in the hub, flat at rest, a canvas fill and a hairline ring once the cell it
/// sits in is hovered, a heavier blue ring while it holds focus. `(hover:
/// none)` — a finger — shows the ring always, since nothing on that device
/// ever hovers a cell first.
const SKU_BOX =
  "block h-[var(--form-box,2.75rem)] w-full rounded-inner px-3 text-right text-[0.9375rem] tabular-nums transition-[background-color,box-shadow] duration-(--t-press) ease-(--ease-out) group-hover:bg-canvas group-hover:shadow-[inset_0_0_0_1px_var(--hairline-strong)] [@media(hover:none)]:shadow-[inset_0_0_0_1px_var(--hairline)]"

/// A small dark note hung under an element, drawn on the page rather than
/// inside the cell: the grid scrolls sideways in its own box, and anything
/// absolutely placed in a cell is cut off by that box.
function Chip({
  anchor,
  children,
}: {
  anchor: HTMLElement | null
  children: React.ReactNode
}) {
  if (anchor === null) return null
  const box = anchor.getBoundingClientRect()
  return createPortal(
    <span
      aria-hidden
      style={{
        top: box.bottom + 4,
        right: window.innerWidth - box.right,
      }}
      className="sku-price-pop pointer-events-none fixed z-[60] rounded-[0.375rem] bg-tooltip px-2.5 py-1 text-[0.875rem] whitespace-nowrap text-on-dark tabular-nums shadow-pop"
    >
      {children}
    </span>,
    document.body
  )
}

/// One SKU, said as two lines in one cell: how many pieces, and what they
/// sell for. Tab never lands on the price — it is a `<button>` with
/// `tabIndex={-1}`, on the owner's word of 2026-09-28, so running the count
/// column with the keyboard never detours through a row of prices nobody
/// asked to edit.
function SkuCell({
  label,
  quantity,
  onQuantity,
  purchase,
  price,
  own,
  editing,
  editingValue,
  onEditingChange,
  onStartEdit,
  onCommit,
  onCancel,
}: {
  label: string
  quantity: string
  onQuantity: (next: string) => void
  purchase: number
  base: number
  price: number
  own: boolean
  editing: boolean
  editingValue: string
  onEditingChange: (next: string) => void
  onStartEdit: () => void
  onCommit: () => void
  onCancel: () => void
}) {
  const has = (Number(quantity) || 0) > 0
  // Nothing to show until there is a base price or a price of its own: a
  // zero would read as "free", not as "not decided yet".
  const priced = price > 0
  // At or below the purchase price reads as a mistake rather than a decision, so
  // it gets the colour that means one everywhere else in this app. Only a SKU
  // that will be created is judged.
  const loss = has && priced && price <= purchase
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [hover, setHover] = useState(false)
  const live = editing ? counterpartText(editingValue, purchase) : ""
  return (
    <>
      <Input
        inputMode="numeric"
        aria-label={`${label} pieces`}
        value={quantity}
        onChange={(event) => onQuantity(onlyDigits(event.target.value))}
        className={cn(
          SKU_BOX,
          "border-0 bg-transparent focus:bg-canvas focus:shadow-[inset_0_0_0_1.5px_var(--accent)]"
        )}
      />
      {editing ? (
        <input
          ref={setAnchor}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          inputMode="text"
          aria-label={`${label} price`}
          value={editingValue}
          onChange={(event) =>
            onEditingChange(liveFormatSkuPrice(event.target.value))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              onCommit()
            }
            if (event.key === "Escape") onCancel()
          }}
          onBlur={onCommit}
          className={cn(
            SKU_BOX,
            "mt-1 border-0 bg-canvas text-ink shadow-[inset_0_0_0_1.5px_var(--accent)] outline-none"
          )}
        />
      ) : (
        <button
          ref={setAnchor}
          type="button"
          tabIndex={-1}
          onClick={onStartEdit}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          aria-label={`${label} price`}
          aria-invalid={loss || undefined}
          // Always drawn and always open to a price, counted or not: a grid
          // freshly opened on a delivery has no counts yet, and hiding every
          // price until one was typed hid the base price from the whole
          // table (the owner's report of 2026-09-29). A cell with no pieces
          // is only quieter — it mints no SKU, so its price goes nowhere yet.
          className={cn(
            SKU_BOX,
            "mt-1 cursor-text border-0 bg-transparent",
            loss
              ? "text-bad"
              : own
                ? "font-medium text-accent"
                : has
                  ? "text-mute"
                  : "text-faint"
          )}
        >
          {priced ? `Rp ${formatThousands(price)}` : "—"}
        </button>
      )}
      {/* What the cell says about itself, in words under it. A SKU with no
          pieces is not created — said calmly, not as an error. */}
      {loss && !editing && (
        <span className="mt-1.5 block text-right text-[0.875rem] text-bad">
          Above purchase price
        </span>
      )}
      {!has && (
        <span className="mt-1.5 block text-right text-[0.875rem] text-mute">
          Not created
        </span>
      )}
      {/* The markup, said in a chip under the cell rather than as a third
          line — it is context for the price, not a fact the grid is filled
          in to record. Hidden while the price is being typed: the live "= …"
          chip says the same thing better, right there under the box. */}
      {priced && !editing && hover && (
        <Chip anchor={anchor}>
          {skuMarkup(purchase, price).replace(".", ",")}% markup
        </Chip>
      )}
      {editing && live !== "" && <Chip anchor={anchor}>{live}</Chip>}
    </>
  )
}

/// The pencil beside a size or colour header — always visible, quiet until
/// hovered — and the small popover under it that
/// prices every SKU of that column or row at once: "Price for all Navy", one
/// money box and "Set price".
///
/// A popover portalled to the page, so it sits outside the setup `<form>`:
/// Enter here applies the price and can never press "Create articles" behind
/// it. A whole column or row is the common case (XXL costs more everywhere),
/// and it takes a price or a markup exactly like one cell does; left empty,
/// it puts them back on the base price.
function HeadPricePopover({
  name,
  purchase,
  onApply,
}: {
  /// The colour or size the pencil belongs to.
  name: string
  purchase: number
  base: number
  /// The price for every SKU of the column or row; `null` for back to base.
  onApply: (price: number | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const parsed = parseSkuPrice(value, purchase)
  // A bare "%" means nothing yet; an empty box means the base price.
  const answer =
    value.trim() === ""
      ? { price: null }
      : parsed === null
        ? null
        : { price: parsed }
  const tooLow =
    answer !== null && answer.price !== null && answer.price <= purchase
  const apply = () => {
    if (answer === null || tooLow) return
    onApply(answer.price)
    setOpen(false)
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // A fresh box every time it opens.
        if (next) setValue("")
      }}
    >
      <Popover.Trigger
        aria-label={`Price every ${name} at`}
        className="ml-1.5 inline-flex rounded-[0.375rem] p-1 text-mute transition-colors duration-(--t-press) ease-(--ease-out) hover:bg-soft-2 hover:text-ink data-[popup-open]:text-ink"
      >
        <Pencil className="size-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="z-50"
          side="bottom"
          align="end"
          sideOffset={6}
        >
          <Popover.Popup className={cn(POPUP, "w-[19rem] p-4")}>
            <p className="mb-3 text-[0.9375rem] font-medium text-ink">
              Price for all {name}
            </p>
            <Input
              autoFocus
              aria-label={`Price for all ${name}`}
              value={value}
              invalid={tooLow}
              onChange={(event) =>
                setValue(liveFormatSkuPrice(event.target.value))
              }
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                // Never the setup form's Enter.
                event.preventDefault()
                event.stopPropagation()
                apply()
              }}
              className="h-10 text-right text-[0.9375rem] tabular-nums"
            />
            {tooLow && (
              <p className="mt-2 text-[0.875rem] text-bad">
                Must be above the purchase price, {money(purchase)}
              </p>
            )}
            <div className="mt-3 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  onApply(null)
                  setOpen(false)
                }}
                className="text-[0.875rem] text-mute hover:text-ink"
              >
                Reset
              </button>
              <Button
                variant="primary"
                type="button"
                disabled={answer === null || tooLow}
                onClick={apply}
              >
                Set price
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/// The name the form starts with: the PO line's article name, tidied — trimmed,
/// spaces collapsed, each word in Title Case. Only a starting point; the box
/// stays editable and a typed name is never replaced.
function suggestName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
}

/// The names the Name suggestions master holds, for the name box: those
/// containing what was typed, at most eight (owner, 2026-10-05 — a master of
/// its own, not the articles that already exist). Waits 250ms after the last
/// key and from two characters, so a name typed at speed is one question
/// rather than one per letter.
function useNameSuggestions(text: string): string[] {
  const [settled, setSettled] = useState("")
  useEffect(() => {
    const wanted = text.trim()
    const timer = setTimeout(
      () => setSettled(wanted.length >= 2 ? wanted : ""),
      wanted.length >= 2 ? 250 : 0
    )
    return () => clearTimeout(timer)
  }, [text])
  const found = useQuery({
    queryKey: nameSuggestionKeys.typed(settled),
    queryFn: ({ signal }) => suggestNames(settled, signal),
    enabled: settled !== "",
    staleTime: 60 * 1000,
  })
  return useMemo(() => {
    if (settled === "") return []
    const seen = new Set<string>()
    const names: string[] = []
    for (const row of found.data ?? []) {
      const key = row.name.trim().toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      names.push(row.name.trim())
      if (names.length === 8) break
    }
    return names
  }, [found.data, settled])
}

/// The article's name, with the Name suggestions master offered as the buyer
/// types. Free text stays free: a suggestion is only ever a shortcut.
function NameInput({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(-1)
  const names = useNameSuggestions(open ? value : "")
  const shown = open
    ? names.filter((one) => one.toLowerCase() !== value.trim().toLowerCase())
    : []
  const take = (name: string) => {
    onChange(name)
    setOpen(false)
    setAt(-1)
  }
  return (
    <div className="relative">
      <Input
        value={value}
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-controls={`${id}-names`}
        aria-autocomplete="list"
        aria-activedescendant={at >= 0 ? `${id}-${at}` : undefined}
        autoComplete="off"
        onChange={(event) => {
          titled(event, onChange)
          setOpen(true)
          setAt(-1)
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && shown.length > 0) {
            event.stopPropagation()
            setOpen(false)
          } else if (event.key === "ArrowDown" && shown.length > 0) {
            event.preventDefault()
            setAt((was) => (was + 1) % shown.length)
          } else if (event.key === "ArrowUp" && shown.length > 0) {
            event.preventDefault()
            setAt((was) => (was <= 0 ? shown.length - 1 : was - 1))
          } else if (event.key === "Enter" && at >= 0 && shown[at]) {
            // Takes the name, never submits the setup.
            event.preventDefault()
            take(shown[at])
          }
        }}
      />
      {shown.length > 0 && (
        <ul
          id={`${id}-names`}
          role="listbox"
          aria-label="Names already in the catalogue"
          className="absolute top-full right-0 left-0 z-30 mt-1.5 flex flex-col gap-0.5 rounded-card border border-hairline bg-canvas p-1.5 shadow-pop"
        >
          {shown.map((name, index) => (
            <li
              key={name}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === at}
              // `mousedown`, so it lands before the box's blur closes the list.
              onMouseDown={(event) => {
                event.preventDefault()
                take(name)
              }}
              onMouseEnter={() => setAt(index)}
              className={cn(
                "cursor-pointer truncate rounded-inner px-3 py-2.5 text-[0.9375rem] text-ink",
                index === at && "bg-soft-2"
              )}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/// The form itself, keyed on the receipt line so switching deliveries starts
/// clean rather than carrying the last one's colours into this one.
///
/// # Everything here is chosen from a master, and nothing is typed
///
/// Division, tags, colours and sizes are all vocabularies this company keeps —
/// and every one of them was, at some point on this screen, either a free box
/// or a list of raw codes. Free text is what left "Navy", "navy" and "Biru
/// Navy" in the catalogue as three unrelated colours; raw codes are what had
/// somebody choosing between `02` and `06` when they meant S and XXL.
function SessionComposer({
  receipt,
  vocabulary,
  actor,
  problem,
  busy,
  onSubmit,
  onDirty,
}: {
  receipt: UnidentifiedReceipt
  vocabulary?: CatalogueVocabulary
  actor: string
  problem: string | null
  busy: boolean
  onSubmit: (submission: SetupSubmission) => void
  onDirty?: (dirty: boolean) => void
}) {
  /// The delivery line's picture, shown at the head of the form.
  const lineImage = useLineImage(receipt)
  /// The colour master, for the words and for the swatches. A colour is the
  /// one vocabulary here that is RECOGNISED rather than read — "the navy one"
  /// is how somebody describes a garment they are holding.
  const master = useQuery({
    queryKey: colourKeys.list(),
    queryFn: ({ signal }) => listColours(signal),
    staleTime: 30 * 60 * 1000,
  })

  /// Who sent it, by name. The receipt carries an id and the supplier's own
  /// code for the article, and neither is something a person recognises.
  const suppliers = useQuery({
    queryKey: procurementKeys.suppliers(),
    queryFn: ({ signal }) => listSuppliers(undefined, signal),
    staleTime: 30 * 60 * 1000,
  })

  /// Colour CODES, in the order they were picked. The digit each one ends up
  /// with is its position in this list — which is safe here and nowhere else:
  /// this delivery is minting a brand new article, so no digit is spoken for
  /// yet and re-numbering the list cannot rename goods already on a shelf.
  ///
  /// All three of these, and `ownPrice` below, start from the PO's own split
  /// when it had one — a buyer who already said "40 Navy M at their own
  /// price" should not have to say it again here.
  ///
  /// Held per ARTICLE since 2026-10-02: one delivery line can be split into
  /// several sibling articles, and each tab is one of them — its own colours,
  /// sizes, pieces and SKU prices under the one shared header. With a single
  /// tab this is exactly the form it always was.
  const [tabs, setTabs] = useState<readonly ArticleTab[]>(() => {
    const start = prefillFromReceipt(receipt)
    return [
      {
        id: 0,
        colours: start.colours,
        sizes: start.sizes,
        pieces: start.pieces,
        ownPrice: start.ownPrice,
      },
    ]
  })
  const [tabAt, setTabAt] = useState(0)
  const [nextTabId, setNextTabId] = useState(1)
  const current = Math.min(tabAt, tabs.length - 1)
  const tab = tabs[current]
  const patchTab = (change: (was: ArticleTab) => ArticleTab) =>
    setTabs((all) =>
      all.map((one, index) => (index === current ? change(one) : one))
    )
  const chosenColours = tab.colours
  const chosenSizes = tab.sizes
  const setChosenColours = (next: readonly string[]) =>
    patchTab((was) => ({ ...was, colours: next }))
  const setChosenSizes = (next: readonly string[]) =>
    patchTab((was) => ({ ...was, sizes: next }))
  /// Keyed `colour|size` by CODE, not by digit: a colour dropped and picked
  /// back up — which happens constantly while somebody works out what arrived
  /// — would otherwise come back as a different digit and lose its counts.
  const pieces = tab.pieces
  const setPieces = (
    change: (was: Record<string, string>) => Record<string, string>
  ) => patchTab((was) => ({ ...was, pieces: change(was.pieces) }))
  /// A SKU's OWN price, keyed the same way as `pieces`, only present where it
  /// is not simply the base price. The owner's word of 2026-09-28: the base
  /// price is one field above the grid, an outlier is a click INSIDE it — a
  /// second price column would ask every ordinary delivery to answer a
  /// question only the unusual one has.
  const ownPrice = tab.ownPrice
  const setOwnPrice = (
    change: (was: Record<string, number>) => Record<string, number>
  ) => patchTab((was) => ({ ...was, ownPrice: change(was.ownPrice) }))
  /// Which cell's price is being typed into, and what it holds so far. One at
  /// a time, by the same `colour|size` key — clicking a different price while
  /// this one is open commits it first, the same way leaving any text box
  /// does.
  const [editingPrice, setEditingPrice] = useState<{
    key: string
    value: string
  } | null>(null)

  /// Moving between articles drops a price box half typed in the last one —
  /// its key would land on the same colour x size of the next.
  const pickTab = (index: number) => {
    setEditingPrice(null)
    setTabAt(index)
  }
  /// A new, empty article after the others, opened. It starts with the sizes
  /// of the one on screen: a split is almost always the same size run.
  const addTab = () => {
    if (tabs.length >= MAX_ARTICLE_TABS) return
    setTabs((all) => [
      ...all,
      {
        id: nextTabId,
        colours: [],
        sizes: tab.sizes,
        pieces: {},
        ownPrice: {},
      },
    ])
    setNextTabId((id) => id + 1)
    pickTab(tabs.length)
  }
  /// Its pieces go with it; the counter shows them as left over.
  const removeTab = (index: number) => {
    if (tabs.length <= 1) return
    setTabs((all) => all.filter((_, at) => at !== index))
    pickTab(
      index < current || current === tabs.length - 1
        ? Math.max(0, current - 1)
        : current
    )
  }
  /// "Split automatically": the open tab's variants moved into new tabs right
  /// after it, for the person to look over before anything is sent.
  const applySplit = (mode: SplitMode) => {
    let id = nextTabId
    const made = splitTab(tab, mode, sizeOrder, () => id++)
    if (made === null) return
    setTabs((all) => [
      ...all.slice(0, current),
      ...made,
      ...all.slice(current + 1),
    ])
    setNextTabId(id)
    pickTab(current)
  }
  const [name, setName] = useState(() => suggestName(receipt.article_name))
  const [division, setDivision] = useState(receipt.division_code ?? "")
  /// What the buyer already filed it under. Editable, because the buyer was
  /// describing an order line and this is the article the company will keep.
  const [tags, setTags] = useState<readonly string[]>(receipt.tags)
  /// Purchase price, markup and base price, kept in step the way
  /// `PricingFields` keeps them — typing either of the last two fills the
  /// other. The purchase price itself is never typed here: it is the PO
  /// line's own cost, shown as the "Markup" field's aside rather than as a
  /// box, because nobody setting up a delivery is re-negotiating what it cost.
  const [pricing, setPricing] = useState<Pricing>(() => {
    const purchase = String(receipt.purchase_price_minor)
    const base =
      receipt.base_price_minor !== null ? String(receipt.base_price_minor) : ""
    if (receipt.markup_bps !== null)
      return { purchase, markup: String(receipt.markup_bps / 100), base }
    return syncPricing({ purchase, markup: "", base }, { base })
  })
  const setPricingField = (change: Partial<Pricing>) =>
    setPricing((was) => syncPricing(was, change))

  /// Anything changed from what the order line said. Told to the sheet, so
  /// closing it asks before the form is lost.
  const start = useMemo(() => prefillFromReceipt(receipt), [receipt])
  const dirty =
    tabs.length > 1 ||
    name !== suggestName(receipt.article_name) ||
    division !== (receipt.division_code ?? "") ||
    tags.join() !== receipt.tags.join() ||
    chosenColours.join() !== start.colours.join() ||
    chosenSizes.join() !== start.sizes.join() ||
    JSON.stringify(pieces) !== JSON.stringify(start.pieces) ||
    JSON.stringify(ownPrice) !== JSON.stringify(start.ownPrice) ||
    pricing.base !==
      (receipt.base_price_minor !== null
        ? String(receipt.base_price_minor)
        : "")
  useEffect(() => {
    onDirty?.(dirty)
    return () => onDirty?.(false)
  }, [dirty, onDirty])

  const colours = useMemo(() => master.data?.colours ?? [], [master.data])
  const colourChoices = useMemo<Choice[]>(
    () => colours.map((one) => ({ value: one.code, label: one.label })),
    [colours]
  )
  const colourNamed = useMemo(
    () => new Map(colours.map((one) => [one.code, one])),
    [colours]
  )

  const divisionChoices = useMemo<Choice[]>(
    () =>
      (vocabulary?.divisions ?? []).map((term) => ({
        value: term.code,
        label: term.label,
      })),
    [vocabulary]
  )
  const tagChoices = useMemo<Choice[]>(
    () =>
      (vocabulary?.tags ?? []).map((term) => ({
        value: term.code,
        label: term.label,
      })),
    [vocabulary]
  )
  /// The division carried from the order line counts only while it is still
  /// offered. One retired since the order was raised (0382 retired all six
  /// original divisions) reads as blank in the picker, and submitting it
  /// anyway would mint a new article under a value nobody on this screen saw
  /// or chose. Nothing here falls back to a default either: no division is
  /// "Choose the division", never the first in the list.
  const divisionChosen =
    division !== "" && divisionChoices.some((one) => one.value === division)

  /// The sizes this company sells, from the size master and in the master's
  /// own order — XS before S before XXL, which is what makes a row of chips a
  /// size run rather than a bag of numbers.
  ///
  /// This used to read the catalogue's facets instead, on the argument that a
  /// size nothing has ever been sold in is a size nobody is about to receive.
  /// What it actually showed was `02 06 04 03`: facets carry the stored code
  /// and there is nowhere in them to find the word for it.
  const sizes = useMemo(() => vocabulary?.sizes ?? [], [vocabulary])
  const sizeChoices = useMemo<Choice[]>(
    () => sizes.map((term) => ({ value: term.code, label: term.label })),
    [sizes]
  )
  /// The grid, in the master's order rather than the order somebody happened
  /// to pick them in.
  const columns = useMemo(
    () =>
      sizes
        .filter((term) => chosenSizes.includes(term.code))
        .map((term) => ({ code: term.code, label: term.label })),
    [sizes, chosenSizes]
  )
  const rows = useMemo(
    () =>
      chosenColours.map((code) => ({
        key: code,
        label: colourNamed.get(code)?.label ?? code,
      })),
    [chosenColours, colourNamed]
  )

  const piecesAt = (colour: string, size: string) =>
    Number(pieces[`${colour}|${size}`]) || 0
  const declared = chosenColours.reduce(
    (sum, colour) =>
      sum + columns.reduce((row, size) => row + piecesAt(colour, size.code), 0),
    0
  )
  const purchaseMinor = receipt.purchase_price_minor
  const baseMinor = digits(pricing.base) ?? 0
  const priceMinor = baseMinor
  const priceAt = (colour: string, size: string) =>
    ownPrice[`${colour}|${size}`] ?? baseMinor
  /// A header pencil's answer: every SKU of that size column or colour row at
  /// one price, or `null` for back to base. A price equal to the base is the
  /// base, so it clears rather than pinning a copy that would stop following
  /// it.
  const priceWhole = (
    head: { axis: "colour" | "size"; key: string },
    price: number | null
  ) => {
    setOwnPrice((was) => {
      const next = { ...was }
      const keys =
        head.axis === "size"
          ? chosenColours.map((colour) => `${colour}|${head.key}`)
          : columns.map((size) => `${head.key}|${size.code}`)
      for (const key of keys) {
        if (price === null || price === baseMinor) delete next[key]
        else next[key] = price
      }
      return next
    })
  }
  /// Every article's pieces, and what they come to together — the counter at
  /// the foot. One tab: the grid's own total, as it always was.
  const sizeOrder = sizes.map((term) => term.code)
  const split = tabs.length > 1
  const tabPieces = tabs.map((one) => piecesIn(one, sizeOrder))
  const allotted = tabPieces.reduce((sum, n) => sum + n, 0)
  const left = receipt.quantity - allotted
  // Every piece the warehouse counted has to end up somewhere. Declaring fewer
  // leaves stock unaccounted; declaring more mints stock that never arrived.
  const balanced = allotted === receipt.quantity
  const over = allotted > receipt.quantity
  /// A colour x size counted into two articles — one garment, one SKU.
  const clashes = split ? findClashes(tabs, sizeOrder) : []
  const sizeLabel = (code: string) =>
    sizes.find((term) => term.code === code)?.label ?? code
  const clashText = (clash: Clash) =>
    `${colourNamed.get(clash.colour)?.label ?? clash.colour} ${sizeLabel(clash.size)} is in ${clash.tabs.map(tabLabel).join(" and ")}. A SKU can be in one article only.`
  const clashHere = clashes.find((clash) => clash.tabs.includes(current))
  /// Every SKU every article will create, at its price: the floor check and
  /// the count beside the button cover them all, not just the open tab.
  const allSkuPrices = tabs.flatMap((one) =>
    filledCells(one, sizeOrder).map(
      (cell) => one.ownPrice[`${cell.colour}|${cell.size}`] ?? baseMinor
    )
  )

  /// How the priced SKUs spread, for the note over the grid: how many carry
  /// their own price, and what the whole range of prices comes to. Mirrors
  /// `priced()` in the approved prototype (view B) exactly, so the sentence
  /// it draws is the one that was signed off.
  const pricedSkus = chosenColours.flatMap((colour) =>
    columns
      .filter((size) => piecesAt(colour, size.code) > 0)
      .map((size) => priceAt(colour, size.code))
  )
  const ownCount = pricedSkus.filter((price) => price !== baseMinor).length
  /// How many SKUs the button will create: only a size and colour with at
  /// least one piece counted. The rest are left out, and the grid says so.
  const skuCount = pricedSkus.length
  /// The purchase price is the floor: a selling price at it or under it is a loss
  /// or a wash. The base price, and any SKU's own price that will be created.
  const baseTooLow =
    baseMinor > 0 && purchaseMinor > 0 && baseMinor <= purchaseMinor
  const ownTooLow =
    purchaseMinor > 0 &&
    allSkuPrices.some((price) => price > 0 && price <= purchaseMinor)
  const priceMin = pricedSkus.length > 0 ? Math.min(...pricedSkus) : baseMinor
  const priceMax = pricedSkus.length > 0 ? Math.max(...pricedSkus) : baseMinor

  /// What is still missing, in the order somebody works down the sheet.
  ///
  /// A disabled button with nothing beside it is a dead end: the form is long
  /// enough that the answer is usually off the top of the panel, and "why can
  /// I not press this" was being answered by scrolling. `null` means ready —
  /// the two cannot drift apart because the button reads this and nothing
  /// else.
  ///
  /// Split into several articles, each tab answers the same questions under
  /// its own name, and a colour x size counted into two of them is refused.
  const variantsMissing = split
    ? (tabs
        .map((one, index) =>
          one.colours.length === 0
            ? `${tabLabel(index)}: say which colours arrived.`
            : one.sizes.length === 0
              ? `${tabLabel(index)}: say which sizes arrived.`
              : tabPieces[index] === 0
                ? `${tabLabel(index)} has no pieces yet.`
                : null
        )
        .find((problem) => problem !== null) ??
      (clashes.length > 0 ? clashText(clashes[0]) : null))
    : chosenColours.length === 0
      ? "Say which colours arrived."
      : chosenSizes.length === 0
        ? "Say which sizes arrived."
        : null
  const balanceMissing = balanced
    ? null
    : over
      ? split
        ? `The articles come to ${count(allotted)} and the warehouse counted ${count(receipt.quantity)}. A session cannot mint stock that did not arrive.`
        : `The grid comes to ${count(declared)} and the warehouse counted ${count(receipt.quantity)}. A session cannot mint stock that did not arrive.`
      : split
        ? `${count(left)} of ${count(receipt.quantity)} pieces not in any article yet.`
        : `${count(receipt.quantity - declared)} of ${count(receipt.quantity)} pieces not in the grid yet.`
  const missing =
    actor === ""
      ? "Nobody is signed in, so there is nobody to record as having set it up."
      : name.trim() === ""
        ? "It needs a name — the one the business will use, not the supplier's."
        : !divisionChosen
          ? "Choose the division it is filed under."
          : (variantsMissing ??
            balanceMissing ??
            (priceMinor === 0
              ? "A base price, so the SKUs are worth something when they are drawn."
              : baseTooLow
                ? `The base price must be above the purchase price, ${money(purchaseMinor)}.`
                : ownTooLow
                  ? `Every SKU price must be above the purchase price, ${money(purchaseMinor)}.`
                  : null))
  const ready = missing === null

  /// One article's colours and variants as the server takes them: its own
  /// digits, in the order its colours were picked, and only the cells with
  /// pieces in them.
  const partOf = (one: ArticleTab): NewSetupPart => ({
    colours: one.colours.map((code, index) => ({
      colour_digit: String(index),
      colour_code: code,
    })),
    variants: filledCells(one, sizeOrder).map((cell) => ({
      colour_digit: String(one.colours.indexOf(cell.colour)),
      size_code: cell.size,
      quantity: cell.quantity,
      // The SKU's own price when the grid gave it one, otherwise the line's
      // base price — the same rule `priceAt` draws the cell with.
      base_price_minor:
        one.ownPrice[`${cell.colour}|${cell.size}`] ?? baseMinor,
    })),
  })

  /// The receipt's `supplier_id` carries the supplier CODE — `SUP02` — which
  /// is the id the warehouse and the order paperwork use. Matched on the code
  /// first and the uuid second, so it reads as a name either way.
  const supplier = (suppliers.data ?? []).find(
    (one) =>
      one.supplier_code.toLowerCase() === receipt.supplier_id.toLowerCase() ||
      one.supplier_code_normalized === receipt.supplier_id.toLowerCase() ||
      one.supplier_id === receipt.supplier_id
  )

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        // The button is disabled, but a form submits on Enter regardless and
        // `disabled` on a control elsewhere cannot stop that.
        if (!ready || busy) return
        const header = {
          receipt_line_id: receipt.receipt_line_id,
          article_name: name.trim(),
          division_code: division,
          tags,
          image_url: receipt.image_url,
          currency: "IDR",
          created_by: actor,
        }
        onSubmit(
          split
            ? {
                kind: "split",
                request: { ...header, articles: tabs.map(partOf) },
              }
            : { kind: "one", request: { ...header, ...partOf(tab) } }
        )
      }}
      // Measured on the sheet, not the window: this panel is 64rem at a desk
      // and the whole glass on a phone.
      className="@container flex flex-col gap-7 [--form-box:2.5rem] min-[100rem]:gap-10 min-[100rem]:[--form-box:2.9375rem]"
    >
      {problem !== null && <Banner tone="bad">{problem}</Banner>}

      {/* Three facts, kept as a group at the left rather than spread across
          sixty rem: they are read as one line about the delivery, and a third
          of a metre between "Supplier" and "Counted" makes them three
          unrelated labels. */}
      <div className="mt-3 flex items-start gap-5">
        {/* The delivery line's own picture, so the form says which goods it is
            about. The card on the rail shows it; the sheet had lost it. */}
        <Thumbnail
          url={lineImage}
          name={receipt.article_name}
          division={receipt.division_code}
          className="size-24 shrink-0 rounded-inner border border-hairline"
        />
        <Facts className="min-w-0 flex-1 gap-x-10 gap-y-6 min-[100rem]:gap-y-9 @2xl:max-w-[48rem] @2xl:grid-cols-2 [&_dd]:mt-1.5 min-[100rem]:[&_dd]:mt-2">
          <Fact term="Supplier">
            {supplier ? supplierDisplayName(supplier) : receipt.supplier_id}
          </Fact>
          <Fact term="Counted">
            {count(receipt.quantity)}{" "}
            {receipt.quantity === 1 ? "piece" : "pieces"}
          </Fact>
        </Facts>
      </div>

      {/* What the article IS, in four fields two to a row.

          They sat under a heading reading "What it is", beside a second column
          headed "What arrived". Both headings are gone on the owner's word of
          2026-09-13, and they were not carrying their weight: the panel is
          titled New articles and the record above says which delivery this is, so
          a heading over the name box was labelling a form with the word
          "form". What replaced them is the only division this form actually
          has — the article, and then the variants it is being split into.

          Two to a row at `@xl`. This form used to have the whole sheet; it now
          shares it with two rails, which leaves it 36.5rem. Every wider
          breakpoint silently drops it to one column and every delivery becomes
          a scroll again — which is exactly what happened twice while this was
          being built, at `@3xl` and then at `@2xl`. Measured, not guessed: the
          pane is what the rails leave of 64rem.

          `items-start` because two of the four carry a hint and two do not: a
          stretched row makes the boxes of the short pair as tall as the text
          under the long one.

          Name spans both columns now, on the owner's word of 2026-09-28: it
          reads on its own line ahead of Division and Tags, and Base price and
          Markup follow as their own row rather than one of the four sharing a
          row with Name by accident of grid order. */}
      <div className="grid items-start gap-5 min-[100rem]:gap-7 @xl:grid-cols-2 @xl:gap-x-8">
        <Field label="Name" required className="@xl:col-span-2">
          <NameInput value={name} onChange={setName} />
        </Field>

        <Field label="Division" required>
          <PickOne
            choices={divisionChoices}
            value={division === "" ? null : division}
            onChange={(next) => setDivision(next ?? "")}
            label="Division"
          />
        </Field>

        <Field label="Tags">
          <PickMany
            choices={tagChoices}
            values={tags}
            onChange={setTags}
            label="Tags"
          />
        </Field>

        <Field
          label="Base Price"
          required
          problem={
            baseTooLow
              ? `Must be above the purchase price, ${money(purchaseMinor)}`
              : undefined
          }
        >
          <Money
            prefix="Rp"
            value={pricing.base}
            onChange={(base) => setPricingField({ base })}
          />
        </Field>

        {/* The purchase price is not a box here — it is the PO line's own
            cost, not a figure this form negotiates — so it rides as the
            aside `<Field>` already has a slot for, and only the markup
            between it and Base price is typed. */}
        <Field
          label="Markup"
          aside={`Purchase price ${money(receipt.purchase_price_minor)}`}
        >
          <span className="relative flex w-full min-w-0 items-center">
            <Input
              aria-label="Markup"
              inputMode="decimal"
              value={pricing.markup}
              className="pr-8 text-right tabular-nums"
              onChange={(event) =>
                setPricingField({ markup: event.target.value })
              }
            />
            <span className="pointer-events-none absolute right-3.5 text-[0.875rem] text-mute">
              %
            </span>
          </span>
        </Field>
      </div>

      <div>
        {/* One delivery line, several sibling articles — the owner's word of
            2026-10-02. The header above is shared; each article is a tab
            holding only its own grid. A single tab is the form it always
            was, so the tabs themselves appear only once there are two. */}
        <SubHead
          aside={
            <span className="inline-flex flex-wrap items-center gap-1">
              <SplitMenu
                tab={tab}
                sizeOrder={sizeOrder}
                room={MAX_ARTICLE_TABS - tabs.length + 1}
                onSplit={applySplit}
              />
              <Button
                variant="quiet"
                type="button"
                className="bg-accent-bg text-accent enabled:hover:bg-accent-bg/70"
                onClick={addTab}
                disabled={tabs.length >= MAX_ARTICLE_TABS}
              >
                <Plus />
                Add article
              </Button>
            </span>
          }
        >
          Variants
        </SubHead>
        {split && (
          <ArticleTabStrip
            tabs={tabs}
            pieces={tabPieces}
            active={current}
            onPick={pickTab}
            onRemove={removeTab}
          />
        )}

        {/* Colour and size, under the one heading with the grid they produce.
            They stood in a column of their own headed "What arrived", which
            filed them as a second kind of fact about the delivery; they are
            not that. A colour and a size are the two halves of a SKU — picking
            them IS declaring which variants exist, and the grid under them is
            the same act finished. Read top to bottom now: which colours, which
            sizes, how many of each. */}
        <div className="mt-3 mb-6 grid items-start gap-5 min-[100rem]:mt-4 min-[100rem]:mb-8 min-[100rem]:gap-7 @xl:grid-cols-2 @xl:gap-x-8">
          {/* No hint under it, on the owner's word of 2026-09-13. The ceiling
              is still enforced — `onChange` refuses the eleventh — and a line
              of small print under every box was three sentences of chrome on a
              form of six fields. */}
          <Field label="Colours" required>
            <PickMany
              choices={colourChoices}
              values={chosenColours}
              // The eleventh is refused here rather than at the server: the
              // ceiling is the shape of the code, not a policy somebody can
              // raise, and a form that takes an answer it cannot save is worse
              // than one that will not take it.
              onChange={(next) =>
                setChosenColours(next.slice(0, COLOURWAY_CEILING))
              }
              label="The Colours That Arrived"
              leading={(code) => (
                <ColourSwatch hex={colourNamed.get(code)?.hex_code ?? null} />
              )}
            />
          </Field>

          {/* The same control as Colours, on the owner's word of 2026-09-13.
              They were fourteen chips — on the argument that a size run reads
              as a run only when it is drawn as one — and beside a picker they
              read as a different KIND of question. They are not: colour and
              size are the two halves of a SKU, answered in the same breath by
              the same person, and one shape for both is what says so. The
              master's order still decides the grid's columns, so XS still
              comes before XXL whatever order they were picked in. */}
          <Field label="Sizes" required>
            <PickMany
              choices={sizeChoices}
              values={chosenSizes}
              onChange={setChosenSizes}
              label="The Sizes That Arrived"
            />
          </Field>
        </div>

        {rows.length === 0 || columns.length === 0 ? (
          <p className="rounded-inner border border-dashed border-hairline-2 px-4 py-7 text-center text-[0.9375rem] text-mute min-[100rem]:py-10">
            Choose the colours and the sizes above, and the grid to count them
            into appears here.
          </p>
        ) : (
          <>
            {/* The note that used to be a bare running total, on the line
                directly over the grid it is about. It now also says how the
                priced SKUs spread — the reason a price sits in the grid at all
                is that most deliveries never touch it, and the one that does
                should be able to tell at a glance without opening every cell.
                The owner's word of 2026-09-28. */}
            <div className="mb-3 flex items-baseline justify-between gap-4 min-[100rem]:mb-4">
              <p className="min-w-0 text-[0.875rem] text-mute">
                {clashHere !== undefined ? (
                  <span className="text-bad">{clashText(clashHere)}</span>
                ) : ownCount > 0 ? (
                  <>
                    <b className="font-medium text-ink">{count(ownCount)}</b> of{" "}
                    {count(pricedSkus.length)} SKUs have their own price
                    {" · "}
                    {priceMin === priceMax
                      ? `Rp ${formatThousands(priceMin)}`
                      : `Rp ${formatThousands(priceMin)} – ${formatThousands(priceMax)}`}
                    {" · markup "}
                    {priceMin === priceMax
                      ? `${skuMarkup(purchaseMinor, priceMin).replace(".", ",")}%`
                      : `${skuMarkup(purchaseMinor, priceMin).replace(".", ",")}% – ${skuMarkup(purchaseMinor, priceMax).replace(".", ",")}%`}
                  </>
                ) : (
                  "Every SKU at base — click a grey price to give that SKU its own"
                )}
              </p>
              <span
                className={cn(
                  "shrink-0 text-[0.875rem] font-medium whitespace-nowrap tabular-nums",
                  over ? "text-bad" : balanced ? "text-ok-fg" : "text-warn-fg"
                )}
              >
                {split
                  ? `${count(declared)} pcs`
                  : `${count(declared)} of ${count(receipt.quantity)}`}
                {" · "}
                {count(skuCount)} {skuCount === 1 ? "SKU" : "SKUs"}
              </span>
            </div>
            <Matrix
              colours={rows}
              sizes={columns}
              columnClass="w-36"
              columnHead={(size) => (
                <span className="group/head inline-flex w-full items-center justify-end">
                  {size.label}
                  <HeadPricePopover
                    name={size.label}
                    purchase={purchaseMinor}
                    base={baseMinor}
                    onApply={(price) =>
                      priceWhole({ axis: "size", key: size.code }, price)
                    }
                  />
                </span>
              )}
              rowHead={(colour) => (
                <span className="group/head flex w-full min-w-0 items-center">
                  <span className="min-w-0 flex-1 truncate text-[0.875rem] font-medium text-ink">
                    {colour.label}
                  </span>
                  <HeadPricePopover
                    name={colour.label}
                    purchase={purchaseMinor}
                    base={baseMinor}
                    onApply={(price) =>
                      priceWhole({ axis: "colour", key: colour.key }, price)
                    }
                  />
                </span>
              )}
              // `group` so the two boxes inside `SkuCell` can answer to this
              // ONE cell being hovered rather than the whole row or column —
              // and `relative` so the markup/live chip anchors to it and not
              // to the table.
              cellProps={() => ({
                className:
                  "group relative h-auto px-2.5 py-2.5 align-top min-[100rem]:px-3 min-[100rem]:py-4",
              })}
              cell={(colour, size) => {
                const key = `${colour.key}|${size.code}`
                const label = `${name.trim() === "" ? "This article" : name.trim()} ${colour.label} ${size.label}`
                return (
                  <SkuCell
                    label={label}
                    quantity={pieces[key] ?? ""}
                    onQuantity={(next) =>
                      setPieces((was) => ({ ...was, [key]: next }))
                    }
                    purchase={purchaseMinor}
                    base={baseMinor}
                    price={priceAt(colour.key, size.code)}
                    own={ownPrice[key] !== undefined}
                    editing={editingPrice?.key === key}
                    editingValue={
                      editingPrice?.key === key ? editingPrice.value : ""
                    }
                    onEditingChange={(value) => setEditingPrice({ key, value })}
                    onStartEdit={() => {
                      const current = ownPrice[key]
                      setEditingPrice({
                        key,
                        value:
                          current !== undefined ? formatThousands(current) : "",
                      })
                    }}
                    onCommit={() => {
                      if (editingPrice === null || editingPrice.key !== key)
                        return
                      const parsed = parseSkuPrice(
                        editingPrice.value,
                        purchaseMinor
                      )
                      setOwnPrice((prev) => {
                        const next = { ...prev }
                        if (parsed === null || parsed === baseMinor)
                          delete next[key]
                        else next[key] = parsed
                        return next
                      })
                      setEditingPrice(null)
                    }}
                    onCancel={() => setEditingPrice(null)}
                  />
                )
              }}
              rowTotal={(colour) =>
                count(
                  columns.reduce(
                    (sum, size) => sum + piecesAt(colour.key, size.code),
                    0
                  )
                )
              }
              columnTotal={(size) =>
                count(
                  chosenColours.reduce(
                    (sum, colour) => sum + piecesAt(colour, size.code),
                    0
                  )
                )
              }
              total={
                <span
                  className={
                    over ? "text-bad" : balanced ? "text-ok-fg" : "text-warn-fg"
                  }
                >
                  {count(declared)}
                </span>
              }
            />
          </>
        )}
      </div>

      {/* The button, and beside it the reason it cannot be pressed.
      
          Only that reason. It used to say what pressing it does when there was
          nothing stopping it — "this mints the article, its SKUs and their
          EPCs, and sends the tagging job to dc-01; the serials are drawn once
          and cannot be drawn back" — which is a paragraph of warehouse
          mechanics under a button somebody presses forty times a morning.
          Gone on the owner's word of 2026-09-13. The half that earns its place
          is the other one: a disabled button with nothing beside it is a dead
          end, and on a form this long the answer is usually off the top of the
          pane.
      
          Stuck to the foot of the pane, for the same reason: the grid alone
          can be ten rows, and the line saying why the button is dead was
          scrolling off the bottom just as somebody went looking for it. */}
      <div className="sticky bottom-0 z-30 -mx-1 mt-4 flex flex-col gap-3 border-t border-hairline bg-canvas px-1 pt-3 pb-2 min-[100rem]:gap-4 min-[100rem]:pt-5 @xl:flex-row @xl:items-center @xl:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          {/* Split, the one number that decides the button: every piece the
              warehouse counted in some article, and none twice. */}
          {split && (
            <p
              className={cn(
                "text-[0.9375rem] font-medium tabular-nums",
                over ? "text-bad" : balanced ? "text-ok-fg" : "text-warn-fg"
              )}
            >
              Allotted {count(allotted)} / {count(receipt.quantity)} pcs
              {" · "}
              {left < 0 ? `${count(-left)} over` : `${count(left)} left`}
            </p>
          )}
          <p
            className={cn(
              "min-w-0 text-[0.9375rem] leading-relaxed",
              over ? "text-bad" : "text-mute"
            )}
          >
            {missing ??
              (split
                ? `${count(tabs.length)} articles · ${count(allSkuPrices.length)} SKUs will be created. A size with no pieces is left out.`
                : `${count(skuCount)} ${skuCount === 1 ? "SKU" : "SKUs"} will be created. A size with no pieces is left out.`)}
          </p>
        </div>
        {/* "Create articles" (was "Add to inventory"), on the owner's word of 2026-09-13. "Set up and
            send to tagging" named the two writes the press performs; this
            names what the press is FOR. The sentence beside it still says what
            actually happens, which is where that detail belongs — a button is
            read in half a second and a warehouse job is not what somebody came
            here to think about. */}
        <Button
          variant="primary"
          type="submit"
          disabled={!ready || busy}
          className="w-full shrink-0 @xl:w-auto @xl:min-w-[13rem]"
        >
          {busy ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </form>
  )
}
