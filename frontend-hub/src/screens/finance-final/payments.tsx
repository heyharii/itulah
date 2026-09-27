import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Panel } from "@/components/ui/dialog"
import {
  Checkbox,
  Field,
  Input,
  Money,
  Select,
  Textarea,
} from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { SubHead } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts } from "@/components/ui/sheet"
import {
  Banner,
  EmptyState,
  LoadMore,
  NoAccessState,
  NoMatch,
} from "@/components/ui/states"
import { count, day, label, money, moment, toneFor } from "@/lib/format"
import {
  financeKeys,
  listBills,
  listPayments,
  payment as readPayment,
  postPayment,
  recordPayment,
  type AllocateToBill,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { useDebounced } from "@/lib/use-debounced"
import {
  CardRow,
  Grid,
  Note,
  NumberCard,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { parseMinor, todayIso } from "@/screens/finance/chart"
import {
  moneyAccountValue,
  parseMoneyAccountValue,
  useMeaningLabel,
  useMoneyAccounts,
} from "@/screens/finance/hooks"
import {
  AccountMeaning,
  LocationSelect,
  SiteName,
  SupplierName,
} from "@/screens/finance/parts"
import { idempotencyKey } from "@itulah/contract/client"
import type { SupplierBill, SupplierPayment } from "@itulah/contract"

/// Money leaving, against the documents it settles.
///
/// ERPNext's Payment Entry, as far as this ledger has one.
///
/// # Why every row says Pay
///
/// ERPNext's `payment_type` is the most structural field on the document:
/// **Receive** takes money in against a customer's invoices, **Pay** sends it
/// out against a supplier's, **Internal Transfer** moves it between our own
/// accounts and names no party at all. This register can only ever hold the
/// second. `POST /finance/payments` is a *supplier* payment — its posting rule
/// debits a payable, once per bill, and credits the account the money left.
/// Money arriving from a customer is taken at the till and becomes a sale, and
/// never becomes a payment document; moving money between two of our own pots
/// is a manual journal entry, because the document for it does not exist yet.
///
/// The column stays anyway, because a register that quietly drops a field the
/// reference has is a register somebody will later assume covers both
/// directions. One value in every row is the finding.
///
/// # Why the Unallocated amount column is always empty
///
/// It is ERPNext's own term and a legitimate state there: a payment on account
/// is real money with nobody having yet decided which invoices it answered, and
/// it stays that way until Payment Reconciliation says otherwise. It is not an
/// error and is not drawn as one.
///
/// Here it is structurally zero, always. `record_payment` refuses a payment
/// that names no bill — *"a payment against no bill is a bank line, not a
/// payment"* — and computes the total FROM the allocations, refusing a stated
/// total that disagrees with them. So a payment's total always equals what it
/// allocated, and money on account cannot be recorded at all. That is the
/// number the next screen is built to consume, so the column is drawn and the
/// reason it reads zero is on the page rather than in somebody's head.
///
/// # Draft and submitted, and where we differ
///
/// ERPNext's rule holds: a draft has moved no money and written no ledger row.
/// Ours adds something ERPNext does not — a draft **reserves** against the
/// bills it names. The over-allocation check counts drafts as well as posted
/// payments, so two half-finished payments cannot both promise the same ten
/// million, and a bill showing room that will not take another allocation is a
/// bill a draft already has. The composer shows the room rather than the
/// outstanding for exactly that reason.

/// One page of the register. The list scrolls on — this is the size of a
/// step, not a ceiling.
const PAGE = 100

/// `RecordPaymentRequest.method` is a fixed set on the server — four since
/// 0220 dropped CHEQUE, because the client's chart has no cheque account and a
/// cek and a bilyet giro are not the same instrument.
const METHODS: readonly { value: string; label: string }[] = [
  { value: "TRANSFER", label: "Transfer" },
  { value: "CASH", label: "Cash" },
  { value: "GIRO", label: "Giro" },
  { value: "OTHER", label: "Other" },
]

/// ERPNext's **Unallocated Amount**: what was paid, less what it was pointed at.
///
/// Computed per document from figures that document carries in full — every
/// payment arrives with its allocations attached — so this is not a page summed
/// in the browser pretending to be a total.
function unallocated(payment: SupplierPayment): number {
  return payment.total_minor - allocated(payment)
}

function allocated(payment: SupplierPayment): number {
  return payment.allocations.reduce((sum, row) => sum + row.amount_minor, 0)
}

/// Who a payment answered. It has as many parties as its allocations do: one
/// bank line settling two suppliers is an ordinary Friday, so there is no party
/// on the payment itself.
function partiesOf(payment: SupplierPayment): readonly string[] {
  const seen = new Map<string, string>()
  for (const allocation of payment.allocations) {
    seen.set(
      allocation.supplier_id,
      allocation.supplier_name ?? allocation.supplier_id
    )
  }
  return [...seen.values()]
}

export function Payments() {
  const [site, setSite] = useState("")
  const [status, setStatus] = useState("")
  const [needle, setNeedle] = useState("")
  // In the URL rather than in state, so a bill's "paid by" link
  // (`?payment=`) opens the payment it names.
  const reading = useSheet("payment")
  const [composing, setComposing] = useState(false)

  // Unit, status and the search all go on the wire and the key carries all
  // three. A register narrowed in the browser is a slice of whatever pages it
  // happens to hold, which answers a different question and looks identical.
  const q = useDebounced(needle.trim(), 300)
  const payments = useInfiniteQuery({
    queryKey: [
      ...financeKeys.payments(status || null, site || null, null),
      "pages",
      q,
    ],
    queryFn: ({ pageParam, signal }) =>
      listPayments(
        {
          status: status || undefined,
          site: site || undefined,
          q: q || undefined,
          limit: PAGE,
          cursor: pageParam,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

  // In draft is its own question, asked of the server: the register pages, so
  // adding up the drafts among the loaded rows would be a figure about how far
  // somebody scrolled. One row is asked for; the sum is what is wanted.
  const drafts = useQuery({
    queryKey: [...financeKeys.payments("DRAFT", site || null, null), "sum", q],
    queryFn: ({ signal }) =>
      listPayments(
        {
          status: "DRAFT",
          site: site || undefined,
          q: q || undefined,
          limit: 1,
        },
        signal
      ),
    enabled: status !== "POSTED",
  })

  const rows = useMemo(
    () => payments.data?.pages.flatMap((page) => page.rows) ?? [],
    [payments.data]
  )
  const head = payments.data?.pages[0]
  const matched = head?.total ?? rows.length
  const paid = head?.total_minor ?? 0
  const open = rows.reduce((sum, row) => sum + unallocated(row), 0)
  const draft = status === "POSTED" ? 0 : (drafts.data?.total_minor ?? null)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Payables"
        title="Payments"
        sub="Money leaving and arriving, against the documents it settles."
        actions={
          <>
            <Input
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
              placeholder="Number, reference or supplier"
              className="h-8 w-48"
            />
            <Button variant="primary" onClick={() => setComposing(true)}>
              Record payment
            </Button>
          </>
        }
      />

      <Toolbar>
        <LocationSelect
          value={site}
          onChange={setSite}
          className="h-8 w-44"
          emptyLabel="Every unit"
          aria-label="Unit"
        />
        <span className="inline-flex w-40 shrink-0">
          <Select
            value={status}
            onChange={setStatus}
            className="h-8 w-40"
            aria-label="Status"
          >
            <option value="">Draft and posted</option>
            <option value="DRAFT">Draft</option>
            <option value="POSTED">Posted</option>
          </Select>
        </span>
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute">
          {site === "" ? "Every unit" : <SiteName id={site} />}
          {status !== "" && ` · ${label(status)}`}
          {` · ${count(matched)} ${matched === 1 ? "payment" : "payments"}`}
        </span>
      </Toolbar>

      <div className="flex flex-col gap-4">
        <CardRow columns={3}>
          <NumberCard
            label="Paid"
            value={paid}
            note={`${count(matched)} ${matched === 1 ? "payment" : "payments"} matched, draft and posted together`}
          />
          {/* ERPNext's own term, and not an error state: a payment on account
              is legitimate there and waits to be told what it settled. Drawn
              plain, therefore — no tone, no warning colour. */}
          <NumberCard
            label="Unallocated amount"
            value={open}
            note={`What was paid less what it was pointed at, over the ${count(rows.length)} loaded. Structurally zero here — see below.`}
          />
          <NumberCard
            label="In draft"
            value={draft ?? 0}
            tone={draft !== null && draft > 0 ? "warn" : undefined}
            note="Recorded, not posted: no ledger row, and no money has left."
          />
        </CardRow>

        {queryState(payments, {
          loading: "Reading the payment register…",
          refused: (
            <NoAccessState
              what="the payment register"
              reach="Reading the books takes a supervisor's sign-in; recording and posting, head office's."
            />
          ),
          render: () =>
            rows.length === 0 && q === "" ? (
              <EmptyState>
                No payment is recorded
                {site === "" ? "" : " at this unit"}
                {status === "" ? "" : ` in ${label(status).toLowerCase()}`}.
                Recording one writes it down; it is not in the books until
                somebody posts it.
              </EmptyState>
            ) : rows.length === 0 ? (
              <NoMatch what="payments" onClear={() => setNeedle("")} />
            ) : (
              <>
                <Grid>
                  <thead>
                    <tr>
                      <Th width="6.5rem">Date</Th>
                      <Th width="9rem">Payment</Th>
                      <Th width="5rem">Type</Th>
                      <Th>Party</Th>
                      <Th width="11rem">Paid from</Th>
                      <Th width="8rem">Unit</Th>
                      <Th align="right" width="9.5rem">
                        Paid amount
                      </Th>
                      <Th align="right" width="9.5rem">
                        Unallocated
                      </Th>
                      <Th width="6rem">Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.payment_id}
                        onClick={() => reading.open(row.payment_id)}
                        className="cursor-pointer hover:bg-soft"
                      >
                        <Td>{day(row.payment_date)}</Td>
                        <Td>
                          <span className="block font-mono text-[0.875rem] text-ink">
                            {row.payment_number}
                          </span>
                          <span className="block text-[0.875rem] text-mute">
                            {row.reference ?? label(row.method)}
                          </span>
                        </Td>
                        <Td>
                          {/* One value in every row, and that is the point — see
                            the head of this file. */}
                          <Pill>Pay</Pill>
                        </Td>
                        <Td>
                          <Parties payment={row} />
                        </Td>
                        <Td>
                          <AccountMeaning
                            meaning={row.account_key}
                            qualifier={row.account_qualifier}
                            code={row.account_code}
                            name={row.account_name}
                          />
                        </Td>
                        <Td>
                          <SiteName id={row.site_id} />
                        </Td>
                        <Td align="right">
                          <span className="font-medium text-ink">
                            {money(row.total_minor)}
                          </span>
                        </Td>
                        <Td align="right">
                          {unallocated(row) === 0 ? (
                            <span className="text-hairline-strong">·</span>
                          ) : (
                            money(unallocated(row))
                          )}
                        </Td>
                        <Td>
                          <Pill tone={toneFor(row.status)}>
                            {label(row.status)}
                          </Pill>
                        </Td>
                      </tr>
                    ))}
                    {/* The server's own total over everything the search and the
                      filters match — not a sum of the pages scrolled so far.
                      Unallocated is summed over what is loaded, and says so. */}
                    <TotalRow>
                      <Td />
                      <Td>Total</Td>
                      <Td />
                      <Td className="font-normal text-mute">
                        all {count(matched)} matched
                      </Td>
                      <Td />
                      <Td />
                      <Td align="right">{money(paid)}</Td>
                      <Td align="right">
                        <span title={`Over the ${count(rows.length)} loaded`}>
                          {money(open)}
                        </span>
                      </Td>
                      <Td />
                    </TotalRow>
                  </tbody>
                </Grid>
                <LoadMore query={payments} />
              </>
            ),
        })}

        <Note>
          <b>Two things this register cannot be.</b> Every row is a <b>Pay</b>:
          there is no Receive document — customer money is taken at the till and
          becomes a sale — and no Internal Transfer, so moving money between two
          of our own pots is a manual journal entry. <b>Unallocated amount</b>{" "}
          is ERPNext&rsquo;s word for money on account and is a perfectly good
          state there; here it can never be anything but zero, because{" "}
          <code>POST /finance/payments</code> refuses a payment that names no
          bill and takes the total from the allocations. The <b>Total</b> row is
          the server&rsquo;s own sum over everything the search and the filters
          match, however far the list has been scrolled.
        </Note>
      </div>

      <PaymentPanel id={reading.value ?? null} onClose={reading.close} />
      <ComposerPanel open={composing} onClose={() => setComposing(false)} />
    </PageContent>
  )
}

/// The parties one payment answered, resolved through the supplier list when
/// the allocation carries no name of its own.
///
/// A component and not a helper because the lookup is a hook, and the master
/// list is what turns a uuid into the name somebody recognises.
function Parties({ payment }: { payment: SupplierPayment }) {
  const names = partiesOf(payment)
  if (names.length === 0) {
    return <span className="text-faint">nothing allocated</span>
  }
  return (
    <span className="block truncate text-ink" title={names.join(" · ")}>
      {names.length === 1
        ? names[0]
        : `${names[0]} + ${count(names.length - 1)} more`}
    </span>
  )
}

// ---------------------------------------------------------------------------
// One payment
// ---------------------------------------------------------------------------

/// The form behind a register row: ERPNext's Payment Entry, with its references
/// grid and its two computed figures.
function PaymentPanel({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [postingDate, setPostingDate] = useState("")
  const [receipt, setReceipt] = useState<string | null>(null)

  const detail = useQuery({
    queryKey: financeKeys.payment(id ?? ""),
    queryFn: ({ signal }) => readPayment(id ?? "", signal),
    enabled: id !== null,
  })

  // Every bill, once, under the key the whole module shares — so the
  // Outstanding column costs nothing on a session that has read the bills
  // anywhere else, and cannot disagree with what that screen shows.
  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({}, signal).then((page) => page.rows),
    enabled: id !== null,
    staleTime: 60_000,
  })
  const outstanding = useMemo(() => {
    const table = new Map<string, number>()
    for (const bill of bills.data ?? []) {
      table.set(bill.invoice_id, bill.outstanding_minor)
    }
    return table
  }, [bills.data])

  const post = useMutation({
    mutationFn: () =>
      postPayment(id ?? "", postingDate === "" ? undefined : postingDate),
    onSuccess: (saved) => {
      setReceipt(saved.entry_number)
      // Posting writes a journal entry, so the register, every balance, both
      // statements and the trial balance all moved. There is no narrower
      // honest answer.
      void client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  return (
    <Panel
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) {
          setReceipt(null)
          setPostingDate("")
          onClose()
        }
      }}
      title={detail.data?.payment_number ?? "Payment"}
      sub="What left the bank, and which debts it answered."
    >
      {queryState(detail, {
        loading: "Reading the payment…",
        render: (payment) => {
          const posted = payment.status === "POSTED"
          return (
            <div className="flex flex-col gap-5">
              {receipt !== null && (
                <Banner tone="ok" onDismiss={() => setReceipt(null)}>
                  Posted as {receipt}. The bills it names are settled by that
                  much from this moment.
                </Banner>
              )}
              {post.isError && (
                <Banner tone="bad">
                  {post.error instanceof Error
                    ? post.error.message
                    : "The payment could not be posted."}
                </Banner>
              )}

              <div className="flex flex-wrap gap-1.5">
                <Pill>Pay</Pill>
                <Pill tone={toneFor(payment.status)}>
                  {label(payment.status)}
                </Pill>
                {!posted && (
                  <Pill tone="warn">Reserved against these bills</Pill>
                )}
              </div>

              <Facts>
                <Fact term="Payment date">{day(payment.payment_date)}</Fact>
                <Fact term="Unit">
                  <SiteName id={payment.site_id} />
                </Fact>
                <Fact term="Paid from">
                  <AccountMeaning
                    meaning={payment.account_key}
                    qualifier={payment.account_qualifier}
                    code={payment.account_code}
                    name={payment.account_name}
                  />
                </Fact>
                <Fact term="Paid to">
                  {/* ERPNext names one account here. Ours is chosen per
                      allocation by the posting rule — a merchandise bill's
                      payable is not an expense bill's — so the honest answer is
                      the rule, and the References grid below shows which of the
                      two each line will debit. */}
                  <span className="text-[0.875rem]">
                    the payable each bill sits in
                  </span>
                </Fact>
                <Fact term="Method">{label(payment.method)}</Fact>
                <Fact term="Reference">{payment.reference ?? "—"}</Fact>
                <Fact term="Recorded by">{payment.recorded_by}</Fact>
                <Fact term="Recorded at">{moment(payment.recorded_at)}</Fact>
                {payment.posted_by !== null && (
                  <Fact term="Posted by">{payment.posted_by}</Fact>
                )}
                {payment.posted_at !== null && (
                  <Fact term="Posted at">{moment(payment.posted_at)}</Fact>
                )}
                {payment.entry_number !== null && (
                  <Fact term="Journal entry">
                    <span className="font-mono text-[0.875rem]">
                      {payment.entry_number}
                    </span>
                  </Fact>
                )}
              </Facts>

              {payment.note !== null && (
                <p className="text-[0.875rem] text-body">{payment.note}</p>
              )}

              <div>
                <SubHead
                  aside={`${count(payment.allocations.length)} ${
                    payment.allocations.length === 1 ? "bill" : "bills"
                  }`}
                >
                  References
                </SubHead>
                <Grid>
                  <thead>
                    <tr>
                      <Th width="7.5rem">Type</Th>
                      <Th>Name</Th>
                      <Th width="6.5rem">Due date</Th>
                      <Th align="right" width="9rem">
                        Total amount
                      </Th>
                      <Th align="right" width="9rem">
                        Outstanding
                      </Th>
                      <Th align="right" width="9rem">
                        Allocated
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {payment.allocations.map((allocation) => (
                      <tr key={allocation.invoice_id}>
                        <Td>{label(allocation.kind)} bill</Td>
                        <Td>
                          <span className="block font-mono text-[0.875rem] text-ink">
                            {allocation.invoice_number}
                          </span>
                          <SupplierName
                            id={allocation.supplier_id}
                            name={allocation.supplier_name}
                            className="block truncate text-[0.875rem] text-mute"
                          />
                        </Td>
                        <Td>{day(allocation.due_date)}</Td>
                        <Td align="right">
                          {money(allocation.invoice_total_minor)}
                        </Td>
                        <Td align="right">
                          {/* A missing figure is not zero: a bill the list has
                              not reached is `—`, not a settled bill. */}
                          {outstanding.has(allocation.invoice_id)
                            ? money(outstanding.get(allocation.invoice_id))
                            : "—"}
                        </Td>
                        <Td align="right">
                          <span className="font-medium text-ink">
                            {money(allocation.amount_minor)}
                          </span>
                        </Td>
                      </tr>
                    ))}
                    <TotalRow>
                      <Td>Total allocated</Td>
                      <Td />
                      <Td />
                      <Td />
                      <Td />
                      <Td align="right">{money(allocated(payment))}</Td>
                    </TotalRow>
                    <tr>
                      <Td className="text-mute">Unallocated amount</Td>
                      <Td />
                      <Td />
                      <Td />
                      <Td />
                      <Td align="right">{money(unallocated(payment))}</Td>
                    </tr>
                    <tr>
                      <Td className="text-mute">Paid amount</Td>
                      <Td />
                      <Td />
                      <Td />
                      <Td />
                      <Td align="right">{money(payment.total_minor)}</Td>
                    </tr>
                  </tbody>
                </Grid>
              </div>

              {posted ? (
                <Note>
                  <b>This payment is evidence now.</b> The journal entry quotes
                  these amounts, so the database refuses to change either the
                  payment or the bills it named —{" "}
                  <i>
                    &ldquo;payment {payment.payment_number} is posted; the bills
                    it settled cannot be changed afterwards&rdquo;
                  </i>
                  . Correcting an allocation means reversing its journal entry
                  and recording the payment again; there is no re-pointing of a
                  settled payment, which is what ERPNext&rsquo;s Payment
                  Reconciliation does and what that screen has no door for.
                </Note>
              ) : (
                <div className="flex flex-wrap items-end justify-between gap-3 border-t border-hairline pt-4">
                  <Field
                    label="Posting date"
                    hint="Empty posts it on the payment date."
                    className="w-44"
                  >
                    <Day
                      value={postingDate}
                      onChange={setPostingDate}
                      placeholder={day(payment.payment_date)}
                    />
                  </Field>
                  <div className="flex items-center gap-2">
                    <span className="text-[0.875rem] text-mute">
                      Money that left on the 31st and was keyed on the 2nd
                      belongs to the month it left.
                    </span>
                    <Button
                      variant="primary"
                      pending={post.isPending}
                      onClick={() => post.mutate()}
                    >
                      {post.isPending ? "Posting…" : "Post to the books"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )
        },
      })}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Recording one
// ---------------------------------------------------------------------------

/// One reference being typed. The amount is text until it is submitted — a
/// half-typed number is not a number.
interface DraftReference {
  invoice_id: string
  amount: string
}

/// The room left on a bill: its total less everything already spoken for.
///
/// Not `outstanding_minor`, which counts posted payments only — a bill with a
/// draft against it would look payable and be refused on submit. The database's
/// own constraint measures exactly this.
function roomOn(bill: SupplierBill): number {
  return bill.total_minor - bill.allocated_minor
}

/// Recording a payment — ERPNext's new Payment Entry, with its Get Outstanding
/// Invoices action.
///
/// # Why the paid amount is typed before the references are chosen
///
/// Because that is the order the money happened in, and it is ERPNext's order
/// too: a transfer left the bank for an amount, and deciding what it answered
/// comes after. It also lets **Get outstanding invoices** do what ERPNext's
/// button does — run down the oldest bills allocating the smaller of what is
/// left of the payment and what is left of the bill, which is the same FIFO
/// waterfall its Payment Reconciliation uses.
///
/// # Where ERPNext's model and ours part company
///
/// There, a payment may be recorded with an unallocated remainder and sit on
/// account. Here it may not: the server takes the total from the allocations
/// and refuses a stated total that disagrees. So the footer shows ERPNext's
/// Unallocated amount live, and refuses to record while it is anything but
/// zero — which is the server's rule, met where somebody can still fix it.
function ComposerPanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const [site, setSite] = useState("")
  const [paymentDate, setPaymentDate] = useState(todayIso)
  // Giro by default: suppliers are paid by bilyet giro unless Finance says
  // otherwise, and Finance chooses the instrument here, at payment — not on
  // the supplier or the PO (owner, 2026-09-26).
  const [method, setMethod] = useState("GIRO")
  const [account, setAccount] = useState("")
  const [total, setTotal] = useState("")
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  /// Only when `method` is GIRO, and then both are required — the server
  /// refuses a giro with no number or no due date. Kept out of `reference`
  /// deliberately: `reference` is free text, a giro number is a key.
  const [giroNumber, setGiroNumber] = useState("")
  const [giroDueDate, setGiroDueDate] = useState("")
  const [references, setReferences] = useState<DraftReference[]>([])
  const [receipt, setReceipt] = useState<string | null>(null)
  // Minted once per composer and not per attempt: a retry after a dropped
  // connection must land the same payment, and this write reserves money
  // against bills.
  const [key, setKey] = useState(idempotencyKey)

  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({}, signal).then((page) => page.rows),
    enabled: open,
    staleTime: 60_000,
  })

  /// What can be paid from here, oldest first.
  ///
  /// Posted bills with something still outstanding, at this unit and no other:
  /// the database refuses a payment that crosses units — *"pay a location's
  /// bills from that location"* — because the entry debits the payable at the
  /// payment's unit, and settling a shop's bill out of head office would clear
  /// a payable the shop still carries.
  const candidates = useMemo(
    () =>
      (bills.data ?? [])
        .filter(
          (bill) =>
            bill.status === "POSTED" &&
            bill.outstanding_minor > 0 &&
            (site === "" || bill.site_id === site)
        )
        .sort((a, b) => b.days_overdue - a.days_overdue),
    [bills.data, site]
  )

  const paidMinor = total.trim() === "" ? null : parseMinor(total)
  const chosen = new Map(references.map((row) => [row.invoice_id, row.amount]))
  const priced = references.map((row) => ({
    invoice_id: row.invoice_id,
    amount: row.amount.trim() === "" ? null : parseMinor(row.amount),
  }))
  const allocatedMinor = priced.reduce((sum, row) => sum + (row.amount ?? 0), 0)
  const misread = priced.some((row) => row.amount === null || row.amount <= 0)
  const room = new Map(
    (bills.data ?? []).map((bill) => [bill.invoice_id, roomOn(bill)])
  )
  const over = priced.filter(
    (row) => row.amount !== null && row.amount > (room.get(row.invoice_id) ?? 0)
  )
  const unallocatedMinor = (paidMinor ?? 0) - allocatedMinor
  const ready =
    site !== "" &&
    paymentDate !== "" &&
    account !== "" &&
    references.length > 0 &&
    !misread &&
    over.length === 0 &&
    paidMinor !== null &&
    paidMinor > 0 &&
    unallocatedMinor === 0 &&
    (method !== "GIRO" ||
      (giroNumber.trim() !== "" &&
        giroDueDate !== "" &&
        giroDueDate >= paymentDate))

  const record = useMutation({
    mutationFn: () => {
      const parsed = parseMoneyAccountValue(account)
      return recordPayment(
        {
          site_id: site,
          payment_date: paymentDate,
          method,
          account_key: parsed.account_key,
          account_qualifier: parsed.account_qualifier,
          // Sent although the server could add the allocations up itself. The
          // contract calls it deliberately redundant: a client that believes it
          // is paying fifty million and has built allocations totalling five
          // should hear about it here, not on a bank statement.
          total_minor: paidMinor,
          reference: reference.trim() === "" ? null : reference.trim(),
          note: note.trim() === "" ? null : note.trim(),
          allocations: priced.map((row): AllocateToBill => ({
            invoice_id: row.invoice_id,
            amount_minor: row.amount ?? 0,
          })),
          // Sent only on GIRO and refused by the server on anything else, so
          // a method changed after typing must not smuggle the old paper in.
          giro_number:
            method === "GIRO" && giroNumber.trim() !== ""
              ? giroNumber.trim()
              : null,
          giro_due_date:
            method === "GIRO" && giroDueDate !== "" ? giroDueDate : null,
        },
        key
      )
    },
    onSuccess: (saved) => {
      setReceipt(saved.payment_number)
      // Only what differs from payment to payment is cleared: the unit, the
      // account and the method are almost always the next one's too.
      setReferences([])
      setTotal("")
      setReference("")
      setNote("")
      setGiroNumber("")
      setGiroDueDate("")
      setKey(idempotencyKey())
      // Recording writes no journal entry, so no balance moved — but a draft
      // reserves against the bills it names, which is what `allocated_minor`
      // reports and what the candidate list is built from.
      void client.invalidateQueries({ queryKey: ["finance", "payments"] })
      void client.invalidateQueries({ queryKey: financeKeys.bills(null) })
    },
  })

  /// ERPNext's **Get Outstanding Invoices**, and its allocation with it.
  ///
  /// A nested waterfall over the candidates in the order they are drawn —
  /// oldest first — taking the smaller of what is left of the payment and what
  /// is left of the bill, and stopping when the money runs out. There is no
  /// matching heuristic here and there is none in ERPNext either: its Payment
  /// Reconciliation allocates by exactly this loop, with no amount matching and
  /// no reference matching at all.
  const fill = () => {
    let left = paidMinor ?? 0
    const next: DraftReference[] = []
    for (const bill of candidates) {
      if (left <= 0) break
      const take = Math.min(left, roomOn(bill))
      if (take <= 0) continue
      next.push({ invoice_id: bill.invoice_id, amount: String(take) })
      left -= take
    }
    setReferences(next)
  }

  const toggle = (bill: SupplierBill, on: boolean) => {
    if (!on) {
      setReferences((was) =>
        was.filter((row) => row.invoice_id !== bill.invoice_id)
      )
      return
    }
    // Defaulted to the room and not to the outstanding figure: the two differ
    // only when a draft is already holding part of the bill, and defaulting to
    // a number the database will refuse is worse than one somebody can raise.
    setReferences((was) => [
      ...was,
      { invoice_id: bill.invoice_id, amount: String(roomOn(bill)) },
    ])
  }

  return (
    <Panel
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReceipt(null)
          onClose()
        }
      }}
      title="Record a payment"
      sub="It is written down here, and not in the books until somebody posts it."
    >
      <div className="flex flex-col gap-4">
        {receipt !== null && (
          <Banner tone="ok" onDismiss={() => setReceipt(null)}>
            {receipt} recorded. It is not in the books yet, and until it is
            posted it is reserved against the bills it names.
          </Banner>
        )}
        {record.isError && (
          <Banner tone="bad">
            {record.error instanceof Error
              ? record.error.message
              : "The payment was refused."}
          </Banner>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Unit" required hint="A unit pays its own bills.">
            <LocationSelect
              value={site}
              onChange={(next) => {
                setSite(next)
                // The accounts belong to a unit, and so do the bills. Keeping
                // either would send a mapping that does not exist there.
                setAccount("")
                setReferences([])
              }}
              emptyLabel="Choose a unit"
            />
          </Field>
          <Field label="Payment date" required hint="The day the money left.">
            <Day value={paymentDate} onChange={setPaymentDate} />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={setMethod}>
              {METHODS.map((row) => (
                <option key={row.value} value={row.value}>
                  {row.label}
                </option>
              ))}
            </Select>
          </Field>
          <AccountField site={site} value={account} onChange={setAccount} />
          {/* The paper, and only when there is paper. A giro is a promise
              before it is money, and the number is how the bank finds it
              again — which is why the server requires both. */}
          {method === "GIRO" && (
            <>
              <Field
                label="Giro number"
                required
                hint="Printed on the slip. Required for a giro."
              >
                <Input
                  value={giroNumber}
                  onChange={(event) => setGiroNumber(event.target.value)}
                />
              </Field>
              <Field
                label="Giro due date"
                required
                hint="The date on its face — not before the payment date."
                problem={
                  giroDueDate !== "" && giroDueDate < paymentDate
                    ? "A giro falls due on or after the day it is written."
                    : undefined
                }
              >
                <Day
                  value={giroDueDate}
                  onChange={setGiroDueDate}
                  placeholder="Choose a day"
                  notBefore={paymentDate}
                />
              </Field>
            </>
          )}
          <Field
            label="Paid amount"
            required
            hint="What actually left the bank."
            problem={
              total.trim() !== "" && paidMinor === null
                ? "Not a number."
                : undefined
            }
          >
            <Money value={total} onChange={setTotal} placeholder="0" />
          </Field>
          <Field label="Reference" hint="The bank's, if there is one.">
            <Input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </Field>
        </div>

        <div>
          <SubHead
            aside={
              <Button
                size="sm"
                variant="soft"
                disabled={paidMinor === null || candidates.length === 0}
                onClick={fill}
              >
                Get outstanding invoices
              </Button>
            }
          >
            References
          </SubHead>

          {bills.isPending ? (
            <p className="text-[0.875rem] text-mute">Reading the bills…</p>
          ) : site === "" ? (
            <p className="text-[0.875rem] text-mute">
              Choose a unit first — a payment answers that unit&rsquo;s debts,
              and the database refuses one that crosses units.
            </p>
          ) : candidates.length === 0 ? (
            <p className="text-[0.875rem] text-mute">
              Nothing posted at this unit is still outstanding. A bill that has
              only been recorded is not in the books yet and cannot be paid.
            </p>
          ) : (
            <Grid>
              <thead>
                <tr>
                  <Th width="2.5rem" />
                  <Th>Name</Th>
                  <Th width="6.5rem">Due date</Th>
                  <Th align="right" width="8.5rem">
                    Outstanding
                  </Th>
                  <Th align="right" width="8.5rem">
                    Room left
                  </Th>
                  <Th align="right" width="9.5rem">
                    Allocated
                  </Th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((bill) => {
                  const amount = chosen.get(bill.invoice_id)
                  const on = amount !== undefined
                  const typed = amount === undefined ? null : parseMinor(amount)
                  const free = roomOn(bill)
                  return (
                    <tr key={bill.invoice_id}>
                      <Td>
                        <Checkbox
                          checked={on}
                          disabled={free <= 0}
                          onChange={(next) => toggle(bill, next)}
                          label={
                            <span className="sr-only">
                              Allocate against {bill.invoice_number}
                            </span>
                          }
                        />
                      </Td>
                      <Td>
                        <span className="block font-mono text-[0.875rem] text-ink">
                          {bill.invoice_number}
                        </span>
                        <SupplierName
                          id={bill.supplier_id}
                          name={bill.supplier_name}
                          className="block truncate text-[0.875rem] text-mute"
                        />
                      </Td>
                      <Td>
                        {day(bill.next_due_date ?? bill.due_date)}
                        {bill.overdue && (
                          <span className="block text-[0.875rem] text-bad-fg">
                            {count(bill.days_overdue)} days late
                          </span>
                        )}
                      </Td>
                      <Td align="right">{money(bill.outstanding_minor)}</Td>
                      <Td align="right">
                        {free === bill.outstanding_minor ? (
                          <span className="text-hairline-strong">·</span>
                        ) : (
                          <span
                            className="text-warn-fg"
                            title="A draft payment already has part of this bill."
                          >
                            {money(free)}
                          </span>
                        )}
                      </Td>
                      <Td align="right">
                        {on ? (
                          <Money
                            label={`Allocated against ${bill.invoice_number}`}
                            value={amount}
                            onChange={(next) =>
                              setReferences((was) =>
                                was.map((row) =>
                                  row.invoice_id === bill.invoice_id
                                    ? { ...row, amount: next }
                                    : row
                                )
                              )
                            }
                            className="h-8"
                          />
                        ) : (
                          <span className="text-hairline-strong">·</span>
                        )}
                        {on && typed !== null && typed > free && (
                          <span className="mt-0.5 block text-[0.875rem] text-bad-fg">
                            more than the {money(free)} left on this bill
                          </span>
                        )}
                      </Td>
                    </tr>
                  )
                })}
                <TotalRow>
                  <Td />
                  <Td>Total allocated</Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td align="right">{money(allocatedMinor)}</Td>
                </TotalRow>
                <tr>
                  <Td />
                  <Td className="text-mute">Unallocated amount</Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td align="right">
                    <span
                      className={
                        unallocatedMinor === 0 ? undefined : "text-warn-fg"
                      }
                    >
                      {paidMinor === null ? "—" : money(unallocatedMinor)}
                    </span>
                  </Td>
                </tr>
              </tbody>
            </Grid>
          )}
        </div>

        <Field label="Note" hint="Why it was split this way, if it was.">
          <Textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>

        <div className="flex items-center justify-between gap-3 border-t border-hairline pt-3">
          <span className="text-[0.875rem] text-mute tabular-nums">
            {/* A disabled button with nothing beside it reads as broken, so
                what is still wrong is always one sentence — and the last two
                arms name the field rather than saying "not ready", which is
                what somebody who has filled in the grid and cannot press
                Record actually needs to read. */}
            {ready
              ? `Allocated in full at ${money(allocatedMinor)}`
              : site === ""
                ? "No unit chosen yet"
                : references.length === 0
                  ? "No bill chosen yet"
                  : over.length > 0
                    ? "One bill is allocated more than it has left"
                    : paidMinor === null
                      ? "The paid amount is not a number"
                      : unallocatedMinor !== 0
                        ? `${money(unallocatedMinor)} unallocated — this ledger keeps no money on account`
                        : account === ""
                          ? "Say which account the money left by"
                          : method === "GIRO" && giroNumber.trim() === ""
                            ? "A giro needs the number printed on it"
                            : method === "GIRO" && giroDueDate === ""
                              ? "A giro needs the date on its face"
                              : method === "GIRO" && giroDueDate < paymentDate
                                ? "The giro falls due before the payment date"
                                : "The payment date is missing"}
          </span>
          <Button
            variant="primary"
            pending={record.isPending}
            disabled={!ready}
            onClick={() => record.mutate()}
          >
            {record.isPending ? "Recording…" : "Record"}
          </Button>
        </div>
      </div>
    </Panel>
  )
}

