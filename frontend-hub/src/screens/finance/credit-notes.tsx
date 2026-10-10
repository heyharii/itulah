import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Fab } from "@/components/ui/fab"
import { Panel, ConfirmButton } from "@/components/ui/dialog"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { EmptyState, Problem, Truncated } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  accountDetail,
  createCreditNote,
  financeKeys,
  listBills,
  listCreditNotes,
  postCreditNote,
  refundCreditNote,
} from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import {
  recordSettlement,
  supplierReturnKeys,
} from "@/lib/queries/supplier-returns"
import { ReturnPicker } from "@/screens/finance/return-picker"
import { queryState } from "@/lib/query-state"
import { Code, Grid, Td, Th } from "@/screens/finance-final/parts"
import {
  EXPENSE_LINE_CLASSES,
  parseMinor,
  todayIso,
} from "@/screens/finance/chart"
import {
  moneyAccountValue,
  parseMoneyAccountValue,
  useCategoryName,
  useMeaningLabel,
  useMoneyAccounts,
} from "@/screens/finance/hooks"
import { CardFigure, PhoneList } from "@/components/ui/phone-cards"
import {
  AccountAndCategory,
  accountChoiceProblem,
  accountChoiceReady,
  PhoneChoice,
  SiteName,
  SupplierName,
  SupplierPicker,
  type AccountChoice,
} from "@/screens/finance/parts"

import type { CreditNote, SupplierBill } from "@itulah/contract"

/// Credit Note — a supplier's, against one Purchase Invoice.
///
/// Goods that went back, or a price corrected after the bill was agreed. The
/// supplier either lets the next bill absorb it — posting the note lowers what
/// we owe in Accounts Payable and no money moves — or sends the money back, and
/// that is a second act with its own date and its own bank line: the note goes
/// from Posted to Refunded and the debt it had answered is a debt again.
///
/// So the three states are three different things a person did. Draft is paper
/// recorded and not in the books; Posted is in the ledger; Refunded is money
/// that arrived. The list shows all of them and narrows on the server
/// (`GET /finance/credit-notes` takes `status`), and a note is never edited: a
/// wrong one is not posted, and a posted one is corrected by its own reversal
/// in the journal.
///
/// The client does not use PPN, so there is no tax field — a note is written
/// before tax and carries none. The wire still has `tax_minor` (it defaults to
/// zero and the server never requires it), and a note that has one is shown
/// here as it is.

/// What each reason is called on screen.
const REASONS: Readonly<Record<string, string>> = {
  RETURN: "Goods returned",
  PRICE_CORRECTION: "Price correction",
}

const reasonLabel = (reason: string) => REASONS[reason] ?? reason

/// Draft needs somebody to post it, Posted is in the books, Refunded is
/// finished.
function NoteStatus({ status }: { status: string }) {
  const key = status.toUpperCase()
  return (
    <Status
      tone={key === "DRAFT" ? "warn" : key === "REFUNDED" ? "done" : "ok"}
    >
      {key === "DRAFT" ? "Draft" : key === "REFUNDED" ? "Refunded" : "Posted"}
    </Status>
  )
}

/// The most the server answers: it clamps `limit` to this.
const LIMIT = 500

