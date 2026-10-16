import { ActivityFold } from "@/components/ui/activity-fold"
import { Plus } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { BANK_ACCOUNTS } from "@/screens/finance-lab/engine/bindings"
import {
  Amount,
  Cell,
  EntryView,
  Row,
  Section,
  SubHead,
  Table,
  FILTER_W,
} from "@/screens/finance-lab/parts"
import { Funnel } from "@/screens/finance-lab/signature"
import { useBook } from "@/screens/finance-lab/state"
import type { Payment, PaymentStatus } from "@/screens/finance-lab/engine/types"

/// Payments — what we owe, being paid.
///
/// # Why this is not on Cash & bank
///
/// Cash & bank answers *where is the money*; this answers *what are we paying
/// and how far along is it*. QuickBooks makes the same split — Bill payments
/// sits under Expenses & Bills, not under banking — and it is right for the
/// same reason: a payment belongs to the obligation it settles, and the bank
/// account is a detail of how it left.
///
/// Signature visual is the pipeline: requested → approved → instructed →
/// settled. Only the last of those writes a journal, and the bar makes that
/// visible without anybody reading the status column.
export const STATUS_TONE: Record<
  PaymentStatus,
  "neutral" | "info" | "warn" | "ok" | "bad"
> = {
  REQUESTED: "neutral",
  APPROVED: "info",
  INSTRUCTED: "warn",
  SETTLED: "ok",
  FAILED: "bad",
  CANCELLED: "neutral",
  RECONCILED: "ok",
}

export const ACTION: Record<string, string> = {
  PAY_PROCUREMENT: "Pay procurement",
  PAY_BILL: "Pay bill",
  PAY_OE_REPLACEMENT: "Pay OE replacement",
  PAY_PAYROLL: "Pay payroll",
  RECEIVE_FUNDS: "Receive funds",
  RECORD_EXPENSE: "Record expense",
  DEPOSIT_TAKINGS: "Deposit takings",
}

const NEXT: Record<
  PaymentStatus,
  readonly {
    to: "APPROVED" | "INSTRUCTED" | "SETTLED" | "FAILED" | "CANCELLED"
    label: string
    role: "FINANCE" | "FINANCE_MANAGER"
    primary?: boolean
  }[]
> = {
  REQUESTED: [
    {
      to: "APPROVED",
      label: "Approve",
      role: "FINANCE_MANAGER",
      primary: true,
    },
    { to: "CANCELLED", label: "Cancel", role: "FINANCE" },
  ],
  APPROVED: [
    { to: "INSTRUCTED", label: "Send to bank", role: "FINANCE", primary: true },
    { to: "CANCELLED", label: "Cancel", role: "FINANCE" },
  ],
  INSTRUCTED: [
    { to: "SETTLED", label: "Bank confirmed", role: "FINANCE", primary: true },
    { to: "FAILED", label: "Bank declined", role: "FINANCE" },
  ],
  SETTLED: [],
  FAILED: [
    { to: "INSTRUCTED", label: "Resend", role: "FINANCE", primary: true },
  ],
  CANCELLED: [],
  RECONCILED: [],
}

