import { useMemo, useState } from "react"

import { Printer } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import * as dep from "@/screens/finance-lab/engine/depreciation"
import { JULY_DEPRECIATION_ACTUAL } from "@/screens/finance-lab/engine/fixtures"
import {
  type PreOpening as PreOpeningRow,
  type Project,
} from "@/screens/finance-lab/engine/subledgers"
import {
  Amount,
  CheckMark,
  Cell,
  ChartBand,
  Kpis,
  Row,
  Section,
  SubHead,
  Table,
  count,
  rp,
  FILTER_W,
  NewRecord,
} from "@/screens/finance-lab/parts"
import { Flow, Posting } from "@/screens/finance-lab/signature"
import { PrintSheet, ReportPrint } from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"

/// Assets & projects — the group's four other screens, beside the register.
///
/// # Why pre-opening is here and not in Accounting
///
/// `1031802 Pre Opening` carries both the cost and its accumulated
/// amortisation. That pairing is what makes it a long-lived asset rather than a
/// cost somebody deferred: it was spent to open a shop, it is written off over
/// the years that shop trades, and it belongs beside the fit-out it paid for.
/// Filing it under Accounting's deferrals would have separated a store's
/// opening cost from the store's assets, which is the one comparison anybody
/// opening either screen wants.
const MONTH = "2026-07"
const TODAY = "2026-08-01"

