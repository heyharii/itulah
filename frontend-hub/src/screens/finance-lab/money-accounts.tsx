import { Fragment, useMemo, useState } from "react"

import { Printer } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { BarSeries } from "@/components/ui/chart"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState } from "@/components/ui/states"
import { CHART } from "@/screens/finance-lab/engine/chart"
import {
  Amount,
  Cell,
  Row,
  Section,
  Table,
  rp,
  count,
} from "@/screens/finance-lab/parts"
import { PrintSheet, ReportPrint } from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"

/// Every account money can sit in, and what is in it.
///
/// # No filters
///
/// This is the list, whole. The client keeps 196 money accounts — 42 cash, 70
/// giro, 70 savings, 14 time deposits — and the question it answers is "where
/// is our money", which a filter can only make harder. Narrowing happens by
/// clicking a store total above, and drilling happens by clicking a row.
///
/// # The families, from the client's own chart
///
///   1011001  CASH ON HAND           Cash on Hand · Petty Cash · Modal Kasir
///   1011002  CASH IN BANK GIRO      BCA · Mandiri · BRI · BNI · DANAMON
///   1011003  CASH IN BANK TABUNGAN  BCA · Mandiri · BRI · BNI · BTN
///   1011004  TIME DEPOSIT           BCA · Mandiri · BRI · BNI
///
/// The fifth bank differs between giro and savings — DANAMON on one, BTN on the
/// other — which a single hand-typed bank list gets wrong silently, because
/// both codes exist and both post.
const FAMILY: Record<string, { label: string; kind: string; order: number }> = {
  "1011001001": { label: "Cash on hand", kind: "Cash", order: 1 },
  "1011001002": { label: "Petty cash", kind: "Cash", order: 2 },
  "1011001003": { label: "Cashier float", kind: "Cash", order: 3 },
  "1011002001": { label: "Giro BCA", kind: "Giro", order: 4 },
  "1011002002": { label: "Giro Mandiri", kind: "Giro", order: 5 },
  "1011002003": { label: "Giro BRI", kind: "Giro", order: 6 },
  "1011002004": { label: "Giro BNI", kind: "Giro", order: 7 },
  "1011002005": { label: "Giro Danamon", kind: "Giro", order: 8 },
  "1011003001": { label: "Savings BCA", kind: "Savings", order: 9 },
  "1011003002": { label: "Savings Mandiri", kind: "Savings", order: 10 },
  "1011003003": { label: "Savings BRI", kind: "Savings", order: 11 },
  "1011003004": { label: "Savings BNI", kind: "Savings", order: 12 },
  "1011003005": { label: "Savings BTN", kind: "Savings", order: 13 },
  "1011004001": { label: "Time deposit BCA", kind: "Deposit", order: 14 },
  "1011004002": { label: "Time deposit Mandiri", kind: "Deposit", order: 15 },
  "1011004003": { label: "Time deposit BRI", kind: "Deposit", order: 16 },
  "1011004004": { label: "Time deposit BNI", kind: "Deposit", order: 17 },
}

const KIND_TONE: Record<string, "neutral" | "info" | "accent" | "warn"> = {
  Cash: "neutral",
  Giro: "info",
  Savings: "accent",
  Deposit: "warn",
}

