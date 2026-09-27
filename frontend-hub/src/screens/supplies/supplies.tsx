import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Plus, X } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import { gaKeys, gaSupplies, moveGaSupplyRequest } from "@/lib/queries/ga"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { FinanceMark } from "@/screens/contracts/parts"
import { SupplyComposer } from "@/screens/supplies/composer"
import type { GaSupplyRequestRow } from "@itulah/contract"

/// Supplies — what the places run out of.
///
/// # What this screen is not
///
/// Not customer supplies, which Commercial spends on the shopper's behalf, and
/// not shopping bags, which Inventory holds as stock. Both have their own
/// category and their own owner elsewhere, and the seven categories this
/// screen offers are the ones the client's chart gives GA — the server refuses
/// a request that names any other (brief §9.4).
///
/// # No Procurement, and the screen says so
///
/// There is no non-merchandise purchase order in this estate yet, so the PO
/// stage carries a typed `po_reference` rather than a link to a module that
/// does not exist (brief §15 tahap 5). The banner at the top says that once,
/// and the sheet says it again where the reference is entered — an honest gap
/// is better than a button that opens nothing.
///
/// # The stage is the status
///
/// A request is asked for, approved, ordered, received and billed, and each
/// stage has a different owner: GA approves, Procurement orders and receives,
/// Finance records the bill. The words name who has it now, and the move
/// button offers only the step the server itself would accept.
export function Supplies() {
  const open = useSheet("supply")
  const [adding, setAdding] = useState(false)

  const requests = useQuery({
    queryKey: gaKeys.supplies({}),
    queryFn: ({ signal }) => gaSupplies({ limit: 200 }, signal),
  })

  const rows = requests.data ?? []

  return (
    <PageContent>
      <PageHeader
        crumb="GA"
        title="Supply requests"
        sub="Submit and track requests for consumables needed by the office, warehouse, stores and mess."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus />
            Request supplies
          </Button>
        }
      />

      <Banner tone="info">
        Non-merchandise purchase orders aren't connected to a Procurement module
        yet. The order number is recorded on this request.
      </Banner>

      {requests.data !== undefined && <SummaryStrip rows={rows} />}

      {queryState(requests, {
        loading: "Opening supply requests…",
        render: () =>
          rows.length === 0 ? (
            <Card>
              <EmptyState
                action={
                  <Button variant="ghost" onClick={() => setAdding(true)}>
                    Request the first one
                  </Button>
                }
              >
                No supply requests yet. Consumables — stationery, household
                supplies, store fittings — are requested here by the place that
                needs them, not ordered as merchandise.
              </EmptyState>
            </Card>
          ) : (
            <SupplyTable rows={rows} onOpen={open.open} />
          ),
      })}

      <SupplyComposer
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={(requestId) => {
          setAdding(false)
          open.open(requestId)
        }}
      />

      <SupplySheet
        key={open.value ?? "none"}
        requestId={open.value}
        open={open.isOpen}
        onClose={open.close}
      />
    </PageContent>
  )
}

/// The three figures the screen is managed by, counted over the SAME rows the
/// table draws. "With Procurement" is the three middle stages together, because
/// from GA's side they are one answer to "where is it" — out of our hands.
function SummaryStrip({ rows }: { rows: readonly GaSupplyRequestRow[] }) {
  const asked = rows.filter((row) => row.status === "REQUESTED").length
  const inProcurement = rows.filter((row) =>
    ["APPROVED", "ORDERED", "RECEIVED"].includes(row.status)
  ).length
  const billed = rows.filter((row) => row.status === "BILLED").length

  return (
    <KpiStrip className="md:grid-cols-3 xl:grid-cols-3">
      <Kpi label="Submitted" value={count(asked)} />
      <Kpi label="With Procurement" value={count(inProcurement)} />
      <Kpi
        label={
          <>
            Billed <FinanceMark className="ml-1 align-[0.125rem]" />
          </>
        }
        value={count(billed)}
      />
    </KpiStrip>
  )
}

/// The request book, in the prototype's columns. The table scrolls INSIDE its
/// own box rather than squeezing: seven columns of goods, places and figures
/// do not fit a phone, and a squeezed table overlaps its own cells while the
/// page starts scrolling sideways.
function SupplyTable({
  rows,
  onOpen,
}: {
  rows: readonly GaSupplyRequestRow[]
  onOpen: (requestId: string) => void
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[76rem]">
          <div className="grid h-10 grid-cols-[9rem_minmax(13rem,1.3fr)_minmax(12rem,1fr)_10rem_8rem_8.5rem_8.5rem] items-center gap-3 border-b border-hairline bg-soft px-3.5 text-eyebrow font-medium text-body">
            <span>Request</span>
            <span>Item</span>
            <span>Category · account</span>
            <span>Location</span>
            <span>PO</span>
            <span className="text-right">
              Bill <FinanceMark className="ml-1 align-[0.0625rem]" />
            </span>
            <span>Status</span>
          </div>
          {rows.map((row) => (
            <SupplyLine key={row.request_id} row={row} onOpen={onOpen} />
          ))}
        </div>
      </div>
    </Card>
  )
}