export function AssetsOverview() {
  const b = useBook()

  const byClass = useMemo(() => {
    const m = new Map<string, { cost: number; nbv: number }>()
    for (const a of b.assets) {
      const t = b.treatments.find((x) => x.asset_id === a.asset_id)
      if (!t) continue
      const acc = m.get(a.asset_class) ?? { cost: 0, nbv: 0 }
      acc.cost += t.cost
      acc.nbv += t.cost - dep.accumulated(a, t, MONTH)
      m.set(a.asset_class, acc)
    }
    return [...m.entries()].sort((x, y) => y[1].nbv - x[1].nbv)
  }, [b.assets, b.treatments])

  const openProjects = b.projects.filter((p) => p.status !== "CAPITALISED")
  const unassessed = b.assets.filter(
    (a) =>
      !b.treatments.find((t) => t.asset_id === a.asset_id) ||
      b.treatments.find((t) => t.asset_id === a.asset_id)?.charge === "NONE"
  )

  const items = [
    ...openProjects.map((p) => ({
      id: p.project_id,
      what: p.name,
      why:
        p.status === "READY"
          ? "Finished and not capitalised — nothing is depreciating yet"
          : `${Math.round((p.spent / p.budget) * 100)}% of budget spent`,
      amount: p.spent,
      tone: p.status === "READY" ? ("bad" as const) : ("warn" as const),
      to: "/finance-lab/assets/projects",
      cta: p.status === "READY" ? "Capitalise" : "Open",
    })),
    ...unassessed.slice(0, 5).map((a) => ({
      id: a.asset_id,
      what: a.name,
      why: "Registered with no treatment, so it charges nothing",
      amount: 0,
      tone: "warn" as const,
      to: "/finance-lab/assets/register",
      cta: "Assess",
    })),
  ]

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Assets"
        sub="What we own, what we are building, and what it is worth now."
      />

      <ChartBand title="How money spent becomes an asset, and then a cost">
        <Flow
          steps={[
            {
              label: "Being built",
              value: rp(openProjects.reduce((n, p) => n + p.spent, 0)),
              posts: "Dr 1031803 CIP / Cr Bank",
              to: "/finance-lab/assets/projects",
              tone: openProjects.some((p) => p.status === "READY")
                ? "bad"
                : "warn",
            },
            {
              label: "Capitalised",
              value: rp(byClass.reduce((n, [, v]) => n + v.cost, 0)),
              posts: "Dr 10215xx / Cr 1031803",
              to: "/finance-lab/assets/register",
            },
            {
              label: "Depreciating",
              value: rp(byClass.reduce((n, [, v]) => n + v.cost - v.nbv, 0)),
              posts: "Dr 7010214 / Cr 1021606",
              to: "/finance-lab/assets/depreciation",
            },
            {
              label: "Still worth",
              value: rp(byClass.reduce((n, [, v]) => n + v.nbv, 0)),
              posts: "cost less accumulated",
              to: "/finance-lab/reports/balance-sheet",
              tone: "ok",
            },
          ]}
        />
      </ChartBand>

      <Section title={`Needs attention — ${items.length}`}>
        {items.length === 0 ? (
          <EmptyState>
            Every asset is assessed and every project is closed.
          </EmptyState>
        ) : (
          <Table head={["Item", "Why It Is Here", ">Amount", ""]}>
            {items.map((i) => (
              <Row key={i.id} tone={i.tone}>
                <Cell>
                  <span className="text-ink">{i.what}</span>
                </Cell>
                <Cell className="text-body">{i.why}</Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={i.amount} muted />
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

/// Projects / CIP — money spent on something that is not an asset yet.
///
/// `1031803 Contract In Progress (CIP)` is the client's own account for it, and
/// it is a single account rather than one per class: what is being built is not
/// yet a machine or a fitting, so there is nothing to classify it as until it
/// opens.
export function Projects() {
  const [printing, setPrinting] = useState(false)
  const [creating, setCreating] = useState(false)
  const b = useBook()
  const [open, setOpen] = useState<string | null>(null)
  const rows = b.projects
  const inFlight = rows.filter((p) => p.status !== "CAPITALISED")
  const ready = rows.filter((p) => p.status === "READY")
  const chosen = rows.find((p) => p.project_id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Assets"
        title="Projects / CIP"
        sub="Construction in progress. Nothing here depreciates until it is capitalised."
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={() => setPrinting(true)}>
              <Printer className="size-3.5" />
              Print
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              New project
            </Button>
          </div>
        }
      />

      <Kpis
        items={[
          {
            label: "In progress",
            value: rp(inFlight.reduce((n, p) => n + p.spent, 0)),
            sub: `${count(inFlight.length, "project")}`,
          },
          {
            label: "Budget committed",
            value: rp(inFlight.reduce((n, p) => n + p.budget, 0)),
          },
          {
            label: "Finished, not capitalised",
            value: rp(ready.reduce((n, p) => n + p.spent, 0)),
            sub: ready.length ? "depreciating nothing" : "none",
            tone: ready.length ? "down" : "flat",
          },
          {
            label: "Capitalised this month",
            value: rp(
              rows
                .filter((p) => p.status === "CAPITALISED")
                .reduce((n, p) => n + p.spent, 0)
            ),
          },
        ]}
      />

      <Section title={`Projects — ${rows.length}`}>
        <Table
          head={[
            "Project",
            "Unit",
            "Started",
            ">Budget",
            ">Spent",
            ">Left",
            ">Used",
            "Status",
          ]}
        >
          {rows.map((p) => (
            <Row
              key={p.project_id}
              className="hover:bg-soft-1 cursor-pointer"
              tone={
                p.status === "READY"
                  ? "warn"
                  : p.spent > p.budget
                    ? "bad"
                    : undefined
              }
            >
              <Cell onClick={() => setOpen(p.project_id)}>
                <span className="text-ink">{p.name}</span>
                {p.note && (
                  <div className="text-eyebrow text-mute">{p.note}</div>
                )}
              </Cell>
              <Cell>{p.unit_id}</Cell>
              <Cell className="whitespace-nowrap">{p.started_on}</Cell>
              <Cell right>
                <Amount minor={p.budget} />
              </Cell>
              <Cell right className="font-semibold text-ink">
                <Amount minor={p.spent} />
              </Cell>
              <Cell
                right
                className={p.spent > p.budget ? "text-bad-fg" : "text-body"}
              >
                <Amount minor={p.budget - p.spent} />
              </Cell>
              <Cell right className="text-body">
                {Math.round((p.spent / p.budget) * 100)}%
              </Cell>
              <Cell>
                <Pill
                  tone={
                    p.status === "CAPITALISED"
                      ? "ok"
                      : p.status === "READY"
                        ? "warn"
                        : "neutral"
                  }
                >
                  {p.status.toLowerCase()}
                </Pill>
              </Cell>
            </Row>
          ))}
          <Row tone="total">
            <Cell colSpan={3}>{count(rows.length, "project")}</Cell>
            <Cell right>
              <Amount minor={rows.reduce((n, p) => n + p.budget, 0)} />
            </Cell>
            <Cell right>
              <Amount minor={rows.reduce((n, p) => n + p.spent, 0)} />
            </Cell>
            <Cell right>
              <Amount
                minor={rows.reduce((n, p) => n + p.budget - p.spent, 0)}
              />
            </Cell>
            <Cell colSpan={2} />
          </Row>
        </Table>
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.name ?? ""}
        id={chosen?.project_id}
        actions={
          chosen?.status === "READY" ? (
            <Button
              variant="primary"
              onClick={() => b.capitaliseProject(chosen.project_id)}
            >
              Capitalise
            </Button>
          ) : undefined
        }
      >
        {chosen && <ProjectDetail project={chosen} />}
      </Sheet>

      <NewRecord
        open={creating}
        onOpenChange={setCreating}
        title="New project"
        submitLabel="Open the project"
        fields={[
          {
            name: "name",
            label: "What is being built",
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
            name: "budget",
            label: "Budget",
            kind: "money",
            required: true,
          },
          { name: "started_on", label: "Started" },
        ]}
        onSubmit={(v, minor) =>
          b.createProject({
            name: v.name,
            unit_id: v.unit_id,
            budget: minor.budget,
            started_on: v.started_on || undefined,
          })
        }
      />

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Proyek Dalam Pelaksanaan"
      >
        <ReportPrint
          title="Proyek Dalam Pelaksanaan"
          period={"Per 2026-08-01"}
          columns={[
            { label: "Proyek", cell: (p) => p.name },
            { label: "Unit", cell: (p) => p.unit_id },
            { label: "Mulai", cell: (p) => p.started_on },
            { label: "Anggaran", align: "right", cell: (p) => rp(p.budget) },
            { label: "Terpakai", align: "right", cell: (p) => rp(p.spent) },
            {
              label: "Sisa",
              align: "right",
              cell: (p) => rp(p.budget - p.spent),
            },
            { label: "Status", cell: (p) => p.status.toLowerCase() },
          ]}
          rows={rows}
        />
      </PrintSheet>
    </PageContent>
  )
}

function ProjectDetail({ project }: { project: Project }) {
  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact term="Unit">{project.unit_id}</Fact>
        <Fact term="Started">{project.started_on}</Fact>
        <Fact term="Budget">{rp(project.budget)}</Fact>
        <Fact term="Spent">{rp(project.spent)}</Fact>
        <Fact term="Remaining">{rp(project.budget - project.spent)}</Fact>
        <Fact term="Status">{project.status.toLowerCase()}</Fact>
        <Fact term="Capitalised">{project.capitalised_on ?? "—"}</Fact>
      </Facts>
      <div>
        <SubHead>What capitalising does</SubHead>
        <Posting
          debits={[
            {
              account: "The asset class it becomes",
              code: "1021xxx — per class",
              amount: project.spent,
            },
          ]}
          credits={[
            {
              account: "Contract In Progress",
              code: `1031803001 — ${project.unit_id}`,
              amount: project.spent,
            },
          ]}
        />
        {project.status === "READY" && (
          <p className="mt-2 text-meta text-warn-fg">
            Finished and not capitalised. Every month it stays here is a month
            of depreciation nobody charged — and the shop is trading.
          </p>
        )}
      </div>
    </div>
  )
}

/// Pre-opening — what it cost to open a shop, written off over its trading life.
export function PreOpening() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [open, setOpen] = useState<string | null>(null)
  const rows = b.preOpening
  const gross = rows.reduce((n, p) => n + p.cost, 0)
  const amortised = rows.reduce(
    (n, p) => n + Math.round((p.cost * p.amortised_months) / p.months),
    0
  )
  const chosen = rows.find((p) => p.id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Assets"
        title="Pre-opening"
        sub="1031802 — the cost of opening a shop, and the accumulated amortisation against it."
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={() => setPrinting(true)}>
              <Printer className="size-3.5" />
              Print
            </Button>
            <Button
              variant="primary"
              onClick={() => rows.forEach((p) => b.amortisePreOpening(p.id))}
            >
              Run amortisation
            </Button>
          </div>
        }
      />

      <Kpis
        items={[
          {
            label: "Cost",
            value: rp(gross),
            sub: `${count(rows.length, "store")}`,
          },
          { label: "Amortised", value: rp(amortised) },
          { label: "Carrying value", value: rp(gross - amortised) },
          {
            label: "Monthly charge",
            value: rp(
              rows
                .filter((p) => p.amortised_months < p.months)
                .reduce((n, p) => n + Math.round(p.cost / p.months), 0)
            ),
            sub: `${rows.filter((p) => p.amortised_months < p.months).length} still charging`,
          },
        ]}
      />

      <Section title={`Stores — ${rows.length}`}>
        <Table
          head={[
            "Store",
            "Opened",
            "Account",
            ">Cost",
            ">Months",
            ">Done",
            ">Amortised",
            ">Carrying",
            "Status",
          ]}
        >
          {rows.map((p) => {
            const done = Math.round((p.cost * p.amortised_months) / p.months)
            const finished = p.amortised_months >= p.months
            return (
              <Row
                key={p.id}
                className="hover:bg-soft-1 cursor-pointer"
                tone={finished ? "muted" : undefined}
              >
                <Cell onClick={() => setOpen(p.id)}>
                  <span className="text-ink">{p.unit_id}</span>
                </Cell>
                <Cell className="whitespace-nowrap">{p.opened_on}</Cell>
                <Cell mono className="text-mute">
                  {p.account}
                </Cell>
                <Cell right>
                  <Amount minor={p.cost} />
                </Cell>
                <Cell right>{p.months}</Cell>
                <Cell right>{p.amortised_months}</Cell>
                <Cell right className="text-body">
                  <Amount minor={done} />
                </Cell>
                <Cell right className="font-semibold text-ink">
                  <Amount minor={p.cost - done} muted />
                </Cell>
                <Cell>
                  <Pill tone={finished ? "ok" : "neutral"}>
                    {finished ? "written off" : "charging"}
                  </Pill>
                </Cell>
              </Row>
            )
          })}
          <Row tone="total">
            <Cell colSpan={3}>{count(rows.length, "store")}</Cell>
            <Cell right>
              <Amount minor={gross} />
            </Cell>
            <Cell colSpan={2} />
            <Cell right>
              <Amount minor={amortised} />
            </Cell>
            <Cell right>
              <Amount minor={gross - amortised} />
            </Cell>
            <Cell />
          </Row>
        </Table>
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen ? `Pre-opening — ${chosen.unit_id}` : ""}
        id={chosen?.id}
      >
        {chosen && <PreOpeningDetail row={chosen} />}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Biaya Pra-Buka"
      >
        <ReportPrint
          title="Biaya Pra-Buka"
          period={"Per 2026-08-01"}
          columns={[
            { label: "Toko", cell: (p) => p.unit_id },
            { label: "Dibuka", cell: (p) => p.opened_on },
            { label: "Perkiraan", cell: (p) => p.account },
            { label: "Harga pokok", align: "right", cell: (p) => rp(p.cost) },
            {
              label: "Bulan",
              align: "right",
              cell: (p) => `${p.amortised_months}/${p.months}`,
            },
            {
              label: "Nilai tercatat",
              align: "right",
              cell: (p) =>
                rp(
                  p.cost - Math.round((p.cost * p.amortised_months) / p.months)
                ),
            },
          ]}
          rows={rows}
        />
      </PrintSheet>
    </PageContent>
  )
}

