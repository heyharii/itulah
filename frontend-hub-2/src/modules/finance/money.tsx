import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import {
  Banknote,
  Check,
  AlertTriangle,
  CreditCard,
  FileText,
  CalendarDays,
  ListFilter,
  MapPin,
  Scale,
  Upload,
  Wallet,
} from "lucide-react"
import type { MoneyAccountRow, MoneyOverview, MoneyPot } from "@itulah/contract"

import { api, search } from "@/lib/api"
import { cn } from "@/lib/cn"
import { count, day, rp, today } from "@/lib/format"
import { useAnimatedList } from "@/lib/animate"
import { useQueryState } from "@/lib/query-state"
import { useDebounced } from "@/lib/use-debounced"
import { AppLink } from "@/kit/app-link"
import { Button } from "@/kit/button"
import { Figure } from "@/kit/figure"
import { CheckRow, SearchField } from "@/kit/field"
import { Sheet } from "@/kit/sheet"
import { Tabs } from "@/kit/tabs"
import { ToneTag } from "@/kit/tag"
import { Table } from "@/kit/table"
import type { ColumnDef } from "@tanstack/react-table"
import { type TableSetup } from "@/lib/table"

/// Cash & bank — how much we hold, and whether the bank agrees.
///
/// This screen lists ACCOUNTS, not movements; movements have their own screen.
/// One row is one mapped money account at one location, which means it is the
/// account map read through the ledger: a meaning nobody has mapped is not yet
/// a place money can sit, and it is honestly absent rather than guessed at.
///
/// ## Everything that narrows the list is done by the server
///
/// Search, both facet filters and the paging all go on the wire. It would be
/// less code to fetch every row and narrow it in the browser, and it would be
/// wrong in a way that gets worse quietly: the filter panel's counts would
/// describe what has been DOWNLOADED rather than what exists, so "Bank 4" would
/// mean "four so far". A count that changes as you scroll is worse than none.

/// The five pots, as the server groups them, and what each is FOR.
///
/// The classification itself is the server's — see `MoneyPot` in the contract —
/// because the filter counts are grouped by it, and a client that re-derived
/// the grouping would eventually disagree with the numbers in its own filter
/// panel. What lives here is only how each one looks and what it is called.
///
/// The notes are not decoration. Cash in hand and a cashier float are the same
/// notes in the same till and are governed by opposite rules: one must be
/// banked every day, the other must never be spent.
const POT: Record<
  MoneyPot,
  { label: string; tone: string; note: string; icon: typeof Wallet }
> = {
  CASH: {
    label: "Cash in hand",
    tone: "#B45309",
    note: "Banked every day",
    icon: Wallet,
  },
  PETTY_CASH: {
    label: "Petty cash",
    tone: "#15803D",
    note: "Small day-to-day spending",
    icon: Wallet,
  },
  CASHIER_FLOAT: {
    label: "Cashier float",
    tone: "#6D28D9",
    note: "A fixed amount, never spent",
    icon: Wallet,
  },
  BANK: {
    label: "Bank",
    tone: "#1D4ED8",
    note: "Current and savings accounts",
    icon: Banknote,
  },
  CARD_RECEIVABLE: {
    label: "Card receivable",
    tone: "#B91C7A",
    note: "Owed by a scheme, not yet settled",
    icon: CreditCard,
  },
}

