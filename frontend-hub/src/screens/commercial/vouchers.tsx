import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useCallback, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Day } from "@/components/ui/day"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Meter } from "@/components/ui/meter"
import { DockedFilters } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, Truncated } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { commercialKeys, promotionCatalogue } from "@/lib/queries/commercial"
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
  type VoucherKind,
  type VoucherRow,
  type VoucherStatus,
} from "@/lib/queries/vouchers"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"

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
      return "Stopped"
  }
}

/// The same three words, plus the one the clock adds.
///
/// The filter picker reads this column's accessor, which folds "past its date"
/// in beside the stored status — so the picker has a fourth value to name and
/// `statusWord` above, typed to the three the record can hold, cannot name it.
/// Two words could have drifted apart; they do not, because this one defers.
function stateWord(value: string): string {
  if (value === "EXPIRED") return "Past date"
  return statusWord(value as VoucherStatus)
}

/// Who is holding it, in the words the shop would use.
///
/// A voucher with no member is not an incomplete record: a gift card is bought
/// *for somebody else*, and the shop legitimately does not know who will
/// present it. "Bearer" is the accurate word for that and is the reason the
/// column is never blank.
function holder(row: VoucherRow): string {
  if (row.member_id === null) return "Bearer"
  return row.member_name ?? row.member_id
}

