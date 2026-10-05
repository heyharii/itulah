import { useState } from "react"

import { Printer } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { PrintSheet, ReportPrint } from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { type Prepaid } from "@/screens/finance-lab/engine/data"
import {
  Amount,
  Cell,
  Kpis,
  Row,
  Section,
  SubHead,
  Table,
  rp,
  count,
  NewRecord,
} from "@/screens/finance-lab/parts"
import { Posting, Strip } from "@/screens/finance-lab/signature"

/// Prepaids — paid once, recognised a month at a time.
///
/// # Why advances are no longer on this page
///
/// They were, behind a tab, and the tab was the tell: two objects sharing a
/// screen because both start with a payment. They end differently. A prepaid
/// releases on a schedule nobody has to chase; an advance is settled by the
/// holder producing receipts, and if they never do, the balance is a claim on a
/// person. One is arithmetic and the other is a conversation, so they are two
/// screens.
///
/// # Why the strip and not a percentage
///
/// Twelve months as twelve marks says *which* months are done, which a progress
/// bar cannot. A schedule that stopped releasing in April looks identical to
/// one on track at 33%.
const TODAY = "2026-08-01"

const monthly = (p: Prepaid) => Math.floor(p.total / p.months / 100) * 100
const remaining = (p: Prepaid) => p.total - monthly(p) * p.released_months

