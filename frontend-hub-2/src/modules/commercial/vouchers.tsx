import { Ticket } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"

import { PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { SearchField } from "@/kit/field"
import { Sheet } from "@/kit/sheet"
import { Table } from "@/kit/table"
import { Tabs } from "@/kit/tabs"
import { Tag } from "@/kit/tag"
import { Tile, Tiles } from "@/kit/tiles"
import { Truncated } from "@/kit/notice"
import { Empty, Failed, Loading, NoMatch } from "@/kit/state"
import { amount, count, day, rp, today } from "@/lib/format"
import { useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import { useDebounced } from "@/lib/use-debounced"
import type { TableSetup } from "@/lib/table"
import {
  Fact,
  Facts,
  Line,
  Meter,
  Quiet,
  SubHead,
} from "@/modules/commercial/parts"
import {
  movementKind,
  voucherKind,
  voucherStatus,
} from "@/modules/commercial/labels"
import type {
  VoucherDetail,
  VoucherList,
  VoucherRow,
} from "@/modules/commercial/wire"

/// Vouchers — value a customer already holds and can pay with.
///
/// **This is the one Commercial screen that is not pricing**, and the
/// distinction is the reason it has a row of its own rather than a column on
/// Promotions. The other three all answer "what does this cost": a price, a
/// clearance replacing it, an offer coming off several. A voucher answers "what
/// did they pay with" — it is tender, sitting beside cash and a card at the
/// counter, and it is *spent*, never *applied*.
///
/// The system this replaces is the proof that it matters. It filed both under
/// one voucher table, `percent_off` beside `stored_value`, and booked a gift
/// card settled at the till as a discount against margin — so the shop's margin
/// got worse every time somebody spent money the shop was already holding. The
/// discount half of that table is what this app calls a **coupon**: a code that
/// unlocks a promotion and never carries a balance. It is on Promotions, as a
/// gate, where it belongs.
///
/// ## Why `useReport` when the endpoint really does narrow
///
/// `GET /commercial/vouchers` is the best-behaved read on this surface —
/// `status`, `kind`, `member_id` and `q` are all applied in SQL, and `q`
/// reaches the card code, the holder's name and the member id, normalised so a
/// cashier typing `AB-12 34` finds `AB1234`. What it does not have is a cursor
/// or a sort, and it answers `{ vouchers, ledger }` rather than a bare array —
/// so `useCursorList` has nothing to page with and `useBoundedList` would not
/// parse the envelope. `limit` defaults to 200 and clamps at 1.000; when the
/// answer comes back full, `<Truncated>` says so, because this endpoint
/// genuinely cannot say how many more there are.
///
/// ## The strip above the list is a liability, and it never moves with the
/// filter
///
/// `outstanding_minor` is what the shop OWES: money taken for cards nobody has
/// spent yet. The server computes the ledger over every voucher rather than
/// over the query, deliberately — a liability that changed because somebody
/// typed in a search box is a figure nobody could repeat to an accountant. So
/// the tiles and the table below them answer different questions on purpose,
/// and the scope line says which is which.
///
/// ## What did not come across
///
/// Issuing, redeeming and voiding. All three are writes carrying an idempotency
/// key, and the reason is sharper here than on most screens: a retried issue is
/// a gift card the shop never sold, and a retried redemption spends the same
/// money twice. They belong in their own change, with the retry semantics
/// looked at rather than inherited.

/// The three states a card is in. `expired` is deliberately not a fourth: a
/// card past its date is still ACTIVE with a balance on it — what changed is
/// the clock, not the record — so it is a second mark beside the status.
/// Folding them would mean a card could be un-expired by editing a status,
/// which is exactly backwards.
const STATUSES = ["ACTIVE", "SPENT", "VOIDED"] as const

/// The endpoint's own default. Restated because `<Truncated>` prints it.
const LIMIT = 200

export function VouchersScreen() {
  const url = useQueryState()
  const typed = url.one("q")
  const status = url.one("status")
  const kind = url.one("kind")
  const openCode = url.one("voucher")
  const q = useDebounced(typed, 200)

  const list = useReport<VoucherList>({
    key: ["commercial", "vouchers"],
    path: "/api/v1/commercial/vouchers",
    // Every narrowing on the wire, and every one of them part of the cache key.
    // A key that ignored a filter would answer a filtered question with an
    // unfiltered list.
    params: {
      q: q || null,
      status: status || null,
      kind: kind || null,
      limit: LIMIT,
    },
  })

  const rows = list.data?.vouchers ?? []
  const ledger = list.data?.ledger

  const columns: ColumnDef<TableSetup, VoucherRow>[] = [
    {
      id: "card",
      header: "Card",
      size: 22,
      // No priority: the code is what everybody outside this system says out
      // loud, which is why the routes are keyed on it rather than on the uuid.
      meta: { icon: <Ticket className="size-[15px]" />, min: 195 },
      cell: ({ row }) => (
        <>
          <span className="text-ink block truncate font-mono font-medium">
            {row.original.code}
          </span>
          <span className="text-label text-ink-4 block truncate">
            {voucherKind(row.original.kind)}
            {row.original.issued_site !== null && (
              <> · {row.original.issued_site}</>
            )}
          </span>
        </>
      ),
    },
    {
      id: "holder",
      header: "Holder",
      size: 18,
      meta: { min: 160, priority: 3 },
      // A voucher with no member is not an incomplete record: a gift card is
      // bought FOR SOMEBODY ELSE, and the shop legitimately does not know who
      // will present it. "Bearer" is the accurate word, which is why this
      // column is never blank.
      cell: ({ row }) =>
        row.original.member_id === null ? (
          <Quiet>Bearer</Quiet>
        ) : (
          <span className="truncate">
            {row.original.member_name ?? row.original.member_id}
          </span>
        ),
    },
    {
      id: "face",
      header: "Face value",
      size: 13,
      meta: { align: "right", min: 120, priority: 2 },
      cell: ({ row }) => (
        <span className="text-ink-3 tabular-nums">
          {amount(row.original.issued_minor)}
        </span>
      ),
    },
    {
      id: "balance",
      header: "Left on it",
      size: 20,
      // Never dropped. The balance and how much of the card it is, together: a
      // number alone does not say whether Rp 50.000 is most of a card or the
      // last of one, and that is the difference between a customer who will be
      // back and one who will not.
      meta: { align: "right", min: 180 },
      cell: ({ row }) => {
        const card = row.original
        const left =
          card.issued_minor > 0 ? card.balance_minor / card.issued_minor : null
        return (
          <span className="flex items-center justify-end gap-2">
            {/* The meter fills with what has been SPENT, not with what is
                left — the same direction as every other meter in this module,
                where a full bar means a thing is used up and the colour goes
                red when it is. Filling it with the remainder would make a
                brand-new card a full red bar, which is the alarm exactly
                backwards. The figure beside it is the balance, which is the
                number somebody is actually reading. */}
            {left !== null && (
              <span title="How much of the face value has been spent.">
                <Meter share={1 - left} />
              </span>
            )}
            <span className="text-ink font-medium tabular-nums">
              {amount(card.balance_minor)}
            </span>
          </span>
        )
      },
    },
    {
      id: "status",
      header: "Status",
      size: 15,
      meta: { min: 155 },
      cell: ({ row }) => {
        const known = voucherStatus(row.original.status)
        return (
          <span className="flex flex-wrap items-center gap-1">
            <Tag tone={known.tone}>{known.label}</Tag>
            {/* Two marks, not one word. A single "Expired" pill would hide the
                balance still sitting on it — which is the money the shop is
                still holding. */}
            {row.original.expired && <Tag tone="warn">Past date</Tag>}
          </span>
        )
      },
    },
    {
      id: "issued",
      header: "Issued",
      size: 12,
      meta: { align: "right", min: 115, priority: 1 },
      cell: ({ row }) => (
        <span className="text-ink-3">{day(row.original.issued_at)}</span>
      ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Commercial"
        title="Vouchers"
        description="Value a customer already holds and can pay with. Not a price, and not a discount."
      />

      <Tabs
        label="Status"
        value={status}
        onChange={(value) => url.set({ status: value || null }, false)}
        // No counts. The endpoint returns no status facets, and a tab strip
        // showing zeroes it never measured is worse than one showing none —
        // see `kit/tabs.tsx`, where the counts are called the point of the
        // strip. They will appear the day the endpoint counts them.
        tabs={[
          { value: "", label: "All" },
          ...STATUSES.map((value) => ({
            value,
            label: voucherStatus(value).label,
          })),
        ]}
      />

      {/* A balance, not a flow. The ledger below is what the shop is holding at
          this instant; the movements inside a card are the flow, and they are
          in the sheet where a period can be read off them. */}
      <ScopeLine
        scope={{ kind: "asAt", date: today() }}
        note="the ledger covers every voucher ever issued — never the filter"
      />

      <Tiles>
        {/* Outstanding leads, because it is the only figure here that is a
            number on the balance sheet: money taken for cards nobody has spent
            yet. Every one of them is the SERVER's, over the whole book. */}
        <Tile
          label="Outstanding"
          value={ledger?.outstanding_minor ?? 0}
          tone="warn"
          note={
            ledger === undefined
              ? undefined
              : `${count(ledger.outstanding_count)} cards still carry value`
          }
        />
        <Tile
          label="Issued"
          value={ledger?.issued_minor ?? 0}
          note={
            ledger === undefined
              ? undefined
              : `${count(ledger.issued_count)} cards, ever`
          }
        />
        <Tile
          label="Spent"
          value={ledger?.redeemed_minor ?? 0}
          tone="ok"
          note="settled at a till, or by hand"
        />
        <Tile
          label="Written off"
          value={ledger?.voided_minor ?? 0}
          note="stopped rather than spent — somebody's decision"
        />
        <Tile
          label="Past date"
          value={ledger?.expired_minor ?? 0}
          tone={(ledger?.expired_minor ?? 0) > 0 ? "warn" : undefined}
          note={
            ledger === undefined
              ? undefined
              : `${count(ledger.expired_count)} cards — revenue or a complaint`
          }
        />
      </Tiles>

      {rows.length >= LIMIT && <Truncated limit={LIMIT} noun="vouchers" />}

      <Toolbar
        trailing={
          list.isFetching
            ? "Loading…"
            : `${count(rows.length)} ${rows.length === 1 ? "card" : "cards"}`
        }
      >
        <SearchField
          value={typed}
          onChange={(value) => url.set({ q: value || null })}
          // Says what it searches because the server decides it, not the
          // browser: the code, the holder's name, and the member id — with the
          // spaces and dashes off a printed card stripped before matching.
          placeholder="Search a card code or a holder"
          className="w-[22rem]"
        />
        <Kinds
          value={kind}
          onChange={(value) => url.set({ kind: value || null }, false)}
        />
      </Toolbar>

      {list.isError ? (
        <Failed
          what="the vouchers"
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      ) : list.isPending ? (
        <Loading cols={6} />
      ) : rows.length === 0 ? (
        q === "" && status === "" && kind === "" ? (
          <Empty
            what="vouchers"
            detail="No gift card, refund or goodwill voucher has ever been issued, so the shop is holding none of a customer's money."
          />
        ) : (
          <NoMatch
            what="vouchers"
            // No count. The endpoint answers no total for the unfiltered set —
            // the ledger's `issued_count` is every voucher ever issued, which
            // is a different question from "how many are behind this filter",
            // and quoting it here would answer the wrong one.
            onClear={() =>
              url.set({ q: null, status: null, kind: null }, false)
            }
          />
        )
      ) : (
        <Table
          columns={columns}
          rows={rows as VoucherRow[]}
          rowId={(row) => row.code}
          caption="Vouchers the shop has issued"
          onRowClick={(row) => url.set({ voucher: row.code }, false)}
          isOpen={(row) => row.code === openCode}
          foot={{
            card: (
              <>
                <b className="text-ink">{count(rows.length)}</b>{" "}
                {rows.length === 1 ? "card" : "cards"} shown
              </>
            ),
            // The liability, restated at the foot of the list it does NOT
            // describe. Labelled so, because a figure at the bottom of a
            // filtered table is read as that table's total unless it says
            // otherwise.
            balance:
              ledger === undefined ? null : (
                <span title="Over every voucher ever issued, not over the rows above.">
                  {rp(ledger.outstanding_minor)} owed in all
                </span>
              ),
          }}
        />
      )}

      <VoucherSheet
        openCode={openCode}
        row={rows.find((row) => row.code === openCode)}
        onClose={() => url.set({ voucher: null }, false)}
      />
    </div>
  )
}

/// The three kinds, as a picker.
///
/// A `<select>` and not a second tab strip: the status strip above already owns
/// the one dimension that changes what a row IS, and two strips of tabs is two
/// things claiming to be the primary slice. The accounting differs by kind at
/// the moment of issue — a gift card was paid for and is a liability, goodwill
/// was given away and is an expense that day — so it is a real narrowing and
/// not a cosmetic one.
function Kinds({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="h-ctl rounded-ctl border-line-2 bg-canvas shadow-btn focus-within:border-blue flex shrink-0 items-center gap-2 border px-2.5">
      <span className="text-ctl text-ink-4">Kind</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="text-ctl text-ink bg-transparent outline-none"
      >
        <option value="">Any</option>
        <option value="GIFT_CARD">Gift card</option>
        <option value="REFUND">Refund</option>
        <option value="GOODWILL">Goodwill</option>
      </select>
    </label>
  )
}

/// One card and its whole history.
///
/// Read from `GET /commercial/vouchers/{code}` rather than from the row behind
/// it, because the record carries what the list cannot: every movement, signed,
/// with the balance it left behind. A URL naming a card the list is not holding
/// — a link in a message, anything past the cap — opens the record all the
/// same, which is the promise the code in the address bar makes.
function VoucherSheet({
  openCode,
  row,
  onClose,
}: {
  openCode: string
  /// The row from the list, when the list happens to hold it. Used only for the
  /// heading, so the panel has a code in it before the record lands.
  row: VoucherRow | undefined
  onClose: () => void
}) {
  const record = useReport<VoucherDetail>({
    key: ["commercial", "voucher", openCode],
    path: `/api/v1/commercial/vouchers/${encodeURIComponent(openCode)}`,
    enabled: openCode !== "",
  })

  const card = record.data?.voucher ?? row

  return (
    <Sheet
      open={openCode !== ""}
      onClose={onClose}
      width="record"
      title={<span className="font-mono">{openCode}</span>}
      subtitle={
        card === undefined
          ? "Reading the card…"
          : `${voucherKind(card.kind)} · ${voucherStatus(card.status).label}`
      }
    >
      {record.isError ? (
        <Failed
          what="this card"
          error={record.error}
          onRetry={() => void record.refetch()}
        />
      ) : card === undefined ? (
        <Loading rows={5} cols={2} />
      ) : (
        <>
          <Facts>
            <Fact label="Face value">{rp(card.issued_minor)}</Fact>
            <Fact label="Left on it">
              <b className="text-ink font-medium">{rp(card.balance_minor)}</b>
            </Fact>
            <Fact label="Spent">
              {/* The server's subtraction, not one done here: `issued -
                  balance` computed in a browser is a third number that can
                  disagree with the two it came from. */}
              {rp(card.spent_minor)}
            </Fact>
            <Fact label="Status">
              <span className="flex items-center gap-1.5">
                <Tag tone={voucherStatus(card.status).tone}>
                  {voucherStatus(card.status).label}
                </Tag>
                {card.expired && <Tag tone="warn">Past date</Tag>}
              </span>
            </Fact>
            <Fact label="Holder">
              {card.member_id === null ? (
                <Quiet>Bearer — bought for somebody the shop cannot name</Quiet>
              ) : (
                (card.member_name ?? card.member_id)
              )}
            </Fact>
            <Fact label="Expires">
              {card.expires_at === null ? (
                <Quiet>No end date</Quiet>
              ) : (
                day(card.expires_at)
              )}
            </Fact>
            <Fact label="Issued" wide>
              {day(card.issued_at)} by {card.issued_by}
              {card.issued_site !== null && <> at {card.issued_site}</>}
            </Fact>
            {card.note !== null && (
              <Fact label="Note" wide>
                {card.note}
              </Fact>
            )}
          </Facts>

          <SubHead>
            Movements — signed, so they add up to the balance above
          </SubHead>
          {record.isPending ? (
            <Loading rows={3} cols={3} />
          ) : (record.data?.movements.length ?? 0) === 0 ? (
            <Line>
              <Quiet>Nothing has moved since it was issued.</Quiet>
            </Line>
          ) : (
            record.data?.movements.map((move) => (
              <Line
                key={move.movement_id}
                note={
                  <>
                    {day(move.occurred_at)} · {move.actor}
                    {move.site_id !== null && <> · {move.site_id}</>}
                    {move.note !== null && <> · {move.note}</>}
                  </>
                }
              >
                <span className="min-w-0 flex-1 truncate">
                  {movementKind(move.kind)}
                </span>
                <span
                  className={
                    move.amount_minor < 0
                      ? "text-bad-ink shrink-0 tabular-nums"
                      : "text-ok-ink shrink-0 tabular-nums"
                  }
                >
                  {move.amount_minor < 0 ? "−" : "+"}
                  {amount(Math.abs(move.amount_minor))}
                </span>
                <span className="text-ink-4 shrink-0 tabular-nums">
                  {amount(move.balance_after_minor)}
                </span>
              </Line>
            ))
          )}
        </>
      )}
    </Sheet>
  )
}
