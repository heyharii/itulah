import { useForm } from "@tanstack/react-form"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import {
  CreditCard,
  HandCoins,
  HeartHandshake,
  RotateCcw,
  StickyNote,
  Ticket,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Day } from "@/components/ui/day"
import { FindMany, type Found } from "@/components/ui/find"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Money, Textarea } from "@/components/ui/field"
import { ConfirmButton } from "@/components/ui/dialog"
import { Choices, Section, type Tile } from "@/components/ui/form"
import { RecordPanel } from "@/components/ui/record-panel"
import { Meter } from "@/components/ui/meter"
import { DockedFilters } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { commercialKeys, promotionCatalogue } from "@/lib/queries/commercial"
import { listMembers } from "@/lib/queries/members"
import { useFilters } from "@/lib/filters"
import { count, day, money, moment } from "@/lib/format"
import {
  describeKind,
  describeMovement,
  issueVoucher,
  listVouchers,
  redeemVoucher,
  voidVoucher,
  voucherDetail,
  voucherKeys,
  voucherScopeFromFilters,
  VOUCHER_DATE_OPERATORS,
  VOUCHER_NUMBER_OPERATORS,
  type VoucherQuery,
  type VoucherKind,
  type VoucherRow,
  type VoucherStatus,
} from "@/lib/queries/vouchers"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { useDebounced } from "@/lib/use-debounced"
import { ROOMY } from "@/screens/operations/roomy"

/// Vouchers — value a customer already holds and can pay with.
///
/// **This is the one Commercial screen that is not pricing.** The other three
/// all answer "what does this cost": a price, a markdown coming off it, a
/// promotion running over several. A voucher answers "what did they pay with".
/// It is tender — it sits beside cash and a card at the counter — and it is
/// *spent*, never *applied*. The engine says so itself in
/// `pricing-engine/src/lib.rs`.
///
/// The distinction is not pedantry, and the system this replaces is the proof:
/// it filed both under one voucher table, `percent_off` beside `stored_value`,
/// and booked a gift card settled at the till as a discount against margin. So
/// the shop's margin got worse every time somebody spent money the shop was
/// already holding. The discount half of that table is what this app calls a
/// **coupon** — a code that unlocks a promotion and never carries a balance —
/// and it lives on the Promotions screen, where it belongs.
///
/// **The strip above the list is a liability, and it never moves with the
/// filter.** `outstanding_minor` is what the shop owes: money taken for cards
/// that have not been spent yet. The server computes it over every voucher
/// rather than over the query, deliberately, because a liability that changed
/// because somebody typed in a search box is a figure nobody could repeat to
/// an accountant.
///
/// **Redeeming here is the exception, not the rule.** Ordinarily a voucher is
/// spent at a till as a tender line on a sale. The redeem action on the sheet
/// exists for the cases a till cannot reach — a telephone order, a card the
/// shop is settling by hand — and it writes the same movement the till does.

/// Live, spent, stopped. `expired` is not among them on purpose: a card past
/// its date is still ACTIVE with a balance on it — what changed is the clock,
/// not the record — so it is drawn as a second mark rather than a fourth
/// status. Conflating the two would mean a card could be "un-expired" by
/// editing a status, which is exactly backwards.
function statusTone(status: VoucherStatus) {
  switch (status) {
    case "ACTIVE":
      return "ok" as const
    case "SPENT":
      return "neutral" as const
    case "VOIDED":
      return "bad" as const
  }
}

function statusWord(status: VoucherStatus): string {
  switch (status) {
    case "ACTIVE":
      return "Live"
    case "SPENT":
      return "Spent"
    case "VOIDED":
      return "Cancelled"
  }
}

/// The same three words, plus the one the clock adds.
///
/// The filter picker reads this column's accessor, which folds "past its date"
/// in beside the stored status — so the picker has a fourth value to name and
/// `statusWord` above, typed to the three the record can hold, cannot name it.
/// Two words could have drifted apart; they do not, because this one defers.
function stateWord(value: string): string {
  if (value === "EXPIRED") return "Expired"
  return statusWord(value as VoucherStatus)
}

/// The member it was issued to, or "Anyone".
///
/// A voucher with no member is not an incomplete record: a gift card is bought
/// *for somebody else*, and the shop legitimately does not know who will
/// present it. It is a bearer voucher, spendable by whoever has the code, and
/// the column is never blank.
function holder(row: VoucherRow): string {
  if (row.member_id === null) return "Anyone"
  return row.member_name ?? row.member_id
}

