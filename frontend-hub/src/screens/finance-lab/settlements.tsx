import { useState } from "react"

import { Printer } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { BANK_ACCOUNTS } from "@/screens/finance-lab/engine/bindings"
import { type Inquiry } from "@/screens/finance-lab/engine/data"
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
  Filters,
} from "@/screens/finance-lab/parts"
import { PrintSheet, ReportPrint } from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"

/// Settlements — money the shop has taken and the payer has not paid over.
///
/// # Why this is not called Card settlements any more
///
/// Because a card is no longer the only way it happens. The client's chart
/// carries `4010113001 Penjualan Online Sendiri` and `4010113002 Penjualan
/// Online Market Place`, and a marketplace payout has exactly the shape of a
/// card batch: captured on one date, paid over on another, net of a fee the
/// platform sets rather than negotiates. The differences are the ones a filter
/// handles — a longer hold, a bigger fee — not the ones a second menu handles.
/// So the screen widened and `channel` became a column.
///
/// # Why an inquiry is a first-class thing here
///
/// A batch past its expected date is not a loss and not yet an error. It is a
/// question — *where is it* — and the question has a life: raised, chased,
/// answered. Without somewhere to record it, the same overdue batch gets
/// queried by three people in a fortnight and the answer lives in somebody's
/// WhatsApp.
///
/// # Why the account it settles into is a column
///
/// A shop can hold an EDC from two banks, and each settles into its own
/// account. "The shop's bank" is not enough to reconcile a settlement against,
/// which is why the batch names the account and Reconcile can match it.
const TODAY = "2026-08-01"
const late = (d: string) =>
  Math.round((Date.parse(TODAY) - Date.parse(d)) / 86_400_000)

