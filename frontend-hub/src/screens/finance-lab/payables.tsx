import { useState } from "react"
import { Plus, Printer } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { Posting } from "@/screens/finance-lab/signature"
import { PrintSheet, ReportPrint } from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { type Bill, VENDORS } from "@/screens/finance-lab/engine/data"
import {
  Amount,
  Cell,
  Kpis,
  Row,
  Section,
  SubHead,
  Table,
  days,
  rp,
  FILTER_W,
  Filters,
  NewRecord,
} from "@/screens/finance-lab/parts"

/// Bills — what has been invoiced to us, and what is left on each.
///
/// # The one rule this screen enforces that a chart of accounts cannot
///
/// `2012001001 Hutang Suppliers Barang Dagangan` exists per unit in the client's
/// master, and shops must not post to it. Head office buys the merchandise; a
/// shop owes head office for goods, which is an affiliate balance and lives on
/// Affiliation. July 2026 at C006 bears it out: 45 accounts touched in the month
/// and not one posting to `2012001*`.
///
/// # Why the ageing is a column and not a second card
///
/// It was a card — four bars above the list — and it made this the only screen
/// in the module carrying two bands. The bars said the same thing the rows say,
/// less precisely, and pushed the work below the fold. So each row carries its
/// own bucket and the strip carries the totals.
const TODAY = "2026-08-01"

function age(due: string): number {
  return Math.round((Date.parse(TODAY) - Date.parse(due)) / 86_400_000)
}

function bucketOf(due: string): {
  label: string
  tone: "neutral" | "info" | "warn" | "bad"
} {
  const d = age(due)
  if (d <= 0) return { label: "not yet due", tone: "neutral" }
  if (d <= 30) return { label: "1–30 days", tone: "info" }
  if (d <= 60) return { label: "31–60 days", tone: "warn" }
  return { label: "over 60 days", tone: "bad" }
}

