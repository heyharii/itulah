import { useState } from "react"

import { Printer } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { Flow, Posting } from "@/screens/finance-lab/signature"
import { PrintSheet, ReportPrint } from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { LOANS, type Loan } from "@/screens/finance-lab/engine/data"
import {
  Amount,
  Cell,
  ChartBand,
  Kpis,
  MoneyBars,
  Row,
  Section,
  SubHead,
  Table,
  rp,
  days,
  count,
  FILTER_W,
  NewRecord,
} from "@/screens/finance-lab/parts"

/// Financing — borrowed money, and the owner's own.
///
/// # Why Repayments carries the schedule too
///
/// `Interest & maturities` was a separate screen listing the instalments not
/// yet paid, next to a `Repayments` screen listing the ones that were. That is
/// one table with a filter, and splitting it meant the reader had to know which
/// half of a loan schedule they wanted before they could look at either. So
/// Repayments shows the whole schedule, defaulted to what is due, and the
/// interest/principal split — the only distinction that matters, because only
/// one of the two is a cost — is two columns rather than two menus.
///
/// # Why Equity is a screen inside Financing and not a group of its own
///
/// `3013001` has four sub-accounts and only two of them are ever entered by a
/// person: Modal Setor, when capital goes in, and Prive, when the owner takes
/// money out. The other two — Laba Ditahan and Laba bulan berjalan — are
/// produced by the close and would be read-only wherever they were put.
///
/// A top-level Equity group would therefore be one screen, half of it
/// untouchable. Financing already holds the other question of the same shape —
/// *where is the money coming from* — so equity sits beside debt, which is also
/// where anybody comparing the two would look.
const TODAY = "2026-08-01"
const age = (d: string) =>
  Math.round((Date.parse(TODAY) - Date.parse(d)) / 86_400_000)

const outstandingOf = (l: Loan) =>
  l.principal - Math.round((l.principal * l.paid_months) / l.months / 100) * 100

