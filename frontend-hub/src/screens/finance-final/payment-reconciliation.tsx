import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Checkbox, Field, Input, Money, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { SubHead } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, NoAccessState } from "@/components/ui/states"
import { count, day, label, money } from "@/lib/format"
import {
  financeKeys,
  listBills,
  listPayments,
  payablesAging,
} from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import { queryState } from "@/lib/query-state"
import {
  CardRow,
  Grid,
  Note,
  NumberCard,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { parseMinor } from "@/screens/finance/chart"
import {
  SiteName,
  SupplierName,
  SupplierPicker,
  UnitName,
  UnitSelect,
} from "@/screens/finance/parts"
import type { SupplierBill, SupplierPayment } from "@itulah/contract"

/// ERPNext's Payment Reconciliation: money on one side, debts on the other, and
/// an allocation somebody makes between them.
///
/// # It is a tool, not a document
///
/// ERPNext's is a **virtual doctype** — `load_from_db`, `db_insert`, `db_update`
/// and `delete` are all overridden to do nothing, and not a row is persisted
/// until Reconcile is pressed. There is no draft, no submit and no voucher
/// number, because reallocating existing money creates no bank movement: it
/// re-points which debt a payment answered. This screen keeps that shape. What
/// is ticked and allocated below lives for as long as the page does.
///
/// # How the two sides are found
///
/// ERPNext does not ask what kind of document a row is. It reads its Payment
/// Ledger and splits on the **sign** of the open balance: outstanding above
/// zero is an invoice, below zero is a payment. That is the whole definition.
/// We have no signed open-item ledger on this node, so the sides here are the
/// two reads that exist — `GET /finance/payments`, which carries each payment's
/// allocations and therefore what is unallocated on it, and `GET /finance/bills`
/// plus `GET /finance/payables-aging` for what is still open. The note at the
/// foot of the screen says what that costs and what would close the gap.
///
/// # How Allocate behaves
///
/// Exactly as ERPNext's does, because its behaviour is worth copying and its
/// restraint is the interesting part: a nested-loop FIFO waterfall, payments
/// outer and invoices inner, both oldest first, taking the smaller of what is
/// left of the payment and what is left of the invoice, dropping any pair that
/// comes to nothing. There is **no matching heuristic at all** — no amount
/// matching, no reference matching, nothing like the scored candidates our own
/// bank reconciliation offers. Their tool is a waterfall and a pair of grids,
/// and the person decides.
///
/// One rule is ours rather than theirs: a payment and an invoice at different
/// units cannot be paired. The database refuses it — *"pay a location's bills
/// from that location"* — because the posting debits the payable at the
/// payment's unit, and settling a shop's bill out of head office would clear a
/// payable the shop still carries.

/// What the two panels read. The server's ceiling; the display limits below are
/// ERPNext's own and are applied to what is listed.
const CAP = 200

/// ERPNext's `invoice_limit` and `payment_limit`, both defaulting to 50. Worth
/// copying: an unbounded two-panel tool is how this screen gets slow, and
/// nobody reconciles a thousand invoices by eye.
const LIMITS: readonly number[] = [25, 50, 100]

/// What has been paid and not yet pointed at anything — ERPNext's **Unallocated
/// amount**, which is a legitimate state there and not an error.
function unallocated(payment: SupplierPayment): number {
  return (
    payment.total_minor -
    payment.allocations.reduce((sum, row) => sum + row.amount_minor, 0)
  )
}

/// One proposed pairing. Amounts are text while they are being edited — a
/// half-typed number is not a number.
interface Pairing {
  payment_id: string
  invoice_id: string
  amount: string
}

export function PaymentReconciliation() {
  const [unit, setUnit] = useState("")
  const [party, setParty] = useState("")
  const [invoiceNeedle, setInvoiceNeedle] = useState("")
  const [paymentNeedle, setPaymentNeedle] = useState("")
  const [minOutstanding, setMinOutstanding] = useState("")
  const [maxOutstanding, setMaxOutstanding] = useState("")
  const [invoiceLimit, setInvoiceLimit] = useState(50)
  const [paymentLimit, setPaymentLimit] = useState(50)
  const [tickedPayments, setTickedPayments] = useState<readonly string[]>([])
  const [tickedInvoices, setTickedInvoices] = useState<readonly string[]>([])
  const [pairings, setPairings] = useState<readonly Pairing[]>([])

  // The unit goes on the wire here, where the key has a slot for it.
  const payments = useQuery({
    queryKey: financeKeys.payments(null, unit || null, null),
    queryFn: ({ signal }) =>
      listPayments({ unit: unit || undefined, limit: CAP }, signal).then(
        (page) => page.rows
      ),
  })

  // Every bill, once, under the key the whole module shares — the same entry
  // the bill register, the payment composer and `useSupplierName` all read, so
  // this screen costs nothing on a session that has been anywhere else in
  // Finance and cannot show a different outstanding from theirs.
  //
  // The unit and the party are narrowed below rather than on the wire. Both are
  // server filters on the endpoint; neither is a parameter of `listBills`, and
  // `financeKeys.bills` has one slot, for status. Filing two different parties
  // under one cache entry is the bug that would follow from sending them
  // anyway, so the narrowing stays here and the note says so.
  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({}, signal).then((page) => page.rows),
    staleTime: 60_000,
  })

  // A bill stays at the site it was received at; whose debt it is — for the
  // unit filter and for pairing — is the unit that owns that site.
  const register = useUnits()
  const owner = useMemo(() => {
    const table = new Map<string, string>()
    for (const one of register.data ?? []) {
      for (const premises of one.sites) table.set(premises.id, one.id)
    }
    return table
  }, [register.data])
  const unitOf = (bill: SupplierBill) => owner.get(bill.site_id) ?? ""
  // The invoice side waits for the register as well as the bills: without it
  // no bill knows its unit.
  const debts = {
    isPending: bills.isPending || register.isPending,
    isError: bills.isError || register.isError,
    error: bills.error ?? register.error,
    data: bills.data,
    refetch: () => {
      void bills.refetch()
      void register.refetch()
    },
  }

  // The server's own ageing, as at today, narrowed by unit ON THE WIRE. It is
  // the honest figure for "what is open" — it winds payments back and ages what
  // is outstanding rather than what was invoiced — and it is deliberately shown
  // beside a list narrowed in the browser, so the two can be compared.
  const aging = useQuery({
    queryKey: financeKeys.payablesAging(null, unit || null),
    queryFn: ({ signal }) => payablesAging({ unit: unit || undefined }, signal),
  })

  /// The money side. Posted only: a draft has moved nothing, and ERPNext's tool
  /// works on submitted documents for the same reason.
  const openPayments = useMemo(() => {
    const text = paymentNeedle.trim().toLowerCase()
    return (payments.data ?? [])
      .filter((row) => row.status === "POSTED" && unallocated(row) > 0)
      .filter(
        (row) =>
          text === "" ||
          row.payment_number.toLowerCase().includes(text) ||
          (row.reference ?? "").toLowerCase().includes(text)
      )
      .sort((a, b) => a.payment_date.localeCompare(b.payment_date))
  }, [payments.data, paymentNeedle])

  const drafts = (payments.data ?? []).filter((row) => row.status === "DRAFT")

  /// The debts side. Posted bills with something still outstanding, oldest
  /// first — which is the order ERPNext's waterfall then runs down.
  const openInvoices = useMemo(() => {
    const text = invoiceNeedle.trim().toLowerCase()
    const floor =
      minOutstanding.trim() === "" ? null : parseMinor(minOutstanding)
    const ceiling =
      maxOutstanding.trim() === "" ? null : parseMinor(maxOutstanding)
    return (bills.data ?? [])
      .filter(
        (bill) =>
          bill.status === "POSTED" &&
          bill.outstanding_minor > 0 &&
          (unit === "" || owner.get(bill.site_id) === unit) &&
          (party === "" || bill.supplier_id === party) &&
          (text === "" ||
            bill.invoice_number.toLowerCase().includes(text) ||
            (bill.supplier_name ?? "").toLowerCase().includes(text)) &&
          (floor === null || bill.outstanding_minor >= floor) &&
          (ceiling === null || bill.outstanding_minor <= ceiling)
      )
      .sort((a, b) => b.days_overdue - a.days_overdue)
  }, [
    bills.data,
    owner,
    unit,
    party,
    invoiceNeedle,
    minOutstanding,
    maxOutstanding,
  ])

  const listedPayments = openPayments.slice(0, paymentLimit)
  const listedInvoices = openInvoices.slice(0, invoiceLimit)

  const paymentById = new Map(
    (payments.data ?? []).map((row) => [row.payment_id, row])
  )
  const billById = new Map(
    (bills.data ?? []).map((row) => [row.invoice_id, row])
  )

  /// Which units the ticked payments are at. An invoice at any other unit
  /// cannot be paired with them, so its box is drawn dead with the reason
  /// rather than hidden.
  const tickedUnits = new Set(
    tickedPayments.map((id) => paymentById.get(id)?.unit_id ?? "")
  )

  /// What a pairing has already claimed, so a second pairing on the same
  /// document is measured against what is left rather than against the whole.
  const claimedOnPayment = (paymentId: string, except?: Pairing) =>
    pairings
      .filter((row) => row.payment_id === paymentId && row !== except)
      .reduce((sum, row) => sum + (parseMinor(row.amount) ?? 0), 0)
  const claimedOnInvoice = (invoiceId: string, except?: Pairing) =>
    pairings
      .filter((row) => row.invoice_id === invoiceId && row !== except)
      .reduce((sum, row) => sum + (parseMinor(row.amount) ?? 0), 0)

  /// ERPNext's `allocate_entries`, line for line.
  ///
  /// Payments outer, invoices inner, both in the order the grids are drawn.
  /// Where the payment can cover the invoice it takes the whole outstanding and
  /// moves on; where it cannot it gives what is left and stops. Pairs worth
  /// nothing are dropped. The one addition is the unit test — not ERPNext's,
  /// but the database's.
  const allocate = () => {
    const chosenPayments = listedPayments.filter((row) =>
      tickedPayments.includes(row.payment_id)
    )
    const chosenInvoices = listedInvoices.filter((row) =>
      tickedInvoices.includes(row.invoice_id)
    )
    const left = new Map(
      chosenInvoices.map((bill) => [bill.invoice_id, bill.outstanding_minor])
    )
    const next: Pairing[] = []
    for (const payment of chosenPayments) {
      let purse = unallocated(payment)
      for (const bill of chosenInvoices) {
        if (purse <= 0) break
        if (unitOf(bill) !== payment.unit_id) continue
        const owing = left.get(bill.invoice_id) ?? 0
        if (owing <= 0) continue
        const take = Math.min(purse, owing)
        next.push({
          payment_id: payment.payment_id,
          invoice_id: bill.invoice_id,
          amount: String(take),
        })
        purse -= take
        left.set(bill.invoice_id, owing - take)
      }
    }
    setPairings(next)
  }

  const allocatedTotal = pairings.reduce(
    (sum, row) => sum + (parseMinor(row.amount) ?? 0),
    0
  )
  const openTotal = openPayments.reduce((sum, row) => sum + unallocated(row), 0)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance final · Accounting"
        title="Payment Reconciliation"
        sub="Unallocated payments on one side, open invoices on the other."
        actions={
          <>
            <Button
              variant="ghost"
              disabled={pairings.length === 0}
              onClick={() => setPairings([])}
            >
              Clear allocations
            </Button>
            <Button
              variant="primary"
              disabled={
                tickedPayments.length === 0 || tickedInvoices.length === 0
              }
              onClick={allocate}
            >
              Allocate
            </Button>
          </>
        }
      />

      <Toolbar>
        {/* ERPNext makes Party Type and Party mandatory on this tool, because
            its open items carry the party on the ledger row. Ours has one party
            type and no other: `POST /finance/payments` is a supplier payment. */}
        <Pill>Party type · Supplier</Pill>
        <span className="inline-flex w-64 shrink-0">
          <SupplierPicker
            value={party}
            onPick={(supplier) => setParty(supplier?.supplier_id ?? "")}
            label="Party"
          />
        </span>
        <UnitSelect
          value={unit}
          onChange={(next) => {
            setUnit(next)
            // A pairing crosses no unit, so a change of unit invalidates every
            // one that is open.
            setTickedPayments([])
            setTickedInvoices([])
            setPairings([])
          }}
          className="h-8 w-44"
          aria-label="Unit"
        />
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute">
          {unit === "" ? "All units" : <UnitName id={unit} />}
          {` · ${count(openInvoices.length)} open ${
            openInvoices.length === 1 ? "invoice" : "invoices"
          } · ${count(openPayments.length)} unallocated ${
            openPayments.length === 1 ? "payment" : "payments"
          }`}
        </span>
      </Toolbar>

      <div className="flex flex-col gap-4">
        <CardRow columns={3}>
          <NumberCard
            label="Outstanding"
            value={aging.data?.total.total_minor ?? null}
            note={
              aging.data === undefined
                ? "Reading the server's ageing…"
                : `${count(aging.data.suppliers.length)} suppliers, as at ${day(aging.data.as_of)} — the server's own ageing, narrowed by unit on the wire`
            }
          />
          {/* Not a fault and not drawn as one. A payment on account is money
              whose purpose nobody has decided yet, which is a normal state in
              ERPNext and the state this whole screen exists to resolve. */}
          <NumberCard
            label="Unallocated amount"
            value={openTotal}
            note="Posted payments with money not yet pointed at a bill."
          />
          <NumberCard
            label="Allocated here"
            value={allocatedTotal}
            note={`${count(pairings.length)} ${pairings.length === 1 ? "pairing" : "pairings"} — nothing is committed; see the note below`}
          />
        </CardRow>

        {/* ERPNext's own filter block, which sits between the party and the two
            grids: a substring on each side, an amount range, and the two
            limits. Everything here narrows what is listed. */}
        <div className="grid gap-3 rounded-card border border-hairline p-3 sm:grid-cols-3 lg:grid-cols-5">
          <Field label="Filter on invoice">
            <Input
              value={invoiceNeedle}
              onChange={(event) => setInvoiceNeedle(event.target.value)}
            />
          </Field>
          <Field label="Minimum outstanding">
            <Money value={minOutstanding} onChange={setMinOutstanding} />
          </Field>
          <Field label="Maximum outstanding">
            <Money value={maxOutstanding} onChange={setMaxOutstanding} />
          </Field>
          <Field label="Invoice limit" hint="ERPNext's default is 50.">
            <Select
              value={String(invoiceLimit)}
              onChange={(next) => setInvoiceLimit(Number(next))}
            >
              {LIMITS.map((limit) => (
                <option key={limit} value={String(limit)}>
                  {limit}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Filter on payment">
            <Input
              value={paymentNeedle}
              onChange={(event) => setPaymentNeedle(event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {/* ---------------------------------------------------------------
              The money side */}
          <div>
            <SubHead
              aside={
                <span className="inline-flex items-center gap-1.5">
                  <span>
                    {count(listedPayments.length)} of{" "}
                    {count(openPayments.length)}
                  </span>
                  <Select
                    value={String(paymentLimit)}
                    onChange={(next) => setPaymentLimit(Number(next))}
                    className="h-7 w-20"
                  >
                    {LIMITS.map((limit) => (
                      <option key={limit} value={String(limit)}>
                        {limit}
                      </option>
                    ))}
                  </Select>
                </span>
              }
            >
              Unallocated payments
            </SubHead>

            {queryState(payments, {
              loading: "Reading the payment register…",
              refused: (
                <NoAccessState
                  what="the payment register"
                  reach="Reconciling reads the books, which takes a supervisor's sign-in."
                />
              ),
              render: () =>
                listedPayments.length === 0 ? (
                  <EmptyState>
                    No posted payment has money left on it
                    {unit === "" ? "" : " in this unit"}. This list is
                    structurally empty, not merely quiet: a payment here must
                    name the bills it settles and takes its total from them, so
                    nothing can be paid on account.
                    {drafts.length > 0 && (
                      <>
                        {" "}
                        {count(drafts.length)}{" "}
                        {drafts.length === 1 ? "draft is" : "drafts are"} not a
                        candidate either — a draft has moved no money.
                      </>
                    )}
                  </EmptyState>
                ) : (
                  <Grid>
                    <thead>
                      <tr>
                        <Th width="2.5rem" />
                        <Th>Payment</Th>
                        <Th width="6.5rem">Posting date</Th>
                        <Th width="7rem">Unit</Th>
                        <Th align="right" width="9rem">
                          Unallocated
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {listedPayments.map((row) => {
                        const on = tickedPayments.includes(row.payment_id)
                        return (
                          <tr key={row.payment_id}>
                            <Td>
                              <Checkbox
                                checked={on}
                                onChange={(next) =>
                                  setTickedPayments((was) =>
                                    next
                                      ? [...was, row.payment_id]
                                      : was.filter(
                                          (id) => id !== row.payment_id
                                        )
                                  )
                                }
                                label={
                                  <span className="sr-only">
                                    Reconcile {row.payment_number}
                                  </span>
                                }
                              />
                            </Td>
                            <Td>
                              <span className="block font-mono text-[0.875rem] text-ink">
                                {row.payment_number}
                              </span>
                              <span className="block text-[0.875rem] text-mute">
                                {row.reference ?? label(row.method)}
                              </span>
                            </Td>
                            <Td>{day(row.payment_date)}</Td>
                            <Td>
                              <UnitName id={row.unit_id} />
                            </Td>
                            <Td align="right">
                              <span className="font-medium text-ink">
                                {money(unallocated(row))}
                              </span>
                            </Td>
                          </tr>
                        )
                      })}
                      <TotalRow>
                        <Td />
                        <Td>Total</Td>
                        <Td />
                        <Td />
                        <Td align="right">
                          {money(
                            listedPayments.reduce(
                              (sum, row) => sum + unallocated(row),
                              0
                            )
                          )}
                        </Td>
                      </TotalRow>
                    </tbody>
                  </Grid>
                ),
            })}
          </div>

          {/* ---------------------------------------------------------------
              The debts side */}
          <div>
            <SubHead
              aside={`${count(listedInvoices.length)} of ${count(openInvoices.length)}`}
            >
              Outstanding invoices
            </SubHead>

            {queryState(debts, {
              loading: "Reading what is still open…",
              refused: (
                <NoAccessState
                  what="the bill register"
                  reach="Reconciling reads the books, which takes a supervisor's sign-in."
                />
              ),
              render: () =>
                listedInvoices.length === 0 ? (
                  <EmptyState>
                    Nothing posted is still outstanding under these filters. A
                    bill that has only been recorded is not in the books yet and
                    is not a debt.
                  </EmptyState>
                ) : (
                  <Grid>
                    <thead>
                      <tr>
                        <Th width="2.5rem" />
                        <Th>Invoice</Th>
                        <Th width="6.5rem">Due date</Th>
                        <Th width="7rem">Unit</Th>
                        <Th align="right" width="9rem">
                          Outstanding
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {listedInvoices.map((bill) => {
                        const on = tickedInvoices.includes(bill.invoice_id)
                        const pairable =
                          tickedUnits.size === 0 ||
                          tickedUnits.has(unitOf(bill))
                        return (
                          <tr key={bill.invoice_id}>
                            <Td>
                              <Checkbox
                                checked={on}
                                disabled={!pairable}
                                onChange={(next) =>
                                  setTickedInvoices((was) =>
                                    next
                                      ? [...was, bill.invoice_id]
                                      : was.filter(
                                          (id) => id !== bill.invoice_id
                                        )
                                  )
                                }
                                label={
                                  <span className="sr-only">
                                    Reconcile {bill.invoice_number}
                                  </span>
                                }
                                hint={
                                  pairable
                                    ? undefined
                                    : "Another unit's debt; a payment settles its own unit's bills."
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
                            <Td>
                              <SiteName id={bill.site_id} />
                            </Td>
                            <Td align="right">
                              <span className="font-medium text-ink">
                                {money(bill.outstanding_minor)}
                              </span>
                            </Td>
                          </tr>
                        )
                      })}
                      <TotalRow>
                        <Td />
                        <Td>Total</Td>
                        <Td />
                        <Td />
                        <Td align="right">
                          {money(
                            listedInvoices.reduce(
                              (sum, bill) => sum + bill.outstanding_minor,
                              0
                            )
                          )}
                        </Td>
                      </TotalRow>
                    </tbody>
                  </Grid>
                ),
            })}
          </div>
        </div>

        {/* -----------------------------------------------------------------
            ERPNext's third table: what Allocate proposed, editable before it is
            committed. */}
        <div>
          <SubHead
            aside={`${count(pairings.length)} ${pairings.length === 1 ? "pairing" : "pairings"}`}
          >
            Allocated entries
          </SubHead>

          {pairings.length === 0 ? (
            <p className="rounded-inner border border-dashed border-hairline-2 px-3 py-6 text-center text-[0.875rem] text-mute">
              Tick a payment and one or more invoices, then press{" "}
              <b>Allocate</b>. Each pair is offered the smaller of what is left
              of the payment and what is left of the invoice, oldest invoice
              first — which is exactly what ERPNext proposes, and it can be
              edited here before anybody commits it.
            </p>
          ) : (
            <Grid>
              <thead>
                <tr>
                  <Th width="11rem">Payment</Th>
                  <Th>Invoice</Th>
                  <Th width="7rem">Unit</Th>
                  <Th align="right" width="10rem">
                    Allocated amount
                  </Th>
                  <Th align="right" width="10rem">
                    Leaves outstanding
                  </Th>
                  <Th width="2.5rem" />
                </tr>
              </thead>
              <tbody>
                {pairings.map((pair, index) => {
                  const payment = paymentById.get(pair.payment_id)
                  const bill: SupplierBill | undefined = billById.get(
                    pair.invoice_id
                  )
                  const typed = parseMinor(pair.amount)
                  const roomOnPayment =
                    (payment === undefined ? 0 : unallocated(payment)) -
                    claimedOnPayment(pair.payment_id, pair)
                  const roomOnInvoice =
                    (bill?.outstanding_minor ?? 0) -
                    claimedOnInvoice(pair.invoice_id, pair)
                  const ceiling = Math.min(roomOnPayment, roomOnInvoice)
                  const over = typed !== null && typed > ceiling
                  return (
                    <tr key={`${pair.payment_id}-${pair.invoice_id}-${index}`}>
                      <Td>
                        <span className="font-mono text-[0.875rem] text-ink">
                          {payment?.payment_number ?? "—"}
                        </span>
                      </Td>
                      <Td>
                        <span className="block font-mono text-[0.875rem] text-ink">
                          {bill?.invoice_number ?? "—"}
                        </span>
                        <SupplierName
                          id={bill?.supplier_id}
                          name={bill?.supplier_name}
                          className="block truncate text-[0.875rem] text-mute"
                        />
                      </Td>
                      <Td>
                        <SiteName id={bill?.site_id} />
                      </Td>
                      <Td align="right">
                        <Money
                          label={`Allocated against ${bill?.invoice_number ?? "this invoice"}`}
                          value={pair.amount}
                          onChange={(next) =>
                            setPairings((was) =>
                              was.map((row, at) =>
                                at === index ? { ...row, amount: next } : row
                              )
                            )
                          }
                          className="h-8"
                        />
                        {over && (
                          <span className="mt-0.5 block text-[0.875rem] text-bad-fg">
                            more than the {money(ceiling)} both sides have left
                          </span>
                        )}
                      </Td>
                      <Td align="right">
                        {/* ERPNext calls the column beside this one *Difference
                            Amount*, and in a single-currency ledger it is
                            always zero: theirs is an exchange-rate figure. The
                            number worth printing here is what the invoice would
                            still be owed. */}
                        {bill === undefined
                          ? "—"
                          : money(
                              bill.outstanding_minor -
                                claimedOnInvoice(pair.invoice_id)
                            )}
                      </Td>
                      <Td>
                        <Button
                          size="sm"
                          variant="quiet"
                          aria-label="Remove this pairing"
                          onClick={() =>
                            setPairings((was) =>
                              was.filter((_, at) => at !== index)
                            )
                          }
                        >
                          ×
                        </Button>
                      </Td>
                    </tr>
                  )
                })}
                <TotalRow>
                  <Td>Total</Td>
                  <Td />
                  <Td />
                  <Td align="right">{money(allocatedTotal)}</Td>
                  <Td />
                  <Td />
                </TotalRow>
              </tbody>
            </Grid>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-3">
            <span className="text-[0.875rem] text-mute">
              Committing an allocation would post nothing to the bank and move
              no money — and there is nowhere on this node to send it.
            </span>
            {/* The button says what it is rather than pretending. Nothing here
                writes, and a Reconcile that quietly did nothing would be the
                one failure this prototype must not have. */}
            <Button variant="primary" disabled>
              Reconcile — no endpoint accepts this
            </Button>
          </div>
        </div>

        <Note>
          <b>What this screen stands on, and what it cannot do.</b> Both panels
          are real reads: <code>GET /finance/payments</code> carries every
          payment with its allocations attached, so what is unallocated on one
          is arithmetic on figures the document itself supplies;{" "}
          <code>GET /finance/bills</code> and{" "}
          <code>GET /finance/payables-aging</code> are what is still open, the
          second being the server&rsquo;s own ageing and the only unit filter on
          this screen that travels on the wire. The bills endpoint accepts a{" "}
          <code>site</code>; the <code>listBills</code> wrapper this module
          shares does not pass one, and its cache key has a single slot, for
          status. So the unit and party narrowing on the invoice side happens in
          the browser over the 200 rows it asks for — honest at 29 bills, wrong
          at 29,000, and the fix is one parameter and one more slot in the key.
        </Note>

        <Note>
          <b>Why the money side is empty, before any endpoint is discussed.</b>{" "}
          A payment here <i>must</i> name the bills it settles —{" "}
          <i>
            &ldquo;a payment against no bill is a bank line, not a
            payment&rdquo;
          </i>{" "}
          — and its total is computed from those allocations, so{" "}
          <b>Unallocated amount</b> can never be anything but zero. There is
          also nobody for money on account to be on account <i>for</i>:{" "}
          <code>supplier_payment</code> has no party column at all, and the
          supplier is a property of each allocation. ERPNext&rsquo;s tool makes
          Party mandatory precisely because its open items carry one. So paying
          a supplier in advance, or paying a round sum against &ldquo;whatever
          is oldest&rdquo;, is not a thing this ledger can express yet — and
          that, rather than a missing button, is why this tool has nothing to
          reconcile.
        </Note>

        <Note>
          <b>What this branch has in place of a payment ledger.</b> Open items
          here are <code>supplier_payment_allocation</code> (0084) and the view{" "}
          <code>supplier_invoice_standing</code> (0202), where a bill&rsquo;s{" "}
          <code>outstanding_minor</code> is its total less the allocations of{" "}
          <i>posted</i> payments. Two things follow. It is{" "}
          <b>payable-side only</b> and it is keyed on the <b>bill</b>: there is
          no open-item row for money and no party on a payment, which is why the
          left panel has nothing to read. And an allocation does not name an
          instalment — 0202 says so in as many words — so where ERPNext settles
          an invoice schedule term by term, we settle the whole bill.
          ERPNext&rsquo;s Payment Ledger is a separate table whose <i>sign</i>{" "}
          decides invoice from payment, and that separation is exactly why its
          reconcile touches no bank posting. A party-keyed sub-ledger of that
          shape is being built in a parallel lane and is{" "}
          <b>not in this branch</b>; its tables have already appeared in the
          shared development database, empty and read by nothing here, so this
          screen deliberately stands on none of them.
        </Note>

        <Note>
          <b>What would have to exist to make the button work.</b> Two things,
          in this order. First an open item for money: a payment that may be
          recorded without naming a bill, carrying the party itself — which is
          the sub-ledger the other lane is building. Then one route — say{" "}
          <code>POST /api/v1/finance/payments/&#123;id&#125;/allocations</code>,
          taking a list of <code>&#123; invoice_id, amount_minor &#125;</code>{" "}
          and an <code>Idempotency-Key</code>, writing the pairs in a single
          transaction and refusing over-allocation exactly as{" "}
          <code>assert_allocation_fits</code> already does. What makes that
          second step small rather than a rewrite is that outstanding here is
          not read off the general ledger either: it is the allocation table, so
          re-pointing an allocation moves no journal line — the same property
          that makes ERPNext&rsquo;s reconcile free of bank postings. A
          correcting entry is needed only where a pairing crosses a{" "}
          <i>payable</i> — a merchandise bill and an expense bill sit in
          different accounts — or crosses a unit, which the database refuses
          outright. And the one thing genuinely in the way is a rule rather than
          a table: <code>supplier_payment_allocation_is_evidence</code> raises
          on any insert, update or delete of an allocation once its payment is
          posted, so ERPNext&rsquo;s reconcile is not merely unimplemented here
          — it is forbidden, on the argument that the journal entry quotes those
          amounts. Which of those two rules gives way is the owner&rsquo;s
          decision, and it is the whole decision.
        </Note>
      </div>
    </PageContent>
  )
}
