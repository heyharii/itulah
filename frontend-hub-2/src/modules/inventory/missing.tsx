import type { ColumnDef } from "@tanstack/react-table"
import { PackageX } from "lucide-react"
import { useMemo } from "react"

import { AppLink } from "@/kit/app-link"
import { PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { Table } from "@/kit/table"
import { Tag } from "@/kit/tag"
import { Truncated } from "@/kit/notice"
import { Empty, Failed, Loading } from "@/kit/state"
import { count } from "@/lib/format"
import { useReport } from "@/lib/list"
import type { TableSetup } from "@/lib/table"
import { age, countStatusLabel, moment } from "@/modules/inventory/labels"
import { Caveat, Ident, Quiet } from "@/modules/inventory/parts"
import type { MissingItem } from "@/modules/inventory/wire"

/// Missing — stock the ledger has moved out of sight and nobody has answered
/// for yet.
///
/// ## There is no "missing" status to filter by
///
/// This list **is** the set of positive balances sitting in a pool's `:missing`
/// place. Resolving one removes the row rather than restatusing it, so the only
/// question a row asks is which of three answers it gets — found, and it goes
/// back on hand; lost, and it leaves the estate through `system/lost`; disposed
/// of, and it leaves through `external/disposal`. All three post a real
/// movement, and **the age is what decides between them**: an hour is a mislaid
/// box, a fortnight is a write-off nobody has taken.
///
/// The list opens oldest-first, which is also the order the server returns.
///
/// ## Why `useReport` and not `useBoundedList`
///
/// The route takes **no parameters at all** — `limit` included. It applies its
/// own cap of 500 inside `list_missing` and ignores anything the client sends.
/// `useBoundedList` would put a `limit` on the wire that nothing reads, which
/// is a request this screen is not actually making; so the read is one whole
/// answer, and the cap is reported here from the row count, which is the only
/// evidence there is.
///
/// ## Every figure on this screen is pieces, and not one of them is money
///
/// A fortnight-old missing unit is a write-off waiting to be taken, and a
/// write-off is an amount. **This module cannot say what amount**, on any
/// screen, because no inventory route carries a cost. The Caveat under the
/// table says so rather than letting a reader assume somebody else has valued
/// it.

/// What `list_missing` caps itself at, transcribed from the SQL. Not sent —
/// see above — only used to recognise an answer that reached it.
const CAP = 500

/// A fortnight. Past this a missing unit has stopped being a mislaid box.
const STALE_HOURS = 24 * 14

export function MissingScreen() {
  const missing = useReport<{ items: MissingItem[] }>({
    key: ["inventory", "missing"],
    path: "/api/v1/inventory/missing",
  })

  const rows = useMemo(() => missing.data?.items ?? [], [missing.data])
  const truncated = rows.length >= CAP

  const overdue = rows.filter((row) => (row.age_hours ?? 0) > STALE_HOURS)
  const unsighted = rows.filter((row) => row.last_observation === null)
  const uncounted = rows.filter((row) => row.latest_count_id === null)
  const pieces = rows.reduce((total, row) => total + row.quantity, 0)

  const columns: ColumnDef<TableSetup, MissingItem>[] = [
    {
      id: "subject",
      header: "Subject",
      size: 24,
      meta: { icon: <PackageX className="size-[15px]" />, min: 210 },
      /// The tag first, because that is what somebody will search a shelf
      /// with. The subject id only where there is no tag and no barcode — a
      /// unit nobody ever labelled is itself part of why it cannot be found.
      cell: ({ row }) => (
        <>
          <Ident className="text-cell text-ink block truncate">
            {row.original.epc ?? row.original.barcode ?? row.original.subject_id}
          </Ident>
          <Ident className="block truncate">
            {row.original.sku_code ?? row.original.subject_type}
          </Ident>
        </>
      ),
    },
    {
      id: "pool",
      header: "Missing from",
      size: 20,
      meta: { priority: 2, min: 180 },
      cell: ({ row }) => (
        <>
          <AppLink
            to="/inventory"
            search={{ pool: row.original.origin_pool }}
            className="text-ink-2 hover:text-ink block truncate hover:underline"
          >
            {row.original.pool_label}
          </AppLink>
          <Ident className="block truncate">{row.original.origin_pool}</Ident>
        </>
      ),
    },
    {
      id: "quantity",
      header: "Qty",
      size: 8,
      meta: { align: "right", priority: 3, min: 75 },
      cell: ({ row }) => (
        <span className="tabular-nums">{count(row.original.quantity)}</span>
      ),
    },
    {
      id: "age",
      header: "Missing for",
      size: 13,
      // The decision metric and the reason the list is ordered by it. Never
      // dropped.
      meta: { align: "right", min: 115 },
      cell: ({ row }) => {
        const hours = row.original.age_hours
        if (hours === null) {
          return (
            <Quiet why="The ledger holds no date for when this went missing, so there is no age to read." />
          )
        }
        return (
          <span
            className={
              hours > STALE_HOURS
                ? "text-bad-ink font-medium tabular-nums"
                : hours > 48
                  ? "text-warn-ink tabular-nums"
                  : "text-ink-2 tabular-nums"
            }
          >
            {age(hours)}
          </span>
        )
      },
    },
    {
      id: "seen",
      header: "Last seen by a reader",
      size: 18,
      meta: { priority: 1, min: 170 },
      /// A sighting after it went missing is the single most useful fact on
      /// the row: the tag answered somewhere, so the piece exists and the
      /// ledger is simply standing in the wrong aisle. Never is the other
      /// answer, and it is not the same as "not recently".
      cell: ({ row }) =>
        row.original.last_observation === null ? (
          <Quiet why="No reader has ever reported this tag. There is no evidence it still exists.">
            never sighted
          </Quiet>
        ) : (
          <span className="text-ink-2">
            {moment(row.original.last_observation)}
          </span>
        ),
    },
    {
      id: "counted",
      header: "Last counted",
      size: 17,
      meta: { priority: 4, min: 160 },
      cell: ({ row }) =>
        row.original.latest_count_id === null ? (
          <Quiet why="No official count on the board covers this subject. Nobody has stood in front of this shelf and said what was on it.">
            never
          </Quiet>
        ) : (
          <AppLink
            to="/inventory/counts"
            search={{ count: row.original.latest_count_id }}
          >
            <Tag>
              {countStatusLabel(row.original.latest_count_status ?? "—")}
            </Tag>
          </AppLink>
        ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Inventory"
        title="Missing"
        description="Stock the ledger has moved out of sight and nobody has answered for yet."
      />

      {/* A position: these are balances standing in a missing place right now.
          The age beside each one is how long it has stood there. */}
      <ScopeLine
        scope={{ kind: "asAt", date: new Date().toISOString().slice(0, 10) }}
        measure="pieces"
        note="found, lost or disposed of — until one of the three, it stays on the books"
      />

      {truncated && <Truncated limit={CAP} noun="missing units" />}

      <Toolbar
        trailing={
          missing.isPending ? "Loading…" : `${count(rows.length)} open`
        }
      >
        <span className="text-ctl text-ink-4">
          This route takes no parameters — no site, no pool, no age, no search.
          The whole list is here, oldest first, capped at {CAP} on the server.
        </span>
      </Toolbar>

      {missing.isError ? (
        <Failed
          what="what cannot be found"
          error={missing.error}
          onRetry={() => void missing.refetch()}
        />
      ) : missing.isPending ? (
        <Loading cols={6} />
      ) : rows.length === 0 ? (
        <Empty
          what="missing stock"
          detail="Every subject the ledger holds is in a pool somebody can walk to."
        />
      ) : (
        <>
          <div className="border-line grid shrink-0 grid-cols-2 border-b sm:grid-cols-4">
            <Figure
              label="Open"
              value={`${count(rows.length)} units · ${count(pieces)} pieces`}
              note="each one still owned and unsellable"
            />
            <Figure
              label="Over a fortnight"
              value={count(overdue.length)}
              tone={overdue.length > 0 ? "bad" : undefined}
              note="a write-off nobody has taken"
            />
            <Figure
              label="Never sighted"
              value={count(unsighted.length)}
              note="no reader has ever reported the tag"
            />
            <Figure
              label="Never counted"
              value={count(uncounted.length)}
              note="no count on the board covers them"
            />
          </div>

          <Table
            columns={columns}
            rows={rows}
            rowId={(row) => row.id}
            caption="Stock the ledger cannot find"
            foot={{
              subject: (
                <>
                  <b className="text-ink">{count(rows.length)}</b> units
                </>
              ),
              quantity: count(pieces),
              age: truncated ? "of an unknown number" : "all of them",
            }}
          />
        </>
      )}

      <Caveat>
        Resolving one of these posts a movement — found goes back on hand, lost
        leaves through <Ident>system/lost</Ident>, disposed of leaves through{" "}
        <Ident>external/disposal</Ident>. Those three writes are not in this app
        yet. Nor is the amount any of them is worth:{" "}
        <b className="font-medium">no inventory route carries a cost</b>, so a
        write-off taken here would have to be valued somewhere else.
      </Caveat>
    </div>
  )
}

/// A figure in the strip above the table.
///
/// Not `kit/tiles.tsx`: those sit between the scope line and the toolbar, and
/// these belong under the toolbar because every one of them is a fold over the
/// rows below — they describe this table, and moving them above the narrowing
/// would imply they describe the business. The distinction matters here in
/// particular, because the list is capped and the figures are therefore about
/// what arrived.
function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note: string
  tone?: "bad"
}) {
  return (
    <div className="border-line border-r px-4 py-2.5 last:border-r-0">
      <span className="text-label text-ink-3 block">{label}</span>
      <span
        className={
          tone === "bad"
            ? "text-metric text-bad-ink mt-0.5 block font-semibold tabular-nums"
            : "text-metric mt-0.5 block font-semibold tabular-nums"
        }
      >
        {value}
      </span>
      <span className="text-meta text-ink-4 mt-0.5 block">{note}</span>
    </div>
  )
}
