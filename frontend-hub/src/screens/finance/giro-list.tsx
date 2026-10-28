import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"

import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Day } from "@/components/ui/day"
import { Field, Input, Money, Select, Textarea } from "@/components/ui/field"
import { Status } from "@/components/ui/pill"
import { CellMoney } from "@/components/ui/rows-switch"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Banner, EmptyState } from "@/components/ui/states"
import { Timeline, type TimelineEvent } from "@/components/ui/timeline"
import { Button } from "@/components/ui/button"
import { count, day, money } from "@/lib/format"
import { clearGiro, listPayments } from "@/lib/queries/finance"
import {
  candidateCashDocuments,
  deliverGiro,
  rejectGiro,
  replaceGiro,
  unclearGiro,
} from "@/lib/queries/giros"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"
import { parseMinor, todayIso } from "@/screens/finance/chart"
import {
  giroWord,
  isLate,
  laneOf,
  sumOf,
  type GiroAccount,
} from "@/screens/finance/giro-words"
import { useSupplierName } from "@/screens/finance/hooks"
import { SupplierPicker } from "@/screens/finance/parts"
import type { GiroRow } from "@itulah/contract"

/// The Giro list and Opening giro tables, and the sheets the Giro screen
/// opens: the giro itself with its timeline, and the forms for each move. See
/// `scr-cash2.js` (Cash & Bank › Giro) for the prototype they follow.

/// What the accounts of the Giro screen answer: the account a BG is drawn on,
/// and the books on its due date.
export interface GiroBooks {
  readonly accountOf: (row: GiroRow) => GiroAccount | null
  readonly balanceOf: (row: GiroRow) => number | null
}

const DASH = <span className="text-faint">—</span>

export function BalanceFigure({ value }: { value: number | null }) {
  if (value === null) return DASH
  return (
    <span className={value < 0 ? "text-bad-fg" : undefined}>
      {money(value)}
    </span>
  )
}