export function CreditNotes() {
  const [status, setStatus] = useState("")
  const [opened, setOpened] = useState<string | "new" | null>(null)
  const phone = useLayout() === "phone"

  const notes = useQuery({
    queryKey: financeKeys.creditNotes(status || null, null),
    queryFn: ({ signal }) =>
      listCreditNotes({ status: status || undefined }, signal),
  })

  const open =
    opened === null || opened === "new"
      ? null
      : ((notes.data ?? []).find((row) => row.credit_note_id === opened) ??
        null)

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Payables"
        title="Credit Note"
        actions={
          <Button variant="primary" onClick={() => setOpened("new")}>
            New credit note
          </Button>
        }
      />
      {/* On a phone the status is a chip in the dock and the new note is the
          round + beside it. */}
      <PhoneChoice
        title="Status"
        value={status}
        onChange={setStatus}
        options={[
          { value: "", label: "All statuses", short: "All statuses" },
          { value: "DRAFT", label: "Draft" },
          { value: "POSTED", label: "Posted" },
          { value: "REFUNDED", label: "Refunded" },
        ]}
      />
      <Fab label="New credit note" onClick={() => setOpened("new")} />

      <div className="mb-3.5 flex flex-wrap items-center gap-[0.4375rem] max-md:hidden">
        <span className="inline-flex w-40 shrink-0">
          <Select
            value={status}
            onChange={setStatus}
            className="h-control w-40"
            aria-label="Status"
          >
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="POSTED">Posted</option>
            <option value="REFUNDED">Refunded</option>
          </Select>
        </span>
      </div>

      {(notes.data ?? []).length >= LIMIT && (
        <Truncated limit={LIMIT} noun="credit notes" className="mb-3" />
      )}

      {queryState(notes, {
        loading: "Reading the credit notes…",
        render: (rows) =>
          rows.length === 0 ? (
            <Card>
              <EmptyState>
                {status === ""
                  ? "No credit note yet. Record one when a supplier takes goods back or corrects a price on a bill already agreed."
                  : "No credit note has this status."}
              </EmptyState>
            </Card>
          ) : phone ? (
            <PhoneList
              rows={rows.map((row) => ({
                key: row.credit_note_id,
                title: <SupplierName id={row.supplier_id} />,
                code: row.credit_number,
                lead: <CardFigure value={money(row.total_minor)} />,
                foot: (
                  <span className="flex flex-col">
                    <span>
                      {day(row.credit_date)} · {reasonLabel(row.reason)}
                    </span>
                    <span>Against {row.invoice_number}</span>
                    {row.refund_date !== null && (
                      <span>Refunded {day(row.refund_date)}</span>
                    )}
                  </span>
                ),
                action: <NoteStatus status={row.status} />,
                onOpen: () => setOpened(row.credit_note_id),
              }))}
            />
          ) : (
            <Grid>
              <thead>
                <tr>
                  <Th>Credit No</Th>
                  <Th>Date</Th>
                  <Th>Supplier</Th>
                  <Th>Against invoice</Th>
                  <Th>Reason</Th>
                  <Th align="right">Total</Th>
                  <Th>Status</Th>
                  <Th>Refunded</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.credit_note_id}
                    onClick={() => setOpened(row.credit_note_id)}
                    className="cursor-pointer"
                  >
                    <Td>
                      <Code>{row.credit_number}</Code>
                    </Td>
                    <Td>{day(row.credit_date)}</Td>
                    <Td className="min-w-[10rem] whitespace-normal">
                      <SupplierName id={row.supplier_id} />
                    </Td>
                    <Td>{row.invoice_number}</Td>
                    <Td>{reasonLabel(row.reason)}</Td>
                    <Td align="right">{money(row.total_minor)}</Td>
                    <Td>
                      <NoteStatus status={row.status} />
                    </Td>
                    <Td className="text-mute">{day(row.refund_date)}</Td>
                  </tr>
                ))}
              </tbody>
            </Grid>
          ),
      })}

      {opened === "new" && (
        <NewCreditNote
          onClose={() => setOpened(null)}
          onSaved={(id) => setOpened(id)}
        />
      )}
      {open !== null && (
        <CreditNoteDetail
          key={open.credit_note_id}
          note={open}
          onClose={() => setOpened(null)}
        />
      )}
    </PageContent>
  )
}

/// An account as its code and the client's own name for it. The note carries
/// only the code, so the name is asked for.
function AccountLabel({ code }: { code: string }) {
  const account = useQuery({
    queryKey: financeKeys.account(code, null),
    queryFn: ({ signal }) => accountDetail(code, {}, signal),
    staleTime: 5 * 60 * 1000,
  })
  return (
    <>
      <Code>{code}</Code>{" "}
      <span className="ml-1">{account.data?.account.name ?? ""}</span>
    </>
  )
}

