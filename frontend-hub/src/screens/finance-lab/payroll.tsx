import { useState } from "react"

import { Printer } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { Flow, Posting } from "@/screens/finance-lab/signature"
import { PrintSheet, ReportPrint } from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { type PayrollRun } from "@/screens/finance-lab/engine/subledgers"
import {
  Amount,
  Cell,
  ChartBand,
  Kpis,
  Row,
  Section,
  SubHead,
  Table,
  rp,
  days,
  count,
  FILTER_W,
} from "@/screens/finance-lab/parts"

/// Payroll, as Finance sees it.
///
/// # Why Finance has a payroll menu when People already exists
///
/// Because two different questions are being asked of the same numbers. People
/// asks who is employed, on what, and whether the manager approved it. Finance
/// asks what it cost, what is still owed, and whether the accrual agrees with
/// the payment — and the second question is answered against the general
/// ledger, not against a roster.
///
/// # Why the cost side is not its own screen
///
/// `Payroll expenses` was a screen listing the runs with their cost columns —
/// which is a profit-and-loss line with a filter on it, and the P&L already
/// draws it. So the runs moved onto this overview, where they are the working
/// list, and what stayed a screen of its own is the one thing somebody has to
/// act on: what payroll still owes.
///
/// # Why it is a top-level group and not part of Expenses & bills
///
/// This is the thing the first menu review got wrong. `2012201 ACCRUED
/// EXPENSE` has 140 leaves and five of its ten sub-accounts are payroll — Gaji
/// YMHD, THR & Insentif, Pengobatan, Asuransi/BPJS — while others are the
/// landlord's and one is the bank's interest. Filing all of it under an
/// `Accruals` menu inside Expenses would put payroll and financing back in one
/// bucket, which is the exact thing grouping by workflow was meant to prevent.
/// So payroll owns its own accruals here, and the accountant who wants to see
/// every accrual at once has Accounting & close → Accruals & deferrals.
const TODAY = "2026-08-01"
const age = (d: string) =>
  Math.round((Date.parse(TODAY) - Date.parse(d)) / 86_400_000)

const cost = (r: PayrollRun) =>
  r.basic + r.allowance + r.overtime + r.bpjs_employer
const net = (r: PayrollRun) =>
  r.basic + r.allowance + r.overtime - r.pph21 - r.bpjs_employee