export function Settlements() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [unit, setUnit] = useState("")
  const [channel, setChannel] = useState("")
  const [state, setState] = useState("OPEN")
  const [open, setOpen] = useState<string | null>(null)

  const rows = b.cardBatches.filter(
    (x) =>
      (!unit || x.unit_id === unit) &&
      (!channel || x.channel === channel) &&
      (!state || (state === "OPEN" ? !x.settled_on : Boolean(x.settled_on)))
  )

  const outstanding = b.cardBatches.filter((x) => !x.settled_on)
  const overdue = outstanding.filter((x) => late(x.expected_on) > 0)
  const chosen = b.cardBatches.find((x) => x.batch_id === open)
  const inquiries = b.inquiries.filter((q) => q.batch_id === open)
  const openInquiries = b.inquiries.filter((q) => q.status === "OPEN")

  return (
    <PageContent>
      <PageHeader
        crumb="Receivables"
        title="Settlements"
        sub="Card batches and marketplace payouts, from capture to the money landing."
      />

      <Filters>
        <Button onClick={() => setPrinting(true)}>
          <Printer className="size-3.5" />
          Print
        </Button>
        <Select value={channel} onChange={setChannel} className={FILTER_W}>
          <option value="">All channels</option>
          <option value="DEBIT">Debit</option>
          <option value="CREDIT">Credit card</option>
          <option value="MARKETPLACE">Marketplace</option>
        </Select>
        <Select value={unit} onChange={setUnit} className={FILTER_W}>
          <option value="">All stores</option>
          <option value="C006">C006</option>
          <option value="C004">C004</option>
        </Select>
        <Select value={state} onChange={setState} className={FILTER_W}>
          <option value="OPEN">Not settled</option>
          <option value="SETTLED">Settled</option>
          <option value="">All</option>
        </Select>
      </Filters>

      <Kpis
        items={[
          {
            label: "Waiting to be paid over",
            value: rp(outstanding.reduce((n, x) => n + x.gross, 0)),
            sub: `${count(outstanding.length, "batch")}`,
          },
          {
            label: "Past the expected date",
            value: rp(overdue.reduce((n, x) => n + x.gross, 0)),
            sub: `${count(overdue.length, "batch")}`,
            tone: overdue.length ? "down" : "flat",
          },
          {
            label: "Fees this month",
            value: rp(b.cardBatches.reduce((n, x) => n + x.fee, 0)),
            sub: `${(
              (b.cardBatches.reduce((n, x) => n + x.fee, 0) /
                Math.max(
                  1,
                  b.cardBatches.reduce((n, x) => n + x.gross, 0)
                )) *
              100
            ).toFixed(2)}% of gross`,
          },
          {
            label: "Open inquiries",
            value: String(openInquiries.length),
            sub: openInquiries.length ? "with the acquirer" : "none raised",
            tone: openInquiries.length ? "down" : "flat",
          },
        ]}
      />

      <Section title={`Batches — ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState>No batch matches.</EmptyState>
        ) : (
          <Table
            head={[
              "Batch",
              "Channel",
              "Payer",
              "Store",
              "Settles Into",
              "Captured",
              "Expected",
              ">Gross",
              ">Fee",
              ">Net",
              "Status",
            ]}
          >
            {rows.map((x) => {
              const overdueDays = !x.settled_on ? late(x.expected_on) : 0
              const q = b.inquiries.find(
                (i) => i.batch_id === x.batch_id && i.status !== "RESOLVED"
              )
              const acct = BANK_ACCOUNTS.find(
                (a) => a.bank_account_id === x.settles_into
              )
              return (
                <Row
                  key={x.batch_id}
                  className="hover:bg-soft-1 cursor-pointer"
                  tone={overdueDays > 0 ? "warn" : undefined}
                >
                  <Cell mono onClick={() => setOpen(x.batch_id)}>
                    {x.batch_id}
                  </Cell>
                  <Cell>
                    <Pill
                      tone={x.channel === "MARKETPLACE" ? "info" : "neutral"}
                    >
                      {x.channel.toLowerCase()}
                    </Pill>
                  </Cell>
                  <Cell className="text-body">{x.acquirer}</Cell>
                  <Cell>{x.unit_id}</Cell>
                  <Cell className="text-body">
                    {acct?.label ?? x.settles_into}
                  </Cell>
                  <Cell className="whitespace-nowrap">{x.captured_on}</Cell>
                  <Cell className="whitespace-nowrap">
                    {x.expected_on}
                    {overdueDays > 0 && (
                      <div className="text-eyebrow text-bad-fg">
                        {days(overdueDays)} late
                      </div>
                    )}
                  </Cell>
                  <Cell right>
                    <Amount minor={x.gross} />
                  </Cell>
                  <Cell right className="text-body">
                    <Amount minor={x.fee} />
                    <div className="text-eyebrow text-faint">
                      {((x.fee / x.gross) * 100).toFixed(1)}%
                    </div>
                  </Cell>
                  <Cell right className="font-semibold text-ink">
                    <Amount minor={x.settled_net ?? x.gross - x.fee} />
                  </Cell>
                  <Cell>
                    {x.settled_on ? (
                      <Pill tone="ok">settled {x.settled_on.slice(5)}</Pill>
                    ) : q ? (
                      <Pill tone="info">inquiry {q.status.toLowerCase()}</Pill>
                    ) : overdueDays > 0 ? (
                      <Pill tone="bad">overdue</Pill>
                    ) : (
                      <Pill tone="neutral">expected</Pill>
                    )}
                  </Cell>
                </Row>
              )
            })}
            <Row tone="total">
              <Cell colSpan={7} className="whitespace-nowrap">
                {count(rows.length, "batch")}
              </Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, x) => n + x.gross, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, x) => n + x.fee, 0)} />
              </Cell>
              <Cell right>
                <Amount
                  minor={rows.reduce(
                    (n, x) => n + (x.settled_net ?? x.gross - x.fee),
                    0
                  )}
                />
              </Cell>
              <Cell />
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen ? `${chosen.acquirer} — ${chosen.captured_on}` : ""}
        id={chosen?.batch_id}
        actions={
          chosen && !chosen.settled_on ? (
            <Button
              variant="primary"
              onClick={() => b.settleBatch(chosen.batch_id)}
            >
              Settle
            </Button>
          ) : undefined
        }
      >
        {chosen && (
          <BatchDetail batchId={chosen.batch_id} inquiries={inquiries} />
        )}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Daftar Settlement"
      >
        <ReportPrint
          title="Daftar Settlement"
          period={"Per 2026-08-01"}
          scope={`${unit || "Seluruh toko"} · ${channel || "semua kanal"}`}
          columns={[
            { label: "Batch", cell: (x) => x.batch_id },
            { label: "Kanal", cell: (x) => x.channel.toLowerCase() },
            { label: "Pembayar", cell: (x) => x.acquirer },
            { label: "Toko", cell: (x) => x.unit_id },
            { label: "Ditangkap", cell: (x) => x.captured_on },
            { label: "Diharapkan", cell: (x) => x.expected_on },
            { label: "Bruto", align: "right", cell: (x) => rp(x.gross) },
            { label: "Biaya", align: "right", cell: (x) => rp(x.fee) },
            {
              label: "Netto",
              align: "right",
              cell: (x) => rp(x.settled_net ?? x.gross - x.fee),
            },
          ]}
          rows={rows}
          total={[
            `${rows.length} batch`,
            "",
            "",
            "",
            "",
            "",
            rp(rows.reduce((n, x) => n + x.gross, 0)),
            rp(rows.reduce((n, x) => n + x.fee, 0)),
            rp(
              rows.reduce((n, x) => n + (x.settled_net ?? x.gross - x.fee), 0)
            ),
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}

function BatchDetail({
  batchId,
  inquiries,
}: {
  batchId: string
  inquiries: readonly Inquiry[]
}) {
  const b = useBook()
  const x = b.cardBatches.find((c) => c.batch_id === batchId)!
  const acct = BANK_ACCOUNTS.find((a) => a.bank_account_id === x.settles_into)
  const [note, setNote] = useState("")

  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact term="Channel">{x.channel.toLowerCase()}</Fact>
        <Fact term="Payer">{x.acquirer}</Fact>
        <Fact term="Store">{x.unit_id}</Fact>
        <Fact term="Settles into">{acct?.label ?? x.settles_into}</Fact>
        <Fact term="Captured">{x.captured_on}</Fact>
        <Fact term="Expected">{x.expected_on}</Fact>
        <Fact term="Gross">{rp(x.gross)}</Fact>
        <Fact term="Fee">
          {rp(x.fee)} · {((x.fee / x.gross) * 100).toFixed(2)}%
        </Fact>
        <Fact term="Net">{rp(x.settled_net ?? x.gross - x.fee)}</Fact>
        <Fact term="Receivable account">
          {x.channel === "CREDIT"
            ? "1011101001 Piutang kartu Kredit"
            : "1011101002 Piutang Debit Card"}
        </Fact>
      </Facts>

      {!x.settled_on && (
        <div>
          <SubHead>Ask the payer</SubHead>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-w-[14rem] flex-1"
            />
            <Button
              variant="primary"
              onClick={() =>
                b.raiseInquiry(x.batch_id, note || "Where is this settlement?")
              }
            >
              Raise inquiry
            </Button>
          </div>
        </div>
      )}

      <div>
        <SubHead>Inquiries</SubHead>
        {inquiries.length === 0 ? (
          <p className="mt-2 text-meta text-mute">None raised.</p>
        ) : (
          <Table
            head={["Raised", "By", "Reference", "Status", "What They Said", ""]}
          >
            {inquiries.map((q) => (
              <Row
                key={q.inquiry_id}
                tone={q.status === "OPEN" ? "warn" : undefined}
              >
                <Cell className="whitespace-nowrap">{q.raised_on}</Cell>
                <Cell className="text-body">{q.raised_by}</Cell>
                <Cell mono>{q.reference ?? "—"}</Cell>
                <Cell>
                  <Pill
                    tone={
                      q.status === "RESOLVED"
                        ? "ok"
                        : q.status === "ANSWERED"
                          ? "info"
                          : "warn"
                    }
                  >
                    {q.status.toLowerCase()}
                  </Pill>
                </Cell>
                <Cell className="text-body">{q.note ?? "—"}</Cell>
                <Cell>
                  {q.status !== "RESOLVED" && (
                    <button
                      type="button"
                      onClick={() => b.closeInquiry(q.inquiry_id, "RESOLVED")}
                      className="font-medium text-accent hover:underline"
                    >
                      Resolve
                    </button>
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </div>
    </div>
  )
}
