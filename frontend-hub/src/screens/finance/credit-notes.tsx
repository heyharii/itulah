import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Fab } from "@/components/ui/fab"
import { ConfirmButton } from "@/components/ui/dialog"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
  TotalsLadder,
} from "@/components/ui/rows"
import { CellMoney } from "@/components/ui/rows-switch"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Status } from "@/components/ui/pill"
import { EmptyState, Problem, Truncated } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  accountDetail,
  billDetail,
  billItemLines,
  createCreditNote,
  creditNotesQuery,
  financeKeys,
  listBills,
  postCreditNote,
  refundCreditNote,
} from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import {
  recordSettlement,
  supplierReturnKeys,
  supplierReturns,
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
import {
  invoiceType,
  noteStatus,
  ppnCode,
  termOf,
} from "@/screens/finance/purchasing"
import { useSheet } from "@/lib/sheets"
import { ScreenPending } from "@/screens/finance/pending"

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

function NoteStatus({ status }: { status: string }) {
  const state = noteStatus(status)
  return <Status tone={state.tone}>{state.word}</Status>
}

/// The most the server answers: it clamps `limit` to this.
const LIMIT = 500

export function CreditNotes() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Payables"
          title="Invoice Retur Beli"
          className="max-md:hidden"
        >
          Reading the credit notes…
        </ScreenPending>
      }
    >
      <CreditNotesScreen />
    </Suspense>
  )
}

