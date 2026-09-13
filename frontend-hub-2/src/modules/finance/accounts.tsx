import { useMemo } from "react"
import { useQueries, useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronRight, FileStack } from "lucide-react"
import type { AccountDetail, LedgerAccount } from "@itulah/contract"
import type { ColumnDef } from "@tanstack/react-table"

import { api, search } from "@/lib/api"
import { Button } from "@/kit/button"
import { PageHead, Toolbar } from "@/kit/page"
import { SearchField } from "@/kit/field"
import { Sheet } from "@/kit/sheet"
import { Table } from "@/kit/table"
import { Tag } from "@/kit/tag"
import { Truncated } from "@/kit/notice"
import { Empty, Failed, Loading, NoMatch } from "@/kit/state"
import { amount, count } from "@/lib/format"
import { useBoundedList } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import { useDebounced } from "@/lib/use-debounced"
import type { TableSetup } from "@/lib/table"
import { ROOT_CLASSES, ladderLevel } from "@/modules/finance/chart"
import { CheckField, Facts, SiteName } from "@/modules/finance/parts"

/// The chart of accounts — 7,528 of them, browsed the way they are numbered.
///
/// ## Why this screen never holds the whole chart
///
/// Because the whole chart is about a megabyte of JSON and somebody opening the
/// screen wants eight rows. There are exactly two things `GET /finance/accounts`
/// can narrow by, and this screen uses both and nothing else:
///
///   - `parent` — one rung of the ladder. No cursor and no limit, because a
///     heading has a handful of children and the answer is complete by
///     construction.
///   - `q` — code from the START, name anywhere, clamped by the server at 500.
///
/// It cannot sort, it cannot page, and it has no total. So there is no sortable
/// header here and no figure on this page claiming to be a count of the chart:
/// what the toolbar says is what is on screen, and when a search hits the clamp
/// the strip above the table says so.
///
/// ## Why the tree is one flat table rather than a component per branch
///
/// The obvious shape is a `<Branch>` that renders its children and recurses, one
/// query each. It reads well and it cannot be virtualised: every branch owns its
/// own scroll-less list, so opening four headings under CURRENT ASSET puts every
/// row of all four in the DOM, and the columns of one branch cannot line up with
/// the columns of another.
///
/// So the branches are fetched as a fan-out — `useQueries` over the open
/// parents, which is the one case `useQuery` cannot serve because the number of
/// reads changes as somebody clicks — and flattened into a single row list. One
/// table, one set of columns, one virtual window, and the indent is a padding
/// on the first cell.
///
/// ## Why which headings are open lives in the URL
///
/// It is the one piece of state on this screen worth sending to somebody: "the
/// account is under 1011001, here" is a link, and from component state the
/// recipient gets the eight roots. It also survives the reload that follows
/// pressing Back out of an account.

/// The clamp the server applies to a search — `limit.clamp(1, 500)` in
/// `search_accounts`. Asking for more is answered with 500 and no complaint,
/// which is why `useBoundedList` derives `truncated` from the row count.
const SEARCH_CAP = 500

/// A row of the flattened tree, or one search result.
///
/// `indent` rather than the account's own `depth`: in a search there are no
/// parents on screen, so stepping a twelve-digit result five rungs to the right
/// would be indentation pointing at nothing.
interface ChartRow {
  readonly account: LedgerAccount
  readonly indent: number
  readonly open: boolean
  readonly waiting: boolean
}

