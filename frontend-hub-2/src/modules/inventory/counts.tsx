import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { ClipboardCheck } from "lucide-react"

import { PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { Sheet } from "@/kit/sheet"
import { Table } from "@/kit/table"
import { Tabs } from "@/kit/tabs"
import { Tag } from "@/kit/tag"
import { Tile, Tiles } from "@/kit/tiles"
import { Empty, Failed, Loading } from "@/kit/state"
import { api } from "@/lib/api"
import { count } from "@/lib/format"
import { useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import type { TableSetup } from "@/lib/table"
import {
  countStatusLabel,
  countStatusTone,
  humanise,
  moment,
} from "@/modules/inventory/labels"
import {
  Caveat,
  Delta,
  Fact,
  Facts,
  Ident,
  Line,
  Quiet,
  SubHead,
} from "@/modules/inventory/parts"
import type { CountBoard, CountDetail, CountRow } from "@/modules/inventory/wire"

/// Counts — the only thing in this app allowed to tell the ledger it is wrong.
///
/// ## The lifecycle, and the fork inside it
///
/// `DRAFT → ACTIVE → REVIEW → CLOSED`, and nothing else. What each step means
/// depends entirely on who owns the site, and the fork is at **activation**:
/// with no DC owner the cloud freezes an expectation here and the counting
/// happens here; with one, the cloud snapshots nothing, sends a command, and
/// every later step is the node's. Approving a node-owned count does not close
/// it — it *asks* for an adjustment, and the count stays in review until that
/// node answers.
///
/// So `execution_authority` is a column and not a detail. A screen that hid it
/// would offer one Approve button that means two different things, one of which
/// finishes the job and one of which sends a message.
///
/// ## Four buckets, each capped at 200, and the screen says so
///
/// `GET /inventory/counts` takes **no parameters** and answers four arrays
/// rather than a list: `drafts`, `active`, `needs_review`, `history`. Each is
/// `LIMIT 200` in the SQL and nothing the client sends moves it. So this is
/// `useReport` — one whole answer, no cursor, nothing to page — and the tab
/// counts are real counts of what came back rather than facets, which is a
/// distinction worth keeping: a bucket standing at exactly 200 is a bucket that
/// has been cut off, and the strip under the tabs says so when it happens.
///
/// The board is also the only place in this system that knows when a pool was
/// last counted, which is why the Stock screen reads it for one column.

const BUCKETS = [
  {
    value: "needs_review",
    label: "Needs review",
    /// First, and the default. It is the only bucket where something is
    /// waiting on a person: a submitted count with a difference nobody has
    /// accepted is stock the books and the shelf disagree about.
    empty: "Nothing is waiting for a decision.",
  },
  { value: "active", label: "Counting", empty: "Nobody is counting anything right now." },
  { value: "drafts", label: "Drafts", empty: "No count has been drafted." },
  { value: "history", label: "Closed", empty: "No count has been closed yet." },
] as const

const CAP = 200

export function CountsScreen() {
  const url = useQueryState()
  const bucket = url.one("bucket") || "needs_review"
  const openId = url.one("count")

  const board = useReport<CountBoard>({
    key: ["inventory", "counts"],
    path: "/api/v1/inventory/counts",
  })

  const rows = pick(board.data, bucket)
  const shown = BUCKETS.find((one) => one.value === bucket) ?? BUCKETS[0]

  const columns: ColumnDef<TableSetup, CountRow>[] = [
    {
      id: "count",
      header: "Count",
      size: 26,
      // No priority: it is the identity column and it carries the only words a
      // person wrote about why this count happened.
      meta: { icon: <ClipboardCheck className="size-[15px]" />, min: 230 },
      cell: ({ row }) => (
        <>
          <span className="text-ink block truncate font-medium">
            {row.original.reason}
          </span>
          <Ident className="block truncate">{row.original.pool_id}</Ident>
        </>
      ),
    },
    {
      id: "kind",
      header: "Kind",
      size: 11,
      meta: { priority: 2, min: 105 },
      /// FULL counts a shelf entirely, CYCLE samples it on a rota, TARGETED
      /// counts a named list of SKUs. Which one it is decides what "expected"
      /// was even measured over, so it is not decoration.
      cell: ({ row }) => <Tag>{humanise(row.original.kind)}</Tag>,
    },
    {
      id: "authority",
      header: "Counted by",
      size: 13,
      // Never dropped. See the head of this file: it is the difference between
      // approving something and asking a node to do it.
      meta: { min: 120 },
      cell: ({ row }) => (
        <Tag
          tone={row.original.execution_authority === "EDGE_DC" ? "info" : "neutral"}
          className="uppercase"
        >
          {row.original.execution_authority === "EDGE_DC" ? "node" : "centre"}
        </Tag>
      ),
    },
    {
      id: "status",
      header: "Status",
      size: 12,
      meta: { min: 115 },
      cell: ({ row }) => (
        <Tag tone={countStatusTone(row.original.status)}>
          {countStatusLabel(row.original.status)}
        </Tag>
      ),
    },
    {
      id: "expected",
      header: "Expected",
      size: 11,
      meta: { align: "right", priority: 3, min: 100 },
      cell: ({ row }) => (
        <span className="text-ink-3 tabular-nums">
          {count(row.original.expected)}
        </span>
      ),
    },
    {
      id: "found",
      header: "Found",
      size: 10,
      meta: { align: "right", priority: 1, min: 95 },
      cell: ({ row }) => (
        <span className="tabular-nums">{count(row.original.found)}</span>
      ),
    },
    {
      id: "difference",
      header: "Difference",
      size: 12,
      // The decision figure. Never dropped, and never drawn as a bare nought —
      // see `Delta`.
      meta: { align: "right", min: 110 },
      cell: ({ row }) => (
        <Delta value={row.original.found - row.original.expected} />
      ),
    },
    {
      id: "opened",
      header: "Opened",
      size: 16,
      meta: { priority: 4, min: 150 },
      cell: ({ row }) => (
        <>
          <span className="text-ink-2 block">
            {moment(row.original.created_at)}
          </span>
          <span className="text-label text-ink-4 block truncate">
            {row.original.created_by}
          </span>
        </>
      ),
    },
  ]

  const board_ = board.data
  const short = board_ === undefined ? 0 : shortfallOf(board_)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Inventory"
        title="Counts"
        description="What was expected, what was found, and who is allowed to say so."
      />

      <Tabs
        label="Which counts"
        value={bucket}
        // `needs_review` is the schema's default, so the router's
        // `stripSearchParams` keeps it out of the URL — the tab is written to
        // the address bar only when it is not the one the screen opens on.
        onChange={(value) => url.set({ bucket: value }, false)}
        tabs={BUCKETS.map((one) => ({
          value: one.value,
          label: one.label,
          // A real count of what came back, not a facet. The board has no facet
          // endpoint and no total; what is here is what arrived.
          count:
            board_ === undefined ? undefined : pick(board_, one.value).length,
        }))}
      />

      {/* A count is an event on a day and the board is every one of them, so
          the scope is a period. The difference on each row is a position, at
          the moment somebody stood there — which is why it is on the row and
          not in this line. */}
      <ScopeLine
        scope={{ kind: "during", period: "every count on the board" }}
        measure="pieces"
        note="approving a node-owned count asks for an adjustment; it does not close it"
      />

      <Tiles>
        <Tile
          label="Waiting on a person"
          value={board_ === undefined ? "—" : count(pick(board_, "needs_review").length)}
          tone={
            board_ !== undefined && pick(board_, "needs_review").length > 0
              ? "warn"
              : undefined
          }
          note="submitted, and the difference not yet accepted"
        />
        <Tile
          label="Being counted"
          value={board_ === undefined ? "—" : count(pick(board_, "active").length)}
          note="activated, nobody has submitted yet"
        />
        <Tile
          label="Pieces short"
          value={board_ === undefined ? "—" : count(short)}
          tone={short > 0 ? "bad" : undefined}
          // Summed over the rows that are on the board, and the note says so.
          // There is no endpoint that totals this, and a figure summed from four
          // capped buckets must not be read as the shortfall of the business.
          note="over the counts on this board, which holds 200 per column"
        />
        {/* Not waiting on anybody here. An approved count at a node-owned site
            is a REQUEST to that node, and it sits in review until the node
            answers — so these rows look like work and are not. */}
        <Tile
          label="Waiting on a node"
          value={board_ === undefined ? "—" : count(awaitingNode(board_))}
          note="approved here, and the node has not answered"
        />
      </Tiles>

      <Toolbar
        trailing={
          board.isPending
            ? "Loading…"
            : `${count(rows.length)} ${shown.label.toLowerCase()}`
        }
      >
        <span className="text-ctl text-ink-4">
          This board takes no parameters — no search, no site, no date range.
          Each column is capped at {CAP} rows on the server.
          {rows.length >= CAP && (
            <b className="text-warn-ink font-medium">
              {" "}
              This column is at the cap, so there are more than are shown.
            </b>
          )}
        </span>
      </Toolbar>

      {board.isError ? (
        <Failed
          what="the count board"
          error={board.error}
          onRetry={() => void board.refetch()}
        />
      ) : board.isPending ? (
        <Loading cols={7} />
      ) : rows.length === 0 ? (
        <Empty what="counts in this column" detail={shown.empty} />
      ) : (
        <Table
          columns={columns}
          rows={rows}
          rowId={(row) => row.id}
          caption="Official counts"
          onRowClick={(row) => url.set({ count: row.id }, false)}
          isOpen={(row) => row.id === openId}
          foot={{
            count: (
              <>
                <b className="text-ink">{count(rows.length)}</b> counts
              </>
            ),
            difference: "per count, on the row",
          }}
        />
      )}

      <CountSheet openId={openId} onClose={() => url.set({ count: null }, false)} />
    </div>
  )
}

/// One bucket of the board, by name.
///
/// A function rather than an index because the board is four named arrays and
/// not a map: `board[bucket]` would need the bucket typed as a key of it, and
/// the bucket comes out of a URL.
function pick(board: CountBoard | undefined, bucket: string): CountRow[] {
  if (board === undefined) return []
  switch (bucket) {
    case "active":
      return [...board.active]
    case "drafts":
      return [...board.drafts]
    case "history":
      return [...board.history]
    default:
      return [...board.needs_review]
  }
}

/// Pieces the counts on this board say are missing from the shelf.
///
/// Only the shortages, and only over what is on the board. A gain and a
/// shortage are not opposites that cancel — one is stock nobody can find and
/// the other is stock nobody can explain — so netting them would report a
/// warehouse that has lost nothing and gained nothing while both are true.
/// Counts this node has approved and a node has not finished.
///
/// `adjustment_command_id` set with no `edge_adjustment_completion_id` is the
/// exact shape of "we asked and nobody has answered" — the state the fork at
/// activation creates and the one a reviewer will otherwise read as their own
/// backlog.
function awaitingNode(board: CountBoard): number {
  return [...board.needs_review, ...board.active].filter(
    (row) =>
      row.execution_authority === "EDGE_DC" &&
      row.adjustment_command_id !== null &&
      row.edge_adjustment_completion_id === null,
  ).length
}

function shortfallOf(board: CountBoard): number {
  return [...board.needs_review, ...board.active, ...board.history].reduce(
    (total, row) => total + Math.max(0, row.expected - row.found),
    0,
  )
}

/// One count, whole: its lifecycle, its arithmetic, and every line behind it.
///
/// Read from `GET /inventory/counts/{id}` rather than from the row, because the
/// record carries the line-by-line comparison and the two command ids that say
/// whether a node was ever asked and whether it ever answered. A URL naming a
/// count the board is not holding — past the 200-row cap, or in a bucket the
/// reader is not on — opens it all the same.
function CountSheet({
  openId,
  onClose,
}: {
  openId: string
  onClose: () => void
}) {
  const record = useQuery({
    queryKey: ["inventory", "count", openId] as const,
    enabled: openId !== "",
    queryFn: ({ signal }) =>
      api.get<CountDetail>(
        `/api/v1/inventory/counts/${encodeURIComponent(openId)}`,
        signal,
      ),
  })

  const detail = record.data
  const byNode = detail?.execution_authority === "EDGE_DC"

  return (
    <Sheet
      open={openId !== ""}
      onClose={onClose}
      width="record"
      title={detail?.reason ?? "Count"}
      subtitle={
        detail
          ? `${detail.pool_id} · ${countStatusLabel(detail.status)}`
          : "Reading the count…"
      }
    >
      {record.isError ? (
        <Failed
          what="this count"
          error={record.error}
          onRetry={() => void record.refetch()}
        />
      ) : detail === undefined ? (
        <Loading rows={5} cols={2} />
      ) : (
        <>
          <Facts>
            <Fact label="Kind">{humanise(detail.kind)}</Fact>
            <Fact label="Counted by">
              {byNode ? "The node standing in that site" : "This node"}
            </Fact>
            <Fact label="Expected">
              <span className="tabular-nums">
                {count(detail.summary.expected)}
              </span>
            </Fact>
            <Fact label="Found">
              <span className="tabular-nums">{count(detail.summary.found)}</span>
            </Fact>
            <Fact label="Short">
              <span className="text-bad-ink tabular-nums">
                {count(detail.summary.shortage_subjects)} subjects
              </span>
            </Fact>
            <Fact label="Gained">
              <span className="text-warn-ink tabular-nums">
                {count(detail.summary.gain_subjects)} subjects
              </span>
            </Fact>
            <Fact label="Opened" wide>
              {moment(detail.created_at)} by {detail.created_by}
            </Fact>
            <Fact label="Adjustment" wide>
              {/* The half of the record that says whether anything was ever
                  actually done about the difference. Null here on a closed
                  count means the count agreed and there was nothing to post. */}
              {detail.adjustment_id === null ? (
                <Quiet why="No adjustment has been posted against this count. On a closed count with no difference, that is the right answer.">
                  none posted
                </Quiet>
              ) : (
                <Ident className="text-cell">{detail.adjustment_id}</Ident>
              )}
            </Fact>
          </Facts>

          <SubHead>How far it has got</SubHead>
          <Line note={moment(detail.created_at)}>
            <span className="min-w-0 flex-1">Drafted</span>
          </Line>
          <Line
            note={
              detail.activated_at === null
                ? "not yet"
                : byNode
                  ? `${moment(detail.activated_at)} — a command went to the node; nothing was frozen here`
                  : `${moment(detail.activated_at)} — the expectation was frozen here`
            }
          >
            <span className="min-w-0 flex-1">Activated</span>
          </Line>
          <Line
            note={
              detail.submitted_at === null ? "not yet" : moment(detail.submitted_at)
            }
          >
            <span className="min-w-0 flex-1">Submitted</span>
          </Line>
          <Line
            note={
              detail.closed_at !== null
                ? moment(detail.closed_at)
                : byNode
                  ? `waiting on the node — its adjustment is ${detail.edge_adjustment_status ?? "not reported"}`
                  : "not yet"
            }
          >
            <span className="min-w-0 flex-1">Closed</span>
          </Line>

          <SubHead note={`${detail.lines.length} lines`}>
            Line by line
          </SubHead>
          {detail.lines.length === 0 ? (
            <Line>
              <Quiet>
                No line has been entered. Until one is, Expected and Found are
                both nought and their agreement means nothing.
              </Quiet>
            </Line>
          ) : (
            detail.lines.slice(0, 60).map((line) => (
              <Line key={`${line.subject_id}-${line.epc ?? ""}`}>
                <Ident className="text-cell min-w-0 flex-1 truncate">
                  {line.epc ?? line.subject_id}
                </Ident>
                <span className="text-ink-3 shrink-0">
                  {line.sku_code ?? "—"}
                </span>
                <span className="shrink-0 tabular-nums">
                  {count(line.expected_quantity)} → {count(line.found_quantity)}
                </span>
                <span className="shrink-0">
                  <Delta value={line.found_quantity - line.expected_quantity} />
                </span>
              </Line>
            ))
          )}

          <Caveat>
            A count is the only record in this system allowed to contradict the
            ledger, and it does so by posting movements — a shortage out to the
            pool&rsquo;s missing place, a gain back in. Nothing here edits a
            balance.
          </Caveat>
        </>
      )}
    </Sheet>
  )
}

// ── what did not come across, and why ──────────────────────────────────────
//
// **Every write on this screen**: the composer that opens a count, and the
// Activate, Add entries, Submit and Approve commands. All five are POSTs, two
// of them carry an idempotency key, and one of them — Approve — does two
// materially different things depending on `execution_authority`. That is not a
// form to port, it is the module's whole command surface, and it wants the
// mutation discipline this app has not settled yet (see `stock.tsx`). The board
// and the record read correctly in the meantime, which is what somebody
// reviewing a count actually does first.