/// A journal entry, as its number, opening the entry's own sheet.
function EntryLink({
  entryId,
  number,
}: {
  entryId: string
  number: string | null
}) {
  return (
    <AppLink
      to="/finance/accounting/journal-entries"
      sheet={{ key: "entry", value: entryId }}
      className="font-mono text-[0.875rem] text-accent hover:underline"
    >
      {number ?? "Open the entry"}
    </AppLink>
  )
}

// ---------------------------------------------------------------------------
// One credit note
// ---------------------------------------------------------------------------

/// The note read as facts, with the one act that is next: post a draft, or —
/// once it is posted — record that the supplier sent the money back.
function CreditNoteDetail({
  note,
  onClose,
}: {
  note: CreditNote
  onClose: () => void
}) {
  const client = useQueryClient()
  const categoryName = useCategoryName()
  const state = note.status.toUpperCase()

  // The books move: the note's own list, the invoice's outstanding and the
  // payables ageing all read differently now.
  const refresh = () => client.invalidateQueries({ queryKey: financeKeys.all })

  const post = useMutation({
    mutationFn: () => postCreditNote(note.credit_note_id),
    onSuccess: refresh,
  })

  const facts: (readonly [string, React.ReactNode])[] = [
    ["Supplier", <SupplierName key="s" id={note.supplier_id} />],
    ["Against invoice", note.invoice_number],
    ["Supplier's credit note no", note.their_number ?? "—"],
    ["Unit", <SiteName key="u" id={note.site_id} />],
    ["Credit date", day(note.credit_date)],
    ["Reason", reasonLabel(note.reason)],
    [
      "Credit goes to",
      note.credit_account_code === null ? (
        "Inventory"
      ) : (
        <span key="a">
          <AccountLabel code={note.credit_account_code} />
          {note.credit_category_code !== null && (
            <span className="text-mute">
              {" · "}
              {categoryName(note.credit_category_code)}
            </span>
          )}
        </span>
      ),
    ],
    ["Amount", money(note.subtotal_minor)],
  ]
  // Only a note that carries tax says so: the client has none to show.
  if (note.tax_minor > 0) facts.push(["Tax", money(note.tax_minor)])
  facts.push(
    ["Total", money(note.total_minor)],
    ["Note", note.note ?? "—"],
    ["Recorded by", note.recorded_by],
    [
      "Journal entry",
      note.journal_entry_id === null ? (
        "—"
      ) : (
        <EntryLink
          key="j"
          entryId={note.journal_entry_id}
          number={note.entry_number}
        />
      ),
    ]
  )
  if (note.refund_entry_id !== null) {
    facts.push(
      ["Refunded on", day(note.refund_date)],
      [
        "Refund entry",
        <EntryLink
          key="r"
          entryId={note.refund_entry_id}
          number={note.refund_entry_number}
        />,
      ]
    )
  }

  return (
    <Panel
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={note.credit_number}
      sub={<NoteStatus status={note.status} />}
    >
      <div className="flex flex-col gap-4">
        <Problem error={post.error} />
        <dl className="grid grid-cols-[12rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[0.9375rem]">
          {facts.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-mute">{term}</dt>
              <dd className="min-w-0 text-ink">{value}</dd>
            </div>
          ))}
        </dl>

        {state === "DRAFT" && (
          <div className="flex items-center justify-between gap-3 border-t border-hairline pt-3">
            <span className="text-[0.875rem] text-mute">
              Not in the books until it is posted.
            </span>
            <ConfirmButton
              label="Post"
              variant="primary"
              title="Post this credit note?"
              description={`${money(note.total_minor)} comes off what we owe on ${note.invoice_number}. No money moves; if the supplier sends the money instead, record the refund afterwards.`}
              confirmLabel="Post"
              pending={post.isPending}
              onConfirm={() => post.mutateAsync()}
            />
          </div>
        )}

        {state === "POSTED" && <Refund note={note} onDone={refresh} />}
      </div>
    </Panel>
  )
}