export function AccountsScreen() {
  const url = useQueryState()
  const typed = url.one("q")
  const inactive = url.one("inactive") === "1"
  const openCode = url.one("account")
  const opened = url.many("open")

  // The box waits for a pause. Here it spares the WIRE as well as the reading:
  // every keystroke is a `LIKE` over 7,528 rows and a fresh cache entry.
  const q = useDebounced(typed.trim(), 250)
  const searching = q.length >= 2

  // The search, when there is one. Bounded and honest about it: no cursor, no
  // total, and a server-side clamp — the exact shape `useBoundedList` exists
  // for. Disabled while browsing, so opening the screen costs one request.
  const results = useBoundedList<LedgerAccount>({
    key: ["finance", "accounts", "search"],
    path: "/api/v1/finance/accounts",
    params: { q, inactive: inactive ? "true" : null },
    limit: SEARCH_CAP,
    enabled: searching,
  })

  // One read per open heading, plus the roots. `useQueries` and not a loop of
  // `useQuery`, because the number of open headings changes as somebody clicks
  // and a hook cannot be called conditionally.
  //
  // The chart is imported once and then sits for months, so a branch reopened
  // twice in a session does not ask twice.
  const parents = useMemo(() => ["", ...opened], [opened])
  const branches = useQueries({
    queries: parents.map((parent) => ({
      queryKey: ["finance", "accounts", "children", parent, inactive] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.get<LedgerAccount[]>(
          `/api/v1/finance/accounts${search({
            parent: parent === "" ? null : parent,
            inactive: inactive ? "true" : null,
          })}`,
          signal,
        ),
      staleTime: 10 * 60 * 1000,
      enabled: !searching,
    })),
  })

  const roots = branches[0]

  // The tree, flattened depth-first in code order — which is the order the
  // server returns each level in, and the order the chart is printed in.
  //
  // Computed on every render rather than memoised, and that is a decision:
  // `useQueries` hands back a fresh results array each time, so there is
  // nothing stable to key a memo on, and a memo keyed on something unstable is
  // a memo that runs anyway plus a comparison. The walk is over the open
  // branches only — a few hundred rows at the very worst — and the table below
  // is virtualised, so the cost is the walk and nothing else.
  const rows: ChartRow[] = []
  if (searching) {
    for (const account of results.rows) {
      rows.push({ account, indent: 0, open: false, waiting: false })
    }
  } else {
    const byParent = new Map<string, readonly LedgerAccount[]>()
    parents.forEach((parent, index) => {
      const data = branches[index]?.data
      if (data !== undefined) byParent.set(parent, data)
    })
    const isOpen = new Set(opened)
    // A heading whose own parent is closed contributes nothing: the walk only
    // descends through what is open, so a stale `?open=` naming a branch three
    // levels down is simply not reached rather than being an error.
    const walk = (parent: string) => {
      for (const account of byParent.get(parent) ?? []) {
        const open = isOpen.has(account.account_code)
        rows.push({
          account,
          indent: ladderLevel(account.depth),
          open,
          waiting: open && !byParent.has(account.account_code),
        })
        if (open) walk(account.account_code)
      }
    }
    walk("")
  }

  const toggle = (code: string) => {
    const next = opened.includes(code)
      ? // Closing a heading closes what is under it too. Otherwise reopening it
        // restores four levels somebody had closed by closing the top of them,
        // which reads as the screen having remembered the wrong thing.
        opened.filter((row) => row !== code && !row.startsWith(code))
      : [...opened, code]
    url.set({ open: next.length === 0 ? null : next }, false)
  }

  const columns: ColumnDef<TableSetup, ChartRow>[] = [
    {
      id: "account",
      header: "Account",
      size: 46,
      // No priority: the code and the client's name for it are the whole row.
      meta: { icon: <FileStack className="size-[15px]" />, min: 300 },
      cell: ({ row }) => {
        const { account, indent, open, waiting } = row.original
        const heading = account.child_count > 0
        return (
          <span
            className="flex min-w-0 items-center gap-2"
            style={{ paddingLeft: `${indent * 1.125}rem` }}
          >
            <button
              type="button"
              // The chevron opens the heading; the ROW opens the account. Two
              // different things to want from one line, so two targets — and
              // the click must not do both, which is what the stop is for.
              onClick={(event) => {
                event.stopPropagation()
                toggle(account.account_code)
              }}
              disabled={!heading}
              aria-label={open ? "Collapse" : "Expand"}
              aria-expanded={heading ? open : undefined}
              className="rounded-tag text-ink-4 hover:text-ink grid size-5 shrink-0 place-items-center transition-colors disabled:opacity-0"
            >
              {open ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
            </button>
            <Tag tone={account.is_active ? "neutral" : "warn"}>
              <span className="font-mono">{account.account_code}</span>
            </Tag>
            <span
              className={
                account.is_group
                  ? "text-ink min-w-0 flex-1 truncate font-medium"
                  : "text-ink-2 min-w-0 flex-1 truncate"
              }
            >
              {account.name}
            </span>
            {waiting && (
              <span className="text-label text-ink-4 shrink-0">opening…</span>
            )}
          </span>
        )
      },
    },
    {
      id: "class",
      header: "Class",
      size: 18,
      meta: { priority: 3, min: 160 },
      cell: ({ row }) => (
        <span className="text-ink-3 truncate">
          {ROOT_CLASSES[row.original.account.root_class] ??
            row.original.account.root_class}
        </span>
      ),
    },
    {
      id: "site",
      header: "Unit",
      size: 14,
      meta: { priority: 2, min: 120 },
      cell: ({ row }) => {
        const account = row.original.account
        // A goods-in-transit leaf names a ROUTE rather than a place: the code
        // says where the stock came from and where it is going, and drawing
        // only one end of it would file half the chart under the wrong shop.
        if (account.counterparty_site_id !== null) {
          return (
            <span className="text-ink-3 truncate">
              <SiteName id={account.counterparty_site_id} /> →{" "}
              <SiteName id={account.site_id} />
            </span>
          )
        }
        return (
          <span className="text-ink-3 truncate">
            <SiteName id={account.site_id} />
          </span>
        )
      },
    },
    {
      id: "kind",
      header: "Kind",
      size: 13,
      meta: { priority: 1, min: 130 },
      cell: ({ row }) => {
        const account = row.original.account
        return (
          <span className="flex flex-wrap items-center gap-1">
            {/* A heading has a balance by summation and nothing may be posted
                to it — which is why the account map refuses one, and why this
                is a fact about the row rather than decoration. */}
            <Tag>{account.is_group ? "Heading" : "Postable"}</Tag>
            {!account.is_active && <Tag tone="warn">Inactive</Tag>}
          </span>
        )
      },
    },
    {
      id: "children",
      header: "Under it",
      size: 9,
      meta: { align: "right", min: 100 },
      cell: ({ row }) => (
        <span className="text-ink-4 tabular-nums">
          {row.original.account.child_count === 0
            ? "—"
            : count(row.original.account.child_count)}
        </span>
      ),
    },
  ]

  const failed = searching ? results.query.isError : roots?.isError === true
  const pending = searching ? results.query.isPending : roots?.isPending === true
  const fetching = searching
    ? results.query.isFetching
    : branches.some((branch) => branch.isFetching)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Ledger Setup"
        title="Chart of accounts"
        description="The client's own chart, in their own words and their own numbering. Nothing here is translated."
      />

      {/* No scope line and no tiles, and both are deliberate. A chart of
          accounts stands on no date — it is the list of places a figure can go,
          not a figure — and a tile here could only repeat the row count the
          toolbar already states. See `kit/tiles.tsx` on what a tile is for. */}

      <Toolbar
        trailing={
          pending
            ? "Loading…"
            : searching
              ? `${count(rows.length)} of at most ${count(SEARCH_CAP)} shown`
              : `${count(rows.length)} rows open`
        }
      >
        <SearchField
          value={typed}
          onChange={(value) => url.set({ q: value || null })}
          placeholder="Search a code from the start, or a name anywhere"
          className="w-[24rem]"
        />
        <CheckField
          label="Include inactive"
          checked={inactive}
          onChange={(next) => url.set({ inactive: next ? "1" : null }, false)}
        />
        {!searching && opened.length > 0 && (
          <Button variant="quiet" onClick={() => url.set({ open: null }, false)}>
            Collapse all
          </Button>
        )}
        {fetching && !pending && (
          <span className="text-ctl text-ink-4">Loading…</span>
        )}
      </Toolbar>

      {searching && results.truncated && (
        <Truncated limit={SEARCH_CAP} noun="matching accounts" />
      )}

      {failed ? (
        <Failed
          what="the chart of accounts"
          error={searching ? results.query.error : roots?.error}
          onRetry={() =>
            void (searching ? results.query.refetch() : roots?.refetch())
          }
        />
      ) : pending ? (
        <Loading cols={5} />
      ) : rows.length === 0 ? (
        searching ? (
          <NoMatch
            what="accounts"
            onClear={() => url.set({ q: null }, false)}
          />
        ) : (
          <Empty
            what="accounts"
            detail="No chart has been imported. Until one is, nothing can be posted anywhere."
          />
        )
      ) : (
        <Table
          columns={columns}
          rows={rows}
          rowId={(row) => row.account.account_code}
          caption="Chart of accounts"
          onRowClick={(row) =>
            url.set(
              {
                account:
                  row.account.account_code === openCode
                    ? null
                    : row.account.account_code,
              },
              false,
            )
          }
          isOpen={(row) => row.account.account_code === openCode}
          foot={{
            account: searching ? (
              <>
                <b className="text-ink">{count(rows.length)}</b> match “{q}”
              </>
            ) : (
              <>
                <b className="text-ink">{count(rows.length)}</b> rows open ·
                codes are matched from the start
              </>
            ),
          }}
        />
      )}

      <AccountSheet
        code={openCode}
        onClose={() => url.set({ account: null }, false)}
      />
    </div>
  )
}