function CreditNotesScreen() {
  const [status, setStatus] = useState("")
  const link = useSheet("bill")
  const [opened, setOpened] = useState<string | "new" | null>(
    link.value === "new" ? "new" : null
  )
  const phone = useLayout() === "phone"

  // The select answers at once; the list trails it, and the notes in hand stay
  // (dimmed) until the next are read.
  const asked = useDeferredValue(status)
  const notes = useSuspenseQuery(creditNotesQuery(asked))

  const open =
    opened === null || opened === "new"
      ? null
      : (notes.data.find((row) => row.credit_note_id === opened) ?? null)

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Payables"
        title="Invoice Retur Beli"
        actions={
          <Button variant="primary" onClick={() => setOpened("new")}>
            Retur pembelian baru
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
          { value: "POSTED", label: "New" },
          { value: "REFUNDED", label: "Lunas" },
        ]}
      />
      <Fab label="Retur pembelian baru" onClick={() => setOpened("new")} />

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
            <option value="POSTED">New</option>
            <option value="REFUNDED">Lunas</option>
          </Select>
        </span>
      </div>

      {notes.data.length >= LIMIT && (
        <Truncated limit={LIMIT} noun="credit notes" className="mb-3" />
      )}

      <div className="list-swap" aria-busy={asked !== status || undefined}>
        {queryState(notes, {
          render: (rows) =>
            rows.length === 0 ? (
              <Card>
                <EmptyState>
                  {status === ""
                    ? "No credit note yet."
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
                      <span>Faktur diretur {row.invoice_number}</span>
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
              <Grid followRows>
                <thead>
                  <tr>
                    <Th>No faktur</Th>
                    <Th>Tanggal</Th>
                    <Th>Supplier</Th>
                    <Th>Faktur diretur</Th>
                    <Th>Gudang</Th>
                    <Th>No ref</Th>
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
                      <Td>
                        <SiteName id={row.site_id} />
                      </Td>
                      <Td className="text-mute">{row.their_number ?? "—"}</Td>
                      <Td>{reasonLabel(row.reason)}</Td>
                      <Td align="right">
                        <CellMoney minor={row.total_minor} />
                      </Td>
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
      </div>

      {opened === "new" && (
        <NewCreditNote
          onClose={() => {
            setOpened(null)
            if (link.value !== undefined) link.close()
          }}
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
      className="font-mono text-[0.9375rem] text-accent hover:underline"
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
export function CreditNoteDetail({
  note,
  onClose,
}: {
  note: CreditNote
  onClose: () => void
}) {
  const client = useQueryClient()
  const categoryName = useCategoryName()
  const state = note.status.toUpperCase()

  // The invoice the note returns, for the header 7Soft carries on a return:
  // its terms and the order and delivery it answered.
  const invoice = useQuery({
    queryKey: financeKeys.bill(note.invoice_id),
    queryFn: ({ signal }) => billDetail(note.invoice_id, signal),
    staleTime: 60_000,
  })
  const invoiceLines = useQuery({
    queryKey: [...financeKeys.bill(note.invoice_id), "lines"],
    queryFn: ({ signal }) => billItemLines(note.invoice_id, signal),
    staleTime: 60_000,
  })
  const joined = (pick: "po_number" | "receipt_number") => {
    const numbers = [
      ...new Set(
        (invoiceLines.data ?? []).flatMap((line) =>
          line[pick] === null ? [] : [line[pick]]
        )
      ),
    ]
    return numbers.length === 0 ? "—" : numbers.join(", ")
  }
  // The items that went back: a return this note settles carries its lines.
  // A note written as an amount alone has none.
  const returns = useQuery({
    queryKey: supplierReturnKeys.list(),
    queryFn: ({ signal }) => supplierReturns(signal),
    retry: false,
    staleTime: 60_000,
  })
  const items =
    (returns.data ?? []).find((one) =>
      one.settlements.some((paid) => paid.reference === note.credit_number)
    )?.lines ?? []

  // The books move: the note's own list, the invoice's outstanding and the
  // payables ageing all read differently now.
  const refresh = () => client.invalidateQueries({ queryKey: financeKeys.all })

  const post = useMutation({
    mutationFn: () => postCreditNote(note.credit_note_id),
    onSuccess: refresh,
  })

  // 7Soft's Invoice Retur Beli header, in its order and words: No Faktur is the
  // sheet's title, then Tanggal, Supplier, the faktur being returned, Gudang,
  // No Ref and Keterangan; the totals stand under them as TOTAL, PPN and
  // GRAND TOTAL.
  const facts: (readonly [string, React.ReactNode])[] = [
    ["Tanggal", day(note.credit_date)],
    ["Supplier", <SupplierName key="s" id={note.supplier_id} />],
    ["Lokasi", "—"],
    ["Faktur diretur", note.invoice_number],
    [
      "Tipe invoice",
      invoice.data === undefined ? "—" : invoiceType(invoice.data),
    ],
    ["No PO", joined("po_number")],
    ["No terima", joined("receipt_number")],
    ["Gudang", <SiteName key="u" id={note.site_id} />],
    ["No ref", note.their_number ?? "—"],
    [
      "Jangka",
      invoice.data === undefined ? "—" : (termOf(invoice.data) ?? "—"),
    ],
    ["J.tempo", invoice.data === undefined ? "—" : day(invoice.data.due_date)],
    ["Total diskon", "—"],
    [
      "PPN",
      ppnCode({
        subtotal_minor: note.subtotal_minor,
        discount_minor: 0,
        tax_minor: note.tax_minor,
      }),
    ],
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
    ["Keterangan", note.note ?? "—"],
  ]
  facts.push(
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
  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={note.credit_number}
      badge={<NoteStatus status={note.status} />}
      size="wide"
      footer={
        <SheetFooter
          onCancel={onClose}
          cancelLabel="Close"
          note={
            state === "DRAFT"
              ? "Not in the books until it is posted."
              : undefined
          }
          primary={
            state === "DRAFT" ? (
              <ConfirmButton
                label="Post"
                variant="primary"
                title="Post this credit note?"
                description={`${money(note.total_minor)} comes off what we owe on ${note.invoice_number}. No money moves; if the supplier sends the money instead, record the refund afterwards.`}
                confirmLabel="Post"
                pending={post.isPending}
                onConfirm={() => post.mutateAsync()}
              />
            ) : undefined
          }
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Problem error={post.error} />
        {state === "REFUNDED" && (
          <p className="text-[0.9375rem] font-medium text-mute">READ ONLY</p>
        )}
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => window.print()}>
            Print
          </Button>
        </div>
        <dl className="grid grid-cols-[12rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[0.9375rem]">
          {facts.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-mute">{term}</dt>
              <dd className="min-w-0 text-ink">{value}</dd>
            </div>
          ))}
        </dl>

        <div>
          <SubHead>Detail</SubHead>
          <MiniTable
            head={[
              "Kode acc",
              "Nama account",
              "Nama item",
              "Kode item",
              { label: "Jml", align: "right" },
              "Satuan",
              { label: "Harga", align: "right" },
              { label: "Diskon Rp", align: "right" },
              { label: "Diskon %", align: "right" },
              { label: "Subtotal", align: "right" },
              "Keterangan",
            ]}
          >
            {items.length === 0 ? (
              <MiniRow>
                <MiniCell>{note.credit_account_code ?? "—"}</MiniCell>
                <MiniCell>—</MiniCell>
                <MiniCell>—</MiniCell>
                <MiniCell>—</MiniCell>
                <MiniCell align="right">—</MiniCell>
                <MiniCell>—</MiniCell>
                <MiniCell align="right">—</MiniCell>
                <MiniCell align="right">—</MiniCell>
                <MiniCell align="right">—</MiniCell>
                <MiniCell align="right">{money(note.subtotal_minor)}</MiniCell>
                <MiniCell>{reasonLabel(note.reason)}</MiniCell>
              </MiniRow>
            ) : (
              items.map((line) => (
                <MiniRow key={line.sku_code}>
                  <MiniCell>{note.credit_account_code ?? "—"}</MiniCell>
                  <MiniCell>—</MiniCell>
                  <MiniCell>{line.article_name ?? line.article_code}</MiniCell>
                  <MiniCell>{line.article_code}</MiniCell>
                  <MiniCell align="right">{count(line.quantity)}</MiniCell>
                  <MiniCell>—</MiniCell>
                  <MiniCell align="right">
                    {money(line.unit_cost_minor)}
                  </MiniCell>
                  <MiniCell align="right">—</MiniCell>
                  <MiniCell align="right">—</MiniCell>
                  <MiniCell align="right">
                    {money(line.quantity * line.unit_cost_minor)}
                  </MiniCell>
                  <MiniCell>—</MiniCell>
                </MiniRow>
              ))
            )}
          </MiniTable>
        </div>

        <TotalsLadder
          rows={[
            { label: "Total", value: money(note.subtotal_minor) },
            { label: "PPN", value: money(note.tax_minor) },
          ]}
          total={{ label: "Grand total", value: money(note.total_minor) }}
        />

        {/* Pelunasan: the money coming back, as 7Soft's return shows it —
            what is owed back to us is negative, and so is what was received. */}
        {state === "REFUNDED" && (
          <div>
            <SubHead>Pelunasan</SubHead>
            <MiniTable
              head={[
                "Voucher",
                "No reff",
                "Tanggal",
                "Kas/Bank",
                "No cek/BG",
                { label: "Hutang", align: "right" },
                { label: "Bayar", align: "right" },
                { label: "Potongan", align: "right" },
                { label: "Sisa", align: "right" },
                "Jatuh tempo",
                "Keterangan",
              ]}
            >
              <MiniRow>
                <MiniCell>
                  {note.refund_entry_id === null ? (
                    "—"
                  ) : (
                    <EntryLink
                      entryId={note.refund_entry_id}
                      number={note.refund_entry_number}
                    />
                  )}
                </MiniCell>
                <MiniCell>—</MiniCell>
                <MiniCell>{day(note.refund_date)}</MiniCell>
                <MiniCell>—</MiniCell>
                <MiniCell>—</MiniCell>
                <MiniCell align="right">{money(-note.total_minor)}</MiniCell>
                <MiniCell align="right">{money(-note.total_minor)}</MiniCell>
                <MiniCell align="right">—</MiniCell>
                <MiniCell align="right">{money(0)}</MiniCell>
                <MiniCell>
                  {invoice.data === undefined
                    ? "—"
                    : day(invoice.data.due_date)}
                </MiniCell>
                <MiniCell>—</MiniCell>
              </MiniRow>
            </MiniTable>
          </div>
        )}

        {state === "POSTED" && <Refund note={note} onDone={refresh} />}
      </div>
    </Sheet>
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
        <span className="text-[0.9375rem] text-mute">
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
        <span className="text-[0.9375rem] text-mute">
          {accounts.length === 0
            ? "No cash or bank account is mapped for this unit."
            : `${money(note.total_minor)} comes back and the debt it had answered is owed again.`}
        </span>
        <div className="flex items-center gap-3">
          <Button data-cancel variant="quiet" onClick={() => setAsking(false)}>
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
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Retur pembelian baru"
      size="wide"
      footer={
        <SheetFooter
          onCancel={onClose}
          primary={{
            label: "Submit",
            pending: save.isPending,
            disabled: !ready,
            onClick: () => save.mutate(),
          }}
        />
      }
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
            label="Faktur diretur"
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
          <Field label="Tanggal" required>
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
          <Field label="No ref">
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
          <Field label="Keterangan" className="sm:col-span-2">
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
      </div>
    </Sheet>
  )
}