const columns: ColumnDef<TableSetup, VoucherRow>[] = [
  {
    id: "code",
    accessorFn: (row) =>
      `${row.code} ${row.member_name ?? ""} ${row.member_id ?? ""}`,
    header: "Card",
    size: 200,
    cell: ({ row }) => (
      <span className="flex min-w-0 items-center gap-2">
        <Tag>{row.original.code}</Tag>
        <span className="truncate text-[0.78125rem] text-mute">
          {describeKind(row.original.kind)}
        </span>
      </span>
    ),
  },
  {
    id: "holder",
    accessorFn: (row) => holder(row),
    header: "Holder",
    size: 180,
    // No filter: the box in the header already searches the holder, and this
    // accessor never goes blank — an unnamed card reads "Bearer" — so an
    // emptiness clause would find nothing and a facet would be a list of every
    // member who has ever been given a card.
    cell: ({ row }) =>
      row.original.member_id === null ? (
        <span className="text-mute">Bearer</span>
      ) : (
        <span className="truncate text-[0.8125rem] text-ink">
          {holder(row.original)}
        </span>
      ),
  },
  {
    id: "face",
    accessorFn: (row) => row.issued_minor,
    header: "Face value",
    size: 130,
    // **No scale.** `issued_minor` holds whole rupiah despite its name — see
    // `lib/format`'s `money` — so a bound is compared exactly as it is typed.
    // Multiplying by a hundred here is what makes a filter for cards over
    // 500.000 match nothing at all.
    meta: {
      align: "right",
      filter: { kind: "number", label: "Face value", unit: "Rp" },
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
    header: "Left on it",
    size: 190,
    // The liability, card by card. "At least 100.000" is how somebody finds
    // what the shop is actually holding against the figure in the strip, and
    // "is 0" is a spent card that has not been marked SPENT.
    meta: {
      align: "right",
      filter: { kind: "number", label: "Left on it", unit: "Rp" },
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
            className="w-14"
          />
          <span className="w-24 text-right text-ink tabular-nums">
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
    size: 150,
    // `EXPIRED` is in this accessor and not in the segment above, which is
    // what makes the clause worth having: the segment asks the SERVER for a
    // stored status, and past-its-date is not one — it is the clock. So "is
    // EXPIRED" is the only way to ask for live cards nobody may spend, which
    // is the list somebody writing off a liability wants.
    meta: { filter: { kind: "option", label: "Status", format: stateWord } },
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5">
        <Pill tone={statusTone(row.original.status)}>
          {statusWord(row.original.status)}
        </Pill>
        {/* Two marks, not one word, because they are two facts: the card is
            live and it is past its date. A single "Expired" pill would hide
            the balance still sitting on it. */}
        {row.original.expired && <Pill tone="warn">Past date</Pill>}
      </span>
    ),
  },
  {
    id: "issued",
    accessorFn: (row) => row.issued_at,
    header: "Issued",
    size: 130,
    // A voucher book is read by period — what was sold before Christmas, what
    // is still outstanding from last year — and that is a question no search
    // box and no sort can be made to answer.
    meta: { align: "right", filter: { kind: "date", label: "Issued" } },
    cell: ({ row }) => (
      <span className="text-body tabular-nums">
        {day(row.original.issued_at)}
      </span>
    ),
  },
]

type Shown = "ALL" | VoucherStatus

/// How many cards one answer carries.
///
/// Not asked for — this screen sends no `limit`, so it is the server's own
/// `DEFAULT_PAGE` in `postgres/vouchers.rs`. Named here anyway, because the
/// alternative is a screen that is silently a page of a book: everything on it
/// is filtered, sorted and totalled over these rows and no others, and a
/// reader has no way to tell that from the whole voucher book.
const PAGE = 200

export function Vouchers() {
  const search = useSheet("q")
  const open = useSheet("voucher")
  const [shown, setShown] = useState<Shown>("ALL")
  const [sorting, setSorting] = useState<SortingState>([])
  const [issuing, setIssuing] = useState(false)
  const [coupons, setCoupons] = useState(false)

  const list = useQuery({
    queryKey: voucherKeys.list({
      status: shown === "ALL" ? undefined : shown,
    }),
    queryFn: ({ signal }) =>
      listVouchers({ status: shown === "ALL" ? undefined : shown }, signal),
  })

  const rows = useMemo(() => list.data?.rows ?? [], [list.data])

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: VoucherRow) => row.code,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: search.value ?? "",
          sorting,
        },
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, search.value, sorting]
    )
  )

  const ledger = list.data?.ledger

  return (
    <PageContent>
      <PageHeader
        crumb="Commercial"
        title="Vouchers"
        sub="Value a customer already holds and can pay with. Not a price, and not a discount."
        actions={
          <>
            <Input
              value={search.value ?? ""}
              onChange={(event) =>
                event.target.value === ""
                  ? search.close()
                  : search.open(event.target.value)
              }
              placeholder="Card code or holder"
              className="h-8 w-52"
            />
            {/* Coupons live here as a READER only — no list screen, no menu
                row. A coupon is a gate on a promotion and cannot exist without
                one, so it is authored on the promotion form; what it lacks is
                a place to answer "which codes are out there", and a sheet on
                the screen people already associate with codes answers it
                without implying a coupon is a thing of its own. */}
            <Button variant="soft" onClick={() => setCoupons(true)}>
              Coupons
            </Button>
            <Button variant="primary" onClick={() => setIssuing(true)}>
              New voucher
            </Button>
          </>
        }
      />

      {ledger && (
        <KpiStrip>
          {/* Outstanding leads, because it is the only figure here that is a
              number on the balance sheet: money taken for cards nobody has
              spent yet. */}
          <Kpi
            label="Outstanding"
            value={money(ledger.outstanding_minor)}
            delta={`${count(ledger.outstanding_count)} live`}
          />
          <Kpi label="Issued" value={money(ledger.issued_minor)} />
          <Kpi label="Cards issued" value={count(ledger.issued_count)} />
          <Kpi label="Spent" value={money(ledger.redeemed_minor)} />
          <Kpi label="Written off" value={money(ledger.voided_minor)} />
          <Kpi
            label="Past date"
            value={money(ledger.expired_minor)}
            delta={`${count(ledger.expired_count)} cards`}
            tone={ledger.expired_count > 0 ? "down" : "flat"}
          />
        </KpiStrip>
      )}

      {/* The module's list shape: rows at the left, filters docked at the
          right. The last of the four lists still wearing a Filter button — a
          screen that narrows its rows differently from the three beside it is
          a screen people have to learn twice. */}
      <div className="grid min-w-0 items-start gap-5 min-[1440px]:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col">
          <Toolbar className="mb-3">
            <Segmented
              options={[
                { value: "ALL", label: "Everything" },
                { value: "ACTIVE", label: "Live" },
                { value: "SPENT", label: "Spent" },
                { value: "VOIDED", label: "Stopped" },
              ]}
              value={shown}
              onChange={setShown}
            />
            <Toolbar.Spacer />
            <span className="text-[0.75rem] text-mute tabular-nums">
              {count(rows.length)} cards
            </span>
          </Toolbar>

          {/* The strip above is the liability over every card ever issued and
              does not move with any of this; what moves is the list. Said
              because a page that came back exactly as long as the server's
              default may be hiding cards, and the outstanding figure would go
              on looking authoritative over a third of the book. */}
          {rows.length >= PAGE && <Truncated limit={PAGE} noun="cards" />}

          <Card className="overflow-hidden">
            {queryState(list, {
              loading: "Reading the voucher book…",
              render: (data) =>
                data.rows.length === 0 ? (
                  <EmptyState
                    action={
                      shown === "ALL" ? (
                        <Button
                          variant="primary"
                          onClick={() => setIssuing(true)}
                        >
                          New voucher
                        </Button>
                      ) : undefined
                    }
                  >
                    {shown === "ALL"
                      ? "No voucher has been issued. A card is money the shop already holds and still owes."
                      : "No card is in that state."}
                  </EmptyState>
                ) : (
                  <DataTable<VoucherRow>
                    table={table}
                    onRowClick={(row) => open.open(row.code)}
                    isSelected={(row) => row.code === open.value}
                    empty="No card matches that search."
                    className="max-h-[calc(100vh-24rem)]"
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

/// One card and everything that has happened to it.
///
/// Read by code rather than by uuid, because the code is what exists outside
/// this system: it is printed on the card, and somebody reading it out over a
/// telephone should be able to reach this.
/// One card, read back.
///
/// ## Sections, ruled 2026-09-13: Overview · Ledger · Activity
///
/// **Overview** is what the card IS and what is left on it. **Ledger** is every
/// movement that got it there, signed. They are two sections and not one scroll
/// for the reason a bank statement is not a balance: a reader checking "is
/// there 150.000 on this card" and a reader checking "where did the other
/// 350.000 go" are asking different questions, and a balance-shaped screen
/// answers only the first while looking like it answered both.
///
/// **Activity is the shell's, not this screen's.** `Sheet` appends the record
/// panel — the trail, the tags, what people said — to any sheet that names its
/// `subject`, and it labels that section *Comments* because commenting is what
/// somebody comes to it to DO. Adding a third section of our own called
/// "Activity" would put two history panels on one card, which is how the two
/// come to disagree about what happened.
function VoucherSheet({
  code,
  onClose,
}: {
  code: string | null
  onClose: () => void
}) {
  const detail = useQuery({
    queryKey: voucherKeys.detail(code ?? ""),
    queryFn: ({ signal }) => voucherDetail(code as string, signal),
    enabled: code !== null,
  })

  const data = detail.data ?? null

  // Built only when the card has arrived. `tabs` with no data would draw a
  // strip of empty sections over a spinner, and a section somebody clicks into
  // before it has anything to say is a section they conclude is broken.
  const sections =
    data === null
      ? undefined
      : [
          {
            value: "overview",
            label: "Overview",
            content: (
              <div className="flex flex-col gap-5">
                <Facts>
                  <Fact term="Left on it">
                    {money(data.voucher.balance_minor)}
                  </Fact>
                  <Fact term="Face value">
                    {money(data.voucher.issued_minor)}
                  </Fact>
                  <Fact term="Spent">{money(data.voucher.spent_minor)}</Fact>
                  <Fact term="Holder">{holder(data.voucher)}</Fact>
                  <Fact term="Issued">{day(data.voucher.issued_at)}</Fact>
                  <Fact term="Issued by">{data.voucher.issued_by}</Fact>
                  <Fact term="At">{data.voucher.issued_site ?? "—"}</Fact>
                  <Fact term="Expires">
                    {data.voucher.expires_at === null
                      ? "Never"
                      : day(data.voucher.expires_at)}
                  </Fact>
                </Facts>

                {data.voucher.note && (
                  <p className="text-[0.78125rem] leading-relaxed text-body">
                    {data.voucher.note}
                  </p>
                )}

                {/* On Overview rather than pinned above the sections: spending
                    a card and stopping one are things done to the card as it
                    stands, and the figures they act on are the eight facts
                    directly above them. */}
                {data.voucher.status === "ACTIVE" && (
                  <Actions voucher={data.voucher} />
                )}
              </div>
            ),
          },
          {
            value: "ledger",
            label: `Ledger (${count(data.movements.length)})`,
            content: (
              <div>
                <SubHead aside={`${count(data.movements.length)} entries`}>
                  What has happened to it
                </SubHead>
                {/* Signed, so the history reads as arithmetic. A column of
                    positives where some of them mean the opposite is the shape
                    that makes a balance impossible to check by eye. */}
                <MiniTable
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
                          {describeMovement(movement.kind)}
                        </span>
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
        ]

  return (
    <Sheet
      open={code !== null}
      onOpenChange={(next) => !next && onClose()}
      id={code ?? undefined}
      title={
        data === null
          ? "Voucher"
          : `${describeKind(data.voucher.kind)} · ${money(data.voucher.balance_minor)}`
      }
      subject={code === null ? undefined : { kind: "voucher", id: code }}
      tabs={sections}
      badge={
        data === null ? undefined : (
          <span className="flex flex-wrap items-center gap-1.5">
            <Pill tone={statusTone(data.voucher.status)}>
              {statusWord(data.voucher.status)}
            </Pill>
            {data.voucher.expired && <Pill tone="warn">Past date</Pill>}
            {data.voucher.member_id === null && (
              <Pill tone="neutral">Bearer</Pill>
            )}
          </span>
        )
      }
    >
      {/* Only reached while the card is still arriving — once it has, the
          sections above are what the sheet draws. */}
      {queryState(detail, {
        loading: "Reading the card…",
        render: () => null,
      })}
    </Sheet>
  )
}

/// Spend some of a card, or stop it.
///
/// Both are on the sheet rather than the row, and both take a sentence: a
/// redemption that no basket explains and a stoppage with no reason are the
/// two entries a reconciliation cannot resolve six months later.
function Actions({ voucher }: { voucher: VoucherRow }) {
  const [doing, setDoing] = useState<"REDEEM" | "VOID" | null>(null)

  return (
    <div className="flex flex-col gap-3 rounded-inner border border-hairline-2 p-3.5">
      <div className="flex items-center gap-2">
        <Button
          variant={doing === "REDEEM" ? "primary" : "ghost"}
          onClick={() => setDoing(doing === "REDEEM" ? null : "REDEEM")}
        >
          Spend against a sale
        </Button>
        <Button
          variant={doing === "VOID" ? "primary" : "ghost"}
          onClick={() => setDoing(doing === "VOID" ? null : "VOID")}
        >
          Stop the card
        </Button>
      </div>

      {doing === "REDEEM" && (
        <RedeemForm voucher={voucher} onDone={() => setDoing(null)} />
      )}
      {doing === "VOID" && (
        <VoidForm voucher={voucher} onDone={() => setDoing(null)} />
      )}
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
      className="flex flex-col gap-3"
    >
      {spend.isError && <Banner tone="bad">{said(spend.error)}</Banner>}

      <form.Field name="amount">
        {(field) => (
          <Field
            label="Amount"
            hint={`Partial is normal — ${money(voucher.balance_minor)} is on the card, and whatever is left stays on it.`}
            problem={
              minorFrom(field.state.value) > voucher.balance_minor
                ? `Only ${money(voucher.balance_minor)} is left on this card.`
                : undefined
            }
          >
            <Money
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              placeholder="150.000"
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="sale">
        {(field) => (
          <Field
            label="Sale"
            hint="The basket it paid for. Optional — the sale may not have reached the centre yet."
          >
            <Input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="Sale id"
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="note">
        {(field) => (
          <Field
            label="Note"
            hint="Why this was settled by hand rather than at a till."
          >
            <Textarea
              rows={2}
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
            disabled={
              spend.isPending ||
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

function VoidForm({
  voucher,
  onDone,
}: {
  voucher: VoucherRow
  onDone: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()

  const stop = useMutation({
    mutationFn: (reason: string) =>
      voidVoucher(voucher.code, { reason: reason.trim() }, idempotency.key),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: voucherKeys.all })
      idempotency.rotate()
      onDone()
    },
  })

  const form = useForm({
    defaultValues: { reason: "" },
    onSubmit: ({ value }) => stop.mutate(value.reason),
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        form.handleSubmit()
      }}
      className="flex flex-col gap-3"
    >
      {stop.isError && <Banner tone="bad">{said(stop.error)}</Banner>}

      {voucher.balance_minor > 0 && (
        // Said before the field, not after the click. Stopping a card with
        // money on it takes value away from a customer, and the amount is the
        // part somebody needs to see while deciding.
        <Banner tone="warn">
          {money(voucher.balance_minor)} is still on this card. Stopping it
          writes that off — the balance goes to nothing and the customer cannot
          spend it.
        </Banner>
      )}

      <form.Field name="reason">
        {(field) => (
          <Field
            label="Reason"
            hint="Required, and required in words: this is the whole record of somebody deciding to take value back."
          >
            <Textarea
              rows={2}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="Reported stolen; replacement issued as …"
            />
          </Field>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.reason}>
        {(reason) => (
          <Button
            variant="primary"
            type="submit"
            disabled={stop.isPending || reason.trim().length < 4}
            className="self-start"
          >
            {stop.isPending ? "Stopping…" : "Stop the card"}
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
    >
      <form
        // Keyed on nothing: the sheet unmounts on close, so a second card is
        // always started from empty rather than from the last one's values.
        onSubmit={(event) => {
          event.preventDefault()
          form.handleSubmit()
        }}
        className="flex flex-col gap-3.5"
      >
        {issue.isError && <Banner tone="bad">{said(issue.error)}</Banner>}

        <form.Field name="kind">
          {(field) => (
            <Field
              label="Kind"
              hint="How it is booked: paid for, given away, or a sale unwound."
            >
              <Select
                value={field.state.value}
                onChange={(next) => field.handleChange(next as VoucherKind)}
              >
                <option value="GIFT_CARD">
                  Gift card — bought by somebody
                </option>
                <option value="REFUND">Refund — a sale being unwound</option>
                <option value="GOODWILL">Goodwill — given away</option>
              </Select>
            </Field>
          )}
        </form.Field>

        <form.Field name="amount">
          {(field) => (
            <Field
              label="Value"
              hint="In rupiah. Frozen at issue: the face value never changes, only the balance does."
            >
              <Money
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={field.handleChange}
                placeholder="200.000"
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="member">
          {(field) => (
            <Field
              label="Holder"
              hint="Leave blank for a bearer card — whoever holds it can spend it."
            >
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="Member id"
              />
            </Field>
          )}
        </form.Field>

        <div className="grid grid-cols-2 gap-3">
          <form.Field name="code">
            {(field) => (
              <Field
                label="Code"
                hint="Only for pre-printed stock."
                className="min-w-0"
              >
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Minted for you"
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="expires">
            {(field) => (
              <Field label="Expires" hint="Optional." className="min-w-0">
                <Day
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                />
              </Field>
            )}
          </form.Field>
        </div>

        <form.Field name="note">
          {(field) => (
            <Field
              label="Note"
              hint="Why it was issued. The one thing an audit six months from now cannot reconstruct."
            >
              <Textarea
                rows={2}
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
              disabled={issue.isPending || minorFrom(amount) <= 0}
              className="self-start"
            >
              {issue.isPending
                ? "Issuing…"
                : `Issue ${money(minorFrom(amount))}`}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </Sheet>
  )
}

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
          <Pill tone="neutral">{count(rows.length)} codes</Pill>
        )
      }
    >
      {queryState(catalogue, {
        loading: "Opening every published book…",
        render: (data) =>
          rows.length === 0 ? (
            <EmptyState>
              No coupon is published. {count(data.book_count)} book
              {data.book_count === 1 ? "" : "s"} were opened to check. A code is
              added on the promotion it unlocks.
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-5">
              <MiniTable
                head={[
                  "Code",
                  { label: "Unlocks", align: "left" },
                  { label: "Holder", align: "left" },
                  { label: "Valid", align: "left" },
                  { label: "Uses", align: "right" },
                ]}
              >
                {rows.map(({ coupon, book }) => (
                  <MiniRow key={`${coupon.code}:${coupon.rule_id}`}>
                    <MiniCell>
                      <span className="flex items-center gap-2">
                        <Tag tone={coupon.active ? "warn" : undefined}>
                          {coupon.code}
                        </Tag>
                        {/* Stopped is worth saying; running is the ordinary
                            case and wears no badge. */}
                        {!coupon.active && (
                          <span className="text-[0.6875rem] text-mute">
                            stopped
                          </span>
                        )}
                      </span>
                    </MiniCell>
                    <MiniCell>
                      <span className="block truncate text-ink">
                        {ruleName.get(coupon.rule_id) ?? "—"}
                      </span>
                      <span className="block truncate text-[0.6875rem] text-mute">
                        {book.name}
                      </span>
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
                      <span className="text-[0.71875rem] text-body">
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

              <p className="text-[0.71875rem] text-mute">
                A coupon unlocks an offer; a voucher carries money. Codes are
                added on the promotion they belong to.
              </p>
            </div>
          ),
      })}
    </Sheet>
  )
}
