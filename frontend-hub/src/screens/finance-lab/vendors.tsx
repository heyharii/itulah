import { useMemo, useState } from "react"
import { Plus, Printer, Search } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { PrintSheet, ReportPrint } from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import { type Vendor } from "@/screens/finance-lab/engine/data"
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
  NewRecord,
} from "@/screens/finance-lab/parts"

/// Suppliers and vendors — one screen written twice, because the client's own
/// chart keeps them apart.
///
/// # Why this is two menus and not one
///
/// An earlier version of this file argued the opposite, in as many words: that
/// procurement says supplier, finance says vendor, and they are one legal
/// entity, so one list. That was reasoning from first principles at a client
/// who had already decided. Their chart:
///
///   2012001001  Hutang Suppliers Barang Dagangan
///   2012001002  Hutang Supplier Barang Dagang — Suspend
///   2012001003  Hutang Supplier Non Barang Dagang
///
/// Two liability accounts means two ageing reports means two menus. And the
/// work genuinely differs: merchandise runs weekly against a purchase order and
/// a goods receipt, and the question is *did the delivery match*; PLN and the
/// landlord run monthly against a meter reading or a contract, and the question
/// is *is this the usual amount*. A single table would have a `PO` column that
/// is empty for half the rows and a `usage` column empty for the other half.
///
/// The third account is not a third menu. `Suspend` is a bill somebody has
/// stopped — a status, shown on the bill, and counted here so a supplier's
/// balance never quietly excludes it.
///
/// # What a row has to answer
///
/// Four things in the order they get asked: how much do we owe, how much of
/// that is late, when is the next one due, and can we pay them at all — which
/// is the bank details, and their absence is why a payment run stalls on a
/// Friday afternoon.
const TODAY = "2026-08-01"
const age = (d: string) =>
  Math.round((Date.parse(TODAY) - Date.parse(d)) / 86_400_000)

interface PartyKind {
  readonly title: string
  readonly sub: string
  readonly account: string
  readonly accept: (v: Vendor) => boolean
  readonly kinds: readonly { value: string; label: string }[]
  readonly newLabel: string
}

const SUPPLIER: PartyKind = {
  title: "Suppliers",
  sub: "Merchandise. Bought against a purchase order, owed on 2012001001.",
  account: "2012001001",
  accept: (v) => v.kind === "MERCHANDISE",
  kinds: [{ value: "MERCHANDISE", label: "Merchandise" }],
  newLabel: "New supplier",
}

const VENDOR: PartyKind = {
  title: "Vendors",
  sub: "Utilities, landlords and services. Not merchandise — owed on 2012001003.",
  account: "2012001003",
  accept: (v) => v.kind !== "MERCHANDISE",
  kinds: [
    { value: "UTILITY", label: "Utility" },
    { value: "SERVICE", label: "Service" },
  ],
  newLabel: "New vendor",
}

export function Suppliers() {
  return <PartyList spec={SUPPLIER} />
}

export function Vendors() {
  return <PartyList spec={VENDOR} />
}