/// The difference column, which is the easiest column here to make lie.
/// Four states, four renderings:
///
///   not a bank account   → an em dash. Cash, petty cash, a float and a card
///     receivable never receive a bank statement, so "no statement yet" would
///     report something missing when nothing is — and a hundred rows saying it
///     hide the one bank row that genuinely is waiting.
///   a bank, no statement → "none yet", grey. This one really is waiting.
///   zero                 → "agrees", green, with a tick.
///   anything else        → the figure, red, with its sign.
///
/// Collapsing any of these into "agrees" is the fastest way to make somebody
/// believe an account has been reconciled when nobody has looked at it.
function Difference({ row }: { row: MoneyAccountRow }) {
  if (row.difference_minor === null) {
    return row.pot === "BANK" ? (
      <span className="text-ink-4">none yet</span>
    ) : (
      <span
        className="text-ink-4"
        title="Cash, petty cash, floats and card receivables take no bank statement"
      >
        —
      </span>
    )
  }
  if (row.difference_minor === 0) {
    return (
      <span className="text-ok-ink inline-flex items-center gap-[5px] font-medium">
        <Check className="size-[13px] stroke-[2.4]" /> agrees
      </span>
    )
  }
  // A difference with unmatched statement lines behind it is UNFINISHED WORK;
  // one with none is a real disagreement. The contract carries the count
  // precisely so the two can be told apart, and rendering them identically
  // sends somebody hunting for an error when the answer is "nobody has
  // finished ticking it off yet".
  const unfinished = (row.last_statement?.unmatched_count ?? 0) > 0
  return (
    <>
      <span className="text-bad-ink font-medium tabular-nums">
        {row.difference_minor > 0 ? "+" : "−"}{" "}
        {rp(Math.abs(row.difference_minor))}
      </span>
      {unfinished && (
        <span className="text-label text-ink-4 block">
          {count(row.last_statement?.unmatched_count)} lines unmatched
        </span>
      )}
    </>
  )
}

/// What each state flag is called, and what colour it carries.
///
/// The words are the finding, not the rule: "the bank disagrees" is what a
/// treasurer would say out loud, and it is what the row is being pointed at
/// for. Naming it `DIFFERS` on screen would make somebody translate a server
/// enum in their head.
const FLAG: Record<string, string> = {
  DIFFERS: "The bank disagrees",
  NO_STATEMENT: "No statement yet",
  UNMATCHED: "Lines not ticked off",
  NEGATIVE: "Balance is negative",
}
const FLAG_TONE: Record<string, string> = {
  DIFFERS: "#be123c",
  NO_STATEMENT: "#9c9c95",
  UNMATCHED: "#b45309",
  NEGATIVE: "#be123c",
}

/// How many rows one page holds.
///
/// Fifty rather than the server's ceiling of 200: a page is a unit of LATENCY,
/// not of completeness. Fifty comes back fast enough that the scroll never
/// waits, and the virtualiser draws about thirty at a time anyway — so a bigger
/// page would buy nothing a reader could see.
const PAGE = 50