export function MoneyAccounts() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [store, setStore] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const all = useMemo(() => {
    const moves = new Map<string, number>()
    for (const e of b.ledger.allEntries()) {
      for (const l of e.lines) {
        const k = `${l.account_code}/${l.unit_id}`
        moves.set(k, (moves.get(k) ?? 0) + 1)
      }
    }
    // Twelve characters only. The chart holds the client's whole ladder now,
    // so `1011001001` — the account rung itself, with no unit — passes the
    // family test as readily as its fourteen leaves do, and counted itself as
    // a fifteenth store holding no money.
    return CHART.filter(
      (a) => a.code.length === 12 && FAMILY[a.code.slice(0, 10)]
    )
      .map((a) => {
        const f = FAMILY[a.code.slice(0, 10)]
        const u = a.unit_id ?? ""
        return {
          code: a.code,
          name: a.name,
          unit: u,
          label: f.label,
          kind: f.kind,
          order: f.order,
          balance: b.ledger.balance(a.code, { unit_id: u }),
          moves: moves.get(`${a.code}/${u}`) ?? 0,
        }
      })
      .sort((x, y) => x.unit.localeCompare(y.unit) || x.order - y.order)
  }, [b])

  const estate = all.reduce((n, a) => n + a.balance, 0)

  /// Stores with money first, then the ones without. A store at zero is still a
  /// store and still gets a figure — "no money here" is a fact, and hiding it
  /// makes the total impossible to check by addition.
  const byStore = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of all) m.set(a.unit, (m.get(a.unit) ?? 0) + a.balance)
    return [...m.entries()].sort(
      (x, y) => y[1] - x[1] || x[0].localeCompare(y[0])
    )
  }, [all])

  const byKind = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of all) {
      if (store && a.unit !== store) continue
      m.set(a.kind, (m.get(a.kind) ?? 0) + a.balance)
    }
    return ["Cash", "Giro", "Savings", "Deposit"].map(
      (k) => [k, m.get(k) ?? 0] as const
    )
  }, [all, store])

  /// One bar per unit, split cash against bank. Units are in the client's own
  /// order — HO then C001…C013 — not sorted by size, because a chart people
  /// return to should keep its bars where they were last time.
  const chartRows = useMemo(() => {
    const m = new Map<string, { cash: number; bank: number }>()
    for (const a of all) {
      const v = m.get(a.unit) ?? { cash: 0, bank: 0 }
      if (a.kind === "Cash") v.cash += a.balance
      else v.bank += a.balance
      m.set(a.unit, v)
    }
    return [...m.entries()]
      .sort((x, y) =>
        x[0] === "HO" ? -1 : y[0] === "HO" ? 1 : x[0].localeCompare(y[0])
      )
      .map(([unit, v]) => ({ bucket: unit, cash: v.cash, bank: v.bank }))
  }, [all])

  const rows = all.filter(
    (a) => (!store || a.unit === store) && (a.balance !== 0 || a.moves > 0)
  )
  const total = rows.reduce((n, a) => n + a.balance, 0)
  const grouped = useMemo(() => {
    const m = new Map<string, typeof rows>()
    for (const a of rows) m.set(a.unit, [...(m.get(a.unit) ?? []), a])
    return [...m.entries()].sort((x, y) =>
      x[0] === "HO" ? -1 : y[0] === "HO" ? 1 : x[0].localeCompare(y[0])
    )
  }, [rows])

  const chosen = all.find((a) => `${a.code}/${a.unit}` === open)

  const movements = useMemo(() => {
    if (!chosen) return []
    const out: {
      entry: string
      on: string
      doc: string
      memo: string
      debit: number
      credit: number
      running: number
    }[] = []
    let running = 0
    for (const e of [...b.ledger.allEntries()].sort((x, y) =>
      x.dates.posting_on.localeCompare(y.dates.posting_on)
    )) {
      for (const l of e.lines) {
        if (l.account_code !== chosen.code || l.unit_id !== chosen.unit)
          continue
        running += l.debit - l.credit
        out.push({
          entry: e.entry_number,
          on: e.dates.posting_on,
          doc: e.document_ref,
          memo: l.memo ?? e.memo ?? "",
          debit: l.debit,
          credit: l.credit,
          running,
        })
      }
    }
    return out
  }, [b, chosen])

  return (
    <PageContent>
      <PageHeader
        crumb="Cash & bank"
        title="Accounts"
        sub="Every account this business keeps money in."
        actions={
          <Button onClick={() => setPrinting(true)}>
            <Printer className="size-3.5" />
            Print
          </Button>
        }
      />

      {/* Straight on the page. A headline figure inside a card, above a card of
          numbers, is two boxes where one reading is wanted. */}
      <div className="mb-5">
        <div className="font-mono text-eyebrow tracking-[0.04em] text-body uppercase">
          Money held
        </div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3">
          <span className="text-[2rem] leading-none font-semibold text-ink tabular-nums">
            {rp(estate)}
          </span>
          <span className="text-meta text-mute">
            across {count(byStore.length, "unit")} ·{" "}
            {count(all.length, "account")}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-meta">
          {byKind.map(([k, v]) => (
            <span key={k} className="text-body">
              {k}{" "}
              <span className="font-semibold text-ink tabular-nums">
                {rp(v)}
              </span>
            </span>
          ))}
        </div>
      </div>

      <Section
        title="Where it is held"
        right={
          store ? (
            <button
              type="button"
              onClick={() => {
                setStore(null)
                setOpen(null)
              }}
              className="text-[0.875rem] font-medium whitespace-nowrap text-accent hover:underline"
            >
              Show all units
            </button>
          ) : (
            <span className="text-meta text-mute">
              Click a bar to narrow the list
            </span>
          )
        }
      >
        <BarSeries
          rows={chartRows}
          series={[
            { key: "cash", label: "Cash", tone: "cap" },
            { key: "bank", label: "Bank", tone: "accent" },
          ]}
          stacked
          format={(v) => rp(v)}
          titleOf={(bucket) => bucket}
          labelOf={(bucket) => bucket}
        />
      </Section>

      {chosen ? (
        <Section
          title={`${chosen.name} — ${count(movements.length, "movement")}`}
          right={
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="text-[0.875rem] font-medium whitespace-nowrap text-accent hover:underline"
            >
              Back to accounts
            </button>
          }
        >
          {movements.length === 0 ? (
            <EmptyState>No movements on this account.</EmptyState>
          ) : (
            <Table
              head={[
                "Date",
                "Journal",
                "Document",
                "Memo",
                ">In",
                ">Out",
                ">Balance",
              ]}
            >
              {movements.map((m, i) => (
                <Row key={i}>
                  <Cell className="whitespace-nowrap">{m.on}</Cell>
                  <Cell mono>{m.entry}</Cell>
                  <Cell mono className="text-mute">
                    {m.doc}
                  </Cell>
                  <Cell className="text-body">{m.memo || "—"}</Cell>
                  <Cell right>
                    <Amount minor={m.debit} muted />
                  </Cell>
                  <Cell right>
                    <Amount minor={m.credit} muted />
                  </Cell>
                  <Cell right className="font-semibold text-ink">
                    <Amount minor={m.running} />
                  </Cell>
                </Row>
              ))}
              <Row tone="total">
                <Cell colSpan={4} className="whitespace-nowrap">
                  {count(movements.length, "movement")}
                </Cell>
                <Cell right>
                  <Amount minor={movements.reduce((n, m) => n + m.debit, 0)} />
                </Cell>
                <Cell right>
                  <Amount minor={movements.reduce((n, m) => n + m.credit, 0)} />
                </Cell>
                <Cell right>
                  <Amount minor={movements.at(-1)?.running ?? 0} />
                </Cell>
              </Row>
            </Table>
          )}
        </Section>
      ) : (
        <Section
          title={
            store
              ? `${store} — ${count(rows.length, "account")} in use`
              : `${count(rows.length, "account")} in use`
          }
        >
          {rows.length === 0 ? (
            <EmptyState>No account here has been used.</EmptyState>
          ) : (
            <Table head={["Account", "Kind", "Code", ">Movements", ">Balance"]}>
              {grouped.map(([unit, list]) => (
                <Fragment key={unit}>
                  <Row className="bg-soft-1">
                    <Cell className="font-semibold text-ink">{unit}</Cell>
                    <Cell colSpan={2} className="text-mute">
                      {count(list.length, "account")}
                    </Cell>
                    <Cell right className="text-body">
                      {list.reduce((n, a) => n + a.moves, 0)}
                    </Cell>
                    <Cell right className="font-semibold text-ink">
                      <Amount minor={list.reduce((n, a) => n + a.balance, 0)} />
                    </Cell>
                  </Row>
                  {list.map((a) => (
                    <Row
                      key={`${a.code}/${a.unit}`}
                      className="hover:bg-soft-1 cursor-pointer"
                    >
                      <Cell
                        onClick={() => setOpen(`${a.code}/${a.unit}`)}
                        className="pl-4"
                      >
                        {a.label}
                      </Cell>
                      <Cell>
                        <Pill tone={KIND_TONE[a.kind]}>
                          {a.kind.toLowerCase()}
                        </Pill>
                      </Cell>
                      <Cell mono className="text-mute">
                        {a.code}
                      </Cell>
                      <Cell right className="text-body">
                        {a.moves || "—"}
                      </Cell>
                      <Cell right className="font-semibold text-ink">
                        <Amount minor={a.balance} muted />
                      </Cell>
                    </Row>
                  ))}
                </Fragment>
              ))}
              <Row tone="total">
                <Cell colSpan={3} className="whitespace-nowrap">
                  {count(rows.length, "account")}
                </Cell>
                <Cell right>{rows.reduce((n, a) => n + a.moves, 0)}</Cell>
                <Cell right>
                  <Amount minor={total} />
                </Cell>
              </Row>
            </Table>
          )}
        </Section>
      )}

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Daftar Rekening Kas & Bank"
      >
        <ReportPrint
          title="Daftar Rekening Kas & Bank"
          period={"Per 2026-08-01"}
          scope={`${store ?? "Seluruh unit"}`}
          columns={[
            { label: "Perkiraan", cell: (r) => r.label },
            { label: "Kode", cell: (r) => r.code },
            { label: "Jenis", cell: (r) => r.kind },
            { label: "Unit", cell: (r) => r.unit },
            { label: "Mutasi", align: "right", cell: (r) => String(r.moves) },
            { label: "Saldo", align: "right", cell: (r) => rp(r.balance) },
          ]}
          rows={rows}
        />
      </PrintSheet>
    </PageContent>
  )
}
