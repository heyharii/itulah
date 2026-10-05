import { useMemo, useState } from "react"
import { Plus } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { Sheet } from "@/components/ui/sheet"
import { Pill } from "@/components/ui/pill"
import { Banner, EmptyState } from "@/components/ui/states"
import {
  Amount,
  Cell,
  Row,
  Section,
  Table,
  rp,
  days,
  count,
  ChartBand,
  SubHead,
} from "@/screens/finance-lab/parts"
import { Flow } from "@/screens/finance-lab/signature"
import { useBook } from "@/screens/finance-lab/state"

/// Finance, opened at the top.
///
/// # Why this is a worklist and not a dashboard
///
/// Twelve groups sit under this page and every one of them can total itself.
/// The only thing this page knows that none of them knows is *which item, out
/// of all of them, is the next problem* — and that list cannot be assembled
/// anywhere else, because it crosses eleven registers. So the table is every
/// open item in the module, sorted by size, each row carrying the group that
/// owns it and a link to the screen where it can be fixed.
///
/// A strip of totals sits above it because "how much money have we got" is a
/// fair question to ask on arrival. It is four numbers, not a chart: the shape
/// of Finance over time is a report, and Reports draws it.
const TODAY = "2026-08-01"
const age = (d: string) =>
  Math.round((Date.parse(TODAY) - Date.parse(d)) / 86_400_000)
const MONEY = /^10110(0[1-4])/

/// Everything Finance can create, grouped the way somebody asks for it.
///
/// # Why this is a menu of destinations and not of forms
///
/// QuickBooks' `+ New` opens the form itself, from anywhere. That works when
/// the form is the whole interaction. Here a bill is created next to the bills
/// it joins, and a transfer next to the register it will appear in — so the
/// entry point navigates, and the form opens where the result will be visible.
/// Somebody who creates a bill and lands on an empty screen has to go and
/// find what they just made.
const CREATES: readonly {
  title: string
  items: readonly { label: string; to: string; where: string }[]
}[] = [
  {
    title: "Buying and paying",
    items: [
      { label: "Bill", to: "/finance-lab/expenses/bills", where: "Bills" },
      {
        label: "Supplier",
        to: "/finance-lab/expenses/suppliers",
        where: "Suppliers",
      },
      {
        label: "Vendor",
        to: "/finance-lab/expenses/vendors",
        where: "Vendors",
      },
      {
        label: "Advance",
        to: "/finance-lab/expenses/advances",
        where: "Advances",
      },
      {
        label: "Prepaid schedule",
        to: "/finance-lab/expenses/prepaids",
        where: "Prepaids",
      },
      {
        label: "Store expense claim",
        to: "/finance-lab/expenses/spend",
        where: "Expenses",
      },
    ],
  },
  {
    title: "Money",
    items: [
      {
        label: "Transfer between our accounts",
        to: "/finance-lab/cash/transactions",
        where: "Transactions",
      },
      {
        label: "Bank the day's takings",
        to: "/finance-lab/sales/reconcile",
        where: "Sales · Reconcile",
      },
      {
        label: "Import a bank statement",
        to: "/finance-lab/cash/reconcile",
        where: "Cash & bank · Reconcile",
      },
      {
        label: "Fund a unit",
        to: "/finance-lab/affiliation/funding",
        where: "Affiliation · Funding",
      },
      {
        label: "Loan instalment",
        to: "/finance-lab/financing/repayments",
        where: "Repayments",
      },
      {
        label: "Equity movement",
        to: "/finance-lab/financing/equity",
        where: "Equity",
      },
    ],
  },
  {
    title: "Stock and assets",
    items: [
      {
        label: "Stock adjustment",
        to: "/finance-lab/inventory/adjustments",
        where: "Adjustments",
      },
      {
        label: "Receive a delivery",
        to: "/finance-lab/inventory/in-transit",
        where: "BDP / in transit",
      },
      {
        label: "Asset",
        to: "/finance-lab/assets/register",
        where: "Asset register",
      },
      {
        label: "Project",
        to: "/finance-lab/assets/projects",
        where: "Projects / CIP",
      },
      {
        label: "Run depreciation",
        to: "/finance-lab/assets/depreciation",
        where: "Depreciation",
      },
    ],
  },
  {
    title: "People and tax",
    items: [
      { label: "Payroll run", to: "/finance-lab/payroll", where: "Payroll" },
      {
        label: "Settle a payroll payable",
        to: "/finance-lab/payroll/payables",
        where: "Payables",
      },
      {
        label: "File a tax return",
        to: "/finance-lab/tax/position",
        where: "Tax position",
      },
    ],
  },
  {
    title: "Accounting",
    items: [
      {
        label: "Journal entry",
        to: "/finance-lab/accounting/journals",
        where: "Journals",
      },
      {
        label: "Reverse an entry",
        to: "/finance-lab/accounting/adjustments",
        where: "Adjustments",
      },
      {
        label: "Close the period",
        to: "/finance-lab/accounting/close",
        where: "Period close",
      },
    ],
  },
]