export function MoneyScreen() {
  // Everything that narrows this list is in the URL — see `useQueryState` for
  // the four things that buys. `typed` is the exception and deliberately so:
  // it is what is in the box this instant, and putting a keystroke in the
  // address bar is a history entry per letter.
  const url = useQueryState()
  // Facets come and go as the search narrows — see `lib/animate.ts` for why
  // this is here and deliberately not on the table.
  const facetList = useAnimatedList<HTMLDivElement>()
  const asOf = url.one("as_at") || today()
  const typed = url.one("q")
  // Kind is a TAB, so it holds one value or none — see `kit/tabs.tsx` for why
  // it is not a filter. The empty string is the "All" tab.
  const pot = url.one("pot")
  const sites = url.many("site")
  const flags = url.many("flag")
  const sortKey = url.one("sort") || "default"
  const sortDesc = url.one("dir") === "desc"
  const filterOpen = url.one("panel") === "filter"
  // Which record is open, as its natural key. In the URL like everything else,
  // so a row can be linked to — "look at this account" is a message somebody
  // wants to send, and from local state the recipient gets the list.
  const openKey = url.one("account")

  // The wire waits for a pause in typing. Not for the server's sake — it is
  // the READING that suffers: every keystroke restarts the query, and a list
  // that refills on each letter cannot be read while it is being typed into.
  const q = useDebounced(typed, 200)

  const money = useInfiniteQuery({
    // Every narrowing is part of the key. A cache entry that ignored the
    // filters would answer a filtered question with an unfiltered page.
    queryKey: [
      "finance",
      "money",
      asOf,
      q,
      pot,
      sites,
      flags,
      sortKey,
      sortDesc,
    ] as const,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.get<MoneyOverview>(
        `/api/v1/finance/money${search({
          as_of: asOf,
          q,
          pot: pot || null,
          site: sites.length > 0 ? sites.join(",") : null,
          flag: flags.length > 0 ? flags.join(",") : null,
          sort: sortKey === "default" ? null : sortKey,
          dir: sortDesc ? "desc" : null,
          cursor: pageParam,
          limit: PAGE,
        })}`,
        signal,
      ),
    getNextPageParam: (last) => last.next_cursor,
    // Keep the rows on screen while the next question is answered. Without it
    // every tick of a checkbox blanks the table and shoves the panel's own
    // counts around under the cursor.
    placeholderData: (previous) => previous,
  })

  const pages = useMemo(() => money.data?.pages ?? [], [money.data])
  const rows = useMemo(() => pages.flatMap((page) => page.rows), [pages])
  // Facets and the total describe the whole matched set, not the page — see
  // `MoneyOverview.total`. Read from the FIRST page: every page carries the
  // same numbers, and the first is the one that is already there, so the panel
  // does not flicker as later pages land.
  const head = pages[0]
  const facets = head?.facets
  const total = head?.total ?? 0
  const totalMinor = head?.total_minor ?? 0

  // Plain functions, not `useCallback`. Nothing downstream is memoised on
  // their identity — they go to an `onClick` and an `onChange` — so wrapping
  // them bought nothing and cost the React Compiler its ability to optimise
  // this component at all, which it says out loud in the lint.
  const toggle = (key: string, current: readonly string[], value: string) => {
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]
    // A history entry per tick, because ticking a filter IS the navigation on
    // this screen and Back has to undo exactly one of them.
    url.set({ [key]: next }, false)
  }
  const clear = () => url.set({ site: null, flag: null }, false)
  const onSort = (key: string) => {
    // Same column again reverses; a different column starts descending,
    // because every sortable column here is a figure and the interesting end
    // of a column of money is the top.
    const same = sortKey === key
    url.set({ sort: key, dir: same ? (sortDesc ? null : "desc") : "desc" })
  }

  // Only a bank ever receives a statement, so on a list with no bank in it the
  // last two columns are two columns of em dashes — a third of the table spent
  // saying "not applicable" over and over. Decided from the SERVER's facet
  // count, not from the rows in the browser: a page-by-page decision would add
  // and remove columns as somebody scrolls, which is worse than either answer.
  // Read from the TAB, not from the facet counts. The facets deliberately
  // ignore which tab is open — that is what lets every tab show its own number
  // — so asking them "are there banks" answers "yes, somewhere", and the two
  // columns stayed on the Cash tab where they mean nothing.
  const bankCount =
    facets?.pots.find((facet) => facet.value === "BANK")?.count ?? 0
  const anyBank = pot === "BANK" || (pot === "" && bankCount > 0)
  const everyColumn: ColumnDef<TableSetup, MoneyAccountRow>[] = [
    {
      id: "account",
      header: "Account",
      // A percentage of the table, not pixels: the frame changes width when the
      // sidebar opens, and a pixel budget that was right at 1440 is wrong the
      // moment ⌘B is pressed.
      size: 29,
      // No `priority`, so it is never dropped. It is the identity column — a
      // list that hides which account a figure belongs to has stopped being the
      // list somebody asked for.
      meta: {
        icon: <Wallet className="size-[15px]" />,
        sortKey: "name",
        min: 210,
      },
      cell: ({ row }) => {
        const account = row.original
        const pot = POT[account.pot]
        const Icon = pot.icon
        return (
          <>
            <span className="flex min-w-0 items-center gap-[9px]">
              <span
                className="rounded-tag grid size-[22px] shrink-0 place-items-center"
                style={{
                  color: pot.tone,
                  background: `color-mix(in oklab, ${pot.tone} 12%, #fff)`,
                }}
              >
                <Icon className="size-[13px] stroke-[1.9]" />
              </span>
              {/* The client's own name, WHOLE.
                  It was tried trimmed — the chart ends every account with its
                  unit (`… C001`), which the Location column carries too — and
                  trimming was worse: on a single-kind tab all fourteen rows
                  then read `Cash on Hand`, and a column whose every cell says
                  the same word is a column that says nothing. */}
              <span
                className="text-ink truncate font-medium"
                title={account.account_name}
              >
                {account.account_name}
              </span>
            </span>
            <span className="text-label text-ink-4 flex items-center gap-2 pl-[31px]">
              <span className="font-mono">{account.account_code}</span>
              {/* Which bank, which scheme. It was on the wire from the start and
                  never drawn, so two rows called "Cash In Bank Giro" at one shop
                  were indistinguishable on the screen whose job is telling
                  accounts apart. */}
              {account.qualifier !== "" && (
                <span className="truncate">{account.qualifier}</span>
              )}
            </span>
          </>
        )
      },
    },
    {
      id: "pot",
      header: "Kind",
      size: 13,
      // First to go when width runs out: on a narrow frame the tab strip above
      // the table already says which kind is on screen.
      meta: {
        icon: <FileText className="size-[15px]" />,
        priority: 1,
        min: 130,
      },
      cell: ({ row }) => (
        <ToneTag tone={POT[row.original.pot].tone}>
          {POT[row.original.pot].label}
        </ToneTag>
      ),
    },
    {
      id: "site",
      header: "Location",
      size: 13,
      meta: { icon: <MapPin className="size-[15px]" />, priority: 3, min: 110 },
      // The place's NAME, one line. Our id (`store-01`) sat under it for a
      // while and that was the same fault as a trimmed account name: two
      // spellings of one fact in a cell too narrow to read either. The id lives
      // in the record sheet, where somebody goes looking for it.
      cell: ({ row }) => (
        <span className="truncate">{row.original.site_name}</span>
      ),
    },
    {
      id: "books",
      header: "Per books",
      size: 16,
      // `Rp 4.549.546.000` at 15px tabular, plus the cell padding.
      meta: { align: "right", sortKey: "balance", min: 170 },
      cell: ({ row }) => (
        <span
          className={
            row.original.per_books_minor < 0
              ? "text-bad-ink font-medium tabular-nums"
              : "text-ink font-medium tabular-nums"
          }
        >
          {rp(row.original.per_books_minor)}
        </span>
      ),
    },
    {
      id: "statement",
      header: "Statement",
      size: 15,
      meta: { align: "right", priority: 2, min: 170 },
      // Two lines, like the account column. On one line the date is what gets
      // clipped, and a balance without a date is a balance nobody can use.
      cell: ({ row }) =>
        row.original.last_statement ? (
          <>
            <span className="text-ink font-medium tabular-nums">
              {rp(row.original.last_statement.closing_minor)}
            </span>
            <span className="text-label text-ink-4 block">
              to {day(row.original.last_statement.period_end)}
            </span>
          </>
        ) : (
          <span className="text-ink-4">—</span>
        ),
    },
    {
      id: "difference",
      header: "Difference",
      size: 14,
      // No `priority`. On a bank list this is the column the screen exists for;
      // dropping it to fit would leave a reconciliation screen that cannot say
      // whether anything disagrees.
      meta: { align: "right", min: 150 },
      cell: ({ row }) => <Difference row={row.original} />,
    },
  ]
  // Which of them this TAB has — a question about meaning, not about width.
  // Width is `meta.priority`, handled inside the table.
  const columns = everyColumn.filter((column) => {
    // On a single-kind tab the Kind column repeats the tab heading on every
    // row; on "All" it is what tells the rows apart.
    if (column.id === "pot") return pot === ""
    // Only a bank ever receives a statement — see `anyBank`.
    if (column.id === "statement" || column.id === "difference") return anyBank
    return true
  })

  const narrowed = sites.length + flags.length
  const flagCount = (value: string) =>
    facets?.flags.find((facet) => facet.value === value)?.count ?? 0
  const differs = flagCount("DIFFERS")
  const waiting = flagCount("NO_STATEMENT")

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-line flex items-start gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-meta text-ink-3">Finance</div>
          <h1 className="text-title font-semibold">Cash &amp; bank</h1>
          <p className="text-ctl text-ink-3 mt-0.5">
            Every place money sits, what the books say, and what the bank last
            said.
          </p>
        </div>
        <Button variant="primary" icon={<Upload className="size-4" />}>
          Import statement
        </Button>
      </header>

      <Tabs
        label="Kind of account"
        value={pot}
        onChange={(value) => url.set({ pot: value || null }, false)}
        tabs={[
          {
            value: "",
            label: "All",
            count: facets ? sumOf(facets.pots) : undefined,
          },
          ...(facets?.pots ?? []).map((facet) => ({
            value: facet.value,
            label: POT[facet.value as MoneyPot]?.label ?? facet.value,
            tone: POT[facet.value as MoneyPot]?.tone,
            count: facet.count,
          })),
        ]}
      />

      <div className="border-line flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <SearchField
          value={typed}
          onChange={(value) => url.set({ q: value || null })}
          placeholder="Search a name, a code or a location"
          className="w-[22rem]"
        />

        {/* The reporting date. The whole screen is "as at" something and every
            figure on it moves when this does — a balance is a position on a
            day, not a fact — so it belongs in the toolbar beside the search
            rather than buried in a menu. It was hard-wired to today, which
            silently answered "what did we hold at the end of last month" with
            today's number. */}
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

        <Button
          icon={<ListFilter className="size-4" />}
          onClick={() => url.set({ panel: "filter" }, false)}
        >
          {narrowed === 0 ? "Filter" : `Filter · ${narrowed}`}
        </Button>
        {narrowed > 0 && (
          <Button variant="quiet" onClick={clear}>
            Clear
          </Button>
        )}
        <span className="text-ctl text-ink-4 ml-auto tabular-nums">
          {money.isPending
            ? "Loading…"
            : `${count(rows.length)} of ${count(total)} loaded`}
        </span>
      </div>

      {money.isError ? (
        <div className="text-ctl text-ink-3 grid flex-1 place-items-center p-10 text-center">
          Could not load: {(money.error as Error).message}
        </div>
      ) : (
        <Table
          columns={columns}
          rows={rows}
          rowId={(row) => `${row.account_code}:${row.site_id}`}
          caption={`Money accounts as at ${day(asOf)}`}
          onRowClick={(row) =>
            url.set({ account: `${row.account_code}:${row.site_id}` }, false)
          }
          isOpen={(row) => `${row.account_code}:${row.site_id}` === openKey}
          sort={{ key: sortKey, desc: sortDesc }}
          onSort={onSort}
          hasMore={money.hasNextPage}
          loadingMore={money.isFetchingNextPage}
          onNeedMore={money.fetchNextPage}
          empty={
            money.isPending ? (
              <span className="text-ctl text-ink-3">Loading…</span>
            ) : (
              <>
                <span className="text-cell text-ink block font-semibold">
                  Nothing matches
                </span>
                <span className="text-ctl text-ink-3 mt-0.5 block">
                  {narrowed > 0 || q !== ""
                    ? "No money account matches that search and those filters."
                    : "Until the account map answers cash and bank, there is nothing for this screen to show."}
                </span>
              </>
            )
          }
          // Keyed by column id — see `foot` in `kit/table.tsx` for why a raw
          // row of cells silently grew a phantom column the moment a tab hid
          // one. Every cell here describes the SAME set: what the search and
          // the filters leave.
          foot={{
            account: (
              <>
                <b className="text-ink">{count(total)}</b> accounts
              </>
            ),
            books: (
              // Added by the SERVER over every matching row — see
              // `MoneyOverview.total_minor`. Summed in the browser it would be
              // a sum of the pages fetched so far, growing while it is read.
              <Figure value={totalMinor} className="text-ink font-semibold" />
            ),
            statement:
              waiting === 0
                ? null
                : `${count(waiting)} bank${waiting === 1 ? "" : "s"} without a statement`,
            difference: money.isFetchingNextPage ? (
              "Loading more…"
            ) : differs > 0 ? (
              <span className="text-bad-ink font-medium">
                {count(differs)} disagree
              </span>
            ) : (
              <span className="text-ok-ink inline-flex items-center gap-[5px] font-medium">
                <Check className="size-[13px] stroke-[2.4]" /> none disagree
              </span>
            ),
          }}
        />
      )}

      <AccountSheet
        openKey={openKey}
        loaded={rows.find(
          (row) => `${row.account_code}:${row.site_id}` === openKey,
        )}
        asOf={asOf}
        onClose={() => url.set({ account: null }, false)}
      />

      <Sheet
        open={filterOpen}
        onClose={() => url.set({ panel: null }, false)}
        title="Filter"
        subtitle={`${count(total)} accounts match`}
        foot={
          <>
            <span className="text-label text-ink-4 flex-1">
              Tick one or more.
            </span>
            <Button onClick={clear} disabled={narrowed === 0}>
              Clear
            </Button>
            <Button
              variant="primary"
              onClick={() => url.set({ panel: null }, false)}
            >
              Done
            </Button>
          </>
        }
      >
        <div ref={facetList} className="flex flex-col gap-px px-3 pb-3">
          {/* State first. It is what somebody opened this panel FOR — "show me
              what disagrees with the bank" — and a filter list is read
              top-down, so the question people arrive with goes at the top
              rather than under two lists of nouns. */}
          <Group label="Needs attention" />
          {facets?.flags.length === 0 && (
            <span className="text-ctl text-ink-4 px-2 py-[7px]">
              Nothing needs attention.
            </span>
          )}
          {facets?.flags.map((facet) => (
            <CheckRow
              key={facet.value}
              checked={flags.includes(facet.value)}
              onChange={() => toggle("flag", flags, facet.value)}
              label={FLAG[facet.value] ?? facet.value}
              dot={FLAG_TONE[facet.value]}
              count={facet.count}
            />
          ))}

          {/* No Kind group. It is the tab strip above the table — one kind at
              a time, because a kind changes which columns the table has. Two
              controls for one dimension is two places to look and two states
              to keep in step. */}
          <Group label="Location" />
          {facets?.sites.map((facet) => (
            <CheckRow
              key={facet.value}
              checked={sites.includes(facet.value)}
              onChange={() => toggle("site", sites, facet.value)}
              // The site's NAME when the server sent one — `store-01` is an id
              // this system files it under, and the Location column beside the
              // panel already says `Store 01`.
              label={facet.label ?? facet.value}
              count={facet.count}
            />
          ))}
        </div>
      </Sheet>
    </div>
  )
}