function GiroStatus({ row }: { row: GiroRow }) {
  const [word, tone] = giroWord(row)
  return <Status tone={tone}>{word}</Status>
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/// Due · BG no · Supplier · Account · Amount · Status · Balance on due date.
export function GiroListTable({
  rows,
  books,
  onOpen,
}: {
  rows: readonly GiroRow[]
  books: GiroBooks
  onOpen: (row: GiroRow) => void
}) {
  const supplierName = useSupplierName()
  const columns = useMemo<ColumnDef<TableSetup, GiroRow>[]>(
    () => [
      {
        id: "due",
        accessorFn: (row) => row.due_date,
        header: "Due",
        size: 120,
        enableSorting: false,
        meta: { card: "foot", priority: 1 },
        cell: ({ row }) => (
          <span className={isLate(row.original) ? "text-bad-fg" : "text-body"}>
            {day(row.original.due_date)}
          </span>
        ),
      },
      {
        id: "number",
        accessorFn: (row) => row.number,
        header: "BG no",
        size: 120,
        enableSorting: false,
        meta: { card: "id" },
        cell: ({ row }) => (
          <span className="font-mono text-[0.9375rem] text-ink">
            {row.original.number}
          </span>
        ),
      },
      {
        id: "supplier",
        accessorFn: (row) => row.party_name ?? "",
        header: "Supplier",
        size: 240,
        enableSorting: false,
        meta: { card: "title", grow: 220 },
        cell: ({ row }) =>
          row.original.party_name === null ? (
            DASH
          ) : (
            <span className="block truncate text-ink">
              {supplierName(row.original.party_name, row.original.party_name)}
            </span>
          ),
      },
      {
        id: "account",
        accessorFn: (row) => books.accountOf(row)?.name ?? row.bank,
        header: "Account",
        size: 180,
        enableSorting: false,
        meta: { card: "hide", priority: 2 },
        cell: ({ row }) => (
          <span className="block truncate text-body">
            {books.accountOf(row.original)?.name ?? row.original.bank}
          </span>
        ),
      },
      {
        id: "amount",
        accessorFn: (row) => row.amount_minor,
        header: "Amount",
        size: 160,
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
        accessorFn: (row) => giroWord(row)[0],
        header: "Status",
        size: 170,
        enableSorting: false,
        meta: { card: "status" },
        cell: ({ row }) => <GiroStatus row={row.original} />,
      },
      {
        id: "balance",
        accessorFn: (row) => books.balanceOf(row) ?? 0,
        header: "Balance on due date",
        size: 200,
        enableSorting: false,
        meta: { align: "right", card: "hide", priority: 2 },
        cell: ({ row }) => (
          <BalanceFigure value={books.balanceOf(row.original)} />
        ),
      },
    ],
    [supplierName, books]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows as GiroRow[],
        columns,
        getRowId: (row: GiroRow) => row.giro_id,
      }),
      [rows, columns]
    )
  )

  if (rows.length === 0) return <EmptyState>No BG matches</EmptyState>
  return (
    <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
      <DataTable<GiroRow>
        table={table}
        onRowClick={onOpen}
        pageScroll
        cardSort={false}
        cardsApart
        cardLead
        summary={{
          number: `${count(rows.length)} ${rows.length === 1 ? "BG" : "BGs"}`,
          amount: money(sumOf(rows)),
        }}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Opening giro
// ---------------------------------------------------------------------------

/// BG no · Bank · Supplier · Due · Cleared · Amount · Status: the BGs that
/// were still out when the books opened.
export function GiroOpeningTable({
  rows,
  onOpen,
}: {
  rows: readonly GiroRow[]
  onOpen: (row: GiroRow) => void
}) {
  const supplierName = useSupplierName()
  const columns = useMemo<ColumnDef<TableSetup, GiroRow>[]>(
    () => [
      {
        id: "number",
        accessorFn: (row) => row.number,
        header: "BG no",
        size: 130,
        enableSorting: false,
        meta: { card: "id" },
        cell: ({ row }) => (
          <span className="font-mono text-[0.9375rem] text-ink">
            {row.original.number}
          </span>
        ),
      },
      {
        id: "bank",
        accessorFn: (row) => row.bank,
        header: "Bank",
        size: 120,
        enableSorting: false,
        meta: { card: "hide", priority: 2 },
        cell: ({ row }) => (
          <span className="text-body">{row.original.bank}</span>
        ),
      },
      {
        id: "supplier",
        accessorFn: (row) => row.party_name ?? "",
        header: "Supplier",
        size: 240,
        enableSorting: false,
        meta: { card: "title", grow: 220 },
        cell: ({ row }) =>
          row.original.party_name === null ? (
            DASH
          ) : (
            <span className="block truncate text-ink">
              {supplierName(row.original.party_name, row.original.party_name)}
            </span>
          ),
      },
      {
        id: "due",
        accessorFn: (row) => row.due_date,
        header: "Due",
        size: 120,
        enableSorting: false,
        meta: { card: "foot" },
        cell: ({ row }) => (
          <span className={isLate(row.original) ? "text-bad-fg" : "text-body"}>
            {day(row.original.due_date)}
          </span>
        ),
      },
      {
        id: "cleared",
        accessorFn: (row) => row.cleared_on ?? "",
        header: "Cleared",
        size: 120,
        enableSorting: false,
        meta: { card: "hide", priority: 2 },
        cell: ({ row }) =>
          row.original.cleared_on === null
            ? DASH
            : day(row.original.cleared_on),
      },
      {
        id: "amount",
        accessorFn: (row) => row.amount_minor,
        header: "Amount",
        size: 160,
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
        accessorFn: (row) => giroWord(row)[0],
        header: "Status",
        size: 170,
        enableSorting: false,
        meta: { card: "status" },
        cell: ({ row }) => <GiroStatus row={row.original} />,
      },
    ],
    [supplierName]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows as GiroRow[],
        columns,
        getRowId: (row: GiroRow) => row.giro_id,
      }),
      [rows, columns]
    )
  )

  if (rows.length === 0)
    return <EmptyState>No giro was out when the books opened</EmptyState>
  return (
    <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
      <DataTable<GiroRow>
        table={table}
        onRowClick={onOpen}
        pageScroll
        cardSort={false}
        cardsApart
        cardLead
        summary={{
          number: `${count(rows.length)} ${rows.length === 1 ? "BG" : "BGs"}`,
          amount: money(sumOf(rows)),
        }}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The giro sheet
// ---------------------------------------------------------------------------

export type GiroMove = "clear" | "reject" | "unclear" | "replace"

/// The giro, its timeline, and the one next step as the primary.
export function GiroSheet({
  row,
  opening,
  books,
  monthClosed,
  onClose,
  onMove,
}: {
  row: GiroRow | null
  opening: boolean
  books: GiroBooks
  monthClosed: (iso: string | null) => boolean
  onClose: () => void
  onMove: (move: GiroMove, row: GiroRow) => void
}) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const supplierName = useSupplierName()
  const give = useMutation({
    mutationFn: (id: string) => deliverGiro(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["finance", "giros"] })
      onClose()
    },
  })

  if (row === null) {
    return (
      <Sheet open={false} onOpenChange={onClose} title="">
        {null}
      </Sheet>
    )
  }

  const lane = laneOf(row)
  const [word, tone] = giroWord(row)
  const account = books.accountOf(row)
  const balance = books.balanceOf(row)
  const late = isLate(row)
  const supplier =
    row.party_name === null ? "—" : supplierName(row.party_name, row.party_name)
  const bkk = row.cash_document_number ?? row.payment_number
  const short = balance !== null && balance < 0
  const accountName = account?.name ?? row.bank

  const given = lane === "with" || lane === "cleared" || lane === "bounced"
  const steps: TimelineEvent[] = [
    opening
      ? {
          id: "written",
          title: "Saldo Awal BG",
          detail: "Still out when the books opened",
          state: "done",
        }
      : {
          id: "written",
          title: "Written",
          at: day(row.issue_date),
          detail: bkk ?? undefined,
          state: "done",
        },
    ...(opening && !given
      ? []
      : [
          {
            id: "given",
            title: "Given to supplier",
            detail:
              given && row.party_name !== null ? `To ${supplier}` : undefined,
            state: given ? "done" : lane === "written" ? "current" : "todo",
          } satisfies TimelineEvent,
        ]),
    {
      id: "due",
      title: "Due",
      at: day(row.due_date),
      detail:
        balance !== null ? `Balance on due date ${money(balance)}` : undefined,
      state:
        lane === "cleared" || lane === "bounced"
          ? "done"
          : late
            ? "current"
            : "todo",
    },
    lane === "bounced"
      ? {
          id: "end",
          title: "Bounced",
          at: row.rejected_on === null ? undefined : day(row.rejected_on),
          detail: row.rejected_reason ?? undefined,
          state: "done",
        }
      : {
          id: "end",
          title: "Cleared",
          at: row.cleared_on === null ? undefined : day(row.cleared_on),
          detail:
            row.cleared_on === null ? undefined : `${accountName} cleared it`,
          state: lane === "cleared" ? "done" : "todo",
        },
  ]

  const replaced = lane === "bounced" && row.replaced_by !== null
  let primary: React.ReactElement | undefined
  if (lane === "written")
    primary = (
      <Button
        variant="primary"
        pending={give.isPending}
        onClick={() => give.mutate(row.giro_id)}
      >
        Given to supplier
      </Button>
    )
  else if (lane === "with")
    primary = (
      <Button variant="primary" onClick={() => onMove("clear", row)}>
        Mark cleared
      </Button>
    )
  else if (lane === "bounced" && !replaced)
    primary = (
      <Button variant="primary" onClick={() => onMove("replace", row)}>
        Replace
      </Button>
    )
  else if (lane === "cleared" && row.cash_document_id !== null)
    primary = (
      <Button
        variant="primary"
        onClick={() =>
          void navigate({
            to: "/finance/cash-bank/bkk/$id",
            params: { id: row.cash_document_id },
          } as never)
        }
      >
        Open BKK
      </Button>
    )

  const danger =
    lane === "with" || lane === "cleared" ? (
      <>
        {lane === "cleared" && !monthClosed(row.cleared_on) && (
          <Button variant="danger" onClick={() => onMove("unclear", row)}>
            Undo clearing
          </Button>
        )}
        <Button variant="danger" onClick={() => onMove("reject", row)}>
          Bounced
        </Button>
      </>
    ) : undefined

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) {
          give.reset()
          onClose()
        }
      }}
      context={`Giro · ${accountName}`}
      title={`BG ${row.number}`}
      badge={<Status tone={tone}>{word}</Status>}
      size="wide"
      footer={
        <SheetFooter
          error={give.error}
          danger={danger}
          primary={primary}
          onCancel={undefined}
        />
      }
    >
      <div className="flex flex-col gap-6">
        {lane === "bounced" ? (
          <Banner tone="bad">
            Bounced on {row.rejected_on === null ? "—" : day(row.rejected_on)}
            {row.rejected_reason !== null && ` — ${row.rejected_reason}`}.
            {replaced &&
              ` Replaced by ${row.replacement_number ?? row.replaced_by}.`}
          </Banner>
        ) : short ? (
          <Banner tone="bad">
            {accountName} is {money(-(balance ?? 0))} short on{" "}
            {day(row.due_date)}. The BG bounces if the money is not there.
          </Banner>
        ) : null}
        <Facts>
          <Fact term="BG no">{row.number}</Fact>
          <Fact term="Bank">{row.bank}</Fact>
          <Fact term="Account">{accountName}</Fact>
          <Fact term="BKK">{bkk ?? "Saldo Awal BG"}</Fact>
          <Fact term="Supplier">{supplier}</Fact>
          <Fact term="Amount">{money(row.amount_minor)}</Fact>
          <Fact term="Written">{opening ? "—" : day(row.issue_date)}</Fact>
          <Fact term="Given">—</Fact>
          <Fact term="Due">{day(row.due_date)}</Fact>
          {lane === "bounced" ? (
            <Fact term="Bounced">
              {row.rejected_on === null ? "—" : day(row.rejected_on)}
            </Fact>
          ) : (
            <Fact term="Cleared">
              {row.cleared_on === null ? "—" : day(row.cleared_on)}
            </Fact>
          )}
          {balance !== null && (
            <Fact term="Balance on due date">
              <BalanceFigure value={balance} />
            </Fact>
          )}
        </Facts>
        <section className="flex flex-col gap-2">
          <h3 className="text-[0.9375rem] font-semibold text-ink">Timeline</h3>
          <Timeline events={steps} />
        </section>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Mark cleared · Bounced · Undo clearing
