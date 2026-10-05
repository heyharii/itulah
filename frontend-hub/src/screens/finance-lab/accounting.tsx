import { useState } from "react"
import { Plus, Printer, Search } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import {
  Amount,
  Cell,
  EntryView,
  Kpis,
  Row,
  Section,
  SubHead,
  Table,
  count,
  rp,
  FILTER_W,
  Filters,
  JournalGrid,
  type JournalDraftLine,
} from "@/screens/finance-lab/parts"
import { account } from "@/screens/finance-lab/engine/chart"
import {
  EntryDocument,
  PrintSheet,
  ReportPrint,
  voucherKind,
} from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"

const TODAY = "2026-08-01"
const age = (d: string) =>
  Math.round((Date.parse(TODAY) - Date.parse(d)) / 86_400_000)

/// Journals — every entry the book holds, in one list.
///
/// # Why the list is of documents and not of lines
///
/// A journal is a set of balanced lines, and a screen that lists lines makes
/// the reader reassemble it. So the table is one row per entry with its source
/// and its total, and the entry itself — every line, both totals, the proof it
/// balances — opens in the sheet.
export function Journals() {
  const b = useBook()
  const [writing, setWriting] = useState(false)
  const [printing, setPrinting] = useState<string | null>(null)
  const [listPrint, setListPrint] = useState(false)
  const [kind, setKind] = useState("")
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<string | null>(null)

  const all = b.ledger.allEntries()
  const kinds = [...new Set(all.map((e) => e.source_kind))].sort()

  // Not memoised. `allEntries()` hands back the ledger's own array, so a memo
  // keyed on it never sees a change the ledger made in place — and the filter
  // over a few dozen entries costs less than the bug that hides.
  const rows = (() => {
    const needle = q.trim().toLowerCase()
    return [...all]
      .filter((e) => !kind || e.source_kind === kind)
      .filter(
        (e) =>
          !needle ||
          `${e.entry_number} ${e.document_ref} ${e.memo ?? ""}`
            .toLowerCase()
            .includes(needle)
      )
      .sort((x, y) => y.dates.posting_on.localeCompare(x.dates.posting_on))
  })()

  // The strip describes the whole book, not the filtered view: a reader who
  // narrows to one source still wants to know what they are narrowing out of.
  const total = all.reduce(
    (n, e) => n + e.lines.reduce((s, l) => s + l.debit, 0),
    0
  )
  const lines = all.reduce((n, e) => n + e.lines.length, 0)
  const unbalanced = all.filter(
    (e) => e.lines.reduce((n, l) => n + l.debit - l.credit, 0) !== 0
  ).length
  const chosen = all.find((e) => e.entry_id === open)
  const printed = printing ? b.ledger.entry(printing) : undefined

  return (
    <PageContent>
      <PageHeader
        crumb="Accounting & close"
        title="Journals"
        sub="Every entry in the book, whatever posted it."
        actions={
          <Button variant="primary" onClick={() => setWriting(true)}>
            <Plus className="size-3.5" />
            New journal entry
          </Button>
        }
      />

      <Filters>
        <Button onClick={() => setListPrint(true)}>
          <Printer className="size-3.5" />
          Print
        </Button>
        <Select value={kind} onChange={setKind} className={FILTER_W}>
          <option value="">All sources</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </Select>
        <div className={`relative ${FILTER_W}`}>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
        </div>
      </Filters>

      <Kpis
        items={[
          {
            label: "Entries",
            value: String(all.length),
            sub: count(kinds.length, "source"),
          },
          {
            label: "Lines",
            value: String(lines),
            sub: `${(lines / Math.max(1, all.length)).toFixed(1)} per entry`,
          },
          { label: "Value posted", value: rp(total) },
          {
            label: "Out of balance",
            value: String(unbalanced),
            sub: unbalanced
              ? "entries whose columns differ"
              : "every entry balances",
            tone: unbalanced ? "down" : "up",
          },
        ]}
      />

      <Section title={`Entries — ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState>No entry matches.</EmptyState>
        ) : (
          <Table
            head={[
              "Entry",
              "Posted",
              "Source",
              "Document",
              "Unit",
              ">Lines",
              ">Value",
              "Memo",
            ]}
          >
            {rows.map((e) => (
              <Row key={e.entry_id} className="hover:bg-soft-1 cursor-pointer">
                <Cell mono onClick={() => setOpen(e.entry_id)}>
                  {e.entry_number}
                </Cell>
                <Cell className="whitespace-nowrap">{e.dates.posting_on}</Cell>
                <Cell>
                  <Pill tone="accent">{e.source_kind}</Pill>
                </Cell>
                <Cell mono className="text-mute">
                  {e.document_ref}
                </Cell>
                <Cell>
                  {[...new Set(e.lines.map((l) => l.unit_id))].join(", ")}
                </Cell>
                <Cell right>{e.lines.length}</Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={e.lines.reduce((n, l) => n + l.debit, 0)} />
                </Cell>
                <Cell className="text-body">{e.memo ?? "—"}</Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={5}>{count(rows.length, "entry")}</Cell>
              <Cell right>{rows.reduce((n, e) => n + e.lines.length, 0)}</Cell>
              <Cell right>
                <Amount minor={total} />
              </Cell>
              <Cell />
            </Row>
          </Table>
        )}
      </Section>

      <JournalEntrySheet open={writing} onOpenChange={setWriting} />

      <PrintSheet
        open={Boolean(printed)}
        onOpenChange={(o) => !o && setPrinting(null)}
        title={printed ? voucherKind(printed.document_ref) : ""}
      >
        {printed && <EntryDocument entry={printed} />}
      </PrintSheet>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.memo ?? chosen?.entry_number ?? ""}
        id={chosen?.entry_number}
        width="wide"
        actions={
          chosen ? (
            <>
              <Button onClick={() => setPrinting(chosen.entry_id)}>
                <Printer className="size-3.5" />
                Print
              </Button>
              <Button
                onClick={() =>
                  b.reverseEntry(
                    chosen.entry_id,
                    "2026-07-31",
                    "Reversed from Journals"
                  )
                }
              >
                Reverse
              </Button>
            </>
          ) : undefined
        }
      >
        {chosen && <EntryView entry={chosen} />}
      </Sheet>

      <PrintSheet
        open={listPrint}
        onOpenChange={setListPrint}
        title="Daftar Jurnal"
      >
        <ReportPrint
          title="Daftar Jurnal"
          period="Per 2026-08-01"
          scope={kind || "Seluruh sumber"}
          columns={[
            { label: "Nomor", cell: (e) => e.entry_number },
            { label: "Tanggal", cell: (e) => e.dates.posting_on },
            { label: "Sumber", cell: (e) => e.source_kind },
            { label: "Dokumen", cell: (e) => e.document_ref },
            { label: "Keterangan", cell: (e) => e.memo ?? "—" },
            {
              label: "Nilai",
              align: "right",
              cell: (e) => rp(e.lines.reduce((n, l) => n + l.debit, 0)),
            },
          ]}
          rows={rows}
          total={[
            `${rows.length} jurnal`,
            "",
            "",
            "",
            "",
            rp(
              rows.reduce(
                (n, e) => n + e.lines.reduce((s, l) => s + l.debit, 0),
                0
              )
            ),
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}

/// Writing a journal entry by hand.
///
/// # Why this exists when every other screen posts through a rule
///
/// Because no set of rules covers everything, and the honest alternative to a
/// manual journal is somebody keeping the correction in a spreadsheet. What it
/// does NOT do is bypass the ledger's own guarantees: the period lock, the
/// balance check and the authorisation are enforced in `post()`, so a manual
/// entry into a closed month is refused exactly like a rule-driven one.
///
/// The account is typed as a code rather than picked from 7,528 options,
/// and the name appears under it as you type — which catches a transposed
/// digit at the moment it is made rather than at the month end.
function JournalEntrySheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const b = useBook()
  const [unit, setUnit] = useState("C006")
  const [on, setOn] = useState("2026-08-01")
  const [memo, setMemo] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const [lines, setLines] = useState<JournalDraftLine[]>([
    { account_code: "", memo: "", debit: "", credit: "" },
    { account_code: "", memo: "", debit: "", credit: "" },
  ])

  const money = (v: string) =>
    Math.round(Number(v.replace(/[^\d]/g, "") || "0") * 100)
  const debit = lines.reduce((n, l) => n + money(l.debit), 0)
  const credit = lines.reduce((n, l) => n + money(l.credit), 0)
  const ready = debit > 0 && debit === credit && memo.trim().length > 0

  const reset = () => {
    setLines([
      { account_code: "", memo: "", debit: "", credit: "" },
      { account_code: "", memo: "", debit: "", credit: "" },
    ])
    setMemo("")
    setProblem(null)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      title="New journal entry"
      width="wide"
      actions={
        <Button
          variant="primary"
          disabled={!ready}
          onClick={() => {
            const out = b.postJournal({
              unit_id: unit,
              on,
              memo: memo.trim(),
              lines: lines
                .filter((l) => l.account_code.trim())
                .map((l) => ({
                  account_code: l.account_code,
                  side:
                    money(l.debit) > 0
                      ? ("DEBIT" as const)
                      : ("CREDIT" as const),
                  amount: money(l.debit) > 0 ? money(l.debit) : money(l.credit),
                  memo: l.memo || undefined,
                })),
            })
            if (out.ok) {
              reset()
              onOpenChange(false)
            } else {
              setProblem(out.message)
            }
          }}
        >
          Post
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-3">
          <Field label="Unit" className="min-w-[9rem]">
            <Select value={unit} onChange={setUnit} className={FILTER_W}>
              <option value="HO">HO</option>
              <option value="C004">C004</option>
              <option value="C006">C006</option>
            </Select>
          </Field>
          <Field label="Posting date" className="min-w-[9rem]">
            <Input value={on} onChange={(e) => setOn(e.target.value)} />
          </Field>
          <Field label="Memo" required className="min-w-[14rem] flex-1">
            <Input value={memo} onChange={(e) => setMemo(e.target.value)} />
          </Field>
        </div>

        <JournalGrid
          lines={lines}
          onChange={setLines}
          accountName={(code) => account(code)?.name}
        />

        {problem && (
          <Banner tone="bad">
            <div className="min-w-0">{problem}</div>
          </Banner>
        )}
      </div>
    </Sheet>
  )
}

/// Adjustments — entries a person wrote, rather than a rule.
///
/// # Why a reversal is the only correction offered
///
/// Nothing in this book can be edited after it is posted, and nothing can be
/// deleted. A wrong entry is corrected by a reversal that copies the original
/// account codes and then by a fresh entry — which is what the engine's
/// `reverse` does, and why it takes a reason. An `Edit` button here would be a
/// lie about what the ledger permits.
export function Adjustments() {
  const b = useBook()
  const [open, setOpen] = useState<string | null>(null)
  const [reason, setReason] = useState("")

  const manual = b.ledger
    .allEntries()
    .filter(
      (e) =>
        e.source_kind === "MANUAL" ||
        e.source_kind === "ADJUSTMENT" ||
        e.source_kind === "REVERSAL"
    )
    .sort((x, y) => y.dates.posting_on.localeCompare(x.dates.posting_on))

  const chosen = manual.find((e) => e.entry_id === open)
  const reversals = manual.filter((e) => e.source_kind === "REVERSAL")

  return (
    <PageContent>
      <PageHeader
        crumb="Accounting & close"
        title="Adjustments"
        sub="Entries written by a person. Corrected by reversal, never by editing."
      />

      <Kpis
        items={[
          {
            label: "Adjustments",
            value: String(manual.length - reversals.length),
            sub: "written this period",
          },
          {
            label: "Reversals",
            value: String(reversals.length),
            tone: reversals.length ? "down" : "flat",
          },
          {
            label: "Value adjusted",
            value: rp(
              manual.reduce(
                (n, e) => n + e.lines.reduce((s, l) => s + l.debit, 0),
                0
              )
            ),
          },
          {
            label: "Share of the book",
            value: `${((manual.length / Math.max(1, b.ledger.allEntries().length)) * 100).toFixed(1)}%`,
            sub: "of all entries",
          },
        ]}
      />

      <Section title={`Manual entries — ${manual.length}`}>
        {manual.length === 0 ? (
          <EmptyState>Nothing has been adjusted by hand.</EmptyState>
        ) : (
          <Table
            head={[
              "Entry",
              "Posted",
              "Kind",
              "Document",
              ">Lines",
              ">Value",
              "Reason",
              "",
            ]}
          >
            {manual.map((e) => (
              <Row
                key={e.entry_id}
                className="hover:bg-soft-1 cursor-pointer"
                tone={e.source_kind === "REVERSAL" ? "warn" : undefined}
              >
                <Cell mono onClick={() => setOpen(e.entry_id)}>
                  {e.entry_number}
                </Cell>
                <Cell className="whitespace-nowrap">{e.dates.posting_on}</Cell>
                <Cell>
                  <Pill tone={e.source_kind === "REVERSAL" ? "bad" : "accent"}>
                    {e.source_kind.toLowerCase()}
                  </Pill>
                </Cell>
                <Cell mono className="text-mute">
                  {e.document_ref}
                </Cell>
                <Cell right>{e.lines.length}</Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={e.lines.reduce((n, l) => n + l.debit, 0)} />
                </Cell>
                <Cell className="text-body">{e.memo ?? "—"}</Cell>
                <Cell>
                  <button
                    type="button"
                    onClick={() => setOpen(e.entry_id)}
                    className="font-medium text-accent hover:underline"
                  >
                    Open
                  </button>
                </Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={4}>{count(manual.length, "entry")}</Cell>
              <Cell right>
                {manual.reduce((n, e) => n + e.lines.length, 0)}
              </Cell>
              <Cell right>
                <Amount
                  minor={manual.reduce(
                    (n, e) => n + e.lines.reduce((s, l) => s + l.debit, 0),
                    0
                  )}
                />
              </Cell>
              <Cell colSpan={2} />
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.memo ?? ""}
        id={chosen?.entry_number}
        width="wide"
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <EntryView entry={chosen} />
            <div>
              <SubHead>Correct it</SubHead>
              <p className="mt-1.5 text-meta text-body">
                A reversal copies this entry's own account codes and negates
                them, so the pair nets to nothing on every account it touched.
                Then post the right entry.
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="min-w-[14rem] flex-1"
                />
                <Button
                  variant="primary"
                  onClick={() =>
                    b.reverseEntry(
                      chosen.entry_id,
                      "2026-07-31",
                      reason || "Correction"
                    )
                  }
                >
                  Reverse
                </Button>
              </div>
            </div>
          </div>
        )}
      </Sheet>
    </PageContent>
  )
}

/// Accruals & deferrals — the accountant's consolidated view of `2012201`.
///
/// # Why this screen exists when Payroll and Expenses already own their accruals
///
/// Because ownership and control are different jobs. The person chasing the
/// landlord wants the rent accrual next to the landlord; the person closing the
/// month wants every accrual on one page, whichever domain raised it, so they
/// can see the total that will hit the balance sheet and spot the one that
/// stopped moving.
///
/// So the domains own the work and this owns the arithmetic. Nothing here can
/// be raised — the button says where to go — because two places that can create
/// the same accrual is how the same cost gets recognised twice.
export function AccrualsDeferrals() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [open, setOpen] = useState<string | null>(null)

  const rows = [
    ...b.payrollPayables
      .filter((p) => p.amount > p.settled)
      .map((p) => ({
        key: p.id,
        what: p.kind,
        account: p.account,
        unit: p.unit_id,
        domain: "Payroll",
        to: "/finance-lab/payroll/payables",
        direction: "ACCRUAL" as const,
        amount: p.amount - p.settled,
        due: p.due_on,
      })),
    ...b.prepaids.map((p) => ({
      key: p.prepaid_id,
      what: p.description,
      account: p.account,
      unit: p.unit_id,
      domain: "Expenses & bills",
      to: "/finance-lab/expenses/prepaids",
      direction: "DEFERRAL" as const,
      amount: Math.round((p.total * (p.months - p.released_months)) / p.months),
      due: p.starts_on,
    })),
    ...b.preOpening
      .filter((p) => p.amortised_months < p.months)
      .map((p) => ({
        key: p.id,
        what: `Pre-opening ${p.unit_id}`,
        account: p.account,
        unit: p.unit_id,
        domain: "Assets & projects",
        to: "/finance-lab/assets/pre-opening",
        direction: "DEFERRAL" as const,
        amount: p.cost - Math.round((p.cost * p.amortised_months) / p.months),
        due: p.opened_on,
      })),
  ].sort((a, b) => b.amount - a.amount)

  const accruals = rows.filter((r) => r.direction === "ACCRUAL")
  const deferrals = rows.filter((r) => r.direction === "DEFERRAL")
  const chosen = rows.find((r) => r.key === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Accounting & close"
        title="Accruals & deferrals"
        sub="Every accrual and every deferral, whichever domain raised it. Read here, worked there."

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
            label: "Accrued — a liability",
            value: rp(accruals.reduce((n, r) => n + r.amount, 0)),
            sub: `${count(accruals.length, "item")}`,
          },
          {
            label: "Deferred — an asset",
            value: rp(deferrals.reduce((n, r) => n + r.amount, 0)),
            sub: `${count(deferrals.length, "item")}`,
          },
          {
            label: "Payroll's share",
            value: rp(
              rows
                .filter((r) => r.domain === "Payroll")
                .reduce((n, r) => n + r.amount, 0)
            ),
            sub: "of 2012201",
          },
          {
            label: "Past due",
            value: String(accruals.filter((r) => age(r.due) > 0).length),
            tone: accruals.some((r) => age(r.due) > 0) ? "down" : "flat",
          },
        ]}
      />

      <Section title={`Balances — ${rows.length}`}>
        <Table
          head={[
            "What",
            "Account",
            "Unit",
            "Owned by",
            "Direction",
            "Due / Started",
            ">Balance",
            "",
          ]}
        >
          {rows.map((r) => (
            <Row
              key={r.key}
              className="hover:bg-soft-1 cursor-pointer"
              tone={
                r.direction === "ACCRUAL" && age(r.due) > 0 ? "warn" : undefined
              }
            >
              <Cell onClick={() => setOpen(r.key)}>
                <span className="text-ink">{r.what}</span>
              </Cell>
              <Cell mono className="text-mute">
                {r.account}
              </Cell>
              <Cell>{r.unit}</Cell>
              <Cell className="text-body">{r.domain}</Cell>
              <Cell>
                <Pill tone={r.direction === "ACCRUAL" ? "warn" : "info"}>
                  {r.direction.toLowerCase()}
                </Pill>
              </Cell>
              <Cell className="whitespace-nowrap">{r.due}</Cell>
              <Cell right className="font-semibold text-ink">
                <Amount minor={r.amount} />
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
            <Cell colSpan={6}>{rows.length} balances</Cell>
            <Cell right>
              <Amount minor={rows.reduce((n, r) => n + r.amount, 0)} />
            </Cell>
            <Cell />
          </Row>
        </Table>
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.what ?? ""}
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Account">{chosen.account}</Fact>
              <Fact term="Unit">{chosen.unit}</Fact>
              <Fact term="Direction">{chosen.direction.toLowerCase()}</Fact>
              <Fact term="Balance">{rp(chosen.amount)}</Fact>
              <Fact term="Owned by">{chosen.domain}</Fact>
            </Facts>
            <div>
              <SubHead>Where it is worked</SubHead>
              <p className="mt-2 text-meta text-body">
                This page is the control total. The item itself is raised,
                settled and released in {chosen.domain} — one place, so the same
                cost cannot be recognised twice.
              </p>
              <p className="mt-2 text-meta text-mute">
                {chosen.direction === "ACCRUAL"
                  ? "The cost is already in the profit and loss. What is left is the payment."
                  : "The cash has already gone. What is left is the recognition."}
              </p>
            </div>
          </div>
        )}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Akrual dan Beban Ditangguhkan"
      >
        <ReportPrint
          title="Akrual dan Beban Ditangguhkan"
          period={"Per 2026-08-01"}
          columns={[
            { label: "Keterangan", cell: (r) => r.what },
            { label: "Perkiraan", cell: (r) => r.account },
            { label: "Unit", cell: (r) => r.unit },
            { label: "Dimiliki", cell: (r) => r.domain },
            {
              label: "Arah",
              cell: (r) =>
                r.direction === "ACCRUAL" ? "akrual" : "ditangguhkan",
            },
            { label: "Saldo", align: "right", cell: (r) => rp(r.amount) },
          ]}
          rows={rows}
          total={[
            `${rows.length} saldo`,
            "",
            "",
            "",
            "",
            rp(rows.reduce((n, r) => n + r.amount, 0)),
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}

/// Provisions & reserves — amounts set aside against a cost not yet incurred.
export function Provisions() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [open, setOpen] = useState<string | null>(null)
  const rows = b.provisions
  const held = rows.reduce((n, p) => n + p.opening + p.charged - p.used, 0)
  const unfunded = rows.filter((p) => p.opening + p.charged === 0)
  const chosen = rows.find((p) => p.id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Accounting & close"
        title="Provisions & reserves"
        sub="What is set aside — and, just as usefully, what is described but never funded."

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
            label: "Held",
            value: rp(held),
            sub: `${count(rows.length, "provision")}`,
          },
          {
            label: "Charged this month",
            value: rp(rows.reduce((n, p) => n + p.charged, 0)),
          },
          {
            label: "Used this month",
            value: rp(rows.reduce((n, p) => n + p.used, 0)),
          },
          {
            label: "Never funded",
            value: String(unfunded.length),
            sub: unfunded.length ? "described but empty" : "all funded",
            tone: unfunded.length ? "down" : "flat",
          },
        ]}
      />

      <Section title={`Provisions — ${rows.length}`}>
        <Table
          head={[
            "Provision",
            "Account",
            "Unit",
            ">Opening",
            ">Charged",
            ">Used",
            ">Balance",
            "Basis",
          ]}
        >
          {rows.map((p) => (
            <Row
              key={p.id}
              className="hover:bg-soft-1 cursor-pointer"
              tone={p.opening + p.charged === 0 ? "warn" : undefined}
            >
              <Cell onClick={() => setOpen(p.id)}>
                <span className="text-ink">{p.name}</span>
              </Cell>
              <Cell mono className="text-mute">
                {p.account}
              </Cell>
              <Cell>{p.unit_id}</Cell>
              <Cell right>
                <Amount minor={p.opening} muted />
              </Cell>
              <Cell right>
                <Amount minor={p.charged} muted />
              </Cell>
              <Cell right>
                <Amount minor={p.used} muted />
              </Cell>
              <Cell right className="font-semibold text-ink">
                <Amount minor={p.opening + p.charged - p.used} muted />
              </Cell>
              <Cell className="text-body">{p.basis}</Cell>
            </Row>
          ))}
          <Row tone="total">
            <Cell colSpan={3}>{count(rows.length, "provision")}</Cell>
            <Cell right>
              <Amount minor={rows.reduce((n, p) => n + p.opening, 0)} />
            </Cell>
            <Cell right>
              <Amount minor={rows.reduce((n, p) => n + p.charged, 0)} />
            </Cell>
            <Cell right>
              <Amount minor={rows.reduce((n, p) => n + p.used, 0)} />
            </Cell>
            <Cell right>
              <Amount minor={held} />
            </Cell>
            <Cell />
          </Row>
        </Table>
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.name ?? ""}
        id={chosen?.account}
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Account">{chosen.account}</Fact>
              <Fact term="Unit">{chosen.unit_id}</Fact>
              <Fact term="Opening">{rp(chosen.opening)}</Fact>
              <Fact term="Charged">{rp(chosen.charged)}</Fact>
              <Fact term="Used">{rp(chosen.used)}</Fact>
              <Fact term="Balance">
                {rp(chosen.opening + chosen.charged - chosen.used)}
              </Fact>
            </Facts>
            <div>
              <SubHead>Basis</SubHead>
              <p className="mt-2 text-meta text-body">{chosen.basis}</p>
              {chosen.opening + chosen.charged === 0 && (
                <p className="mt-2 text-meta text-warn-fg">
                  Nothing has ever been charged to this reserve. It exists in
                  the chart and in the manual, and not in the journal — which is
                  a finding, not a rounding.
                </p>
              )}
            </div>
          </div>
        )}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Cadangan dan Penyisihan"
      >
        <ReportPrint
          title="Cadangan dan Penyisihan"
          period={"Per 2026-08-01"}
          columns={[
            { label: "Cadangan", cell: (p) => p.name },
            { label: "Perkiraan", cell: (p) => p.account },
            { label: "Unit", cell: (p) => p.unit_id },
            { label: "Awal", align: "right", cell: (p) => rp(p.opening) },
            { label: "Dibebankan", align: "right", cell: (p) => rp(p.charged) },
            { label: "Dipakai", align: "right", cell: (p) => rp(p.used) },
            {
              label: "Saldo",
              align: "right",
              cell: (p) => rp(p.opening + p.charged - p.used),
            },
          ]}
          rows={rows}
          total={[
            `${rows.length} cadangan`,
            "",
            "",
            rp(rows.reduce((n, p) => n + p.opening, 0)),
            rp(rows.reduce((n, p) => n + p.charged, 0)),
            rp(rows.reduce((n, p) => n + p.used, 0)),
            rp(held),
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}
