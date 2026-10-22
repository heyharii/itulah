import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  recordSettlement,
  supplierReturnKeys,
} from "@/lib/queries/supplier-returns"
import { ReturnPicker } from "@/screens/finance/return-picker"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Plus, Printer, Repeat, Trash2 } from "lucide-react"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { button } from "@/components/ui/button-style"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Day } from "@/components/ui/day"
import { Panel, SavedDialog } from "@/components/ui/dialog"
import { Fab } from "@/components/ui/fab"
import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill, Status } from "@/components/ui/pill"
import { SubHead } from "@/components/ui/rows"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, day, label, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  approveCashDocument,
  buildVoucherRequest,
  cashDocument,
  cashDocumentKeys,
  cashDocumentSlip,
  cashDocumentsQuery,
  kindWord,
  openAdvances,
  postCashDocument,
  recordVoucher,
  reverseCashDocument,
  type CashDocumentDraft,
  type ComposeKind,
} from "@/lib/queries/cash-documents"
import { financeKeys, listBills } from "@/lib/queries/finance"
import {
  financeReportKeys,
  listCashDocumentRepeats,
  runCashDocumentRepeats,
  saveCashDocumentRepeat,
} from "@/lib/queries/finance-reports"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { terbilang } from "@/lib/terbilang"
import { toast } from "@/lib/toast"
import { isoDay, parseMinor, todayIso } from "@/screens/finance/chart"
import {
  moneyAccountValue,
  parseMoneyAccountValue,
  useMeaningLabel,
  useMoneyAccountChoices,
  useMoneyAccounts,
  useSupplierName,
} from "@/screens/finance/hooks"
import { withLegalForm } from "@/screens/procurement/supplier-format"
import { CardFigure, PhoneList } from "@/components/ui/phone-cards"
import { CellMoney } from "@/components/ui/rows-switch"
import {
  AccountAndCategory,
  PhoneChoice,
  PhoneUnitChoice,
  SupplierPicker,
  UnitName,
  UnitSelect,
  type AccountChoice,
} from "@/screens/finance/parts"
import { ScreenPending } from "@/screens/finance/pending"
import {
  Code,
  Grid,
  Note,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { idempotencyKey } from "@itulah/contract/client"
import type {
  CashDocumentRepeat,
  CashDocumentRow,
  CashDocumentSlip,
  SupplierBill,
} from "@itulah/contract"

/// BKM / BKK — the client's cash slips, in the Klasik layout the owner picked
/// (design 1 of `bkm-bkk-prototype.html`): a two-column header with a total
/// box beside it, three tabs — Settle / Other lines / Offset — and a giro leaf
/// when the method is Giro. Copied field for field: layout, order and English
/// copy come from the prototype; only colour, type and control sizes come
/// from the hub's own tokens.
///
/// # A full page, not a sheet
///
/// Every other record in this app opens as a sheet over the screen that lists
/// it (`lib/sheets.ts`). This one does not: the owner asked for the document
/// to be its own page, the way `/stores/$unit` is the one other record this
/// app addresses by path rather than by sheet. `Bkk`/`Bkm` are the register;
/// `BkkDocument`/`BkmDocument` are the document, at `/finance/cash-bank/bkk/new`
/// and `/finance/cash-bank/bkk/$id` (and the `bkm` equivalents) — routed as
/// hidden rows in `screens/finance/nav.ts`, the same device `/stores/$unit`
/// uses, and mapped in `screens/finance/index.ts`. Both files are the
/// coordinator's to review; the change there is four hidden nav rows and four
/// screen-map entries, nothing else.
///
/// # What posts
///
/// Everything on the form: the bills ticked on Settle (with their POTONGAN),
/// every Other line, the advances netted off on Offset, how it was paid and
/// the giro — one `POST /cash-documents/voucher` (0711), one journal entry
/// when it posts. "Replace a bounced giro" lives on the Giro board. A BKM has
/// no customer invoices to settle yet (the business sells at the till), so its
/// Settle and Offset tabs say so.

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

interface KindTerms {
  readonly party: string
  readonly settle: string
  readonly offset: string
  readonly amountLabel: string
  readonly col: string
  readonly open: string
  readonly invWord: string
}

/// The prototype's own `M` object (`bkm-bkk-prototype.html` ~line 599),
/// carried over word for word.
function termsFor(kind: ComposeKind): KindTerms {
  return kind === "BKK"
    ? {
        party: "Supplier",
        settle: "Settle bills",
        offset: "Offset receivables",
        amountLabel: "Total paid",
        col: "Paid",
        open: "Payable",
        invWord: "bill",
      }
    : {
        party: "Customer",
        settle: "Settle invoices",
        offset: "Offset payables",
        amountLabel: "Total received",
        col: "Received",
        open: "Receivable",
        invWord: "invoice",
      }
}

/// Amber for a document that still needs somebody — draft, or approved and not
/// yet posted; green once it is in the books; quiet once it is answered.
function cashDocumentTone(status: string): "warn" | "ok" | "neutral" {
  if (status === "DRAFT" || status === "APPROVED") return "warn"
  if (status === "POSTED") return "ok"
  return "neutral"
}

/// The account the money actually moved through — `from` for a BKK, `to` for
/// a BKM, both for a transfer. Shown by its meaning, because a meaning-based
/// side carries no resolved code on the row itself (see the slip endpoint for
/// where that resolution happens).
function MoneySide({ row }: { row: CashDocumentRow }) {
  const meaningLabel = useMeaningLabel()
  const side = (key: string | null, qualifier: string) => (
    <>
      {meaningLabel(key)}
      {qualifier !== "" && <span className="text-mute"> · {qualifier}</span>}
    </>
  )
  if (row.kind === "TRANSFER") {
    return (
      <span className="block truncate text-[0.9375rem]">
        {side(row.from_key, row.from_qualifier)}
        {" → "}
        {side(row.to_key, row.to_qualifier)}
      </span>
    )
  }
  return row.kind === "PAY" ? (
    <span className="block truncate">
      {side(row.from_key, row.from_qualifier)}
    </span>
  ) : (
    <span className="block truncate">{side(row.to_key, row.to_qualifier)}</span>
  )
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

export function Bkk() {
  return <Register kind="BKK" />
}

export function Bkm() {
  return <Register kind="BKM" />
}

function Register({ kind }: { kind: ComposeKind }) {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Payments" title={kind}>
          Reading the register…
        </ScreenPending>
      }
    >
      <RegisterScreen kind={kind} />
    </Suspense>
  )
}

function RegisterScreen({ kind }: { kind: ComposeKind }) {
  const navigate = useNavigate()
  const supplierName = useSupplierName()
  const [unit, setUnit] = useState("")
  const [status, setStatus] = useState("")
  const phone = useLayout() === "phone"
  const serverKind = kind === "BKK" ? "PAY" : "RECEIVE"
  const T = termsFor(kind)

  // Another tab or filter: the rows in hand stay, dimmed (`list-swap`), until
  // the next are read.
  const askedStatus = useDeferredValue(status)
  const askedUnit = useDeferredValue(unit)
  const list = useSuspenseQuery(
    cashDocumentsQuery(serverKind, askedStatus, askedUnit)
  )
  const rows = list.data

  const openNew = () =>
    void navigate({
      to:
        kind === "BKK"
          ? "/finance/cash-bank/bkk/new"
          : "/finance/cash-bank/bkm/new",
    } as never)
  const openDocument = (id: string) =>
    void navigate({
      to:
        kind === "BKK"
          ? "/finance/cash-bank/bkk/$id"
          : "/finance/cash-bank/bkm/$id",
      params: { id },
    } as never)

  /// The register. A card is the party over the number, what moved the money,
  /// the amount as its figure and the date and status in the foot.
  const columns = useMemo<ColumnDef<TableSetup, CashDocumentRow>[]>(
    () => [
      {
        id: "number",
        accessorFn: (row) => row.number,
        header: "Number",
        size: 150,
        enableSorting: false,
        meta: { card: "id" },
        cell: ({ row }) =>
          row.original.number !== null ? (
            <span className="font-mono text-[0.9375rem] text-ink">
              {row.original.number}
            </span>
          ) : (
            <span className="text-mute">Draft</span>
          ),
      },
      {
        id: "date",
        accessorFn: (row) => row.doc_date,
        header: "Date",
        size: 130,
        enableSorting: false,
        meta: { card: "foot", priority: 2 },
        cell: ({ row }) => day(row.original.doc_date),
      },
      {
        id: "party",
        accessorFn: (row) => row.party_name,
        header: T.party,
        size: 260,
        enableSorting: false,
        meta: { card: "title", grow: 240 },
        cell: ({ row }) => (
          <span className="block truncate text-ink">
            {row.original.party_type === "SUPPLIER"
              ? supplierName(row.original.supplier_id, row.original.party_name)
              : row.original.party_name}
          </span>
        ),
      },
      {
        id: "account",
        accessorFn: (row) => row.from_key ?? row.to_key,
        header: "Cash / bank",
        size: 220,
        enableSorting: false,
        meta: { card: "meta", priority: 3 },
        cell: ({ row }) => <MoneySide row={row.original} />,
      },
      {
        id: "amount",
        accessorFn: (row) => row.amount_minor,
        header: "Amount",
        size: 150,
        enableSorting: false,
        meta: { align: "right", card: "lead" },
        cell: ({ row }) => (
          <span className="font-medium text-ink">
            <CellMoney minor={row.original.amount_minor} />
          </span>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "Status",
        size: 130,
        enableSorting: false,
        meta: { card: "status" },
        cell: ({ row }) => (
          <Status tone={cashDocumentTone(row.original.status)}>
            {label(row.original.status)}
          </Status>
        ),
      },
    ],
    [T.party, supplierName]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: CashDocumentRow) => row.document_id,
      }),
      [rows, columns]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Payments"
        title={kind}
        // A phone has the + at the thumb.
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={openNew}>
              New {kind}
            </Button>
          )
        }
      />
      {/* A phone: status and unit are two chips in the dock, the new document
          the round +. */}
      <PhoneChoice
        title="Status"
        value={status}
        onChange={setStatus}
        options={[
          { value: "", label: "All statuses" },
          { value: "DRAFT", label: "Draft" },
          { value: "APPROVED", label: "Approved" },
          { value: "POSTED", label: "Posted" },
          { value: "REVERSED", label: "Reversed" },
        ]}
      />
      <PhoneUnitChoice value={unit} onChange={setUnit} />
      <Fab label={`New ${kind}`} onClick={openNew} />

      {!phone && (
        <Toolbar
          lead={
            <SubTabs
              value={status === "" ? "ALL" : status}
              onChange={(next) => setStatus(next === "ALL" ? "" : next)}
              tabs={[
                { value: "ALL", label: "All" },
                { value: "DRAFT", label: "Draft" },
                { value: "APPROVED", label: "Approved" },
                { value: "POSTED", label: "Posted" },
                { value: "REVERSED", label: "Reversed" },
              ]}
            />
          }
        >
          <UnitSelect
            value={unit}
            onChange={setUnit}
            className="h-control w-44"
            aria-label="Unit"
          />
          <Toolbar.Spacer />
          <span className="text-[0.9375rem] text-mute">
            {count(rows.length)} {rows.length === 1 ? "document" : "documents"}
          </span>
        </Toolbar>
      )}

      <div
        aria-busy={askedStatus !== status || askedUnit !== unit || undefined}
        className="list-swap"
      >
        {queryState(list, {
          render: (docs) =>
            docs.length === 0 ? (
              <EmptyState>
                No {kind} is recorded{unit === "" ? "" : " for this unit"}.
              </EmptyState>
            ) : (
              <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
                <DataTable<CashDocumentRow>
                  refresh={[list]}
                  table={table}
                  onRowClick={(row) => openDocument(row.document_id)}
                  pageScroll
                  cardSort={false}
                  cardsApart
                  cardLead
                />
              </Card>
            ),
        })}
      </div>

      <RepeatingSection kind={kind} />
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// The document page — new or existing, decided by whether the URL names one
// ---------------------------------------------------------------------------