export function Payables() {
  const [printing, setPrinting] = useState(false)
  const [creating, setCreating] = useState(false)
  const b = useBook()
  const [unit, setUnit] = useState("")
  const [kind, setKind] = useState("")
  const [state, setState] = useState("OPEN")
  const [open, setOpen] = useState<string | null>(null)
  const [giroFor, setGiroFor] = useState<string | null>(null)

  const rows = b.bills
    .filter(
      (b) =>
        (!unit || b.unit_id === unit) &&
        (!kind || b.kind === kind) &&
        (!state ||
          (state === "OPEN" ? b.status !== "PAID" : b.status === "PAID"))
    )
    .sort((a, b) => a.due_on.localeCompare(b.due_on))

  const live = b.bills.filter((b) => b.status !== "PAID")
  const outstanding = live.reduce((n, b) => n + (b.total - b.paid), 0)
  const overdue = live.filter((b) => age(b.due_on) > 0)
  const dueSoon = live.filter((b) => age(b.due_on) <= 0 && age(b.due_on) > -7)
  const chosen = b.bills.find((b) => b.bill_id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Expenses & bills"
        title="Bills"
        sub="Invoiced to us and not yet settled. Paying is an action here, not a menu."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" />
              New bill
            </Button>
          </div>
        }
      />

      <Filters>
        <Button onClick={() => setPrinting(true)}>
          <Printer className="size-3.5" />
          Print
        </Button>
        <Select value={unit} onChange={setUnit} className={FILTER_W}>
          <option value="">All units</option>
          <option value="HO">HO</option>
          <option value="C006">C006</option>
          <option value="C004">C004</option>
        </Select>
        <Select value={kind} onChange={setKind} className={FILTER_W}>
          <option value="">All kinds</option>
          <option value="MERCHANDISE">Merchandise</option>
          <option value="EXPENSE">Non-merchandise</option>
        </Select>
        <Select value={state} onChange={setState} className={FILTER_W}>
          <option value="OPEN">Unpaid</option>
          <option value="PAID">Paid</option>
          <option value="">All</option>
        </Select>
      </Filters>

      <Kpis
        items={[
          {
            label: "Outstanding",
            value: rp(outstanding),
            sub: `${live.length} ${live.length === 1 ? "bill" : "bills"} open`,
          },
          {
            label: "Overdue",
            value: rp(overdue.reduce((n, b) => n + (b.total - b.paid), 0)),
            sub: `${overdue.length} ${overdue.length === 1 ? "bill" : "bills"} past due`,
            tone: overdue.length ? "down" : "flat",
          },
          {
            label: "Due within 7 days",
            value: rp(dueSoon.reduce((n, b) => n + (b.total - b.paid), 0)),
            sub: `${dueSoon.length} ${dueSoon.length === 1 ? "bill" : "bills"}`,
          },
          {
            label: "Paid this month",
            value: rp(b.bills.reduce((n, b) => n + b.paid, 0)),
            sub: `${b.bills.filter((b) => b.status === "PAID").length} settled in full`,
          },
        ]}
      />

      <Section title={`Bills — ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState>No bill matches this filter.</EmptyState>
        ) : (
          <Table
            head={[
              "Number",
              "Supplier",
              "Unit",
              "Kind",
              "Due",
              "Age",
              ">Value",
              ">Paid",
              ">Outstanding",
              "Status",
            ]}
          >
            {rows.map((b) => {
              const left = b.total - b.paid
              const d = age(b.due_on)
              const bucket = bucketOf(b.due_on)
              return (
                <Row
                  key={b.bill_id}
                  className="hover:bg-soft-1 cursor-pointer"
                  tone={left > 0 && d > 0 ? "warn" : undefined}
                >
                  <Cell mono onClick={() => setOpen(b.bill_id)}>
                    {b.number}
                  </Cell>
                  <Cell>
                    <span className="text-ink">{b.supplier}</span>
                  </Cell>
                  <Cell>{b.unit_id}</Cell>
                  <Cell>
                    <Pill
                      tone={b.kind === "MERCHANDISE" ? "accent" : "neutral"}
                    >
                      {b.kind === "MERCHANDISE"
                        ? "merchandise"
                        : "non-merchandise"}
                    </Pill>
                  </Cell>
                  <Cell className="whitespace-nowrap">{b.due_on}</Cell>
                  <Cell>
                    {left > 0 ? (
                      <Pill tone={bucket.tone}>{bucket.label}</Pill>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </Cell>
                  <Cell right>
                    <Amount minor={b.total} />
                  </Cell>
                  <Cell right className="text-body">
                    <Amount minor={b.paid} muted />
                  </Cell>
                  <Cell
                    right
                    className={left > 0 ? "font-semibold text-ink" : undefined}
                  >
                    <Amount minor={left} muted />
                  </Cell>
                  <Cell>
                    <Pill
                      tone={
                        b.status === "PAID"
                          ? "ok"
                          : b.status === "PART_PAID"
                            ? "info"
                            : d > 0
                              ? "bad"
                              : "neutral"
                      }
                    >
                      {b.status === "PAID"
                        ? "paid"
                        : b.status === "PART_PAID"
                          ? "partial"
                          : d > 0
                            ? "overdue"
                            : "open"}
                    </Pill>
                  </Cell>
                </Row>
              )
            })}
            <Row tone="total">
              <Cell colSpan={6}>
                {rows.length} {rows.length === 1 ? "bill" : "bills"}
              </Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, b) => n + b.total, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, b) => n + b.paid, 0)} />
              </Cell>
              <Cell right>
                <Amount
                  minor={rows.reduce((n, b) => n + (b.total - b.paid), 0)}
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
        title={chosen?.supplier ?? ""}
        id={chosen?.number}
        actions={
          chosen && chosen.status !== "PAID" ? (
            <>
              <Button onClick={() => setGiroFor(chosen.bill_id)}>
                Pay by giro
              </Button>
              <Button
                variant="primary"
                onClick={() => b.payBill(chosen.bill_id)}
              >
                Pay
              </Button>
            </>
          ) : undefined
        }
      >
        {chosen && <BillDetail bill={chosen} />}
      </Sheet>

      <NewRecord
        open={creating}
        onOpenChange={setCreating}
        title="New bill"
        submitLabel="Record the bill"
        fields={[
          {
            name: "supplier",
            label: "Supplier or vendor",
            required: true,
            placeholder: "PT Pancasakti Sandang",
          },
          {
            name: "number",
            label: "Invoice number",
            required: true,
            placeholder: "INV/PS/26-08/1201",
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
            name: "kind",
            label: "Kind",
            kind: "select",
            required: true,
            options: [
              {
                value: "MERCHANDISE",
                label: "Merchandise — owed on 2012001001",
              },
              {
                value: "EXPENSE",
                label: "Non-merchandise — owed on 2012001003",
              },
            ],
          },
          {
            name: "issued_on",
            label: "Issued",
            required: true,
            placeholder: "2026-08-01",
          },
          {
            name: "due_on",
            label: "Due",
            required: true,
            placeholder: "2026-08-31",
          },
          {
            name: "total",
            label: "Amount",
            kind: "money",
            required: true,
            placeholder: "12500000",
            hint: "In rupiah. Recognised as a cost now; the money leaves when you pay it.",
          },
        ]}
        onSubmit={(v, minor) =>
          b.recogniseBill({
            number: v.number,
            supplier: v.supplier,
            unit_id: v.unit_id,
            kind: v.kind as "MERCHANDISE" | "EXPENSE",
            issued_on: v.issued_on,
            due_on: v.due_on,
            total: minor.total,
          })
        }
      />

      <NewRecord
        open={Boolean(giroFor)}
        onOpenChange={(o) => !o && setGiroFor(null)}
        title="Write a giro"
        submitLabel="Issue it"
        fields={[
          {
            name: "number",
            label: "Giro number",
            required: true,
            placeholder: "BCA 442192",
            hint: "The number printed on the leaf you are about to write.",
          },
          {
            name: "bank",
            label: "Drawn on",
            kind: "select",
            required: true,
            options: [
              { value: "BCA-GIRO", label: "BCA giro" },
              { value: "MANDIRI-GIRO", label: "Mandiri giro" },
            ],
          },
          {
            name: "value_on",
            label: "Value date",
            required: true,
            placeholder: "2026-08-20",
            hint: "Nothing leaves the bank until this date — that is what makes it a giro and not a cheque.",
          },
        ]}
        onSubmit={(v) => {
          const bill = b.bills.find((x) => x.bill_id === giroFor)
          if (!bill)
            return { ok: false as const, message: "That bill has gone." }
          return b.issueGiro({
            bill_id: bill.bill_id,
            number: v.number,
            bank_account_id: `${v.bank}-${bill.unit_id}`,
            value_on: v.value_on,
          })
        }}
      />

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Daftar Hutang"
      >
        <ReportPrint
          title="Daftar Hutang"
          period={"Per 2026-08-01"}
          scope={`${unit || "Seluruh unit"} · ${state === "OPEN" ? "belum lunas" : state === "PAID" ? "lunas" : "semua"}`}
          columns={[
            { label: "Nomor", cell: (x) => x.number },
            { label: "Pemasok", cell: (x) => x.supplier },
            { label: "Unit", cell: (x) => x.unit_id },
            { label: "Jatuh tempo", cell: (x) => x.due_on },
            { label: "Nilai", align: "right", cell: (x) => rp(x.total) },
            { label: "Dibayar", align: "right", cell: (x) => rp(x.paid) },
            {
              label: "Sisa",
              align: "right",
              cell: (x) => rp(x.total - x.paid),
            },
          ]}
          rows={rows}
          total={[
            `${rows.length} tagihan`,
            "",
            "",
            "",
            rp(rows.reduce((n, x) => n + x.total, 0)),
            rp(rows.reduce((n, x) => n + x.paid, 0)),
            rp(rows.reduce((n, x) => n + (x.total - x.paid), 0)),
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}

function BillDetail({ bill }: { bill: Bill }) {
  const b = useBook()
  const left = bill.total - bill.paid
  const d = age(bill.due_on)
  const vendor = VENDORS.find((v) => v.name === bill.supplier)
  const giro = b.giros.find((g) => g.source === bill.number)
  const account = bill.kind === "MERCHANDISE" ? "2012001001" : "2012001003"

  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact term="Number">{bill.number}</Fact>
        <Fact term="Unit">{bill.unit_id}</Fact>
        <Fact term="Kind">
          {bill.kind === "MERCHANDISE" ? "merchandise" : "non-merchandise"}
        </Fact>
        <Fact term="Payable account">{account}</Fact>
        <Fact term="Issued">{bill.issued_on}</Fact>
        <Fact term="Due">
          {bill.due_on}
          {left > 0 && d > 0 ? ` — ${days(d)} late` : ""}
        </Fact>
        <Fact term="Terms">
          {vendor?.terms_days ? `${vendor.terms_days} days` : "—"}
        </Fact>
        <Fact term="Pay to">
          {vendor?.bank ?? <span className="text-bad-fg">no bank details</span>}
        </Fact>
        <Fact term="Value">{rp(bill.total)}</Fact>
        <Fact term="Outstanding">{rp(left)}</Fact>
      </Facts>

      {giro && (
        <div>
          <SubHead>Paid by giro</SubHead>
          <Table head={["Number", "Issued", "Value date", "Status", ">Amount"]}>
            <Row tone={giro.status === "OUTSTANDING" ? "warn" : undefined}>
              <Cell mono>{giro.number}</Cell>
              <Cell className="whitespace-nowrap">{giro.issued_on}</Cell>
              <Cell className="whitespace-nowrap">{giro.value_on}</Cell>
              <Cell>
                <Pill
                  tone={
                    giro.status === "CLEARED"
                      ? "ok"
                      : giro.status === "VOID"
                        ? "bad"
                        : "warn"
                  }
                >
                  {giro.status.toLowerCase()}
                </Pill>
              </Cell>
              <Cell right>
                <Amount minor={giro.amount} />
              </Cell>
            </Row>
          </Table>
          <p className="mt-2 text-meta text-mute">
            A giro is written before it is money. Until it clears, the bank
            balance and the book balance differ by exactly this — which is why
            it shows on Cash &amp; bank as a status, not as a settled payment.
          </p>
        </div>
      )}

      <div>
        <SubHead>What paying it posts</SubHead>
        <Posting
          debits={[
            {
              account:
                bill.kind === "MERCHANDISE"
                  ? "Hutang Suppliers Barang Dagangan"
                  : "Hutang Supplier Non Barang Dagang",
              code: account,
              amount: left,
            },
          ]}
          credits={[
            {
              account: `Bank — ${bill.unit_id}`,
              code: "1011002 / 1011003",
              amount: left,
            },
          ]}
        />
        <p className="mt-2 text-meta text-mute">
          The cost was recognised when the bill was recorded. Paying it moves
          money and clears the liability — it does not touch the profit and loss
          again.
        </p>
      </div>
    </div>
  )
}