function PreOpeningDetail({ row }: { row: PreOpeningRow }) {
  const monthly = Math.round(row.cost / row.months)
  const left = row.months - row.amortised_months
  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact term="Store">{row.unit_id}</Fact>
        <Fact term="Opened">{row.opened_on}</Fact>
        <Fact term="Account">{row.account}</Fact>
        <Fact term="Cost">{rp(row.cost)}</Fact>
        <Fact term="Life">{row.months} months</Fact>
        <Fact term="Charged">{row.amortised_months} months</Fact>
        <Fact term="Monthly">{rp(monthly)}</Fact>
        <Fact term="Carrying value">
          {rp(
            row.cost -
              Math.round((row.cost * row.amortised_months) / row.months)
          )}
        </Fact>
      </Facts>
      <div>
        <SubHead>Remaining schedule</SubHead>
        {left <= 0 ? (
          <p className="mt-2 text-meta text-mute">
            Fully written off. The account holds cost and an equal accumulated
            amortisation.
          </p>
        ) : (
          <Table head={["Month", ">Charge", ">Carrying After"]}>
            {Array.from({ length: Math.min(left, 12) }, (_, i) => {
              const d = new Date(TODAY)
              const m = new Date(d.getFullYear(), d.getMonth() + i, 1)
              const carried =
                row.cost - monthly * (row.amortised_months + i + 1)
              return (
                <Row key={i}>
                  <Cell>{`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`}</Cell>
                  <Cell right>
                    <Amount minor={monthly} />
                  </Cell>
                  <Cell right className="text-body">
                    <Amount minor={Math.max(0, carried)} muted />
                  </Cell>
                </Row>
              )
            })}
            <Row tone="total">
              <Cell>{left} months left</Cell>
              <Cell right>
                <Amount minor={monthly * left} />
              </Cell>
              <Cell right>
                <Amount minor={0} muted />
              </Cell>
            </Row>
          </Table>
        )}
      </div>
    </div>
  )
}

