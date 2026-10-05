import { useState } from "react"

import { Printer } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { STORE_EXPENSE_CEILING } from "@/screens/finance-lab/engine/data"
import { PrintSheet, ReportPrint } from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"
import {
  Amount,
  Cell,
  ChartBand,
  MoneyBars,
  Row,
  Section,
  SubHead,
  Table,
  count,
  rp,
  FILTER_W,
  Filters,
} from "@/screens/finance-lab/parts"

/// Sales reconciliation — what the till rang up against what reached the bank.
///
/// # Three columns, not one variance
///
/// A trading day has three cash figures and they disagree for reasons that are
/// mostly boring: a card batch settles tomorrow, the bank shut before the
/// deposit run, someone banked two days at once. Collapsing them into a single
/// "variance" would hide which of the three moved, and that is the only thing
/// worth knowing. So: rung, counted, deposited — and the chart puts the first
/// against the last, because a day where they diverge is the day to open.
export function SalesReconcile() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [unit, setUnit] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  const rows = b.storeDays.filter((d) => !unit || d.unit_id === unit)

  const rung = rows.reduce((n, d) => n + d.rung_cash, 0)
  const counted = rows.reduce((n, d) => n + d.counted_cash, 0)
  const deposited = rows.reduce((n, d) => n + d.deposited, 0)
  const undeposited = rows.filter((d) => d.deposited === 0)
  const chosen = rows.find((d) => d.day_id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Sales"
        title="Reconcile"
        sub="What the till rang, what the manager counted, and what reached the bank."
        actions={
          <div className="flex items-center gap-2">
            <Select value={unit} onChange={setUnit} className={FILTER_W}>
              <option value="">All stores</option>
              <option value="C006">C006</option>
              <option value="C004">C004</option>
            </Select>
            <Button
              variant="primary"
              onClick={() =>
                undeposited.forEach((d) => b.recordDeposit(d.day_id))
              }
            >
              Bank the takings
            </Button>
            <Button onClick={() => setPrinting(true)}>
              <Printer className="size-3.5" />
              Print
            </Button>
          </div>
        }
      />

      <ChartBand
        title="Rung against deposited, by day"
        right={
          undeposited.length ? (
            <span className="text-warn-fg">
              {count(undeposited.length, "day")} not yet banked
            </span>
          ) : (
            <span>All banked</span>
          )
        }
      >
        <MoneyBars
          rows={rows.map((d) => ({
            bucket: `${d.on} ${d.unit_id}`,
            rung: d.rung_cash,
            deposited: d.deposited,
          }))}
          series={[
            { key: "rung", label: "Rung at the till", tone: "accent" },
            { key: "deposited", label: "Deposited", tone: "cap" },
          ]}
          labelOf={(b) =>
            unit ? b.slice(8, 10) : `${b.slice(8, 10)} ${b.slice(11)}`
          }
        />
      </ChartBand>

      <Section title={`Trading days — ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState>No day matches.</EmptyState>
        ) : (
          <Table
            head={[
              "Date",
              "Store",
              ">Till Cash",
              ">Card",
              ">Counted",
              ">Variance",
              ">Deposited",
              "Status",
              "",
            ]}
          >
            {rows.map((d) => {
              const diff = d.counted_cash - d.rung_cash
              const late = d.deposited === 0
              return (
                <Row
                  key={d.day_id}
                  className="hover:bg-soft-1 cursor-pointer"
                  tone={diff !== 0 ? "bad" : late ? "warn" : undefined}
                >
                  <Cell
                    className="whitespace-nowrap"
                    onClick={() => setOpen(d.day_id)}
                  >
                    {d.on}
                  </Cell>
                  <Cell>{d.unit_id}</Cell>
                  <Cell right>
                    <Amount minor={d.rung_cash} />
                  </Cell>
                  <Cell right className="text-body">
                    <Amount minor={d.rung_card} muted />
                  </Cell>
                  <Cell right>
                    <Amount minor={d.counted_cash} />
                  </Cell>
                  <Cell
                    right
                    className={diff ? "font-semibold text-bad-fg" : undefined}
                  >
                    <Amount minor={diff} muted />
                  </Cell>
                  <Cell right>
                    <Amount minor={d.deposited} muted />
                    {d.deposited_on && d.deposited_on !== d.on && (
                      <div className="text-eyebrow text-mute">
                        {d.deposited_on}
                      </div>
                    )}
                  </Cell>
                  <Cell>
                    <Pill tone={diff ? "bad" : late ? "warn" : "ok"}>
                      {diff ? "variance" : late ? "not banked" : "matched"}
                    </Pill>
                  </Cell>
                  <Cell>
                    <button
                      type="button"
                      onClick={() => setOpen(d.day_id)}
                      className="font-medium text-accent hover:underline"
                    >
                      Open
                    </button>
                  </Cell>
                </Row>
              )
            })}
            <Row tone="total">
              <Cell colSpan={2}>{rows.length} days</Cell>
              <Cell right>
                <Amount minor={rung} />
              </Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, d) => n + d.rung_card, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={counted} />
              </Cell>
              <Cell right>
                <Amount minor={counted - rung} />
              </Cell>
              <Cell right>
                <Amount minor={deposited} />
              </Cell>
              <Cell colSpan={2} />
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen ? `${chosen.unit_id} — ${chosen.on}` : ""}
        id={chosen?.day_id}
        actions={
          chosen && chosen.deposited === 0 ? (
            <Button
              variant="primary"
              onClick={() => b.recordDeposit(chosen.day_id)}
            >
              Record deposit
            </Button>
          ) : undefined
        }
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Store">{chosen.unit_id}</Fact>
              <Fact term="Trading day">{chosen.on}</Fact>
              <Fact term="Rung — cash">{rp(chosen.rung_cash)}</Fact>
              <Fact term="Rung — card">{rp(chosen.rung_card)}</Fact>
              <Fact term="Counted in the drawer">
                {rp(chosen.counted_cash)}
              </Fact>
              <Fact term="Drawer variance">
                {rp(chosen.counted_cash - chosen.rung_cash)}
              </Fact>
              <Fact term="Deposited">{rp(chosen.deposited)}</Fact>
              <Fact term="Deposited on">{chosen.deposited_on ?? "—"}</Fact>
            </Facts>
            <div>
              <SubHead>Why the three disagree</SubHead>
              <p className="mt-2 text-meta text-body">
                {chosen.note ??
                  (chosen.counted_cash === chosen.rung_cash &&
                  chosen.deposited >= chosen.counted_cash
                    ? "They do not. The drawer matched the till and the whole of it reached the bank."
                    : "No note was left against this day.")}
              </p>
              <p className="mt-2 text-meta text-mute">
                Card takings of {rp(chosen.rung_card)} are not part of this
                reconciliation — they settle through the acquirer and are
                followed in Settlements.
              </p>
            </div>
          </div>
        )}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Rekonsiliasi Penjualan"
      >
        <ReportPrint
          title="Rekonsiliasi Penjualan"
          period={"Per 2026-08-01"}
          scope={`${unit || "Seluruh toko"}`}
          columns={[
            { label: "Tanggal", cell: (d) => d.on },
            { label: "Toko", cell: (d) => d.unit_id },
            {
              label: "Kas di mesin",
              align: "right",
              cell: (d) => rp(d.rung_cash),
            },
            { label: "Kartu", align: "right", cell: (d) => rp(d.rung_card) },
            {
              label: "Dihitung",
              align: "right",
              cell: (d) => rp(d.counted_cash),
            },
            {
              label: "Selisih",
              align: "right",
              cell: (d) => rp(d.counted_cash - d.rung_cash),
            },
            { label: "Disetor", align: "right", cell: (d) => rp(d.deposited) },
          ]}
          rows={rows}
          total={[
            `${rows.length} hari`,
            "",
            rp(rung),
            rp(rows.reduce((n, d) => n + d.rung_card, 0)),
            rp(counted),
            rp(counted - rung),
            rp(deposited),
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}

/// Expenses — money a store spent directly, with no bill and no open payable.
///
/// # Why this is a queue and not a report
///
/// The client centralises spending. A store holds a fixed float and may spend
/// it on a short list of small things; anything above the ceiling or off the
/// list is head office's decision. So the screen's job is to get a decision
/// made, which is why every pending row carries its two buttons and why the
/// default filter is "awaiting review" rather than "all".
///
/// The two flags — over the ceiling, and no receipt — are the only two reasons
/// head office has ever rejected one, so they are the two the row shouts.
export function DirectExpenses() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const all = b.storeExpenses
  const [unit, setUnit] = useState("")
  const [status, setStatus] = useState("SUBMITTED")
  const [open, setOpen] = useState<string | null>(null)

  const rows = all.filter(
    (e) => (!unit || e.unit_id === unit) && (!status || e.status === status)
  )
  const waiting = all.filter((e) => e.status === "SUBMITTED")
  const overCeiling = waiting.filter((e) => e.amount > STORE_EXPENSE_CEILING)
  const noReceipt = waiting.filter((e) => !e.receipt)
  // By category, split by whether it is settled or still a decision. A single
  // total per category would answer "what do the shops spend on" and hide the
  // question this screen exists for, which is "what is still mine to decide".
  const byCategory = [...new Set(all.map((e) => e.category))]
    .map((c) => ({
      bucket: c,
      posted: all
        .filter((e) => e.category === c && e.status === "POSTED")
        .reduce((n, e) => n + e.amount, 0),
      waiting: all
        .filter(
          (e) =>
            e.category === c && e.status !== "POSTED" && e.status !== "REJECTED"
        )
        .reduce((n, e) => n + e.amount, 0),
    }))
    .sort((a, c) => c.posted + c.waiting - (a.posted + a.waiting))

  const chosen = all.find((e) => e.expense_id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Expenses & bills"
        title="Expenses"
        sub="Spent directly out of a store float. No bill, no payable — only a decision."
      />

      <Filters>
        <Button onClick={() => setPrinting(true)}>
          <Printer className="size-3.5" />
          Print
        </Button>
        <Select value={unit} onChange={setUnit} className={FILTER_W}>
          <option value="">All stores</option>
          <option value="C006">C006</option>
          <option value="C004">C004</option>
        </Select>
        <Select value={status} onChange={setStatus} className={FILTER_W}>
          <option value="SUBMITTED">Awaiting review</option>
          <option value="APPROVED">Approved</option>
          <option value="POSTED">Posted</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All</option>
        </Select>
      </Filters>

      <ChartBand
        title="What the shops actually spend it on"
        right={`${count(waiting.length, "claim")} awaiting review · ${count(overCeiling.length, "over the ceiling")} · ${count(noReceipt.length, "without a receipt")}`}
      >
        <MoneyBars
          rows={byCategory}
          series={[
            { key: "posted", label: "Posted", tone: "accent" },
            { key: "waiting", label: "Awaiting a decision", tone: "cap" },
          ]}
          stacked
          labelOf={(bucket) =>
            bucket.length > 16 ? `${bucket.slice(0, 15)}…` : bucket
          }
        />
      </ChartBand>

      <Section title={`Expenses — ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState>Nothing in this tab.</EmptyState>
        ) : (
          <Table
            head={[
              "Date",
              "Store",
              "Description",
              "Category",
              "Claimed by",
              "Receipt",
              ">Value",
              "Status",
              "Decision",
            ]}
          >
            {rows.map((e) => {
              const flag = e.amount > STORE_EXPENSE_CEILING || !e.receipt
              return (
                <Row
                  key={e.expense_id}
                  tone={e.status === "SUBMITTED" && flag ? "warn" : undefined}
                >
                  <Cell className="whitespace-nowrap">{e.on}</Cell>
                  <Cell>{e.unit_id}</Cell>
                  <Cell
                    className="cursor-pointer"
                    onClick={() => setOpen(e.expense_id)}
                  >
                    <span className="text-ink">{e.description}</span>
                    {e.note && (
                      <div className="text-eyebrow text-mute">{e.note}</div>
                    )}
                  </Cell>
                  <Cell className="text-body">{e.category}</Cell>
                  <Cell className="text-body">{e.submitted_by}</Cell>
                  <Cell>
                    <Pill tone={e.receipt ? "ok" : "bad"}>
                      {e.receipt ? "yes" : "none"}
                    </Pill>
                  </Cell>
                  <Cell
                    right
                    className={
                      e.amount > STORE_EXPENSE_CEILING
                        ? "font-semibold text-bad-fg"
                        : undefined
                    }
                  >
                    <Amount minor={e.amount} />
                  </Cell>
                  <Cell>
                    <Pill
                      tone={
                        e.status === "POSTED"
                          ? "ok"
                          : e.status === "APPROVED"
                            ? "info"
                            : e.status === "REJECTED"
                              ? "bad"
                              : "warn"
                      }
                    >
                      {e.status.toLowerCase()}
                    </Pill>
                  </Cell>
                  <Cell>
                    {e.status === "SUBMITTED" ? (
                      <div className="flex gap-1.5">
                        <Button
                          variant="primary"
                          onClick={() =>
                            b.reviewExpense(e.expense_id, "APPROVED")
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          onClick={() =>
                            b.reviewExpense(
                              e.expense_id,
                              "REJECTED",
                              "Declined by head office"
                            )
                          }
                        >
                          Reject
                        </Button>
                      </div>
                    ) : e.status === "APPROVED" ? (
                      <Button
                        variant="primary"
                        onClick={() => b.postExpense(e.expense_id)}
                      >
                        Post
                      </Button>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </Cell>
                </Row>
              )
            })}
            <Row tone="total">
              <Cell colSpan={6}>{count(rows.length, "claim")}</Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, e) => n + e.amount, 0)} />
              </Cell>
              <Cell colSpan={2} />
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.description ?? ""}
        id={chosen?.expense_id}
        actions={
          chosen?.status === "SUBMITTED" ? (
            <Button
              variant="primary"
              onClick={() => b.reviewExpense(chosen.expense_id, "APPROVED")}
            >
              Approve
            </Button>
          ) : chosen?.status === "APPROVED" ? (
            <Button
              variant="primary"
              onClick={() => b.postExpense(chosen.expense_id)}
            >
              Post
            </Button>
          ) : undefined
        }
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Store">{chosen.unit_id}</Fact>
              <Fact term="Date">{chosen.on}</Fact>
              <Fact term="Category">{chosen.category}</Fact>
              <Fact term="Claimed by">{chosen.submitted_by}</Fact>
              <Fact term="Value">{rp(chosen.amount)}</Fact>
              <Fact term="Ceiling">{rp(STORE_EXPENSE_CEILING)}</Fact>
              <Fact term="Receipt">{chosen.receipt ? "attached" : "none"}</Fact>
              <Fact term="Status">{chosen.status.toLowerCase()}</Fact>
            </Facts>
            <div>
              <SubHead>Why it is here</SubHead>
              <ul className="mt-2 flex flex-col gap-1 text-meta text-body">
                {chosen.amount > STORE_EXPENSE_CEILING && (
                  <li>
                    Over the store ceiling by{" "}
                    {rp(chosen.amount - STORE_EXPENSE_CEILING)} — head office
                    decides.
                  </li>
                )}
                {!chosen.receipt && <li>No receipt was attached.</li>}
                {chosen.amount <= STORE_EXPENSE_CEILING && chosen.receipt && (
                  <li>Within the ceiling and evidenced. Routine.</li>
                )}
                {chosen.note && <li className="text-mute">{chosen.note}</li>}
              </ul>
            </div>
          </div>
        )}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Pengeluaran Toko"
      >
        <ReportPrint
          title="Pengeluaran Toko"
          period={"Per 2026-08-01"}
          scope={`${unit || "Seluruh toko"} · ${status || "semua status"}`}
          columns={[
            { label: "Tanggal", cell: (e) => e.on },
            { label: "Toko", cell: (e) => e.unit_id },
            { label: "Keterangan", cell: (e) => e.description },
            { label: "Kategori", cell: (e) => e.category },
            { label: "Diajukan", cell: (e) => e.submitted_by },
            { label: "Bukti", cell: (e) => (e.receipt ? "ada" : "tidak") },
            { label: "Nilai", align: "right", cell: (e) => rp(e.amount) },
            { label: "Status", cell: (e) => e.status.toLowerCase() },
          ]}
          rows={rows}
          total={[
            `${rows.length} klaim`,
            "",
            "",
            "",
            "",
            "",
            rp(rows.reduce((n, e) => n + e.amount, 0)),
            "",
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}