interface Item {
  readonly id: string
  readonly what: string
  readonly group: string
  readonly why: string
  readonly amount: number
  readonly tone: "bad" | "warn"
  readonly to: string
  readonly cta: string
}

export function LabOverview() {
  const [creating, setCreating] = useState(false)
  const b = useBook()
  // The book's write counter, hoisted so a memo can depend on it. One name
  // rather than nine register names: it moves when anything the list reads
  // moves, and it cannot go stale when a tenth register joins the list.
  const version = b.snapshot()

  const tb = b.ledger.trialBalance({ book_id: "CFS" })
  const held = tb.rows
    .filter((r) => MONEY.test(r.code))
    .reduce((n, r) => n + r.debit - r.credit, 0)

  const openBills = b.bills.filter((x) => x.status !== "PAID")
  const owed =
    openBills.reduce((n, x) => n + (x.total - x.paid), 0) +
    b.payrollPayables.reduce((n, p) => n + (p.amount - p.settled), 0) +
    b.taxPositions
      .filter((t) => !t.filed_on)
      .reduce((n, t) => n + Math.max(0, t.payable - t.prepaid), 0)
  // The cycle's own figures, each read from the journal rather than from a
  // register — this page is the one place that should agree with Reports
  // without anybody reconciling it.
  const cls = (k: string) => {
    const rows = tb.rows.filter((r) => r.code.startsWith(k))
    const d = rows.reduce((n, r) => n + r.debit, 0)
    const c = rows.reduce((n, r) => n + r.credit, 0)
    return "234".includes(k) ? c - d : d - c
  }
  const revenue = cls("4")
  const result = revenue - cls("5") - cls("6") - cls("7") - cls("8")
  const inventory = tb.rows
    .filter((r) => /^10112/.test(r.code))
    .reduce((n, r) => n + r.debit - r.credit, 0)

  const due = b.cardBatches
    .filter((x) => !x.settled_on)
    .reduce((n, x) => n + x.gross, 0)

  const items = useMemo<readonly Item[]>(() => {
    const out: Item[] = []

    for (const x of openBills.filter((x) => age(x.due_on) > 0)) {
      out.push({
        id: `bill-${x.bill_id}`,
        what: `${x.supplier} — ${x.number}`,
        group: "Expenses & bills",
        why: `${days(age(x.due_on))} past due`,
        amount: x.total - x.paid,
        tone: "bad",
        to: "/finance-lab/expenses/bills",
        cta: "Pay",
      })
    }
    for (const e of b.storeExpenses.filter((e) => e.status === "SUBMITTED")) {
      out.push({
        id: `exp-${e.expense_id}`,
        what: e.description,
        group: "Expenses & bills",
        why: e.note ?? "Waiting on head office",
        amount: e.amount,
        tone: "warn",
        to: "/finance-lab/expenses/spend",
        cta: "Decide",
      })
    }
    for (const a of b.advances.filter((a) => a.amount > a.liquidated)) {
      out.push({
        id: `adv-${a.advance_id}`,
        what: `${a.holder} — ${a.purpose}`,
        group: "Expenses & bills",
        why: `${days(age(a.issued_on))} out, no receipts`,
        amount: a.amount - a.liquidated,
        tone: "warn",
        to: "/finance-lab/expenses/advances",
        cta: "Liquidate",
      })
    }
    for (const d of b.storeDays.filter(
      (d) => d.deposited === 0 || d.counted_cash !== d.rung_cash
    )) {
      out.push({
        id: `day-${d.day_id}`,
        what: `${d.unit_id} — ${d.on}`,
        group: "Sales",
        why:
          d.deposited === 0
            ? "Counted but never banked"
            : (d.note ?? "Drawer does not match the till"),
        amount:
          d.deposited === 0
            ? d.counted_cash
            : Math.abs(d.counted_cash - d.rung_cash),
        tone: d.deposited === 0 ? "warn" : "bad",
        to: "/finance-lab/sales/reconcile",
        cta: "Reconcile",
      })
    }
    for (const x of b.cardBatches.filter(
      (x) => !x.settled_on && age(x.expected_on) > 0
    )) {
      out.push({
        id: `set-${x.batch_id}`,
        what: `${x.acquirer} ${x.batch_id}`,
        group: "Receivables",
        why: `${days(age(x.expected_on))} past the expected payout`,
        amount: x.gross,
        tone: "bad",
        to: "/finance-lab/receivables/settlements",
        cta: "Chase",
      })
    }
    for (const s of b.shipments.filter((s) => !s.received_on)) {
      out.push({
        id: `shp-${s.shipment_id}`,
        what: `${s.reference} — ${s.from_unit} → ${s.to_unit}`,
        group: "Inventory",
        why:
          age(s.expected_on) > 0
            ? `${days(age(s.expected_on))} late`
            : `Due ${s.expected_on}`,
        amount: s.value,
        tone: age(s.expected_on) > 0 ? "bad" : "warn",
        to: "/finance-lab/inventory/in-transit",
        cta: "Receive",
      })
    }
    for (const a of b.stockAdjustments.filter((a) => a.status !== "POSTED")) {
      out.push({
        id: `adj-${a.adj_id}`,
        what: `${a.reference} — ${a.kind.toLowerCase()}`,
        group: "Inventory",
        why: a.note ?? `${a.status.toLowerCase()}, ${count(a.units, "unit")}`,
        amount: a.cost,
        tone: "warn",
        to: "/finance-lab/inventory/adjustments",
        cta: "Decide",
      })
    }
    for (const p of b.payrollPayables.filter((p) => p.amount > p.settled)) {
      out.push({
        id: `pay-${p.id}`,
        what: `${p.kind} — ${p.unit_id} ${p.period}`,
        group: "Payroll",
        why:
          age(p.due_on) > 0
            ? `${days(age(p.due_on))} past due`
            : `Due ${p.due_on}`,
        amount: p.amount - p.settled,
        tone: age(p.due_on) > 0 ? "bad" : "warn",
        to: "/finance-lab/payroll/payables",
        cta: "Settle",
      })
    }
    for (const m of b.interunitMoves.filter(
      (m) => m.amount > m.settled && age(m.on) > 14
    )) {
      out.push({
        id: `iu-${m.move_id}`,
        what: `${m.reference} — ${m.from_unit} → ${m.to_unit}`,
        group: "Affiliation",
        why: `${days(age(m.on))} outstanding`,
        amount: m.amount - m.settled,
        tone: "warn",
        to: "/finance-lab/affiliation/due",
        cta: "Open",
      })
    }
    for (const p of b.projects.filter((p) => p.status === "READY")) {
      out.push({
        id: `prj-${p.project_id}`,
        what: p.name,
        group: "Assets",
        why: "Finished and not capitalised — depreciating nothing",
        amount: p.spent,
        tone: "bad",
        to: "/finance-lab/assets/projects",
        cta: "Capitalise",
      })
    }
    for (const t of b.taxPositions.filter((t) => !t.filed_on)) {
      out.push({
        id: `tax-${t.id}`,
        what: `${t.kind} — ${t.period}`,
        group: "Tax",
        why:
          age(t.due_on) > 0
            ? `${days(age(t.due_on))} past the filing date`
            : `Due ${t.due_on}`,
        amount: Math.max(0, t.payable - t.prepaid),
        tone: age(t.due_on) > 0 ? "bad" : "warn",
        to: "/finance-lab/tax/position",
        cta: "File",
      })
    }
    return out.sort((x, y) => y.amount - x.amount)
    // `version` is the book's write counter. The registers are replaced on the
    // same `b`, whose identity never changes, so this is the only dependency
    // that moves when one of them does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b, version, openBills])

  const urgent = items.filter((i) => i.tone === "bad")

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Overview"
        sub="Everything across Finance that is waiting on a person, in one list."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            New
          </Button>
        }
      />

      <ChartBand title="What Finance does, and where the money is in it right now">
        <Flow
          steps={[
            {
              label: "Funded",
              value: rp(held),
              posts: "capital, loans, and what the shops hold",
              to: "/finance-lab/cash/accounts",
            },
            {
              label: "Bought",
              value: rp(openBills.reduce((n, x) => n + (x.total - x.paid), 0)),
              posts: "Dr Persediaan or Biaya / Cr Hutang",
              to: "/finance-lab/expenses/bills",
            },
            {
              label: "Held as stock",
              value: rp(inventory),
              posts: "1011201 · 1011202 · BDP on the road",
              to: "/finance-lab/inventory/valuation",
            },
            {
              label: "Sold",
              value: rp(revenue),
              posts: "Dr Kas or Piutang / Cr Penjualan",
              to: "/finance-lab/sales",
            },
            {
              label: "Collected",
              value: rp(due),
              posts: "still with the acquirer",
              to: "/finance-lab/receivables/settlements",
              tone: due ? "warn" : "ok",
            },
            {
              label: "Owed",
              value: rp(owed),
              posts: "suppliers, payroll and tax",
              to: "/finance-lab/expenses",
              tone: urgent.length ? "bad" : "warn",
            },
            {
              label: "Result",
              value: rp(result),
              posts: "closed monthly into 3013001",
              to: "/finance-lab/reports/profit-loss",
              tone: result >= 0 ? "ok" : "bad",
            },
          ]}
        />
      </ChartBand>

      {!tb.balanced && (
        <Banner tone="bad" className="mb-4">
          <div className="min-w-0">
            The journal is out of balance by{" "}
            {rp(tb.total_debit - tb.total_credit)} across{" "}
            {count(tb.rows.length, "account")}. Nothing downstream of it can be
            relied on.
          </div>
        </Banner>
      )}

      <Section
        title={`Open across Finance — ${items.length}`}
        sub="Largest first. Every row goes to the screen that can close it."
      >
        {items.length === 0 ? (
          <EmptyState>Nothing is waiting.</EmptyState>
        ) : (
          <Table head={["Item", "Group", "Why It Is Here", ">Amount", ""]}>
            {items.map((i) => (
              <Row key={i.id} tone={i.tone}>
                <Cell>
                  <span className="text-ink">{i.what}</span>
                </Cell>
                <Cell>
                  <Pill tone="neutral">{i.group}</Pill>
                </Cell>
                <Cell className="text-body">{i.why}</Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={i.amount} muted />
                </Cell>
                <Cell>
                  <AppLink
                    to={i.to}
                    className="font-medium text-accent hover:underline"
                  >
                    {i.cta}
                  </AppLink>
                </Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={3}>
                {count(items.length, "item")} across{" "}
                {count(new Set(items.map((i) => i.group)).size, "group")}
              </Cell>
              <Cell right>
                <Amount minor={items.reduce((n, i) => n + i.amount, 0)} />
              </Cell>
              <Cell />
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={creating}
        onOpenChange={setCreating}
        title="New"
        width="wide"
      >
        <div className="flex flex-col gap-5">
          <p className="text-meta text-body">
            Everything Finance can start. Each one lives on the screen that owns
            it — creating a bill where bills are worked is what keeps one list
            of what is owed instead of two.
          </p>
          {CREATES.map((group) => (
            <div key={group.title}>
              <SubHead>{group.title}</SubHead>
              <div className="mt-1.5 grid gap-x-6 sm:grid-cols-2">
                {group.items.map((i) => (
                  <AppLink
                    key={i.label}
                    to={i.to}
                    onClick={() => setCreating(false)}
                    className="hover:bg-soft-1 flex items-baseline justify-between gap-3 border-b border-hairline py-2 last:border-0"
                  >
                    <span className="text-meta text-ink">{i.label}</span>
                    <span className="shrink-0 text-eyebrow text-mute">
                      {i.where}
                    </span>
                  </AppLink>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Sheet>
    </PageContent>
  )
}