/// Depreciation & amortisation — the month's charge, and the proof it is right.
///
/// # Why the replay is on the same screen as the run
///
/// Because the convention was in doubt and arithmetic settled it. Charging from
/// the purchase date gives nine assets and Rp4,683,970; charging from the
/// period gives thirteen and Rp15,748,763. The client's own `GL-26-07-00004` is
/// Rp4,683,970 to the rupiah. That is not a fact to keep in a document — it is
/// the reason this screen may post at all, so it is shown next to the button.
export function Depreciation() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [month, setMonth] = useState(MONTH)
  const [open, setOpen] = useState<string | null>(null)

  const charges = useMemo(
    () =>
      dep
        .run(b.assets, b.treatments, "C006", month)
        .filter((c) => c.amount > 0),
    [b.assets, b.treatments, month]
  )
  const posted = b.depreciationEntry("C006", month)
  const names = useMemo(
    () => new Map(b.assets.map((a) => [a.asset_id, a.name] as const)),
    [b.assets]
  )
  const recon = useMemo(
    () =>
      dep.reconcile(
        charges,
        month === MONTH ? JULY_DEPRECIATION_ACTUAL : [],
        names
      ),
    [charges, month, names]
  )

  const preOpeningCharge = b.preOpening
    .filter((p) => p.amortised_months < p.months)
    .reduce((n, p) => n + Math.round(p.cost / p.months), 0)
  const chosen = recon.rows.find((r) => r.label === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Assets"
        title="Depreciation & amortisation"
        sub="Charged from the purchase date, which is what the client's own July entry proves."
        actions={
          <div className="flex items-center gap-2">
            <Select value={month} onChange={setMonth} className={FILTER_W}>
              <option value="2026-06">June 2026</option>
              <option value="2026-07">July 2026</option>
              <option value="2026-08">August 2026</option>
            </Select>
            <Button
              variant="primary"
              onClick={() => b.runDepreciation("C006", month)}
            >
              {posted ? "Posted" : "Post the month"}
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
            label: "Depreciation",
            value: rp(recon.computedTotal),
            sub: `${charges.length} assets charging`,
          },
          {
            label: "Amortisation",
            value: rp(preOpeningCharge),
            sub: "pre-opening",
          },
          {
            label: "The client posted",
            value: month === MONTH ? rp(recon.actualTotal) : "—",
            sub: month === MONTH ? "GL-26-07-00004" : "no entry supplied",
          },
          {
            label: "Difference",
            value:
              month === MONTH
                ? rp(recon.computedTotal - recon.actualTotal)
                : "—",
            tone:
              month === MONTH && recon.computedTotal !== recon.actualTotal
                ? "down"
                : "flat",
            sub:
              month === MONTH && recon.computedTotal === recon.actualTotal
                ? "to the rupiah"
                : undefined,
          },
        ]}
      />

      {posted && (
        <Banner tone="ok" className="mb-4">
          <div className="min-w-0">
            {month} is posted as {posted.entry_number}. Pressing the button
            again returns the same entry rather than charging twice.
          </div>
        </Banner>
      )}

      <Section title={`Charges — ${recon.rows.length}`}>
        {recon.rows.length === 0 ? (
          <EmptyState>Nothing charges in {month}.</EmptyState>
        ) : (
          <Table
            head={["Asset", ">Replayed", ">Client Posted", "Agrees", "Note"]}
          >
            {recon.rows.map((r) => (
              <Row
                key={r.label}
                className="hover:bg-soft-1 cursor-pointer"
                tone={r.matched ? undefined : "warn"}
              >
                <Cell onClick={() => setOpen(r.label)}>
                  <span className="text-ink">{r.label}</span>
                </Cell>
                <Cell right>
                  <Amount minor={r.computed} muted />
                </Cell>
                <Cell right className="text-body">
                  <Amount minor={r.actual} muted />
                </Cell>
                <Cell>
                  <CheckMark pass={r.matched} />
                </Cell>
                <Cell className="text-mute">{r.note ?? "—"}</Cell>
              </Row>
            ))}
            <Row tone="total">
              <Cell>{count(recon.rows.length, "line")}</Cell>
              <Cell right>
                <Amount minor={recon.computedTotal} />
              </Cell>
              <Cell right>
                <Amount minor={recon.actualTotal} />
              </Cell>
              <Cell colSpan={2}>
                {recon.computedTotal === recon.actualTotal
                  ? "agrees to the rupiah"
                  : "does not agree"}
              </Cell>
            </Row>
          </Table>
        )}
      </Section>

      <Sheet
        open={Boolean(chosen)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={chosen?.label ?? ""}
      >
        {chosen && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact term="Replayed">{rp(chosen.computed)}</Fact>
              <Fact term="Client posted">{rp(chosen.actual)}</Fact>
              <Fact term="Agrees">{chosen.matched ? "yes" : "no"}</Fact>
            </Facts>
            <div>
              <SubHead>How the two are paired</SubHead>
              <p className="mt-2 text-meta text-body">
                By amount within a class, because the client's entry carries no
                asset reference — nine lines that say only{" "}
                <span className="font-mono">DEPRESIASI ASSET JULY 2026</span>. A
                row marked unmatched is a limitation of their export, not
                necessarily an error in either figure.
              </p>
              {chosen.note && (
                <p className="mt-2 text-meta text-warn-fg">{chosen.note}</p>
              )}
            </div>
          </div>
        )}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Daftar Penyusutan"
      >
        <ReportPrint
          title="Daftar Penyusutan"
          period={`${month}`}
          scope={"C006"}
          columns={[
            { label: "Aset", cell: (r) => r.label },
            { label: "Diulang", align: "right", cell: (r) => rp(r.computed) },
            {
              label: "Diposting klien",
              align: "right",
              cell: (r) => rp(r.actual),
            },
            { label: "Cocok", cell: (r) => (r.matched ? "ya" : "tidak") },
          ]}
          rows={recon.rows}
          total={[
            `${recon.rows.length} baris`,
            rp(recon.computedTotal),
            rp(recon.actualTotal),
            recon.computedTotal === recon.actualTotal ? "cocok" : "selisih",
          ]}
        />
      </PrintSheet>
    </PageContent>
  )
}

