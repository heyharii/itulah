import { useMemo, useState } from "react"
import { Printer, Search } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
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
  count,
  rp,
  FILTER_W,
  Filters,
} from "@/screens/finance-lab/parts"
import { Bridge, Mirror } from "@/screens/finance-lab/signature"
import {
  PrintSheet,
  ReportPrint,
  StatementDoc,
} from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"

/// Reports — the statements, read off the journal.
///
/// # Nothing here is stored
///
/// Every figure is summed from the journal at the moment it is asked for,
/// including the totals and the check that the trial balance balances. A stored
/// balance and the rows it summarises drift, and when they do nobody can say
/// which to believe — so the report is the derivation, not a copy of it.
///
/// The classes come from the client's own code: `1` assets, `2` liabilities,
/// `3` equity, `4` revenue, `5` cost of sales, `6`–`8` the expense families.
/// Which side a class is presented on is a decision this screen makes; the
/// balance itself stays signed, because a balance does not decide how it is
/// shown.
const CLASS_NAME: Record<string, string> = {
  "1": "Assets",
  "2": "Liabilities",
  "3": "Equity",
  "4": "Revenue",
  "5": "Cost of sales",
  "6": "Operating expenses",
  "7": "Other operating expenses",
  "8": "Non-operating",
}

/// What the book actually covers, read off the postings rather than assumed.
/// A statement that names a month the journal does not hold is worse than one
/// that names no month at all.
function usePeriod(): string {
  const b = useBook()
  return useMemo(() => {
    const dates = b.ledger
      .allEntries()
      .map((e) => e.dates.posting_on)
      .sort()
    if (dates.length === 0) return "No postings"
    const first = dates[0]
    const last = dates[dates.length - 1]
    return first === last ? first : `${first} – ${last}`
  }, [b])
}

/// The classes, grouped once so three screens read them the same way.
function useClasses(unit: string) {
  const b = useBook()
  const tb = b.ledger.trialBalance({
    book_id: "CFS",
    unit_id: unit || undefined,
  })
  const byClass = useMemo(() => {
    const m = new Map<
      string,
      { debit: number; credit: number; rows: typeof tb.rows }
    >()
    for (const r of tb.rows) {
      const k = r.code[0]
      const acc = m.get(k) ?? {
        debit: 0,
        credit: 0,
        rows: [] as unknown as typeof tb.rows,
      }
      acc.debit += r.debit
      acc.credit += r.credit
      ;(acc.rows as unknown as (typeof tb.rows)[number][]).push(r)
      m.set(k, acc)
    }
    return m
  }, [tb])
  // Revenue, liabilities and equity are credit-natured: shown positive when
  // credited. The stored balance itself stays signed — a balance does not
  // decide how it is presented.
  const net = (k: string) => {
    const v = byClass.get(k)
    if (!v) return 0
    return "234".includes(k) ? v.credit - v.debit : v.debit - v.credit
  }
  return { tb, byClass, net }
}

const UNIT_FILTER = (
  unit: string,
  setUnit: (v: string) => void,
  onPrint?: () => void
) => (
  <div className="flex items-center gap-2">
    {onPrint && (
      <Button onClick={onPrint}>
        <Printer className="size-3.5" />
        Print
      </Button>
    )}
    <Select value={unit} onChange={setUnit} className={FILTER_W}>
      <option value="">All units</option>
      <option value="HO">HO</option>
      <option value="C006">C006</option>
      <option value="C004">C004</option>
    </Select>
  </div>
)