export function Payments() {
  const b = useBook()
  const [status, setStatus] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const all = b.payments.all()
  const rows = all.filter((p) => !status || p.status === status)
  const settled = all.filter((p) => p.status === "SETTLED")
  const inFlight = all.filter(
    (p) => p.status === "APPROVED" || p.status === "INSTRUCTED"
  )
  const requested = all.filter((p) => p.status === "REQUESTED")

  const payment = all.find((p) => p.payment_id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Payments"
        actions={
          <div className="flex items-center gap-2">
            <Select value={status} onChange={setStatus} className={FILTER_W}>
              <option value="">All statuses</option>
              <option value="REQUESTED">Requested</option>
              <option value="APPROVED">Approved</option>
              <option value="INSTRUCTED">Instructed</option>
              <option value="SETTLED">Settled</option>
              <option value="FAILED">Failed</option>
            </Select>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" />
              New payment
            </Button>
          </div>
        }
      />

      <Section title="Pipeline">
        <Funnel
          recognised={all.reduce((n, p) => n + p.total, 0)}
          settled={settled.reduce((n, p) => n + p.total, 0)}
          outstanding={
            inFlight.reduce((n, p) => n + p.total, 0) +
            requested.reduce((n, p) => n + p.total, 0)
          }
          parts={[
            {
              label: "Requested",
              amount: requested.reduce((n, p) => n + p.total, 0),
            },
            {
              label: "In flight",
              amount: inFlight.reduce((n, p) => n + p.total, 0),
            },
            {
              label: "Settled",
              amount: settled.reduce((n, p) => n + p.total, 0),
            },
          ]}
        />
      </Section>

      <Section title={`Payments — ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState>No payments in this filter.</EmptyState>
        ) : (
          <Table
            head={[
              "Number",
              "Date",
              "Action",
              "Counterparty",
              "Funded from",
              ">Amount",
              "Status",
              ">Journal",
            ]}
          >
            {rows.map((p) => (
              <Row
                key={p.payment_id}
                className="hover:bg-soft-1 cursor-pointer"
              >
                <Cell mono onClick={() => setOpen(p.payment_id)}>
                  {p.payment_number}
                </Cell>
                <Cell className="whitespace-nowrap">{p.dates.document_on}</Cell>
                <Cell onClick={() => setOpen(p.payment_id)}>
                  {ACTION[p.action] ?? p.action}
                </Cell>
                <Cell className="text-body">{p.counterparty}</Cell>
                <Cell className="text-body">
                  {p.source.kind === "BANK"
                    ? p.source.bank_account_id
                    : "Petty cash"}
                </Cell>
                <Cell right>
                  <Amount minor={p.total} />
                </Cell>
                <Cell>
                  <Pill tone={STATUS_TONE[p.status]}>
                    {p.status.toLowerCase()}
                  </Pill>
                </Cell>
                <Cell right mono className="text-mute">
                  {p.entry_id ? b.ledger.entry(p.entry_id)?.entry_number : "—"}
                </Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={5}>{rows.length} payments</Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, p) => n + p.total, 0)} />
              </Cell>
              <Cell colSpan={2} />
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={creating}
        onOpenChange={(o) => !o && setCreating(false)}
        title="New payment"
      >
        <NewPayment onDone={() => setCreating(false)} />
      </Sheet>

      <Sheet
        open={Boolean(payment)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={payment ? (ACTION[payment.action] ?? payment.action) : ""}
        id={payment?.payment_number}
      >
        {payment && <PaymentDetail payment={payment} />}
      </Sheet>
    </PageContent>
  )
}

function NewPayment({ onDone }: { onDone: () => void }) {
  const b = useBook()
  const items = b.payments
    .allItems()
    .filter((i) => b.payments.outstanding(i.item_id) > 0)
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [src, setSrc] = useState("PETTY_CASH")
  const [on, setOn] = useState("2026-09-01")
  const [said, setSaid] = useState<string | null>(null)
  const total = Object.values(picked).reduce(
    (n, v) => n + (Number(v) || 0) * 100,
    0
  )

  if (items.length === 0)
    return <EmptyState>Nothing is open to pay.</EmptyState>

  return (
    <div className="flex flex-col gap-4">
      <Table head={["Obligation", ">Outstanding", ">Pay"]}>
        {items.map((i) => (
          <Row key={i.item_id}>
            <Cell>
              <span className="text-ink">{i.description}</span>
              <div className="font-mono text-eyebrow text-faint">
                {i.counterparty}
              </div>
            </Cell>
            <Cell right>
              <Amount minor={b.payments.outstanding(i.item_id)} />
            </Cell>
            <Cell right>
              <Input
                value={picked[i.item_id] ?? ""}
                inputMode="numeric"
                className="w-28 text-right"
                onChange={(e) =>
                  setPicked({
                    ...picked,
                    [i.item_id]: e.target.value.replace(/\D/g, ""),
                  })
                }
              />
            </Cell>
          </Row>
        ))}
        <Row tone="total">
          <Cell colSpan={2}>Total</Cell>
          <Cell right>
            <Amount minor={total} />
          </Cell>
        </Row>
      </Table>

      <label className="block">
        <span className="mb-1 block font-mono text-eyebrow tracking-[0.04em] text-body uppercase">
          Funded from
        </span>
        <Select value={src} onChange={setSrc} className={FILTER_W}>
          <option value="PETTY_CASH">Petty cash</option>
          {BANK_ACCOUNTS.filter((a) => a.unit_id === "C006").map((a) => (
            <option key={a.bank_account_id} value={a.bank_account_id}>
              {a.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="block">
        <span className="mb-1 block font-mono text-eyebrow tracking-[0.04em] text-body uppercase">
          Date
        </span>
        <Input value={on} onChange={(e) => setOn(e.target.value)} />
      </label>

      {said && <p className="text-meta text-bad-fg">{said}</p>}
      <div className="flex gap-2">
        <Button
          variant="primary"
          onClick={() => {
            const alloc = Object.entries(picked)
              .map(([item_id, v]) => ({
                item_id,
                amount: (Number(v) || 0) * 100,
              }))
              .filter((a) => a.amount > 0)
            if (alloc.length === 0)
              return setSaid("Allocate at least one obligation.")
            const r = b.createPayment({
              unit_id: "C006",
              counterparty: "—",
              source:
                src === "PETTY_CASH"
                  ? { kind: "PETTY_CASH" }
                  : { kind: "BANK", bank_account_id: src },
              on,
              items: alloc,
            })
            if ("error" in r) setSaid(r.error)
            else onDone()
          }}
        >
          Create draft
        </Button>
        <Button data-cancel onClick={onDone}>
          Cancel
        </Button>
      </div>
      <p className="text-meta text-mute">
        Creates a request. Approval, instruction and settlement are separate
        steps; only settlement posts.
      </p>
    </div>
  )
}

export function PaymentDetail({ payment }: { payment: Payment }) {
  const b = useBook()
  const entry = payment.entry_id ? b.ledger.entry(payment.entry_id) : undefined
  const next = NEXT[payment.status]

  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact term="Counterparty">{payment.counterparty}</Fact>
        <Fact term="Unit">{payment.unit_id}</Fact>
        <Fact term="Funded from">
          {payment.source.kind === "BANK"
            ? payment.source.bank_account_id
            : "Petty cash"}
        </Fact>
        <Fact term="Amount">
          <Amount minor={payment.total} />
        </Fact>
        <Fact term="Document date">{payment.dates.document_on}</Fact>
        <Fact term="Posting date">{payment.dates.posting_on}</Fact>
      </Facts>

      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={STATUS_TONE[payment.status]}>
          {payment.status.toLowerCase()}
        </Pill>
        {next.map((n) => (
          <Button
            key={n.to}
            variant={n.primary ? "primary" : undefined}
            onClick={() =>
              b.advancePayment(
                payment.payment_id,
                n.to,
                n.role === "FINANCE_MANAGER" ? "manager@lab" : "finance@lab",
                n.role
              )
            }
          >
            {n.label}
          </Button>
        ))}
      </div>

      <div>
        <SubHead>Allocation</SubHead>
        <Table head={["Answers", "Kind", ">Amount"]}>
          {payment.allocations.map((a, i) => {
            const item =
              a.target.kind === "OPEN_ITEM"
                ? b.payments.item(a.target.item_id)
                : undefined
            return (
              <Row key={i}>
                <Cell>
                  {a.target.kind === "OPEN_ITEM"
                    ? (item?.description ?? "—")
                    : a.target.description}
                </Cell>
                <Cell>
                  <Pill
                    tone={a.target.kind === "OPEN_ITEM" ? "info" : "neutral"}
                  >
                    {a.target.kind === "OPEN_ITEM"
                      ? "obligation"
                      : "direct cost"}
                  </Pill>
                </Cell>
                <Cell right>
                  <Amount minor={a.amount} />
                </Cell>
              </Row>
            )
          })}
          <Row tone="total">
            <Cell colSpan={2}>Total</Cell>
            <Cell right>
              <Amount minor={payment.total} />
            </Cell>
          </Row>
        </Table>
      </div>

      <ActivityFold count={payment.history.length}>
        <Table head={["Date", "Status", "By"]}>
          {payment.history.map((h, i) => (
            <Row key={i}>
              <Cell className="whitespace-nowrap">{h.at}</Cell>
              <Cell>
                <Pill tone={STATUS_TONE[h.status]}>
                  {h.status.toLowerCase()}
                </Pill>
              </Cell>
              <Cell className="text-body">{h.actor}</Cell>
            </Row>
          ))}
        </Table>
      </ActivityFold>

      {entry && (
        <div>
          <SubHead>Journal</SubHead>
          <div className="mt-2">
            <EntryView entry={entry} />
          </div>
        </div>
      )}
    </div>
  )
}