function PartyList({ spec }: { spec: PartyKind }) {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const version = b.snapshot()
  const [q, setQ] = useState("")
  const [kind, setKind] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const rows = useMemo(() => {
    return b.vendors
      .filter(spec.accept)
      .map((v) => {
        const bills = b.bills.filter((x) => x.supplier === v.name)
        const openBills = bills.filter((x) => x.status !== "PAID")
        const owed = openBills.reduce((n, x) => n + (x.total - x.paid), 0)
        const overdue = openBills.filter((x) => age(x.due_on) > 0)
        const nextDue = openBills
          .map((x) => x.due_on)
          .sort()
          .at(0)
        const paid = bills
          .filter((x) => x.status === "PAID")
          .reduce((n, x) => n + x.paid, 0)
        return { v, bills, openBills, owed, overdue, nextDue, paid }
      })
      .filter(
        (r) => !q || r.v.name.toLowerCase().includes(q.trim().toLowerCase())
      )
      .filter((r) => !kind || r.v.kind === kind)
      .sort((a, b) => b.owed - a.owed)
    // `version` is the book's write counter. The registers are replaced on the
    // same `b`, whose identity never changes, so this is the only dependency
    // that moves when one of them does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, kind, spec, b, version])

  const owed = rows.reduce((n, r) => n + r.owed, 0)
  const overdueAmt = rows.reduce(
    (n, r) => n + r.overdue.reduce((s, x) => s + (x.total - x.paid), 0),
    0
  )
  const noBank = rows.filter((r) => !r.v.bank && r.owed > 0)
  const openCount = rows.reduce((n, r) => n + r.openBills.length, 0)
  const overdueCount = rows.reduce((n, r) => n + r.overdue.length, 0)
  const showKind = spec.kinds.length > 1
  const chosen = rows.find((r) => r.v.vendor_id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Expenses & bills"
        title={spec.title}
        sub={spec.sub}
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={() => setPrinting(true)}>
              <Printer className="size-3.5" />
              Print
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" />
              {spec.newLabel}
            </Button>
          </div>
        }
      />

      <Filters>
        {spec.kinds.length > 1 && (
          <Select value={kind} onChange={setKind} className={FILTER_W}>
            <option value="">All kinds</option>
            {spec.kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        )}
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
            label: "Owed",
            value: rp(owed),
            sub: `${openCount} ${openCount === 1 ? "bill" : "bills"} open`,
          },
          {
            label: "Overdue",
            value: rp(overdueAmt),
            tone: overdueAmt ? "down" : "flat",
            sub: `${overdueCount} ${overdueCount === 1 ? "bill" : "bills"} past due`,
          },
          {
            label: "Paid this month",
            value: rp(rows.reduce((n, r) => n + r.paid, 0)),
          },
          {
            label: "Cannot be paid",
            value: String(noBank.length),
            sub: noBank.length ? "no bank details on file" : "all payable",
            tone: noBank.length ? "down" : "flat",
          },
        ]}
      />

      <Section title={`${spec.title} — ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState>Nothing matches.</EmptyState>
        ) : (
          <Table
            head={[
              "Name",
              ...(showKind ? ["Kind"] : []),
              "Terms",
              "Next due",
              ">Open",
              ">Owed",
              "Payable to",
              "",
            ]}
          >
            {rows.map((r) => (
              <Row
                key={r.v.vendor_id}
                className="hover:bg-soft-1 cursor-pointer"
                tone={r.overdue.length ? "warn" : undefined}
              >
                <Cell onClick={() => setOpen(r.v.vendor_id)}>
                  <span className="text-ink">{r.v.name}</span>
                  <div className="text-eyebrow text-faint">
                    {r.v.email ?? r.v.phone ?? "no contact"}
                  </div>
                </Cell>
                <Cell>
                  <Pill
                    tone={r.v.kind === "MERCHANDISE" ? "accent" : "neutral"}
                  >
                    {r.v.kind.toLowerCase()}
                  </Pill>
                </Cell>
                <Cell className="text-body">
                  {r.v.terms_days ? `${days(r.v.terms_days)}` : "—"}
                </Cell>
                <Cell className="whitespace-nowrap">
                  {r.nextDue ?? "—"}
                  {r.nextDue && age(r.nextDue) > 0 && (
                    <div className="text-eyebrow text-bad-fg">
                      {days(age(r.nextDue))} late
                    </div>
                  )}
                </Cell>
                <Cell right>{r.openBills.length || "—"}</Cell>
                <Cell
                  right
                  className={r.owed ? "font-semibold text-ink" : undefined}
                >
                  <Amount minor={r.owed} muted />
                </Cell>
                <Cell>
                  {r.v.bank ? (
                    <span className="text-body">{r.v.bank}</span>
                  ) : (
                    <span className="text-bad-fg">missing</span>
                  )}
                </Cell>
                <Cell>
                  <button
                    type="button"
                    onClick={() => setOpen(r.v.vendor_id)}
                    className="font-medium text-accent hover:underline"
                  >
                    {r.owed ? "Pay" : "Bill"}
                  </button>
                </Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={showKind ? 4 : 3}>
                {rows.length} on {spec.account}
              </Cell>
              <Cell right>{openCount}</Cell>
              <Cell right>
                <Amount minor={owed} />
              </Cell>
              <Cell colSpan={2} />
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.v.name ?? ""}
        actions={
          chosen?.owed ? (
            <Button
              variant="primary"
              onClick={() =>
                chosen.openBills.forEach((x) => b.payBill(x.bill_id))
              }
            >
              Pay balance
            </Button>
          ) : undefined
        }
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Kind">{chosen.v.kind.toLowerCase()}</Fact>
              <Fact term="Payable account">{spec.account}</Fact>
              <Fact term="Terms">
                {chosen.v.terms_days ? `${days(chosen.v.terms_days)}` : "—"}
              </Fact>
              <Fact term="Phone">{chosen.v.phone ?? "—"}</Fact>
              <Fact term="Email">{chosen.v.email ?? "—"}</Fact>
              <Fact term="Bank">
                {chosen.v.bank ?? <span className="text-bad-fg">missing</span>}
              </Fact>
              <Fact term="NPWP">
                {chosen.v.npwp ?? <span className="text-bad-fg">missing</span>}
              </Fact>
              <Fact term="Owed">{rp(chosen.owed)}</Fact>
            </Facts>

            <div>
              <SubHead>Bills</SubHead>
              <Table
                head={[
                  "Number",
                  "Issued",
                  "Due",
                  ">Amount",
                  ">Paid",
                  ">Outstanding",
                  "Status",
                ]}
              >
                {chosen.bills.map((x) => (
                  <Row
                    key={x.bill_id}
                    tone={
                      x.status !== "PAID" && age(x.due_on) > 0
                        ? "warn"
                        : undefined
                    }
                  >
                    <Cell mono>{x.number}</Cell>
                    <Cell className="whitespace-nowrap">{x.issued_on}</Cell>
                    <Cell className="whitespace-nowrap">{x.due_on}</Cell>
                    <Cell right>
                      <Amount minor={x.total} />
                    </Cell>
                    <Cell right className="text-body">
                      <Amount minor={x.paid} muted />
                    </Cell>
                    <Cell right className="font-semibold text-ink">
                      <Amount minor={x.total - x.paid} muted />
                    </Cell>
                    <Cell>
                      <Pill
                        tone={
                          x.status === "PAID"
                            ? "ok"
                            : x.status === "PART_PAID"
                              ? "info"
                              : age(x.due_on) > 0
                                ? "bad"
                                : "neutral"
                        }
                      >
                        {x.status === "PAID"
                          ? "paid"
                          : x.status === "PART_PAID"
                            ? "partial"
                            : age(x.due_on) > 0
                              ? "overdue"
                              : "open"}
                      </Pill>
                    </Cell>
                  </Row>
                ))}
                <Row tone="total">
                  <Cell colSpan={3}>{count(chosen.bills.length, "bill")}</Cell>
                  <Cell right>
                    <Amount
                      minor={chosen.bills.reduce((n, x) => n + x.total, 0)}
                    />
                  </Cell>
                  <Cell right>
                    <Amount
                      minor={chosen.bills.reduce((n, x) => n + x.paid, 0)}
                    />
                  </Cell>
                  <Cell right>
                    <Amount minor={chosen.owed} />
                  </Cell>
                  <Cell />
                </Row>
              </Table>
            </div>
          </div>
        )}
      </Sheet>

      <NewRecord
        open={creating}
        onOpenChange={setCreating}
        title={spec.newLabel}
        submitLabel="Submit"
        fields={[
          {
            name: "name",
            label: "Name",
            required: true,
          },
          {
            name: "kind",
            label: "Kind",
            kind: "select",
            required: true,
            options: spec.kinds.map((k) => ({
              value: k.value,
              label: k.label,
            })),
          },
          { name: "terms_days", label: "Terms in days" },
          {
            name: "bank",
            label: "Pay to",
            hint: "Without this a payment run stops here.",
          },
        ]}
        onSubmit={(v) =>
          b.createVendor({
            name: v.name,
            kind: v.kind as "MERCHANDISE" | "SERVICE" | "UTILITY",
            terms_days: v.terms_days ? Number(v.terms_days) : undefined,
            bank: v.bank || undefined,
          })
        }
      />

      <PrintSheet open={printing} onOpenChange={setPrinting} title={spec.title}>
        <ReportPrint
          title={`Daftar ${spec.title}`}
          period="Per 2026-08-01"
          scope={`Terutang pada ${spec.account}`}
          columns={[
            { label: "Nama", cell: (r) => r.v.name },
            { label: "Jenis", cell: (r) => r.v.kind.toLowerCase() },
            {
              label: "Termin",
              cell: (r) => (r.v.terms_days ? `${r.v.terms_days} hari` : "—"),
            },
            { label: "Jatuh tempo terdekat", cell: (r) => r.nextDue ?? "—" },
            { label: "Bayar ke", cell: (r) => r.v.bank ?? "belum ada" },
            {
              label: "Tagihan terbuka",
              align: "right",
              cell: (r) => String(r.openBills.length),
            },
            { label: "Terutang", align: "right", cell: (r) => rp(r.owed) },
          ]}
          rows={rows}
          total={[
            `${rows.length} pihak`,
            "",
            "",
            "",
            "",
            String(openCount),
            rp(owed),
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}