/// What a statement line is made of.
///
/// # Why the table is accounts and not the statement again
///
/// The waterfall above already IS the statement — seven lines, in order, with
/// the arithmetic visible. A table repeating those seven lines underneath was
/// the same information twice and left the reader's real next question
/// unanswered: *which account did that*. So the band states the result and the
/// table shows the ledger behind it, which is the only thing the band cannot.
function AccountsBehind({
  title,
  sub,
  rows,
  reference,
}: {
  title: string
  sub: string
  rows: readonly {
    code: string
    name: string
    unit: string
    debit: number
    credit: number
  }[]
  /// What a share is a share OF. Zero turns the column off.
  reference: number
}) {
  const [open, setOpen] = useState<string | null>(null)
  const sorted = [...rows]
    .map((r) => ({
      ...r,
      net:
        "2345678".includes(r.code[0]) && "234".includes(r.code[0])
          ? r.credit - r.debit
          : r.debit - r.credit,
    }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
  const chosen = sorted.find((r) => `${r.code}/${r.unit}` === open)
  return (
    <>
      <Section title={title} sub={sub}>
        {sorted.length === 0 ? (
          <EmptyState>Nothing posted in this period.</EmptyState>
        ) : (
          <Table
            head={[
              "Account",
              "Name",
              "Unit",
              "Class",
              ">Debit",
              ">Credit",
              ">Net",
              ">Share",
            ]}
          >
            {sorted.map((r) => (
              <Row
                key={`${r.code}/${r.unit}`}
                className="hover:bg-soft-1 cursor-pointer"
              >
                <Cell mono onClick={() => setOpen(`${r.code}/${r.unit}`)}>
                  {r.code}
                </Cell>
                <Cell className="text-body">{r.name}</Cell>
                <Cell>{r.unit}</Cell>
                <Cell>
                  <Pill tone="neutral">
                    {CLASS_NAME[r.code[0]] ?? r.code[0]}
                  </Pill>
                </Cell>
                <Cell right>
                  <Amount minor={r.debit} muted />
                </Cell>
                <Cell right>
                  <Amount minor={r.credit} muted />
                </Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={r.net} muted />
                </Cell>
                <Cell right className="text-body">
                  {reference
                    ? `${((Math.abs(r.net) / reference) * 100).toFixed(1)}%`
                    : "—"}
                </Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={4}>{count(sorted.length, "account")}</Cell>
              <Cell right>
                <Amount minor={sorted.reduce((n, r) => n + r.debit, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={sorted.reduce((n, r) => n + r.credit, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={sorted.reduce((n, r) => n + r.net, 0)} />
              </Cell>
              <Cell />
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen ? `${chosen.code} ${chosen.name}` : ""}
      >
        {chosen && (
          <Facts>
            <Fact term="Account">{chosen.code}</Fact>
            <Fact term="Unit">{chosen.unit}</Fact>
            <Fact term="Class">{CLASS_NAME[chosen.code[0]] ?? "—"}</Fact>
            <Fact term="Debit">{rp(chosen.debit)}</Fact>
            <Fact term="Credit">{rp(chosen.credit)}</Fact>
            <Fact term="Net">{rp(chosen.net)}</Fact>
          </Facts>
        )}
      </Sheet>
    </>
  )
}

/// Profit & loss.
///
/// This used to be half of a `Financial statements` screen with a toggle. It is
/// two screens now because they are two documents — different periods, different
/// readers, different arguments — and a toggle made the second one something you
/// had to already know was there.
export function ProfitAndLoss() {
  const [unit, setUnit] = useState("")
  const [printing, setPrinting] = useState(false)
  const { byClass, net } = useClasses(unit)
  const period = usePeriod()

  const revenue = net("4")
  const cogs = net("5")
  const opex = net("6") + net("7")
  const other = net("8")
  const result = revenue - cogs - opex - other

  // One definition, drawn by the waterfall and printed by the document, so
  // the paper cannot say something the screen does not.
  const statement = [
    {
      label: "Revenue",
      amount: revenue,
      kind: "add" as const,
      note: "class 4",
    },
    {
      label: "Cost of sales",
      amount: cogs,
      kind: "less" as const,
      note: "class 5",
    },
    {
      label: "Gross margin",
      amount: revenue - cogs,
      kind: "subtotal" as const,
    },
    {
      label: "Operating expenses",
      amount: net("6"),
      kind: "less" as const,
      note: "class 6",
    },
    {
      label: "Other operating expenses",
      amount: net("7"),
      kind: "less" as const,
      note: "class 7",
    },
    {
      label: "Non-operating",
      amount: other,
      kind: "less" as const,
      note: "class 8",
    },
    { label: "Result for the period", amount: result, kind: "total" as const },
  ]

  return (
    <PageContent>
      <PageHeader
        crumb="Reports"
        title="Profit & loss"
        sub="Summed from the journal at the moment you ask. Nothing here is stored."
        actions={UNIT_FILTER(unit, setUnit, () => setPrinting(true))}
      />
      <ChartBand
        title="How revenue becomes the result"
        right={
          revenue
            ? `gross margin ${(((revenue - cogs) / revenue) * 100).toFixed(1)}%`
            : undefined
        }
      >
        <Bridge
          rows={[
            { label: "Revenue", amount: revenue, kind: "start" },
            {
              label: "Cost of sales",
              amount: -cogs,
              kind: "less",
              note: "class 5",
            },
            { label: "Gross margin", amount: revenue - cogs, kind: "subtotal" },
            {
              label: "Operating expenses",
              amount: -net("6"),
              kind: "less",
              note: "class 6",
            },
            {
              label: "Other operating",
              amount: -net("7"),
              kind: "less",
              note: "class 7",
            },
            {
              label: "Non-operating",
              amount: -other,
              kind: "less",
              note: "class 8",
            },
            { label: "Result for the period", amount: result, kind: "total" },
          ]}
        />
      </ChartBand>
      <AccountsBehind
        title={period}
        sub="Every account the statement above is made of, largest first."
        rows={[...byClass.entries()]
          .filter(([k]) => "45678".includes(k))
          .flatMap(([, v]) => v.rows)}
        reference={revenue}
      />

      <PrintSheet open={printing} onOpenChange={setPrinting} title="Laba rugi">
        <StatementDoc
          title="Laporan Laba Rugi"
          period={period}
          scope={unit ? `Unit ${unit}` : "Seluruh unit"}
          rows={statement}
          note="Disusun dari jurnal pada saat dicetak. Tidak ada saldo yang disimpan terpisah."
        />
      </PrintSheet>
    </PageContent>
  )
}

/// Balance sheet.
export function BalanceSheet() {
  const [unit, setUnit] = useState("")
  const [printing, setPrinting] = useState(false)
  const { tb, byClass, net } = useClasses(unit)
  const period = usePeriod()

  const result = net("4") - net("5") - net("6") - net("7") - net("8")
  const assets = net("1")
  const liabilities = net("2")
  const equity = net("3")

  const gap = assets - (liabilities + equity + result)

  const sheet = [
    { label: "Aset", amount: assets, kind: "add" as const, note: "class 1" },
    { label: "Jumlah aset", amount: assets, kind: "subtotal" as const },
    {
      label: "Kewajiban",
      amount: liabilities,
      kind: "add" as const,
      note: "class 2",
    },
    { label: "Ekuitas", amount: equity, kind: "add" as const, note: "class 3" },
    {
      label: "Laba (rugi) periode berjalan",
      amount: result,
      kind: "add" as const,
    },
    {
      label: "Jumlah kewajiban dan ekuitas",
      amount: liabilities + equity + result,
      kind: "total" as const,
    },
  ]

  return (
    <PageContent>
      <PageHeader
        crumb="Reports"
        title="Balance sheet"
        sub="Assets against what funds them, at the last posting date."
        actions={UNIT_FILTER(unit, setUnit, () => setPrinting(true))}
      />
      <ChartBand title="What the business holds, against what funds it">
        <Mirror
          leftLabel="Assets"
          left={assets}
          rightLabel="Liabilities, equity and the result"
          right={liabilities + equity + result}
          action={
            gap === 0 ? (
              <Pill tone="ok">the sheet balances</Pill>
            ) : (
              <Pill tone="bad">out by {rp(gap)}</Pill>
            )
          }
        />
      </ChartBand>
      {!tb.balanced && (
        <Banner tone="bad" className="mb-4">
          <div className="min-w-0">
            The trial balance is out by {rp(tb.total_debit - tb.total_credit)}.
            Nothing below can be relied on until that is found — a balance sheet
            drawn from an unbalanced journal is arithmetic, not a statement.
          </div>
        </Banner>
      )}
      <AccountsBehind
        title={`As at ${period.split("–").pop()?.trim() ?? period}`}
        sub="Every account on the sheet, largest first."
        rows={[...byClass.entries()]
          .filter(([k]) => "123".includes(k))
          .flatMap(([, v]) => v.rows)}
        reference={assets}
      />

      <PrintSheet open={printing} onOpenChange={setPrinting} title="Neraca">
        <StatementDoc
          title="Neraca"
          period={`Per ${period.split("–").pop()?.trim() ?? period}`}
          scope={unit ? `Unit ${unit}` : "Seluruh unit"}
          rows={sheet}
          note={
            gap === 0
              ? "Neraca seimbang."
              : `Neraca tidak seimbang sebesar ${rp(gap)} — jangan ditandatangani sebelum ditemukan.`
          }
        />
      </PrintSheet>
    </PageContent>
  )
}

/// Cash flow — the direct method, built from the money accounts themselves.
///
/// # Why direct and not indirect
///
/// The indirect method starts at the result and adjusts it, which needs an
/// opening balance sheet this prototype does not have and produces a statement
/// nobody can tie to a bank line. The direct method reads what actually moved
/// through `1011001`–`1011004` and asks what the other side of each entry was.
/// Every figure below can be clicked back to a journal entry, which is the only
/// version of this statement a shop's finance staff have ever found useful.
///
/// # How a movement is classified
///
/// By the counter-account's class, and where an entry has several the money is
/// split across them in proportion:
///
///   revenue, cost, expense, receivable, payable, tax   → operating
///   fixed asset, project, pre-opening                  → investing
///   loan, equity, affiliate balance                    → financing
const MONEY = /^10110(0[1-4])/
const isMoney = (code: string) => MONEY.test(code)

function classify(code: string): "operating" | "investing" | "financing" {
  if (code.startsWith("1021") && !code.startsWith("10214")) return "investing"
  if (code.startsWith("10318")) return "investing"
  if (
    code.startsWith("10214") ||
    code.startsWith("2013") ||
    code.startsWith("3013")
  )
    return "financing"
  if (code.startsWith("201230")) return "financing"
  return "operating"
}

export function CashFlow() {
  const b = useBook()
  const [printing, setPrinting] = useState(false)
  const period = usePeriod()
  const [unit, setUnit] = useState("")
  const [open, setOpen] = useState<string | null>(null)

  const movements = useMemo(() => {
    const out: {
      key: string
      entry_id: string
      entry: string
      on: string
      doc: string
      memo: string
      bucket: "operating" | "investing" | "financing"
      counter: string
      counterName: string
      amount: number
    }[] = []
    let seq = 0
    for (const e of b.ledger.allEntries()) {
      // An opening balance is a starting position, not a movement. Left in, the
      // cutover entry is four times the whole month's trading and flattens
      // every real day into the axis.
      if (e.document_ref.startsWith("OB-")) continue
      const money = e.lines.filter(
        (l) => isMoney(l.account_code) && (!unit || l.unit_id === unit)
      )
      if (money.length === 0) continue
      const moved = money.reduce((n, l) => n + l.debit - l.credit, 0)
      if (moved === 0) continue
      const counters = e.lines.filter((l) => !isMoney(l.account_code))
      const weight = counters.reduce((n, l) => n + l.debit + l.credit, 0)
      for (const c of counters) {
        const share = weight ? ((c.debit + c.credit) / weight) * moved : 0
        if (Math.round(share) === 0) continue
        out.push({
          key: `${e.entry_id}-${seq++}`,
          entry_id: e.entry_id,
          entry: e.entry_number,
          on: e.dates.posting_on,
          doc: e.document_ref,
          memo: c.memo ?? e.memo ?? "",
          bucket: classify(c.account_code),
          counter: c.account_code,
          counterName: c.account_name,
          amount: Math.round(share),
        })
      }
    }
    return out.sort((x, y) => y.on.localeCompare(x.on))
  }, [b, unit])

  const sum = (k: string) =>
    movements.filter((m) => m.bucket === k).reduce((n, m) => n + m.amount, 0)
  const operating = sum("operating")
  const investing = sum("investing")
  const financing = sum("financing")
  const chosen = movements.find((m) => m.key === open)

  const byDay = [...new Set(movements.map((m) => m.on))].sort().map((d) => ({
    bucket: d,
    operating: movements
      .filter((m) => m.on === d && m.bucket === "operating")
      .reduce((n, m) => n + m.amount, 0),
    investing: movements
      .filter((m) => m.on === d && m.bucket === "investing")
      .reduce((n, m) => n + m.amount, 0),
    financing: movements
      .filter((m) => m.on === d && m.bucket === "financing")
      .reduce((n, m) => n + m.amount, 0),
  }))

  return (
    <PageContent>
      <PageHeader
        crumb="Reports"
        title="Cash flow"
        sub="Direct method — what actually moved through the money accounts, and what for."
        actions={UNIT_FILTER(unit, setUnit, () => setPrinting(true))}
      />

      <ChartBand
        title="Cash movement by day"
        right={`${rp(operating + investing + financing)} net across ${count(movements.length, "movement")} · opening balances excluded`}
      >
        <MoneyBars
          stacked
          rows={byDay}
          series={[
            { key: "operating", label: "Operating", tone: "accent" },
            { key: "investing", label: "Investing", tone: "cap" },
            { key: "financing", label: "Financing", tone: "ghost" },
          ]}
          labelOf={(d) => d.slice(5)}
        />
      </ChartBand>

      <Section title={`Movements — ${movements.length}`}>
        {movements.length === 0 ? (
          <EmptyState>No money has moved.</EmptyState>
        ) : (
          <Table
            head={[
              "Posted",
              "Entry",
              "Activity",
              "Against",
              "Memo",
              ">In / Out",
            ]}
          >
            {movements.map((m) => (
              <Row
                key={m.key}
                className="hover:bg-soft-1 cursor-pointer"
                tone={m.amount < 0 ? undefined : undefined}
              >
                <Cell
                  className="whitespace-nowrap"
                  onClick={() => setOpen(m.key)}
                >
                  {m.on}
                </Cell>
                <Cell mono>{m.entry}</Cell>
                <Cell>
                  <Pill
                    tone={
                      m.bucket === "operating"
                        ? "accent"
                        : m.bucket === "investing"
                          ? "info"
                          : "neutral"
                    }
                  >
                    {m.bucket}
                  </Pill>
                </Cell>
                <Cell>
                  <span className="text-ink">{m.counterName}</span>
                  <div className="font-mono text-eyebrow text-faint">
                    {m.counter}
                  </div>
                </Cell>
                <Cell className="text-body">{m.memo || "—"}</Cell>
                <Cell
                  right
                  className={`whitespace-nowrap ${m.amount < 0 ? "font-semibold text-bad-fg" : "font-semibold text-ink"}`}
                >
                  <Amount minor={m.amount} />
                </Cell>
              </Row>
            ))}
            <Row tone="muted">
              <Cell colSpan={5}>Operating</Cell>
              <Cell right>
                <Amount minor={operating} />
              </Cell>
            </Row>
            <Row tone="muted">
              <Cell colSpan={5}>Investing</Cell>
              <Cell right>
                <Amount minor={investing} />
              </Cell>
            </Row>
            <Row tone="muted">
              <Cell colSpan={5}>Financing</Cell>
              <Cell right>
                <Amount minor={financing} />
              </Cell>
            </Row>
            <Row tone="total">
              <Cell colSpan={5}>Net movement in cash</Cell>
              <Cell right>
                <Amount minor={operating + investing + financing} />
              </Cell>
            </Row>
          </Table>
        )}
      </Section>

      <PrintSheet open={printing} onOpenChange={setPrinting} title="Arus kas">
        <ReportPrint
          title="Laporan Arus Kas"
          period={period}
          scope={`${unit ? `Unit ${unit}` : "Seluruh unit"} · metode langsung, saldo awal dikeluarkan`}
          columns={[
            { label: "Tanggal", cell: (m) => m.on },
            { label: "Jurnal", cell: (m) => m.entry },
            { label: "Aktivitas", cell: (m) => m.bucket },
            {
              label: "Lawan perkiraan",
              cell: (m) => `${m.counter} ${m.counterName}`,
            },
            {
              label: "Masuk / keluar",
              align: "right",
              cell: (m) => rp(m.amount),
            },
          ]}
          rows={movements}
          total={[
            `${movements.length} pergerakan`,
            "",
            "",
            `operasi ${rp(operating)} · investasi ${rp(investing)} · pendanaan ${rp(financing)}`,
            rp(operating + investing + financing),
          ]}
          note="Setiap baris dapat ditelusuri ke jurnalnya. Saldo awal bukan arus kas dan tidak disertakan."
        />
      </PrintSheet>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.counterName ?? ""}
        id={chosen?.entry}
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Posted">{chosen.on}</Fact>
              <Fact term="Entry">{chosen.entry}</Fact>
              <Fact term="Document">{chosen.doc}</Fact>
              <Fact term="Activity">{chosen.bucket}</Fact>
              <Fact term="Against">{chosen.counter}</Fact>
              <Fact term="Amount">{rp(chosen.amount)}</Fact>
            </Facts>
            <div>
              <SubHead>Why it is classified this way</SubHead>
              <p className="mt-2 text-meta text-body">
                The money moved against{" "}
                <span className="font-mono">{chosen.counter}</span>, which is{" "}
                {chosen.bucket === "investing"
                  ? "a fixed asset, a project or a deferred opening cost — money spent on capacity rather than on trading."
                  : chosen.bucket === "financing"
                    ? "a loan, an equity account or an affiliate balance — money raised or returned rather than earned."
                    : "revenue, a cost, or a balance that settles one — the trading cycle."}
              </p>
              <p className="mt-2 text-meta text-mute">
                Where one entry moved money against several accounts, the amount
                is split between them in proportion, so the three activities
                still add to the movement in cash.
              </p>
            </div>
          </div>
        )}
      </Sheet>
    </PageContent>
  )
}

/// Trial balance — every account that moved, and the proof the two columns agree.
export function TrialBalance() {
  const b = useBook()
  const [printing, setPrinting] = useState(false)
  const period = usePeriod()
  const [unit, setUnit] = useState("")
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<string | null>(null)

  const tb = b.ledger.trialBalance({
    book_id: "CFS",
    unit_id: unit || undefined,
  })
  const needle = q.trim().toLowerCase()
  const rows = tb.rows.filter(
    (r) => !needle || `${r.code} ${r.name}`.toLowerCase().includes(needle)
  )
  const chosen = tb.rows.find((r) => `${r.code}/${r.unit}` === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Reports"
        title="Trial balance"
        sub="Every account posted to, with both its totals."
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
          { label: "Accounts", value: String(tb.rows.length) },
          { label: "Total debits", value: rp(tb.total_debit) },
          { label: "Total credits", value: rp(tb.total_credit) },
          {
            label: "Difference",
            value: rp(tb.total_debit - tb.total_credit),
            tone: tb.balanced ? "up" : "down",
            sub: tb.balanced ? "balanced" : "out of balance",
          },
        ]}
      />

      <Section title={`Accounts — ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState>No account matches.</EmptyState>
        ) : (
          <Table
            head={[
              "Account",
              "Name",
              "Unit",
              "Class",
              ">Debit",
              ">Credit",
              ">Net",
            ]}
          >
            {rows.map((r) => (
              <Row
                key={`${r.code}/${r.unit}`}
                className="hover:bg-soft-1 cursor-pointer"
              >
                <Cell mono onClick={() => setOpen(`${r.code}/${r.unit}`)}>
                  {r.code}
                </Cell>
                <Cell className="text-body">{r.name}</Cell>
                <Cell>{r.unit}</Cell>
                <Cell>
                  <Pill tone="neutral">
                    {CLASS_NAME[r.code[0]] ?? r.code[0]}
                  </Pill>
                </Cell>
                <Cell right>
                  <Amount minor={r.debit} muted />
                </Cell>
                <Cell right>
                  <Amount minor={r.credit} muted />
                </Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={r.debit - r.credit} muted />
                </Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={4}>{count(rows.length, "account")}</Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, r) => n + r.debit, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, r) => n + r.credit, 0)} />
              </Cell>
              <Cell right>
                <Amount
                  minor={rows.reduce((n, r) => n + r.debit - r.credit, 0)}
                />
              </Cell>
            </Row>
          </Table>
        )}
      </Section>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Neraca saldo"
      >
        <ReportPrint
          title="Neraca Saldo"
          period={period}
          scope={unit ? `Unit ${unit}` : "Seluruh unit"}
          columns={[
            { label: "Kode", cell: (r) => r.code },
            { label: "Perkiraan", cell: (r) => r.name },
            { label: "Unit", cell: (r) => r.unit },
            {
              label: "Debet",
              align: "right",
              cell: (r) => (r.debit ? rp(r.debit) : ""),
            },
            {
              label: "Kredit",
              align: "right",
              cell: (r) => (r.credit ? rp(r.credit) : ""),
            },
          ]}
          rows={rows}
          total={[
            `${rows.length} perkiraan`,
            "",
            "",
            rp(rows.reduce((n, r) => n + r.debit, 0)),
            rp(rows.reduce((n, r) => n + r.credit, 0)),
          ]}
          note={
            tb.balanced
              ? "Kedua kolom seimbang."
              : `Selisih ${rp(tb.total_debit - tb.total_credit)} — jangan ditandatangani sebelum ditemukan.`
          }
        />
      </PrintSheet>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen ? `${chosen.code} ${chosen.name}` : ""}
        width="wide"
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Account">{chosen.code}</Fact>
              <Fact term="Unit">{chosen.unit}</Fact>
              <Fact term="Class">{CLASS_NAME[chosen.code[0]] ?? "—"}</Fact>
              <Fact term="Debit">{rp(chosen.debit)}</Fact>
              <Fact term="Credit">{rp(chosen.credit)}</Fact>
              <Fact term="Net">{rp(chosen.debit - chosen.credit)}</Fact>
            </Facts>
            <div>
              <SubHead>Every movement</SubHead>
              <Table
                head={["Entry", "Posted", "Document", ">Debit", ">Credit"]}
              >
                {b.ledger
                  .allEntries()
                  .flatMap((e) =>
                    e.lines
                      .filter(
                        (l) =>
                          l.account_code === chosen.code &&
                          l.unit_id === chosen.unit
                      )
                      .map((l, i) => ({ e, l, i }))
                  )
                  .map(({ e, l, i }) => (
                    <Row key={`${e.entry_id}-${i}`}>
                      <Cell mono>{e.entry_number}</Cell>
                      <Cell className="whitespace-nowrap">
                        {e.dates.posting_on}
                      </Cell>
                      <Cell mono className="text-mute">
                        {e.document_ref}
                      </Cell>
                      <Cell right>
                        <Amount minor={l.debit} muted />
                      </Cell>
                      <Cell right>
                        <Amount minor={l.credit} muted />
                      </Cell>
                    </Row>
                  ))}
              </Table>
            </div>
          </div>
        )}
      </Sheet>
    </PageContent>
  )
}

/// Unit / HO / consolidated — the same statement, three ways.

///
/// # Why the consolidated column is not simply the sum
///
/// Because head office and thirteen shops trade with each other. Goods sent are
/// a receivable in one book and a payable in the other; management fee is
/// revenue at HO and a cost at the shop. Adding the columns up counts both
/// sides, which is why the interunit balances are shown as an elimination line
/// rather than folded silently into the total.
export function Consolidated() {
  const b = useBook()
  const [printing, setPrinting] = useState(false)
  const period = usePeriod()
  const [open, setOpen] = useState<string | null>(null)
  const units = ["HO", "C004", "C006"]

  const tbFor = (u: string) =>
    b.ledger.trialBalance({ book_id: "CFS", unit_id: u })
  const netClass = (u: string, k: string) => {
    const rows = tbFor(u).rows.filter((r) => r.code.startsWith(k))
    const debit = rows.reduce((n, r) => n + r.debit, 0)
    const credit = rows.reduce((n, r) => n + r.credit, 0)
    return "234".includes(k) ? credit - debit : debit - credit
  }

  const rows = units.map((u) => {
    const revenue = netClass(u, "4")
    const cogs = netClass(u, "5")
    const opex = netClass(u, "6") + netClass(u, "7") + netClass(u, "8")
    return {
      unit: u,
      revenue,
      cogs,
      opex,
      result: revenue - cogs - opex,
      assets: netClass(u, "1"),
    }
  })

  const eliminations = b.interunitMoves.reduce(
    (n, m) => n + (m.amount - m.settled),
    0
  )
  const chosen = rows.find((r) => r.unit === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Reports"
        title="Unit / HO / consolidated"
        sub="Each book on its own, and the group after the interunit balances come out."

        actions={
          <Button onClick={() => setPrinting(true)}>
            <Printer className="size-3.5" />
            Print
          </Button>
        }
      />

      <ChartBand
        title="Result by unit"
        right={`${rp(eliminations)} of affiliation balances to eliminate`}
      >
        <MoneyBars
          rows={rows.map((r) => ({
            bucket: r.unit,
            revenue: r.revenue,
            result: r.result,
          }))}
          series={[
            { key: "revenue", label: "Revenue", tone: "accent" },
            { key: "result", label: "Result", tone: "cap" },
          ]}
        />
      </ChartBand>

      <Section title="By unit, then the group">
        <Table
          head={[
            "Unit",
            ">Revenue",
            ">Cost of Sales",
            ">Expenses",
            ">Result",
            ">Assets",
            "",
          ]}
        >
          {rows.map((r) => (
            <Row key={r.unit} className="hover:bg-soft-1 cursor-pointer">
              <Cell onClick={() => setOpen(r.unit)}>
                <span className="text-ink">{r.unit}</span>
              </Cell>
              <Cell right>
                <Amount minor={r.revenue} muted />
              </Cell>
              <Cell right className="text-body">
                <Amount minor={r.cogs} muted />
              </Cell>
              <Cell right className="text-body">
                <Amount minor={r.opex} muted />
              </Cell>
              <Cell
                right
                className={
                  r.result < 0
                    ? "font-semibold text-bad-fg"
                    : "font-semibold text-ink"
                }
              >
                <Amount minor={r.result} muted />
              </Cell>
              <Cell right>
                <Amount minor={r.assets} muted />
              </Cell>
              <Cell>
                <button
                  type="button"
                  onClick={() => setOpen(r.unit)}
                  className="font-medium text-accent hover:underline"
                >
                  Open
                </button>
              </Cell>
            </Row>
          ))}
          <Row tone="muted">
            <Cell>Sum of the books</Cell>
            <Cell right>
              <Amount minor={rows.reduce((n, r) => n + r.revenue, 0)} muted />
            </Cell>
            <Cell right>
              <Amount minor={rows.reduce((n, r) => n + r.cogs, 0)} muted />
            </Cell>
            <Cell right>
              <Amount minor={rows.reduce((n, r) => n + r.opex, 0)} muted />
            </Cell>
            <Cell right>
              <Amount minor={rows.reduce((n, r) => n + r.result, 0)} muted />
            </Cell>
            <Cell right>
              <Amount minor={rows.reduce((n, r) => n + r.assets, 0)} muted />
            </Cell>
            <Cell />
          </Row>
          <Row tone="muted">
            <Cell>Affiliation eliminations</Cell>
            <Cell colSpan={4} className="text-body">
              Goods, funding and management fee counted in two books
            </Cell>
            <Cell right className="text-bad-fg">
              <Amount minor={-eliminations} />
            </Cell>
            <Cell />
          </Row>
          <Row tone="total">
            <Cell>Consolidated</Cell>
            <Cell right>
              <Amount minor={rows.reduce((n, r) => n + r.revenue, 0)} />
            </Cell>
            <Cell right>
              <Amount minor={rows.reduce((n, r) => n + r.cogs, 0)} />
            </Cell>
            <Cell right>
              <Amount minor={rows.reduce((n, r) => n + r.opex, 0)} />
            </Cell>
            <Cell right>
              <Amount minor={rows.reduce((n, r) => n + r.result, 0)} />
            </Cell>
            <Cell right>
              <Amount
                minor={rows.reduce((n, r) => n + r.assets, 0) - eliminations}
              />
            </Cell>
            <Cell />
          </Row>
        </Table>
      </Section>

      <Banner tone="warn" className="mt-4">
        <div className="min-w-0">
          The elimination is one-sided. A proper consolidation needs both books
          to agree on every interunit balance, and the counterparty journals
          supplied for this client are duplicates of one unit's export — so the
          figure above is our side of the balance, not a proved elimination.
        </div>
      </Banner>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Konsolidasi"
      >
        <ReportPrint
          title="Laporan Konsolidasi"
          period={period}
          scope="Per unit, lalu grup setelah eliminasi afiliasi"
          columns={[
            { label: "Unit", cell: (r) => r.unit },
            { label: "Pendapatan", align: "right", cell: (r) => rp(r.revenue) },
            { label: "Beban pokok", align: "right", cell: (r) => rp(r.cogs) },
            { label: "Beban", align: "right", cell: (r) => rp(r.opex) },
            { label: "Hasil", align: "right", cell: (r) => rp(r.result) },
            { label: "Aset", align: "right", cell: (r) => rp(r.assets) },
          ]}
          rows={rows}
          total={[
            "Konsolidasi",
            rp(rows.reduce((n, r) => n + r.revenue, 0)),
            rp(rows.reduce((n, r) => n + r.cogs, 0)),
            rp(rows.reduce((n, r) => n + r.opex, 0)),
            rp(rows.reduce((n, r) => n + r.result, 0)),
            rp(rows.reduce((n, r) => n + r.assets, 0) - eliminations),
          ]}
          note={`Eliminasi afiliasi ${rp(eliminations)} adalah sisi kami saja. Jurnal pembanding dari unit lawan belum diterima, sehingga eliminasi ini belum terbukti dua arah.`}
        />
      </PrintSheet>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.unit ?? ""}
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Revenue">{rp(chosen.revenue)}</Fact>
              <Fact term="Cost of sales">{rp(chosen.cogs)}</Fact>
              <Fact term="Expenses">{rp(chosen.opex)}</Fact>
              <Fact term="Result">{rp(chosen.result)}</Fact>
              <Fact term="Assets">{rp(chosen.assets)}</Fact>
              <Fact term="Gross margin">
                {chosen.revenue
                  ? `${(((chosen.revenue - chosen.cogs) / chosen.revenue) * 100).toFixed(1)}%`
                  : "—"}
              </Fact>
            </Facts>
            <div>
              <SubHead>Affiliation balances involving {chosen.unit}</SubHead>
              <Table
                head={["Reference", "From", "To", "Family", ">Outstanding"]}
              >
                {b.interunitMoves
                  .filter(
                    (m) =>
                      m.from_unit === chosen.unit || m.to_unit === chosen.unit
                  )
                  .map((m) => (
                    <Row key={m.move_id}>
                      <Cell mono>{m.reference}</Cell>
                      <Cell>{m.from_unit}</Cell>
                      <Cell>{m.to_unit}</Cell>
                      <Cell className="text-body">
                        {m.family.toLowerCase()}
                      </Cell>
                      <Cell right>
                        <Amount minor={m.amount - m.settled} muted />
                      </Cell>
                    </Row>
                  ))}
              </Table>
            </div>
          </div>
        )}
      </Sheet>
    </PageContent>
  )
}
