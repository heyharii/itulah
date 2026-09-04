import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Segmented } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, ErrorState } from "@/components/ui/states"
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

/// Vouchers — value a customer already holds, and the one Commercial surface
/// that is not pricing.
///
/// A voucher carries money. It is **tender**: it sits beside cash, a card and a
/// transfer at the counter, and it is spent rather than applied. The other
/// three surfaces all answer "what does this cost"; this one answers "what did
/// they pay with". The engine says so itself, in `pricing-engine/src/lib.rs`:
/// *a voucher carries money. It is tender, not pricing.*
///
/// Keeping the distinction is not pedantry. The system this replaces filed both
/// under one voucher table — `percent_off` and `free_item` beside
/// `stored_value` — and booked a gift card settled at the till as a discount
/// against margin. The shop's margin therefore looked worse every time somebody
/// spent money the shop was already holding. The discount half of that table is
/// what this app calls a **coupon**: a code that unlocks a promotion, which
/// never carries a balance and lives on the Promotions list.
///
/// # What the strip leads with, and why it is not a count
///
/// **Outstanding** — what the shop owes in goods it has already been paid for.
/// It is the only figure here that appears in the accounts, and it is the
/// reason a list of cards is not enough on its own. The server computes it over
/// the whole book and never over the filter, so it does not move when somebody
/// types in the search box; a liability that changed with a search term is one
/// nobody could quote.

const STATUSES = [
  { value: "" as const, label: "All" },
  { value: "ACTIVE" as const, label: "Live" },
  { value: "SPENT" as const, label: "Spent" },
  { value: "VOIDED" as const, label: "Stopped" },
]

const KINDS: readonly { value: VoucherKind; label: string; why: string }[] = [
  {
    value: "GIFT_CARD",
    label: "Gift card",
    why: "Somebody paid for this. The shop is holding their money until they come back for it.",
  },
  {
    value: "REFUND",
    label: "Refund",
    why: "A sale being unwound in credit rather than in cash.",
  },
  {
    value: "GOODWILL",
    label: "Goodwill",
    why: "Given away. Nothing came in, so it costs the shop the day it is issued.",
  },
]

/// Where a card stands, said in one badge.
///
/// Expired is drawn as a status even though the server does not store one, and
/// that is deliberate: a shopper presenting a card that is past its date meets
/// a refusal, so "live but expired" is a distinction only the database cares
/// about. The row keeps `ACTIVE` underneath; only the word here changes.
function Standing({ row }: { row: VoucherRow }) {
  if (row.status === "VOIDED") return <Pill tone="bad">Stopped</Pill>
  if (row.status === "SPENT") return <Pill tone="neutral">Spent</Pill>
  if (row.expired) return <Pill tone="warn">Expired</Pill>
  return <Pill tone="ok">Live</Pill>
}

/// How much of the card is gone, as a number rather than a bar.
///
/// A meter was the obvious choice and is the wrong one: what matters about a
/// voucher is the money left on it, not the proportion. Half of 20,000 and half
/// of 5,000,000 draw the same bar and are not the same fact.
function Balance({ row }: { row: VoucherRow }) {
  return (
    <span className="tabular-nums">
      <span className="font-medium text-ink">{money(row.balance_minor)}</span>
      {row.spent_minor > 0 && (
        <span className="text-mute"> of {money(row.issued_minor)}</span>
      )}
    </span>
  )
}

