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
import { type TaxPosition } from "@/screens/finance-lab/engine/subledgers"
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

/// Tax — both sides of it, because one side is never the answer.
///
/// # Why prepaid and payable are on the same row
///
/// The client keeps two families: `1011302 PREPAID TAX` (PPh 21/25/29, VAT
/// Masukan, PBB) and `2012101 HUTANG PAJAK` (PPh 21, PPh 23 withheld, VAT
/// Keluaran, PBB, PPh 25). VAT is the reason they cannot be two screens —
/// input against output is a *position*, and whether this month leaves an asset
/// or a liability is the thing being worked out, not an input to it. Showing
/// the two families separately would mean adding them up on paper every month.
const TODAY = "2026-08-01"
const age = (d: string) =>
  Math.round((Date.parse(TODAY) - Date.parse(d)) / 86_400_000)
const netOf = (t: TaxPosition) => t.payable - t.prepaid

export function TaxOverview() {
  const b = useBook()
  const open = b.taxPositions.filter((t) => !t.filed_on)
  const owed = open.reduce((n, t) => n + Math.max(0, netOf(t)), 0)

  const items = open
    .map((t) => ({
      id: t.id,
      what: `${t.kind} — ${t.period}`,
      who: t.unit_id,
      why:
        age(t.due_on) > 0
          ? `${days(age(t.due_on))} past the filing date`
          : `Due ${t.due_on}`,
      amount: netOf(t),
      tone: age(t.due_on) > 0 ? ("bad" as const) : ("warn" as const),
    }))
    .sort((a, b) => b.amount - a.amount)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Tax"
        sub="What is owed, what has been paid ahead, and what is due next."
      />

      <ChartBand title="How a tax position becomes a payment">
        <Flow
          steps={[
            {
              label: "Withheld or charged",
              value: rp(b.taxPositions.reduce((n, t) => n + t.payable, 0)),
              posts: "Cr 2012101 Hutang Pajak",
              to: "/finance-lab/tax/position",
            },
            {
              label: "Paid ahead or suffered",
              value: rp(b.taxPositions.reduce((n, t) => n + t.prepaid, 0)),
              posts: "Dr 1011302 Prepaid Tax",
              to: "/finance-lab/tax/position",
            },
            {
              label: "Net position",
              value: rp(owed),
              posts: "the answer, not an input",
              to: "/finance-lab/tax/position",
              tone: owed > 0 ? "warn" : "ok",
            },
            {
              label: "Remitted",
              value: count(
                b.taxPositions.filter((t) => t.filed_on).length,
                "filing"
              ),
              posts: "Dr 2012101 / Cr Bank",
              to: "/finance-lab/tax/payments",
              tone: "ok",
            },
          ]}
        />
      </ChartBand>

      <Section
        title={`Open — ${items.length}`}
        sub="Everything not yet filed, oldest liability first."
      >
        {items.length === 0 ? (
          <EmptyState>Every period is filed.</EmptyState>
        ) : (
          <Table head={["Tax", "Unit", "Why It Is Here", ">Net Position", ""]}>
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
                    to="/finance-lab/tax/position"
                    className="font-medium text-accent hover:underline"
                  >
                    Open
                  </AppLink>
                </Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={3}>{items.length} open</Cell>
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

/// Tax position — prepaid against payable, per tax and per period.
export function TaxPositionScreen() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [period, setPeriod] = useState("")
  const [open, setOpen] = useState<string | null>(null)

  const rows = b.taxPositions.filter((t) => !period || t.period === period)
  const due = rows
    .filter((t) => !t.filed_on && t.payable > t.prepaid)
    .sort((a, c) => a.due_on.localeCompare(c.due_on))
  const prepaid = rows.reduce((n, t) => n + t.prepaid, 0)
  const payable = rows.reduce((n, t) => n + t.payable, 0)
  const chosen = rows.find((t) => t.id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Tax"
        title="Tax position"
        sub="1011302 against 2012101. The net is the answer, not an input."
        actions={
          <div className="flex items-center gap-2">
            <Select value={period} onChange={setPeriod} className={FILTER_W}>
              <option value="">All periods</option>
              <option value="2026-07">July 2026</option>
              <option value="2026-06">June 2026</option>
              <option value="2026">Annual 2026</option>
              <option value="2025">2025</option>
            </Select>
            <Button
              variant="primary"
              onClick={() => due[0] && b.payTax(due[0].id)}
            >
              File the next return
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
            label: "Prepaid & input",
            value: rp(prepaid),
            sub: "1011302 — an asset",
          },
          {
            label: "Payable & output",
            value: rp(payable),
            sub: "2012101 — a liability",
          },
          {
            label: "Net position",
            value: rp(payable - prepaid),
            tone: payable > prepaid ? "down" : "up",
            sub: payable > prepaid ? "we owe" : "we are ahead",
          },
          {
            label: "Overdue filings",
            value: String(
              rows.filter((t) => !t.filed_on && age(t.due_on) > 0).length
            ),
            tone: rows.some((t) => !t.filed_on && age(t.due_on) > 0)
              ? "down"
              : "flat",
          },
        ]}
      />

      <Section title={`Positions — ${rows.length}`}>
        <Table
          head={[
            "Tax",
            "Period",
            "Unit",
            "Due",
            ">Prepaid",
            ">Payable",
            ">Net",
            "Status",
          ]}
        >
          {rows.map((t) => {
            const late = !t.filed_on && age(t.due_on) > 0
            return (
              <Row
                key={t.id}
                className="hover:bg-soft-1 cursor-pointer"
                tone={late ? "bad" : undefined}
              >
                <Cell onClick={() => setOpen(t.id)}>
                  <span className="text-ink">{t.kind}</span>
                </Cell>
                <Cell className="whitespace-nowrap">{t.period}</Cell>
                <Cell>{t.unit_id}</Cell>
                <Cell className="whitespace-nowrap">
                  {t.due_on}
                  {late && (
                    <div className="text-eyebrow text-bad-fg">
                      {days(age(t.due_on))} late
                    </div>
                  )}
                </Cell>
                <Cell right className="text-body">
                  <Amount minor={t.prepaid} muted />
                </Cell>
                <Cell right className="text-body">
                  <Amount minor={t.payable} muted />
                </Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={netOf(t)} muted />
                </Cell>
                <Cell>
                  <Pill tone={t.filed_on ? "ok" : late ? "bad" : "warn"}>
                    {t.filed_on ? "filed" : late ? "overdue" : "open"}
                  </Pill>
                </Cell>
              </Row>
            )
          })}
          <Row tone="total">
            <Cell colSpan={4}>{count(rows.length, "position")}</Cell>
            <Cell right>
              <Amount minor={prepaid} />
            </Cell>
            <Cell right>
              <Amount minor={payable} />
            </Cell>
            <Cell right>
              <Amount minor={payable - prepaid} />
            </Cell>
            <Cell />
          </Row>
        </Table>
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen ? `${chosen.kind} — ${chosen.period}` : ""}
        id={chosen?.id}
        actions={
          chosen && !chosen.filed_on ? (
            <Button variant="primary" onClick={() => b.payTax(chosen.id)}>
              File
            </Button>
          ) : undefined
        }
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Period">{chosen.period}</Fact>
              <Fact term="Unit">{chosen.unit_id}</Fact>
              <Fact term="Due">{chosen.due_on}</Fact>
              <Fact term="Filed">{chosen.filed_on ?? "—"}</Fact>
              <Fact term="Prepaid account">
                {chosen.prepaid_account ?? "—"}
              </Fact>
              <Fact term="Payable account">
                {chosen.payable_account ?? "—"}
              </Fact>
              <Fact term="Prepaid">{rp(chosen.prepaid)}</Fact>
              <Fact term="Payable">{rp(chosen.payable)}</Fact>
            </Facts>
            <div>
              <SubHead>How the net is arrived at</SubHead>
              <Table head={["Side", "Account", ">Amount"]}>
                <Row>
                  <Cell>Payable / output</Cell>
                  <Cell mono className="text-mute">
                    {chosen.payable_account ?? "—"}
                  </Cell>
                  <Cell right>
                    <Amount minor={chosen.payable} muted />
                  </Cell>
                </Row>
                <Row>
                  <Cell>Prepaid / input</Cell>
                  <Cell mono className="text-mute">
                    {chosen.prepaid_account ?? "—"}
                  </Cell>
                  <Cell right>
                    <Amount minor={-chosen.prepaid} muted />
                  </Cell>
                </Row>
                <Row tone="total">
                  <Cell colSpan={2}>
                    {netOf(chosen) >= 0
                      ? "Payable this period"
                      : "Carried forward"}
                  </Cell>
                  <Cell right>
                    <Amount minor={Math.abs(netOf(chosen))} />
                  </Cell>
                </Row>
              </Table>
            </div>
          </div>
        )}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Posisi Pajak"
      >
        <ReportPrint
          title="Posisi Pajak"
          period={"Per 2026-08-01"}
          scope={`${period || "Seluruh periode"}`}
          columns={[
            { label: "Pajak", cell: (x) => x.kind },
            { label: "Periode", cell: (x) => x.period },
            { label: "Unit", cell: (x) => x.unit_id },
            { label: "Jatuh tempo", cell: (x) => x.due_on },
            {
              label: "Dibayar dimuka",
              align: "right",
              cell: (x) => rp(x.prepaid),
            },
            { label: "Terutang", align: "right", cell: (x) => rp(x.payable) },
            { label: "Netto", align: "right", cell: (x) => rp(netOf(x)) },
          ]}
          rows={rows}
          total={[
            `${rows.length} posisi`,
            "",
            "",
            "",
            rp(prepaid),
            rp(payable),
            rp(payable - prepaid),
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}

/// Tax payments — what has actually been paid to the state, and when.
export function TaxPayments() {
  const b = useBook()
  const [open, setOpen] = useState<string | null>(null)
  const rows = [...b.taxPositions].sort((a, b) =>
    a.due_on.localeCompare(b.due_on)
  )
  const paid = rows.filter((t) => t.filed_on)
  const due = rows.filter((t) => !t.filed_on)
  const chosen = rows.find((t) => t.id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Tax"
        title="Payments"
        sub="Every filing and its payment, in date order."
        actions={
          <Button
            variant="primary"
            onClick={() => due[0] && b.payTax(due[0].id)}
          >
            Pay the next one due
          </Button>
        }
      />

      <Kpis
        items={[
          {
            label: "Paid this year",
            value: rp(
              paid.reduce((n, t) => n + Math.max(0, netOf(t)) + t.prepaid, 0)
            ),
            sub: `${count(paid.length, "filing")}`,
          },
          {
            label: "Due",
            value: rp(due.reduce((n, t) => n + Math.max(0, netOf(t)), 0)),
            sub: `${count(due.length, "filing")}`,
          },
          {
            label: "Next due",
            value: due[0]?.due_on ?? "—",
            sub: due[0]?.kind,
          },
          {
            label: "Overdue",
            value: String(due.filter((t) => age(t.due_on) > 0).length),
            tone: due.some((t) => age(t.due_on) > 0) ? "down" : "flat",
          },
        ]}
      />

      <Section title={`Filings — ${rows.length}`}>
        <Table
          head={[
            "Tax",
            "Period",
            "Unit",
            "Due",
            "Filed",
            ">To Pay",
            "Status",
            "",
          ]}
        >
          {rows.map((t) => {
            const late = !t.filed_on && age(t.due_on) > 0
            return (
              <Row
                key={t.id}
                className="hover:bg-soft-1 cursor-pointer"
                tone={late ? "bad" : undefined}
              >
                <Cell onClick={() => setOpen(t.id)}>
                  <span className="text-ink">{t.kind}</span>
                </Cell>
                <Cell className="whitespace-nowrap">{t.period}</Cell>
                <Cell>{t.unit_id}</Cell>
                <Cell className="whitespace-nowrap">{t.due_on}</Cell>
                <Cell className="whitespace-nowrap text-body">
                  {t.filed_on ?? "—"}
                </Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={Math.max(0, netOf(t))} muted />
                </Cell>
                <Cell>
                  <Pill tone={t.filed_on ? "ok" : late ? "bad" : "warn"}>
                    {t.filed_on ? "paid" : late ? "overdue" : "scheduled"}
                  </Pill>
                </Cell>
                <Cell>
                  {!t.filed_on && (
                    <button
                      type="button"
                      onClick={() => setOpen(t.id)}
                      className="font-medium text-accent hover:underline"
                    >
                      Pay
                    </button>
                  )}
                </Cell>
              </Row>
            )
          })}
          <Row tone="total">
            <Cell colSpan={5}>{count(rows.length, "filing")}</Cell>
            <Cell right>
              <Amount
                minor={rows.reduce((n, t) => n + Math.max(0, netOf(t)), 0)}
              />
            </Cell>
            <Cell colSpan={2} />
          </Row>
        </Table>
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen ? `${chosen.kind} — ${chosen.period}` : ""}
        id={chosen?.id}
        actions={
          chosen && !chosen.filed_on ? (
            <Button variant="primary" onClick={() => b.payTax(chosen.id)}>
              Pay
            </Button>
          ) : undefined
        }
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Period">{chosen.period}</Fact>
              <Fact term="Unit">{chosen.unit_id}</Fact>
              <Fact term="Due">{chosen.due_on}</Fact>
              <Fact term="Filed">{chosen.filed_on ?? "—"}</Fact>
              <Fact term="To pay">{rp(Math.max(0, netOf(chosen)))}</Fact>
            </Facts>
            <div>
              <SubHead>What paying it posts</SubHead>
              <Posting
                debits={[
                  {
                    account: chosen.kind,
                    code: chosen.payable_account ?? "2012101",
                    amount: Math.max(0, netOf(chosen)),
                  },
                ]}
                credits={[
                  {
                    account: `Bank — ${chosen.unit_id}`,
                    code: "1011003",
                    amount: Math.max(0, netOf(chosen)),
                  },
                ]}
              />
            </div>
          </div>
        )}
      </Sheet>
    </PageContent>
  )
}