function SupplyLine({
  row,
  onOpen,
}: {
  row: GaSupplyRequestRow
  onOpen: (requestId: string) => void
}) {
  return (
    <div
      onClick={() => onOpen(row.request_id)}
      className="grid cursor-pointer grid-cols-[9rem_minmax(13rem,1.3fr)_minmax(12rem,1fr)_10rem_8rem_8.5rem_8.5rem] items-center gap-3 border-b border-hairline px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-soft"
    >
      <div className="min-w-0">
        <span className="block truncate font-mono text-id text-body">
          {row.request_id.slice(0, 8)}
        </span>
        <span className="block truncate text-pill text-mute">
          {row.needed_by === null
            ? "no date"
            : `needed by ${day(row.needed_by)}`}
        </span>
      </div>
      <div className="min-w-0">
        <span className="block truncate text-cell font-medium text-ink">
          {row.item}
        </span>
        {row.quantity !== null && (
          <span className="block truncate text-pill text-mute">
            {row.quantity}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <span className="block truncate text-meta text-body">
          {row.category_name}
        </span>
        <span className="block truncate font-mono text-pill text-mute">
          {row.account_code}
        </span>
      </div>
      <div className="min-w-0">
        <span className="block truncate text-meta text-body">
          {row.site_id}
        </span>
        <span className="block truncate text-pill text-mute">
          {row.requested_by}
        </span>
      </div>
      <span className="truncate font-mono text-id text-body">
        {row.po_reference ?? "—"}
      </span>
      <span className="min-w-0 truncate text-right text-meta tabular-nums">
        {row.status === "BILLED" ? (
          <span className="text-ok">Billed</span>
        ) : (
          <span className="text-mute">—</span>
        )}
      </span>
      <span>
        <SupplyStagePill status={row.status} />
      </span>
    </div>
  )
}

// ── the stage flow ──────────────────────────────────────────────────────────

/// REQUESTED → APPROVED → ORDERED → RECEIVED → BILLED, with REJECTED the one
/// exit. The list is the same law the server enforces (`SUPPLY_STATUS_FLOW` +
/// `supply_may_move` in `domain/ga.rs`), so the button and the validator cannot
/// disagree.
const SUPPLY_FLOW = [
  "REQUESTED",
  "APPROVED",
  "ORDERED",
  "RECEIVED",
  "BILLED",
] as const

function supplyStageWords(status: string): string {
  switch (status) {
    case "REQUESTED":
      return "Submitted"
    case "APPROVED":
      return "Approved"
    case "ORDERED":
      return "PO created"
    case "RECEIVED":
      return "Received"
    case "BILLED":
      return "Billed"
    default:
      return "Rejected"
  }
}

function SupplyStagePill({ status }: { status: string }) {
  switch (status) {
    case "REQUESTED":
      return <Pill tone="warn">{supplyStageWords(status)}</Pill>
    case "APPROVED":
    case "ORDERED":
      return <Pill tone="accent">{supplyStageWords(status)}</Pill>
    case "RECEIVED":
      return <Pill tone="info">{supplyStageWords(status)}</Pill>
    case "BILLED":
      return <Pill tone="ok">{supplyStageWords(status)}</Pill>
    default:
      return <Pill tone="bad">{supplyStageWords(status)}</Pill>
  }
}

/// The next step, or nothing at the ends. REJECTED is deliberately absent: it
/// is offered as its own button while the request is still REQUESTED, because
/// a decline is a fork and not the following stage.
function supplyNextStage(status: string): string | null {
  const at = SUPPLY_FLOW.indexOf(status as (typeof SUPPLY_FLOW)[number])
  return at >= 0 && at < SUPPLY_FLOW.length - 1 ? SUPPLY_FLOW[at + 1] : null
}

/// The stage line, drawn here rather than through Maintenance's `StageLine`
/// because the words are this flow's own ("PO created", not "Approved"), and
/// one shared drawing with a per-flow word table is how the wrong word reaches
/// the page. Behind is green, here is accent, ahead is quiet; REJECTED stands
/// alone in red.
function SupplyStageLine({ status }: { status: string }) {
  const rejected = status === "REJECTED"
  const at = SUPPLY_FLOW.indexOf(status as (typeof SUPPLY_FLOW)[number])
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {SUPPLY_FLOW.map((stage, i) => (
        <Pill
          key={stage}
          tone={
            rejected
              ? "neutral"
              : i < at
                ? "ok"
                : i === at
                  ? "accent"
                  : "neutral"
          }
        >
          {supplyStageWords(stage)}
        </Pill>
      ))}
      {rejected && <Pill tone="bad">{supplyStageWords(status)}</Pill>}
    </div>
  )
}

// ── the request sheet ───────────────────────────────────────────────────────

/// One request: what was asked for, how far it has got, the account its bills
/// will propose, and the Finance figure that lands when a bill points here.
///
/// # Why this reads its row from the list's cache
///
/// There is no `GET /ga/supplies/{id}` — the list is the whole record, and the
/// sheet finds its row in the same answer the table drew. The screen's own
/// query is `enabled` regardless, so a link straight to `?supply=…` pulls the
/// list before the sheet has a row to show.
export function SupplySheet({
  requestId,
  open,
  onClose,
}: {
  requestId: string | undefined
  open: boolean
  onClose: () => void
}) {
  const requests = useQuery({
    queryKey: gaKeys.supplies({}),
    queryFn: ({ signal }) => gaSupplies({ limit: 200 }, signal),
    enabled: open,
  })
  const row = (requests.data ?? []).find((one) => one.request_id === requestId)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      width="wide"
      title={row === undefined ? "Supply request" : row.item}
      id={requestId === undefined ? undefined : requestId.slice(0, 8)}
      caption={
        row === undefined ? undefined : `${row.category_name} · ${row.site_id}`
      }
      subject={
        requestId === undefined ? undefined : { kind: "supply", id: requestId }
      }
      badge={
        row === undefined ? undefined : <SupplyStagePill status={row.status} />
      }
      tabs={
        row === undefined
          ? undefined
          : [
              {
                value: "request",
                label: "Request",
                content: <RequestTab row={row} />,
              },
              {
                value: "stage",
                label: "Stage",
                content: <StageTab row={row} />,
              },
              {
                value: "billing",
                label: "Bill (Finance)",
                content: <BillingTab row={row} />,
              },
              {
                value: "accounts",
                label: "Accounts",
                content: <AccountsTab row={row} />,
              },
            ]
      }
    >
      {requests.isLoading && (
        <LoadingState>Opening the request…</LoadingState>
      )}
      {row === undefined && !requests.isLoading && (
        <p className="text-meta text-body">
          This request isn't in the list. It may have been deleted, or the
          link points to a request this screen no longer reads.
        </p>
      )}
    </Sheet>
  )
}