// ---------------------------------------------------------------------------

const ACT_TEXT: Record<
  "clear" | "reject" | "unclear",
  { title: string; dateLabel: string; verb: string; tone: "primary" | "danger" }
> = {
  clear: {
    title: "Mark cleared",
    dateLabel: "Cleared on",
    verb: "Mark cleared",
    tone: "primary",
  },
  reject: {
    title: "Bounced",
    dateLabel: "Bounced on",
    verb: "Bounced",
    tone: "danger",
  },
  unclear: {
    title: "Undo clearing",
    dateLabel: "Taken back on",
    verb: "Undo clearing",
    tone: "danger",
  },
}

/// The day the bank shows, and a reason where one is needed. The day is the
/// statement's, never "today" by default.
export function GiroActSheet({
  act,
  row,
  onClose,
}: {
  act: Exclude<GiroMove, "replace"> | null
  row: GiroRow | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [on, setOn] = useState("")
  const [reason, setReason] = useState("")
  const supplierName = useSupplierName()
  const text = ACT_TEXT[act ?? "clear"]
  const needsReason = act === "reject" || act === "unclear"

  const run = useMutation({
    mutationFn: async () => {
      if (row === null) return
      if (act === "clear") await clearGiro(row.giro_id, on)
      else if (act === "reject")
        await rejectGiro(row.giro_id, on, reason.trim())
      else if (act === "unclear")
        await unclearGiro(row.giro_id, { on, reason: reason.trim() })
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["finance", "giros"] })
      void client.invalidateQueries({ queryKey: ["finance", "money"] })
      setOn("")
      setReason("")
      onClose()
    },
  })
  const ready = on !== "" && (!needsReason || reason.trim() !== "")

  return (
    <Sheet
      open={act !== null && row !== null}
      onOpenChange={(next) => {
        if (!next) {
          run.reset()
          onClose()
        }
      }}
      title={text.title}
      size="rail"
      footer={
        <SheetFooter
          error={run.error}
          onCancel={() => {
            run.reset()
            onClose()
          }}
          primary={{
            label: text.verb,
            tone: text.tone,
            pending: run.isPending,
            disabled: !ready,
            onClick: () => run.mutate(),
          }}
        />
      }
    >
      {row !== null && (
        <div className="flex flex-col gap-4">
          <Field label={text.dateLabel} required>
            <Day
              value={on}
              onChange={setOn}
              notAfter={act === "unclear" ? null : todayIso()}
              notBefore={act === "unclear" ? row.cleared_on : null}
            />
          </Field>
          {needsReason && (
            <Field label="Reason" required>
              <Textarea
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          )}
          <div className="flex items-center justify-between gap-3 rounded-inner border border-hairline px-3 py-2 text-[0.9375rem]">
            <span className="min-w-0 truncate">
              <span className="font-mono text-ink">{row.number}</span>
              <span className="ml-2 text-mute">
                {row.party_name === null
                  ? row.bank
                  : `${supplierName(row.party_name, row.party_name)} · ${row.bank}`}
              </span>
            </span>
            <span className="shrink-0 text-ink tabular-nums">
              {money(row.amount_minor)}
            </span>
          </div>
        </div>
      )}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Replace a bounced BG
// ---------------------------------------------------------------------------

/// Say which later payment or cash document settled what the bounced BG did
/// not. The new BKK is written on its own screen; this ties it to the BG.
export function GiroReplaceSheet({
  row,
  onClose,
}: {
  row: GiroRow | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const supplierName = useSupplierName()
  const navigate = useNavigate()
  const [chosen, setChosen] = useState<string | null>(null)
  const [needle, setNeedle] = useState("")
  const q = useDebounced(needle.trim(), 300)
  const byPayment = row?.supplier_payment_id != null

  const payments = useQuery({
    queryKey: [
      "finance",
      "giros",
      "replace-candidates",
      "payments",
      row?.unit_id,
      q,
    ],
    queryFn: ({ signal }) =>
      listPayments(
        {
          status: "POSTED",
          unit: row?.unit_id,
          q: q || undefined,
          limit: 20,
        },
        signal
      ),
    enabled: row !== null && byPayment,
  })
  const documents = useQuery({
    queryKey: [
      "finance",
      "giros",
      "replace-candidates",
      "cash-documents",
      row?.direction,
      row?.unit_id,
    ],
    queryFn: ({ signal }) =>
      candidateCashDocuments(
        {
          kind: row?.direction === "IN" ? "RECEIVE" : "PAY",
          unitId: row?.unit_id,
        },
        signal
      ),
    enabled: row !== null && !byPayment,
  })

  const replace = useMutation({
    mutationFn: () =>
      row === null
        ? Promise.resolve(null)
        : replaceGiro(
            row.giro_id,
            byPayment
              ? { payment_id: chosen ?? undefined }
              : { cash_document_id: chosen ?? undefined }
          ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["finance", "giros"] })
      setChosen(null)
      onClose()
    },
  })

  const needleLower = needle.trim().toLowerCase()
  const paymentRows = payments.data?.rows ?? []
  const documentRows = (documents.data ?? []).filter(
    (document) =>
      needleLower === "" ||
      (document.number ?? "").toLowerCase().includes(needleLower) ||
      document.party_name.toLowerCase().includes(needleLower)
  )
  const pick = (id: string, left: React.ReactNode, right: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setChosen(id)}
      className={cn(
        "flex w-full items-center justify-between gap-2 border-b border-hairline px-3 py-2 text-left text-[0.9375rem] last:border-b-0 hover:bg-soft-2",
        chosen === id && "bg-soft-2"
      )}
    >
      <span className="min-w-0 truncate">{left}</span>
      <span className="shrink-0 font-medium tabular-nums">{right}</span>
    </button>
  )

  return (
    <Sheet
      open={row !== null}
      onOpenChange={(next) => {
        if (!next) {
          replace.reset()
          onClose()
        }
      }}
      title={row === null ? "Replace" : `Replace BG ${row.number}`}
      size="rail"
      footer={
        <SheetFooter
          error={replace.error}
          start={
            <Button
              variant="ghost"
              onClick={() =>
                void navigate({ to: "/finance/cash-bank/bkk/new" } as never)
              }
            >
              Write the new BKK
            </Button>
          }
          onCancel={() => {
            replace.reset()
            onClose()
          }}
          primary={{
            label: "Replace",
            pending: replace.isPending,
            disabled: chosen === null,
            onClick: () => replace.mutate(),
          }}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label={byPayment ? "Replacing payment" : "Replacing cash document"}
        >
          <Input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
          />
        </Field>
        <div className="max-h-80 overflow-y-auto rounded-inner border border-hairline">
          {byPayment ? (
            paymentRows.length === 0 ? (
              <p className="p-3 text-[0.9375rem] text-mute">
                {payments.isPending
                  ? "Reading payments…"
                  : "No posted payment matches"}
              </p>
            ) : (
              paymentRows.map((p) =>
                pick(
                  p.payment_id,
                  <>
                    <span className="font-mono">{p.payment_number}</span>
                    <span className="ml-1.5 text-mute">
                      {day(p.payment_date)}
                    </span>
                  </>,
                  money(p.total_minor)
                )
              )
            )
          ) : documentRows.length === 0 ? (
            <p className="p-3 text-[0.9375rem] text-mute">
              {documents.isPending
                ? "Reading cash documents…"
                : "No posted cash document matches"}
            </p>
          ) : (
            documentRows.map((d) =>
              pick(
                d.document_id,
                <>
                  <span className="font-mono">{d.number ?? "—"}</span>
                  <span className="ml-1.5 text-mute">
                    {supplierName(d.party_name, d.party_name)}
                  </span>
                </>,
                money(d.amount_minor)
              )
            )
          )}
        </div>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Add opening giro
// ---------------------------------------------------------------------------

/// BG no · Bank · Supplier · Amount · Due date. The server has no endpoint
/// that takes an opening giro in, so Save stays off until it does.
export function GiroOpeningForm({
  open,
  banks,
  onClose,
}: {
  open: boolean
  banks: readonly string[]
  onClose: () => void
}) {
  const [number, setNumber] = useState("")
  const [bank, setBank] = useState("")
  const [supplier, setSupplier] = useState("")
  const [amount, setAmount] = useState("")
  const [due, setDue] = useState("")
  const ready =
    number.trim() !== "" &&
    supplier !== "" &&
    (parseMinor(amount) ?? 0) > 0 &&
    due !== ""
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      context="Giro · Saldo Awal BG"
      title="Add opening giro"
      size="rail"
      dirty={number !== "" || supplier !== "" || amount !== "" || due !== ""}
      footer={
        <SheetFooter
          note={
            ready ? "Saving an opening giro needs a server endpoint" : undefined
          }
          onCancel={onClose}
          primary={{
            label: "Save opening giro",
            disabled: true,
            onClick: () => undefined,
          }}
        />
      }
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-6">
        <Field label="BG no" required>
          <Input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder="456118"
          />
        </Field>
        <Field label="Bank">
          <Select
            value={bank || banks[0] || ""}
            onChange={setBank}
            aria-label="Bank"
          >
            {banks.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="col-span-2">
          <Field label="Supplier" required>
            <SupplierPicker
              value={supplier}
              onPick={(picked) => setSupplier(picked?.supplier_id ?? "")}
              label="Supplier"
            />
          </Field>
        </div>
        <Field label="Amount" required>
          <Money value={amount} onChange={setAmount} prefix="Rp" />
        </Field>
        <Field label="Due date" required>
          <Day value={due} onChange={setDue} />
        </Field>
      </div>
    </Sheet>
  )
}