const columns: ColumnDef<TableSetup, VoucherRow>[] = [
  {
    id: "code",
    accessorFn: (row) =>
      `${row.code} ${row.member_name ?? ""} ${row.member_id ?? ""}`,
    header: "Voucher",
    size: 260,
    meta: { grow: 260 },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-mono text-ink">{row.original.code}</span>
        <span className="truncate text-[0.875rem] text-mute">
          {describeKind(row.original.kind)}
        </span>
      </span>
    ),
  },
  {
    id: "holder",
    accessorFn: (row) => holder(row),
    header: "Member",
    size: 200,
    // The first to go on a narrow table: the code already names the voucher.
    meta: { priority: 2 },
    // Sorted by the server, which has no holder order — a sort over the pages
    // loaded would put page two's Adi below page one's Yusuf.
    enableSorting: false,
    // No filter: the box in the header already searches the holder, and this
    // accessor never goes blank — an unnamed card reads "Bearer" — so an
    // emptiness clause would find nothing and a facet would be a list of every
    // member who has ever been given a card.
    cell: ({ row }) =>
      row.original.member_id === null ? (
        <span className="text-mute">Anyone</span>
      ) : (
        <span className="truncate text-ink">{holder(row.original)}</span>
      ),
  },
  {
    id: "face",
    accessorFn: (row) => row.issued_minor,
    header: "Face Value",
    size: 150,
    // **No scale.** `issued_minor` holds whole rupiah despite its name — see
    // `lib/format`'s `money` — so a bound is compared exactly as it is typed.
    // Multiplying by a hundred here is what makes a filter for cards over
    // 500.000 match nothing at all.
    //
    // Narrowed by the SERVER, so the operators are the ones the request can
    // carry, and one clause per column — see `voucherScopeFromFilters`.
    meta: {
      align: "right",
      filter: {
        kind: "number",
        label: "Face value",
        unit: "Rp",
        operators: VOUCHER_NUMBER_OPERATORS,
        single: true,
      },
    },
    cell: ({ row }) => (
      <span className="text-body tabular-nums">
        {money(row.original.issued_minor)}
      </span>
    ),
  },
  {
    id: "balance",
    accessorFn: (row) => row.balance_minor,
    header: "Left on It",
    size: 240,
    // The liability, card by card. "At least 100.000" is how somebody finds
    // what the shop is actually holding against the figure in the strip, and
    // "is 0" is a spent card that has not been marked SPENT.
    meta: {
      align: "right",
      filter: {
        kind: "number",
        label: "Left on it",
        unit: "Rp",
        operators: VOUCHER_NUMBER_OPERATORS,
        single: true,
      },
    },
    // The balance and how much of the card it is, together. A number alone
    // does not say whether 50,000 is most of a card or the last of one, and
    // that is the difference between a customer who will be back and one who
    // will not.
    cell: ({ row }) => {
      const left = row.original.issued_minor
        ? row.original.balance_minor / row.original.issued_minor
        : 0
      return (
        <span className="flex items-center justify-end gap-2">
          <Meter
            value={left}
            tone={left === 0 ? "bad" : left < 0.25 ? "warn" : "ok"}
            className="w-16"
          />
          <span className="w-28 text-right text-ink tabular-nums">
            {money(row.original.balance_minor)}
          </span>
        </span>
      )
    },
  },
  {
    id: "status",
    accessorFn: (row) => (row.expired ? "EXPIRED" : row.status),
    header: "Status",
    size: 160,
    // `EXPIRED` is in this accessor and not in the segment above, which is
    // what makes the clause worth having: the segment asks the SERVER for a
    // stored status, and past-its-date is not one — it is the clock. So "is
    // EXPIRED" is the only way to ask for live cards nobody may spend, which
    // is the list somebody writing off a liability wants.
    //
    // The server answers it as `state`, ANDed with the segment. Its four
    // values are fixed rather than read off the loaded rows — the rows are a
    // page of the book, and a value missing from page one still exists.
    enableSorting: false,
    meta: {
      filter: {
        kind: "option",
        label: "Status",
        format: stateWord,
        options: (["ACTIVE", "EXPIRED", "SPENT", "VOIDED"] as const).map(
          (value) => ({ value, label: stateWord(value) })
        ),
        operators: ["is"],
        single: true,
      },
    },
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        <Status tone={statusTone(row.original.status)}>
          {statusWord(row.original.status)}
        </Status>
        {/* Two facts, not one word: the voucher is live and it is past its
            date. A single "Expired" would hide the balance still on it. */}
        {row.original.expired && (
          <span className="text-warn-fg">· Expired</span>
        )}
      </span>
    ),
  },
  {
    id: "issued",
    accessorFn: (row) => row.issued_at,
    header: "Issued",
    size: 140,
    // A voucher book is read by period — what was sold before Christmas, what
    // is still outstanding from last year — and that is a question no search
    // box and no sort can be made to answer.
    meta: {
      align: "right",
      filter: {
        kind: "date",
        label: "Issued",
        operators: VOUCHER_DATE_OPERATORS,
        single: true,
      },
    },
    cell: ({ row }) => (
      <span className="text-body tabular-nums">
        {day(row.original.issued_at)}
      </span>
    ),
  },
]

type Shown = "ALL" | VoucherStatus

/// Column → the server's sort key. The two columns missing here (member,
/// status) have no server order and so are not sortable at all.
const SORTS: Record<string, string> = {
  code: "code",
  face: "value",
  balance: "balance",
  issued: "issued",
}