const voucherColumns: ColumnDef<TableSetup, VoucherRow>[] = [
  {
    id: "code",
    accessorFn: (row) => row.code,
    header: "Code",
    size: 140,
    meta: { filter: { kind: "text" } },
    cell: ({ row }) => (
      <span className="font-mono text-id text-ink">{row.original.code}</span>
    ),
  },
  {
    id: "status",
    accessorFn: (row) => (row.expired ? "EXPIRED" : row.status),
    header: "Standing",
    size: 100,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => <Standing row={row.original} />,
  },
  {
    id: "kind",
    accessorFn: (row) => row.kind,
    header: "Kind",
    size: 110,
    meta: { filter: { kind: "option", format: describeKind } },
    cell: ({ row }) => (
      <span className="text-text">{describeKind(row.original.kind)}</span>
    ),
  },
  {
    id: "balance",
    accessorFn: (row) => row.balance_minor,
    header: "Left on it",
    size: 170,
    meta: { align: "right" },
    cell: ({ row }) => <Balance row={row.original} />,
  },
  {
    id: "holder",
    accessorFn: (row) => row.member_name ?? row.member_id ?? "",
    header: "Held by",
    size: 170,
    meta: { filter: { kind: "text" } },
    // A gift card bought off the shelf belongs to whoever is holding it, and
    // that is the ordinary case rather than missing data — hence a sentence
    // and not a dash.
    cell: ({ row }) =>
      row.original.member_id === null ? (
        <span className="text-mute">Bearer</span>
      ) : (
        <span className="text-text">
          {row.original.member_name ?? row.original.member_id}
        </span>
      ),
  },
  {
    id: "expires",
    accessorFn: (row) => row.expires_at ?? "",
    header: "Expires",
    size: 120,
    cell: ({ row }) =>
      row.original.expires_at === null ? (
        <span className="text-mute">No end</span>
      ) : (
        <span className={row.original.expired ? "text-bad-fg" : "text-text"}>
          {day(row.original.expires_at)}
        </span>
      ),
  },
  {
    id: "issued",
    accessorFn: (row) => row.issued_at,
    header: "Issued",
    size: 120,
    cell: ({ row }) => <span className="text-text">{day(row.original.issued_at)}</span>,
  },
]

export function Vouchers() {
  const client = useQueryClient()
  const sheet = useSheet("voucher")
  const [status, setStatus] = useState<VoucherStatus | "">("")
  const [query, setQuery] = useState("")
  const [issuing, setIssuing] = useState(false)
  const [issued, setIssued] = useState<VoucherRow | null>(null)
  const [sorting, setSorting] = useState<SortingState>([
    { id: "issued", desc: true },
  ])

  const filter = useMemo(
    () => (status === "" ? {} : { status }),
    [status]
  )

  const list = useQuery({
    queryKey: voucherKeys.list(filter),
    queryFn: ({ signal }) => listVouchers(filter, signal),
  })

  const vouchers = useMemo(() => list.data?.vouchers ?? [], [list.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: vouchers as VoucherRow[],
        columns: voucherColumns,
        getRowId: (row: VoucherRow) => row.code,
        state: { globalFilter: query, sorting },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [vouchers, query, sorting]
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
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search a code or a name"
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
          <Kpi
            label="Outstanding"
            value={money(ledger.outstanding_minor)}
            delta={`${count(ledger.outstanding_count)} live`}
          />
          <Kpi label="Issued, ever" value={money(ledger.issued_minor)} />
          <Kpi label="Spent" value={money(ledger.redeemed_minor)} />
          <Kpi label="Written off" value={money(ledger.voided_minor)} />
          <Kpi
            label="Expired"
            value={money(ledger.expired_minor)}
            delta={`${count(ledger.expired_count)} card${ledger.expired_count === 1 ? "" : "s"}`}
            tone={ledger.expired_count > 0 ? "down" : "flat"}
          />
          <Kpi label="Cards" value={count(ledger.issued_count)} />
        </KpiStrip>
      )}

      {ledger !== undefined && ledger.expired_count > 0 && (
        <Banner tone="warn" className="mb-4">
          {count(ledger.expired_count)} card
          {ledger.expired_count === 1 ? " is" : "s are"} past their date with{" "}
          {money(ledger.expired_minor)} still on{" "}
          {ledger.expired_count === 1 ? "it" : "them"}. Nothing has happened to{" "}
          {ledger.expired_count === 1 ? "it" : "them"} automatically — the money
          is still counted as owed until somebody writes it off, which is a
          decision and not a sweep.
        </Banner>
      )}

      {issued && (
        <Banner tone="ok" className="mb-4" onDismiss={() => setIssued(null)}>
          {describeKind(issued.kind)} for {money(issued.issued_minor)} issued as{" "}
          <span className="font-mono text-id">{issued.code}</span>. Write the
          code on the card before this message is dismissed — it is not a
          secret, but it is the only handle the shopper has.
        </Banner>
      )}

      <div className="mb-3.5 flex items-center gap-2">
        <Segmented
          options={STATUSES}
          value={status}
          onChange={(next) => setStatus(next)}
        />
        <span className="text-[0.71875rem] text-mute">
          The figures above cover every voucher, whichever slice is shown here.
        </span>
      </div>

      <Card className="overflow-hidden">
        {queryState(list, {
          loading: "Reading the voucher book…",
          render: (data) =>
            data.vouchers.length === 0 ? (
              <EmptyState>
                {status === ""
                  ? "No voucher has been issued. A voucher is money a customer is holding — a gift card they paid for, credit from a return, or goodwill after something went wrong — and it is spent at the till rather than applied to a price."
                  : "No voucher in that state. The counts above cover the whole book."}
              </EmptyState>
            ) : (
              <DataTable<VoucherRow>
                table={table}
                onRowClick={(row) => sheet.open(row.code)}
                isSelected={(row) => row.code === sheet.value}
                empty="No voucher matches that search."
                className="max-h-[calc(100vh-24rem)]"
              />
            ),
        })}
      </Card>

      <VoucherSheet
        code={sheet.value ?? null}
        onClose={sheet.close}
        onChanged={() =>
          client.invalidateQueries({ queryKey: voucherKeys.all })
        }
      />

      <IssueForm
        open={issuing}
        onClose={() => setIssuing(false)}
        onIssued={(voucher) => {
          setIssued(voucher)
          setIssuing(false)
          client.invalidateQueries({ queryKey: voucherKeys.all })
        }}
      />
    </PageContent>
  )
}

