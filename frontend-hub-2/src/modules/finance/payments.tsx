import { Banknote, Send } from "lucide-react"
import type { PaymentPage, SupplierPayment } from "@itulah/contract"
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
import { amount, count, day, rp } from "@/lib/format"
import { useCursorList } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import { useDebounced } from "@/lib/use-debounced"
import type { TableSetup } from "@/lib/table"

/// Payments to suppliers — one register, both directions of the question.
///
/// ## Three states, and only two of them exist
///
/// The design this screen was drawn from asks for three separate status
/// columns, because they are three separate questions answered by three
/// different people:
///
///   1. **Stage** — has the instruction been carried out?
///   2. **Posted** — is it in the general ledger?
///   3. **Reconciled** — has it appeared on a bank statement?
///
/// Only the first two can be answered from this payload, and the third cannot
/// be faked. `status` is `DRAFT | POSTED` and the database ties it to
/// `journal_entry_id` and `posted_at` with three constraints — so stage and
/// posted are **the same fact**, not two. There is no approval step in the
/// data at all; the migration says so in as many words.
///
/// Reconciliation lives in `bank_line_match`, keyed on **journal_line_id**, and
/// a payment only carries its `journal_entry_id` — the entry, not its lines.
/// No endpoint returns a payment's lines or their match state. So the third
/// column is drawn as an em dash with the reason on hover, rather than as a
/// guess. A status column that quietly means "we did not ask" is worse than a
/// missing one: somebody will reconcile against it.
///
/// The fix is small and belongs on the server: a `reconciled` or
/// `unmatched_line_count` on `SupplierPayment`, computed the same way
/// `BankStatementRow.matched_count` already is.
///
/// ## Every narrowing is the server's
///
/// Like bills next door, this screen was first written against an endpoint that
/// took only `limit` and answered with a bare array. It now carries a scope
/// struct, a keyset cursor and an envelope: `q`, `status`, `site`, `supplier`,
/// `sort` and `dir` go on the wire, and `total`, `total_minor` and the facet
/// counts describe the whole matched set rather than the page.

const PAGE = 50

const STATUS: Record<
  string,
  { label: string; tone: "neutral" | "ok" | "warn" }
> = {
  DRAFT: { label: "Draft", tone: "warn" },
  POSTED: { label: "Posted", tone: "ok" },
}

const METHOD: Record<string, string> = {
  TRANSFER: "Transfer",
  CASH: "Cash",
  CHEQUE: "Cheque",
  CHECK: "Cheque",
  GIRO: "Giro",
  OTHER: "Other",
}

