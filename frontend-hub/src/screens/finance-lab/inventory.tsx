import { useState } from "react"

import { Printer } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { STOCK } from "@/screens/finance-lab/engine/data"
import { BAGS } from "@/screens/finance-lab/engine/subledgers"
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
import { Flow, Posting } from "@/screens/finance-lab/signature"
import { PrintSheet, ReportPrint } from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"

const TODAY = "2026-08-01"
const age = (d: string) =>
  Math.round((Date.parse(TODAY) - Date.parse(d)) / 86_400_000)

const countedTotal = STOCK.reduce((n, s) => n + s.counted_value, 0)
const bagTotal = BAGS.reduce((n, s) => n + s.value, 0)

/// Inventory, opened at the top.
///
/// # Why bags are here at all
///
/// Because the client keeps them as stock, not as a supply cost:
/// `1011202 Persediaan Kantong Belanja` holds ten classes across fourteen
/// units, and `1011204 BDP Kantong Belanja` moves them between units the same
/// way merchandise moves. 336 accounts that an inventory screen counting only
/// merchandise would never show. They are a second class, not a second menu.
///
/// # What used to be here and is not
///
/// `COGS` was a screen of one profit-and-loss line, which Reports already
/// draws. `Reconcile` was a variance report with a verb for a name — nothing
/// external is being matched, only the count against the books — so the gap it
/// existed to show moved onto Valuation, where the count is.
export function InventoryOverview() {
  const b = useBook()
  const ledger = -b.ledger.balance("101120100106", { unit_id: "C006" })
  const openShipments = b.shipments.filter((s) => !s.received_on)
  const pendingAdj = b.stockAdjustments.filter((a) => a.status !== "POSTED")

  const items = [
    ...openShipments.map((s) => ({
      id: s.shipment_id,
      what: `${s.reference} — ${s.from_unit} → ${s.to_unit}`,
      why:
        age(s.expected_on) > 0
          ? `${days(age(s.expected_on))} past the expected arrival`
          : `In transit, due ${s.expected_on}`,
      amount: s.value,
      tone: age(s.expected_on) > 0 ? ("bad" as const) : ("warn" as const),
      to: "/finance-lab/inventory/in-transit",
      cta: "Receive",
    })),
    ...pendingAdj.map((a) => ({
      id: a.adj_id,
      what: `${a.reference} — ${a.kind.toLowerCase()}`,
      why: a.note ?? `${a.status.toLowerCase()}, ${count(a.units, "unit")}`,
      amount: a.cost,
      tone: "warn" as const,
      to: "/finance-lab/inventory/adjustments",
      cta: "Decide",
    })),
  ].sort((a, c) => c.amount - a.amount)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Inventory"
        sub="Merchandise and bags — on the shelf, on a lorry, and in the books."
      />

      <ChartBand title="How stock moves, and what it is worth on the way">
        <Flow
          steps={[
            {
              label: "Dispatched",
              value: rp(openShipments.reduce((n, s) => n + s.value, 0)),
              posts: "Dr BDP / Cr Persediaan",
              to: "/finance-lab/inventory/in-transit",
              tone: openShipments.length ? "warn" : "ok",
            },
            {
              label: "On the shelf",
              value: rp(countedTotal + bagTotal),
              posts: "1011201 merchandise · 1011202 kantong",
              to: "/finance-lab/inventory/valuation",
            },
            {
              label: "Sold",
              value: rp(
                -b.ledger.balance("501011000106", { unit_id: "C006" }) * -1
              ),
              posts: "Dr HPP / Cr Persediaan",
              to: "/finance-lab/reports/profit-loss",
            },
            {
              label: "Lost or written down",
              value: rp(pendingAdj.reduce((n, a) => n + a.cost, 0)),
              posts: "Dr Kerugian + Disposed / Cr Persediaan",
              to: "/finance-lab/inventory/adjustments",
              tone: pendingAdj.length ? "warn" : "ok",
            },
            {
              // Negative, and that is the finding rather than a display bug:
              // every sale credits inventory and nothing debits it, because
              // the goods-received journal was never supplied.
              label: "Per the books",
              value: rp(b.ledger.balance("101120100106", { unit_id: "C006" })),
              posts:
                ledger > 0
                  ? "1011201001 — C006"
                  : "credit balance — no receipt journal",
              to: "/finance-lab/inventory/valuation",
              tone: ledger > 0 ? undefined : "bad",
            },
          ]}
        />
      </ChartBand>

      <Section
        title={`Unfinished — ${items.length}`}
        sub="Stock that has moved but not landed, and write-offs nobody has agreed."
      >
        {items.length === 0 ? (
          <EmptyState>Nothing in transit and nothing waiting.</EmptyState>
        ) : (
          <Table head={["Item", "Why it is here", ">Value", ""]}>
            {items.map((i) => (
              <Row key={i.id} tone={i.tone}>
                <Cell>
                  <span className="text-ink">{i.what}</span>
                </Cell>
                <Cell className="text-body">{i.why}</Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={i.amount} />
                </Cell>
                <Cell>
                  <AppLink
                    to={i.to}
                    className="font-medium text-accent hover:underline"
                  >
                    {i.cta}
                  </AppLink>
                </Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={2}>{count(items.length, "item")}</Cell>
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

/// Valuation — what the shelf holds, class by class.
export function InventoryValuation() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [stream, setStream] = useState("MERCHANDISE")
  const [open, setOpen] = useState<string | null>(null)

  const merch = STOCK.map((s) => ({
    key: s.klass,
    name: s.klass,
    code: "1011201",
    units: s.units,
    value: s.counted_value,
  }))
  const bags = BAGS.map((s) => ({
    key: s.code,
    name: s.name,
    code: s.code,
    units: s.units,
    value: s.value,
  }))
  const rows =
    stream === "MERCHANDISE"
      ? merch
      : stream === "BAGS"
        ? bags
        : [...merch, ...bags]

  const value = rows.reduce((n, r) => n + r.value, 0)
  const units = rows.reduce((n, r) => n + r.units, 0)
  const ledger = -b.ledger.balance("101120100106", { unit_id: "C006" })
  const inTransit = b.ledger.balance("101120300706", { unit_id: "C006" })
  const pendingAdjustments = b.stockAdjustments
    .filter((a) => a.status !== "POSTED")
    .reduce((n, a) => n + a.cost - a.residual, 0)
  const gap = countedTotal + bagTotal + inTransit - pendingAdjustments - ledger
  const chosen = rows.find((r) => r.key === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Valuation"
        sub="Counted value by class, against what the books say it is."
        actions={
          <div className="flex items-center gap-2">
            <Select value={stream} onChange={setStream} className={FILTER_W}>
              <option value="MERCHANDISE">Merchandise</option>
              <option value="BAGS">Kantong belanja</option>
              <option value="">Both</option>
            </Select>
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
            label: "Counted value",
            value: rp(value),
            sub: `${count(rows.length, "class")}`,
          },
          {
            label: "In transit (BDP)",
            value: rp(inTransit),
            sub: `${count(b.shipments.filter((s) => !s.received_on).length, "dispatch")}`,
          },
          {
            label: "Per the books",
            value: rp(ledger),
            sub: "1011201001 — C006",
          },
          {
            label: "Unexplained",
            value: rp(gap),
            sub: gap ? "a missing posting rule, not a miscount" : "agreed",
            tone: gap ? "down" : "flat",
          },
        ]}
      />

      {gap !== 0 && (
        <Banner tone="warn" className="mb-4">
          <div className="min-w-0">
            The count and the ledger are {rp(Math.abs(gap))} apart, and it is
            not a counting error. At C006 the inventory account only ever moves
            one way — every sale credits it, nothing debits it — because the
            journal that records goods received from head office was never
            supplied. July shows 147 dispatches raising BDP by Rp470.488.453 and
            not one credit against it. Netting the difference off here would
            hide the one thing this page can find.
          </div>
        </Banner>
      )}

      <Section title={`Classes — ${rows.length}`}>
        <Table
          head={["Class", "Account", ">Units", ">Value", ">Average", ">Share"]}
        >
          {rows.map((r) => (
            <Row key={r.key} className="hover:bg-soft-1 cursor-pointer">
              <Cell onClick={() => setOpen(r.key)}>
                <span className="text-ink">{r.name}</span>
              </Cell>
              <Cell mono className="text-mute">
                {r.code}
              </Cell>
              <Cell right>{r.units.toLocaleString("id-ID")}</Cell>
              <Cell right className="font-semibold text-ink">
                <Amount minor={r.value} />
              </Cell>
              <Cell right className="text-body">
                <Amount minor={Math.round(r.value / r.units)} />
              </Cell>
              <Cell right className="text-body">
                {((r.value / value) * 100).toFixed(1)}%
              </Cell>
            </Row>
          ))}
          <Row tone="total">
            <Cell colSpan={2}>{count(rows.length, "class")}</Cell>
            <Cell right>{units.toLocaleString("id-ID")}</Cell>
            <Cell right>
              <Amount minor={value} />
            </Cell>
            <Cell right>
              <Amount minor={units ? Math.round(value / units) : 0} />
            </Cell>
            <Cell right>100%</Cell>
          </Row>
        </Table>
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.name ?? ""}
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Account">{chosen.code}</Fact>
              <Fact term="Units">{chosen.units.toLocaleString("id-ID")}</Fact>
              <Fact term="Counted value">{rp(chosen.value)}</Fact>
              <Fact term="Average per unit">
                {rp(Math.round(chosen.value / chosen.units))}
              </Fact>
              <Fact term="Share of stock">
                {((chosen.value / value) * 100).toFixed(1)}%
              </Fact>
            </Facts>
            <div>
              <SubHead>Movements this month</SubHead>
              <Table head={["Reference", "Kind", "Date", ">Units", ">Value"]}>
                {b.shipments
                  .filter(
                    (s) =>
                      s.klass ===
                      (chosen.code.startsWith("10112020")
                        ? "Kantong Belanja"
                        : "Barang Dagangan")
                  )
                  .map((s) => (
                    <Row key={s.shipment_id}>
                      <Cell mono>{s.reference}</Cell>
                      <Cell className="text-body">
                        {s.from_unit} → {s.to_unit}
                      </Cell>
                      <Cell className="whitespace-nowrap">{s.sent_on}</Cell>
                      <Cell right>{s.units.toLocaleString("id-ID")}</Cell>
                      <Cell right>
                        <Amount minor={s.value} />
                      </Cell>
                    </Row>
                  ))}
              </Table>
            </div>
          </div>
        )}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Nilai Persediaan"
      >
        <ReportPrint
          title="Nilai Persediaan"
          period={"Per 2026-08-01"}
          scope={`${stream || "Seluruh aliran"}`}
          columns={[
            { label: "Kelas", cell: (r) => r.name },
            { label: "Perkiraan", cell: (r) => r.code },
            {
              label: "Unit barang",
              align: "right",
              cell: (r) => r.units.toLocaleString("id-ID"),
            },
            { label: "Nilai", align: "right", cell: (r) => rp(r.value) },
            {
              label: "Rata-rata",
              align: "right",
              cell: (r) => rp(Math.round(r.value / r.units)),
            },
          ]}
          rows={rows}
          total={[
            `${rows.length} kelas`,
            "",
            units.toLocaleString("id-ID"),
            rp(value),
            rp(units ? Math.round(value / units) : 0),
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}

/// BDP / in transit — stock that has left one unit and not arrived at the other.
///
/// # Why this is Inventory's screen and not Interunit's
///
/// One dispatch causes two things. Value moves out of one shop's stock and into
/// a transit account — that is inventory, and it is what this screen follows.
/// It also raises an affiliate balance between the two units — that is
/// Interunit, and it is followed there. Same event, two consequences, and
/// mixing them would produce a screen where the reader cannot tell whether a
/// row is about goods or about money.
export function InTransit() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [klass, setKlass] = useState("")
  const [open, setOpen] = useState<string | null>(null)

  const rows = b.shipments.filter((s) => !klass || s.klass === klass)
  const outstanding = rows.filter((s) => !s.received_on)
  const late = outstanding.filter((s) => age(s.expected_on) > 0)
  const chosen = rows.find((s) => s.shipment_id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="BDP / in transit"
        sub="Dispatched and not yet received. Valued at cost, owned by nobody's shop floor."
        actions={
          <div className="flex items-center gap-2">
            <Select value={klass} onChange={setKlass} className={FILTER_W}>
              <option value="">All classes</option>
              <option value="Barang Dagangan">Barang dagangan</option>
              <option value="Kantong Belanja">Kantong belanja</option>
            </Select>
            <Button
              variant="primary"
              onClick={() =>
                outstanding[0] && b.receiveShipment(outstanding[0].shipment_id)
              }
            >
              Receive delivery
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
            label: "In transit",
            value: rp(outstanding.reduce((n, s) => n + s.value, 0)),
            sub: `${count(outstanding.length, "dispatch")}`,
          },
          {
            label: "Overdue arrival",
            value: rp(late.reduce((n, s) => n + s.value, 0)),
            sub: `${count(late.length, "dispatch")}`,
            tone: late.length ? "down" : "flat",
          },
          {
            label: "Received this month",
            value: rp(
              rows.filter((s) => s.received_on).reduce((n, s) => n + s.value, 0)
            ),
          },
          {
            label: "Short on arrival",
            value: rp(rows.reduce((n, s) => n + (s.variance ?? 0), 0)),
            sub: `${rows.filter((s) => s.variance).length} with a shortfall`,
            tone: rows.some((s) => s.variance) ? "down" : "flat",
          },
        ]}
      />

      <Section title={`Dispatches — ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState>Nothing on the road.</EmptyState>
        ) : (
          <Table
            head={[
              "Reference",
              "From",
              "To",
              "Class",
              "Sent",
              "Expected",
              ">Units",
              ">Value",
              "Status",
            ]}
          >
            {rows.map((s) => {
              const overdue = !s.received_on && age(s.expected_on) > 0
              return (
                <Row
                  key={s.shipment_id}
                  className="hover:bg-soft-1 cursor-pointer"
                  tone={overdue ? "bad" : s.variance ? "warn" : undefined}
                >
                  <Cell mono onClick={() => setOpen(s.shipment_id)}>
                    {s.reference}
                  </Cell>
                  <Cell>{s.from_unit}</Cell>
                  <Cell>{s.to_unit}</Cell>
                  <Cell className="text-body">{s.klass}</Cell>
                  <Cell className="whitespace-nowrap">{s.sent_on}</Cell>
                  <Cell className="whitespace-nowrap">
                    {s.expected_on}
                    {overdue && (
                      <div className="text-eyebrow text-bad-fg">
                        {days(age(s.expected_on))} late
                      </div>
                    )}
                  </Cell>
                  <Cell right>{s.units.toLocaleString("id-ID")}</Cell>
                  <Cell right className="font-semibold text-ink">
                    <Amount minor={s.value} />
                  </Cell>
                  <Cell>
                    {s.received_on ? (
                      s.variance ? (
                        <Pill tone="warn">short {rp(s.variance)}</Pill>
                      ) : (
                        <Pill tone="ok">received</Pill>
                      )
                    ) : overdue ? (
                      <Pill tone="bad">overdue</Pill>
                    ) : (
                      <Pill tone="neutral">in transit</Pill>
                    )}
                  </Cell>
                </Row>
              )
            })}
            <Row tone="total">
              <Cell colSpan={6}>{count(rows.length, "dispatch")}</Cell>
              <Cell right>
                {rows.reduce((n, s) => n + s.units, 0).toLocaleString("id-ID")}
              </Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, s) => n + s.value, 0)} />
              </Cell>
              <Cell />
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.reference ?? ""}
        id={chosen?.shipment_id}
        actions={
          chosen && !chosen.received_on ? (
            <Button
              variant="primary"
              onClick={() => b.receiveShipment(chosen.shipment_id)}
            >
              Receive
            </Button>
          ) : undefined
        }
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="From">{chosen.from_unit}</Fact>
              <Fact term="To">{chosen.to_unit}</Fact>
              <Fact term="Class">{chosen.klass}</Fact>
              <Fact term="Sent">{chosen.sent_on}</Fact>
              <Fact term="Expected">{chosen.expected_on}</Fact>
              <Fact term="Received">{chosen.received_on ?? "—"}</Fact>
              <Fact term="Units">{chosen.units.toLocaleString("id-ID")}</Fact>
              <Fact term="Value">{rp(chosen.value)}</Fact>
            </Facts>
            <div>
              <SubHead>What the dispatch posted</SubHead>
              <Table head={["Where it shows", "Account", ">Debit", ">Credit"]}>
                <Row>
                  <Cell>Inventory — this screen</Cell>
                  <Cell mono className="text-mute">
                    {chosen.klass === "Kantong Belanja" ? "1011204" : "1011203"}{" "}
                    BDP
                  </Cell>
                  <Cell right>
                    <Amount minor={chosen.value} />
                  </Cell>
                  <Cell right>
                    <Amount minor={0} muted />
                  </Cell>
                </Row>
                <Row>
                  <Cell>Inventory — sending unit</Cell>
                  <Cell mono className="text-mute">
                    1011201 Persediaan {chosen.from_unit}
                  </Cell>
                  <Cell right>
                    <Amount minor={0} muted />
                  </Cell>
                  <Cell right>
                    <Amount minor={chosen.value} />
                  </Cell>
                </Row>
                <Row tone="muted">
                  <Cell>Affiliation — the other consequence</Cell>
                  <Cell mono className="text-mute">
                    1021402 Piutang afiliasi barang
                  </Cell>
                  <Cell right className="text-faint">
                    followed on Interunit
                  </Cell>
                  <Cell right />
                </Row>
              </Table>
              {chosen.variance ? (
                <p className="mt-2 text-meta text-warn-fg">
                  {rp(chosen.variance)} short on arrival. Until it is explained
                  it stays in BDP — clearing it is an adjustment, not a receipt.
                </p>
              ) : null}
            </div>
          </div>
        )}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Barang Dalam Perjalanan"
      >
        <ReportPrint
          title="Barang Dalam Perjalanan"
          period={"Per 2026-08-01"}
          scope={`${klass || "Seluruh kelas"}`}
          columns={[
            { label: "Referensi", cell: (x) => x.reference },
            { label: "Dari", cell: (x) => x.from_unit },
            { label: "Ke", cell: (x) => x.to_unit },
            { label: "Kelas", cell: (x) => x.klass },
            { label: "Dikirim", cell: (x) => x.sent_on },
            { label: "Diharapkan", cell: (x) => x.expected_on },
            {
              label: "Unit",
              align: "right",
              cell: (x) => x.units.toLocaleString("id-ID"),
            },
            { label: "Nilai", align: "right", cell: (x) => rp(x.value) },
          ]}
          rows={rows}
          total={[
            `${rows.length} kiriman`,
            "",
            "",
            "",
            "",
            "",
            rows.reduce((n, x) => n + x.units, 0).toLocaleString("id-ID"),
            rp(rows.reduce((n, x) => n + x.value, 0)),
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}

/// Adjustments & loss — stock leaving without a sale.
export function InventoryAdjustments() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [status, setStatus] = useState("")
  const [open, setOpen] = useState<string | null>(null)

  const rows = b.stockAdjustments.filter((a) => !status || a.status === status)
  const written = rows.reduce((n, a) => n + a.cost - a.residual, 0)
  const pending = b.stockAdjustments.filter((a) => a.status !== "POSTED")
  const chosen = rows.find((a) => a.adj_id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Adjustments"
        sub="Shrinkage, damage and disposal. What survives goes to 1031801 Disposed Inventory."
        actions={
          <div className="flex items-center gap-2">
            <Select value={status} onChange={setStatus} className={FILTER_W}>
              <option value="">All</option>
              <option value="SUBMITTED">Awaiting approval</option>
              <option value="APPROVED">Approved</option>
              <option value="POSTED">Posted</option>
            </Select>
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
            label: "Written off",
            value: rp(written),
            sub: `${count(rows.length, "adjustment")}`,
          },
          {
            label: "Awaiting approval",
            value: rp(pending.reduce((n, a) => n + a.cost, 0)),
            sub: `${count(pending.length, "adjustment")}`,
            tone: pending.length ? "down" : "flat",
          },
          {
            label: "Carried as disposed",
            value: rp(rows.reduce((n, a) => n + a.residual, 0)),
            sub: "1031801",
          },
          {
            label: "Units lost",
            value: Math.abs(
              rows.reduce((n, a) => n + a.units, 0)
            ).toLocaleString("id-ID"),
          },
        ]}
      />

      <Section title={`Adjustments — ${rows.length}`}>
        {rows.length === 0 ? (
          <EmptyState>No adjustment in this tab.</EmptyState>
        ) : (
          <Table
            head={[
              "Reference",
              "Unit",
              "Kind",
              "Date",
              ">Units",
              ">Cost",
              ">Residual",
              ">Written off",
              "Status",
            ]}
          >
            {rows.map((a) => (
              <Row
                key={a.adj_id}
                className="hover:bg-soft-1 cursor-pointer"
                tone={a.status === "SUBMITTED" ? "warn" : undefined}
              >
                <Cell mono onClick={() => setOpen(a.adj_id)}>
                  {a.reference}
                </Cell>
                <Cell>{a.unit_id}</Cell>
                <Cell>
                  <Pill
                    tone={
                      a.kind === "DISPOSAL"
                        ? "info"
                        : a.kind === "COUNT"
                          ? "neutral"
                          : "warn"
                    }
                  >
                    {a.kind.toLowerCase()}
                  </Pill>
                </Cell>
                <Cell className="whitespace-nowrap">{a.on}</Cell>
                <Cell right className="text-bad-fg">
                  {a.units.toLocaleString("id-ID")}
                </Cell>
                <Cell right>
                  <Amount minor={a.cost} />
                </Cell>
                <Cell right className="text-body">
                  <Amount minor={a.residual} muted />
                </Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={a.cost - a.residual} />
                </Cell>
                <Cell>
                  <Pill
                    tone={
                      a.status === "POSTED"
                        ? "ok"
                        : a.status === "APPROVED"
                          ? "info"
                          : "warn"
                    }
                  >
                    {a.status.toLowerCase()}
                  </Pill>
                </Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell colSpan={4}>{count(rows.length, "adjustment")}</Cell>
              <Cell right>
                {rows.reduce((n, a) => n + a.units, 0).toLocaleString("id-ID")}
              </Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, a) => n + a.cost, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, a) => n + a.residual, 0)} />
              </Cell>
              <Cell right>
                <Amount minor={written} />
              </Cell>
              <Cell />
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.reference ?? ""}
        id={chosen?.adj_id}
        actions={
          chosen?.status === "SUBMITTED" ? (
            <Button
              variant="primary"
              onClick={() => b.reviewAdjustment(chosen.adj_id, "APPROVED")}
            >
              Approve
            </Button>
          ) : undefined
        }
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Unit">{chosen.unit_id}</Fact>
              <Fact term="Kind">{chosen.kind.toLowerCase()}</Fact>
              <Fact term="Date">{chosen.on}</Fact>
              <Fact term="Units">{chosen.units.toLocaleString("id-ID")}</Fact>
              <Fact term="Cost">{rp(chosen.cost)}</Fact>
              <Fact term="Residual">{rp(chosen.residual)}</Fact>
              <Fact term="Written off">
                {rp(chosen.cost - chosen.residual)}
              </Fact>
              <Fact term="Status">{chosen.status.toLowerCase()}</Fact>
            </Facts>
            <div>
              <SubHead>What it posts</SubHead>
              <Posting
                debits={[
                  ...(chosen.residual > 0
                    ? [
                        {
                          account: "Disposed Inventory",
                          code: "1031801001",
                          amount: chosen.residual,
                        },
                      ]
                    : []),
                  {
                    account: "Kerugian persediaan",
                    code: "6010310014 Biaya Stock Opname",
                    amount: chosen.cost - chosen.residual,
                  },
                ]}
                credits={[
                  {
                    account: "Persediaan Barang Dagangan",
                    code: `1011201001 — ${chosen.unit_id}`,
                    amount: chosen.cost,
                  },
                ]}
              />
              {chosen.note && (
                <p className="mt-2 text-meta text-body">{chosen.note}</p>
              )}
            </div>
          </div>
        )}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Penyesuaian Persediaan"
      >
        <ReportPrint
          title="Penyesuaian Persediaan"
          period={"Per 2026-08-01"}
          scope={`${status || "Seluruh status"}`}
          columns={[
            { label: "Referensi", cell: (a) => a.reference },
            { label: "Unit", cell: (a) => a.unit_id },
            { label: "Jenis", cell: (a) => a.kind.toLowerCase() },
            { label: "Tanggal", cell: (a) => a.on },
            {
              label: "Unit barang",
              align: "right",
              cell: (a) => a.units.toLocaleString("id-ID"),
            },
            { label: "Harga pokok", align: "right", cell: (a) => rp(a.cost) },
            {
              label: "Nilai sisa",
              align: "right",
              cell: (a) => rp(a.residual),
            },
            {
              label: "Dihapuskan",
              align: "right",
              cell: (a) => rp(a.cost - a.residual),
            },
          ]}
          rows={rows}
          total={[
            `${rows.length} penyesuaian`,
            "",
            "",
            "",
            rows.reduce((n, a) => n + a.units, 0).toLocaleString("id-ID"),
            rp(rows.reduce((n, a) => n + a.cost, 0)),
            rp(rows.reduce((n, a) => n + a.residual, 0)),
            rp(written),
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}