/// One figure of the strip: label above, the amount at 24px, a quiet line
/// under it. Local rather than `Kpi` — the shared one is 16px of padding and an
/// 18px figure, which is cramped for rupiah amounts in the millions.
function Figure({
  label,
  value,
  note,
  warn,
  className,
}: {
  label: string
  value: string
  note?: string
  warn?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-card border border-hairline bg-canvas p-6 shadow-soft",
        className
      )}
    >
      <div className="text-[0.9375rem] text-body">{label}</div>
      <div className="text-[1.5rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
        {value}
      </div>
      <div
        className={cn(
          "min-h-5 text-[0.875rem]",
          warn ? "text-warn-fg" : "text-mute"
        )}
      >
        {note}
      </div>
    </div>
  )
}

export function Vouchers() {
  const search = useSheet("q")
  const open = useSheet("voucher")
  const [shown, setShown] = useState<Shown>("ALL")
  const [sorting, setSorting] = useState<SortingState>([])
  const [issuing, setIssuing] = useState(false)
  const [coupons, setCoupons] = useState(false)

  const filters = useFilters(columns)

  /// Everything that narrows the list, as ONE request: the segment, the search
  /// (debounced — every keystroke would be a round trip over the whole book),
  /// the docked chips and the sort. All of it is the server's, so every page
  /// is already the answer and the list can simply scroll — nothing narrows
  /// only the pages that happen to be loaded.
  const status = shown === "ALL" ? undefined : shown
  const typed = (search.value ?? "").trim()
  const needle = useDebounced(typed, 300)
  const order = sorting[0]
  const scope = useMemo<VoucherQuery>(
    () => ({
      status,
      ...voucherScopeFromFilters(filters.filters),
      ...(needle === "" ? {} : { q: needle }),
      ...(order === undefined || SORTS[order.id] === undefined
        ? {}
        : { sort: SORTS[order.id], dir: order.desc ? "desc" : "asc" }),
    }),
    [status, filters.filters, needle, order]
  )
  const narrowed =
    needle !== "" || filters.filters.length > 0 || status !== undefined

  /// A page at a time, on the server's cursor — the book is not capped, it is
  /// paged, and the table fetches the next one as its foot nears view. Its own
  /// key beside the plain list's: the Overview reads that one as a single page.
  const list = useInfiniteQuery({
    queryKey: [...voucherKeys.list(scope), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      listVouchers({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // The rows already drawn stay while a new filter's first page is on its
    // way, rather than the table blinking to a spinner on every keystroke.
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(
    () => list.data?.pages.flatMap((page) => page.rows) ?? [],
    [list.data]
  )
  /// Every voucher the search and filters match, not just the pages loaded.
  const total = list.data?.pages[0]?.total ?? rows.length

  /// Search, chips and segment off in one navigation — two `close()`s would be
  /// two history entries racing over one search.
  const navigate = useNavigate()
  const clearFilters = () => {
    setShown("ALL")
    void navigate({
      to: ".",
      replace: true,
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        q: undefined,
        f: undefined,
      }),
    } as never)
  }

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: VoucherRow) => row.code,
        // No column filters and no global filter here: the server has already
        // applied both, and applying them again would only re-check its work.
        state: { sorting },
        // The rows arrive in the order the request asked for. Sorting them
        // again here would sort what has loaded, not the book.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, sorting]
    )
  )

  const ledger = list.data?.pages[0]?.ledger

  return (
    <PageContent>
      <PageHeader
        crumb="Marketing"
        title="Vouchers"
        actions={
          // Coupons live here as a READER only — no list screen, no menu
          // row. A coupon is a gate on a promotion and cannot exist without
          // one, so it is authored on the promotion form; what it lacks is a
          // place to answer "which codes are out there", and a sheet on the
          // screen people already associate with codes answers it without
          // implying a coupon is a thing of its own.
          <Button variant="soft" onClick={() => setCoupons(true)}>
            Coupons
          </Button>
        }
      />

      {ledger && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-5">
          {/* Outstanding leads, because it is the only figure here that is a
              number on the balance sheet: money taken for vouchers nobody has
              spent yet. */}
          <Figure
            label="Outstanding"
            value={money(ledger.outstanding_minor)}
            note={`${count(ledger.outstanding_count)} live`}
            className="col-span-2 2xl:col-span-1"
          />
          <Figure label="Issued" value={money(ledger.issued_minor)} />
          <Figure label="Spent" value={money(ledger.redeemed_minor)} />
          <Figure label="Cancelled" value={money(ledger.voided_minor)} />
          <Figure
            label="Expired"
            value={money(ledger.expired_minor)}
            note={`${count(ledger.expired_count)} vouchers`}
            warn={ledger.expired_count > 0}
          />
        </div>
      )}

      {/* The module's list shape: rows at the left, filters docked at the
          right. The last of the four lists still wearing a Filter button — a
          screen that narrows its rows differently from the three beside it is
          a screen people have to learn twice. */}
      <div className="grid min-w-0 items-start gap-5 dock:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col">
          {/* Tabs, then search and the one CTA — the same toolbar as
              Promotions. */}
          <Toolbar className="mb-5">
            <Segmented
              options={[
                { value: "ALL", label: "All" },
                { value: "ACTIVE", label: "Live" },
                { value: "SPENT", label: "Spent" },
                { value: "VOIDED", label: "Cancelled" },
              ]}
              value={shown}
              onChange={setShown}
            />
            <div className="ml-auto flex items-center gap-4">
              {/* The server's count of every voucher the list matches — the
                  rest arrive as the table scrolls, so the loaded share is not
                  a number anybody needs. */}
              <span className="text-[0.875rem] text-mute tabular-nums">
                {`${count(total)} vouchers`}
              </span>
              <Input
                value={search.value ?? ""}
                onChange={(event) =>
                  event.target.value === ""
                    ? search.close()
                    : search.replace(event.target.value)
                }
                className="h-9 w-64"
              />
              <Button variant="primary" onClick={() => setIssuing(true)}>
                New voucher
              </Button>
            </div>
          </Toolbar>

          {/* The strip above is the liability over every voucher ever issued and
              does not move with any of this; what moves is the list. The
              search, the segment and the docked filters are all asked of the
              server, so the list below is always the whole answer, paged. */}
          <Card className="overflow-hidden">
            {queryState(list, {
              loading: "Loading vouchers…",
              // No second New voucher here: the toolbar's is the one CTA.
              render: () =>
                rows.length === 0 ? (
                  narrowed ? (
                    <EmptyState
                      action={
                        <Button variant="ghost" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      }
                    >
                      No vouchers match.
                    </EmptyState>
                  ) : (
                    <EmptyState>No vouchers.</EmptyState>
                  )
                ) : (
                  <DataTable<VoucherRow>
                    table={table}
                    onRowClick={(row) => open.open(row.code)}
                    isSelected={(row) => row.code === open.value}
                    empty="No vouchers match."
                    more={list}
                    className={`${ROOMY} max-h-[calc(100dvh-24rem)]`}
                  />
                ),
            })}
          </Card>
        </div>

        <DockedFilters model={filters} id="vouchers" subject="Voucher" />
      </div>

      <CouponSheet open={coupons} onClose={() => setCoupons(false)} />

      <VoucherSheet code={open.value ?? null} onClose={() => open.close()} />
      <IssueSheet
        open={issuing}
        onClose={() => setIssuing(false)}
        onIssued={(code) => {
          setIssuing(false)
          open.open(code)
        }}
      />
    </PageContent>
  )
}

