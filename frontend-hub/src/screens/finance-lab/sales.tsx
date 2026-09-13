import { useState } from "react"

import { Printer } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { TRADE } from "@/screens/finance-lab/engine/data"
import { Flow } from "@/screens/finance-lab/signature"
import { PrintSheet, ReportPrint } from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"
import { type StaffLoan } from "@/screens/finance-lab/engine/subledgers"
import {
  Amount,
  Cell,
  ChartBand,
  Kpis,
  Row,
  Section,
  SubHead,
  Table,
  days,
  count,
  rp,
  FILTER_W,
} from "@/screens/finance-lab/parts"

const TODAY = "2026-08-01"
const age = (d: string) =>
  Math.round((Date.parse(TODAY) - Date.parse(d)) / 86_400_000)

/// Sales, opened at the top.
///
/// # Why Sales is two screens and Revenue & margin is not one of them
///
/// Finance's job on sales is not to report them — Reports does that, off the
/// same journal. It is to make sure what the shops and the till recorded
/// actually arrived: banked, settled, and posted. That is one verb, and it is
/// why the group's only other screen is Reconcile.
///
/// The chart is the month's trade, because for a shop that is the number, and
/// the table underneath is the only list a submenu cannot produce: everything
/// about the takings that is still unfinished — a day not banked, a batch not
/// settled, a drawer that came up short.
export function SalesOverview() {
  const b = useBook()
  const [unit, setUnit] = useState("")
  const tradingDays = b.storeDays.filter((d) => !unit || d.unit_id === unit)
  const unsettled = b.cardBatches.filter((x) => !x.settled_on)

  const items = [
    ...tradingDays
      .filter((d) => d.deposited === 0)
      .map((d) => ({
        id: `dep-${d.day_id}`,
        what: `${d.on} takings not banked`,
        who: d.unit_id,
        why: d.note ?? "Counted but never reached the bank",
        amount: d.counted_cash,
        tone: "warn" as const,
        to: "/finance-lab/sales/reconcile",
        cta: "Reconcile",
      })),
    ...tradingDays
      .filter((d) => d.counted_cash !== d.rung_cash)
      .map((d) => ({
        id: `var-${d.day_id}`,
        what: `${d.on} drawer variance`,
        who: d.unit_id,
        why: d.note ?? "Counted does not equal rung",
        amount: Math.abs(d.counted_cash - d.rung_cash),
        tone: "bad" as const,
        to: "/finance-lab/sales/reconcile",
        cta: "Investigate",
      })),
    ...unsettled
      .filter((x) => age(x.expected_on) > 0)
      .map((x) => ({
        id: `set-${x.batch_id}`,
        what: `${x.acquirer} ${x.batch_id}`,
        who: x.unit_id,
        why: `${days(age(x.expected_on))} past the expected payout`,
        amount: x.gross,
        tone: "bad" as const,
        to: "/finance-lab/receivables/settlements",
        cta: "Chase",
      })),
  ].sort((a, b) => b.amount - a.amount)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Sales"
        sub="What the shops took, and everything about it that has not arrived."
        actions={
          <Select value={unit} onChange={setUnit} className={FILTER_W}>
            <option value="">All stores</option>
            <option value="C006">C006</option>
            <option value="C004">C004</option>
          </Select>
        }
      />

      <ChartBand title="How a day's takings reach the bank">
        <Flow
          steps={[
            {
              label: "Till rings",
              value: rp(TRADE.reduce((n, t) => n + t.cash + t.card, 0)),
              posts: "Dr Kas / Cr Penjualan · Dr HPP / Cr Persediaan",
              to: "/finance-lab/reports/profit-loss",
            },
            {
              label: "Drawer counted",
              value: rp(tradingDays.reduce((n, d) => n + d.counted_cash, 0)),
              posts: "no posting — a count, not an event",
              to: "/finance-lab/sales/reconcile",
            },
            {
              label: "Banked",
              value: rp(tradingDays.reduce((n, d) => n + d.deposited, 0)),
              posts: "Dr Hutang Afiliasi / Cr Kas",
              to: "/finance-lab/sales/reconcile",
              tone: tradingDays.some((d) => d.deposited === 0) ? "warn" : "ok",
            },
            {
              label: "Card & marketplace",
              value: rp(unsettled.reduce((n, x) => n + x.gross, 0)),
              posts: "followed in Receivables",
              to: "/finance-lab/receivables/settlements",
              tone: unsettled.length ? "warn" : "ok",
            },
          ]}
        />
      </ChartBand>

      <Section
        title={`Unfinished — ${items.length}`}
        sub="Takings that have not landed, and days that do not add up."
      >
        {items.length === 0 ? (
          <EmptyState>Everything is banked and settled.</EmptyState>
        ) : (
          <Table head={["Item", "Store", "Why it is here", ">Amount", ""]}>
            {items.map((i) => (
              <Row key={i.id} tone={i.tone}>
                <Cell>
                  <span className="text-ink">{i.what}</span>
                </Cell>
                <Cell>{i.who}</Cell>
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

/// Receivables, opened at the top.
///
/// # What is in this group and what is not
///
/// Everything the business is still owed, in two screens rather than four. The
/// balance and its age is one question — `Receivables` — and chasing a
/// particular payout is another — `Settlements`. Staff loans are on the first
/// of those and not on a third screen: `1011102 PIUTANG LAIN-LAIN` is five
/// accounts, and a menu for five accounts is a menu for its own sake.
export function ReceivablesOverview() {
  const b = useBook()
  const unsettled = b.cardBatches.filter((x) => !x.settled_on)
  const loans = b.staffLoans.filter((l) => l.principal > l.repaid)
  const trade = unsettled.reduce((n, x) => n + x.gross, 0)
  const other = loans.reduce((n, l) => n + (l.principal - l.repaid), 0)
  const openInquiries = b.inquiries.filter((q) => q.status === "OPEN")

  const items = [
    ...unsettled
      .filter((x) => age(x.expected_on) > 0)
      .map((x) => ({
        id: x.batch_id,
        what: `${x.acquirer} ${x.batch_id}`,
        who: x.unit_id,
        why: `${days(age(x.expected_on))} past the expected payout`,
        amount: x.gross,
        tone: "bad" as const,
        to: "/finance-lab/receivables/settlements",
        cta: "Chase",
      })),
    ...loans
      .filter((l) => !l.instalment)
      .map((l) => ({
        id: l.loan_id,
        what: l.person,
        who: l.unit_id,
        why: "No deduction set, so nothing comes back on its own",
        amount: l.principal - l.repaid,
        tone: "warn" as const,
        to: "/finance-lab/receivables/balances",
        cta: "Set a deduction",
      })),
  ].sort((a, c) => c.amount - a.amount)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Receivables"
        sub="Everything still owed to the business, and what is not coming back on its own."
      />

      <ChartBand title="How money owed to us turns into money">
        <Flow
          steps={[
            {
              label: "Taken at the till",
              value: rp(trade),
              posts: "Dr Piutang kartu / Cr Penjualan",
              to: "/finance-lab/sales/reconcile",
            },
            {
              label: "Waiting on the payer",
              value: count(unsettled.length, "batch"),
              posts: "1011101 — acquirer or marketplace",
              to: "/finance-lab/receivables/settlements",
              tone: unsettled.length ? "warn" : "ok",
            },
            {
              label: "Chased",
              value: count(openInquiries.length, "inquiry"),
              posts: "no posting — a question with a life",
              to: "/finance-lab/receivables/settlements",
              tone: openInquiries.length ? "bad" : "ok",
            },
            {
              label: "Lent to people",
              value: rp(other),
              posts: "1011102 — recovered from pay",
              to: "/finance-lab/receivables/balances",
            },
          ]}
        />
      </ChartBand>

      <Section title={`Needs chasing — ${items.length}`}>
        {items.length === 0 ? (
          <EmptyState>Everything is on schedule.</EmptyState>
        ) : (
          <Table head={["Item", "Unit", "Why it is here", ">Amount", ""]}>
            {items.map((i) => (
              <Row key={i.id} tone={i.tone}>
                <Cell>
                  <span className="text-ink">{i.what}</span>
                </Cell>
                <Cell>{i.who}</Cell>
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

/// Receivables — the balance, by counterparty and by age.
///
/// # Why this exists next to Settlements, when some of it is the same money
///
/// Because it is the same money asked a different question. Settlements asks
/// *where is this batch and who do I ring* — a worklist, one row per document,
/// and it empties as things land. This asks *what is the balance, how old is
/// it, and is any of it not coming* — one row per counterparty, aged, and it
/// never empties because a balance is not a task.
///
/// The client's chart makes the second question a real one: `1011103 CADANGAN
/// PENGHAPUSAN PIUTANG TAK TERTAGIH` is an allowance account, and an allowance
/// is set by looking at an ageing, not at a worklist.
///
/// # Why staff loans are on this screen
///
/// `1011102 PIUTANG LAIN-LAIN` — pegawai, kepala toko, manajemen — is money the
/// business is owed, so it belongs in the receivable balance. It behaves
/// differently enough to need its own columns (an instalment, not a due date),
/// which is what the `Kind` filter is for, and not different enough to need its
/// own menu.
export function Receivables() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [kind, setKind] = useState("")
  const [open, setOpen] = useState<string | null>(null)

  const trade = [
    ...new Set(
      b.cardBatches.filter((x) => !x.settled_on).map((x) => x.acquirer)
    ),
  ].map((name) => {
    const batches = b.cardBatches.filter(
      (x) => x.acquirer === name && !x.settled_on
    )
    return {
      key: name,
      who: name,
      kind: "TRADE" as const,
      detail: batches[0].channel.toLowerCase(),
      account: batches[0].channel === "CREDIT" ? "1011101001" : "1011101002",
      balance: batches.reduce((n, x) => n + x.gross, 0),
      oldest: Math.max(...batches.map((x) => age(x.captured_on))),
      recovers: 0,
      batches,
      loan: undefined as StaffLoan | undefined,
    }
  })

  const staff = b.staffLoans
    .filter((l) => l.principal > l.repaid)
    .map((l) => ({
      key: l.loan_id,
      who: l.person,
      kind: "OTHER" as const,
      detail: l.role.toLowerCase(),
      account: l.account,
      balance: l.principal - l.repaid,
      oldest: age(l.issued_on),
      recovers: l.instalment,
      batches: [] as typeof b.cardBatches,
      loan: l as StaffLoan | undefined,
    }))

  const rows = [...trade, ...staff]
    .filter((r) => !kind || r.kind === kind)
    .sort((a, b) => b.balance - a.balance)

  const total = rows.reduce((n, r) => n + r.balance, 0)
  const allowance = b.provisions
    .filter((p) => p.name.includes("ragu-ragu"))
    .reduce((n, p) => n + p.opening + p.charged - p.used, 0)
  const chosen = rows.find((r) => r.key === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Receivables"
        title="Receivables"
        sub="1011101 and 1011102 — by counterparty and by age. The worklist behind it is Settlements."
        actions={
          <div className="flex items-center gap-2">
            <Select value={kind} onChange={setKind} className={FILTER_W}>
              <option value="">All kinds</option>
              <option value="TRADE">Trade — 1011101</option>
              <option value="OTHER">Staff & management — 1011102</option>
            </Select>
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
            label: "Receivable",
            value: rp(total),
            sub: `${count(rows.length, "counterparty")}`,
          },
          {
            label: "Over 30 days",
            value: rp(
              rows
                .filter((r) => r.oldest > 30)
                .reduce((n, r) => n + r.balance, 0)
            ),
            tone: rows.some((r) => r.oldest > 30) ? "down" : "flat",
          },
          { label: "Allowance held", value: rp(allowance), sub: "1011103" },
          { label: "Net of allowance", value: rp(total - allowance) },
        ]}
      />

      <Section title={`Counterparties — ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState>Nothing outstanding.</EmptyState>
        ) : (
          <Table
            head={[
              "Counterparty",
              "Kind",
              "Account",
              "Oldest",
              ">Recovers monthly",
              ">Balance",
              "",
            ]}
          >
            {rows.map((r) => (
              <Row
                key={r.key}
                className="hover:bg-soft-1 cursor-pointer"
                tone={r.oldest > 30 ? "warn" : undefined}
              >
                <Cell onClick={() => setOpen(r.key)}>
                  <span className="text-ink">{r.who}</span>
                  <div className="text-eyebrow text-faint">
                    {r.batches.length
                      ? `${count(r.batches.length, "batch")}`
                      : r.detail}
                  </div>
                </Cell>
                <Cell>
                  <Pill tone={r.kind === "TRADE" ? "accent" : "neutral"}>
                    {r.kind === "TRADE" ? r.detail : "staff loan"}
                  </Pill>
                </Cell>
                <Cell mono className="text-mute">
                  {r.account}
                </Cell>
                <Cell
                  className={
                    r.oldest > 30 ? "font-semibold text-bad-fg" : "text-body"
                  }
                >
                  {days(r.oldest)}
                </Cell>
                <Cell right className="text-body">
                  <Amount minor={r.recovers} muted />
                </Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={r.balance} />
                </Cell>
                <Cell>
                  <button
                    type="button"
                    onClick={() => setOpen(r.key)}
                    className="font-medium text-accent hover:underline"
                  >
                    Open
                  </button>
                </Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={4}>{count(rows.length, "counterparty")}</Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, r) => n + r.recovers, 0)} />
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
        title={chosen?.who ?? ""}
        actions={
          chosen ? (
            <Button
              variant="primary"
              onClick={() =>
                chosen.loan
                  ? b.deductStaffLoan(chosen.loan.loan_id)
                  : b.raiseInquiry(
                      chosen.batches[0]?.batch_id ?? "",
                      "Where is this settlement?"
                    )
              }
            >
              {chosen.kind === "TRADE" ? "Raise inquiry" : "Deduct from pay"}
            </Button>
          ) : undefined
        }
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Kind">
                {chosen.kind === "TRADE" ? "trade" : "staff & management"}
              </Fact>
              <Fact term="Account">{chosen.account}</Fact>
              <Fact term="Balance">{rp(chosen.balance)}</Fact>
              <Fact term="Oldest">{days(chosen.oldest)}</Fact>
              {chosen.recovers > 0 && (
                <Fact term="Recovers">{rp(chosen.recovers)} per month</Fact>
              )}
            </Facts>
            {chosen.loan ? (
              <LoanSchedule loan={chosen.loan} />
            ) : (
              <div>
                <SubHead>What makes up the balance</SubHead>
                <Table
                  head={[
                    "Batch",
                    "Store",
                    "Captured",
                    "Expected",
                    "Age",
                    ">Gross",
                  ]}
                >
                  {chosen.batches.map((x) => (
                    <Row
                      key={x.batch_id}
                      tone={age(x.captured_on) > 14 ? "warn" : undefined}
                    >
                      <Cell mono>{x.batch_id}</Cell>
                      <Cell>{x.unit_id}</Cell>
                      <Cell className="whitespace-nowrap">{x.captured_on}</Cell>
                      <Cell className="whitespace-nowrap">{x.expected_on}</Cell>
                      <Cell className="text-body">
                        {days(age(x.captured_on))}
                      </Cell>
                      <Cell right>
                        <Amount minor={x.gross} />
                      </Cell>
                    </Row>
                  ))}
                  <Row tone="total">
                    <Cell colSpan={5}>
                      {count(chosen.batches.length, "batch")}
                    </Cell>
                    <Cell right>
                      <Amount minor={chosen.balance} />
                    </Cell>
                  </Row>
                </Table>
              </div>
            )}
          </div>
        )}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Daftar Piutang"
      >
        <ReportPrint
          title="Daftar Piutang"
          period={"Per 2026-08-01"}
          scope={`${kind || "Dagang dan lain-lain"}`}
          columns={[
            { label: "Pihak", cell: (r) => r.who },
            {
              label: "Jenis",
              cell: (r) => (r.kind === "TRADE" ? r.detail : "pinjaman staf"),
            },
            { label: "Perkiraan", cell: (r) => r.account },
            { label: "Umur", cell: (r) => days(r.oldest) },
            { label: "Angsuran", align: "right", cell: (r) => rp(r.recovers) },
            { label: "Saldo", align: "right", cell: (r) => rp(r.balance) },
          ]}
          rows={rows}
          total={[
            `${rows.length} pihak`,
            "",
            "",
            "",
            rp(rows.reduce((n, r) => n + r.recovers, 0)),
            rp(total),
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}

/// The remaining schedule on a staff loan, shown inside the receivable's sheet.
function LoanSchedule({ loan }: { loan: StaffLoan }) {
  const left = loan.principal - loan.repaid
  const months = loan.instalment ? Math.ceil(left / loan.instalment) : 0
  const start = new Date(TODAY)
  return (
    <div>
      <SubHead>Remaining schedule</SubHead>
      {months === 0 ? (
        <p className="mt-2 text-meta text-warn-fg">
          No deduction is set, so nothing will come back on its own.
        </p>
      ) : (
        <Table head={["Payroll month", ">Deduction", ">Balance after"]}>
          {Array.from({ length: Math.min(months, 12) }, (_, i) => {
            const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
            const take = Math.min(loan.instalment, left - loan.instalment * i)
            return (
              <Row key={i}>
                <Cell>{`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`}</Cell>
                <Cell right>
                  <Amount minor={take} />
                </Cell>
                <Cell right>
                  <Amount
                    minor={Math.max(0, left - loan.instalment * (i + 1))}
                    muted
                  />
                </Cell>
              </Row>
            )
          })}
          <Row tone="total">
            <Cell>{months} months</Cell>
            <Cell right>
              <Amount minor={left} />
            </Cell>
            <Cell right>
              <Amount minor={0} muted />
            </Cell>
          </Row>
        </Table>
      )}
    </div>
  )
}