/// What was asked for, by whom and by when. Every fact here is GA's own; the
/// PO reference is a typed id because there is no PO module to point at.
function RequestTab({ row }: { row: GaSupplyRequestRow }) {
  return (
    <Facts>
      <Fact term="Item">{row.item}</Fact>
      <Fact term="Quantity">{row.quantity ?? "—"}</Fact>
      <Fact term="Category">{row.category_name}</Fact>
      <Fact term="Location">{row.site_id}</Fact>
      <Fact term="Requested by">{row.requested_by}</Fact>
      <Fact term="Needed by">
        {row.needed_by === null ? "—" : day(row.needed_by)}
      </Fact>
      <Fact term="Estimate">{money(row.estimated_cost_minor)}</Fact>
      <Fact term="PO (Procurement)">
        {row.po_reference === null ? (
          "—"
        ) : (
          <span className="font-mono text-id">{row.po_reference}</span>
        )}
      </Fact>
    </Facts>
  )
}

/// The stage, the step after it, and the two forms that step can take: a PO
/// reference on the way to ORDERED, a reason on the way to REJECTED. Every
/// other move is one deliberate click.
function StageTab({ row }: { row: GaSupplyRequestRow }) {
  const next = supplyNextStage(row.status)
  const rejected = row.status === "REJECTED"
  const [form, setForm] = useState<"advance" | "reject" | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <SupplyStageLine status={row.status} />
      {rejected && row.rejected_reason !== null && (
        <Banner tone="bad">{row.rejected_reason}</Banner>
      )}
      {row.status === "BILLED" && (
        <p className="text-pill text-mute">
          Billed — the end of the flow. The bill belongs to Finance.
        </p>
      )}
      {rejected && (
        <p className="text-pill text-mute">
          Rejected. A rejected request stops here and cannot continue.
        </p>
      )}
      {next !== null && form === null && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="soft" onClick={() => setForm("advance")}>
            <Check />
            {`Next: ${supplyStageWords(next)}`}
          </Button>
          {row.status === "REQUESTED" && (
            <Button variant="ghost" onClick={() => setForm("reject")}>
              <X />
              Reject
            </Button>
          )}
        </div>
      )}
      {form === "advance" && next !== null && (
        <AdvanceForm
          row={row}
          to={next}
          onDone={() => setForm(null)}
          onCancel={() => setForm(null)}
        />
      )}
      {form === "reject" && (
        <RejectForm
          row={row}
          onDone={() => setForm(null)}
          onCancel={() => setForm(null)}
        />
      )}
    </div>
  )
}