export function FinancingOverview() {
  const b = useBook()
  const debt = LOANS.reduce((n, l) => n + outstandingOf(l), 0)
  const next = b.loanSchedule.filter((p) => !p.paid_on).slice(0, 6)
  const interestAccrued = b.payrollPayables
    .filter((p) => p.kind.includes("Bunga"))
    .reduce((n, p) => n + (p.amount - p.settled), 0)

  const items = [
    ...next.slice(0, 3).map((p) => ({
      id: `sch-${p.n}`,
      what: `Instalment ${p.n} — BCA kredit investasi`,
      why:
        age(p.due_on) > 0
          ? `${days(age(p.due_on))} past due`
          : `Due ${p.due_on}`,
      amount: p.interest + p.principal,
      tone: age(p.due_on) > 0 ? ("bad" as const) : ("warn" as const),
      to: "/finance-lab/financing/repayments",
      cta: "Pay",
    })),
    ...b.equityMoves
      .filter((e) => e.kind === "Prive")
      .map((e) => ({
        id: e.id,
        what: `Prive — ${e.on}`,
        why: e.note ?? "Owner drawing, not a cost",
        amount: Math.abs(e.amount),
        tone: "warn" as const,
        to: "/finance-lab/financing/equity",
        cta: "Review",
      })),
  ]

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Financing"
        sub="Where the money comes from — the bank's, and the owner's."
      />

      <ChartBand title="Where the money comes from, and what it costs">
        <Flow
          steps={[
            {
              label: "Owner's capital",
              value: rp(
                b.equityMoves
                  .filter((e) => e.kind === "Modal Setor")
                  .reduce((n, e) => n + e.amount, 0)
              ),
              posts: "Dr Bank / Cr 3013001001",
              to: "/finance-lab/financing/equity",
            },
            {
              label: "Borrowed",
              value: rp(debt),
              posts: "2022402 · 2012502 falling due",
              to: "/finance-lab/financing/loans",
            },
            {
              label: "Interest",
              value: rp(next.reduce((n, p) => n + p.interest, 0)),
              posts: "Dr 8020111 / Cr Bank — the only cost here",
              to: "/finance-lab/financing/repayments",
              tone: next.length ? "warn" : "ok",
            },
            {
              label: "Drawn out",
              value: rp(
                Math.abs(
                  b.equityMoves
                    .filter((e) => e.kind === "Prive")
                    .reduce((n, e) => n + e.amount, 0)
                )
              ),
              posts: "Dr 3013001004 Prive / Cr Bank",
              to: "/finance-lab/financing/equity",
            },
          ]}
        />
      </ChartBand>

      <Section title={`Coming up — ${items.length}`}>
        {items.length === 0 ? (
          <EmptyState>Nothing due and nothing drawn.</EmptyState>
        ) : (
          <Table head={["Item", "Why It Is Here", ">Amount", ""]}>
            {items.map((i) => (
              <Row key={i.id} tone={i.tone}>
                <Cell>
                  <span className="text-ink">{i.what}</span>
                </Cell>
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
              <Cell colSpan={2}>
                {count(items.length, "item")}
                {interestAccrued
                  ? ` · ${rp(interestAccrued)} interest accrued`
                  : ""}
              </Cell>
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

/// Loans — the facilities themselves.
export function Loans() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [open, setOpen] = useState<string | null>(null)
  const chosen = LOANS.find((l) => l.loan_id === open)
  const debt = LOANS.reduce((n, l) => n + outstandingOf(l), 0)

  return (
    <PageContent>
      <PageHeader
        crumb="Financing"
        title="Loans"
        sub="Facilities drawn, and what is left on each."

        actions={
          <Button onClick={() => setPrinting(true)}>
            <Printer className="size-3.5" />
            Print
          </Button>
        }
      />

      <Kpis
        items={[
          {
            label: "Outstanding",
            value: rp(debt),
            sub: `${count(LOANS.length, "facility")}`,
          },
          {
            label: "Drawn",
            value: rp(LOANS.reduce((n, l) => n + l.principal, 0)),
          },
          {
            label: "Repaid",
            value: rp(
              LOANS.reduce((n, l) => n + l.principal - outstandingOf(l), 0)
            ),
          },
          {
            label: "Weighted rate",
            value: `${(
              LOANS.reduce((n, l) => n + (l.rate_bps * l.principal) / 100, 0) /
              Math.max(
                1,
                LOANS.reduce((n, l) => n + l.principal, 0)
              ) /
              100
            ).toFixed(2)}%`,
          },
        ]}
      />

      <Section title={`Facilities — ${LOANS.length}`}>
        <Table
          head={[
            "Lender",
            "Unit",
            "Drawn",
            "Rate",
            ">Principal",
            ">Term",
            ">Paid",
            ">Outstanding",
            "",
          ]}
        >
          {LOANS.map((l) => (
            <Row key={l.loan_id} className="hover:bg-soft-1 cursor-pointer">
              <Cell onClick={() => setOpen(l.loan_id)}>
                <span className="text-ink">{l.lender}</span>
              </Cell>
              <Cell>{l.unit_id}</Cell>
              <Cell className="whitespace-nowrap">{l.drawn_on}</Cell>
              <Cell className="text-body">
                {(l.rate_bps / 100).toFixed(2)}%
              </Cell>
              <Cell right>
                <Amount minor={l.principal} />
              </Cell>
              <Cell right>{l.months} mo</Cell>
              <Cell right>{l.paid_months} mo</Cell>
              <Cell right className="font-semibold text-ink">
                <Amount minor={outstandingOf(l)} />
              </Cell>
              <Cell>
                <button
                  type="button"
                  onClick={() => setOpen(l.loan_id)}
                  className="font-medium text-accent hover:underline"
                >
                  Schedule
                </button>
              </Cell>
            </Row>
          ))}
          <Row tone="total">
            <Cell colSpan={4}>{count(LOANS.length, "facility")}</Cell>
            <Cell right>
              <Amount minor={LOANS.reduce((n, l) => n + l.principal, 0)} />
            </Cell>
            <Cell colSpan={2} />
            <Cell right>
              <Amount minor={debt} />
            </Cell>
            <Cell />
          </Row>
        </Table>
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.lender ?? ""}
        id={chosen?.loan_id}
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Unit">{chosen.unit_id}</Fact>
              <Fact term="Drawn">{chosen.drawn_on}</Fact>
              <Fact term="Principal">{rp(chosen.principal)}</Fact>
              <Fact term="Rate">{(chosen.rate_bps / 100).toFixed(2)}%</Fact>
              <Fact term="Term">{chosen.months} months</Fact>
              <Fact term="Paid">{chosen.paid_months} months</Fact>
              <Fact term="Outstanding">{rp(outstandingOf(chosen))}</Fact>
            </Facts>
            <div>
              <SubHead>Next twelve instalments</SubHead>
              <Table
                head={["#", "Due", ">Interest", ">Principal", ">Balance After"]}
              >
                {b.loanSchedule
                  .filter((p) => p.loan_id === chosen.loan_id && !p.paid_on)
                  .slice(0, 12)
                  .map((p) => (
                    <Row key={p.n}>
                      <Cell>{p.n}</Cell>
                      <Cell className="whitespace-nowrap">{p.due_on}</Cell>
                      <Cell right className="text-body">
                        <Amount minor={p.interest} />
                      </Cell>
                      <Cell right>
                        <Amount minor={p.principal} />
                      </Cell>
                      <Cell right className="text-body">
                        <Amount minor={p.balance_after} muted />
                      </Cell>
                    </Row>
                  ))}
              </Table>
            </div>
          </div>
        )}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Daftar Pinjaman"
      >
        <ReportPrint
          title="Daftar Pinjaman"
          period={"Per 2026-08-01"}
          columns={[
            { label: "Pemberi pinjaman", cell: (l) => l.lender },
            { label: "Unit", cell: (l) => l.unit_id },
            { label: "Ditarik", cell: (l) => l.drawn_on },
            {
              label: "Bunga",
              align: "right",
              cell: (l) => `${(l.rate_bps / 100).toFixed(2)}%`,
            },
            { label: "Pokok", align: "right", cell: (l) => rp(l.principal) },
            {
              label: "Sisa",
              align: "right",
              cell: (l) => rp(outstandingOf(l)),
            },
          ]}
          rows={LOANS}
        />
      </PrintSheet>
    </PageContent>
  )
}

/// Repayments — the whole schedule, defaulted to what is due.
export function Repayments() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [side, setSide] = useState<"DUE" | "PAID">("DUE")
  const [open, setOpen] = useState<string | null>(null)

  const rows =
    side === "DUE"
      ? b.loanSchedule.filter((p) => !p.paid_on).slice(0, 24)
      : b.loanSchedule
          .filter((p) => p.paid_on)
          .slice(-24)
          .reverse()

  const interest = rows.reduce((n, p) => n + p.interest, 0)
  const principal = rows.reduce((n, p) => n + p.principal, 0)
  const chosen = rows.find((p) => String(p.n) === open)

  const byYear = [...new Set(rows.map((p) => p.due_on.slice(0, 4)))].map(
    (y) => ({
      bucket: y,
      interest: rows
        .filter((p) => p.due_on.startsWith(y))
        .reduce((n, p) => n + p.interest, 0),
      principal: rows
        .filter((p) => p.due_on.startsWith(y))
        .reduce((n, p) => n + p.principal, 0),
    })
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Financing"
        title="Repayments"
        sub="Only the interest is a cost. The principal reduces the liability and touches nothing else."
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={side}
              onChange={(v) => setSide(v as "DUE" | "PAID")}
              className={FILTER_W}
            >
              <option value="DUE">Falling due</option>
              <option value="PAID">Already paid</option>
            </Select>
            <Button
              variant="primary"
              onClick={() =>
                rows.filter((p) => !p.paid_on)[0] &&
                b.payInstalment(rows.filter((p) => !p.paid_on)[0].n)
              }
            >
              Pay the next instalment
            </Button>
            <Button onClick={() => setPrinting(true)}>
              <Printer className="size-3.5" />
              Print
            </Button>
          </div>
        }
      />

      <ChartBand
        title={side === "DUE" ? "Falling due, by year" : "Paid, by year"}
        right={`${rp(interest)} interest · ${rp(principal)} principal`}
      >
        <MoneyBars
          stacked
          rows={byYear}
          series={[
            { key: "interest", label: "Interest — a cost", tone: "cap" },
            {
              key: "principal",
              label: "Principal — a repayment",
              tone: "accent",
            },
          ]}
        />
      </ChartBand>

      <Section
        title={`${side === "DUE" ? "Instalments due" : "Instalments paid"} — ${rows.length}`}
      >
        {rows.length === 0 ? (
          <EmptyState>Nothing in this view.</EmptyState>
        ) : (
          <Table
            head={[
              "#",
              "Due",
              side === "DUE" ? "In" : "Paid",
              ">Interest",
              ">Principal",
              ">Total",
              ">Balance After",
            ]}
          >
            {rows.map((p) => (
              <Row
                key={p.n}
                className="hover:bg-soft-1 cursor-pointer"
                tone={side === "DUE" && age(p.due_on) > 0 ? "bad" : undefined}
              >
                <Cell onClick={() => setOpen(String(p.n))}>{p.n}</Cell>
                <Cell className="whitespace-nowrap">{p.due_on}</Cell>
                <Cell className="whitespace-nowrap text-body">
                  {side === "PAID"
                    ? p.paid_on
                    : age(p.due_on) > 0
                      ? `${days(age(p.due_on))} late`
                      : days(-age(p.due_on))}
                </Cell>
                <Cell right className="text-body">
                  <Amount minor={p.interest} />
                </Cell>
                <Cell right>
                  <Amount minor={p.principal} />
                </Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={p.interest + p.principal} />
                </Cell>
                <Cell right className="text-body">
                  <Amount minor={p.balance_after} muted />
                </Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={3}>{count(rows.length, "instalment")}</Cell>
              <Cell right>
                <Amount minor={interest} />
              </Cell>
              <Cell right>
                <Amount minor={principal} />
              </Cell>
              <Cell right>
                <Amount minor={interest + principal} />
              </Cell>
              <Cell />
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen ? `Instalment ${chosen.n}` : ""}
        actions={
          chosen && !chosen.paid_on ? (
            <Button variant="primary" onClick={() => b.payInstalment(chosen.n)}>
              Pay
            </Button>
          ) : undefined
        }
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Due">{chosen.due_on}</Fact>
              <Fact term="Paid">{chosen.paid_on ?? "—"}</Fact>
              <Fact term="Interest">{rp(chosen.interest)}</Fact>
              <Fact term="Principal">{rp(chosen.principal)}</Fact>
              <Fact term="Total">{rp(chosen.interest + chosen.principal)}</Fact>
              <Fact term="Balance after">{rp(chosen.balance_after)}</Fact>
            </Facts>
            <div>
              <SubHead>What paying it posts</SubHead>
              <Posting
                debits={[
                  {
                    account: "Biaya Bunga Pinjaman",
                    code: "8020111001 — a cost",
                    amount: chosen.interest,
                  },
                  {
                    account: "Pinjaman Jangka Panjang Bank",
                    code: "2022402001 — reduces the liability",
                    amount: chosen.principal,
                  },
                ]}
                credits={[
                  {
                    account: "Bank — HO",
                    code: "1011003001",
                    amount: chosen.interest + chosen.principal,
                  },
                ]}
              />
              <p className="mt-2 text-meta text-mute">
                If the interest was accrued at the month end on 2012201, the
                debit goes there instead and the cost is not charged twice.
              </p>
            </div>
          </div>
        )}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Jadwal Angsuran"
      >
        <ReportPrint
          title="Jadwal Angsuran"
          period={`${side === "DUE" ? "Akan jatuh tempo" : "Telah dibayar"}`}
          columns={[
            { label: "#", cell: (p) => String(p.n) },
            { label: "Jatuh tempo", cell: (p) => p.due_on },
            { label: "Dibayar", cell: (p) => p.paid_on ?? "—" },
            { label: "Bunga", align: "right", cell: (p) => rp(p.interest) },
            { label: "Pokok", align: "right", cell: (p) => rp(p.principal) },
            {
              label: "Jumlah",
              align: "right",
              cell: (p) => rp(p.interest + p.principal),
            },
            {
              label: "Sisa pokok",
              align: "right",
              cell: (p) => rp(p.balance_after),
            },
          ]}
          rows={rows}
          total={[
            `${rows.length} angsuran`,
            "",
            "",
            rp(interest),
            rp(principal),
            rp(interest + principal),
            "",
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}

/// Equity — `3013001`, and the two of its four accounts a person can enter.
export function Equity() {
  const [printing, setPrinting] = useState(false)
  const [recording, setRecording] = useState(false)
  const b = useBook()
  const [origin, setOrigin] = useState("")
  const [open, setOpen] = useState<string | null>(null)

  const rows = b.equityMoves.filter((e) => !origin || e.origin === origin)
  const capital = rows
    .filter((e) => e.kind === "Modal Setor")
    .reduce((n, e) => n + e.amount, 0)
  const drawings = rows
    .filter((e) => e.kind === "Prive")
    .reduce((n, e) => n + e.amount, 0)
  const earned = rows
    .filter((e) => e.origin === "SYSTEM")
    .reduce((n, e) => n + e.amount, 0)
  const chosen = rows.find((e) => e.id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Financing"
        title="Equity"
        sub="Modal Setor and Prive are entered. Retained earnings and the running result are produced by the close."
        actions={
          <div className="flex items-center gap-2">
            <Select value={origin} onChange={setOrigin} className={FILTER_W}>
              <option value="">All movements</option>
              <option value="OWNER">Entered by the owner</option>
              <option value="SYSTEM">Produced by the close</option>
            </Select>
            <Button onClick={() => setPrinting(true)}>
              <Printer className="size-3.5" />
              Print
            </Button>
            <Button variant="primary" onClick={() => setRecording(true)}>
              Record a movement
            </Button>
          </div>
        }
      />

      <Kpis
        items={[
          { label: "Capital in", value: rp(capital), sub: "Modal Setor" },
          {
            label: "Drawings",
            value: rp(drawings),
            sub: "Prive",
            tone: drawings < 0 ? "down" : "flat",
          },
          { label: "Earned", value: rp(earned), sub: "retained + running" },
          {
            label: "Total equity",
            value: rp(rows.reduce((n, e) => n + e.amount, 0)),
          },
        ]}
      />

      <Section title={`Movements — ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState>No movement in this view.</EmptyState>
        ) : (
          <Table
            head={[
              "Date",
              "Kind",
              "Account",
              "Unit",
              "Origin",
              ">Amount",
              "Note",
            ]}
          >
            {rows.map((e) => (
              <Row
                key={e.id}
                className="hover:bg-soft-1 cursor-pointer"
                tone={e.origin === "SYSTEM" ? "muted" : undefined}
              >
                <Cell
                  className="whitespace-nowrap"
                  onClick={() => setOpen(e.id)}
                >
                  {e.on}
                </Cell>
                <Cell>
                  <span className="text-ink">{e.kind}</span>
                </Cell>
                <Cell mono className="text-mute">
                  {e.account}
                </Cell>
                <Cell>{e.unit_id}</Cell>
                <Cell>
                  <Pill tone={e.origin === "OWNER" ? "accent" : "neutral"}>
                    {e.origin === "OWNER" ? "entered" : "from the close"}
                  </Pill>
                </Cell>
                <Cell
                  right
                  className={
                    e.amount < 0
                      ? "font-semibold text-bad-fg"
                      : "font-semibold text-ink"
                  }
                >
                  <Amount minor={e.amount} />
                </Cell>
                <Cell className="text-body">{e.note ?? "—"}</Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={5}>{count(rows.length, "movement")}</Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, e) => n + e.amount, 0)} />
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
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Date">{chosen.on}</Fact>
              <Fact term="Account">{chosen.account}</Fact>
              <Fact term="Unit">{chosen.unit_id}</Fact>
              <Fact term="Amount">{rp(chosen.amount)}</Fact>
              <Fact term="Origin">
                {chosen.origin === "OWNER"
                  ? "entered by the owner"
                  : "produced by the close"}
              </Fact>
            </Facts>
            <div>
              <SubHead>What this is</SubHead>
              <p className="mt-2 text-meta text-body">
                {chosen.kind === "Prive"
                  ? "A drawing. The owner taking money out of the business — not a cost, and not deductible. It reduces equity directly."
                  : chosen.kind === "Modal Setor"
                    ? "Capital put in. Credits equity against whatever asset arrived — usually cash."
                    : "Produced by the period close. Nobody enters this: it is the profit and loss folded into the balance sheet, and editing it by hand would break the two."}
              </p>
              {chosen.origin === "SYSTEM" && (
                <p className="mt-2 text-meta text-mute">
                  Read-only here. It changes when Accounting & close runs the
                  period, and only then.
                </p>
              )}
            </div>
          </div>
        )}
      </Sheet>

      <NewRecord
        open={recording}
        onOpenChange={setRecording}
        title="Record an equity movement"
        submitLabel="Post it"
        fields={[
          {
            name: "kind",
            label: "What kind",
            kind: "select",
            required: true,
            options: [
              { value: "Modal Setor", label: "Modal Setor — capital in" },
              { value: "Prive", label: "Prive — the owner takes money out" },
            ],
            hint: "Retained earnings and the running result are produced by the close and cannot be entered here.",
          },
          {
            name: "unit_id",
            label: "Unit",
            kind: "select",
            required: true,
            options: [
              { value: "HO", label: "HO" },
              { value: "C006", label: "C006" },
              { value: "C004", label: "C004" },
            ],
          },
          {
            name: "amount",
            label: "Amount",
            kind: "money",
            required: true,
          },
          { name: "note", label: "Note" },
        ]}
        onSubmit={(v, minor) =>
          b.recordEquity({
            kind: v.kind as "Modal Setor" | "Prive",
            unit_id: v.unit_id,
            amount: minor.amount,
            note: v.note || undefined,
          })
        }
      />

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Mutasi Modal"
      >
        <ReportPrint
          title="Mutasi Modal"
          period={"Per 2026-08-01"}
          scope={`${origin || "Seluruh mutasi"}`}
          columns={[
            { label: "Tanggal", cell: (e) => e.on },
            { label: "Jenis", cell: (e) => e.kind },
            { label: "Perkiraan", cell: (e) => e.account },
            { label: "Unit", cell: (e) => e.unit_id },
            {
              label: "Asal",
              cell: (e) =>
                e.origin === "OWNER" ? "dicatat" : "dari tutup buku",
            },
            { label: "Jumlah", align: "right", cell: (e) => rp(e.amount) },
          ]}
          rows={rows}
          total={[
            `${rows.length} mutasi`,
            "",
            "",
            "",
            "",
            rp(rows.reduce((n, e) => n + e.amount, 0)),
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}
