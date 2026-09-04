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
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
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
    meta: { align: "right" },
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
    meta: { align: "right" },
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
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="text-body tabular-nums">
        {day(row.original.issued_at)}
      </span>
    ),
  },
]

type Shown = "ALL" | VoucherStatus

export function Vouchers() {
  const search = useSheet("q")
  const open = useSheet("voucher")
  const [shown, setShown] = useState<Shown>("ALL")
  const [sorting, setSorting] = useState<SortingState>([])
  const [issuing, setIssuing] = useState(false)

  const list = useQuery({
    queryKey: voucherKeys.list({
      status: shown === "ALL" ? undefined : shown,
    }),
    queryFn: ({ signal }) =>
      listVouchers({ status: shown === "ALL" ? undefined : shown }, signal),
  })

  const rows = useMemo(() => list.data?.vouchers ?? [], [list.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: VoucherRow) => row.code,
        state: { globalFilter: search.value ?? "", sorting },
        onSortingChange: setSorting,
      }),
      [rows, search.value, sorting]
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
            <Button variant="dark" onClick={() => setIssuing(true)}>
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

      <Toolbar>
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
          {ledger && ` · ${money(ledger.outstanding_minor)} outstanding`}
        </span>
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(list, {
          loading: "Reading the voucher book…",
          render: (data) =>
            data.vouchers.length === 0 ? (
              <EmptyState
                action={
                  shown === "ALL" ? (
                    <Button variant="dark" onClick={() => setIssuing(true)}>
                      New voucher
                    </Button>
                  ) : undefined
                }
              >
                {shown === "ALL"
                  ? "No voucher has been issued. Issuing one takes money the shop is holding and puts it on a card the customer can spend — which is why it is a liability from the moment it exists."
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

  const voucher = detail.data?.voucher ?? null

  return (
    <Sheet
      open={code !== null}
      onOpenChange={(next) => !next && onClose()}
      id={code ?? undefined}
      title={
        voucher === null
          ? "Voucher"
          : `${describeKind(voucher.kind)} · ${money(voucher.balance_minor)}`
      }
      subject={code === null ? undefined : { kind: "voucher", id: code }}
    >
      {queryState(detail, {
        loading: "Reading the card…",
        render: (data) => (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill tone={statusTone(data.voucher.status)}>
                {statusWord(data.voucher.status)}
              </Pill>
              {data.voucher.expired && <Pill tone="warn">Past date</Pill>}
              {data.voucher.member_id === null && (
                <Pill tone="neutral">Bearer</Pill>
              )}
            </div>

            <Facts>
              <Fact term="Left on it">{money(data.voucher.balance_minor)}</Fact>
              <Fact term="Face value">{money(data.voucher.issued_minor)}</Fact>
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

            {data.voucher.status === "ACTIVE" && (
              <Actions voucher={data.voucher} />
            )}

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
          </div>
        ),
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
          variant={doing === "REDEEM" ? "dark" : "ghost"}
          onClick={() => setDoing(doing === "REDEEM" ? null : "REDEEM")}
        >
          Spend against a sale
        </Button>
        <Button
          variant={doing === "VOID" ? "dark" : "ghost"}
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
            hint="The basket it paid for, if there is one. Optional: a sale may still be at a till the centre has not received yet, and a redemption that waited for it would fail with a queue watching."
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
            variant="dark"
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
            variant="dark"
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
              hint="What this is, in accounting terms — a gift card was paid for, goodwill was given away, a refund is a sale being unwound."
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
              hint="A card number, if this belongs to somebody in particular. Left blank it is a bearer card — which is what a gift card usually is, because it is bought for somebody else."
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
              variant="dark"
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