/// Which accounts money can leave a unit by.
///
/// Its own component so the hook behind it takes a unit rather than being
/// called conditionally, and so the options are the mappings that actually
/// exist there: offering the whole chart would let somebody pay out of an
/// account the posting rules do not know, and offering every meaning would let
/// them pick one nobody has mapped, whose posting is refused outright.
function AccountField({
  site,
  value,
  onChange,
}: {
  site: string
  value: string
  onChange: (value: string) => void
}) {
  const accounts = useMoneyAccounts(site)
  const meaning = useMeaningLabel()

  return (
    <Field
      label="Paid from"
      required
      hint={
        site === ""
          ? "Choose a unit first."
          : accounts.length === 0
            ? "No cash or bank meaning is mapped at this unit. Map one first — a posting that needs it is refused."
            : undefined
      }
    >
      <Select
        value={value}
        disabled={accounts.length === 0}
        onChange={onChange}
      >
        <option value="">Choose an account</option>
        {accounts.map((row) => (
          <option key={moneyAccountValue(row)} value={moneyAccountValue(row)}>
            {meaning(row.account_key)}
            {row.account_qualifier === "" ? "" : ` · ${row.account_qualifier}`}
            {` — ${row.account_name}`}
          </option>
        ))}
      </Select>
    </Field>
  )
}