/// One step forward. ORDERED is the only stage with a question — the PO
/// reference Procurement typed — and the server refuses one anywhere else, so
/// only this form asks.
function AdvanceForm({
  row,
  to,
  onDone,
  onCancel,
}: {
  row: GaSupplyRequestRow
  to: string
  onDone: () => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const [po, setPo] = useState(row.po_reference ?? "")
  const needsPo = to === "ORDERED"

  const move = useMutation({
    mutationFn: () =>
      moveGaSupplyRequest(row.request_id, {
        to,
        po_reference: needsPo ? (blank(po) ?? null) : null,
        rejected_reason: null,
      }),
    onSuccess: () => {
      // The list, the overview's new-request section and this sheet are one
      // answer under the GA prefix; they drop together.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      onDone()
    },
  })

  return (
    <div className="flex flex-col gap-3">
      {move.error instanceof Error && (
        <Banner tone="bad">{move.error.message}</Banner>
      )}
      {needsPo && (
        <Field
          label="PO number (Procurement)"
          required
          aside="typed from the PO Procurement created; there's no module for it yet"
        >
          <Input
            value={po}
            onChange={(event) => setPo(event.target.value)}
            placeholder="e.g. PO-GA-2609-01"
            autoFocus
          />
        </Field>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          pending={move.isPending}
          disabled={needsPo && (po ?? "").trim() === ""}
          onClick={() => move.mutate()}
        >
          {move.isPending ? "Moving…" : `Next: ${supplyStageWords(to)}`}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/// Refusing, with the reason the requester will read. The server requires one
/// and the form asks for it before the button will send.
function RejectForm({
  row,
  onDone,
  onCancel,
}: {
  row: GaSupplyRequestRow
  onDone: () => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [problem, setProblem] = useState("")

  const move = useMutation({
    mutationFn: () =>
      moveGaSupplyRequest(row.request_id, {
        to: "REJECTED",
        po_reference: null,
        rejected_reason: reason.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      onDone()
    },
  })

  const submit = () => {
    if (reason.trim() === "") {
      setProblem("Write the reason first.")
      return
    }
    move.mutate()
  }

  return (
    <div className="flex flex-col gap-3">
      {move.error instanceof Error && (
        <Banner tone="bad">{move.error.message}</Banner>
      )}
      <Field
        label="Reason for rejection"
        required
        problem={problem || undefined}
        aside="recorded on the request"
      >
        <Input
          value={reason}
          onChange={(event) => {
            setProblem("")
            setReason(event.target.value)
          }}
          placeholder="e.g. No budget for it this month"
          onKeyDown={(event) => {
            if (event.key === "Enter") submit()
          }}
          autoFocus
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button variant="primary" pending={move.isPending} onClick={submit}>
          {move.isPending ? "Rejecting…" : "Reject request"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/// The bills that point at this request. There is no `bill_id` on the wire
/// yet — a bill line can only name a supply request from tahap 6 — so the
/// figure is an em dash with the reason, not a zero pretending to be spent.
function BillingTab({ row }: { row: GaSupplyRequestRow }) {
  return (
    <div className="flex flex-col gap-4">
      <figure>
        <figcaption className="text-eyebrow font-medium text-body">
          Bill <FinanceMark className="ml-1 align-[0.125rem]" />
        </figcaption>
        <div className="mt-1 text-[1.125rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
          {row.status === "BILLED" ? "Billed" : "—"}
        </div>
      </figure>
      <p className="text-pill text-mute">
        Calculated from POSTED bills that point to this request. A bill line
        can only point to a supply request from stage 6 onward; before that
        the figure genuinely doesn't exist yet, not zero.
      </p>
    </div>
  )
}

/// The account the category proposes, read-only, plus the payable every
/// purchase lands on. The category is GA's choice and the account is Finance's
/// map; this shows the proposal so the requester can check it before a bill
/// ever carries it.
function AccountsTab({ row }: { row: GaSupplyRequestRow }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col">
        <AccountRow
          role={`Expense (${row.category_name})`}
          code={row.account_code}
        />
        <AccountRow role="Payable" code="2004" />
      </div>
      <p className="flex items-center gap-1.5 text-pill text-mute">
        <FinanceMark className="align-[0.0625rem]" /> The accounts are
        proposed from the request category. Finance can still change them on
        the bill line.
      </p>
    </div>
  )
}

function AccountRow({ role, code }: { role: string; code: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-hairline py-2 last:border-b-0">
      <span className="w-40 shrink-0 text-meta text-body">{role}</span>
      <span className="w-14 shrink-0 font-mono text-id text-body tabular-nums">
        {code}
      </span>
    </div>
  )
}

/// The form's empty string, as the wire spells "not given".
function blank(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}