export function Prepaids() {
  const [printing, setPrinting] = useState(false)
  const [creating, setCreating] = useState(false)
  const b = useBook()
  const [open, setOpen] = useState<string | null>(null)

  const outstanding = b.prepaids.reduce((n, p) => n + remaining(p), 0)
  const thisMonth = b.prepaids.reduce(
    (n, p) => n + (p.released_months < p.months ? monthly(p) : 0),
    0
  )
  const live = b.prepaids.filter((p) => p.released_months < p.months)
  const chosen = b.prepaids.find((p) => p.prepaid_id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Expenses & bills"
        title="Prepaids"
        sub="Paid up front, carried as an asset, released a month at a time."
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={() => setPrinting(true)}>
              <Printer className="size-3.5" />
              Print
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              New schedule
            </Button>
          </div>
        }
      />

      <Kpis
        items={[
          {
            label: "Carried as an asset",
            value: rp(outstanding),
            sub: `${count(b.prepaids.length, "schedule")}`,
          },
          {
            label: "Releases this month",
            value: rp(thisMonth),
            sub: `${live.length} still running`,
          },
          {
            label: "Paid in total",
            value: rp(b.prepaids.reduce((n, p) => n + p.total, 0)),
          },
          {
            label: "Already recognised",
            value: rp(
              b.prepaids.reduce((n, p) => n + monthly(p) * p.released_months, 0)
            ),
          },
        ]}
      />

      <Section title={`Schedules — ${b.prepaids.length}`}>
        <Table
          head={[
            "Description",
            "Unit",
            "Account",
            ">Paid",
            ">Per Month",
            ">Progress",
            ">Outstanding",
            "Status",
          ]}
        >
          {b.prepaids.map((p) => {
            const done = p.released_months >= p.months
            return (
              <Row
                key={p.prepaid_id}
                className="hover:bg-soft-1 cursor-pointer"
                tone={done ? "muted" : undefined}
              >
                <Cell onClick={() => setOpen(p.prepaid_id)}>
                  <span className="text-ink">{p.description}</span>
                  <div className="text-eyebrow text-faint">
                    from {p.starts_on}
                  </div>
                </Cell>
                <Cell>{p.unit_id}</Cell>
                <Cell mono className="text-mute">
                  {p.account}
                </Cell>
                <Cell right>
                  <Amount minor={p.total} />
                </Cell>
                <Cell right className="text-body">
                  <Amount minor={monthly(p)} />
                </Cell>
                <Cell right className="text-body">
                  {p.released_months}/{p.months}
                </Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={remaining(p)} />
                </Cell>
                <Cell>
                  <Pill tone={done ? "ok" : "neutral"}>
                    {done ? "released" : "running"}
                  </Pill>
                </Cell>
              </Row>
            )
          })}
          <Row tone="total">
            <Cell colSpan={3}>{count(b.prepaids.length, "schedule")}</Cell>
            <Cell right>
              <Amount minor={b.prepaids.reduce((n, p) => n + p.total, 0)} />
            </Cell>
            <Cell right>
              <Amount minor={thisMonth} />
            </Cell>
            <Cell />
            <Cell right>
              <Amount minor={outstanding} />
            </Cell>
            <Cell />
          </Row>
        </Table>
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.description ?? ""}
        id={chosen?.prepaid_id}
        actions={
          chosen && chosen.released_months < chosen.months ? (
            <Button
              variant="primary"
              onClick={() => b.releasePrepaid(chosen.prepaid_id)}
            >
              Release this month
            </Button>
          ) : undefined
        }
      >
        {chosen && <PrepaidDetail prepaid={chosen} />}
      </Sheet>

      <NewRecord
        open={creating}
        onOpenChange={setCreating}
        title="New prepaid schedule"
        submitLabel="Pay and schedule"
        fields={[
          {
            name: "description",
            label: "What was paid for",
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
            name: "total",
            label: "Amount paid",
            kind: "money",
            required: true,
          },
          {
            name: "months",
            label: "Over how many months",
            required: true,
          },
          {
            name: "starts_on",
            label: "First month",
            required: true,
          },
        ]}
        onSubmit={(v, minor) =>
          b.createPrepaid({
            description: v.description,
            unit_id: v.unit_id,
            total: minor.total,
            months: Number(v.months),
            starts_on: v.starts_on,
          })
        }
      />

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Biaya Dibayar Dimuka"
      >
        <ReportPrint
          title="Biaya Dibayar Dimuka"
          period={"Per 2026-08-01"}
          scope={undefined}
          columns={[
            { label: "Keterangan", cell: (p) => p.description },
            { label: "Unit", cell: (p) => p.unit_id },
            { label: "Perkiraan", cell: (p) => p.account },
            { label: "Dibayar", align: "right", cell: (p) => rp(p.total) },
            { label: "Per bulan", align: "right", cell: (p) => rp(monthly(p)) },
            {
              label: "Sudah",
              align: "right",
              cell: (p) => `${p.released_months}/${p.months}`,
            },
            { label: "Sisa", align: "right", cell: (p) => rp(remaining(p)) },
          ]}
          rows={b.prepaids}
          total={[
            `${b.prepaids.length} jadwal`,
            "",
            "",
            rp(b.prepaids.reduce((n, p) => n + p.total, 0)),
            rp(thisMonth),
            "",
            rp(outstanding),
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}

function PrepaidDetail({ prepaid }: { prepaid: Prepaid }) {
  const per = monthly(prepaid)
  const left = prepaid.months - prepaid.released_months
  const start = new Date(TODAY)
  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact term="Unit">{prepaid.unit_id}</Fact>
        <Fact term="Account">{prepaid.account}</Fact>
        <Fact term="Starts">{prepaid.starts_on}</Fact>
        <Fact term="Term">{prepaid.months} months</Fact>
        <Fact term="Paid">{rp(prepaid.total)}</Fact>
        <Fact term="Per month">{rp(per)}</Fact>
        <Fact term="Released">{prepaid.released_months} months</Fact>
        <Fact term="Outstanding">{rp(remaining(prepaid))}</Fact>
      </Facts>

      <div>
        <SubHead>Months released</SubHead>
        <Strip
          months={prepaid.months}
          done={prepaid.released_months}
          startMonth={prepaid.starts_on.slice(0, 7)}
        />
      </div>

      <div>
        <SubHead>Remaining schedule</SubHead>
        {left <= 0 ? (
          <p className="mt-2 text-meta text-mute">
            Fully released. Nothing is carried against this any more.
          </p>
        ) : (
          <Table head={["Month", ">Release", ">Carried After"]}>
            {Array.from({ length: Math.min(left, 12) }, (_, i) => {
              const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
              return (
                <Row key={i}>
                  <Cell>{`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`}</Cell>
                  <Cell right>
                    <Amount minor={per} />
                  </Cell>
                  <Cell right className="text-body">
                    <Amount
                      minor={Math.max(0, remaining(prepaid) - per * (i + 1))}
                      muted
                    />
                  </Cell>
                </Row>
              )
            })}
            <Row tone="total">
              <Cell>{left} months left</Cell>
              <Cell right>
                <Amount minor={remaining(prepaid)} />
              </Cell>
              <Cell right>
                <Amount minor={0} muted />
              </Cell>
            </Row>
          </Table>
        )}
      </div>

      <div>
        <SubHead>What a release posts</SubHead>
        <Posting
          debits={[
            {
              account: "The expense it recognises",
              code: "7010xxx — per category",
              amount: per,
            },
          ]}
          credits={[
            {
              account: `Prepaid — ${prepaid.unit_id}`,
              code: prepaid.account,
              amount: per,
            },
          ]}
        />
      </div>
    </div>
  )
}
