import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Camera, ListChecks, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Money } from "@/components/ui/field"
import { RecordPanel } from "@/components/ui/record-panel"
import { SubHead } from "@/components/ui/rows"
import { PickMany, PickOne, type Choice } from "@/components/ui/pick"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count } from "@/lib/format"
import { asJpeg, PICTURE_TYPES } from "@/lib/image"
import { problemOf } from "@/lib/problem"
import { cn } from "@/lib/utils"
import { colourKeys, listColours } from "@/lib/queries/colours"
import { ColourSwatch } from "@/screens/master/colour-picker"
import {
  articleImage,
  issueSetupSession,
  listSetupSessions,
  listSuppliers,
  procurementKeys,
  setupSessionDetail,
  uploadArticleImage,
  type SetupSession,
  type UnidentifiedReceipt,
  catalogueVocabulary,
  openSetupSession,
  type NewSetupSession,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { useAwaitingIdentity } from "@/screens/procurement/queue"
import type { CatalogueVocabulary } from "@itulah/contract"
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

/// The one panel an article setup is done in: the queue on the left, the work
/// on the right.
///
/// **This was a screen, then three sheets, and it is one panel now.** A setup
/// is not a place in the business — it is something you do to *one delivery*
/// that turned up without an identity — so it is not in the sidebar. But three
/// sheets was one panel too many in the other direction: the queue opened, you
/// picked a row, the queue CLOSED and a form opened, you filled it in and a
/// third sheet opened over that. Three panels to do one thing, and the form —
/// the only part anybody came for — was two clicks away.
///
/// The owner's instruction on 2026-09-13 was the sketch this follows: the
/// deliveries down a rail at the left, the form already open at the right, and
/// nothing opening over anything else. Picking the next delivery is one click
/// and the rail does not move.
///
/// Three keys still, because each is a different thing to be pointed at and a
/// link to any one of them has to work cold — they simply no longer open three
/// different panels:
///
///  - `?setups=true` — the panel, on whatever the queue's first delivery is.
///  - `?receipt=<line>` — the panel, on that delivery's form.
///  - `?setup=<session>` — the panel, on that session's record. It is the link
///    an article's detail follows back to the delivery that minted it, and the
///    only way back to a session that opened and did not mint.
///
/// **"Open sessions" is gone as a tab.** Filling the form in IS issuing, so a
/// session that is still open is a mint that failed rather than a stage of the
/// work, and a tab gave a rare accident equal billing with the queue. The
/// sessions themselves are not gone: they stand under the queue in the rail,
/// under a heading that says what they are. Dropping them would have stranded
/// the one case that needs a person.
export function SetupSheets() {
  const navigate = useNavigate()
  const queue = useSheet("setups")
  /// Which setup session the pane is showing. In the URL, like every sheet.
  const session = useSheet("setup")
  /// Which delivery is being given an identity. A separate key from `setup`:
  /// this line has no session yet, and filling the form is what makes one.
  const chosen = useSheet("receipt")

  /// Which purchase order the rail is showing, or `null` for every one of
  /// them. Not in the URL: it is which part of a queue somebody is looking
  /// through inside an open panel, not a record anybody links to.
  const [po, setPo] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  /// How the last press of "Set up and send to tagging" ended, for the record
  /// the pane hands over to.
  ///
  /// Not in the URL, unlike everything else here, and deliberately: this is
  /// what just happened in front of one person, not a property of the record.
  /// A colleague opening the same session tomorrow reads its status and its
  /// job; they should not be told a mint failed at somebody else's desk this
  /// morning.
  const [handover, setHandover] = useState<Handover | null>(null)

  /// The words a division may be named with. Fetched here rather than in the
  /// form, so moving to the next delivery does not start a request the person
  /// is then waiting on.
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
  })

  /// Both lists are read while the panel is shut, and that is the point: the
  /// trigger on Articles wears the waiting count, and a count that only
  /// arrives once you have opened the thing it is meant to make you open is no
  /// count at all. Same keys the panel itself reads, so opening it costs
  /// nothing.
  const receipts = useAwaitingIdentity()
  const sessions = useQuery({
    queryKey: procurementKeys.setups(),
    queryFn: ({ signal }) => listSetupSessions(signal),
  })

  const waiting = useMemo(() => receipts.data ?? [], [receipts.data])
  /// Sessions that opened and did not mint. Routinely empty: one press does
  /// both writes, and only the second one failing leaves a session here.
  const stalled = useMemo(() => sessions.data ?? [], [sessions.data])
  const pieces = waiting.reduce((sum, row) => sum + row.quantity, 0)

  /// The orders the queue is standing in, with how many deliveries of each.
  ///
  /// Grouped rather than listed flat because a queue is worked through an
  /// order at a time: one delivery turns up as six lines of one PO, and the
  /// person setting them up is holding that order's paperwork.
  const orders = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of waiting)
      counts.set(row.po_number, (counts.get(row.po_number) ?? 0) + 1)
    return [...counts].sort(([a], [b]) => a.localeCompare(b))
  }, [waiting])

  /// The order actually being shown. `po` can name one that has just been
  /// emptied — setting up its last delivery takes it out of the queue — and a
  /// rail filtered to nothing would read as a queue that had gone.
  const here =
    po !== null && orders.some(([number]) => number === po) ? po : null

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

  /// Which delivery the form is for.
  ///
  /// Derived rather than navigated to: the first of the queue stands in until
  /// somebody picks another, so the panel opens with the form already on
  /// screen and the URL stays as short as the person left it. A session on
  /// screen wins — that is a record, not a form, and the two share the pane.
  /// Read out of what the RAIL is showing, not out of the whole queue: narrow
  /// the rail to one order and the delivery that was open may not be in it any
  /// more, and a pane showing a row the list beside it does not have is a pane
  /// that looks broken.
  const active = session.isOpen
    ? null
    : (shown.find((row) => row.receipt_line_id === chosen.value) ??
      shown[0] ??
      null)
  const activeId = active?.receipt_line_id ?? null

  const open = queue.isOpen || session.isOpen || chosen.isOpen

  /// Every key at once, in ONE navigation.
  ///
  /// Three `close()` calls would be three round trips through the router, each
  /// building its search from a `prev` the one before it has already changed —
  /// which is how a panel shuts and comes straight back on the key that lost
  /// the race.
  const point = (next: { setups?: true; setup?: string; receipt?: string }) =>
    navigate({
      to: ".",
      replace: true,
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        setups: next.setups,
        setup: next.setup,
        receipt: next.receipt,
      }),
      viewTransition: false,
    })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && point({})}
      title="New items"
      caption={
        waiting.length === 0
          ? "Every accepted delivery has been given an identity."
          : `${count(waiting.length)} ${waiting.length === 1 ? "delivery" : "deliveries"} · ${count(pieces)} ${pieces === 1 ? "piece" : "pieces"} waiting`
      }
      // Three panes, not a record: which order, which delivery of it, and the
      // form. At `table`'s 64rem the two rails left the form 36rem, which is
      // under every breakpoint its own columns split at — so the form kept
      // collapsing into one column and every delivery became a scroll.
      width="workspace"
    >
      {/* `@container` on the panel body, so the rail and the pane split on how
          much glass this sheet actually got rather than on the window. */}
      <div className="@container">
        {/* Three columns: which order, which delivery of it, and the delivery
            itself.

            The orders were a bordered card sitting on top of the queue in the
            same column, which drew two different kinds of list stacked — one
            boxed, one not — and read as a widget parked above a rail rather
            than as a step before it. They are two steps of one narrowing, so
            they are two rails, told apart by a rule rather than by a box. */}
        <div className="grid items-start gap-6 @3xl:grid-cols-[10.5rem_14rem_minmax(0,1fr)]">
          <aside
            aria-label="Purchase orders"
            className="flex min-w-0 flex-col gap-1 @3xl:sticky @3xl:top-0 @3xl:h-full @3xl:self-start @3xl:border-r @3xl:border-hairline @3xl:pr-5"
          >
            <span className="px-2 pb-1 text-[0.875rem] font-semibold tracking-[0.06em] text-mute uppercase">
              Purchase order
            </span>
            {/* "All" first — it is where somebody starts, and naming it is
                what makes the rest read as a narrowing rather than as the
                whole list. */}
            <RailRow
              label="All"
              tally={waiting.length}
              on={here === null}
              onClick={() => setPo(null)}
            />
            {orders.map(([number, tally]) => (
              <RailRow
                key={number}
                label={number}
                mono
                tally={tally}
                on={here === number}
                onClick={() => setPo(number)}
              />
            ))}
          </aside>

          <aside
            aria-label="Deliveries waiting"
            className="flex min-w-0 flex-col gap-3 @3xl:sticky @3xl:top-0 @3xl:h-full @3xl:self-start @3xl:border-r @3xl:border-hairline @3xl:pr-5"
          >
            {/* The box that sifts THIS list, standing over it.

                It was up in the panel's header beside the close button, which
                is where a screen's own search goes — and this is not the
                screen's search. It narrows one of three panes, and from the
                header it read as though it might be searching the article
                master, the record on the right, or both. */}
            {waiting.length > 0 && (
              <span className="relative block">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-line-ico" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search"
                  aria-label="Search the deliveries waiting"
                  className="h-[2.125rem] w-full rounded-inner border border-hairline-2 bg-canvas pr-2.5 pl-8 text-[0.875rem] text-ink outline-none placeholder:text-body focus:border-accent"
                />
              </span>
            )}

            {/* The queue itself. A delivery is picked out by its name and the
                supplier's code for it — the PO is the rail to the left, so
                repeating it on every row would spend this one's whole width
                on the one thing that does not vary. */}
            <div className="flex min-w-0 flex-col gap-1">
              {shown.length === 0 ? (
                <p className="px-1 py-2 text-[0.875rem] text-mute">
                  {waiting.length === 0
                    ? "Nothing is waiting."
                    : "Nothing here matches that."}
                </p>
              ) : (
                shown.map((row) => (
                  <button
                    key={row.receipt_line_id}
                    type="button"
                    onClick={() =>
                      point({ setups: true, receipt: row.receipt_line_id })
                    }
                    aria-current={row.receipt_line_id === activeId}
                    className={cn(
                      "flex min-w-0 flex-col gap-0.5 rounded-inner border px-2.5 py-2 text-left transition-colors",
                      row.receipt_line_id === activeId
                        ? "border-accent/40 bg-accent-bg"
                        : "border-transparent hover:bg-soft-2"
                    )}
                  >
                    <span className="truncate text-[0.875rem] font-medium text-ink">
                      {row.article_name}
                    </span>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-mono text-[0.875rem] text-mute">
                        {row.supplier_article_code}
                      </span>
                      <span className="shrink-0 text-[0.875rem] text-body tabular-nums">
                        {count(row.quantity)}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>

            {/* The accidents, under the work. A session that is still open is
                a mint that did not run: the delivery has its identity and is
                out of the queue above, and nothing but a person pressing the
                button on its record will finish it. */}
            {stalled.length > 0 && (
              <div className="flex min-w-0 flex-col gap-1 border-t border-hairline pt-3">
                <span className="px-1 pb-0.5 text-[0.875rem] font-semibold tracking-[0.06em] text-warn-fg uppercase">
                  Not minted
                </span>
                {stalled.map((row) => (
                  <button
                    key={row.session_id}
                    type="button"
                    onClick={() =>
                      point({ setups: true, setup: row.session_id })
                    }
                    aria-current={row.session_id === session.value}
                    className={cn(
                      "flex min-w-0 flex-col gap-0.5 rounded-inner border px-2.5 py-2 text-left transition-colors",
                      row.session_id === session.value
                        ? "border-accent/40 bg-accent-bg"
                        : "border-transparent hover:bg-soft-2"
                    )}
                  >
                    <span className="truncate text-[0.875rem] font-medium text-ink">
                      {row.article_name}
                    </span>
                    <span className="truncate font-mono text-[0.875rem] text-mute">
                      {row.article_code}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <section className="min-w-0">
            {session.value !== undefined ? (
              <SessionRecord
                id={session.value}
                // Only for the session the press actually made: opening a
                // different one from the rail is a different question, and it
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
                onDone={(outcome) => {
                  setHandover({
                    session_id: outcome.session.session_id,
                    problem:
                      outcome.kind === "stalled" ? outcome.problem : null,
                    job: outcome.session.tagging_job_id ?? null,
                  })
                  // Straight to the record the press made, either way, in the
                  // same pane. It is what the press DID — the article code,
                  // the SKUs and the serial ranges their tags were drawn from
                  // — and when the mint did not run it is also where it is run
                  // again.
                  point({ setups: true, setup: outcome.session.session_id })
                }}
              />
            ) : (
              <EmptyState>
                {receipts.isPending
                  ? "Reading the queue…"
                  : "Every accepted delivery has been given an identity. Nothing is waiting to be named."}
              </EmptyState>
            )}
          </section>
        </div>
      </div>
    </Sheet>
  )
}

/// One row of the order card: what it is, how many are under it, and whether
/// the rail is standing on it.
function RailRow({
  label,
  tally,
  on,
  mono,
  onClick,
}: {
  label: string
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
      // The rail is nine and a half rem and an order number is sixteen
      // characters, so the longest of them lose their tail. The whole of it is
      // here for anybody who needs to read it off.
      title={label}
      className={cn(
        "flex min-h-8 w-full items-center gap-2 rounded-inner px-2 text-left transition-colors",
        on ? "bg-soft-2 text-ink" : "text-text hover:bg-soft-2"
      )}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[0.875rem]",
          mono && "font-mono text-id",
          on && "font-medium"
        )}
      >
        {label}
      </span>
      <span className="shrink-0 text-[0.875rem] text-mute tabular-nums">
        {count(tally)}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------

/// One colourway of one article, as a row of the grid below.
interface MatrixColour {
  /// What the caller keys this row by — a colour code before the SKUs exist,
  /// a colour digit afterwards. Never drawn: a row says "Biru", because that
  /// is the word somebody holding the garment would use.
  readonly key: string
  readonly label: string
}

/// One size, as a column of it.
interface MatrixSize {
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
function Matrix({
  colours,
  sizes,
  columnClass = "w-[5.5rem]",
  cell,
  rowTotal,
  columnTotal,
  total,
}: {
  readonly colours: readonly MatrixColour[]
  readonly sizes: readonly MatrixSize[]
  /// How wide one size column is. A cell holding a number box needs less room
  /// than one holding a minted SKU's serial range.
  readonly columnClass?: string
  readonly cell: (colour: MatrixColour, size: MatrixSize) => React.ReactNode
  readonly rowTotal: (colour: MatrixColour) => React.ReactNode
  readonly columnTotal: (size: MatrixSize) => React.ReactNode
  readonly total: React.ReactNode
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
          <col className="w-[5.5rem]" />
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
                {size.label}
              </th>
            ))}
            <th
              scope="col"
              className="h-9 border-b border-l border-hairline bg-canvas px-3 text-right text-cell font-medium text-ink"
            >
              All
            </th>
          </tr>
        </thead>

        <tbody>
          {colours.map((colour) => (
            <tr key={colour.key}>
              <th
                scope="row"
                className="sticky left-0 z-10 border-t border-r border-hairline bg-canvas px-3 py-1.5 text-left font-normal"
              >
                <span className="block truncate text-[0.875rem] font-medium text-ink">
                  {colour.label}
                </span>
              </th>
              {sizes.map((size, at) => (
                <td
                  key={size.code}
                  className={cn(
                    "h-9 border-t border-hairline px-2 text-right align-middle tabular-nums",
                    at > 0 && "border-l"
                  )}
                >
                  {cell(colour, size)}
                </td>
              ))}
              <td className="h-9 border-t border-l border-hairline px-3 text-right text-[0.875rem] font-medium text-ink tabular-nums">
                {rowTotal(colour)}
              </td>
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr>
            <th
              scope="row"
              className="sticky left-0 z-10 h-9 border-t border-r border-hairline bg-soft-2 px-3 text-left text-cell font-normal text-body"
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
                {columnTotal(size)}
              </td>
            ))}
            <td className="h-9 border-t border-l border-hairline bg-soft-2 px-3 text-right text-[0.875rem] font-semibold text-ink tabular-nums">
              {total}
            </td>
          </tr>
        </tfoot>
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
  const supplierName = (code: string) =>
    (suppliers.data ?? []).find(
      (one) =>
        one.supplier_code.toLowerCase() === code.toLowerCase() ||
        one.supplier_id === code
    )?.name ?? code

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

            {/* Four facts of the errand became four of the ARTICLE, in the
                order the owner fixed on 2026-09-13: who sent it, what it is
                filed under, what it will be found by, and what we call it.

                Who keyed it in, when it was opened, which door it came through
                and what the supplier calls it are gone — they are facts about
                the errand, and this is a record of a product. The code comes
                last because it is the one nobody reads first: it is what you
                copy into something else once you have found the thing. */}
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
                {session.tags.length === 0 ? (
                  "—"
                ) : (
                  <span className="flex flex-wrap gap-1.5">
                    {session.tags.map((tag) => (
                      <Tag key={tag}>
                        {termLabel(vocabulary.data?.tags, tag)}
                      </Tag>
                    ))}
                  </span>
                )}
              </Fact>
              <Fact term="Article code">
                <span className="font-mono text-id">
                  {session.article_code}
                </span>
              </Fact>
            </Facts>

            {/* What was minted, one row per SKU.

                It was the colour x size grid the form is filled in on, and a
                grid is the wrong shape here. That grid exists to be COUNTED
                INTO — every cell a box, the totals checking against the
                delivery — and once the numbers are drawn the question changes
                from "how do these split" to "what exists now": a SKU code, the
                thing it names, and how many. None of those fit in a cell, and
                the first two were not on the screen at all.

                The serial ranges went with the grid, on the owner's word of
                2026-09-13: `1–60` is the numbering the DC's tags were drawn
                from, which is a fact about a print run rather than about the
                product, and this record is about the product. It is still on
                the tagging job, where somebody chasing a tag will look. */}
            <div>
              {/* Not a `<SubHead>`. That is 15px semibold and the article's
                  name two rows above it is 17px, so the word "Variants" was
                  shouting as loudly as the thing it belongs to — on a record
                  with one heading in it, which needs no shout at all. This is
                  the weight a label over a table wants: present, and plainly
                  subordinate to the name. */}
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h4 className="text-[0.875rem] font-medium text-body">
                  Variants
                </h4>
                {session.variants.length > 0 && (
                  <span className="text-[0.875rem] text-mute tabular-nums">
                    {count(session.variants.length)}{" "}
                    {session.variants.length === 1 ? "SKU" : "SKUs"}
                  </span>
                )}
              </div>
              {session.variants.length === 0 ? (
                <p className="text-meta text-mute">
                  Nothing has been minted yet. Issuing the session draws the
                  SKUs, their serial ranges and their EPCs in one transaction.
                </p>
              ) : (
                <div className="overflow-hidden rounded-inner border border-hairline">
                  <table className="w-full border-separate border-spacing-0 text-cell">
                    <thead>
                      <tr>
                        <th
                          scope="col"
                          className="h-9 border-b border-hairline px-3 text-left text-cell font-normal text-body"
                        >
                          Article
                        </th>
                        <th
                          scope="col"
                          className="h-9 border-b border-l border-hairline px-3 text-left text-cell font-normal text-body"
                        >
                          SKU
                        </th>
                        <th
                          scope="col"
                          className="h-9 w-[6rem] border-b border-l border-hairline px-3 text-right text-cell font-normal text-body"
                        >
                          Pieces
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {session.variants.map((variant, at) => {
                        // The photograph is a fact about the COLOURWAY, so it
                        // is drawn once per colour rather than once per SKU —
                        // every size of the red shirt is the red shirt. The
                        // server orders by SKU code and a SKU begins with the
                        // colour digit, so a colour's sizes are contiguous.
                        const opens =
                          at === 0 ||
                          session.variants[at - 1].colour_digit !==
                            variant.colour_digit
                        return (
                          <tr key={variant.sku_code}>
                            <td className="border-t border-hairline px-3 py-1.5">
                              <span className="flex min-w-0 items-center gap-2.5">
                                {opens ? (
                                  <ColourwayPhoto
                                    articleCode={session.article_code}
                                    digit={variant.colour_digit}
                                    label={variant.colour_label}
                                    url={
                                      photographOf.get(variant.colour_digit) ??
                                      null
                                    }
                                  />
                                ) : (
                                  <span
                                    aria-hidden
                                    className="size-9 shrink-0"
                                  />
                                )}
                                {/* The SKU said the way somebody holding the
                                    garment would say it: what it is, what
                                    colour, what size. The article's name is
                                    repeated down the column on purpose — a
                                    variant is not "White M", it is a white
                                    medium OF something, and this table is
                                    read a row at a time. */}
                                <span className="min-w-0 truncate text-[0.875rem] text-ink">
                                  {session.article_name} {variant.colour_label}{" "}
                                  {variant.size_label}
                                </span>
                              </span>
                            </td>
                            <td className="border-t border-l border-hairline px-3 py-1.5 font-mono text-id text-body">
                              {variant.sku_code}
                            </td>
                            <td className="border-t border-l border-hairline px-3 py-1.5 text-right text-[0.875rem] font-medium text-ink tabular-nums">
                              {count(variant.quantity)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="border-t border-hairline bg-soft-2 px-3 py-2 text-cell text-body">
                          All
                        </td>
                        <td className="border-t border-l border-hairline bg-soft-2 px-3 py-2" />
                        <td className="border-t border-l border-hairline bg-soft-2 px-3 py-2 text-right text-[0.875rem] font-semibold text-ink tabular-nums">
                          {count(
                            session.variants.reduce(
                              (sum, one) => sum + one.quantity,
                              0
                            )
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
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
                  {mine && issue.isPending ? "Adding…" : "Add to inventory"}
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
}: {
  articleCode: string
  digit: string
  label: string
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
        "relative grid size-9 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-inner border transition-colors",
        upload.isError
          ? "border-bad"
          : "border-hairline-2 hover:border-hairline-strong",
        url ? "border-hairline" : "bg-soft-2"
      )}
    >
      {url ? (
        <img src={url} alt={colourLabel} className="size-full object-cover" />
      ) : (
        // A camera and not the colour digit. The digit is half of a SKU
        // number nobody says out loud, and what this control does is take a
        // photograph.
        <Camera className="size-3.5 text-line-ico" />
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
}: {
  receipt: UnidentifiedReceipt
  vocabulary?: CatalogueVocabulary
  onDone: (outcome: SetupOutcome) => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const idempotency = useIdempotencyKey()

  /// One press, two writes: save the identity, then mint against it.
  ///
  /// The mint is not retried here and not rolled back either — neither is
  /// available. A session cannot be un-opened, and a retry from a form the
  /// person is watching would either mint twice or look like it had. What it
  /// does instead is stop being an error: the caller is handed the session, is
  /// told the mint did not run and why, and the sheet that opens on it is the
  /// one with the button that runs it.
  const setUp = useMutation({
    mutationFn: async (request: NewSetupSession): Promise<SetupOutcome> => {
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
      // The queue this line was in and the sessions it passed through, in one
      // call: `setups()` is a prefix of the unidentified queue's key, and a
      // receipt that has been worked out leaves both lists at once.
      void client.invalidateQueries({ queryKey: procurementKeys.setups() })
      // Rotated on both outcomes, because nothing retries from here: the sheet
      // closes either way, and a stalled session is minted again from its own
      // sheet under its own key. Holding this one would only carry a spent key
      // into the NEXT delivery's mint.
      idempotency.rotate()
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
      onSubmit={(request) => setUp.mutate(request)}
    />
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
}: {
  receipt: UnidentifiedReceipt
  vocabulary?: CatalogueVocabulary
  actor: string
  problem: string | null
  busy: boolean
  onSubmit: (request: NewSetupSession) => void
}) {
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
  const [chosenColours, setChosenColours] = useState<readonly string[]>([])
  const [chosenSizes, setChosenSizes] = useState<readonly string[]>([])
  /// Keyed `colour|size` by CODE, not by digit: a colour dropped and picked
  /// back up — which happens constantly while somebody works out what arrived
  /// — would otherwise come back as a different digit and lose its counts.
  const [pieces, setPieces] = useState<Record<string, string>>({})
  const [price, setPrice] = useState("")
  const [name, setName] = useState(receipt.article_name)
  const [division, setDivision] = useState(receipt.division_code ?? "")
  /// What the buyer already filed it under. Editable, because the buyer was
  /// describing an order line and this is the article the company will keep.
  const [tags, setTags] = useState<readonly string[]>(receipt.tags)

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
  const priceMinor = Number(price.replace(/[^\d]/g, "")) || 0
  // Every piece the warehouse counted has to end up somewhere. Declaring fewer
  // leaves stock unaccounted; declaring more mints stock that never arrived.
  const balanced = declared === receipt.quantity
  const over = declared > receipt.quantity

  /// What is still missing, in the order somebody works down the sheet.
  ///
  /// A disabled button with nothing beside it is a dead end: the form is long
  /// enough that the answer is usually off the top of the panel, and "why can
  /// I not press this" was being answered by scrolling. `null` means ready —
  /// the two cannot drift apart because the button reads this and nothing
  /// else.
  const missing =
    actor === ""
      ? "Nobody is signed in, so there is nobody to record as having set it up."
      : name.trim() === ""
        ? "It needs a name — the one the business will use, not the supplier's."
        : !divisionChosen
          ? "Choose the division it is filed under."
          : chosenColours.length === 0
            ? "Say which colours arrived."
            : chosenSizes.length === 0
              ? "Say which sizes arrived."
              : !balanced
                ? over
                  ? `The grid comes to ${count(declared)} and the warehouse counted ${count(receipt.quantity)}. A session cannot mint stock that did not arrive.`
                  : `${count(receipt.quantity - declared)} of the ${count(receipt.quantity)} pieces counted are not in the grid yet — every one of them has to end up somewhere.`
                : priceMinor === 0
                  ? "A base price, so the SKUs are worth something when they are drawn."
                  : null
  const ready = missing === null

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
        onSubmit({
          receipt_line_id: receipt.receipt_line_id,
          article_name: name.trim(),
          division_code: division,
          tags,
          image_url: receipt.image_url,
          currency: "IDR",
          colours: chosenColours.map((code, index) => ({
            colour_digit: String(index),
            colour_code: code,
          })),
          variants: chosenColours.flatMap((colour, index) =>
            columns
              .filter((size) => piecesAt(colour, size.code) > 0)
              .map((size) => ({
                colour_digit: String(index),
                size_code: size.code,
                quantity: piecesAt(colour, size.code),
                base_price_minor: priceMinor,
              }))
          ),
          created_by: actor,
        })
      }}
      // Measured on the sheet, not the window: this panel is 64rem at a desk
      // and the whole glass on a phone.
      className="@container flex flex-col gap-6"
    >
      {problem !== null && <Banner tone="bad">{problem}</Banner>}

      {/* Three facts, kept as a group at the left rather than spread across
          sixty rem: they are read as one line about the delivery, and a third
          of a metre between "Supplier" and "Counted" makes them three
          unrelated labels. */}
      <Facts className="@2xl:max-w-[44rem] @2xl:grid-cols-3">
        <Fact term="Delivery">{receipt.receipt_number}</Fact>
        <Fact term="Supplier">{supplier?.name ?? receipt.supplier_id}</Fact>
        <Fact term="Counted">
          {count(receipt.quantity)}{" "}
          {receipt.quantity === 1 ? "piece" : "pieces"}
        </Fact>
      </Facts>

      {/* What the article IS, in four fields two to a row.

          They sat under a heading reading "What it is", beside a second column
          headed "What arrived". Both headings are gone on the owner's word of
          2026-09-13, and they were not carrying their weight: the panel is
          titled New items and the record above says which delivery this is, so
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
          under the long one. */}
      <div className="grid items-start gap-5 @xl:grid-cols-2 @xl:gap-x-6">
        <Field label="Name" required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field label="Division" required>
          <PickOne
            choices={divisionChoices}
            value={division === "" ? null : division}
            onChange={(next) => setDivision(next ?? "")}
            placeholder="Choose a division…"
            label="Division"
          />
        </Field>

        <Field label="Tags">
          <PickMany
            choices={tagChoices}
            values={tags}
            onChange={setTags}
            placeholder="None"
            label="Tags"
          />
        </Field>

        <Field label="Base price" required>
          <Money value={price} onChange={setPrice} placeholder="31.000" />
        </Field>
      </div>

      <div>
        <SubHead>Variants</SubHead>

        {/* Colour and size, under the one heading with the grid they produce.
            They stood in a column of their own headed "What arrived", which
            filed them as a second kind of fact about the delivery; they are
            not that. A colour and a size are the two halves of a SKU — picking
            them IS declaring which variants exist, and the grid under them is
            the same act finished. Read top to bottom now: which colours, which
            sizes, how many of each. */}
        <div className="mb-5 grid items-start gap-5 @xl:grid-cols-2 @xl:gap-x-6">
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
              placeholder={
                master.isPending
                  ? "Reading the colour master…"
                  : "Search a colour"
              }
              label="The colours that arrived"
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
              placeholder={
                sizes.length === 0
                  ? "Reading the size master…"
                  : "Search a size"
              }
              label="The sizes that arrived"
            />
          </Field>
        </div>

        {rows.length === 0 || columns.length === 0 ? (
          <p className="rounded-inner border border-dashed border-hairline-2 px-3.5 py-6 text-center text-[0.875rem] text-mute">
            Choose the colours and the sizes above, and the grid to count them
            into appears here.
          </p>
        ) : (
          <>
            {/* How much of the delivery is in the grid, on the line directly
                over it. It rode on the "Variants" heading, which is two
                controls further up — a running total belongs against the thing
                it is counting, not against the heading of the section that
                thing happens to be in. */}
            <p
              className={cn(
                "mb-1.5 text-right text-[0.875rem] font-medium tabular-nums",
                over ? "text-bad" : balanced ? "text-ok-fg" : "text-warn-fg"
              )}
            >
              {count(declared)} of {count(receipt.quantity)}
            </p>
            <Matrix
              colours={rows}
              sizes={columns}
              columnClass="w-[5.25rem]"
              cell={(colour, size) => (
                <Input
                  inputMode="numeric"
                  // The whole SKU, in words, for anybody who cannot see the row
                  // and the column this box is sitting in: "Kemeja Biru XL".
                  aria-label={`${name.trim() === "" ? "This article" : name.trim()} ${colour.label} ${size.label}`}
                  placeholder="0"
                  value={pieces[`${colour.key}|${size.code}`] ?? ""}
                  onChange={(event) =>
                    setPieces((was) => ({
                      ...was,
                      [`${colour.key}|${size.code}`]: event.target.value,
                    }))
                  }
                  // Flat inside the grid, and square: twenty rounded boxes in a
                  // table read as twenty controls, and what this is is one table
                  // somebody is filling in. The fill arrives on hover and focus,
                  // so the cell still says it can be typed into — and it now
                  // stops at the column rule instead of meeting the fill of the
                  // cell beside it, which drew two pills jammed together.
                  //
                  // The negative margin is what puts the figures in a COLUMN.
                  // A box with its own padding sitting inside a padded cell
                  // stands its digits 16px off the column's right edge while
                  // the totals under them stand at 8 — and a grid of numbers
                  // that do not line up is not a grid of numbers. So the box
                  // spans the cell edge to edge and carries the cell's padding
                  // itself: one 8px gap, the same one the totals and the
                  // headers use.
                  // `border-0` for the last pixel: the field's transparent
                  // hairline sits INSIDE the box, so its text edge stood one
                  // pixel short of the totals under it — invisible at 1x and
                  // plain as day on a retina screen.
                  className="-mx-2 h-8 w-[calc(100%+1rem)] rounded-none border-0 bg-transparent px-2 text-right hover:bg-soft-2 focus:bg-soft-2"
                />
              )}
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
      <div className="sticky bottom-0 -mx-1 flex flex-col gap-3 border-t border-hairline bg-canvas px-1 pt-4 pb-1 @xl:flex-row @xl:items-center @xl:justify-between">
        <p
          className={cn(
            "min-w-0 text-[0.875rem] leading-relaxed",
            over ? "text-bad" : "text-mute"
          )}
        >
          {missing}
        </p>
        {/* "Add to inventory", on the owner's word of 2026-09-13. "Set up and
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
          {busy ? "Adding…" : "Add to inventory"}
        </Button>
      </div>
    </form>
  )
}

/// The way into the queue, and the count that argues for it.
///
/// It stood on Purchase orders until 2026-09-13, and before that on Articles;
/// the owner has moved it back to Articles, where a delivery under no article
/// is a gap in the CATALOGUE rather than a step of a purchase. The trigger and
/// the sheets travel together — a button whose sheets are mounted on another
/// screen opens nothing.

/// The way into a setup, and the count that makes it worth pressing.
///
/// A trigger and not a menu row: a setup is done to one delivery, so what this
/// opens is a queue to pick from. The number is the whole argument for the
/// button — the word alone says a thing exists, while "3" says three
/// deliveries are sitting in the warehouse under a code nobody can sell
/// against. Nothing is drawn while the count is unknown, and the button goes
/// quiet rather than away at zero: it is still how you reach the sessions
/// already open.
///
/// **"New items", not "Set up deliveries"** — the owner's word on 2026-09-13.
/// It reads as what comes OUT of the queue rather than as the errand: standing
/// on the article master, what is waiting is new items to be named, and
/// "deliveries" named the carton they arrived in.
///
/// The primary button on this page, and the only one. It is what somebody came
/// to Articles to DO when the count is not zero; `soft` filed it with the
/// chrome and left the screen with nothing to press.
export function SetupTrigger() {
  const queue = useSheet("setups")
  const waiting = useAwaitingIdentity()
  const pending = waiting.data?.length ?? 0

  return (
    <Button variant="primary" onClick={() => queue.open(true)}>
      <ListChecks className="size-4 stroke-[1.7]" />
      New items
      {pending > 0 && (
        // On the fill rather than beside it: a warm pill on a blue button is
        // two statuses arguing. Glass over the button's own colour keeps the
        // count legible and keeps the button one thing.
        <span className="ml-0.5 rounded-full bg-on-dark/20 px-[0.375rem] py-px text-[0.875rem] font-semibold text-cta-fg tabular-nums">
          {count(pending)}
        </span>
      )}
    </Button>
  )
}
