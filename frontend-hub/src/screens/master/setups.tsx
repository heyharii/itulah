import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Money } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Pill } from "@/components/ui/pill"
import { SubHead, TotalsLadder } from "@/components/ui/rows"
import { PickMany, PickOne, type Choice } from "@/components/ui/pick"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Lifecycle } from "@/components/ui/timeline"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, day, label, money, moment, toneFor } from "@/lib/format"
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
  type SetupSessionRow,
  type SetupVariant,
  type UnidentifiedReceipt,
  catalogueVocabulary,
  openSetupSession,
  type NewSetupSession,
} from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { useAwaitingIdentity } from "@/screens/master/queue"
import type { CatalogueVocabulary } from "@itulah/contract"
import { tableSetup, type TableSetup } from "@/lib/table"
import {
  toggle,
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

const receiptColumns: ColumnDef<TableSetup, UnidentifiedReceipt>[] = [
  {
    accessorKey: "po_number",
    header: "PO",
    size: 130,
    meta: { mono: true, card: "id" },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.po_number}
      </span>
    ),
  },
  {
    accessorKey: "article_name",
    header: "What the buyer wrote",
    size: 260,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span className="font-medium text-ink">
          {row.original.article_name}
        </span>
        <span className="font-mono text-[0.65625rem] text-mute">
          {row.original.supplier_article_code}
        </span>
      </span>
    ),
  },
  {
    accessorKey: "division_code",
    header: "Filed under",
    size: 140,
    // Context: which shelf of the catalogue it will end up on. First to go
    // when the columns do not fit, because nobody picks the next delivery to
    // work out by its division.
    meta: { priority: 3, card: "meta" },
    cell: ({ row }) =>
      row.original.division_code === null ? (
        <span className="text-mute">Unclassified</span>
      ) : (
        <Tag>{row.original.division_code}</Tag>
      ),
  },
  {
    accessorKey: "site_id",
    header: "Landed at",
    size: 130,
    meta: { priority: 3, card: "meta" },
  },
  {
    accessorKey: "quantity",
    header: "Pieces",
    size: 100,
    meta: { align: "right", priority: 2, card: "metric" },
    cell: ({ row }) => count(row.original.quantity),
  },
  {
    accessorKey: "verified_at",
    header: "Accepted",
    size: 160,
    // The decision metric, sorted oldest first: a delivery sitting without an
    // identity is stock in a warehouse that nothing can sell. A 1, therefore:
    // it is never dropped to make room.
    meta: { card: "meta" },
    cell: ({ row }) => moment(row.original.verified_at),
  },
]

const sessionColumns: ColumnDef<TableSetup, SetupSessionRow>[] = [
  {
    accessorKey: "article_code",
    header: "Article",
    size: 130,
    meta: { mono: true, card: "id" },
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.article_code}
      </span>
    ),
  },
  {
    accessorKey: "article_name",
    header: "Name",
    size: 250,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.article_name}</span>
    ),
  },
  {
    accessorKey: "division_code",
    header: "Division",
    size: 130,
    meta: { priority: 3, card: "meta" },
    cell: ({ row }) => <Tag>{row.original.division_code}</Tag>,
  },
  {
    accessorKey: "receipt_quantity",
    header: "Received",
    size: 110,
    meta: { align: "right", priority: 2, card: "metric" },
    cell: ({ row }) => count(row.original.receipt_quantity),
  },
  {
    accessorKey: "declared_quantity",
    header: "Split out",
    size: 110,
    meta: { align: "right", priority: 2, card: "metric" },
    cell: ({ row }) => count(row.original.declared_quantity),
  },
  {
    id: "undeclared",
    accessorFn: (row) => row.receipt_quantity - row.declared_quantity,
    header: "Unaccounted",
    size: 130,
    meta: { align: "right", card: "metric" },
    // The decision metric and the default sort: a session whose variants do not
    // add up to what arrived is not finished, and it cannot be issued.
    cell: ({ row }) => {
      const gap = row.original.receipt_quantity - row.original.declared_quantity
      return (
        <span className={gap > 0 ? "font-medium text-warn-fg" : "text-mute"}>
          {count(gap)}
        </span>
      )
    },
  },
  {
    accessorKey: "created_at",
    header: "Opened",
    size: 130,
    meta: { priority: 3, card: "meta" },
    cell: ({ row }) => day(row.original.created_at),
  },
]