/// OE replacement — a reserve the client's manual describes and their journal
/// does not fund.
///
/// # The finding this screen exists to show
///
/// Two of the client's own documents say operating equipment is replaced out of
/// an accrued reserve — a monthly charge to `7010215*` against
/// `1021607 Cadangan Penggantian OE`. July 2026 has fifteen operating-equipment
/// rows worth about Rp190m and **no posting to either account**. Whatever the
/// manual says, they expense it directly.
///
/// So the screen shows the reserve with a zero movement rather than leaving it
/// off. A reserve nobody funds is a finding, and hiding an empty account is how
/// a finding becomes a surprise.
export function OeReplacement() {
  const b = useBook()
  const [unit, setUnit] = useState("C006")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [open, setOpen] = useState<string | null>(null)

  const rows = b.provisions.filter((p) => p.name.includes("OE"))
  const chosen = rows.find((p) => p.id === open)
  const funded = rows.reduce((n, p) => n + p.opening + p.charged - p.used, 0)

  return (
    <PageContent>
      <PageHeader
        crumb="Assets"
        title="OE replacement"
        sub="1021607 Cadangan Penggantian OE — described in the manual, never funded in the journal."
        actions={
          <div className="flex items-center gap-2">
            <Select value={unit} onChange={setUnit} className={FILTER_W}>
              <option value="C006">C006</option>
              <option value="C004">C004</option>
            </Select>
          </div>
        }
      />

      <Kpis
        items={[
          {
            label: "Reserve held",
            value: rp(funded),
            sub: funded ? "" : "nothing has ever been charged",
            tone: funded ? "flat" : "down",
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
            label: "Replacements expensed direct",
            value: "15 rows",
            sub: "≈Rp190m in July 2026",
            tone: "down",
          },
        ]}
      />

      <Banner tone="warn" className="mb-4">
        <div className="min-w-0">
          Documents <span className="font-mono">0139</span> and{" "}
          <span className="font-mono">0159</span> both describe a monthly
          accrual into this reserve. The July journal has fifteen operating
          equipment rows and not one posting to{" "}
          <span className="font-mono">1021607</span> or{" "}
          <span className="font-mono">7010215</span>. The practice and the
          manual disagree, and the practice is what the books show.
        </div>
      </Banner>

      <Section title={`Reserves — ${rows.length}`}>
        <Table
          head={[
            "Reserve",
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
            <Cell colSpan={3}>{count(rows.length, "reserve")}</Cell>
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
              <Amount minor={funded} />
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
              <SubHead>Replace a piece of equipment</SubHead>
              <p className="mt-1.5 text-meta text-body">
                With no reserve funded, this posts the cost straight to expense
                — which is what the client's July journal actually does.
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-w-[10rem] flex-1"
                />
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-[9rem]"
                />
                <Button
                  variant="primary"
                  onClick={() =>
                    b.replaceOperatingEquipment({
                      unit_id: chosen.unit_id,
                      asset_class: "OPERATING_EQUIPMENT",
                      amount: Number(amount.replace(/\D/g, "")) * 100,
                      bank_account_id: `BCA-TAB-${chosen.unit_id}`,
                      on: "2026-07-31",
                      description: description || "Penggantian OE",
                    })
                  }
                >
                  Post replacement
                </Button>
              </div>
            </div>
          </div>
        )}
      </Sheet>
    </PageContent>
  )
}
