import { useState } from "react"

import { Printer } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"

import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { type Advance } from "@/screens/finance-lab/engine/data"
import {
  Amount,
  Cell,
  Kpis,
  Row,
  Section,
  SubHead,
  Table,
  rp,
  days,
  count,
  FILTER_W,
  NewRecord,
  ChartBand,
} from "@/screens/finance-lab/parts"
import { Flow, Posting } from "@/screens/finance-lab/signature"
import { PrintSheet, ReportPrint } from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"

const TODAY = "2026-08-01"
const age = (d: string) =>
  Math.round((Date.parse(TODAY) - Date.parse(d)) / 86_400_000)

/// Expenses & bills, opened at the top.
///
/// # Why the table is a worklist and not a summary
///
/// An overview that totals its own submenus tells a reader what they could
/// have added up themselves. The only thing this group's overview knows that
/// the submenus do not is *which item is the next problem* — a bill past its
/// date, a claim nobody has decided, an advance nobody has liquidated — and
/// those live in three different registers, so nowhere else can list them
/// together. Every row goes to the screen that can fix it.
export function ExpensesOverview() {
  const b = useBook()
  const claims = b.storeExpenses.filter((e) => e.status === "SUBMITTED")
  const openBills = b.bills.filter((x) => x.status !== "PAID")
  const overdue = openBills.filter((x) => age(x.due_on) > 0)
  const advancesOpen = b.advances.filter((a) => a.amount > a.liquidated)

  const items = [
    ...overdue.map((x) => ({
      id: x.bill_id,
      what: x.number,
      who: x.supplier,
      why: `${days(age(x.due_on))} past due`,
      amount: x.total - x.paid,
      tone: "bad" as const,
      to: "/finance-lab/expenses/bills",
      cta: "Pay",
    })),
    ...claims.map((e) => ({
      id: e.expense_id,
      what: e.description,
      who: e.submitted_by,
      why: e.note ?? "Awaiting head office",
      amount: e.amount,
      tone: "warn" as const,
      to: "/finance-lab/expenses/spend",
      cta: "Decide",
    })),
    ...advancesOpen.map((a) => ({
      id: a.advance_id,
      what: a.purpose,
      who: a.holder,
      why: `${days(age(a.issued_on))} out, ${rp(a.amount - a.liquidated)} unaccounted`,
      amount: a.amount - a.liquidated,
      tone: "warn" as const,
      to: "/finance-lab/expenses/advances",
      cta: "Liquidate",
    })),
  ].sort((a, c) => c.amount - a.amount)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Expenses & Bills"
        sub="What we owe, what we spent, and what is still waiting on somebody."
      />

      <ChartBand title="How a cost gets from an invoice to the bank">
        <Flow
          steps={[
            {
              label: "Supplier or vendor",
              value: count(b.vendors.length, "party"),
              posts: "master record",
              to: "/finance-lab/expenses/suppliers",
            },
            {
              label: "Bill recognised",
              value: rp(openBills.reduce((n, x) => n + (x.total - x.paid), 0)),
              posts: "Dr Persediaan or Biaya / Cr 2012001",
              to: "/finance-lab/expenses/bills",
              tone: overdue.length ? "warn" : undefined,
            },
            {
              label: "Overdue",
              value: rp(overdue.reduce((n, x) => n + (x.total - x.paid), 0)),
              posts: `${count(overdue.length, "bill")} past due`,
              to: "/finance-lab/expenses/bills",
              tone: overdue.length ? "bad" : "ok",
            },
            {
              label: "Paid",
              value: rp(b.bills.reduce((n, x) => n + x.paid, 0)),
              posts: "Dr 2012001 / Cr Bank",
              to: "/finance-lab/cash/transactions",
              tone: "ok",
            },
          ]}
        />
      </ChartBand>

      <Section
        title={`Needs a decision — ${items.length}`}
        sub="Everything in this group that a person has to touch, in one list."
      >
        {items.length === 0 ? (
          <EmptyState>Nothing outstanding.</EmptyState>
        ) : (
          <Table head={["Item", "Who", "Why It Is Here", ">Amount", ""]}>
            {items.map((i) => (
              <Row key={i.id} tone={i.tone}>
                <Cell>
                  <span className="text-ink">{i.what}</span>
                </Cell>
                <Cell className="text-body">{i.who}</Cell>
                <Cell className="text-body">{i.why}</Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={i.amount} />
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
              <Cell colSpan={3}>{count(items.length, "item")}</Cell>
              <Cell right>
                <Amount minor={items.reduce((n, i) => n + i.amount, 0)} />
              </Cell>
              <Cell />
            </Row>
          </Table>
        )}
      </Section>
    </PageContent>
  )
}

/// Advances — money handed out before anybody knows what it bought.
///
/// # Why this is not a prepaid and not a staff loan
///
/// Three things look alike on a bank statement and behave nothing alike:
///
///   a prepaid  — we know the cost and the period, and it releases on a
///                schedule nobody has to chase
///   an advance — we do not know the cost yet; it is settled by producing
///                receipts, and the balance is a *claim on a person*
///   a loan     — the person owes it back in money, out of pay
///
/// Putting an advance under Prepaids would give it a release schedule it
/// cannot have. Putting it under Other receivables would say the holder owes
/// us cash when what they owe us is paperwork. So it sits here, in the group
/// whose job is getting the paperwork in.
export function Advances() {
  const [printing, setPrinting] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const b = useBook()
  const [unit, setUnit] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  const [receipts, setReceipts] = useState("")

  const rows = b.advances.filter((a) => !unit || a.unit_id === unit)
  const outstanding = rows.reduce((n, a) => n + (a.amount - a.liquidated), 0)
  const stale = rows.filter(
    (a) => a.amount > a.liquidated && age(a.issued_on) > 14
  )
  const chosen = rows.find((a) => a.advance_id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Expenses & bills"
        title="Advances"
        sub="Paid first, accounted for later. The balance is receipts owed, not money owed."
        actions={
          <div className="flex items-center gap-2">
            <Select value={unit} onChange={setUnit} className={FILTER_W}>
              <option value="">All units</option>
              <option value="C006">C006</option>
              <option value="C004">C004</option>
              <option value="HO">HO</option>
            </Select>
            <Button onClick={() => setPrinting(true)}>
              <Printer className="size-3.5" />
              Print
            </Button>
            <Button variant="primary" onClick={() => setIssuing(true)}>
              Issue advance
            </Button>
          </div>
        }
      />

      <Kpis
        items={[
          {
            label: "Issued",
            value: rp(rows.reduce((n, a) => n + a.amount, 0)),
            sub: `${count(rows.length, "advance")}`,
          },
          {
            label: "Accounted for",
            value: rp(rows.reduce((n, a) => n + a.liquidated, 0)),
          },
          {
            label: "Outstanding",
            value: rp(outstanding),
            tone: outstanding ? "down" : "flat",
          },
          {
            label: "Over 14 days",
            value: String(stale.length),
            sub: stale.length ? "chase the receipts" : "none stale",
            tone: stale.length ? "down" : "flat",
          },
        ]}
      />

      <Section title={`Advances — ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState>No advance outstanding.</EmptyState>
        ) : (
          <Table
            head={[
              "Holder",
              "Unit",
              "Purpose",
              "Issued",
              "Days Out",
              ">Issued",
              ">Accounted",
              ">Outstanding",
              "",
            ]}
          >
            {rows.map((a) => {
              const left = a.amount - a.liquidated
              const days = age(a.issued_on)
              return (
                <Row
                  key={a.advance_id}
                  tone={left && days > 14 ? "warn" : undefined}
                >
                  <Cell
                    className="cursor-pointer"
                    onClick={() => setOpen(a.advance_id)}
                  >
                    <span className="text-ink">{a.holder}</span>
                  </Cell>
                  <Cell>{a.unit_id}</Cell>
                  <Cell className="text-body">{a.purpose}</Cell>
                  <Cell className="whitespace-nowrap">{a.issued_on}</Cell>
                  <Cell
                    className={
                      days > 14 && left
                        ? "font-semibold text-bad-fg"
                        : "text-body"
                    }
                  >
                    {days}
                  </Cell>
                  <Cell right>
                    <Amount minor={a.amount} />
                  </Cell>
                  <Cell right className="text-body">
                    <Amount minor={a.liquidated} muted />
                  </Cell>
                  <Cell right className="font-semibold text-ink">
                    <Amount minor={left} muted />
                  </Cell>
                  <Cell>
                    <button
                      type="button"
                      onClick={() => setOpen(a.advance_id)}
                      className="font-medium text-accent hover:underline"
                    >
                      {left ? "Liquidate" : "View"}
                    </button>
                  </Cell>
                </Row>
              )
            })}
            <Row tone="total">
              <Cell colSpan={5}>{count(rows.length, "advance")}</Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, a) => n + a.amount, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, a) => n + a.liquidated, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={outstanding} />
              </Cell>
              <Cell />
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.holder ?? ""}
        id={chosen?.advance_id}
        actions={
          chosen && chosen.amount > chosen.liquidated ? (
            <Button
              variant="primary"
              onClick={() => b.liquidateAdvance(chosen.advance_id, 0)}
            >
              Account for the rest
            </Button>
          ) : undefined
        }
      >
        {chosen && (
          <AdvanceDetail
            advance={chosen}
            receipts={receipts}
            setReceipts={setReceipts}
          />
        )}
      </Sheet>

      <NewRecord
        open={issuing}
        onOpenChange={setIssuing}
        title="Issue an advance"
        submitLabel="Pay it out"
        fields={[
          {
            name: "holder",
            label: "Who is holding it",
            required: true,
          },
          {
            name: "unit_id",
            label: "Unit",
            kind: "select",
            required: true,
            options: [
              { value: "C006", label: "C006" },
              { value: "C004", label: "C004" },
              { value: "HO", label: "HO" },
            ],
          },
          {
            name: "purpose",
            label: "What it is for",
            required: true,
          },
          {
            name: "amount",
            label: "Amount",
            kind: "money",
            required: true,
            hint: "Settled by producing receipts, not by paying it back.",
          },
        ]}
        onSubmit={(v, minor) =>
          b.issueAdvance({
            holder: v.holder,
            unit_id: v.unit_id,
            purpose: v.purpose,
            amount: minor.amount,
          })
        }
      />

      <PrintSheet open={printing} onOpenChange={setPrinting} title="Uang Muka">
        <ReportPrint
          title="Uang Muka"
          period={"Per 2026-08-01"}
          scope={`${unit || "Seluruh unit"}`}
          columns={[
            { label: "Pemegang", cell: (a) => a.holder },
            { label: "Unit", cell: (a) => a.unit_id },
            { label: "Keperluan", cell: (a) => a.purpose },
            { label: "Diterbitkan", cell: (a) => a.issued_on },
            { label: "Diberikan", align: "right", cell: (a) => rp(a.amount) },
            {
              label: "Dipertanggungjawabkan",
              align: "right",
              cell: (a) => rp(a.liquidated),
            },
            {
              label: "Sisa",
              align: "right",
              cell: (a) => rp(a.amount - a.liquidated),
            },
          ]}
          rows={rows}
          total={[
            `${rows.length} uang muka`,
            "",
            "",
            "",
            rp(rows.reduce((n, a) => n + a.amount, 0)),
            rp(rows.reduce((n, a) => n + a.liquidated, 0)),
            rp(outstanding),
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}

function AdvanceDetail({
  advance,
  receipts,
  setReceipts,
}: {
  advance: Advance
  receipts: string
  setReceipts: (v: string) => void
}) {
  const b = useBook()
  const left = advance.amount - advance.liquidated
  const payrollLink = b.payrollPayables.some(
    (p) => p.unit_id === advance.unit_id
  )
  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact term="Holder">{advance.holder}</Fact>
        <Fact term="Unit">{advance.unit_id}</Fact>
        <Fact term="Issued">{advance.issued_on}</Fact>
        <Fact term="Days out">{age(advance.issued_on)}</Fact>
        <Fact term="Purpose">{advance.purpose}</Fact>
        <Fact term="Issued amount">{rp(advance.amount)}</Fact>
        <Fact term="Accounted for">{rp(advance.liquidated)}</Fact>
        <Fact term="Outstanding">{rp(left)}</Fact>
      </Facts>

      {left > 0 && (
        <div>
          <SubHead>Account for it</SubHead>
          <p className="mt-1.5 text-meta text-body">
            Enter the receipts total. Anything not accounted for stays a balance
            against {advance.holder}
            {payrollLink
              ? ", and is recoverable from pay if it is never produced."
              : "."}
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Input
              value={receipts}
              onChange={(e) => setReceipts(e.target.value)}
              className="min-w-[12rem] flex-1"
            />
            <Button
              variant="primary"
              onClick={() =>
                b.liquidateAdvance(
                  advance.advance_id,
                  Number(receipts.replace(/\D/g, "")) * 100
                )
              }
            >
              Liquidate
            </Button>
          </div>
        </div>
      )}

      <div>
        <SubHead>What happens on liquidation</SubHead>
        <Posting
          debits={[
            {
              account: "The expense the receipts describe",
              code: "7xxxxxx — per category",
              amount: left,
            },
          ]}
          credits={[
            {
              account: `Uang Muka — ${advance.holder}`,
              code: "1011303 Uang Muka",
              amount: left,
            },
          ]}
        />
      </div>
    </div>
  )
}
