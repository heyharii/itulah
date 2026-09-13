import { useMemo, useState } from "react"
import { Printer, Search } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { Input, Select } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { CHART } from "@/screens/finance-lab/engine/chart"
import {
  Amount,
  Cell,
  EntryView,
  Row,
  Section,
  SubHead,
  Table,
  rp,
  count,
  FILTER_W,
  Filters,
  NewRecord,
} from "@/screens/finance-lab/parts"
import {
  EntryDocument,
  GiroSlip,
  PrintSheet,
  voucherKind,
} from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"

/// Every movement of money, whatever account it touched.
///
/// # Why this is not Accounts and not Bank transactions
///
/// Three questions, three screens, and collapsing any two of them makes one of
/// the questions unanswerable:
///
///   **Accounts** — where is our money? A list of accounts and their balances.
///   **Bank transactions** — does the bank agree? A statement, matched line by
///     line, and only for accounts that receive one.
///   **Transactions** — what happened to our money? Every debit and credit that
///     touched cash or bank, across every account and every unit, in date
///     order.
///
/// The third is the one somebody needs when they know roughly what they are
/// looking for and not where it was posted: a payment to a supplier last
/// Tuesday, a cash deposit that looks wrong, the Rp15,000 nobody can place.
/// Making them pick an account first is making them guess.
///
/// # Why a movement, not a document
///
/// One journal entry can touch two money accounts — a transfer does — and it is
/// two movements, on two accounts, in two balances. A list of documents would
/// show that transfer once and hide which side each account saw. So a row here
/// is one LINE, and the document it came from is on it.
const FAMILY: Record<string, { label: string; kind: string }> = {
  "1011001001": { label: "Cash on hand", kind: "Cash" },
  "1011001002": { label: "Petty cash", kind: "Cash" },
  "1011001003": { label: "Cashier float", kind: "Cash" },
  "1011002001": { label: "Giro BCA", kind: "Giro" },
  "1011002002": { label: "Giro Mandiri", kind: "Giro" },
  "1011002003": { label: "Giro BRI", kind: "Giro" },
  "1011002004": { label: "Giro BNI", kind: "Giro" },
  "1011002005": { label: "Giro Danamon", kind: "Giro" },
  "1011003001": { label: "Savings BCA", kind: "Savings" },
  "1011003002": { label: "Savings Mandiri", kind: "Savings" },
  "1011003003": { label: "Savings BRI", kind: "Savings" },
  "1011003004": { label: "Savings BNI", kind: "Savings" },
  "1011003005": { label: "Savings BTN", kind: "Savings" },
  "1011004001": { label: "Time deposit BCA", kind: "Deposit" },
  "1011004002": { label: "Time deposit Mandiri", kind: "Deposit" },
  "1011004003": { label: "Time deposit BRI", kind: "Deposit" },
  "1011004004": { label: "Time deposit BNI", kind: "Deposit" },
}

const KIND_TONE: Record<string, "neutral" | "info" | "accent" | "warn"> = {
  Cash: "neutral",
  Giro: "info",
  Savings: "accent",
  Deposit: "warn",
}

const SOURCE_LABEL: Record<string, string> = {
  PAYMENT: "Payment",
  SALE_DAY: "Sale",
  TRANSFER: "Transfer",
  BANK_STATEMENT: "Bank",
  MANUAL: "Manual",
  DEPRECIATION: "Depreciation",
  REVERSAL: "Reversal",
}

/// Where money can move to and from inside one unit. A transfer names both
/// ends because both are ours — that is what makes it a transfer rather than a
/// payment, and why it can never create a cost.
const TRANSFER_ENDS = [
  { value: "BANK:BCA-TAB", label: "BCA savings" },
  { value: "BANK:BCA-GIRO", label: "BCA giro" },
  { value: "CASH_ON_HAND", label: "Cash on hand" },
  { value: "PETTY_CASH", label: "Petty cash" },
]