/// One card, whole: what is on it, and everything that has happened to it.
///
/// The history is the point of the sheet. "How much is left" is the cheap
/// question and the list already answers it; "where did it go" is the one that
/// gets asked, and a single balance cannot answer it at all.
function VoucherSheet({
  code,
  onClose,
  onChanged,
}: {
  code: string | null
  onClose: () => void
  onChanged: () => void
}) {
  const [spending, setSpending] = useState("")
  const [stopping, setStopping] = useState(false)
  const [reason, setReason] = useState("")

  const detail = useQuery({
    queryKey: voucherKeys.detail(code ?? ""),
    queryFn: ({ signal }) => voucherDetail(code ?? "", signal),
    enabled: code !== null,
  })

  const spend = useMutation({
    mutationFn: (amount_minor: number) =>
      redeemVoucher(
        code ?? "",
        { amount_minor },
        // A fresh key per attempt: two spends of the same card an hour apart
        // are two events, not one retried. A retry of THIS attempt reuses it,
        // which is the whole point — the same money must not come off twice.
        crypto.randomUUID()
      ),
    onSuccess: () => {
      setSpending("")
      void detail.refetch()
      onChanged()
    },
  })

  const stop = useMutation({
    mutationFn: () => voidVoucher(code ?? "", { reason }, crypto.randomUUID()),
    onSuccess: () => {
      setStopping(false)
      setReason("")
      void detail.refetch()
      onChanged()
    },
  })

  const voucher = detail.data?.voucher
  const live = voucher?.status === "ACTIVE"

  return (
    <Sheet
      open={code !== null}
      onOpenChange={(next) => !next && onClose()}
      id={code ?? undefined}
      title={
        voucher === undefined
          ? "Voucher"
          : `${describeKind(voucher.kind)} · ${money(voucher.balance_minor)}`
      }
      subject={code === null ? undefined : { kind: "voucher", id: code }}
    >
      {voucher === undefined ? null : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Standing row={voucher} />
            {voucher.member_id === null ? (
              <Tag>Bearer</Tag>
            ) : (
              <Tag tone="info">
                {voucher.member_name ?? voucher.member_id}
              </Tag>
            )}
            <span className="text-[0.71875rem] text-mute">
              issued by {voucher.issued_by}
            </span>
          </div>

          <Facts>
            <Fact term="Left on it">{money(voucher.balance_minor)}</Fact>
            <Fact term="Face value">{money(voucher.issued_minor)}</Fact>
            <Fact term="Spent">{money(voucher.spent_minor)}</Fact>
            <Fact term="Currency">{voucher.currency}</Fact>
            <Fact term="Issued">{day(voucher.issued_at)}</Fact>
            <Fact term="Expires">
              {voucher.expires_at === null ? "No end" : day(voucher.expires_at)}
            </Fact>
            <Fact term="Issued at">{voucher.issued_site ?? "Not recorded"}</Fact>
            <Fact term="Movements">{count(voucher.movement_count)}</Fact>
          </Facts>

          {voucher.note && (
            <div>
              <SubHead>Why it was issued</SubHead>
              <p className="py-1.5 text-meta text-text">{voucher.note}</p>
            </div>
          )}

          {/* Spending, from here rather than only from a till. A supervisor
              settling something over the telephone is an ordinary act, and the
              alternative is somebody editing a balance in a database. */}
          {live && (
            <div>
              <SubHead>Spend against a basket</SubHead>
              <div className="flex items-center gap-2 pt-1.5">
                <Input
                  value={spending}
                  inputMode="numeric"
                  onChange={(event) => setSpending(event.target.value)}
                  placeholder={`Up to ${money(voucher.balance_minor)}`}
                  className="w-44"
                />
                <Button
                  variant="soft"
                  disabled={spend.isPending || !isAmount(spending)}
                  onClick={() => spend.mutate(Number(spending))}
                >
                  {spend.isPending ? "Spending…" : "Spend"}
                </Button>
              </div>
              <p className="mt-1.5 text-[0.71875rem] text-mute">
                Partial by design: {money(voucher.balance_minor)} on the card
                against a smaller basket leaves the difference on the card. A
                voucher never gives change — only cash can do that.
              </p>
              {spend.isError && (
                <div className="mt-2">
                  <ErrorState error={spend.error} />
                </div>
              )}
            </div>
          )}

          {live && (
            <div>
              <SubHead>Stop this card</SubHead>
              {stopping ? (
                <div className="flex flex-col gap-2 pt-1.5">
                  <Textarea
                    rows={2}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Why — lost card, issued in error, written off"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="danger"
                      disabled={stop.isPending || reason.trim() === ""}
                      onClick={() => stop.mutate()}
                    >
                      {stop.isPending
                        ? "Stopping…"
                        : `Stop and write off ${money(voucher.balance_minor)}`}
                    </Button>
                    <Button variant="quiet" onClick={() => setStopping(false)}>
                      Cancel
                    </Button>
                  </div>
                  {stop.isError && <ErrorState error={stop.error} />}
                </div>
              ) : (
                <div className="pt-1.5">
                  <Button variant="ghost" onClick={() => setStopping(true)}>
                    Stop this card
                  </Button>
                  <p className="mt-1.5 text-[0.71875rem] text-mute">
                    Takes {money(voucher.balance_minor)} away from whoever is
                    holding it, so it needs a reason. The write-off is recorded
                    as a movement rather than as a balance that changed by
                    itself.
                  </p>
                </div>
              )}
            </div>
          )}

          <div>
            <SubHead aside={count(detail.data?.movements.length ?? 0)}>
              Everything that happened
            </SubHead>
            <MiniTable
              head={[
                "When",
                "What",
                { label: "Amount", align: "right" },
                { label: "Left", align: "right" },
              ]}
            >
              {(detail.data?.movements ?? []).map((movement) => (
                <MiniRow key={movement.movement_id}>
                  <MiniCell>{moment(movement.occurred_at)}</MiniCell>
                  <MiniCell>
                    {describeMovement(movement.kind)}
                    <span className="text-mute"> · {movement.actor}</span>
                    {movement.note && (
                      <span className="text-mute"> · {movement.note}</span>
                    )}
                  </MiniCell>
                  <MiniCell align="right">
                    <span
                      className={
                        movement.amount_minor < 0 ? "text-bad-fg" : "text-ok"
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
      )}
    </Sheet>
  )
}

/// Whole rupiah, typed. Refused rather than coerced: `Number("")` is zero and
/// `Number("1,000")` is `NaN`, and both would reach the server as a request
/// that means something other than what was typed.
function isAmount(raw: string): boolean {
  const trimmed = raw.trim()
  return /^\d+$/.test(trimmed) && Number(trimmed) > 0
}

/// Put a voucher into the world.
///
/// The kind is asked first and is not a detail: it decides what the shop owes
/// because of this card. A gift card was paid for and is a liability; goodwill
/// was given away and costs the shop today. Nothing in finance posts either yet
/// — there is no voucher rule in the ledger — but the kind is knowable only
/// here, and a backfill that guessed it later would be guessing at which
/// account the money belonged in.
function IssueForm({
  open,
  onClose,
  onIssued,
}: {
  open: boolean
  onClose: () => void
  onIssued: (voucher: VoucherRow) => void
}) {
  const [kind, setKind] = useState<VoucherKind>("GIFT_CARD")
  const [value, setValue] = useState("")
  const [code, setCode] = useState("")
  const [member, setMember] = useState("")
  const [expires, setExpires] = useState("")
  const [note, setNote] = useState("")

  const issue = useMutation({
    mutationFn: () =>
      issueVoucher(
        {
          kind,
          value_minor: Number(value),
          ...(code.trim() === "" ? {} : { code: code.trim() }),
          ...(member.trim() === "" ? {} : { member_id: member.trim() }),
          ...(expires === ""
            ? {}
            : // A date input gives a day; a voucher dies at the end of it
              // rather than at the stroke of midnight that opens it.
              { expires_at: new Date(`${expires}T23:59:59`).toISOString() }),
          ...(note.trim() === "" ? {} : { note: note.trim() }),
        },
        crypto.randomUUID()
      ),
    onSuccess: (voucher) => {
      setValue("")
      setCode("")
      setMember("")
      setExpires("")
      setNote("")
      onIssued(voucher)
    },
  })

  const chosen = KINDS.find((one) => one.value === kind)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New voucher"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="dark"
            disabled={issue.isPending || !isAmount(value)}
            onClick={() => issue.mutate()}
          >
            {issue.isPending ? "Issuing…" : "Issue"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Kind" hint={chosen?.why}>
          <Select
            value={kind}
            onChange={(event) => setKind(event.target.value as VoucherKind)}
          >
            {KINDS.map((one) => (
              <option key={one.value} value={one.value}>
                {one.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Value"
          hint="In whole rupiah. Frozen once issued — what a card was worth never changes, which is what makes the balance answerable by subtraction."
        >
          <Input
            value={value}
            inputMode="numeric"
            onChange={(event) => setValue(event.target.value)}
            placeholder="200000"
          />
        </Field>

        <Field
          label="Code"
          hint="Leave blank and one is minted, without the four characters people misread off a card. Fill it in only for pre-printed stock, where the card exists before this record does."
        >
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Minted"
            className="font-mono"
          />
        </Field>

        <Field
          label="Held by"
          hint="A member's card number, when the shop knows whose it is. Blank means bearer — whoever is holding the card can spend it, which is how a gift card bought off the shelf works."
        >
          <Input
            value={member}
            onChange={(event) => setMember(event.target.value)}
            placeholder="Bearer"
          />
        </Field>

        <Field
          label="Expires"
          hint="Blank means no end. A paid gift card with an expiry is a shop keeping money for goods it never handed over, which is a decision worth making on purpose rather than by default."
        >
          <Input
            type="date"
            value={expires}
            onChange={(event) => setExpires(event.target.value)}
          />
        </Field>

        <Field label="Why" hint="Shown on the card's history.">
          <Textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Sold at the till, service recovery, return credit…"
          />
        </Field>

        {issue.isError && <ErrorState error={issue.error} />}
      </div>
    </Sheet>
  )
}