export function BkkDocument() {
  return <CashDocumentPage kind="BKK" />
}

export function BkmDocument() {
  return <CashDocumentPage kind="BKM" />
}

function CashDocumentPage({ kind }: { kind: ComposeKind }) {
  // `strict: false`: this route is hand-registered in `nav.ts` rather than
  // declared as a named, typed route, so there is no `Route.useParams` to
  // reach for — the same bargain `screens/stores/detail.tsx` makes for
  // `/stores/$unit`, the one other record this app addresses by path.
  const params = useParams({ strict: false }) as unknown as { id?: string }
  const id = params.id ?? null
  return id === null ? (
    <KlasikForm kind={kind} />
  ) : (
    <ExistingDocument kind={kind} id={id} />
  )
}

function BackToList({ kind }: { kind: ComposeKind }) {
  const listPath =
    kind === "BKK" ? "/finance/cash-bank/bkk" : "/finance/cash-bank/bkm"
  return (
    <Link to={listPath as never} className={button({ variant: "ghost" })}>
      ← Back to {kind}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// An existing document, read as facts
// ---------------------------------------------------------------------------

function ExistingDocument({ kind, id }: { kind: ComposeKind; id: string }) {
  const client = useQueryClient()
  const supplierName = useSupplierName()
  const [postingDate, setPostingDate] = useState("")
  const [reverseReason, setReverseReason] = useState("")
  const [reversePostingDate, setReversePostingDate] = useState("")
  const phone = useLayout() === "phone"
  const [printing, setPrinting] = useState(false)
  const [repeating, setRepeating] = useState<RepeatDraft | null>(null)
  /// The repeat the sheet saved, held in the receipt dialog until it is read.
  const [savedRepeat, setSavedRepeat] = useState<{
    title: string
    note: string
  } | null>(null)

  const detail = useQuery({
    queryKey: cashDocumentKeys.detail(id),
    queryFn: ({ signal }) => cashDocument(id, signal),
  })
  const meaningLabel = useMeaningLabel()

  const invalidate = () => {
    void client.invalidateQueries({
      queryKey: [...financeKeys.all, "cash-documents"],
    })
  }

  const approve = useMutation({
    mutationFn: () => approveCashDocument(id),
    onSuccess: invalidate,
  })
  const post = useMutation({
    mutationFn: () => postCashDocument(id, postingDate || undefined),
    onSuccess: () => {
      // A post writes a journal entry, so every balance, both statements and
      // the trial balance moved too.
      void client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })
  const reverse = useMutation({
    mutationFn: () =>
      reverseCashDocument(
        id,
        reverseReason.trim(),
        reversePostingDate || undefined
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Payments"
        title={detail.data?.number ?? kind}
        // A phone has Back in its top bar.
        actions={phone ? undefined : <BackToList kind={kind} />}
      />

      {queryState(detail, {
        loading: "Reading the document…",
        render: (doc) => {
          const moneyIsFrom = doc.kind === "PAY" || doc.kind === "TRANSFER"
          const slipButtons = (
            <>
              {(doc.status === "APPROVED" || doc.status === "POSTED") && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPrinting(true)}
                >
                  <Printer className="size-3.5" />
                  Print slip
                </Button>
              )}
              {repeatDraftOf(doc) !== null && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRepeating(repeatDraftOf(doc))}
                >
                  <Repeat className="size-3.5" />
                  Repeat…
                </Button>
              )}
            </>
          )
          return (
            <div className="flex max-w-3xl flex-col gap-5">
              {/* The prototype's posted banner (`postedBanner()`), with real
                  figures. */}
              {doc.status === "POSTED" && (
                <Banner tone="ok">
                  Posted as <b className="font-mono">{doc.number}</b>
                  {doc.entry_number !== null && (
                    <>
                      {" "}
                      · journal <b className="font-mono">{doc.entry_number}</b>
                    </>
                  )}
                  . To correct it, reverse it below.
                </Banner>
              )}
              {approve.isError && (
                <Banner tone="bad">
                  {approve.error instanceof Error
                    ? approve.error.message
                    : "The document could not be approved."}
                </Banner>
              )}
              {post.isError && (
                <Banner tone="bad">
                  {post.error instanceof Error
                    ? post.error.message
                    : "The document could not be posted."}
                </Banner>
              )}
              {reverse.isError && (
                <Banner tone="bad">
                  {reverse.error instanceof Error
                    ? reverse.error.message
                    : "The reversal was refused."}
                </Banner>
              )}

              <div className="flex flex-wrap gap-1.5">
                <Pill>{kindWord(doc.kind)}</Pill>
                <Status tone={cashDocumentTone(doc.status)}>
                  {label(doc.status)}
                </Status>
                {/* On a phone these two stand at the foot of the page with the
                    rest of what can be done to it. */}
                {!phone && slipButtons}
              </div>

              <Facts>
                <Fact term="Date">{day(doc.doc_date)}</Fact>
                <Fact term="Unit">
                  {doc.from_unit === doc.to_unit ? (
                    <UnitName id={doc.from_unit} />
                  ) : (
                    <>
                      <UnitName id={doc.from_unit} /> →{" "}
                      <UnitName id={doc.to_unit} />
                    </>
                  )}
                </Fact>
                <Fact
                  term={doc.kind === "RECEIVE" ? "Received into" : "Paid from"}
                >
                  {moneyIsFrom
                    ? meaningLabel(doc.from_key)
                    : meaningLabel(doc.to_key)}
                  {(moneyIsFrom ? doc.from_qualifier : doc.to_qualifier) !==
                    "" && (
                    <span className="text-mute">
                      {" · "}
                      {moneyIsFrom ? doc.from_qualifier : doc.to_qualifier}
                    </span>
                  )}
                </Fact>
                {!doc.has_lines && (
                  <Fact
                    term={doc.kind === "RECEIVE" ? "Received from" : "Paid for"}
                  >
                    {doc.kind === "RECEIVE" ? (
                      doc.from_account_code !== null ? (
                        <Code>{doc.from_account_code}</Code>
                      ) : (
                        "—"
                      )
                    ) : doc.to_account_code !== null ? (
                      <Code>{doc.to_account_code}</Code>
                    ) : (
                      "—"
                    )}
                  </Fact>
                )}
                <Fact term="Party">
                  {doc.party_type === "SUPPLIER"
                    ? supplierName(doc.supplier_id, doc.party_name)
                    : doc.party_name}
                  <span className="text-mute"> · {label(doc.party_type)}</span>
                </Fact>
                <Fact term="Amount">
                  <span className="text-[1rem] font-semibold text-ink">
                    {money(doc.amount_minor)}
                  </span>
                </Fact>
                <Fact term="Recorded by">{doc.created_by}</Fact>
                {doc.approved_by !== null && (
                  <Fact term="Approved by">{doc.approved_by}</Fact>
                )}
                {doc.posted_by !== null && (
                  <Fact term="Posted by">{doc.posted_by}</Fact>
                )}
                {doc.entry_number !== null && (
                  <Fact term="Journal entry">
                    <span className="font-mono text-[0.9375rem]">
                      {doc.entry_number}
                    </span>
                  </Fact>
                )}
                {doc.method !== "CASH" && (
                  <Fact term="Paid by">
                    {label(doc.method)}
                    {doc.giro_number !== null && (
                      <span className="text-mute">
                        {" · "}
                        <span className="font-mono">{doc.giro_number}</span>
                        {doc.giro_due_date !== null &&
                          ` · due ${day(doc.giro_due_date)}`}
                      </span>
                    )}
                  </Fact>
                )}
                {doc.reference !== null && (
                  <Fact term="Reference">{doc.reference}</Fact>
                )}
              </Facts>

              {doc.has_lines && doc.lines.length > 0 && (
                <Card className="overflow-hidden">
                  <Grid>
                    <thead>
                      <tr>
                        <Th width="10rem">Line</Th>
                        <Th>Bill / account</Th>
                        <Th>Note</Th>
                        <Th align="right" width="8.5rem">
                          Discount
                        </Th>
                        <Th align="right" width="9.5rem">
                          Amount
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.lines.map((line) => (
                        <tr key={line.line_no}>
                          <Td className="text-mute">
                            {line.kind === "SETTLE"
                              ? kind === "BKK"
                                ? "Settle bill"
                                : "Settle invoice"
                              : line.kind === "OFFSET"
                                ? "Offset"
                                : "Other line"}
                          </Td>
                          <Td>
                            <span className="font-mono text-[0.9375rem] text-ink">
                              {line.invoice_number ??
                                line.advance_number ??
                                line.account_code ??
                                meaningLabel(line.semantic_key)}
                            </span>
                          </Td>
                          <Td className="text-mute">{line.note ?? ""}</Td>
                          <Td align="right">
                            {line.discount_minor > 0
                              ? money(line.discount_minor)
                              : ""}
                          </Td>
                          <Td align="right">
                            {line.kind === "OFFSET"
                              ? money(-line.amount_minor)
                              : money(line.amount_minor)}
                          </Td>
                        </tr>
                      ))}
                      <TotalRow>
                        <Td>Total</Td>
                        <Td />
                        <Td />
                        <Td />
                        <Td align="right">{money(doc.amount_minor)}</Td>
                      </TotalRow>
                    </tbody>
                  </Grid>
                </Card>
              )}

              {doc.memo !== "" && (
                <p className="text-[0.9375rem] text-body">{doc.memo}</p>
              )}

              {doc.status === "DRAFT" && (
                <div className="flex items-center justify-between gap-3 border-t border-hairline pt-4">
                  <span className="text-[0.9375rem] text-mute">
                    Approving takes the next number —{" "}
                    {doc.kind === "PAY"
                      ? "KK"
                      : doc.kind === "RECEIVE"
                        ? "KM"
                        : "TF"}
                    -…
                  </span>
                  <Button
                    variant="primary"
                    pending={approve.isPending}
                    onClick={() => approve.mutate()}
                  >
                    {approve.isPending ? "Approving…" : "Approve"}
                  </Button>
                </div>
              )}

              {doc.status === "APPROVED" && (
                <div className="flex flex-wrap items-end justify-between gap-3 border-t border-hairline pt-4">
                  <Field
                    label="Posting date"
                    hint="Empty posts it on the document date."
                    className="w-44"
                  >
                    <Day value={postingDate} onChange={setPostingDate} />
                  </Field>
                  <Button
                    variant="primary"
                    pending={post.isPending}
                    onClick={() => post.mutate()}
                  >
                    {post.isPending ? "Posting…" : "Post to the books"}
                  </Button>
                </div>
              )}

              {doc.status === "POSTED" && (
                <div className="flex flex-col gap-2 border-t border-hairline pt-4">
                  <SubHead aside="posts a new entry">Reverse</SubHead>
                  <Textarea
                    rows={2}
                    value={reverseReason}
                    onChange={(event) => setReverseReason(event.target.value)}
                  />
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <Field
                      label="Posting date"
                      hint="Empty posts the mirror today."
                      className="w-44"
                    >
                      <Day
                        value={reversePostingDate}
                        onChange={setReversePostingDate}
                      />
                    </Field>
                    <Button
                      variant="danger"
                      pending={reverse.isPending}
                      disabled={reverseReason.trim() === ""}
                      onClick={() => reverse.mutate()}
                    >
                      {reverse.isPending ? "Reversing…" : "Reverse"}
                    </Button>
                  </div>
                </div>
              )}

              {doc.status === "REVERSED" && (
                <Note>
                  Reversed. It stays in the books up to the date its reversal
                  was posted.
                </Note>
              )}

              {phone && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {slipButtons}
                </div>
              )}
            </div>
          )
        },
      })}

      <SlipPanel id={printing ? id : null} onClose={() => setPrinting(false)} />
      {repeating !== null && (
        <RepeatSheet
          kind={kind}
          draft={repeating}
          onClose={() => setRepeating(null)}
          onSaved={setSavedRepeat}
        />
      )}
      <SavedDialog
        open={savedRepeat !== null}
        onOpenChange={(next) => {
          if (!next) setSavedRepeat(null)
        }}
        title={savedRepeat?.title ?? ""}
      >
        {savedRepeat?.note}
      </SavedDialog>
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// Repeating BKK / BKM
// ---------------------------------------------------------------------------

/// What the repeat sheet opens on: a new repeat made from a document
/// (`repeatId` null, `docDate` set so the next date follows the frequency), or
/// a saved one being changed.
interface RepeatDraft {
  /// Remounts the sheet's own state when a different draft opens.
  readonly key: string
  readonly repeatId: string | null
  readonly name: string
  /// The voucher body, `POST /cash-documents/voucher`'s without its date.
  readonly voucher: Record<string, unknown>
  readonly frequency: string
  readonly nextDate: string
  readonly endDate: string
  readonly isActive: boolean
  /// The document a new repeat is made from: its date is where "one period
  /// after" counts from. Null for a saved repeat, whose next date is its own.
  readonly docDate: string | null
  readonly party: string
  readonly amountMinor: number
}

const FREQUENCIES: readonly {
  readonly value: string
  readonly label: string
  readonly months: number
}[] = [
  { value: "MONTHLY", label: "Monthly", months: 1 },
  { value: "QUARTERLY", label: "Quarterly", months: 3 },
  { value: "YEARLY", label: "Yearly", months: 12 },
]

function frequencyLabel(value: string): string {
  return (
    FREQUENCIES.find((option) => option.value === value)?.label ?? label(value)
  )
}

/// One period after a day, kept on the same day of the month where the month
/// has it and on its last day where it does not (31 Jan, monthly, is 28 Feb).
function addPeriod(iso: string, frequency: string): string {
  const months =
    FREQUENCIES.find((option) => option.value === frequency)?.months ?? 1
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  const dayOfMonth = Number(iso.slice(8, 10))
  const lastDay = new Date(year, month - 1 + months + 1, 0).getDate()
  return isoDay(
    new Date(year, month - 1 + months, Math.min(dayOfMonth, lastDay))
  )
}

/// The voucher this document would be raised as again, or `null` when it
/// cannot repeat: the server only repeats Other lines, never a giro (a giro is
/// one numbered piece of paper), and a bill or an advance is settled once.
/// Built from the document's own fields in the shape `buildVoucherRequest`
/// makes, minus the date and the one-off reference.
function repeatDraftOf(doc: CashDocumentRow): RepeatDraft | null {
  if (doc.kind !== "PAY" && doc.kind !== "RECEIVE") return null
  if (doc.status === "REVERSED" || doc.method === "GIRO") return null
  if (!doc.has_lines || doc.lines.length === 0) return null
  if (doc.lines.some((line) => line.kind !== "OTHER")) return null

  const outgoing = doc.kind === "PAY"
  const moneyKey = outgoing ? doc.from_key : doc.to_key
  if (moneyKey === null) return null
  const unit = outgoing ? doc.from_unit : doc.to_unit

  const voucher: Record<string, unknown> = {
    direction: outgoing ? "OUT" : "IN",
    money: {
      semantic_key: moneyKey,
      qualifier: outgoing ? doc.from_qualifier : doc.to_qualifier,
      account_code: null,
      category_code: null,
      unit_id: unit,
    },
    method: doc.method,
    reference: null,
    giro_number: null,
    giro_due_date: null,
    giro_bank: null,
    party_type: doc.party_type,
    supplier_id: doc.supplier_id,
    employee_id: doc.employee_id,
    party_name: doc.party_name,
    memo: doc.memo,
    lines: doc.lines.map((line) => ({
      kind: "OTHER",
      // A meaning wins over the code it resolved to: the repeat should follow
      // the map when it changes, as the document did when it was keyed.
      account:
        line.semantic_key !== null
          ? {
              semantic_key: line.semantic_key,
              qualifier: line.qualifier,
              account_code: null,
              category_code: null,
              unit_id: line.unit_id ?? unit,
            }
          : {
              semantic_key: null,
              qualifier: "",
              account_code: line.account_code,
              category_code: line.category_code,
              unit_id: line.unit_id ?? unit,
            },
      amount_minor: line.amount_minor,
      note: line.note,
    })),
  }

  const memo = doc.memo.trim()
  return {
    key: doc.document_id,
    repeatId: null,
    name: memo === "" ? doc.party_name : `${doc.party_name} · ${memo}`,
    voucher,
    frequency: "MONTHLY",
    nextDate: "",
    endDate: "",
    isActive: true,
    docDate: doc.doc_date,
    party: doc.party_name,
    amountMinor: doc.amount_minor,
  }
}

function repeatDraftFrom(repeat: CashDocumentRepeat): RepeatDraft {
  return {
    key: repeat.repeat_id,
    repeatId: repeat.repeat_id,
    name: repeat.name,
    voucher: repeat.voucher,
    frequency: repeat.frequency,
    nextDate: repeat.next_date,
    endDate: repeat.end_date ?? "",
    isActive: repeat.is_active,
    docDate: null,
    party: repeat.party_name,
    amountMinor: repeat.amount_minor,
  }
}

/// The small sheet a repeat is made and changed in: a name, how often, when it
/// is next due and, if it stops, when. What it raises is the voucher's own
/// and not edited here — change the figures by repeating a corrected document.
function RepeatSheet({
  kind,
  draft,
  onClose,
  onSaved,
}: {
  kind: ComposeKind
  draft: RepeatDraft
  onClose: () => void
  /// The repeat went through; the receipt is the caller's to show — this
  /// sheet unmounts the moment it closes.
  onSaved?: (saved: { title: string; note: string }) => void
}) {
  const client = useQueryClient()
  const [name, setName] = useState(draft.name)
  const [frequency, setFrequency] = useState(draft.frequency)
  // Empty follows the frequency (one period after the document) until the
  // person picks a date themselves.
  const [picked, setPicked] = useState<string | null>(
    draft.docDate === null ? draft.nextDate : null
  )
  const [endDate, setEndDate] = useState(draft.endDate)
  const [incomplete, setIncomplete] = useState<Error | null>(null)

  const nextDate =
    picked ??
    (draft.docDate === null ? "" : addPeriod(draft.docDate, frequency))

  const save = useMutation({
    mutationFn: () =>
      saveCashDocumentRepeat({
        repeat_id: draft.repeatId,
        name: name.trim(),
        voucher: draft.voucher,
        frequency,
        next_date: nextDate,
        end_date: endDate === "" ? null : endDate,
        is_active: draft.isActive,
      }),
    onSuccess: (saved) => {
      void client.invalidateQueries({
        queryKey: financeReportKeys.cashRepeatsAll(),
      })
      onSaved?.({
        title: draft.repeatId === null ? "Repeat started" : "Repeat saved",
        note: `${saved.name} · next ${day(saved.next_date)}`,
      })
      onClose()
    },
  })

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={draft.repeatId === null ? `Repeat this ${kind}` : "Edit repeat"}
      size="rail"
      footer={
        <SheetFooter
          onCancel={onClose}
          error={incomplete ?? save.error}
          primary={{
            label: "Submit",
            pending: save.isPending,
            onClick: () => {
              if (name.trim() === "" || nextDate === "") {
                setIncomplete(
                  new Error("A repeat needs a name and a next date.")
                )
                return
              }
              setIncomplete(null)
              save.mutate()
            },
          }}
        />
      }
    >
      <p className="text-mute">
        Raises a draft {kind} of {money(draft.amountMinor)}
        {draft.party === "" ? "" : ` for ${draft.party}`} on each date. It still
        needs approving and posting.
      </p>
      <div className="mt-4 flex flex-col gap-4">
        <Field label="Name">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Frequency">
          <Select
            value={frequency}
            onChange={setFrequency}
            className="h-control w-full"
            aria-label="Frequency"
          >
            {FREQUENCIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Next date">
          <Day value={nextDate} onChange={setPicked} clearable={false} />
        </Field>
        <Field label="End date">
          <Day
            value={endDate}
            onChange={setEndDate}
            notBefore={nextDate === "" ? null : nextDate}
          />
        </Field>
      </div>
    </Sheet>
  )
}

/// The repeats under a register: what is scheduled, when each is next due and
/// what it last raised. Nothing is drawn while there are none — a register
/// that has never repeated anything has no use for an empty box.
///
/// "Raise due now" is the hourly sweep on demand. It makes drafts only; each
/// still goes through Approve and Post like a keyed one.
function RepeatingSection({ kind }: { kind: ComposeKind }) {
  const client = useQueryClient()
  const supplierName = useSupplierName()
  const navigate = useNavigate()
  const direction = kind === "BKK" ? "OUT" : "IN"
  const [editing, setEditing] = useState<RepeatDraft | null>(null)
  /// The drafts the sweep raised, held in the receipt dialog until read.
  const [raised, setRaised] = useState<string | null>(null)
  /// The repeat the sheet saved, held in the receipt dialog until it is read.
  const [savedRepeat, setSavedRepeat] = useState<{
    title: string
    note: string
  } | null>(null)

  const repeats = useQuery({
    queryKey: financeReportKeys.cashRepeats(direction),
    queryFn: ({ signal }) => listCashDocumentRepeats(direction, signal),
  })

  const invalidate = () => {
    void client.invalidateQueries({
      queryKey: financeReportKeys.cashRepeatsAll(),
    })
  }

  const raise = useMutation({
    mutationFn: runCashDocumentRepeats,
    onSuccess: (sweep) => {
      invalidate()
      // The drafts it made belong to the register above.
      void client.invalidateQueries({
        queryKey: [...financeKeys.all, "cash-documents"],
      })
      if (sweep.drafted === 0 && sweep.failed.length === 0) {
        toast("Nothing is due.")
        return
      }
      if (sweep.drafted > 0) {
        setRaised(
          `${count(sweep.drafted)} ${sweep.drafted === 1 ? "draft" : "drafts"} raised`
        )
      }
      if (sweep.failed.length > 0) {
        toast.error(`${count(sweep.failed.length)} could not be raised`, {
          description: sweep.failed.join(" · "),
        })
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "The sweep failed.")
    },
  })

  const toggle = useMutation({
    mutationFn: (repeat: CashDocumentRepeat) =>
      saveCashDocumentRepeat({
        repeat_id: repeat.repeat_id,
        name: repeat.name,
        voucher: repeat.voucher,
        frequency: repeat.frequency,
        next_date: repeat.next_date,
        end_date: repeat.end_date,
        is_active: !repeat.is_active,
      }),
    onSuccess: invalidate,
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "The repeat was not saved."
      )
    },
  })

  const rows = repeats.data ?? []
  const phone = useLayout() === "phone"
  if (rows.length === 0) return null

  const openDocument = (id: string) =>
    void navigate({
      to:
        kind === "BKK"
          ? "/finance/cash-bank/bkk/$id"
          : "/finance/cash-bank/bkm/$id",
      params: { id },
    } as never)

  return (
    <section className="mt-8">
      <SubHead
        aside={
          <Button
            variant="ghost"
            size="sm"
            pending={raise.isPending}
            onClick={() => raise.mutate()}
          >
            Raise due now
          </Button>
        }
      >
        Repeating
      </SubHead>
      {phone ? (
        <PhoneList
          rows={rows.map((repeat) => ({
            key: repeat.repeat_id,
            title: (
              <>
                {repeat.name}
                {!repeat.is_active && (
                  <span className="font-normal text-mute"> · paused</span>
                )}
              </>
            ),
            line:
              kind === "BKK"
                ? supplierName(null, repeat.party_name)
                : repeat.party_name,
            lead: <CardFigure value={money(repeat.amount_minor)} />,
            foot: (
              <span className="flex flex-col">
                <span>
                  {frequencyLabel(repeat.frequency)} · next{" "}
                  {day(repeat.next_date)}
                </span>
                {repeat.last_error !== null && (
                  <span className="text-warn-fg">{repeat.last_error}</span>
                )}
              </span>
            ),
            action: (
              <Button
                size="card"
                variant="tint"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(repeat)}
              >
                {repeat.is_active ? "Pause" : "Resume"}
              </Button>
            ),
            onOpen: () => setEditing(repeatDraftFrom(repeat)),
          }))}
        />
      ) : (
        <Card className="overflow-hidden">
          <Grid>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>{termsFor(kind).party}</Th>
                <Th align="right" width="9.5rem">
                  Amount
                </Th>
                <Th width="7rem">Every</Th>
                <Th width="7rem">Next</Th>
                <Th width="11rem">Last raised</Th>
                <Th width="10rem" />
              </tr>
            </thead>
            <tbody>
              {rows.map((repeat) => (
                <tr key={repeat.repeat_id}>
                  <Td className="max-w-0">
                    <span
                      className={
                        repeat.is_active
                          ? "block truncate text-ink"
                          : "block truncate text-mute"
                      }
                    >
                      {repeat.name}
                      {!repeat.is_active && " · paused"}
                    </span>
                    {repeat.last_error !== null && (
                      <span
                        className="block truncate text-[0.9375rem] text-warn-fg"
                        title={repeat.last_error}
                      >
                        {repeat.last_error}
                      </span>
                    )}
                  </Td>
                  <Td className="max-w-0">
                    <span className="block truncate">
                      {kind === "BKK"
                        ? supplierName(null, repeat.party_name)
                        : repeat.party_name}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="font-medium text-ink">
                      {money(repeat.amount_minor)}
                    </span>
                  </Td>
                  <Td className="text-mute">
                    {frequencyLabel(repeat.frequency)}
                  </Td>
                  <Td>{day(repeat.next_date)}</Td>
                  <Td>
                    {repeat.last_document_id !== null &&
                    repeat.last_document_number !== null ? (
                      <button
                        type="button"
                        onClick={() =>
                          openDocument(repeat.last_document_id ?? "")
                        }
                        className="font-mono text-[0.9375rem] text-accent hover:underline"
                      >
                        {repeat.last_document_number}
                      </button>
                    ) : repeat.last_document_id !== null ? (
                      // Raised and not yet approved: a draft has no number.
                      <button
                        type="button"
                        onClick={() =>
                          openDocument(repeat.last_document_id ?? "")
                        }
                        className="text-accent hover:underline"
                      >
                        Draft
                      </button>
                    ) : (
                      <span className="text-mute">—</span>
                    )}
                  </Td>
                  <Td align="right">
                    <span className="inline-flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(repeatDraftFrom(repeat))}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate(repeat)}
                      >
                        {repeat.is_active ? "Pause" : "Resume"}
                      </Button>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Grid>
        </Card>
      )}
      {editing !== null && (
        <RepeatSheet
          kind={kind}
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={setSavedRepeat}
        />
      )}
      <SavedDialog
        open={savedRepeat !== null}
        onOpenChange={(next) => {
          if (!next) setSavedRepeat(null)
        }}
        title={savedRepeat?.title ?? ""}
      >
        {savedRepeat?.note}
      </SavedDialog>
      <SavedDialog
        open={raised !== null}
        onOpenChange={(next) => {
          if (!next) setRaised(null)
        }}
        title={raised ?? ""}
      >
        To approve and post
      </SavedDialog>
    </section>
  )
}

// ---------------------------------------------------------------------------
// The printed slip
// ---------------------------------------------------------------------------

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .cashdoc-print, .cashdoc-print * { visibility: visible !important; }
  .cashdoc-print {
    position: absolute !important;
    left: 0; top: 0; right: 0;
    padding: 0 !important;
    margin: 0 !important;
    box-shadow: none !important;
    border: 0 !important;
  }
  .cashdoc-noprint { display: none !important; }
  @page { margin: 14mm; }
}
`

function SlipPanel({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const slip = useQuery({
    queryKey: cashDocumentKeys.slip(id ?? ""),
    queryFn: ({ signal }) => cashDocumentSlip(id ?? "", signal),
    enabled: id !== null,
  })

  return (
    <Panel
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      title={slip.data?.number ?? "Slip"}
      sub="An Indonesian slip, ready to print."
    >
      <style>{PRINT_CSS}</style>
      <div className="cashdoc-noprint mb-4 flex justify-end">
        <Button variant="primary" onClick={() => window.print()}>
          <Printer className="size-3.5" />
          Print
        </Button>
      </div>
      {queryState(slip, {
        loading: "Reading the slip…",
        render: (s) => <SlipDocument slip={s} />,
      })}
    </Panel>
  )
}

function SlipField({
  label: fieldLabel,
  children,
  wide,
}: {
  label: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={wide ? "col-span-2 min-w-0" : "min-w-0"}>
      <div className="text-[0.9375rem] tracking-[0.06em] text-mute uppercase">
        {fieldLabel}
      </div>
      <div className="mt-0.5 border-b border-dotted border-hairline-2 pb-0.5 text-[0.9375rem] text-ink">
        {children}
      </div>
    </div>
  )
}

function SlipDocument({ slip }: { slip: CashDocumentSlip }) {
  const supplierName = useSupplierName()
  const out = slip.title.includes("KELUAR")
  const into = slip.title.includes("MASUK")
  const partyLabel = out ? "Paid to" : into ? "Received from" : "Party"
  return (
    <div className="cashdoc-print bg-canvas text-ink">
      <div className="flex items-start justify-between gap-6 border-b-2 border-ink pb-2">
        <div className="min-w-0">
          <div className="text-[0.9375rem] font-semibold tracking-[0.04em] text-ink uppercase">
            {slip.company_name || "—"}
          </div>
          <div className="text-[0.9375rem] text-body">
            {slip.company_address}
          </div>
          <div className="text-[0.9375rem] text-body">{slip.company_phone}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[0.9375rem] font-semibold tracking-[0.06em] text-ink uppercase">
            {slip.title}
          </div>
          <div className="mt-0.5 text-[0.9375rem] text-body">
            <span className="font-mono">{slip.number ?? "—"}</span> ·{" "}
            {day(slip.doc_date)}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
        <SlipField label={partyLabel} wide>
          {out ? supplierName(null, slip.party_name) : slip.party_name}
        </SlipField>
        <SlipField label="Amount">{money(slip.amount_minor)}</SlipField>
        {slip.memo !== "" && (
          <SlipField label="For" wide>
            {slip.memo}
          </SlipField>
        )}
      </div>

      <div className="mt-3 border border-hairline bg-soft px-3 py-2">
        <div className="text-[0.9375rem] tracking-[0.06em] text-mute uppercase">
          Terbilang
        </div>
        <div className="mt-0.5 text-[0.9375rem] leading-snug text-ink italic">
          # {slip.amount_in_words} #
        </div>
      </div>

      <table className="mt-4 w-full border-collapse text-[0.9375rem]">
        <thead>
          <tr className="border-y border-ink">
            <th className="py-1 text-left tracking-[0.06em] text-mute uppercase">
              Account
            </th>
            <th className="py-1 text-left tracking-[0.06em] text-mute uppercase">
              Code
            </th>
            <th className="py-1 text-right tracking-[0.06em] text-mute uppercase">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {/* Debited where the money went, then credited where it came from —
              the poster's own order (`cash_document_post_in`). */}
          <tr className="border-b border-hairline">
            <td className="py-1 text-ink">
              {slip.to.account_name}
              {slip.to.category_name !== null && ` · ${slip.to.category_name}`}
            </td>
            <td className="py-1 font-mono text-[0.9375rem] text-body">
              {slip.to.account_code}
            </td>
            <td className="py-1 text-right text-ink tabular-nums">
              {money(slip.amount_minor)}
            </td>
          </tr>
          <tr>
            <td className="py-1 text-ink">
              {slip.from.account_name}
              {slip.from.category_name !== null &&
                ` · ${slip.from.category_name}`}
            </td>
            <td className="py-1 font-mono text-[0.9375rem] text-body">
              {slip.from.account_code}
            </td>
            <td className="py-1 text-right text-ink tabular-nums">
              {money(slip.amount_minor)}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-8 grid grid-cols-3 gap-6">
        {(
          [
            ["Prepared by", slip.prepared_by],
            ["Checked by", slip.checked_by],
            ["Approved by", slip.approved_by],
          ] as const
        ).map(([role, name]) => (
          <div key={role} className="text-center">
            <div className="text-[0.9375rem] text-body">{role}</div>
            <div className="mt-10 border-t border-ink pt-1 text-[0.9375rem] text-mute">
              {name ?? "name & date"}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/// `terbilang()` in `lib/terbilang.ts` divides its argument by 100, on the
/// assumption that "minor" means cents. Every amount on this wire is already
/// whole rupiah — `money()` in `lib/format.ts` says so, and so does the
/// server's own `rupiah_in_words` — so multiplying back by 100 here recovers
/// the correct words without touching that shared file, which
/// `giro-print.tsx`'s calibration swatch also calls directly and carries the
/// same mismatch.
function rupiahWords(amountMinor: number): string {
  return terbilang(amountMinor * 100)
}

// ---------------------------------------------------------------------------
// The Klasik compose form — design 1 of the prototype
// ---------------------------------------------------------------------------

interface KlasikSettleRow {
  readonly picked: boolean
  readonly discount: string
  readonly amount: string
}
const BLANK_SETTLE_ROW: KlasikSettleRow = {
  picked: false,
  discount: "",
  amount: "",
}

interface KlasikOffsetRow {
  readonly picked: boolean
  readonly amount: string
}
const BLANK_OFFSET_ROW: KlasikOffsetRow = { picked: false, amount: "" }

interface KlasikOtherRow {
  readonly account: AccountChoice | null
  readonly note: string
  readonly amount: string
}
const BLANK_OTHER_ROW: KlasikOtherRow = { account: null, note: "", amount: "" }

/// Days a bill is past its due date (positive) or still has (negative), as the
/// prototype's `dueTag` reads it.
function dueTag(iso: string | null): { text: string; late: boolean } | null {
  if (iso === null) return null
  const days = Math.round(
    (Date.parse(todayIso()) - Date.parse(iso)) / (24 * 60 * 60 * 1000)
  )
  if (days > 0) return { text: `${days} d late`, late: true }
  if (days === 0) return { text: "due today", late: true }
  return { text: `in ${-days} d`, late: false }
}

function KlasikForm({ kind }: { kind: ComposeKind }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const phone = useLayout() === "phone"
  const T = termsFor(kind)

  const [docDate, setDocDate] = useState(todayIso)
  const [unit, setUnit] = useState("")
  const [moneyValue, setMoneyValue] = useState("")
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  const [refundFor, setRefundFor] = useState("")
  // `code` is what bills, advances and payments name the supplier by — the
  // register's own id is only for the picker.
  const [supplier, setSupplier] = useState<{
    supplier_id: string
    name: string
    legal_form: string | null
    code: string
  } | null>(null)
  const [customerName, setCustomerName] = useState("")
  const [method, setMethod] = useState<"cash" | "transfer" | "giro">("transfer")
  const [giroNumber, setGiroNumber] = useState("")
  const [giroBank, setGiroBank] = useState("")
  const [giroDueDate, setGiroDueDate] = useState("")

  const [tab, setTab] = useState<"settle" | "other" | "offset">(
    kind === "BKK" ? "settle" : "other"
  )
  const [browsingBills, setBrowsingBills] = useState(false)
  const [billFilter, setBillFilter] = useState("")
  const [settle, setSettle] = useState<Record<string, KlasikSettleRow>>({})
  const [offset, setOffset] = useState<Record<string, KlasikOffsetRow>>({})
  const [otherRows, setOtherRows] = useState<KlasikOtherRow[]>([
    BLANK_OTHER_ROW,
  ])

  const [tried, setTried] = useState(false)
  const [key, setKey] = useState(idempotencyKey)

  const partyName =
    kind === "BKK"
      ? supplier === null
        ? ""
        : withLegalForm(supplier.name, supplier.legal_form)
      : customerName

  const moneyAccounts = useMoneyAccounts(unit)
  const moneyCodes = useMemo(
    () => new Set(moneyAccounts.map((row) => row.account_code)),
    [moneyAccounts]
  )
  const chosenMoneyAccount =
    moneyValue === ""
      ? null
      : (moneyAccounts.find((row) => moneyAccountValue(row) === moneyValue) ??
        null)

  // Settle: the supplier's posted bills with something still owed.
  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({}, signal).then((page) => page.rows),
    enabled: kind === "BKK" && supplier !== null,
    staleTime: 60_000,
  })
  const supplierBills = useMemo(() => {
    if (kind !== "BKK" || supplier === null) return []
    return (bills.data ?? [])
      .filter(
        (bill) =>
          bill.supplier_id === supplier.code &&
          bill.status === "POSTED" &&
          bill.outstanding_minor > 0
      )
      .sort((a, b) =>
        (a.next_due_date ?? a.due_date ?? "").localeCompare(
          b.next_due_date ?? b.due_date ?? ""
        )
      )
  }, [bills.data, kind, supplier])
  const supplierOpenMinor = useMemo(
    () => supplierBills.reduce((sum, bill) => sum + bill.outstanding_minor, 0),
    [supplierBills]
  )
  const shownBills = useMemo(() => {
    const needle = billFilter.trim().toLowerCase()
    if (needle === "") return supplierBills
    return supplierBills.filter((bill) =>
      bill.invoice_number.toLowerCase().includes(needle)
    )
  }, [supplierBills, billFilter])
  const settleRow = (id: string): KlasikSettleRow =>
    settle[id] ?? BLANK_SETTLE_ROW
  const updateSettle = (id: string, patch: Partial<KlasikSettleRow>) =>
    setSettle((was) => ({ ...was, [id]: { ...settleRow(id), ...patch } }))
  const toggleSettle = (bill: SupplierBill, on: boolean) =>
    updateSettle(bill.invoice_id, {
      picked: on,
      amount: on ? String(bill.outstanding_minor) : "",
      discount: on ? settleRow(bill.invoice_id).discount : "",
    })
  const settlePicked = Object.entries(settle).filter(([, row]) => row.picked)
  const settleTotal = settlePicked.reduce(
    (sum, [, row]) => sum + (parseMinor(row.amount) ?? 0),
    0
  )
  const settleDiscountTotal = settlePicked.reduce(
    (sum, [, row]) => sum + (parseMinor(row.discount) ?? 0),
    0
  )
  const overSettled = supplierBills.filter((bill) => {
    const row = settleRow(bill.invoice_id)
    return row.picked && (parseMinor(row.amount) ?? 0) > bill.outstanding_minor
  })

  // Offset: the advances already paid to this supplier.
  const advances = useQuery({
    queryKey: [...financeKeys.all, "supplier-advances", supplier?.code ?? ""],
    queryFn: ({ signal }) =>
      openAdvances(supplier?.code ?? "", signal).then((rows) =>
        rows.filter(
          (row) => row.status === "POSTED" && row.outstanding_minor > 0
        )
      ),
    enabled: kind === "BKK" && supplier !== null,
    staleTime: 60_000,
  })
  const offsetRow = (id: string): KlasikOffsetRow =>
    offset[id] ?? BLANK_OFFSET_ROW
  const updateOffset = (id: string, patch: Partial<KlasikOffsetRow>) =>
    setOffset((was) => ({ ...was, [id]: { ...offsetRow(id), ...patch } }))
  const offsetPicked = Object.entries(offset).filter(([, row]) => row.picked)
  const offsetTotal = offsetPicked.reduce(
    (sum, [, row]) => sum + (parseMinor(row.amount) ?? 0),
    0
  )

  // Other lines.
  const updateOtherRow = (index: number, patch: Partial<KlasikOtherRow>) =>
    setOtherRows((was) =>
      was.map((row, at) => (at === index ? { ...row, ...patch } : row))
    )
  const otherTotal = otherRows.reduce(
    (sum, row) => sum + (parseMinor(row.amount) ?? 0),
    0
  )
  const otherLineCount = otherRows.filter(
    (row) => row.account !== null && (parseMinor(row.amount) ?? 0) > 0
  ).length

  const total = settleTotal - settleDiscountTotal + otherTotal - offsetTotal

  const buildDraft = (): CashDocumentDraft => {
    const parsedMoney =
      moneyValue === ""
        ? { account_key: "", account_qualifier: "" }
        : parseMoneyAccountValue(moneyValue)
    return {
      kind,
      docDate,
      unitId: unit,
      partyType: kind === "BKK" ? "SUPPLIER" : "OTHER",
      supplierId: kind === "BKK" ? (supplier?.code ?? null) : null,
      employeeId: null,
      partyName,
      moneyKey: parsedMoney.account_key,
      moneyQualifier: parsedMoney.account_qualifier,
      method,
      giro: { number: giroNumber, drawnOn: giroBank, dueDate: giroDueDate },
      reference,
      otherLines: otherRows.map((row) => ({
        accountCode: row.account?.account_code ?? "",
        categoryCode: row.account?.category_code ?? null,
        note: row.note,
        amountMinor: row.amount.trim() === "" ? null : parseMinor(row.amount),
      })),
      settleLines: settlePicked.map(([invoiceId, row]) => ({
        invoiceId,
        discountMinor:
          row.discount.trim() === "" ? null : parseMinor(row.discount),
        amountMinor: row.amount.trim() === "" ? null : parseMinor(row.amount),
      })),
      offsetLines: offsetPicked.map(([advanceId, row]) => ({
        advanceId,
        amountMinor: row.amount.trim() === "" ? null : parseMinor(row.amount),
      })),
      memo: note,
    }
  }

  // Over-settling is refused as it is typed; what is merely missing is said
  // once somebody tries to save (the prototype's `problems()`).
  const problems: string[] = []
  if (unit === "") problems.push("choose a unit")
  if (moneyValue === "") problems.push("choose the cash or bank account")
  if (partyName.trim() === "")
    problems.push(
      kind === "BKK" ? "choose a supplier" : "name who the money is from"
    )
  if (method === "giro") {
    if (giroNumber.trim() === "") problems.push("a giro needs its number")
    if (giroDueDate === "") problems.push("a giro needs its due date")
    if (kind === "BKM" && giroBank.trim() === "")
      problems.push("which bank the giro is drawn on")
  }
  if (note.trim() === "")
    problems.push("add a note — it is printed on the slip")
  for (const bill of overSettled)
    problems.push(
      `${bill.invoice_number}: more than the ${money(bill.outstanding_minor)} still open`
    )
  if (total <= 0)
    problems.push(
      kind === "BKK"
        ? "nothing to pay yet — settle a bill or add a line"
        : "nothing to receive yet — add a line"
    )

  const record = useMutation({
    mutationFn: () => recordVoucher(buildVoucherRequest(buildDraft()), key),
    onSuccess: async (saved) => {
      setKey(idempotencyKey())
      // Money back from a supplier for a return: record it on that return.
      if (kind === "BKM" && refundFor !== "") {
        await recordSettlement(refundFor, {
          kind: "REFUND",
          amount_minor: total,
          reference: saved.number,
        })
        void client.invalidateQueries({ queryKey: supplierReturnKeys.all })
      }
      void client.invalidateQueries({ queryKey: financeKeys.all })
      void navigate({
        to:
          kind === "BKK"
            ? "/finance/cash-bank/bkk/$id"
            : "/finance/cash-bank/bkm/$id",
        params: { id: saved.document_id },
      } as never)
    },
  })

  const trySave = () => {
    setTried(true)
    if (problems.length > 0) return
    record.mutate()
  }

  const tabLabel = (base: string, n: number) => (
    <>
      {base}
      <span className="ml-1.5 text-mute tabular-nums">{n}</span>
    </>
  )

  return (
    <PageContent>
      {/* A phone has Back in its top bar, and "Save draft" is the last thing
          on the page, under the lines it saves. */}
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Payments"
        title={`New ${kind}`}
        actions={
          <>
            <BackToList kind={kind} />
            <Button
              variant="primary"
              pending={record.isPending}
              onClick={trySave}
            >
              {record.isPending ? "Saving…" : "Save draft"}
            </Button>
          </>
        }
      />

      <div className="flex max-w-6xl flex-col gap-4">
        {record.isError && (
          <Banner tone="bad">
            {record.error instanceof Error
              ? record.error.message
              : "The document was refused."}
          </Banner>
        )}
        {tried && problems.length > 0 && (
          <Banner tone="bad">{problems.join(" · ")}</Banner>
        )}

        <Card className="grid overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_19rem]">
          <div className="flex flex-col gap-4 p-5">
            <Field label="Voucher no">
              <Input value="" disabled className="font-mono" />
            </Field>
            <Field label="Date" required>
              <Day value={docDate} onChange={setDocDate} />
            </Field>
            <MoneySideField
              kind={kind}
              unit={unit}
              value={moneyValue}
              onChange={setMoneyValue}
              label="Cash / bank"
            />
            <Field label="Reference">
              <Input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            </Field>
          </div>

          <div className="flex flex-col gap-4 p-5 lg:pl-0">
            <Field label="Unit" required>
              <UnitSelect
                value={unit}
                onChange={(next) => {
                  setUnit(next)
                  setMoneyValue("")
                }}
                emptyLabel="Choose a unit"
              />
            </Field>
            {kind === "BKK" ? (
              <Field label={T.party} required>
                <SupplierPicker
                  value={supplier?.supplier_id ?? ""}
                  onPick={(next) => {
                    setSupplier(
                      next === null
                        ? null
                        : {
                            supplier_id: next.supplier_id,
                            name: next.name,
                            legal_form: next.legal_form,
                            code: next.supplier_code,
                          }
                    )
                    setSettle({})
                    setOffset({})
                  }}
                  label={T.party}
                />
                {supplier !== null && (
                  <span className="mt-1 block text-[0.9375rem] text-mute tabular-nums">
                    {money(supplierOpenMinor)} open
                  </span>
                )}
              </Field>
            ) : (
              <Field label={T.party} required>
                <Input
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                />
              </Field>
            )}
            <Field label="Paid by">
              <Segmented
                options={[
                  { value: "cash" as const, label: "Cash" },
                  { value: "transfer" as const, label: "Transfer" },
                  { value: "giro" as const, label: "Giro" },
                ]}
                value={method}
                onChange={setMethod}
              />
            </Field>
            {method === "giro" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Giro no" required>
                  <Input
                    value={giroNumber}
                    onChange={(event) => setGiroNumber(event.target.value)}
                    className="font-mono"
                  />
                </Field>
                <Field label="Due" required>
                  <Day
                    value={giroDueDate}
                    onChange={setGiroDueDate}
                    notBefore={docDate}
                  />
                </Field>
                {kind === "BKM" ? (
                  <Field label="Drawn on" required>
                    <Input
                      value={giroBank}
                      onChange={(event) => setGiroBank(event.target.value)}
                    />
                  </Field>
                ) : (
                  <Field label="Drawn on">
                    <Input
                      value={chosenMoneyAccount?.account_qualifier ?? ""}
                      disabled
                    />
                  </Field>
                )}
              </div>
            )}
            <Field label="Note" required>
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            {kind === "BKM" && (
              <ReturnPicker
                label="Refund for return"
                kind="REFUND"
                value={refundFor}
                onChange={setRefundFor}
              />
            )}
          </div>

          <div className="flex flex-col border-t border-hairline p-5 max-md:order-first max-md:border-t-0 max-md:border-b lg:border-t-0 lg:border-l">
            <span className="text-[0.9375rem] text-mute">{T.amountLabel}</span>
            <span className="mt-1 text-[2rem] leading-tight font-semibold text-ink tabular-nums">
              {money(total)}
            </span>
            <span className="mt-1 text-[0.9375rem] text-body italic first-letter:uppercase">
              {total > 0 ? rupiahWords(total) : "—"}
            </span>
            <dl className="mt-4 flex flex-col gap-1.5 border-t border-hairline pt-3 text-[0.9375rem]">
              <div className="flex justify-between gap-3">
                <dt className="text-mute">{T.settle}</dt>
                <dd className="text-ink tabular-nums">{money(settleTotal)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-mute">Discount given</dt>
                <dd className="text-ink tabular-nums">
                  {settleDiscountTotal > 0
                    ? money(-settleDiscountTotal)
                    : money(0)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-mute">Other lines</dt>
                <dd className="text-ink tabular-nums">{money(otherTotal)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-mute">{T.offset}</dt>
                <dd className="text-ink tabular-nums">
                  {offsetTotal > 0 ? money(-offsetTotal) : money(0)}
                </dd>
              </div>
            </dl>
          </div>
        </Card>

        <div className="flex flex-wrap items-end justify-between gap-2">
          <SubTabs
            value={tab}
            onChange={(next) => setTab(next as typeof tab)}
            className="mb-0"
            tabs={[
              {
                value: "settle",
                label: tabLabel(T.settle, settlePicked.length),
                short: T.settle,
              },
              {
                value: "other",
                label: tabLabel("Other lines", otherLineCount),
                short: "Other lines",
              },
              {
                value: "offset",
                label: tabLabel(T.offset, offsetPicked.length),
                short: T.offset,
              },
            ]}
          />
          <div className="flex items-center gap-2 pb-1.5">
            <Button
              size="sm"
              variant="soft"
              disabled={kind !== "BKK" || supplier === null}
              onClick={() => {
                setTab("settle")
                setBrowsingBills((was) => !was)
              }}
            >
              Browse open {T.invWord}s
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled
              title="From the Giro board"
            >
              Replace a bounced giro
            </Button>
          </div>
        </div>

        {tab === "settle" &&
          (kind === "BKM" || supplier === null ? (
            <Card>
              <EmptyState>
                {kind === "BKM"
                  ? "No open invoices to settle. Money that isn't for an invoice goes on Other lines."
                  : "Choose a supplier to see their open bills."}
              </EmptyState>
            </Card>
          ) : bills.isPending ? (
            <Card>
              <EmptyState>Reading the bills…</EmptyState>
            </Card>
          ) : supplierBills.length === 0 ? (
            <Card>
              <EmptyState>
                {supplier.name} has nothing open to settle. Money to them that
                isn't for a bill goes on Other lines.
              </EmptyState>
            </Card>
          ) : (
            <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
              {browsingBills && (
                <div className="border-b border-hairline p-3 max-md:border-0 max-md:px-0">
                  <Input
                    value={billFilter}
                    onChange={(event) => setBillFilter(event.target.value)}
                    aria-label={`Find a ${T.invWord}`}
                    placeholder={`Find a ${T.invWord}`}
                    className="h-control max-w-xs"
                  />
                </div>
              )}
              {phone ? (
                <>
                  <ul className="flex flex-col gap-2.5">
                    {shownBills.map((bill) => {
                      const row = settleRow(bill.invoice_id)
                      const typed =
                        row.amount.trim() === "" ? null : parseMinor(row.amount)
                      const over =
                        typed !== null && typed > bill.outstanding_minor
                      const due = dueTag(bill.next_due_date ?? bill.due_date)
                      return (
                        <li
                          key={bill.invoice_id}
                          className="flex flex-col gap-3 rounded-card border border-hairline bg-canvas p-4 shadow-soft"
                        >
                          <label className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-1 size-5 shrink-0"
                              checked={row.picked}
                              onChange={(event) =>
                                toggleSettle(bill, event.target.checked)
                              }
                              aria-label={`Settle ${bill.invoice_number}`}
                            />
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="font-mono text-card-title font-semibold break-words text-ink">
                                {bill.invoice_number}
                              </span>
                              <span className="text-[0.9375rem] text-mute">
                                Due {day(bill.next_due_date ?? bill.due_date)}
                                {due !== null && (
                                  <span
                                    className={
                                      due.late ? "text-bad-fg" : undefined
                                    }
                                  >
                                    {" · "}
                                    {due.text}
                                  </span>
                                )}
                              </span>
                              {bill.note !== null && bill.note !== "" && (
                                <span className="text-[0.9375rem] text-mute">
                                  Ref {bill.note}
                                </span>
                              )}
                            </span>
                            <CardFigure
                              value={money(bill.outstanding_minor)}
                              caption={T.open}
                            />
                          </label>
                          <div className="grid grid-cols-2 gap-3 border-t border-hairline pt-3">
                            <Field label="Discount">
                              <Money
                                value={row.discount}
                                onChange={(next) =>
                                  updateSettle(bill.invoice_id, {
                                    discount: next,
                                  })
                                }
                                disabled={!row.picked}
                                label={`Discount on ${bill.invoice_number}`}
                              />
                            </Field>
                            <Field label={T.col}>
                              <Money
                                value={row.amount}
                                onChange={(next) =>
                                  updateSettle(bill.invoice_id, {
                                    amount: next,
                                    picked: true,
                                  })
                                }
                                invalid={over}
                                label={`${T.col} on ${bill.invoice_number}`}
                              />
                            </Field>
                          </div>
                          <label className="flex items-center gap-3 text-[0.9375rem] text-ink">
                            <input
                              type="checkbox"
                              className="size-5 shrink-0"
                              checked={
                                row.picked && typed === bill.outstanding_minor
                              }
                              onChange={(event) =>
                                event.target.checked
                                  ? toggleSettle(bill, true)
                                  : updateSettle(bill.invoice_id, {
                                      amount: "",
                                    })
                              }
                              aria-label={`${bill.invoice_number} in full`}
                            />
                            In full
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                  <p className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 px-1 text-[0.9375rem] font-medium text-ink tabular-nums">
                    <span>
                      {count(settlePicked.length)} of {count(shownBills.length)}{" "}
                      selected
                    </span>
                    <span>{money(settleTotal)}</span>
                  </p>
                </>
              ) : (
                <Grid>
                  <thead>
                    <tr>
                      <Th width="2.75rem" />
                      <Th>Bill</Th>
                      <Th width="10rem">Due</Th>
                      <Th align="right" width="9rem">
                        {T.open}
                      </Th>
                      <Th width="8rem">Ref</Th>
                      <Th align="right" width="8.5rem">
                        Discount
                      </Th>
                      <Th align="right" width="9.5rem">
                        {T.col}
                      </Th>
                      <Th width="4.5rem">In full</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownBills.map((bill) => {
                      const row = settleRow(bill.invoice_id)
                      const typed =
                        row.amount.trim() === "" ? null : parseMinor(row.amount)
                      const over =
                        typed !== null && typed > bill.outstanding_minor
                      const due = dueTag(bill.next_due_date ?? bill.due_date)
                      return (
                        <tr
                          key={bill.invoice_id}
                          className={row.picked ? "" : "text-mute"}
                        >
                          <Td>
                            <input
                              type="checkbox"
                              checked={row.picked}
                              onChange={(event) =>
                                toggleSettle(bill, event.target.checked)
                              }
                              aria-label={`Settle ${bill.invoice_number}`}
                            />
                          </Td>
                          <Td>
                            <span className="font-mono text-[0.9375rem] text-ink">
                              {bill.invoice_number}
                            </span>
                          </Td>
                          <Td>
                            {day(bill.next_due_date ?? bill.due_date)}
                            {due !== null && (
                              <span
                                className={
                                  due.late
                                    ? "ml-1.5 text-bad-fg"
                                    : "ml-1.5 text-mute"
                                }
                              >
                                {due.text}
                              </span>
                            )}
                          </Td>
                          <Td align="right">{money(bill.outstanding_minor)}</Td>
                          <Td>
                            <span className="block truncate text-mute">
                              {bill.note ?? "—"}
                            </span>
                          </Td>
                          <Td align="right">
                            <Money
                              value={row.discount}
                              onChange={(next) =>
                                updateSettle(bill.invoice_id, {
                                  discount: next,
                                })
                              }
                              disabled={!row.picked}
                              className="h-8"
                              label={`Discount on ${bill.invoice_number}`}
                            />
                          </Td>
                          <Td align="right">
                            <Money
                              value={row.amount}
                              onChange={(next) =>
                                updateSettle(bill.invoice_id, {
                                  amount: next,
                                  picked: true,
                                })
                              }
                              invalid={over}
                              className="h-8"
                              label={`${T.col} on ${bill.invoice_number}`}
                            />
                          </Td>
                          <Td>
                            <input
                              type="checkbox"
                              checked={
                                row.picked && typed === bill.outstanding_minor
                              }
                              onChange={(event) =>
                                event.target.checked
                                  ? toggleSettle(bill, true)
                                  : updateSettle(bill.invoice_id, {
                                      amount: "",
                                    })
                              }
                              aria-label={`${bill.invoice_number} in full`}
                            />
                          </Td>
                        </tr>
                      )
                    })}
                    <TotalRow>
                      <Td />
                      <Td>
                        {count(settlePicked.length)} of{" "}
                        {count(shownBills.length)} selected
                      </Td>
                      <Td />
                      <Td align="right">
                        {money(
                          settlePicked.reduce(
                            (sum, [id]) =>
                              sum +
                              (supplierBills.find(
                                (bill) => bill.invoice_id === id
                              )?.outstanding_minor ?? 0),
                            0
                          )
                        )}
                      </Td>
                      <Td />
                      <Td align="right">{money(settleDiscountTotal)}</Td>
                      <Td align="right">{money(settleTotal)}</Td>
                      <Td />
                    </TotalRow>
                  </tbody>
                </Grid>
              )}
            </Card>
          ))}

        {tab === "other" && (
          <Card className="overflow-hidden">
            <Grid>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th>Note</Th>
                  <Th align="right" width="10rem">
                    Amount
                  </Th>
                  <Th width="2.75rem" />
                </tr>
              </thead>
              <tbody>
                {otherRows.map((row, index) => (
                  <tr key={index}>
                    <Td>
                      <AccountAndCategory
                        value={row.account}
                        onChange={(next) =>
                          updateOtherRow(index, { account: next })
                        }
                        categoryLabel={`Category on row ${index + 1}`}
                        accept={(account) =>
                          moneyCodes.has(account.account_code)
                            ? "this is a cash or bank account — choose it above instead"
                            : null
                        }
                      />
                    </Td>
                    <Td>
                      <Input
                        value={row.note}
                        onChange={(event) =>
                          updateOtherRow(index, { note: event.target.value })
                        }
                        className="h-8"
                        aria-label={`Note on row ${index + 1}`}
                      />
                    </Td>
                    <Td align="right">
                      <Money
                        value={row.amount}
                        onChange={(next) =>
                          updateOtherRow(index, { amount: next })
                        }
                        className="h-8"
                        label={`Amount on row ${index + 1}`}
                      />
                    </Td>
                    <Td>
                      {otherRows.length > 1 && (
                        <Button
                          size="sm"
                          variant="quiet"
                          aria-label={`Remove row ${index + 1}`}
                          onClick={() =>
                            setOtherRows((was) =>
                              was.filter((_, at) => at !== index)
                            )
                          }
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Grid>
            <div className="border-t border-hairline p-2">
              <Button
                variant="quiet"
                size="sm"
                onClick={() => setOtherRows((was) => [...was, BLANK_OTHER_ROW])}
              >
                <Plus />
                Add a line —{" "}
                {kind === "BKK"
                  ? "bank fees, electricity, supplies"
                  : "interest, other income, a staff repayment"}
              </Button>
            </div>
          </Card>
        )}

        {tab === "offset" &&
          (kind === "BKM" || supplier === null ? (
            <Card>
              <EmptyState>
                {kind === "BKM"
                  ? "Nothing to net off against this customer."
                  : "Choose a supplier to see what they owe back."}
              </EmptyState>
            </Card>
          ) : advances.isPending ? (
            <Card>
              <EmptyState>Reading the advances…</EmptyState>
            </Card>
          ) : (advances.data ?? []).length === 0 ? (
            <Card>
              <EmptyState>
                {supplier.name} has no advance left to net off.
              </EmptyState>
            </Card>
          ) : (
            <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
              <p className="border-b border-hairline px-4 py-3 text-[0.9375rem] text-body max-md:border-0 max-md:px-1 max-md:pt-0">
                Advances already paid to {supplier.name}. Tick one to net it
                against the bills on this BKK — the payment shrinks by the same
                amount.
              </p>
              {phone ? (
                <ul className="flex flex-col gap-2.5">
                  {(advances.data ?? []).map((advance) => {
                    const row = offsetRow(advance.advance_id)
                    const typed =
                      row.amount.trim() === "" ? null : parseMinor(row.amount)
                    return (
                      <li
                        key={advance.advance_id}
                        className="flex flex-col gap-3 rounded-card border border-hairline bg-canvas p-4 shadow-soft"
                      >
                        <label className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 size-5 shrink-0"
                            checked={row.picked}
                            onChange={(event) =>
                              updateOffset(advance.advance_id, {
                                picked: event.target.checked,
                                amount: event.target.checked
                                  ? String(
                                      Math.min(
                                        advance.outstanding_minor,
                                        Math.max(
                                          settleTotal -
                                            settleDiscountTotal -
                                            offsetTotal,
                                          0
                                        )
                                      ) || advance.outstanding_minor
                                    )
                                  : "",
                              })
                            }
                            aria-label={`Net off ${advance.advance_number}`}
                          />
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="font-mono text-card-title font-semibold break-words text-ink">
                              {advance.advance_number}
                            </span>
                            <span className="text-[0.9375rem] text-mute">
                              {day(advance.advance_date)}
                              {advance.po_number !== null &&
                                advance.po_number !== "" && (
                                  <span className="font-mono">
                                    {" · "}
                                    {advance.po_number}
                                  </span>
                                )}
                            </span>
                          </span>
                          <CardFigure
                            value={money(advance.outstanding_minor)}
                            caption="Left"
                          />
                        </label>
                        <div className="border-t border-hairline pt-3">
                          <Field label="Net off">
                            <Money
                              value={row.amount}
                              onChange={(next) =>
                                updateOffset(advance.advance_id, {
                                  amount: next,
                                  picked: true,
                                })
                              }
                              invalid={
                                typed !== null &&
                                typed > advance.outstanding_minor
                              }
                              label={`Net off ${advance.advance_number}`}
                            />
                          </Field>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <Grid>
                  <thead>
                    <tr>
                      <Th width="2.75rem" />
                      <Th>Advance</Th>
                      <Th width="8rem">Date</Th>
                      <Th align="right" width="9rem">
                        Left
                      </Th>
                      <Th width="9rem">Order</Th>
                      <Th align="right" width="10rem">
                        Net off
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(advances.data ?? []).map((advance) => {
                      const row = offsetRow(advance.advance_id)
                      const typed =
                        row.amount.trim() === "" ? null : parseMinor(row.amount)
                      return (
                        <tr
                          key={advance.advance_id}
                          className={row.picked ? "" : "text-mute"}
                        >
                          <Td>
                            <input
                              type="checkbox"
                              checked={row.picked}
                              onChange={(event) =>
                                updateOffset(advance.advance_id, {
                                  picked: event.target.checked,
                                  amount: event.target.checked
                                    ? String(
                                        Math.min(
                                          advance.outstanding_minor,
                                          Math.max(
                                            settleTotal -
                                              settleDiscountTotal -
                                              offsetTotal,
                                            0
                                          )
                                        ) || advance.outstanding_minor
                                      )
                                    : "",
                                })
                              }
                              aria-label={`Net off ${advance.advance_number}`}
                            />
                          </Td>
                          <Td>
                            <span className="font-mono text-[0.9375rem] text-ink">
                              {advance.advance_number}
                            </span>
                          </Td>
                          <Td>{day(advance.advance_date)}</Td>
                          <Td align="right">
                            {money(advance.outstanding_minor)}
                          </Td>
                          <Td>
                            <span className="font-mono text-mute">
                              {advance.po_number}
                            </span>
                          </Td>
                          <Td align="right">
                            <Money
                              value={row.amount}
                              onChange={(next) =>
                                updateOffset(advance.advance_id, {
                                  amount: next,
                                  picked: true,
                                })
                              }
                              invalid={
                                typed !== null &&
                                typed > advance.outstanding_minor
                              }
                              className="h-8"
                              label={`Net off ${advance.advance_number}`}
                            />
                          </Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Grid>
              )}
            </Card>
          ))}

        {phone && (
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            pending={record.isPending}
            onClick={trySave}
          >
            {record.isPending ? "Saving…" : "Save draft"}
          </Button>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-3 text-[0.9375rem] text-mute">
          <span>
            {tried && problems.length === 0
              ? "Ready to save"
              : "Missing fields are pointed out when you save, not before."}
          </span>
          <span>
            Discount posts to Settlement discount —{" "}
            <Link
              to={"/finance/setup/account-links" as never}
              className="text-accent hover:underline"
            >
              change it in Account links
            </Link>
          </span>
        </div>
      </div>
    </PageContent>
  )
}

/// The cash/bank side — "Cash / bank" on the Klasik form.
///
/// Only the meanings `useMoneyAccounts` resolves at this unit are offered, so
/// nobody can choose an account the posting rules have no map for.
function MoneySideField({
  kind,
  unit,
  value,
  onChange,
  label: fieldLabel,
}: {
  kind: ComposeKind
  unit: string
  value: string
  onChange: (value: string) => void
  label?: string
}) {
  const { accounts, pending } = useMoneyAccountChoices(unit)
  const meaningLabel = useMeaningLabel()

  return (
    <Field
      label={fieldLabel ?? (kind === "BKK" ? "Paid from" : "Received into")}
      required
      hint={
        unit === ""
          ? "Choose a unit first."
          : pending
            ? "Reading the accounts…"
            : accounts.length === 0
              ? "No cash or bank meaning is mapped at this unit."
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
            {meaningLabel(row.account_key)}
            {row.account_qualifier === "" ? "" : ` · ${row.account_qualifier}`}
            {` — ${row.account_name}`}
          </option>
        ))}
      </Select>
    </Field>
  )
}