export function PayrollOverview() {
  const b = useBook()
  const [period, setPeriod] = useState("2026-07")
  const [open, setOpen] = useState<string | null>(null)

  const rows = b.payrollRuns.filter((r) => !period || r.period === period)
  const total = rows.reduce((n, r) => n + cost(r), 0)
  const heads = rows.reduce((n, r) => n + r.headcount, 0)
  const unpaid = b.payrollPayables.filter((p) => p.amount > p.settled)
  const chosen = b.payrollRuns.find((r) => r.run_id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Payroll"
        sub="What people cost, run by run. What is still owed to them is on Payables."
        actions={
          <div className="flex items-center gap-2">
            <Select value={period} onChange={setPeriod} className={FILTER_W}>
              <option value="2026-07">July 2026</option>
              <option value="2026-06">June 2026</option>
              <option value="">All periods</option>
            </Select>
            <Button
              variant="primary"
              onClick={() =>
                rows.forEach((r) => b.runPayroll(r.unit_id, r.period))
              }
            >
              Run payroll
            </Button>
          </div>
        }
      />

      <ChartBand title="How a month's pay becomes money in somebody's account">
        <Flow
          steps={[
            {
              label: "Run approved",
              value: count(
                rows.reduce((n, r) => n + r.headcount, 0),
                "person"
              ),
              posts: `${count(rows.length, "run")} this period`,
            },
            {
              label: "Cost recognised",
              value: rp(total),
              posts: "Dr Beban Pegawai / Cr Gaji YMHD",
              to: "/finance-lab/reports/profit-loss",
            },
            {
              label: "Owed",
              value: rp(unpaid.reduce((n, p) => n + (p.amount - p.settled), 0)),
              posts: "2012201 · and PPh 21 on 2012101",
              to: "/finance-lab/payroll/payables",
              tone: unpaid.length ? "warn" : "ok",
            },
            {
              label: "Paid",
              value: rp(b.payrollPayables.reduce((n, p) => n + p.settled, 0)),
              posts: "Dr Gaji YMHD / Cr Bank",
              to: "/finance-lab/cash/transactions",
              tone: "ok",
            },
          ]}
        />
      </ChartBand>

      <Section title={`Runs — ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState>No run in this period.</EmptyState>
        ) : (
          <Table
            head={[
              "Unit",
              "Period",
              ">People",
              ">Basic",
              ">Allowance",
              ">Overtime",
              ">BPJS Employer",
              ">Cost",
              "Status",
            ]}
          >
            {rows.map((r) => (
              <Row
                key={r.run_id}
                className="hover:bg-soft-1 cursor-pointer"
                tone={r.status === "DRAFT" ? "warn" : undefined}
              >
                <Cell onClick={() => setOpen(r.run_id)}>
                  <span className="text-ink">{r.unit_id}</span>
                </Cell>
                <Cell className="whitespace-nowrap">{r.period}</Cell>
                <Cell right>{r.headcount}</Cell>
                <Cell right>
                  <Amount minor={r.basic} />
                </Cell>
                <Cell right className="text-body">
                  <Amount minor={r.allowance} />
                </Cell>
                <Cell right className="text-body">
                  <Amount minor={r.overtime} />
                </Cell>
                <Cell right className="text-body">
                  <Amount minor={r.bpjs_employer} />
                </Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={cost(r)} />
                </Cell>
                <Cell>
                  <Pill
                    tone={
                      r.status === "PAID"
                        ? "ok"
                        : r.status === "POSTED"
                          ? "info"
                          : "warn"
                    }
                  >
                    {r.status.toLowerCase()}
                  </Pill>
                </Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={2}>{count(rows.length, "run")}</Cell>
              <Cell right>{heads}</Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, r) => n + r.basic, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, r) => n + r.allowance, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, r) => n + r.overtime, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, r) => n + r.bpjs_employer, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={total} />
              </Cell>
              <Cell />
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen ? `${chosen.unit_id} — ${chosen.period}` : ""}
        id={chosen?.run_id}
        actions={
          chosen && chosen.status !== "PAID" ? (
            <Button
              variant="primary"
              onClick={() => b.runPayroll(chosen.unit_id, chosen.period)}
            >
              Accrue
            </Button>
          ) : undefined
        }
      >
        {chosen && <RunDetail run={chosen} />}
      </Sheet>
    </PageContent>
  )
}

function RunDetail({ run }: { run: PayrollRun }) {
  const b = useBook()
  const loans = b.staffLoans.filter(
    (l) => l.unit_id === run.unit_id && l.principal > l.repaid
  )
  const deductions = loans.reduce((n, l) => n + l.instalment, 0)
  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact term="Unit">{run.unit_id}</Fact>
        <Fact term="Period">{run.period}</Fact>
        <Fact term="Headcount">{run.headcount}</Fact>
        <Fact term="Status">{run.status.toLowerCase()}</Fact>
        <Fact term="Cost to the business">{rp(cost(run))}</Fact>
        <Fact term="Net to employees">{rp(net(run) - deductions)}</Fact>
        <Fact term="Paid on">{run.paid_on ?? "—"}</Fact>
      </Facts>

      <div>
        <SubHead>Gross to net</SubHead>
        <Table head={["Line", "Whose Money", ">Amount"]}>
          <Row>
            <Cell>Basic</Cell>
            <Cell className="text-body">Cost</Cell>
            <Cell right>
              <Amount minor={run.basic} />
            </Cell>
          </Row>
          <Row>
            <Cell>Allowance</Cell>
            <Cell className="text-body">Cost</Cell>
            <Cell right>
              <Amount minor={run.allowance} />
            </Cell>
          </Row>
          <Row>
            <Cell>Overtime</Cell>
            <Cell className="text-body">Cost</Cell>
            <Cell right>
              <Amount minor={run.overtime} />
            </Cell>
          </Row>
          <Row>
            <Cell>BPJS — employer share</Cell>
            <Cell className="text-body">Cost, not paid to the employee</Cell>
            <Cell right>
              <Amount minor={run.bpjs_employer} />
            </Cell>
          </Row>
          <Row tone="muted">
            <Cell>PPh 21 withheld</Cell>
            <Cell className="text-body">Owed to the state</Cell>
            <Cell right>
              <Amount minor={-run.pph21} muted />
            </Cell>
          </Row>
          <Row tone="muted">
            <Cell>BPJS — employee share</Cell>
            <Cell className="text-body">Owed to BPJS</Cell>
            <Cell right>
              <Amount minor={-run.bpjs_employee} muted />
            </Cell>
          </Row>
          {deductions > 0 && (
            <Row tone="muted">
              <Cell>Loan deductions</Cell>
              <Cell className="text-body">
                {count(loans.length, "person")}, recovered to 1011102
              </Cell>
              <Cell right>
                <Amount minor={-deductions} muted />
              </Cell>
            </Row>
          )}
          <Row tone="total">
            <Cell colSpan={2}>Net paid into bank accounts</Cell>
            <Cell right>
              <Amount minor={net(run) - deductions} />
            </Cell>
          </Row>
        </Table>
        <p className="mt-2 text-meta text-mute">
          Cost to the business is {rp(cost(run))} — the employer's BPJS is a
          cost even though nobody receives it, and the two withholdings are not
          costs even though they leave the gross.
        </p>
      </div>
    </div>
  )
}

/// Payroll payables — what payroll still owes, and to whom.
export function PayrollPayables() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [period, setPeriod] = useState("")
  const [open, setOpen] = useState<string | null>(null)

  const rows = b.payrollPayables.filter((p) => !period || p.period === period)
  const outstanding = rows.reduce((n, p) => n + (p.amount - p.settled), 0)
  const overdue = rows.filter((p) => p.amount > p.settled && age(p.due_on) > 0)
  const chosen = rows.find((p) => p.id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Payroll"
        title="Payables"
        sub="Gaji YMHD, THR, BPJS and PPh 21 — the payroll third of 2012201, plus the tax."
        actions={
          <div className="flex items-center gap-2">
            <Select value={period} onChange={setPeriod} className={FILTER_W}>
              <option value="">All periods</option>
              <option value="2026-07">July 2026</option>
              <option value="2026-06">June 2026</option>
            </Select>
            <Button
              variant="primary"
              onClick={() =>
                rows
                  .filter((p) => p.amount > p.settled)
                  .forEach((p) => b.settlePayrollPayable(p.id))
              }
            >
              Settle all
            </Button>
            <Button onClick={() => setPrinting(true)}>
              <Printer className="size-3.5" />
              Print
            </Button>
          </div>
        }
      />

      <Kpis
        items={[
          {
            label: "Outstanding",
            value: rp(outstanding),
            sub: `${count(rows.filter((p) => p.amount > p.settled).length, "item")}`,
          },
          {
            label: "Past due",
            value: rp(overdue.reduce((n, p) => n + (p.amount - p.settled), 0)),
            sub: `${count(overdue.length, "item")}`,
            tone: overdue.length ? "down" : "flat",
          },
          {
            label: "Owed to employees",
            value: rp(
              rows
                .filter(
                  (p) => p.kind.startsWith("Gaji") || p.kind.startsWith("THR")
                )
                .reduce((n, p) => n + (p.amount - p.settled), 0)
            ),
          },
          {
            label: "Owed to the state and BPJS",
            value: rp(
              rows
                .filter(
                  (p) => p.kind.includes("PPh") || p.kind.includes("BPJS")
                )
                .reduce((n, p) => n + (p.amount - p.settled), 0)
            ),
          },
        ]}
      />

      <Section title={`Payables — ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState>Payroll owes nothing.</EmptyState>
        ) : (
          <Table
            head={[
              "What",
              "Account",
              "Unit",
              "Period",
              "Due",
              ">Accrued",
              ">Settled",
              ">Outstanding",
              "Status",
            ]}
          >
            {rows.map((p) => {
              const left = p.amount - p.settled
              const late = left > 0 && age(p.due_on) > 0
              return (
                <Row
                  key={p.id}
                  className="hover:bg-soft-1 cursor-pointer"
                  tone={late ? "bad" : undefined}
                >
                  <Cell onClick={() => setOpen(p.id)}>
                    <span className="text-ink">{p.kind}</span>
                  </Cell>
                  <Cell mono className="text-mute">
                    {p.account}
                  </Cell>
                  <Cell>{p.unit_id}</Cell>
                  <Cell className="whitespace-nowrap">{p.period}</Cell>
                  <Cell className="whitespace-nowrap">
                    {p.due_on}
                    {late && (
                      <div className="text-eyebrow text-bad-fg">
                        {days(age(p.due_on))} late
                      </div>
                    )}
                  </Cell>
                  <Cell right>
                    <Amount minor={p.amount} />
                  </Cell>
                  <Cell right className="text-body">
                    <Amount minor={p.settled} muted />
                  </Cell>
                  <Cell right className="font-semibold text-ink">
                    <Amount minor={left} muted />
                  </Cell>
                  <Cell>
                    <Pill tone={left === 0 ? "ok" : late ? "bad" : "warn"}>
                      {left === 0 ? "settled" : late ? "overdue" : "accrued"}
                    </Pill>
                  </Cell>
                </Row>
              )
            })}
            <Row tone="total">
              <Cell colSpan={5}>{count(rows.length, "item")}</Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, p) => n + p.amount, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, p) => n + p.settled, 0)} />
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
        title={chosen?.kind ?? ""}
        id={chosen?.id}
        actions={
          chosen && chosen.amount > chosen.settled ? (
            <Button
              variant="primary"
              onClick={() => b.settlePayrollPayable(chosen.id)}
            >
              Settle
            </Button>
          ) : undefined
        }
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Account">{chosen.account}</Fact>
              <Fact term="Unit">{chosen.unit_id}</Fact>
              <Fact term="Period">{chosen.period}</Fact>
              <Fact term="Due">{chosen.due_on}</Fact>
              <Fact term="Accrued">{rp(chosen.amount)}</Fact>
              <Fact term="Settled">{rp(chosen.settled)}</Fact>
              <Fact term="Outstanding">
                {rp(chosen.amount - chosen.settled)}
              </Fact>
            </Facts>
            <div>
              <SubHead>What settling it posts</SubHead>
              <Posting
                debits={[
                  {
                    account: chosen.kind,
                    code: chosen.account,
                    amount: chosen.amount - chosen.settled,
                  },
                ]}
                credits={[
                  {
                    account: `Bank — ${chosen.unit_id}`,
                    code: "1011003",
                    amount: chosen.amount - chosen.settled,
                  },
                ]}
              />
              <p className="mt-2 text-meta text-mute">
                The cost was recognised when the accrual was raised. Settling it
                moves money and clears the liability — it does not touch the
                profit and loss again.
              </p>
            </div>
          </div>
        )}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Daftar Kewajiban Payroll"
      >
        <ReportPrint
          title="Daftar Kewajiban Payroll"
          period={"Per 2026-08-01"}
          scope={`${period || "Seluruh periode"}`}
          columns={[
            { label: "Jenis", cell: (x) => x.kind },
            { label: "Perkiraan", cell: (x) => x.account },
            { label: "Unit", cell: (x) => x.unit_id },
            { label: "Periode", cell: (x) => x.period },
            { label: "Jatuh tempo", cell: (x) => x.due_on },
            { label: "Diakru", align: "right", cell: (x) => rp(x.amount) },
            { label: "Dibayar", align: "right", cell: (x) => rp(x.settled) },
            {
              label: "Sisa",
              align: "right",
              cell: (x) => rp(x.amount - x.settled),
            },
          ]}
          rows={rows}
          total={[
            `${rows.length} item`,
            "",
            "",
            "",
            "",
            rp(rows.reduce((n, x) => n + x.amount, 0)),
            rp(rows.reduce((n, x) => n + x.settled, 0)),
            rp(outstanding),
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}
