import { FileText, Receipt, Users } from "lucide-react"
import type { BillPage, SupplierBill } from "@itulah/contract"
import type { ColumnDef } from "@tanstack/react-table"

import { Button } from "@/kit/button"
import { Loaded, PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { SearchField } from "@/kit/field"
import { Table } from "@/kit/table"
import { Tabs } from "@/kit/tabs"
import { Tag } from "@/kit/tag"
import { Tile, Tiles } from "@/kit/tiles"
import { Empty, Failed, Loading, NoMatch } from "@/kit/state"
import { amount, count, day, rp, today } from "@/lib/format"
import { useCursorList } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import { useDebounced } from "@/lib/use-debounced"
import type { TableSetup } from "@/lib/table"

/// Supplier bills — what we owe, from the document to settled.
///
/// One row is one bill we RECEIVED. The word is load-bearing and is the reason
/// this screen is not called Invoices: in this app a **bill** is always what a
/// supplier sends us and an **invoice** is always what we send a customer. The
/// two never swap, and a screen that used one word for both would be a screen
/// where "outstanding" means two opposite things.
///
/// ## Every narrowing is the server's
///
/// This screen was first written against a `GET /finance/bills` that took
/// `status`, `supplier` and `limit` and answered with a bare array clamped at
/// 500 — so the search box filtered what had been fetched, the tiles added up
/// what was on screen, and a strip at the top admitted the list might be cut
/// off. Three apologies drawn on the page because they were true.
///
/// The endpoint now carries a scope struct, a keyset cursor and an envelope,
/// the same as `money` beside it, so all three are gone: `q`, `status`,
/// `supplier`, `site`, `sort` and `dir` go on the wire, `total` and
/// `outstanding_minor` are added by the server over every matching row, and the
/// facet counts describe the whole set rather than the page.
///
/// The figures are summed SERVER-side for the reason `BillPage.total_minor`
/// gives: a paged list added up in the browser produces a total that grows
/// while somebody scrolls, and on a payables screen a total that changes as you
/// read it is worse than none.

const PAGE = 50

/// The statuses a bill actually has, as the database constrains them.
///
/// `status` arrives as a bare `string` in the contract — there is no generated
/// union — so the client keeps its own list and must survive a value it has
/// not met. An unknown status is drawn as itself rather than dropped: a row
/// whose state the screen cannot name is still a row somebody has to deal with.
const STATUS: Record<
  string,
  { label: string; tone: "neutral" | "ok" | "warn" }
> = {
  DRAFT: { label: "Draft", tone: "warn" },
  POSTED: { label: "Posted", tone: "ok" },
}

/// Merchandise or expense — which decides what the posting debits, and
/// therefore whether a bill has lines worth reading at all.
const KIND: Record<string, string> = {
  MERCHANDISE: "Goods",
  EXPENSE: "Expense",
}

export function BillsScreen() {
  const url = useQueryState()
  const typed = url.one("q")
  const status = url.one("status")
  const supplier = url.one("supplier")
  const openId = url.one("bill")
  const sortKey = url.one("sort") || "default"
  const sortDesc = url.one("dir") === "desc"

  // The box waits for a pause. Here it is not the wire it spares — the filter
  // is local — it is the READING: a list that refills on every letter cannot
  // be read while it is being typed into.
  const q = useDebounced(typed, 200)

  // The five the server will accept — see the match arm in `bill_page`. A key
  // it does not know falls back to the house order rather than 400-ing, so a
  // stale bookmark still opens; declaring them here keeps the headers honest
  // about which columns can actually be ordered.
  const onSort = (key: string) => {
    const same = sortKey === key
    url.set({ sort: key, dir: same ? (sortDesc ? null : "desc") : "desc" })
  }

  // Every narrowing on the wire, and every one of them part of the cache key —
  // a key that ignored a filter would answer a filtered question with an
  // unfiltered page.
  const list = useCursorList<SupplierBill>({
    key: ["finance", "bills"],
    path: "/api/v1/finance/bills",
    params: {
      q,
      status: status || null,
      supplier: supplier || null,
      sort: sortKey === "default" ? null : sortKey,
      dir: sortDesc ? "desc" : null,
    },
    limit: PAGE,
  })

  const rows = list.rows
  // Read off the FIRST page. Every page carries the same figures and the first
  // is already there, so they do not flicker as later pages land.
  const head = list.head as BillPage | undefined
  const facets = head?.facets

  const columns: ColumnDef<TableSetup, SupplierBill>[] = [
    {
      id: "bill",
      header: "Bill",
      size: 24,
      // No priority: it is the identity column, and a list that hides which
      // bill a figure belongs to has stopped being the list somebody asked for.
      meta: { icon: <Receipt className="size-[15px]" />, min: 220 },
      cell: ({ row }) => {
        const bill = row.original
        return (
          <>
            <span className="text-ink block truncate font-medium">
              {bill.invoice_number}
            </span>
            <span className="text-label text-ink-4 flex items-center gap-1.5">
              {/* The name is denormalised onto the bill, so this costs no
                  second query — but it is nullable, and a bare id is still an
                  answer. */}
              <span className="truncate">
                {bill.supplier_name ?? bill.supplier_id}
              </span>
              {/* Goods or expense. Not decoration: it decides which accounts
                  the posting debits, and therefore whether this bill has lines
                  worth opening at all — a merchandise bill genuinely has none.
                  Drawn quietly because it is context, not status. */}
              <span className="text-ink-4 shrink-0">
                · {KIND[bill.kind] ?? bill.kind}
              </span>
            </span>
          </>
        )
      },
    },
    {
      id: "site",
      header: "Unit",
      size: 9,
      meta: { priority: 4, min: 90 },
      cell: ({ row }) => (
        <span className="text-ink-2 truncate">{row.original.site_id}</span>
      ),
    },
    {
      id: "dates",
      header: "Dated · due",
      size: 14,
      meta: { priority: 3, min: 150, sortKey: "date" },
      cell: ({ row }) => {
        const bill = row.original
        return (
          <>
            <span className="text-ink-2 block">{day(bill.invoice_date)}</span>
            <span className="text-label text-ink-4 block">
              {bill.due_date === null ? "no due date" : day(bill.due_date)}
            </span>
          </>
        )
      },
    },
    {
      id: "total",
      header: "Total",
      size: 13,
      meta: { align: "right", priority: 2, min: 120, sortKey: "total" },
      cell: ({ row }) => (
        <span className="text-ink-2 tabular-nums">
          {amount(row.original.total_minor)}
        </span>
      ),
    },
    {
      id: "paid",
      header: "Paid",
      size: 13,
      meta: { align: "right", priority: 1, min: 120 },
      cell: ({ row }) => (
        <span className="text-ink-3 tabular-nums">
          {amount(row.original.paid_minor)}
        </span>
      ),
    },
    {
      id: "outstanding",
      header: "Outstanding",
      size: 14,
      // Never dropped. This is the figure the screen exists for.
      meta: { align: "right", min: 130, sortKey: "outstanding" },
      cell: ({ row }) => {
        const bill = row.original
        return (
          <span
            className={
              bill.outstanding_minor === 0
                ? "text-ink-4 tabular-nums"
                : "text-ink font-medium tabular-nums"
            }
          >
            {amount(bill.outstanding_minor)}
          </span>
        )
      },
    },
    {
      id: "status",
      header: "Status",
      size: 13,
      meta: { min: 130 },
      cell: ({ row }) => {
        const bill = row.original
        const known = STATUS[bill.status]
        return (
          <span className="flex flex-wrap items-center gap-1">
            <Tag tone={known?.tone ?? "neutral"}>
              {known?.label ?? bill.status}
            </Tag>
            <Due bill={bill} />
          </span>
        )
      },
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Payables &amp; Expenses"
        title="Supplier bills"
        description="What a supplier has billed us, what has been paid against it, and what is still owed."
        action={
          <Button variant="primary" icon={<FileText className="size-4" />}>
            Record a bill
          </Button>
        }
      />

      <Tabs
        label="Status"
        value={status}
        onChange={(value) => url.set({ status: value || null }, false)}
        tabs={[
          { value: "", label: "All" },
          { value: "POSTED", label: "Posted" },
          { value: "DRAFT", label: "Draft" },
        ]}
      />

      {/* A bill is a document dated on a day, and the list is every document —
          so the scope is a period, not a position. The ageing beside each row
          is the one thing here that IS a position, and it says so. */}
      <ScopeLine
        scope={{ kind: "during", period: "every period on file" }}
        note={<>ageing as at {day(today())}</>}
      />

      <Tiles>
        {/* Every figure here is the SERVER's, over the whole matched set —
            see `BillPage.total` and `.outstanding_minor`. Summed in the browser
            they would describe the pages fetched so far and grow while somebody
            scrolls, which on a payables screen is a total that lies quietly. */}
        <Tile
          label="Bills"
          value={head === undefined ? "—" : count(head.total)}
          note={q === "" ? "matching the filters" : `matching “${q}”`}
        />
        <Tile
          label="Billed"
          value={head?.total_minor ?? 0}
          note="every matching bill, added by the server"
        />
        <Tile
          label="Outstanding"
          value={head?.outstanding_minor ?? 0}
          tone={(head?.outstanding_minor ?? 0) > 0 ? "warn" : "ok"}
          note="net of what posted payments have taken"
        />
        {/* The facet the panel would draw, drawn as a figure instead: with two
            statuses and a tab strip above already offering them, a filter panel
            for this list would be a panel with one row in it. */}
        <Tile
          label="Draft"
          value={
            facets === undefined
              ? "—"
              : count(
                  facets.statuses.find((f) => f.value === "DRAFT")?.count ?? 0,
                )
          }
          note="not yet posted to the ledger"
        />
      </Tiles>

      <Toolbar
        trailing={
          <Loaded
            loaded={rows.length}
            total={list.total}
            pending={list.query.isPending}
            noun="bills"
          />
        }
      >
        <SearchField
          value={typed}
          onChange={(value) => url.set({ q: value || null })}
          placeholder="Search a number, a supplier or a note"
          className="w-[22rem]"
        />
        {supplier !== "" && (
          <Button
            variant="quiet"
            onClick={() => url.set({ supplier: null }, false)}
          >
            <Users className="size-4" /> {supplier} ✕
          </Button>
        )}
      </Toolbar>

      {list.query.isError ? (
        <Failed
          what="supplier bills"
          error={list.query.error}
          onRetry={() => void list.query.refetch()}
        />
      ) : list.query.isPending ? (
        <Loading cols={7} />
      ) : list.rows.length === 0 ? (
        <Empty
          what="supplier bills"
          detail="Nothing has been billed to us under this status yet."
        />
      ) : rows.length === 0 ? (
        <NoMatch
          what="bills"
          held={list.rows.length}
          onClear={() => url.set({ q: null }, false)}
        />
      ) : (
        <Table
          columns={columns}
          rows={rows}
          rowId={(row) => row.invoice_id}
          caption="Supplier bills"
          onRowClick={(row) => url.set({ bill: row.invoice_id }, false)}
          isOpen={(row) => row.invoice_id === openId}
          sort={{ key: sortKey, desc: sortDesc }}
          onSort={onSort}
          hasMore={list.hasMore}
          loadingMore={list.loadingMore}
          onNeedMore={list.loadMore}
          foot={{
            bill: (
              <>
                <b className="text-ink">{count(list.total)}</b> bills
              </>
            ),
            total: amount(head?.total_minor ?? 0),
            outstanding: (
              <b className="text-ink">{rp(head?.outstanding_minor ?? 0)}</b>
            ),
            status: list.loadingMore ? "Loading more…" : "over every match",
          }}
        />
      )}
    </div>
  )
}

/// How late a bill is, or how long there is.
///
/// `days_overdue` comes off the wire derived — a stored age would be wrong by
/// morning — but it has one trap worth handling here rather than in four
/// places: it is `COALESCE(CURRENT_DATE - due_date, 0)`, so **a bill with no
/// due date reports 0**, which is indistinguishable from one due today. The
/// two are not the same fact and this refuses to draw them alike.
function Due({ bill }: { bill: SupplierBill }) {
  if (bill.due_date === null) return null
  if (bill.outstanding_minor === 0) return null
  const days = bill.days_overdue
  if (days > 0) {
    return (
      <Tag tone="bad">
        {days === 1 ? "1 day late" : `${count(days)} days late`}
      </Tag>
    )
  }
  const left = Math.abs(days)
  if (left <= 7) {
    return <Tag tone="warn">{left === 0 ? "due today" : `due in ${left}d`}</Tag>
  }
  return null
}