// ---------------------------------------------------------------------------

/// A key held across retries and rotated after a success.
///
/// The point of an idempotency key is that a retry carries the SAME one, so the
/// server replays its first answer instead of writing a second record. It
/// matters more here than anywhere else in this app: a retried issue is a
/// second gift card the shop never sold, and a retried redemption spends the
/// same money twice.
function useIdempotencyKey(): {
  readonly key: string
  readonly rotate: () => void
} {
  const [key, setKey] = useState(() => crypto.randomUUID())
  const rotate = useCallback(() => setKey(crypto.randomUUID()), [])
  return { key, rotate }
}

/// The server's own sentence about why a write was refused. It knows things
/// this form cannot — that the card is stopped, that the amount is more than
/// the balance — and "Could not save" throws all of it away.
function said(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The server could not be reached."
}

/// Rupiah as typed, in minor units.
///
/// IDR has no minor unit in practice, so what somebody types IS the minor
/// amount and there is no multiplication to get wrong. Digits only: a
/// thousands separator pasted in from a spreadsheet should not become part of
/// the number.
function minorFrom(typed: string): number {
  const digits = typed.replace(/[^\d]/g, "")
  return digits === "" ? 0 : Number(digits)
}

// ---------------------------------------------------------------------------

/// One voucher and everything that has happened to it.
///
/// Read by code rather than by uuid, because the code is what exists outside
/// this system: it is printed on the voucher, and somebody reading it out over
/// a telephone should be able to reach this.
///
/// ## Tabs: Details · Ledger · Activity
///
/// **Details** is what the voucher IS and what is left on it. **Ledger** is
/// every movement that got it there, signed. They are separate tabs for the
/// reason a bank statement is not a balance: "is there 150.000 on this" and
/// "where did the other 350.000 go" are different questions. **Activity** is
/// the record panel — the trail, tags and comments — for this voucher's code.
function VoucherSheet({
  code,
  onClose,
}: {
  code: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const [spending, setSpending] = useState(false)
  const detail = useQuery({
    queryKey: voucherKeys.detail(code ?? ""),
    queryFn: ({ signal }) => voucherDetail(code as string, signal),
    enabled: code !== null,
  })

  const data = detail.data ?? null

  /// Cancelling takes a reason the server records; the dialog asks for it and
  /// stays open on a refusal, saying why.
  const cancel = useMutation({
    mutationFn: (value: { code: string; reason: string }) =>
      voidVoucher(value.code, { reason: value.reason.trim() }, idempotency.key),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: voucherKeys.all })
      idempotency.rotate()
    },
  })

  const voucher = data?.voucher ?? null
  const live = voucher !== null && voucher.status === "ACTIVE"

  // Built only when the voucher has arrived. `tabs` with no data would draw a
  // strip of empty sections over a spinner, and a section somebody clicks into
  // before it has anything to say is a section they conclude is broken.
  const sections =
    data === null
      ? undefined
      : [
          {
            value: "details",
            label: "Details",
            content: (
              <div className="flex flex-col gap-10 pb-6">
                <Block icon={Ticket} title="Voucher">
                  <Facts className="gap-x-6 gap-y-5">
                    <Fact term="Kind">{describeKind(data.voucher.kind)}</Fact>
                    <Fact term="Code">
                      <span className="font-mono">{data.voucher.code}</span>
                    </Fact>
                    <Fact term="Status">
                      <Status tone={statusTone(data.voucher.status)}>
                        {statusWord(data.voucher.status)}
                      </Status>
                    </Fact>
                    <Fact term="Member">{holder(data.voucher)}</Fact>
                    <Fact term="Issued">{day(data.voucher.issued_at)}</Fact>
                    <Fact term="Expires">
                      {data.voucher.expires_at === null
                        ? "Never"
                        : day(data.voucher.expires_at)}
                      {data.voucher.expired && (
                        <span className="text-warn-fg"> · Expired</span>
                      )}
                    </Fact>
                    <Fact term="Issued by">{data.voucher.issued_by}</Fact>
                    <Fact term="Store">{data.voucher.issued_site ?? "—"}</Fact>
                  </Facts>
                </Block>

                <Block icon={Wallet} title="Balance">
                  <Balance voucher={data.voucher} />
                </Block>

                {data.voucher.note && (
                  <Block icon={StickyNote} title="Note">
                    <p className="text-[0.9375rem] leading-relaxed text-body">
                      {data.voucher.note}
                    </p>
                  </Block>
                )}

                {live && spending && (
                  <Block icon={HandCoins} title="Spend">
                    <RedeemForm
                      voucher={data.voucher}
                      onDone={() => setSpending(false)}
                    />
                  </Block>
                )}
              </div>
            ),
          },
          {
            value: "ledger",
            label: `Ledger (${count(data.movements.length)})`,
            content: (
              <div className="pb-6">
                {/* Signed, so the history reads as arithmetic. A column of
                    positives where some of them mean the opposite is the shape
                    that makes a balance impossible to check by eye. */}
                <MiniTable
                  className="[&_td]:py-4"
                  head={[
                    { label: "When", align: "left" },
                    { label: "What", align: "left" },
                    { label: "Amount", align: "right" },
                    { label: "Left", align: "right" },
                  ]}
                >
                  {data.movements.map((movement) => (
                    <MiniRow key={movement.movement_id}>
                      <MiniCell>{moment(movement.occurred_at)}</MiniCell>
                      <MiniCell>
                        <span className="text-body">
                          {movement.kind === "VOID"
                            ? "Cancelled"
                            : describeMovement(movement.kind)}
                        </span>
                        {/* Spent at a till: the sale it paid for, one click
                            away. */}
                        {movement.sale_id !== null && (
                          <AppLink
                            to="/sales"
                            sheet={{ key: "sale", value: movement.sale_id }}
                            className="ml-2 text-accent hover:underline"
                          >
                            Sale
                          </AppLink>
                        )}
                      </MiniCell>
                      <MiniCell align="right">
                        <span
                          className={
                            movement.amount_minor < 0 ? "text-bad" : "text-ok"
                          }
                        >
                          {movement.amount_minor < 0 ? "−" : "+"}
                          {money(Math.abs(movement.amount_minor))}
                        </span>
                      </MiniCell>
                      <MiniCell align="right">
                        {money(movement.balance_after_minor)}
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              </div>
            ),
          },
          {
            value: "activity",
            label: "Activity",
            content: (
              <RecordPanel
                subject={{ kind: "voucher", id: data.voucher.code }}
              />
            ),
          },
        ]

  return (
    <Sheet
      open={code !== null}
      onOpenChange={(next) => {
        if (!next) {
          setSpending(false)
          idempotency.rotate()
          onClose()
        }
      }}
      id={code ?? undefined}
      title={
        data === null
          ? "Voucher"
          : `${describeKind(data.voucher.kind)} · ${money(data.voucher.balance_minor)}`
      }
      tabs={sections}
      // Spending and cancelling are done to the voucher as it stands, so they
      // sit in the head beside its title, only while it can still be spent.
      actions={
        voucher === null || !live ? undefined : (
          <>
            <Button
              variant={spending ? "soft" : "ghost"}
              size="sm"
              aria-pressed={spending}
              onClick={() => setSpending(!spending)}
            >
              Spend
            </Button>
            <ConfirmButton
              label={cancel.isPending ? "Cancelling…" : "Cancel voucher"}
              title={`Cancel ${voucher.code}?`}
              description={
                voucher.balance_minor > 0
                  ? `${money(voucher.balance_minor)} left on it can't be spent.`
                  : "It can't be spent after this."
              }
              confirmLabel="Cancel voucher"
              cancelLabel="Keep"
              tone="danger"
              variant="danger"
              size="sm"
              pending={cancel.isPending}
              reason={{
                label: "Reason",
                hint: "At least 4 characters",
              }}
              onConfirm={(reason) =>
                reason.trim().length < 4
                  ? Promise.reject(
                      new Error("Give a reason (at least 4 characters).")
                    )
                  : cancel.mutateAsync({ code: voucher.code, reason })
              }
            />
          </>
        )
      }
      badge={
        data === null ? undefined : (
          <span className="flex flex-wrap items-center gap-3">
            <Status tone={statusTone(data.voucher.status)}>
              {statusWord(data.voucher.status)}
            </Status>
            {data.voucher.expired && (
              <span className="text-warn-fg">· Expired</span>
            )}
          </span>
        )
      }
    >
      {/* Only reached while the voucher is still arriving — once it has, the
          tabs above are what the sheet draws. */}
      {queryState(detail, {
        loading: "Loading…",
        render: () => null,
      })}
    </Sheet>
  )
}

/// One part of the sheet: a 20px line icon, the heading, a hairline, then the
/// part itself. The same heading the promotion sheet uses.
function Block({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center gap-3 border-b border-hairline pb-3">
        <Icon className="size-5 shrink-0 text-line-ico" strokeWidth={1.7} />
        <h4 className="flex-1 text-[0.9375rem] font-semibold text-ink">
          {title}
        </h4>
      </div>
      {children}
    </section>
  )
}

/// What is left of the face value, as a figure and a bar. A number alone does
/// not say whether 50,000 is most of a voucher or the last of one.
function Balance({ voucher }: { voucher: VoucherRow }) {
  const left = voucher.issued_minor
    ? voucher.balance_minor / voucher.issued_minor
    : 0
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[1.5rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
          {money(voucher.balance_minor)}
        </span>
        <span className="text-[0.9375rem] text-body tabular-nums">
          of {money(voucher.issued_minor)}
        </span>
      </div>
      <Meter
        value={left}
        tone={left === 0 ? "bad" : left < 0.25 ? "warn" : "ok"}
        label="Left of face value"
      />
      <Facts className="gap-x-6 gap-y-5">
        <Fact term="Face value">{money(voucher.issued_minor)}</Fact>
        <Fact term="Spent">{money(voucher.spent_minor)}</Fact>
      </Facts>
    </div>
  )
}

function RedeemForm({
  voucher,
  onDone,
}: {
  voucher: VoucherRow
  onDone: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()

  const spend = useMutation({
    mutationFn: (value: { amount: string; sale: string; note: string }) =>
      redeemVoucher(
        voucher.code,
        {
          amount_minor: minorFrom(value.amount),
          sale_id: value.sale.trim() === "" ? undefined : value.sale.trim(),
          note: value.note.trim() === "" ? undefined : value.note.trim(),
        },
        idempotency.key
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: voucherKeys.all })
      idempotency.rotate()
      onDone()
    },
  })

  const form = useForm({
    defaultValues: { amount: "", sale: "", note: "" },
    onSubmit: ({ value }) => spend.mutate(value),
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        form.handleSubmit()
      }}
      className="flex flex-col gap-5"
    >
      {spend.isError && <Banner tone="bad">{said(spend.error)}</Banner>}

      <form.Field name="amount">
        {(field) => (
          <Field
            label="Amount"
            required
            className="gap-2"
            problem={
              minorFrom(field.state.value) > voucher.balance_minor
                ? `Only ${money(voucher.balance_minor)} is left.`
                : undefined
            }
          >
            <Money
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              prefix="Rp"
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="sale">
        {(field) => (
          <Field label="Sale ID" className="gap-2">
            <Input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="note">
        {(field) => (
          <Field label="Note" className="gap-2">
            <Textarea
              rows={3}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </Field>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.amount}>
        {(amount) => (
          <Button
            variant="primary"
            type="submit"
            pending={spend.isPending}
            disabled={
              minorFrom(amount) <= 0 ||
              minorFrom(amount) > voucher.balance_minor
            }
            className="self-start"
          >
            {spend.isPending
              ? "Spending…"
              : `Spend ${money(minorFrom(amount))}`}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}

// ---------------------------------------------------------------------------

/// Issue one.
///
/// The three kinds are not decoration: the accounting differs at the moment of
/// issue. A gift card was paid for and is a liability; goodwill was given away
/// and is an expense that day; a refund voucher is a sale being unwound. That
/// is why the kind is asked first and cannot be changed afterwards.
function IssueSheet({
  open,
  onClose,
  onIssued,
}: {
  open: boolean
  onClose: () => void
  onIssued: (code: string) => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  /// The member picked, as the picker's chip.
  const [holder, setHolder] = useState<readonly Found[]>([])

  const issue = useMutation({
    mutationFn: (value: {
      kind: VoucherKind
      amount: string
      code: string
      member: string
      expires: string
      note: string
    }) =>
      issueVoucher(
        {
          kind: value.kind,
          value_minor: minorFrom(value.amount),
          // Blank means "mint one", which is the ordinary case. A code is only
          // supplied for pre-printed stock, where the card already exists in
          // the physical world.
          code: value.code.trim() === "" ? undefined : value.code.trim(),
          member_id:
            value.member.trim() === "" ? undefined : value.member.trim(),
          // A date input gives a day; the wire takes an instant. End of that
          // day in the browser's zone, because "expires on the 31st" means the
          // 31st is still good.
          expires_at:
            value.expires === ""
              ? undefined
              : new Date(`${value.expires}T23:59:59`).toISOString(),
          note: value.note.trim() === "" ? undefined : value.note.trim(),
        },
        idempotency.key
      ),
    onSuccess: (voucher) => {
      void client.invalidateQueries({ queryKey: voucherKeys.all })
      idempotency.rotate()
      setHolder([])
      onIssued(voucher.code)
    },
  })

  const form = useForm({
    defaultValues: {
      kind: "GIFT_CARD" as VoucherKind,
      amount: "",
      code: "",
      member: "",
      expires: "",
      note: "",
    },
    onSubmit: ({ value }) => issue.mutate(value),
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New voucher"
      width="wide"
      footer={
        <div className="flex justify-end">
          <form.Subscribe selector={(state) => state.values.amount}>
            {(amount) => (
              <Button
                variant="primary"
                type="submit"
                form="new-voucher"
                pending={issue.isPending}
                disabled={minorFrom(amount) <= 0}
              >
                {issue.isPending ? "Submitting…" : "Submit"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      }
    >
      <form
        id="new-voucher"
        // Keyed on nothing: the sheet unmounts on close, so a second voucher is
        // always started from empty rather than from the last one's values.
        onSubmit={(event) => {
          event.preventDefault()
          form.handleSubmit()
        }}
        className="flex flex-col gap-10 pb-6"
      >
        {issue.isError && <Banner tone="bad">{said(issue.error)}</Banner>}

        <Section title="Voucher" icon={Ticket}>
          {/* Asked first, because the accounting differs at the moment of
              issue: paid for is a liability, given away is an expense that
              day, a refund is a sale being unwound. */}
          <form.Field name="kind">
            {(field) => (
              <Choices
                options={VOUCHER_KINDS}
                value={field.state.value}
                onChange={field.handleChange}
                columns={3}
                label="Kind"
                className="grid-cols-2 gap-3 sm:grid-cols-3 [&>*]:min-h-11 [&>*]:px-3.5"
              />
            )}
          </form.Field>

          <div className="grid gap-5 sm:grid-cols-2">
            {/* Frozen at issue: the face value never changes, only the
                balance does. */}
            <form.Field name="amount">
              {(field) => (
                <Field
                  label="Value"
                  required
                  className="min-w-0 gap-2"
                  problem={
                    field.state.meta.isBlurred &&
                    minorFrom(field.state.value) <= 0
                      ? "Enter a value."
                      : undefined
                  }
                >
                  <Money
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={field.handleChange}
                    prefix="Rp"
                  />
                </Field>
              )}
            </form.Field>

            <form.Field name="expires">
              {(field) => (
                <Field label="Expires" className="min-w-0 gap-2">
                  <Day
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={field.handleChange}
                  />
                </Field>
              )}
            </form.Field>
          </div>
        </Section>

        {/* Blank is a bearer voucher — whoever has the code can spend it.
            Picked from the directory rather than typed: a mistyped member is
            a voucher nobody can find again. One member, so a second pick
            replaces the first. */}
        <Section title="Member" icon={UserRound}>
          <form.Field name="member">
            {(field) => (
              <Field label="Member (optional)" className="gap-2">
                <FindMany
                  chosen={holder}
                  onChange={(next) => {
                    const last = next.length > 0 ? next[next.length - 1] : null
                    setHolder(last === null ? [] : [last])
                    field.handleChange(last === null ? "" : last.value)
                  }}
                  queryKey={(needle) => ["members", "pick", needle] as const}
                  search={(needle, signal) =>
                    listMembers({ q: needle, limit: 20 }, signal).then((page) =>
                      page.members.map((member) => ({
                        value: member.member_id,
                        label: member.display_name ?? member.member_id,
                        note: member.member_id,
                        aside:
                          member.blocked_at === null ? undefined : "Blocked",
                      }))
                    )
                  }
                  label="Member"
                  offline="The member directory is not answering."
                />
              </Field>
            )}
          </form.Field>
        </Section>

        <Section title="Details" icon={StickyNote}>
          {/* Only for pre-printed stock; otherwise one is minted. */}
          <form.Field name="code">
            {(field) => (
              <Field label="Code" className="gap-2">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          {/* The one thing an audit six months from now cannot reconstruct. */}
          <form.Field name="note">
            {(field) => (
              <Field label="Note" className="gap-2">
                <Textarea
                  rows={3}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
        </Section>
      </form>
    </Sheet>
  )
}

/// The three kinds, as tiles. Named for what happened rather than how it is
/// booked; the booking follows from the name.
const VOUCHER_KINDS: readonly Tile<VoucherKind>[] = [
  { value: "GIFT_CARD", label: "Gift card", icon: CreditCard },
  { value: "REFUND", label: "Refund", icon: RotateCcw },
  { value: "GOODWILL", label: "Goodwill", icon: HeartHandshake },
]

// ---------------------------------------------------------------------------

/// Every coupon code the fleet is carrying, read-only.
///
/// ## Why a sheet on Vouchers and not a screen of its own
///
/// A coupon is a **gate on a promotion**: a rule carrying a code is shut until
/// somebody presents that code. It cannot exist without the promotion it
/// unlocks, which is why it has no menu row and is authored on the promotion
/// form. What it was missing is a place to answer "which codes are out there" —
/// and this is the screen people already come to holding a code in their hand.
///
/// It shows and never edits. Changing a coupon means publishing a new book, and
/// a sheet that offered to edit one here would be a second way to write a price
/// book — which is the thing this module has exactly one of.
///
/// **A coupon is not a voucher**, and the note at the foot says so, because
/// this sheet is the one place in the app where the two appear together. A
/// voucher carries money and is spent; a coupon carries nothing and unlocks an
/// offer. The system this replaces filed both in one table, and that is how a
/// gift card came to be booked as a discount.
function CouponSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const catalogue = useQuery({
    queryKey: commercialKeys.catalogue(),
    queryFn: ({ signal }) => promotionCatalogue(signal),
    enabled: open,
  })

  // The rule each code unlocks, by id — a code on its own says nothing about
  // what presenting it does, which is the first thing anybody asks of one.
  const ruleName = useMemo(() => {
    const map = new Map<string, string>()
    for (const rule of catalogue.data?.rules ?? [])
      map.set(rule.rule_id, rule.name)
    return map
  }, [catalogue.data])

  const rows = catalogue.data?.coupons ?? []

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Coupons"
      width="table"
      badge={
        catalogue.data === undefined ? undefined : (
          <span className="text-[0.875rem] text-mute">
            {count(rows.length)} codes
          </span>
        )
      }
    >
      {queryState(catalogue, {
        loading: "Loading…",
        render: () =>
          rows.length === 0 ? (
            <EmptyState>No coupons.</EmptyState>
          ) : (
            <div className="flex flex-col gap-5 pb-6">
              <MiniTable
                className="[&_td]:py-4"
                head={[
                  "Code",
                  { label: "Unlocks", align: "left" },
                  { label: "Member", align: "left" },
                  { label: "Valid", align: "left" },
                  { label: "Max Uses", align: "right" },
                ]}
              >
                {rows.map(({ coupon }) => (
                  <MiniRow key={`${coupon.code}:${coupon.rule_id}`}>
                    <MiniCell>
                      <span className="flex items-center gap-2">
                        <span
                          className={
                            coupon.active
                              ? "font-mono text-ink"
                              : "font-mono text-mute"
                          }
                        >
                          {coupon.code}
                        </span>
                        {/* Off is worth saying; running is the ordinary
                            case and wears no badge. */}
                        {!coupon.active && (
                          <span className="text-[0.875rem] text-mute">
                            Inactive
                          </span>
                        )}
                      </span>
                    </MiniCell>
                    <MiniCell>
                      {/* The promotion it opens, one click away. */}
                      {ruleName.has(coupon.rule_id) ? (
                        <AppLink
                          to="/commercial/promotions"
                          sheet={{ key: "rule", value: coupon.rule_id }}
                          className="block truncate text-accent hover:underline"
                        >
                          {ruleName.get(coupon.rule_id)}
                        </AppLink>
                      ) : (
                        <span className="text-mute">—</span>
                      )}
                    </MiniCell>
                    <MiniCell>
                      {coupon.customer_id === null ? (
                        // The ordinary case: a code anybody may present.
                        <span className="text-mute">Anyone</span>
                      ) : (
                        <span className="truncate text-body">
                          {coupon.customer_id}
                        </span>
                      )}
                    </MiniCell>
                    <MiniCell>
                      <span className="text-body">
                        {coupon.valid_from === null && coupon.valid_to === null
                          ? "Always"
                          : `${coupon.valid_from === null ? "—" : day(coupon.valid_from)} – ${
                              coupon.valid_to === null
                                ? "—"
                                : day(coupon.valid_to)
                            }`}
                      </span>
                    </MiniCell>
                    <MiniCell align="right">
                      <span className="tabular-nums">
                        {coupon.max_uses === null
                          ? "Unlimited"
                          : count(coupon.max_uses)}
                      </span>
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            </div>
          ),
      })}
    </Sheet>
  )
}