/// The three sheets an article setup is done through, mounted once by the
/// Articles screen.
///
/// **This was a screen, and it is deliberately not one any more.** A setup is
/// not a place in the business — it is something you do to *one delivery* that
/// turned up without an identity, and the list of those deliveries is a queue
/// rather than a department. So the sidebar lost the row and Articles grew a
/// trigger: the master product is what a setup produces, so the queue belongs
/// over the master product. It follows `cart` in `lib/sheets.ts`, which stopped
/// being a menu entry for the same reason.
///
/// Three keys, three moments, each opening on its own so a link to any one of
/// them works cold:
///
///  - `?setups=true` — the queue. Which delivery?
///  - `?receipt=<line>` — that delivery, being told what it is. No session yet.
///  - `?setup=<session>` — the session that answer made: what was minted, and
///    where the tagging job went. It is also the only way back to a session
///    that opened and did not mint, so it stays reachable for one that is open
///    and unissued even though nothing routine leaves a session in that state
///    any more.
///
/// One panel at a time: picking a delivery closes the queue as it opens the
/// next sheet. Stacked panels would leave two lists arguing about which is on
/// top, and the queue has nothing left to say once a row has been chosen.
export function SetupSheets() {
  const [tab, setTab] = useState("waiting")
  const [query, setQuery] = useState("")
  const queue = useSheet("setups")
  // Which setup session is open lives in the URL, like every other sheet.
  const session = useSheet("setup")
  /// Which delivery is being given an identity. A separate key from `setup`:
  /// this line has no session yet, and opening one is what the sheet does.
  const waiting_ = useSheet("receipt")

  /// How the last press of "Set up and send to tagging" ended, for the session
  /// sheet it hands over to.
  ///
  /// Not in the URL, unlike everything else here, and deliberately: this is
  /// what just happened in front of one person, not a property of the record.
  /// A colleague opening the same session tomorrow reads its status and its
  /// job; they should not be told a mint failed at somebody else's desk this
  /// morning. It lives here rather than in the composer because the composer
  /// closes as it hands over — a banner on a sheet that is going away is a
  /// banner nobody reads.
  const [handover, setHandover] = useState<Handover | null>(null)

  /// The words a division may be named with. Needed only by the composer, but
  /// fetched here so opening the sheet does not start a request the person is
  /// then waiting on.
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
  })
  const [waitingSort, setWaitingSort] = useState<SortingState>([
    { id: "verified_at", desc: false },
  ])
  const [sessionSort, setSessionSort] = useState<SortingState>([
    { id: "undeclared", desc: true },
  ])

  /// Both lists are read while the queue is shut, and that is the point: the
  /// trigger on Articles wears the waiting count, and a count that only
  /// arrives once you have opened the thing it is meant to make you open is
  /// no count at all. Same keys the queue itself reads, so opening it costs
  /// nothing.
  const receipts = useAwaitingIdentity()

  const sessions = useQuery({
    queryKey: procurementKeys.setups(),
    queryFn: ({ signal }) => listSetupSessions(signal),
  })

  const waiting = useMemo(() => receipts.data ?? [], [receipts.data])
  const open = useMemo(() => sessions.data ?? [], [sessions.data])
  const pieces = waiting.reduce((sum, row) => sum + row.quantity, 0)
  const unaccounted = open.reduce(
    (sum, row) => sum + (row.receipt_quantity - row.declared_quantity),
    0
  )

  const receiptTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: waiting,
        columns: receiptColumns,
        getRowId: (row: UnidentifiedReceipt) => row.receipt_line_id,
        state: { globalFilter: query, sorting: waitingSort },
        onSortingChange: setWaitingSort,
        onGlobalFilterChange: setQuery,
      }),
      [waiting, query, waitingSort]
    )
  )

  const sessionTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: open,
        columns: sessionColumns,
        getRowId: (row: SetupSessionRow) => row.session_id,
        state: { globalFilter: query, sorting: sessionSort },
        onSortingChange: setSessionSort,
        onGlobalFilterChange: setQuery,
      }),
      [open, query, sessionSort]
    )
  )

  return (
    <>
      <Sheet
        open={queue.isOpen}
        onOpenChange={(next) => {
          if (!next) queue.close()
        }}
        title="Article setups"
        // A queue of deliveries, not a record: two tables of six columns, and
        // a delivery line is only identifiable by several of them at once.
        // This asked for the room in `className` for a while and never got it
        // — see the note on `width` in `<Sheet>` — and read as a rail with its
        // columns sliding out of sight to the right.
        width="table"
        actions={
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Article, PO or name"
            className="h-8 w-52"
          />
        }
      >
        {/* Four figures, four columns — not the six-wide default, which left
            these four squeezed into two thirds of the strip with their labels
            wrapping to four lines each. */}
        <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
          <Kpi
            label="Deliveries without an identity"
            value={count(waiting.length)}
          />
          <Kpi label="Pieces waiting" value={count(pieces)} />
          <Kpi label="Sessions open" value={count(open.length)} />
          <Kpi label="Pieces not split out" value={count(unaccounted)} />
        </KpiStrip>

        <SubTabs
          className="mt-4"
          tabs={[
            {
              value: "waiting",
              label: `Awaiting identity (${waiting.length})`,
            },
            { value: "sessions", label: `Open sessions (${open.length})` },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "waiting" ? (
          <Card className="overflow-hidden">
            {queryState(receipts, {
              loading: "Reading the queue…",
              render: () =>
                waiting.length === 0 ? (
                  <EmptyState>
                    {query === ""
                      ? "Every accepted delivery has been given an identity."
                      : "No waiting delivery matches that search."}
                  </EmptyState>
                ) : (
                  <DataTable<UnidentifiedReceipt>
                    table={receiptTable}
                    onRowClick={(row) => {
                      // Closes as it opens: see the note on this component.
                      queue.close()
                      waiting_.open(row.receipt_line_id)
                    }}
                    isSelected={(row) => row.receipt_line_id === waiting_.value}
                    className="max-h-[calc(100vh-24rem)]"
                  />
                ),
            })}
          </Card>
        ) : (
          <Card className="overflow-hidden">
            {queryState(sessions, {
              loading: "Reading the sessions…",
              render: () =>
                open.length === 0 ? (
                  <EmptyState>
                    {query === ""
                      ? "No session is open. Nothing is waiting to be minted."
                      : "No open session matches that search."}
                  </EmptyState>
                ) : (
                  <DataTable<SetupSessionRow>
                    table={sessionTable}
                    onRowClick={(row) => {
                      queue.close()
                      session.open(row.session_id)
                    }}
                    isSelected={(row) => row.session_id === session.value}
                    className="max-h-[calc(100vh-24rem)]"
                  />
                ),
            })}
          </Card>
        )}
      </Sheet>

      <OpenSessionSheet
        receipt={
          waiting.find((row) => row.receipt_line_id === waiting_.value) ?? null
        }
        vocabulary={vocabulary.data}
        onClose={waiting_.close}
        onDone={(outcome) => {
          waiting_.close()
          setHandover({
            session_id: outcome.session.session_id,
            problem: outcome.kind === "stalled" ? outcome.problem : null,
            job: outcome.session.tagging_job_id ?? null,
          })
          // Straight into the session that was just made, either way. It is
          // the record of what the press did — the article code, the SKUs and
          // the serial ranges their tags were drawn from — and when the mint
          // did not run it is also where it is run again.
          session.open(outcome.session.session_id)
        }}
      />
      <SessionSheet
        id={session.value ?? null}
        // Only for the session the press actually made: opening a different
        // one from the queue is a different question, and it must not inherit
        // this one's answer.
        handover={
          handover !== null && handover.session_id === session.value
            ? handover
            : null
        }
        onClose={() => {
          setHandover(null)
          session.close()
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------------------

function lifecycleOf(session: SetupSession) {
  const issued = session.issued_at !== null
  const tagged = session.tagged_at !== null
  return [
    { label: "Opened", state: "done" as const },
    {
      label: "Issued",
      state: issued ? ("done" as const) : ("current" as const),
    },
    {
      label: "Tagged",
      state: tagged
        ? ("done" as const)
        : issued
          ? ("current" as const)
          : ("todo" as const),
    },
  ]
}

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
    // `w-fit`, so the box hugs its columns: a delivery that came in two sizes
    // was drawing a two-column grid across sixty rem of sheet, with each
    // figure stranded in the middle of a column wide enough for a sentence.
    // It grows to the full width and scrolls from there, which is the case
    // the frozen colour column below exists for.
    <div className="w-fit max-w-full overflow-x-auto rounded-inner border border-hairline">
      {/* Fixed layout and separated borders, the same as the pricelist grid:
          a matrix is read across as much as down, and without a rule between
          the columns the eye loses which size a figure belongs to halfway
          along the row. */}
      <table className="table-fixed border-separate border-spacing-0 text-cell">
        <colgroup>
          <col className="w-[8.5rem]" />
          {sizes.map((size) => (
            <col key={size.code} className={columnClass} />
          ))}
          <col className="w-[5.5rem]" />
        </colgroup>

        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-20 border-r border-b border-hairline bg-canvas px-3 py-2 text-left text-eyebrow font-semibold text-mute uppercase"
            >
              Colour
            </th>
            {sizes.map((size) => (
              <th
                key={size.code}
                scope="col"
                className="border-b border-hairline bg-canvas px-2 py-2 text-right text-eyebrow font-semibold text-mute uppercase"
              >
                {size.label}
              </th>
            ))}
            <th
              scope="col"
              className="border-b border-l border-hairline bg-canvas px-3 py-2 text-right text-eyebrow font-semibold text-ink uppercase"
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
                className="sticky left-0 z-10 border-t border-r border-hairline bg-canvas px-3 py-2 text-left font-normal"
              >
                <span className="block truncate text-[0.78125rem] font-medium text-ink">
                  {colour.label}
                </span>
              </th>
              {sizes.map((size) => (
                <td
                  key={size.code}
                  className="border-t border-hairline px-2 py-1.5 text-right align-middle tabular-nums"
                >
                  {cell(colour, size)}
                </td>
              ))}
              <td className="border-t border-l border-hairline px-3 py-2 text-right text-[0.78125rem] font-medium text-ink tabular-nums">
                {rowTotal(colour)}
              </td>
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr>
            <th
              scope="row"
              className="sticky left-0 z-10 border-t border-r border-hairline bg-soft-2 px-3 py-2 text-left text-eyebrow font-semibold text-mute uppercase"
            >
              All
            </th>
            {sizes.map((size) => (
              <td
                key={size.code}
                className="border-t border-hairline bg-soft-2 px-2 py-2 text-right text-[0.78125rem] text-text tabular-nums"
              >
                {columnTotal(size)}
              </td>
            ))}
            <td className="border-t border-l border-hairline bg-soft-2 px-3 py-2 text-right text-[0.78125rem] font-semibold text-ink tabular-nums">
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
function SessionSheet({
  id,
  handover,
  onClose,
}: {
  id: string | null
  /// How the press that made this session ended, when it was that press that
  /// opened this sheet. Null when it was a link, the queue, or a second look.
  handover: Handover | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const idempotency = useIdempotencyKey()

  const detail = useQuery({
    queryKey: procurementKeys.setup(id ?? ""),
    queryFn: ({ signal }) => setupSessionDetail(id!, signal),
    enabled: id !== null,
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

  /// The size columns, in the order the server sent the variants rather than
  /// alphabetically: `L` before `M` before `S` is not a size run, and this
  /// company's own order is the one the SKUs were drawn in.
  const sizes = useMemo(() => {
    const seen = new Map<string, string>()
    for (const variant of detail.data?.variants ?? []) {
      if (!seen.has(variant.size_code))
        seen.set(variant.size_code, variant.size_label)
    }
    return [...seen.entries()].map(([code, label]) => ({ code, label }))
  }, [detail.data])

  /// One cell of the grid, keyed the way a variant is: colour digit and size.
  const byCell = useMemo(() => {
    const map = new Map<string, SetupVariant>()
    for (const variant of detail.data?.variants ?? [])
      map.set(`${variant.colour_digit}|${variant.size_code}`, variant)
    return map
  }, [detail.data])

  const declared = (detail.data?.variants ?? []).reduce(
    (sum, variant) => sum + variant.quantity,
    0
  )

  /// What one piece is worth. Intake gives every variant the same figure, so
  /// this is one sentence under the grid rather than a column in it — and a
  /// range if a later hand has made them differ.
  const prices = [
    ...new Set(
      (detail.data?.variants ?? []).map((one) => one.base_price_minor)
    ),
  ].sort((a, b) => a - b)

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "article_setup", id }}
      onOpenChange={(open) => !open && onClose()}
      id={detail.data?.article_code}
      title={detail.data?.article_name ?? "Setup session"}
      // What this sheet is for is the variant grid, and a grid is read across.
      width="table"
      footer={
        detail.data?.status === "OPEN" && (
          <Button
            variant="primary"
            className="w-full"
            disabled={actor === "" || (mine && issue.isPending)}
            onClick={() => issue.mutate(id!)}
          >
            {mine && issue.isPending
              ? "Minting…"
              : "Mint the article and send the tagging job"}
          </Button>
        )
      }
    >
      {queryState(detail, {
        loading: "Loading the session…",
        render: (session) => (
          // Measured on the sheet rather than the window: this panel is 64rem
          // at a desk and the whole glass on a phone.
          <div className="@container flex flex-col gap-5">
            <Lifecycle steps={lifecycleOf(session)} />

            {/* What the press that opened this sheet did, until the button
                below is used on this session and answers for itself. The
                stalled half is the one sentence in this flow that has to be
                exact: the delivery has an identity, the receipt is out of the
                queue, and none of the numbers were drawn — so what a person
                needs told is where the thing went and that pressing again is
                safe. */}
            {!mine && handover !== null && handover.problem !== null && (
              <Banner tone="bad">
                The delivery has its identity, but nothing was minted against
                it: no SKUs, no serial ranges, no tagging job. The session is
                open and the button below sends it again. The server said:{" "}
                {handover.problem}
              </Banner>
            )}
            {!mine && handover !== null && handover.job !== null && (
              <Banner tone="ok">
                Minted. Tagging job {handover.job} is on its way to{" "}
                {session.site_id}.
              </Banner>
            )}

            {mine && issue.isError && (
              <Banner tone="bad">{(issue.error as Error).message}</Banner>
            )}
            {mine && issue.isSuccess && issue.data.tagging_job_id && (
              <Banner tone="ok">
                Minted. Tagging job {issue.data.tagging_job_id} is on its way to{" "}
                {session.site_id}.
              </Banner>
            )}

            <div className="flex items-center gap-2">
              <Pill tone={toneFor(session.status)}>
                {label(session.status)}
              </Pill>
              {session.job && (
                <Pill tone={toneFor(session.job.status)}>
                  Tagging {label(session.job.status)}
                </Pill>
              )}
            </div>

            {/* Eight facts in two rows of four rather than four rows of two:
                at this width a two-column grid leaves half the sheet empty
                and makes the record twice as tall as it needs to be. */}
            <Facts className="@2xl:grid-cols-4">
              <Fact term="Our article">{session.article_code}</Fact>
              <Fact term="Supplier's code">
                {session.supplier_article_code ?? "—"}
              </Fact>
              <Fact term="Division">{session.division_code}</Fact>
              <Fact term="Landed at">{session.site_id}</Fact>
              <Fact term="Opened by">{session.created_by}</Fact>
              <Fact term="Opened">{day(session.created_at)}</Fact>
              <Fact term="Issued">{day(session.issued_at)}</Fact>
              <Fact term="Tagged">{day(session.tagged_at)}</Fact>
            </Facts>

            {session.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {session.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </div>
            )}

            <div>
              <SubHead
                aside={
                  session.variants.length === 0
                    ? undefined
                    : `${count(session.variants.length)} SKUs`
                }
              >
                Variants
              </SubHead>
              {session.variants.length === 0 ? (
                <p className="text-meta text-mute">
                  Nothing has been minted yet. Issuing the session draws the
                  SKUs, their serial ranges and their EPCs in one transaction.
                </p>
              ) : (
                <>
                  <Matrix
                    colours={colours.map(([digit, colourLabel]) => ({
                      key: digit,
                      label: colourLabel,
                    }))}
                    sizes={sizes}
                    // Room for a serial range under the count. The SKU code
                    // itself is not drawn: it is this article, this row's
                    // digit and this column's size, which is the grid.
                    columnClass="w-[7.5rem]"
                    cell={(colour, size) => {
                      const variant = byCell.get(`${colour.key}|${size.code}`)
                      return variant === undefined ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <span className="flex flex-col items-end leading-tight">
                          <span className="text-[0.8125rem] font-medium text-ink">
                            {count(variant.quantity)}
                          </span>
                          <span className="font-mono text-[0.625rem] text-mute">
                            {variant.serial_from}–{variant.serial_to}
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
                    total={count(declared)}
                  />
                  <p className="mt-2 text-[0.71875rem] text-mute">
                    Under each count is the serial range its tags were drawn
                    from.{" "}
                    {prices.length === 1
                      ? `Every variant is priced at ${money(prices[0])}.`
                      : prices.length > 1
                        ? `Prices run ${money(prices[0])} to ${money(prices[prices.length - 1])}.`
                        : ""}
                  </p>
                </>
              )}
              <TotalsLadder
                className="mt-3"
                rows={[
                  {
                    label: "Split into variants",
                    value: count(declared),
                  },
                  {
                    label: "Not yet accounted for",
                    value: count(session.receipt_quantity - declared),
                  },
                ]}
                total={{
                  label: "Pieces received",
                  value: count(session.receipt_quantity),
                }}
              />
            </div>

            <div>
              <SubHead>Colourways</SubHead>
              {colours.length === 0 ? (
                <p className="text-meta text-mute">
                  A photograph is filed per colourway, so there is nowhere to
                  put one until the session has been issued and its colours
                  exist.
                </p>
              ) : (
                <div className="grid gap-3 @2xl:grid-cols-2">
                  {colours.map(([digit, colourLabel]) => (
                    <Colourway
                      key={digit}
                      articleCode={session.article_code}
                      digit={digit}
                      label={colourLabel}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ),
      })}
    </Sheet>
  )
}

/// One colour of one article, and its photograph.
///
/// The bytes never pass through the node: it hands out a URL that authorises
/// exactly this key for an hour, and the browser PUTs straight to the bucket.
function Colourway({
  articleCode,
  digit,
  label: colourLabel,
}: {
  articleCode: string
  digit: string
  label: string
}) {
  const client = useQueryClient()

  const image = useQuery({
    queryKey: procurementKeys.articleImage(articleCode, digit),
    queryFn: ({ signal }) => articleImage(articleCode, digit, signal),
    staleTime: 10 * 60 * 1000,
  })

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
    <div className="flex items-center gap-3 rounded-inner border border-hairline p-2.5">
      {image.data ? (
        <img
          src={image.data.url}
          alt={colourLabel}
          className="size-14 shrink-0 rounded-inner border border-hairline object-cover"
        />
      ) : (
        <span className="grid size-14 shrink-0 place-items-center rounded-inner bg-soft-2 font-mono text-[0.71875rem] text-mute">
          {digit}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[0.8125rem] font-medium text-ink">
          {colourLabel}
        </span>
        <span className="block font-mono text-[0.65625rem] text-mute">
          catalogue/{articleCode}/{digit}.jpg
        </span>
        {upload.isError && (
          <span className="block text-[0.6875rem] text-bad">
            {(upload.error as Error).message}
          </span>
        )}
      </span>
      <label className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-full border border-hairline-2 bg-canvas px-3 text-[0.78125rem] font-medium text-text transition-colors hover:bg-soft-2">
        {upload.isPending
          ? "Sending…"
          : image.data
            ? "Replace"
            : "Add a photograph"}
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
    </div>
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
function OpenSessionSheet({
  receipt,
  vocabulary,
  onClose,
  onDone,
}: {
  receipt: UnidentifiedReceipt | null
  vocabulary?: CatalogueVocabulary
  onClose: () => void
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
    <Sheet
      open={receipt !== null}
      onOpenChange={(next) => !next && onClose()}
      id={receipt?.po_number}
      title={receipt?.article_name ?? "Give this delivery an identity"}
      // The same glass as the session this makes: the widest thing on it is
      // the colour x size grid, and it is the thing somebody is here to fill
      // in. A rail turned that grid into a sideways scroll with the sizes off
      // the edge — which is to say, into the flat list it replaced.
      width="table"
    >
      {receipt !== null && (
        <SessionComposer
          key={receipt.receipt_line_id}
          receipt={receipt}
          vocabulary={vocabulary}
          actor={actor}
          // The identity itself failing to save. The mint failing after it
          // saved is not a problem this form can restate — the delivery is no
          // longer waiting, so the sheet has closed over the session that is.
          problem={problemOf(setUp.error)}
          busy={setUp.isPending}
          onSubmit={(request) => setUp.mutate(request)}
        />
      )}
    </Sheet>
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

  /// The sizes this company sells, from the size master and in the master's
  /// own order — XS before S before XXL, which is what makes a row of chips a
  /// size run rather than a bag of numbers.
  ///
  /// This used to read the catalogue's facets instead, on the argument that a
  /// size nothing has ever been sold in is a size nobody is about to receive.
  /// What it actually showed was `02 06 04 03`: facets carry the stored code
  /// and there is nowhere in them to find the word for it.
  const sizes = useMemo(() => vocabulary?.sizes ?? [], [vocabulary])
  /// The grid, in the master's order rather than the order somebody happened
  /// to press the chips in.
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
        : division === ""
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

      {/* Two questions, side by side once there is room: what this thing is,
          and what actually turned up. They are answered by different people
          reading different pieces of paper, and stacking them made the second
          one — the one only the warehouse can answer — a scroll away. */}
      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] @3xl:gap-x-8">
        <div className="flex flex-col gap-5">
          <SubHead>What it is</SubHead>

          <Field label="Name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <Field label="Division">
            <PickOne
              choices={divisionChoices}
              value={division === "" ? null : division}
              onChange={(next) => setDivision(next ?? "")}
              placeholder="Choose a division…"
              label="Division"
            />
          </Field>

          <Field label="Tags" hint="What the article will be found by.">
            <PickMany
              choices={tagChoices}
              values={tags}
              onChange={setTags}
              placeholder="None"
              label="Tags"
            />
          </Field>

          <Field
            label="Base price"
            hint="One piece, every variant. A colour worth more is a Commercial decision."
          >
            <Money value={price} onChange={setPrice} placeholder="31.000" />
          </Field>
        </div>

        <div className="flex flex-col gap-5">
          <SubHead>What arrived</SubHead>

          <Field
            label="Colours"
            hint={
              chosenColours.length >= COLOURWAY_CEILING
                ? "Ten is the ceiling — a colour is one digit of the SKU."
                : "Type to search. Ten at most: a colour is one digit of the SKU."
            }
          >
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

          {/* A field, in `<Field>`'s own label type — not a `<SubHead>`. The
              two headings on this form are "What it is" and "What arrived",
              and a third thing set at the same weight two rows under one of
              them flattens the pair into a list of five headings. */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[0.78125rem] font-medium text-text">
                Sizes
              </span>
              <span className="text-[0.71875rem] text-mute tabular-nums">
                {chosenSizes.length === 0
                  ? "None"
                  : `${count(chosenSizes.length)} chosen`}
              </span>
            </div>
            {/* Chips rather than a second search box: there are fourteen of
                them, they are the one vocabulary somebody wants to see all of
                at once, and a size run reads as a run only when it is drawn
                as one. */}
            <div className="flex flex-wrap gap-1.5">
              {sizes.map((size) => (
                <button
                  key={size.code}
                  type="button"
                  title={size.code}
                  onClick={() => setChosenSizes(toggle(chosenSizes, size.code))}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[0.75rem] transition-colors",
                    chosenSizes.includes(size.code)
                      ? "border-ink bg-ink text-white"
                      : "border-hairline-2 text-text hover:bg-soft-2"
                  )}
                >
                  {size.label}
                </button>
              ))}
            </div>
            {sizes.length === 0 && (
              <p className="text-[0.71875rem] text-mute">
                The size master is not answering, so there is nothing to choose
                from.
              </p>
            )}
          </div>
        </div>
      </div>

      <div>
        <SubHead
          aside={
            rows.length === 0 || columns.length === 0 ? undefined : (
              <span
                className={
                  over ? "text-bad" : balanced ? "text-ok-fg" : "text-warn-fg"
                }
              >
                {count(declared)} of {count(receipt.quantity)}
              </span>
            )
          }
        >
          How the pieces split
        </SubHead>
        {rows.length === 0 || columns.length === 0 ? (
          <p className="rounded-inner border border-dashed border-hairline-2 px-3.5 py-6 text-center text-[0.71875rem] text-mute">
            Choose the colours and the sizes above, and the grid to count them
            into appears here.
          </p>
        ) : (
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
                // Flat inside the grid, not a pill: twenty pill-shaped boxes
                // in a table read as twenty controls, and what this is is one
                // table somebody is filling in. The fill arrives on hover and
                // focus, so the cell still says it can be typed into.
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
                className="-mx-2 h-8 w-[calc(100%+1rem)] rounded-[0.5rem] border-0 bg-transparent px-2 text-right hover:bg-soft-2 focus:bg-soft-2"
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
        )}
      </div>

      {/* The button, and on the same line either what pressing it does or the
          reason it cannot be pressed. The first half is not decoration: this
          one press mints, and a button whose weight is only discoverable by
          pressing it is not a button anybody should press. */}
      <div className="flex flex-col gap-3 border-t border-hairline pt-4 @xl:flex-row @xl:items-center @xl:justify-between">
        <p
          className={cn(
            "min-w-0 text-[0.71875rem] leading-relaxed",
            over ? "text-bad" : "text-mute"
          )}
        >
          {missing ??
            `This mints the article, its SKUs and their EPCs, and sends the tagging job to ${receipt.site_id}. The serials are drawn once and cannot be drawn back.`}
        </p>
        <Button
          variant="primary"
          type="submit"
          disabled={!ready || busy}
          className="w-full shrink-0 @xl:w-auto @xl:min-w-[13rem]"
        >
          {busy ? "Minting…" : "Set up and send to tagging"}
        </Button>
      </div>
    </form>
  )
}