/// One account, the headings above it, and what it is worth.
///
/// Its own read rather than the row that was clicked, because the row does not
/// carry either of the two things this panel exists for: the chain of parents
/// that makes a twelve-digit code readable, and the balance.
function AccountSheet({ code, onClose }: { code: string; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["finance", "account", code] as const,
    enabled: code !== "",
    queryFn: ({ signal }) =>
      api.get<AccountDetail>(
        `/api/v1/finance/accounts/${encodeURIComponent(code)}`,
        signal,
      ),
  })

  if (code === "") return null

  const data = detail.data
  return (
    <Sheet
      open
      onClose={onClose}
      width="record"
      title={data?.account.name ?? (detail.isPending ? "Loading…" : "Account")}
      subtitle={<span className="font-mono">{code}</span>}
      foot={
        <>
          <span className="text-label text-ink-4 flex-1">
            {data?.account.is_group
              ? "A heading. Its balance is everything under it, and nothing may be posted to it."
              : "Balances are as at today, over this account's own postings."}
          </span>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {detail.isError ? (
        <Failed
          what="this account"
          error={detail.error}
          onRetry={() => void detail.refetch()}
        />
      ) : data === undefined ? (
        <Loading rows={4} cols={2} />
      ) : (
        <div className="flex flex-col gap-5 p-[18px]">
          {/* The headings above it, outermost first. This is the whole reason
              a detail panel beats the row: `101100100101` means nothing until
              you can see it sits under CASH ON HAND, under KAS & SETARA KAS. */}
          <div className="text-ctl text-ink-3 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {data.path.map((step) => (
              <span key={step.account_code} className="flex items-center gap-1.5">
                <span className="truncate">{step.name}</span>
                <span className="text-ink-4">/</span>
              </span>
            ))}
            <span className="text-ink font-medium">{data.account.name}</span>
          </div>

          <Facts
            rows={[
              [
                "Class",
                `${data.account.root_class} · ${ROOT_CLASSES[data.account.root_class] ?? "—"}`,
              ],
              ["Kind", data.account.is_group ? "Heading" : "Postable"],
              ["Unit", <SiteName key="unit" id={data.account.site_id} />],
              ["State", data.account.is_active ? "Active" : "Inactive"],
              ["Under it", count(data.account.child_count)],
            ]}
          />

          <div>
            <h4 className="text-cell text-ink mb-2 font-semibold">
              {data.account.is_group
                ? "Balance, including everything under it"
                : "Balance"}
            </h4>
            {data.balance.debit_minor === 0 &&
            data.balance.credit_minor === 0 ? (
              <p className="text-ctl text-ink-3">
                Nothing has been posted here yet.
              </p>
            ) : (
              <Facts
                rows={[
                  ["Debits", amount(data.balance.debit_minor)],
                  ["Credits", amount(data.balance.credit_minor)],
                  // Signed as the ledger holds it — debits positive — and
                  // deliberately not flipped for a liability or an income
                  // account. A report decides how to present a balance; a
                  // balance does not decide how to present itself.
                  ["Debit less credit", amount(data.balance.balance_minor)],
                ]}
              />
            )}
          </div>

          {data.account.counterparty_site_id !== null && (
            <p className="text-ctl text-ink-3">
              A goods-in-transit account: the code names a route rather than a
              place, and the goods came from{" "}
              <SiteName
                id={data.account.counterparty_site_id}
                className="text-ink font-medium"
              />
              .
            </p>
          )}
        </div>
      )}
    </Sheet>
  )
}