/// The second act: the supplier sent the money rather than letting the next
/// bill absorb the credit.
///
/// Its own date, because that is when the money moved, and its own bank line
/// for the reconciliation to find. The money lands in the books of the unit
/// that owns the note's site, so the accounts offered are that unit's.
function Refund({ note, onDone }: { note: CreditNote; onDone: () => void }) {
  const [asking, setAsking] = useState(false)
  const [account, setAccount] = useState("")
  const [date, setDate] = useState(todayIso)

  const units = useUnits()
  const unit =
    (units.data ?? []).find((one) =>
      one.sites.some((site) => site.id === note.site_id)
    )?.id ?? ""
  const accounts = useMoneyAccounts(unit)
  const meaning = useMeaningLabel()

  const refund = useMutation({
    mutationFn: () => {
      const picked = parseMoneyAccountValue(account)
      return refundCreditNote(note.credit_note_id, {
        account_key: picked.account_key,
        account_qualifier: picked.account_qualifier,
        refund_date: date,
      })
    },
    onSuccess: onDone,
  })

  if (!asking) {
    return (
      <div className="flex items-center justify-between gap-3 border-t border-hairline pt-3">
        <span className="text-[0.875rem] text-mute">
          In the books. The next bill from this supplier can absorb it, or the
          supplier can send the money back.
        </span>
        <Button variant="ghost" onClick={() => setAsking(true)}>
          Record refund
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 border-t border-hairline pt-3">
      <Problem error={refund.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Received into" required>
          <Select
            value={account}
            disabled={accounts.length === 0}
            onChange={setAccount}
          >
            <option value="">Choose an account</option>
            {accounts.map((row) => (
              <option
                key={moneyAccountValue(row)}
                value={moneyAccountValue(row)}
              >
                {meaning(row.account_key)}
                {row.account_qualifier === ""
                  ? ""
                  : ` · ${row.account_qualifier}`}
                {` — ${row.account_name}`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Refund date" required>
          <Day value={date} onChange={setDate} clearable={false} />
        </Field>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.875rem] text-mute">
          {accounts.length === 0
            ? "No cash or bank account is mapped for this unit."
            : `${money(note.total_minor)} comes back and the debt it had answered is owed again.`}
        </span>
        <div className="flex items-center gap-3">
          <Button variant="quiet" onClick={() => setAsking(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            pending={refund.isPending}
            disabled={account === "" || date === ""}
            onClick={() => refund.mutate()}
          >
            {refund.isPending ? "Submitting…" : "Submit"}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// New credit note
// ---------------------------------------------------------------------------

/// A credit note against one posted Purchase Invoice.
///
/// Supplier first, then the invoice: a client has thousands of bills and
/// nobody holds an invoice id, but everybody knows who sent the paper. The
/// account the value goes back to is asked only on an expense bill — on a
/// merchandise bill the goods came out of inventory and the server refuses a
/// choice, so the field is not offered.
function NewCreditNote({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: (creditNoteId: string) => void
}) {
  const client = useQueryClient()
  const [supplier, setSupplier] = useState<{
    supplier_id: string
    name: string
    supplier_code: string
  } | null>(null)
  const [invoiceId, setInvoiceId] = useState("")
  const [date, setDate] = useState(todayIso)
  const [reason, setReason] = useState("RETURN")
  const [amount, setAmount] = useState("")
  const [theirNumber, setTheirNumber] = useState("")
  const [account, setAccount] = useState<AccountChoice | null>(null)
  const [note, setNote] = useState("")
  const [settles, setSettles] = useState("")

  // The supplier's posted bills — a credit note is written against a bill
  // that is already in the books. `supplier` is the code bills carry.
  const code = supplier?.supplier_code ?? ""
  const bills = useQuery({
    queryKey: [...financeKeys.bills("POSTED"), "supplier", code],
    queryFn: ({ signal }) =>
      listBills({ status: "POSTED", supplier: code }, signal).then(
        (page) => page.rows
      ),
    enabled: code !== "",
  })
  const invoice: SupplierBill | null =
    (bills.data ?? []).find((row) => row.invoice_id === invoiceId) ?? null
  const expense = invoice?.kind === "EXPENSE"

  const subtotal = parseMinor(amount)

  const save = useMutation({
    mutationFn: () =>
      createCreditNote({
        invoice_id: invoiceId,
        credit_date: date,
        reason,
        subtotal_minor: subtotal ?? 0,
        // The client does not use PPN, so there is nothing to ask. The wire
        // takes it, defaults it to zero, and never requires it.
        tax_minor: 0,
        their_number:
          theirNumber.trim() === "" ? undefined : theirNumber.trim(),
        credit_account_code: expense ? account?.account_code : undefined,
        credit_category_code: expense
          ? (account?.category_code ?? undefined)
          : undefined,
        note: note.trim() === "" ? undefined : note.trim(),
      }),
    onSuccess: async (saved) => {
      // A credit note that settles a supplier return is recorded against it.
      if (settles !== "") {
        await recordSettlement(settles, {
          kind: "CREDIT_NOTE",
          amount_minor: saved.total_minor,
          reference: saved.credit_number,
        })
        await client.invalidateQueries({ queryKey: supplierReturnKeys.all })
      }
      await client.invalidateQueries({ queryKey: ["finance", "credit-notes"] })
      onSaved(saved.credit_note_id)
    },
  })

  const ready =
    invoice !== null &&
    date !== "" &&
    subtotal !== null &&
    subtotal > 0 &&
    (!expense || accountChoiceReady(account))

  const invoices = useMemo(() => bills.data ?? [], [bills.data])

  return (
    <Panel
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="New credit note"
      sub="Goods that went back, or a price corrected after the bill was agreed. It stays a draft until it is posted."
    >
      <div className="flex flex-col gap-4">
        <Problem error={save.error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier" required>
            <SupplierPicker
              value={supplier?.supplier_id ?? ""}
              onPick={(next) => {
                setSupplier(next)
                setInvoiceId("")
                setAccount(null)
              }}
            />
          </Field>
          <Field
            label="Against invoice"
            required
            hint={
              invoice === null
                ? undefined
                : `${money(invoice.outstanding_minor)} still owed on it.`
            }
          >
            <Select
              value={invoiceId}
              disabled={code === "" || invoices.length === 0}
              onChange={(next) => {
                setInvoiceId(next)
                setAccount(null)
              }}
            >
              <option value="">Choose an invoice</option>
              {invoices.map((row) => (
                <option key={row.invoice_id} value={row.invoice_id}>
                  {row.invoice_number} · {day(row.invoice_date)} ·{" "}
                  {money(row.total_minor)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Credit date" required>
            <Day value={date} onChange={setDate} clearable={false} />
          </Field>
          <Field label="Reason" required>
            <Select value={reason} onChange={setReason}>
              <option value="RETURN">Goods returned</option>
              <option value="PRICE_CORRECTION">Price correction</option>
            </Select>
          </Field>
          <Field
            label="Amount"
            required
            problem={
              amount.trim() !== "" && subtotal === null
                ? "Not a number."
                : undefined
            }
          >
            <Money value={amount} onChange={setAmount} prefix="Rp" />
          </Field>
          <Field label="Supplier's credit note no">
            <Input
              value={theirNumber}
              onChange={(event) => setTheirNumber(event.target.value)}
            />
          </Field>
          {expense && (
            <Field
              label="Credit goes to"
              required
              className="sm:col-span-2"
              hint="An expense invoice: say which cost the value goes back to."
              problem={
                account !== null && account.account_code !== ""
                  ? accountChoiceProblem(account)
                  : undefined
              }
            >
              <AccountAndCategory
                accept={(one) =>
                  !one.is_active
                    ? "cancelled"
                    : !EXPENSE_LINE_CLASSES.includes(one.root_class)
                      ? `class ${one.root_class}`
                      : null
                }
                value={account}
                onChange={setAccount}
                categoryLabel="What it is for"
              />
            </Field>
          )}
          <Field label="Note" className="sm:col-span-2">
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <ReturnPicker
              label="Settles return"
              kind="CREDIT_NOTE"
              supplierId={supplier?.supplier_id}
              value={settles}
              onChange={setSettles}
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-hairline pt-3">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={!ready}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Submitting…" : "Submit"}
          </Button>
        </div>
      </div>
    </Panel>
  )
}