function endOf(choice: string, unit: string) {
  return choice.startsWith("BANK:")
    ? { kind: "BANK" as const, bank_account_id: `${choice.slice(5)}-${unit}` }
    : { kind: choice as "CASH_ON_HAND" | "PETTY_CASH" }
}

export function Transactions() {
  const [moving, setMoving] = useState(false)
  const [giro, setGiro] = useState<string | null>(null)
  const [printing, setPrinting] = useState<string | null>(null)
  const [printGiro, setPrintGiro] = useState<string | null>(null)
  const b = useBook()
  const [unit, setUnit] = useState("")
  const [kind, setKind] = useState("")
  const [dir, setDir] = useState("")
  const [source, setSource] = useState("")
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<string | null>(null)

  const units = useMemo(
    () =>
      [
        ...new Set(
          CHART.filter((a) => a.unit_id).map((a) => a.unit_id as string)
        ),
      ].sort(),
    []
  )

  /// Every journal line on a money account, newest first. Built from the
  /// journal itself — there is no transaction table to drift from it.
  const all = useMemo(() => {
    const out: {
      id: string
      on: string
      entry: string
      entry_id: string
      doc: string
      source: string
      account: string
      code: string
      kind: string
      unit: string
      memo: string
      in: number
      out: number
      /// Set only on a giro row: written, and not yet through the bank.
      giro_id?: string
      pending?: number
    }[] = []
    for (const e of b.ledger.allEntries()) {
      for (const l of e.lines) {
        const f = FAMILY[l.account_code.slice(0, 10)]
        if (!f) continue
        out.push({
          id: `${e.entry_id}:${l.line_no}`,
          on: e.dates.posting_on,
          entry: e.entry_number,
          entry_id: e.entry_id,
          doc: e.document_ref,
          source: e.source_kind,
          account: f.label,
          code: l.account_code,
          kind: f.kind,
          unit: l.unit_id,
          memo: l.memo ?? e.memo ?? "",
          in: l.debit,
          out: l.credit,
        })
      }
    }
    // A written giro is money this register has to account for: the debt is
    // gone from the supplier and the bank does not know yet. Leaving it out
    // was how the bank balance and the book balance disagreed with nothing on
    // screen to explain it.
    for (const g of b.giros.filter((x) => x.status === "OUTSTANDING")) {
      out.push({
        id: `giro:${g.giro_id}`,
        on: g.issued_on,
        entry: g.number,
        entry_id: "",
        doc: g.source ?? g.number,
        source: "GIRO",
        account: `Outstanding giro — ${g.bank_account_id}`,
        code: "2012002",
        kind: "Giro",
        unit: g.unit_id,
        memo: `Jatuh tempo ${g.value_on} · ${g.payee}`,
        in: 0,
        out: 0,
        giro_id: g.giro_id,
        pending: g.amount,
      })
    }
    return out.sort(
      (x, y) => y.on.localeCompare(x.on) || y.entry.localeCompare(x.entry)
    )
  }, [b])

  const rows = all.filter((r) => {
    if (unit && r.unit !== unit) return false
    if (kind && r.kind !== kind) return false
    if (dir === "IN" && r.in === 0) return false
    if (dir === "OUT" && r.out === 0) return false
    if (source && r.source !== source) return false
    if (
      q &&
      !`${r.entry} ${r.doc} ${r.memo} ${r.account}`
        .toLowerCase()
        .includes(q.trim().toLowerCase())
    )
      return false
    return true
  })

  const sources = [...new Set(all.map((r) => r.source))].sort()
  const moneyIn = rows.reduce((n, r) => n + r.in, 0)
  const moneyOut = rows.reduce((n, r) => n + r.out, 0)
  const shown = open ? b.ledger.entry(open) : undefined
  const chosenGiro = b.giros.find((g) => g.giro_id === giro)
  const printedEntry = printing ? b.ledger.entry(printing) : undefined
  const printGiroDoc = b.giros.find((g) => g.giro_id === printGiro)

  return (
    <PageContent>
      <PageHeader
        crumb="Cash & bank"
        title="Transactions"
        sub="Every movement of money, whichever account it left or reached."
        actions={
          <Button variant="primary" onClick={() => setMoving(true)}>
            Transfer
          </Button>
        }
      />

      <Filters>
        <Select value={unit} onChange={setUnit} className="w-[7rem]">
          <option value="">All units</option>
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </Select>
        <Select value={kind} onChange={setKind} className="w-[8rem]">
          <option value="">All accounts</option>
          <option value="Cash">Cash</option>
          <option value="Giro">Giro</option>
          <option value="Savings">Savings</option>
          <option value="Deposit">Deposit</option>
        </Select>
        <Select value={dir} onChange={setDir} className="w-[7.5rem]">
          <option value="">In and out</option>
          <option value="IN">Money in</option>
          <option value="OUT">Money out</option>
        </Select>
        <Select value={source} onChange={setSource} className="w-[8.5rem]">
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s] ?? s}
            </option>
          ))}
        </Select>
        <div className={`relative ${FILTER_W}`}>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="pl-8"
          />
        </div>
      </Filters>

      <div className="mb-5 flex flex-wrap gap-x-8 gap-y-2">
        <Stat label="Money in" value={moneyIn} />
        <Stat label="Money out" value={moneyOut} />
        <Stat label="Net" value={moneyIn - moneyOut} />
        <Stat label="Movements" text={String(rows.length)} />
      </div>

      <Section title={`Movements — ${rows.length} of ${all.length}`}>
        {rows.length === 0 ? (
          <EmptyState>No movement matches these filters.</EmptyState>
        ) : (
          <Table
            head={[
              "Date",
              "Account",
              "Unit",
              "Source",
              "Document",
              "Memo",
              ">In",
              ">Out",
              ">Outstanding",
              "",
            ]}
          >
            {rows.slice(0, 200).map((r) => (
              <Row key={r.id} className="hover:bg-soft-1 cursor-pointer">
                <Cell
                  className="whitespace-nowrap"
                  onClick={() => setOpen(r.entry_id)}
                >
                  {r.on}
                </Cell>
                <Cell onClick={() => setOpen(r.entry_id)}>
                  <span className="text-ink">{r.account}</span>
                  <div className="font-mono text-eyebrow text-faint">
                    {r.code}
                  </div>
                </Cell>
                <Cell>{r.unit}</Cell>
                <Cell>
                  <Pill tone={KIND_TONE[r.kind]}>
                    {SOURCE_LABEL[r.source] ?? r.source}
                  </Pill>
                </Cell>
                <Cell mono className="text-mute">
                  {r.doc}
                </Cell>
                <Cell className="text-body">{r.memo || "—"}</Cell>
                <Cell right>
                  <Amount minor={r.in} muted />
                </Cell>
                <Cell right>
                  <Amount minor={r.out} muted />
                </Cell>
                <Cell
                  right
                  className={
                    r.pending ? "font-semibold text-warn-fg" : undefined
                  }
                >
                  <Amount minor={r.pending ?? 0} muted />
                </Cell>
                <Cell>
                  {r.giro_id ? (
                    <button
                      type="button"
                      onClick={() => setGiro(r.giro_id ?? null)}
                      className="font-medium text-accent hover:underline"
                    >
                      Giro
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPrinting(r.entry_id)}
                      className="font-medium text-accent hover:underline"
                    >
                      Print
                    </button>
                  )}
                </Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={6} className="whitespace-nowrap">
                {rows.length > 200
                  ? `first 200 of ${rows.length}`
                  : `${count(rows.length, "movement")}`}
              </Cell>
              <Cell right>
                <Amount minor={moneyIn} />
              </Cell>
              <Cell right>
                <Amount minor={moneyOut} />
              </Cell>
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={Boolean(shown)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={shown?.memo ?? "Journal entry"}
        id={shown?.entry_number}
      >
        {shown && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Posted">{shown.dates.posting_on}</Fact>
              <Fact term="Document date">{shown.dates.document_on}</Fact>
              <Fact term="Source">
                {SOURCE_LABEL[shown.source_kind] ?? shown.source_kind}
              </Fact>
              <Fact term="Document">{shown.document_ref}</Fact>
              <Fact term="Rule">{shown.rule_version}</Fact>
              <Fact term="Total">{rp(shown.total)}</Fact>
            </Facts>
            <div>
              <SubHead>Journal</SubHead>
              <div className="mt-2">
                <EntryView entry={shown} />
              </div>
            </div>
          </div>
        )}
      </Sheet>

      <NewRecord
        open={moving}
        onOpenChange={setMoving}
        title="Transfer between our own accounts"
        submitLabel="Move the money"
        fields={[
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
            name: "from",
            label: "Out of",
            kind: "select",
            required: true,
            options: TRANSFER_ENDS,
          },
          {
            name: "to",
            label: "Into",
            kind: "select",
            required: true,
            options: TRANSFER_ENDS,
            hint: "Nothing is settled and nobody is paid — only the shape of what we hold changes.",
          },
          {
            name: "amount",
            label: "Amount",
            kind: "money",
            required: true,
            placeholder: "5000000",
          },
          { name: "memo", label: "Memo", placeholder: "Setoran modal kasir" },
        ]}
        onSubmit={(v, minor) =>
          b.transfer({
            unit_id: v.unit_id,
            amount: minor.amount,
            from: endOf(v.from, v.unit_id),
            to: endOf(v.to, v.unit_id),
            memo: v.memo || undefined,
          })
        }
      />

      <Sheet
        open={Boolean(chosenGiro)}
        onOpenChange={(o) => !o && setGiro(null)}
        title={chosenGiro ? `Giro ${chosenGiro.number}` : ""}
        id={chosenGiro?.source}
        actions={
          chosenGiro && chosenGiro.status === "OUTSTANDING" ? (
            <Button
              variant="primary"
              onClick={() => b.clearGiro(chosenGiro.giro_id)}
            >
              Mark cleared
            </Button>
          ) : undefined
        }
      >
        {chosenGiro && (
          <div className="flex flex-col gap-4">
            <GiroSlip
              number={chosenGiro.number}
              bank={chosenGiro.bank_account_id}
              payee={chosenGiro.payee}
              amount={chosenGiro.amount}
              issued_on={chosenGiro.issued_on}
              value_on={chosenGiro.value_on}
              unit={chosenGiro.unit_id}
              source={chosenGiro.source}
            />
            <Button onClick={() => setPrintGiro(chosenGiro.giro_id)}>
              <Printer className="size-3.5" />
              Print this giro
            </Button>
          </div>
        )}
      </Sheet>

      <PrintSheet
        open={Boolean(printGiroDoc)}
        onOpenChange={(o) => !o && setPrintGiro(null)}
        title={printGiroDoc ? `Bilyet giro ${printGiroDoc.number}` : ""}
      >
        {printGiroDoc && (
          <GiroSlip
            number={printGiroDoc.number}
            bank={printGiroDoc.bank_account_id}
            payee={printGiroDoc.payee}
            amount={printGiroDoc.amount}
            issued_on={printGiroDoc.issued_on}
            value_on={printGiroDoc.value_on}
            unit={printGiroDoc.unit_id}
            source={printGiroDoc.source}
          />
        )}
      </PrintSheet>

      <PrintSheet
        open={Boolean(printedEntry)}
        onOpenChange={(o) => !o && setPrinting(null)}
        title={printedEntry ? voucherKind(printedEntry.document_ref) : ""}
      >
        {printedEntry && <EntryDocument entry={printedEntry} />}
      </PrintSheet>
    </PageContent>
  )
}

function Stat({
  label,
  value,
  text,
}: {
  label: string
  value?: number
  text?: string
}) {
  return (
    <div>
      <div className="font-mono text-eyebrow tracking-[0.04em] text-body uppercase">
        {label}
      </div>
      <div className="mt-1 text-[1.25rem] leading-none font-semibold text-ink tabular-nums">
        {text ?? rp(value ?? 0)}
      </div>
    </div>
  )
}
