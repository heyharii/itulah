import { useMemo } from "react"
import { BookOpen, CalendarDays } from "lucide-react"
import type { TrialBalance, TrialBalanceRow } from "@itulah/contract"
import type { ColumnDef } from "@tanstack/react-table"

import { PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { SearchField } from "@/kit/field"
import { Table } from "@/kit/table"
import { Tag } from "@/kit/tag"
import { Tile, Tiles } from "@/kit/tiles"
import { Empty, Failed, Loading, NoMatch } from "@/kit/state"
import { amount, count, rp, today } from "@/lib/format"
import { useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import { useDebounced } from "@/lib/use-debounced"
import type { TableSetup } from "@/lib/table"

/// Trial balance — every account, and whether the books balance.
///
/// ## The one figure this screen exists for
///
/// Total debits minus total credits. If it is not zero the ledger is broken and
/// nothing else on any finance screen can be trusted, so it is drawn first,
/// large, and in words rather than as a number somebody has to subtract in
/// their head.
///
/// Everything else here is a way of finding WHERE the difference is. The
/// account list is sorted as the server sorts it — by code — because a trial
/// balance is read by walking the chart, not by ranking anything.
///
/// ## Why the class column is worth its width
///
/// `root_class` is what separates a balance sheet account from a profit and
/// loss one, and that separation is the reason two accounts with the same
/// balance mean opposite things. It is also how somebody scanning for a
/// misposting narrows the search: a cost sitting in an asset class is visible
/// as a class, and invisible as a number.

const CLASS_LABEL: Record<string, string> = {
  ASSET: "Asset",
  LIABILITY: "Liability",
  EQUITY: "Equity",
  REVENUE: "Revenue",
  EXPENSE: "Expense",
}

export function LedgerScreen() {
  const url = useQueryState()
  const asOf = url.one("as_at") || today()
  const site = url.one("site")
  const typed = url.one("q")
  const q = useDebounced(typed, 200)

  const report = useReport<TrialBalance>({
    key: ["finance", "trial-balance"],
    path: "/api/v1/finance/trial-balance",
    params: { as_of: asOf, site: site || null },
  })

  const all = useMemo(() => report.data?.rows ?? [], [report.data])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (needle === "") return all
    return all.filter((row) =>
      `${row.account_code} ${row.name}`.toLowerCase().includes(needle),
    )
  }, [all, q])

  const debit = report.data?.total_debit_minor ?? 0
  const credit = report.data?.total_credit_minor ?? 0
  const difference = debit - credit

  const columns: ColumnDef<TableSetup, TrialBalanceRow>[] = [
    {
      id: "account",
      header: "Account",
      size: 40,
      meta: { icon: <BookOpen className="size-[15px]" />, min: 250 },
      cell: ({ row }) => (
        <>
          <span className="text-ink block truncate font-medium">
            {row.original.name}
          </span>
          <span className="text-label text-ink-4 block font-mono">
            {row.original.account_code}
          </span>
        </>
      ),
    },
    {
      id: "class",
      header: "Class",
      size: 14,
      meta: { priority: 2, min: 120 },
      cell: ({ row }) => (
        <Tag>
          {CLASS_LABEL[row.original.root_class] ?? row.original.root_class}
        </Tag>
      ),
    },
    {
      id: "site",
      header: "Unit",
      size: 10,
      meta: { priority: 1, min: 90 },
      cell: ({ row }) => (
        <span className="text-ink-3 truncate">
          {row.original.site_id ?? "—"}
        </span>
      ),
    },
    {
      id: "debit",
      header: "Debit",
      size: 18,
      meta: { align: "right", min: 130 },
      cell: ({ row }) => (
        <span
          className={
            row.original.debit_minor === 0
              ? "text-ink-4 tabular-nums"
              : "text-ink-2 tabular-nums"
          }
        >
          {row.original.debit_minor === 0
            ? "—"
            : amount(row.original.debit_minor)}
        </span>
      ),
    },
    {
      id: "credit",
      header: "Credit",
      size: 18,
      meta: { align: "right", min: 130 },
      cell: ({ row }) => (
        <span
          className={
            row.original.credit_minor === 0
              ? "text-ink-4 tabular-nums"
              : "text-ink-2 tabular-nums"
          }
        >
          {row.original.credit_minor === 0
            ? "—"
            : amount(row.original.credit_minor)}
        </span>
      ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="General Ledger &amp; Closing"
        title="Trial balance"
        description="Every account with a balance on the day you choose, and whether the two sides agree."
      />

      <ScopeLine
        scope={{ kind: "asAt", date: asOf }}
        unit={site || undefined}
        note="balances, not movements"
      />

      <Tiles>
        <Tile label="Debits" value={debit} />
        <Tile label="Credits" value={credit} />
        <Tile
          label="Difference"
          // The sentence, not the subtraction. "Balanced" is the answer
          // somebody came for; a zero they have to recognise as a zero is a
          // worse way of saying it.
          value={
            difference === 0 ? (
              <span className="text-ok-ink">Balanced</span>
            ) : (
              rp(Math.abs(difference))
            )
          }
          tone={difference === 0 ? "ok" : "bad"}
          note={
            difference === 0
              ? "debits equal credits"
              : difference > 0
                ? "more debit than credit"
                : "more credit than debit"
          }
        />
        <Tile
          label="Accounts"
          value={count(all.length)}
          note="with a balance"
        />
      </Tiles>

      <Toolbar trailing={report.isFetching ? "Loading…" : undefined}>
        <SearchField
          value={typed}
          onChange={(value) => url.set({ q: value || null })}
          placeholder="Find an account by code or name"
          className="w-[22rem]"
        />
        <label className="h-ctl rounded-ctl border-line-2 bg-canvas shadow-btn focus-within:border-blue flex shrink-0 items-center gap-2 border px-2.5">
          <CalendarDays className="text-ink-4 size-4 shrink-0" />
          <span className="text-ctl text-ink-4">As at</span>
          <input
            type="date"
            value={asOf}
            max={today()}
            onChange={(event) =>
              url.set({
                as_at:
                  event.target.value === today() ? null : event.target.value,
              })
            }
            className="text-ctl text-ink bg-transparent outline-none"
          />
        </label>
      </Toolbar>

      {report.isError ? (
        <Failed
          what="the trial balance"
          error={report.error}
          onRetry={() => void report.refetch()}
        />
      ) : report.isPending ? (
        <Loading cols={5} />
      ) : all.length === 0 ? (
        <Empty
          what="accounts with a balance"
          detail={`Nothing had been posted as at ${asOf}.`}
        />
      ) : rows.length === 0 ? (
        <NoMatch
          what="accounts"
          held={all.length}
          onClear={() => url.set({ q: null }, false)}
        />
      ) : (
        <Table
          columns={columns}
          rows={rows as TrialBalanceRow[]}
          rowId={(row) => `${row.account_code}:${row.site_id ?? ""}`}
          caption={`Trial balance as at ${asOf}`}
          foot={{
            account: (
              <>
                <b className="text-ink">{count(rows.length)}</b> accounts
                {rows.length !== all.length && <> of {count(all.length)}</>}
              </>
            ),
            // Always the WHOLE trial balance, never the filtered rows — a
            // total that moved when somebody typed in the search box would not
            // be a trial balance, and the one question this screen answers is
            // whether the whole thing balances.
            debit: <b className="text-ink">{amount(debit)}</b>,
            credit: <b className="text-ink">{amount(credit)}</b>,
          }}
        />
      )}
    </div>
  )
}