/// One account, whole.
///
/// It reads only what the row already carries — the list has it all — so
/// opening a record costs no request and cannot show a figure that disagrees
/// with the line it was opened from.
///
/// The POLICY is the point of this panel rather than the balance, which is
/// already on the row behind it. "A fixed amount, never spent" is the fact that
/// makes a cashier float different from the cash beside it in the same drawer,
/// and it is nowhere on the list.
function AccountSheet({
  openKey,
  loaded,
  asOf,
  onClose,
}: {
  /// `account_code:site_id`, from the URL. Empty when nothing is open.
  openKey: string
  /// The row from the list, when the list happens to hold it.
  loaded: MoneyAccountRow | undefined
  asOf: string
  onClose: () => void
}) {
  const [code, site] = openKey.split(":")
  // A shared link is the case this exists for. `?account=…` can name a row the
  // list has not loaded — a different filter, a different sort, or simply page
  // four — and without this the link opened the list and no record, which is
  // the promise the URL was put in the address bar to keep.
  //
  // Fetched through the same search the toolbar uses rather than a new
  // endpoint: the code is one of the three things `q` matches, and one
  // endpoint that can answer this is better than two that can disagree.
  const fetched = useQuery({
    queryKey: ["finance", "money", "one", asOf, openKey] as const,
    enabled: openKey !== "" && loaded === undefined,
    queryFn: ({ signal }) =>
      api.get<MoneyOverview>(
        `/api/v1/finance/money${search({
          as_of: asOf,
          q: code,
          site,
          limit: 1,
        })}`,
        signal,
      ),
  })

  const row = loaded ?? fetched.data?.rows[0]
  if (openKey === "") return null
  if (!row) {
    return (
      <Sheet
        open
        onClose={onClose}
        width="record"
        title={fetched.isPending ? "Loading…" : "Account not found"}
        foot={<Button onClick={onClose}>Close</Button>}
      >
        <div className="text-ctl text-ink-3 grid flex-1 place-items-center p-10 text-center">
          {fetched.isPending
            ? "Fetching this account."
            : `No money account with code ${code} at ${site} as at ${day(asOf)}. It may not be mapped in Account map.`}
        </div>
      </Sheet>
    )
  }
  const pot = POT[row.pot]
  const Icon = pot.icon
  return (
    <Sheet
      open
      onClose={onClose}
      width="record"
      title={row.account_name}
      subtitle={
        <>
          {row.site_name} ·{" "}
          <span className="font-mono">{row.account_code}</span>
          {row.qualifier !== "" && ` · ${row.qualifier}`}
        </>
      }
      foot={
        <>
          <span className="text-label text-ink-4 flex-1">
            Balances are as at {day(asOf)}.
          </span>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="border-line border-b px-[18px] py-[15px]">
        <div className="text-label text-ink-3">Per books as at {day(asOf)}</div>
        <Figure
          value={row.per_books_minor}
          className={cn(
            "text-title font-semibold",
            row.per_books_minor < 0 && "text-bad-ink",
          )}
        />
      </div>

      {/* `flex-1` so the two columns are as tall as the sheet. Without it they
          are as tall as their content, and the `mt-auto` below has no space to
          push anything into — so the closing note sits under the paragraph
          above it with three hundred pixels of white beneath, which reads as a
          panel that failed to finish loading. */}
      <div className="grid flex-1 gap-6 p-[18px] md:grid-cols-2">
        <section className="flex min-w-0 flex-col">
          <h3 className="text-label text-ink-4 mb-2 font-medium tracking-[0.04em] uppercase">
            What this account is
          </h3>
          <div className="flex items-center gap-2.5">
            <span
              className="rounded-tag grid size-[26px] shrink-0 place-items-center"
              style={{
                color: pot.tone,
                background: `color-mix(in oklab, ${pot.tone} 12%, #fff)`,
              }}
            >
              <Icon className="size-[15px] stroke-[1.9]" />
            </span>
            <ToneTag tone={pot.tone}>{pot.label}</ToneTag>
          </div>
          <p className="text-ctl text-ink-3 mt-3">{pot.note}.</p>
          {/* The chart's exact wording, because this is where somebody comes
              to match a figure against their own report. The list shows it
              trimmed; nothing anywhere shows it changed. */}
          <dl className="mt-4 flex flex-col gap-px">
            <Fact label="Name in the chart">
              <span className="font-normal">{row.account_name}</span>
            </Fact>
            <Fact label="Location filed as">
              <span className="font-mono font-normal">{row.site_id}</span>
            </Fact>
          </dl>
          <p className="text-ctl text-ink-4 mt-1.5">
            The balance beside it is the ledger's, in this account's own sign —
            unflipped, so an outstanding giro reads negative because that is
            what it is.
          </p>
          <p className="text-label text-ink-4 mt-auto pt-4">
            This row exists because its account code is mapped in Account map.
            An account nobody has mapped does not appear here at all — which is
            the honest answer, and that screen is where it is fixed.
          </p>
        </section>

        <section className="flex min-w-0 flex-col">
          <h3 className="text-label text-ink-4 mb-2 font-medium tracking-[0.04em] uppercase">
            Against the bank
          </h3>
          {row.last_statement ? (
            <dl className="flex flex-col gap-px">
              <Fact label="Statement to">
                {day(row.last_statement.period_end)}
              </Fact>
              <Fact label="Bank says">
                <span className="tabular-nums">
                  {rp(row.last_statement.closing_minor)}
                </span>
              </Fact>
              <Fact label="Books say">
                <span className="tabular-nums">{rp(row.per_books_minor)}</span>
              </Fact>
              <Fact label="Difference">
                <Difference row={row} />
              </Fact>
              <Fact label="Lines not ticked off">
                {count(row.last_statement.unmatched_count)}
              </Fact>
            </dl>
          ) : (
            <p className="text-ctl text-ink-3">
              {row.pot === "BANK"
                ? "No statement has been imported for this account yet, so there is nothing to compare the books against."
                : `${pot.label} takes no bank statement. There is nothing missing here.`}
            </p>
          )}

          {row.difference_minor !== null && row.difference_minor !== 0 && (
            <div className="rounded-ctl bg-warn-wash text-ctl text-warn-ink mt-4 flex gap-2.5 p-3">
              <AlertTriangle className="mt-px size-[15px] shrink-0 stroke-[1.9]" />
              <p>
                <b>A difference is not closed from here.</b> It is settled by
                agreeing statement lines against journal lines. A balance
                "corrected" without a line to explain it is a balance somebody
                invented.
              </p>
            </div>
          )}

          {/* The way OUT of this screen, and the only one it needs.
              Reconciling is a different job on a different object — a
              statement's lines against the ledger's, one at a time — so it is
              its own screen, and this list is its front door. Doing that work
              in a panel over the list would mean doing it in a column narrower
              than the two figures being compared. */}
          {row.last_statement && (
            <AppLink
              to="/finance/reconcile"
              search={{ statement: row.last_statement.statement_id }}
              className="h-ctl rounded-ctl text-ctl text-canvas hover:bg-black-hover mt-4 inline-flex shrink-0 items-center gap-1.5 self-start bg-black px-2.5 font-medium whitespace-nowrap transition-colors"
            >
              <Scale className="size-4" />
              Reconcile this statement
            </AppLink>
          )}
        </section>
      </div>
    </Sheet>
  )
}

function Fact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="border-line flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0">
      <dt className="text-ctl text-ink-3 shrink-0">{label}</dt>
      <dd className="text-ctl text-ink min-w-0 truncate text-right font-medium">
        {children}
      </dd>
    </div>
  )
}

/// Every row the search matches, across the kinds. The "All" tab's count.
///
/// Summed from the facets rather than read from `total`: `total` follows the
/// filters as well, so on a narrowed list it would make the "All" tab claim
/// fewer accounts than the tab beside it.
function sumOf(facets: readonly { count: number }[]): number {
  return facets.reduce((sum, facet) => sum + facet.count, 0)
}

function Group({ label }: { label: string }) {
  return (
    <span className="text-label text-ink-4 px-2 pt-4 pb-1 font-medium tracking-[0.04em] uppercase">
      {label}
    </span>
  )
}