export function PaymentsScreen() {
  const url = useQueryState()
  const typed = url.one("q")
  const status = url.one("status")
  const site = url.one("site")
  const openId = url.one("payment")
  const sortKey = url.one("sort") || "default"
  const sortDesc = url.one("dir") === "desc"
  const q = useDebounced(typed, 200)

  // Three keys the server names — `date`, `total`, `number`. Anything else
  // falls back to its house order rather than refusing, so an old bookmark
  // still opens.
  const onSort = (key: string) => {
    const same = sortKey === key
    url.set({ sort: key, dir: same ? (sortDesc ? null : "desc") : "desc" })
  }

  const list = useCursorList<SupplierPayment>({
    key: ["finance", "payments"],
    path: "/api/v1/finance/payments",
    params: {
      q,
      status: status || null,
      site: site || null,
      sort: sortKey === "default" ? null : sortKey,
      dir: sortDesc ? "desc" : null,
    },
    limit: PAGE,
  })

  const rows = list.rows
  const head = list.head as PaymentPage | undefined
  const facets = head?.facets
  // The facet count answers "how many drafts are there", over everything the
  // SEARCH matches and deliberately ignoring which tab is open — so the figure
  // does not become "how many are left after what you already ticked", which
  // reads as every unticked box showing a zero.
  const drafts =
    facets?.statuses.find((f) => f.value === "DRAFT")?.count ?? undefined

  const columns: ColumnDef<TableSetup, SupplierPayment>[] = [
    {
      id: "payment",
      header: "Payment",
      size: 20,
      meta: {
        icon: <Banknote className="size-[15px]" />,
        min: 190,
        sortKey: "number",
      },
      cell: ({ row }) => {
        const payment = row.original
        return (
          <>
            <span className="text-ink block truncate font-medium">
              {payment.payment_number}
            </span>
            <span className="text-label text-ink-4 block truncate">
              {day(payment.payment_date)} · {payment.site_id}
            </span>
          </>
        )
      },
    },
    {
      id: "paid_to",
      header: "Paid to",
      size: 20,
      meta: { priority: 3, min: 170 },
      cell: ({ row }) => {
        // One payment can settle several bills from several suppliers, which is
        // the whole reason a register exists. The first name plus a count is
        // the honest summary; the rest is the detail panel's job.
        const parties = [
          ...new Set(
            row.original.allocations.map(
              (a) => a.supplier_name ?? a.supplier_id,
            ),
          ),
        ]
        if (parties.length === 0) {
          return <span className="text-ink-4">nothing allocated</span>
        }
        return (
          <>
            <span className="text-ink-2 block truncate">{parties[0]}</span>
            <span className="text-label text-ink-4 block">
              {count(row.original.allocations.length)}{" "}
              {row.original.allocations.length === 1 ? "bill" : "bills"}
              {parties.length > 1 && <> · +{parties.length - 1} more</>}
            </span>
          </>
        )
      },
    },
    {
      id: "from",
      header: "From",
      size: 16,
      meta: { priority: 2, min: 150 },
      cell: ({ row }) => {
        const payment = row.original
        return (
          <>
            <span className="text-ink-2 block truncate">
              {/* Never a bare code when the name resolved — the code is the
                  fallback, not the label. */}
              {payment.account_name ??
                payment.account_code ??
                `${payment.account_key} ${payment.account_qualifier}`}
            </span>
            <span className="text-label text-ink-4 block">
              {METHOD[payment.method] ?? payment.method}
            </span>
          </>
        )
      },
    },
    {
      id: "amount",
      header: "Amount",
      size: 14,
      meta: { align: "right", min: 125, sortKey: "total" },
      cell: ({ row }) => (
        <span className="text-ink font-medium tabular-nums">
          {amount(row.original.total_minor)}
        </span>
      ),
    },
    {
      id: "stage",
      header: "Stage",
      size: 11,
      meta: { min: 105 },
      cell: ({ row }) => {
        const known = STATUS[row.original.status]
        return (
          <Tag tone={known?.tone ?? "neutral"}>
            {known?.label ?? row.original.status}
          </Tag>
        )
      },
    },
    {
      id: "books",
      header: "In the books",
      size: 12,
      meta: { priority: 1, min: 120 },
      cell: ({ row }) => {
        const payment = row.original
        // Posted and not-posted are drawn differently from reconciled and
        // not-reconciled on purpose — see the header comment. Two em dashes
        // side by side would read as one fact about which nothing is known.
        if (payment.entry_number === null) {
          return <span className="text-ink-4">not posted</span>
        }
        return (
          <>
            <span className="text-label text-ink-2 block truncate font-mono">
              {payment.entry_number}
            </span>
            {payment.posted_by !== null && (
              <span className="text-label text-ink-4 block truncate">
                {payment.posted_by}
              </span>
            )}
          </>
        )
      },
    },
    {
      id: "reconciled",
      header: "Reconciled",
      size: 11,
      meta: { min: 110 },
      cell: () => (
        <span
          className="text-ink-4"
          // The tooltip is the whole content of this column today. It says
          // which question was not asked, so nobody reads the dash as "no".
          title="Not on the wire. Reconciliation is keyed on the journal LINE, and a payment carries only its entry — no endpoint returns the lines or their match state."
        >
          —
        </span>
      ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Cash &amp; Banking"
        title="Payments"
        description="Money sent to suppliers: what it settled, which account it left, and how far it has got."
        action={
          <Button variant="primary" icon={<Send className="size-4" />}>
            Prepare a payment
          </Button>
        }
      />

      <Tabs
        label="Stage"
        value={status}
        onChange={(value) => url.set({ status: value || null }, false)}
        tabs={[
          { value: "", label: "All" },
          { value: "POSTED", label: "Posted" },
          { value: "DRAFT", label: "Draft" },
        ]}
      />

      <ScopeLine
        scope={{ kind: "during", period: "every period on file" }}
        unit={site || undefined}
      />

      <Tiles>
        {/* The server's figures, over every matching payment — see
            `PaymentPage.total_minor`. */}
        <Tile
          label="Payments"
          value={head === undefined ? "—" : count(head.total)}
          note={q === "" ? "matching the filters" : `matching “${q}”`}
        />
        <Tile
          label="Value"
          value={head?.total_minor ?? 0}
          note="every matching payment, added by the server"
        />
        <Tile
          label="Draft"
          value={drafts === undefined ? "—" : count(drafts)}
          tone={(drafts ?? 0) > 0 ? "warn" : undefined}
          note="reserved against bills, not yet paid"
        />
      </Tiles>

      <Toolbar
        trailing={
          <Loaded
            loaded={rows.length}
            total={list.total}
            pending={list.query.isPending}
            noun="payments"
          />
        }
      >
        <SearchField
          value={typed}
          onChange={(value) => url.set({ q: value || null })}
          placeholder="Search a number, a reference or a supplier"
          className="w-[22rem]"
        />
      </Toolbar>

      {list.query.isError ? (
        <Failed
          what="payments"
          error={list.query.error}
          onRetry={() => void list.query.refetch()}
        />
      ) : list.query.isPending ? (
        <Loading cols={7} />
      ) : list.rows.length === 0 ? (
        <Empty
          what="payments"
          detail="Nothing has been paid to a supplier under this stage yet."
        />
      ) : rows.length === 0 ? (
        <NoMatch
          what="payments"
          held={list.rows.length}
          onClear={() => url.set({ q: null }, false)}
        />
      ) : (
        <Table
          columns={columns}
          rows={rows}
          rowId={(row) => row.payment_id}
          caption="Supplier payments"
          onRowClick={(row) => url.set({ payment: row.payment_id }, false)}
          isOpen={(row) => row.payment_id === openId}
          sort={{ key: sortKey, desc: sortDesc }}
          onSort={onSort}
          hasMore={list.hasMore}
          loadingMore={list.loadingMore}
          onNeedMore={list.loadMore}
          foot={{
            payment: (
              <>
                <b className="text-ink">{count(list.total)}</b> payments
              </>
            ),
            amount: <b className="text-ink">{rp(head?.total_minor ?? 0)}</b>,
            reconciled: "not on the wire",
          }}
        />
      )}
    </div>
  )
}
