import { Plus, Printer, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import * as dep from "@/screens/finance-lab/engine/depreciation"
import {
  Amount,
  Cell,
  ChartBand,
  EntryView,
  MoneyBars,
  Row,
  Section,
  SubHead,
  Table,
  rp,
  FILTER_W,
  Filters,
} from "@/screens/finance-lab/parts"
import { PrintSheet, ReportPrint } from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"

/// Assets & Projects.
///
/// Signature visual is net book value per class — the question an asset
/// register is opened to answer is *what do we still own and what is it worth
/// now*, and a bar per class answers it before anybody reads a row.
///
/// One working list; the detail opens in a sheet beside it rather than as a
/// second column, so the list keeps its width.
///
/// GA and Finance read the same rows and get different columns. GA never sees a
/// debit or a credit here, and not because a field is hidden: `MAY_POST.GA` is
/// false in the engine, so nothing GA can reach produces a posting.
///
/// # What used to be on this page
///
/// A depreciation card sat between the chart and the register, with its own
/// month picker and Post button — three cards above a table, and a screen with
/// three cards has no subject. Depreciation is its own menu now, so the card
/// went with it and this page is what its name says: the register.

/// The month the register's figures are as at. The picker went to Depreciation
/// with the card it belonged to; the register still has to say which month its
/// net book value is.
const MONTH = "2026-07"

const SKIP: Record<string, string> = {
  FULLY_DEPRECIATED: "Fully depreciated",
  NOT_IN_SERVICE: "Not in service",
  NOT_CAPITALISED: "Not assessed",
  NO_MONTHLY_CHARGE: "No monthly charge",
  DISPOSED: "Disposed",
}

/// An asset class, as a person would write it. The engine's own names are
/// SCREAMING_SNAKE; lowercasing them was half the job, and left "oe rak 1"
/// sitting under a chart axis looking like a typo.
const label = (k: string) => {
  const words = k.replace("OTHER_", "").replace(/_/g, " ").toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function LabAssets() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [view, setView] = useState<"GA" | "FINANCE">("FINANCE")
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const [q, setQ] = useState("")
  const [fUnit, setFUnit] = useState("")
  const [fClass, setFClass] = useState("")
  const [fCharge, setFCharge] = useState("")

  const classes = useMemo(
    () => [...new Set(b.assets.map((a) => a.asset_class))].sort(),
    [b.assets]
  )
  const charges = useMemo(
    () => dep.run(b.assets, b.treatments, "C006", MONTH),
    [b.assets, b.treatments]
  )
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return b.assets.filter((a) => {
      const t = b.treatments.find((x) => x.asset_id === a.asset_id)
      if (
        needle &&
        !`${a.name} ${a.asset_number} ${a.asset_class}`
          .toLowerCase()
          .includes(needle)
      )
        return false
      if (fUnit && a.unit_id !== fUnit) return false
      if (fClass && a.asset_class !== fClass) return false
      if (fCharge && (t?.charge ?? "UNASSESSED") !== fCharge) return false
      return true
    })
  }, [b.assets, b.treatments, q, fUnit, fClass, fCharge])

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

  const totalCost = byClass.reduce((n, [, v]) => n + v.cost, 0)
  const totalNbv = byClass.reduce((n, [, v]) => n + v.nbv, 0)
  const asset = b.assets.find((a) => a.asset_id === open)

  return (
    <PageContent>
      <PageHeader
        crumb="Assets"
        title="Asset register"
        sub="Everything the business owns, what it cost, and what it is worth now."
        actions={
          <div className="flex items-center gap-2">
            <Segmented
              value={view}
              onChange={(v) => setView(v as "GA" | "FINANCE")}
              options={[
                { value: "GA", label: "GA" },
                { value: "FINANCE", label: "Finance" },
              ]}
            />
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" />
              Register asset
            </Button>
          </div>
        }
      />

      <Filters>
        <Button onClick={() => setPrinting(true)}>
          <Printer className="size-3.5" />
          Print
        </Button>
        <div className={`relative ${FILTER_W}`}>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="pl-8"
          />
        </div>
        <Select value={fUnit} onChange={setFUnit} className={FILTER_W}>
          <option value="">All units</option>
          <option value="C006">C006</option>
          <option value="C004">C004</option>
        </Select>
        <Select value={fClass} onChange={setFClass} className={FILTER_W}>
          <option value="">All classes</option>
          {classes.map((c) => (
            <option key={c} value={c}>
              {label(c)}
            </option>
          ))}
        </Select>
        <Select value={fCharge} onChange={setFCharge} className={FILTER_W}>
          <option value="">All charges</option>
          <option value="DEPRECIATION">Depreciated</option>
          <option value="NONE">No charge</option>
          <option value="UNASSESSED">Not assessed</option>
        </Select>
      </Filters>

      <ChartBand
        title="Net book value by class"
        right={`cost ${rp(totalCost)} · net book value ${rp(totalNbv)}`}
      >
        <MoneyBars
          stacked
          rows={byClass.map(([k, v]) => ({
            bucket: label(k),
            nbv: v.nbv,
            gone: v.cost - v.nbv,
          }))}
          series={[
            { key: "nbv", label: "Net book value", tone: "accent" },
            { key: "gone", label: "Depreciated", tone: "ghost" },
          ]}
          labelOf={(bucket) =>
            bucket.length > 12 ? `${bucket.slice(0, 11)}…` : bucket
          }
        />
      </ChartBand>

      <Section title={`Register — ${rows.length} of ${b.assets.length}`}>
        {rows.length === 0 ? (
          <EmptyState>No asset matches.</EmptyState>
        ) : (
          <Table
            head={
              view === "GA"
                ? [
                    "Assets",
                    "Class",
                    "Unit",
                    "Location",
                    "Custodian",
                    "Condition",
                    "Status",
                  ]
                : [
                    "Assets",
                    "Class",
                    "Unit",
                    ">Cost",
                    ">Accumulated",
                    ">Net book value",
                    ">Charge this month",
                    "Status",
                  ]
            }
          >
            {rows.map((a) => {
              const t = b.treatments.find((x) => x.asset_id === a.asset_id)
              const c = charges.find((x) => x.asset_id === a.asset_id)
              const acc = t ? dep.accumulated(a, t, MONTH) : 0
              return (
                <Row
                  key={a.asset_id}
                  className="hover:bg-soft-1 cursor-pointer"
                >
                  <Cell onClick={() => setOpen(a.asset_id)}>
                    <span className="text-ink">{a.name}</span>
                    <div className="font-mono text-eyebrow text-faint">
                      {a.asset_number}
                    </div>
                  </Cell>
                  <Cell
                    onClick={() => setOpen(a.asset_id)}
                    className="text-body"
                  >
                    {label(a.asset_class)}
                  </Cell>
                  <Cell>{a.unit_id}</Cell>
                  {view === "GA" ? (
                    <>
                      <Cell className="text-body">{a.location}</Cell>
                      <Cell
                        className={
                          a.custodian === "—" ? "text-bad-fg" : undefined
                        }
                      >
                        {a.custodian}
                      </Cell>
                      <Cell>{a.condition}</Cell>
                    </>
                  ) : (
                    <>
                      <Cell right>
                        {t ? (
                          <Amount minor={t.cost} />
                        ) : (
                          <span className="text-bad-fg">—</span>
                        )}
                      </Cell>
                      <Cell right className="text-body">
                        <Amount minor={acc} muted />
                      </Cell>
                      <Cell right className="font-semibold text-ink">
                        <Amount minor={t ? t.cost - acc : 0} muted />
                      </Cell>
                      <Cell right>
                        <Amount minor={c?.amount ?? 0} muted />
                      </Cell>
                    </>
                  )}
                  <Cell>
                    <Pill tone={a.status === "IN_SERVICE" ? "ok" : "warn"}>
                      {a.status === "IN_SERVICE"
                        ? "in service"
                        : a.status.toLowerCase()}
                    </Pill>
                  </Cell>
                </Row>
              )
            })}
            {view === "FINANCE" && (
              <Row tone="total">
                <Cell colSpan={3}>{rows.length} assets</Cell>
                <Cell right>
                  <Amount
                    minor={rows.reduce(
                      (n, a) =>
                        n +
                        (b.treatments.find((t) => t.asset_id === a.asset_id)
                          ?.cost ?? 0),
                      0
                    )}
                  />
                </Cell>
                <Cell />
                <Cell right>
                  <Amount
                    minor={rows.reduce((n, a) => {
                      const t = b.treatments.find(
                        (x) => x.asset_id === a.asset_id
                      )
                      return n + (t ? t.cost - dep.accumulated(a, t, MONTH) : 0)
                    }, 0)}
                  />
                </Cell>
                <Cell right>
                  <Amount
                    minor={rows.reduce(
                      (n, a) =>
                        n +
                        (charges.find((c) => c.asset_id === a.asset_id)
                          ?.amount ?? 0),
                      0
                    )}
                  />
                </Cell>
                <Cell />
              </Row>
            )}
          </Table>
        )}
      </Section>

      <Sheet
        open={creating}
        onOpenChange={(o) => !o && setCreating(false)}
        title="Register asset"
      >
        <NewAsset onDone={() => setCreating(false)} />
      </Sheet>

      <Sheet
        open={Boolean(asset)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={asset?.name ?? ""}
        id={asset?.asset_number}
      >
        {asset && <Detail assetId={asset.asset_id} view={view} month={MONTH} />}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Daftar Aset Tetap"
      >
        <ReportPrint
          title="Daftar Aset Tetap"
          period={`Per ${MONTH}`}
          scope={`${fUnit || "Seluruh unit"}`}
          columns={[
            { label: "Nomor", cell: (a) => a.asset_number },
            { label: "Nama", cell: (a) => a.name },
            { label: "Kelas", cell: (a) => label(a.asset_class) },
            { label: "Unit", cell: (a) => a.unit_id },
            {
              label: "Harga pokok",
              align: "right",
              cell: (a) =>
                rp(
                  b.treatments.find((t) => t.asset_id === a.asset_id)?.cost ?? 0
                ),
            },
            {
              label: "Akumulasi",
              align: "right",
              cell: (a) => {
                const t = b.treatments.find((x) => x.asset_id === a.asset_id)
                return rp(t ? dep.accumulated(a, t, MONTH) : 0)
              },
            },
            {
              label: "Nilai buku",
              align: "right",
              cell: (a) => {
                const t = b.treatments.find((x) => x.asset_id === a.asset_id)
                return rp(t ? t.cost - dep.accumulated(a, t, MONTH) : 0)
              },
            },
          ]}
          rows={rows}
        />
      </PrintSheet>
    </PageContent>
  )
}

/// GA completes the record. None of these three writes a journal — the engine
/// refuses a posting from the GA role, so the boundary is enforced rather than
/// implied by which buttons are drawn.
function GaActions({ assetId }: { assetId: string }) {
  const b = useBook()
  const a = b.assets.find((x) => x.asset_id === assetId)!
  const [custodian, setCustodian] = useState(
    a.custodian === "—" ? "" : a.custodian
  )
  const [location, setLocation] = useState(a.location)
  const [said, setSaid] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-3">
      <label className="block">
        <span className="mb-1 block font-mono text-eyebrow tracking-[0.04em] text-body uppercase">
          Custodian
        </span>
        <Input
          value={custodian}
          onChange={(e) => setCustodian(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="mb-1 block font-mono text-eyebrow tracking-[0.04em] text-body uppercase">
          Location
        </span>
        <Input value={location} onChange={(e) => setLocation(e.target.value)} />
      </label>
      {said && <p className="text-meta text-ok-fg">{said}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={() => {
            b.completeAsset(assetId, { custodian: custodian || "—", location })
            setSaid(
              "Saved. No journal entry — GA records facts, Finance posts."
            )
          }}
        >
          Save physical data
        </Button>
      </div>
    </div>
  )
}

function NewAsset({ onDone }: { onDone: () => void }) {
  const b = useBook()
  const [name, setName] = useState("")
  const [cls, setCls] = useState("FFE_OFFICE")
  const [unit, setUnit] = useState("C006")
  const [on, setOn] = useState("2026-08-01")
  const [where, setWhere] = useState("")
  const [who, setWho] = useState("")
  const [said, setSaid] = useState<string | null>(null)
  const classes = [...new Set(b.assets.map((a) => a.asset_class))].sort()
  return (
    <div className="flex flex-col gap-3">
      <L t="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </L>
      <L t="Class">
        <Select value={cls} onChange={setCls} className={FILTER_W}>
          {classes.map((c) => (
            <option key={c} value={c}>
              {label(c)}
            </option>
          ))}
        </Select>
      </L>
      <L t="Unit">
        <Select value={unit} onChange={setUnit} className={FILTER_W}>
          <option value="C006">C006</option>
          <option value="C004">C004</option>
        </Select>
      </L>
      <L t="Document date">
        <Input value={on} onChange={(e) => setOn(e.target.value)} />
      </L>
      <L t="Location">
        <Input value={where} onChange={(e) => setWhere(e.target.value)} />
      </L>
      <L t="Custodian">
        <Input value={who} onChange={(e) => setWho(e.target.value)} />
      </L>
      {said && <p className="text-meta text-bad-fg">{said}</p>}
      <div className="flex gap-2">
        <Button
          variant="primary"
          onClick={() => {
            if (!name.trim()) return setSaid("Name is required.")
            b.registerAsset({
              name: name.trim(),
              unit_id: unit,
              asset_class: cls,
              quantity: 1,
              document_on: on,
              location: where || unit,
              custodian: who,
            })
            onDone()
          }}
        >
          Register
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
      <p className="text-meta text-mute">
        Registering records the thing. It posts nothing — the acquisition is the
        payment document.
      </p>
    </div>
  )
}

function L({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-eyebrow tracking-[0.04em] text-body uppercase">
        {t}
      </span>
      {children}
    </label>
  )
}

function Detail({
  assetId,
  view,
  month,
}: {
  assetId: string
  view: "GA" | "FINANCE"
  month: string
}) {
  const b = useBook()
  const asset = b.assets.find((a) => a.asset_id === assetId)!
  const t = b.treatments.find((x) => x.asset_id === assetId)
  const parts = b.components.filter((c) => c.asset_id === assetId)
  const acc = t ? dep.accumulated(asset, t, month) : 0
  const charge = dep.charge(asset, t, month)
  const entrieses = parts
    .map((p) => (p.entry_id ? b.ledger.entry(p.entry_id) : undefined))
    .filter(Boolean)

  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact term="Class">{label(asset.asset_class)}</Fact>
        <Fact term="Unit">{asset.unit_id}</Fact>
        <Fact term="Quantity">{asset.quantity}</Fact>
        <Fact term="Condition">{asset.condition}</Fact>
        <Fact term="Location">{asset.location}</Fact>
        <Fact term="Custodian">
          <span className={asset.custodian === "—" ? "text-bad-fg" : undefined}>
            {asset.custodian}
          </span>
        </Fact>
        <Fact term="Document date">{asset.document_on}</Fact>
        <Fact term="Register date">{asset.register_on}</Fact>
      </Facts>

      {view === "FINANCE" && (
        <>
          <div>
            <SubHead>Value</SubHead>
            {t ? (
              <Facts className="mt-2">
                <Fact term="Cost">{rp(t.cost)}</Fact>
                <Fact term="Method">
                  {t.method === "STRAIGHT_LINE"
                    ? "Garis lurus"
                    : "Tanpa penyusutan"}
                </Fact>
                <Fact term="Age">{t.life_months} months</Fact>
                <Fact term="Starts">{t.in_service_on}</Fact>
                <Fact term={`Accumulated to ${month}`}>{rp(acc)}</Fact>
                <Fact term="Net book value">{rp(t.cost - acc)}</Fact>
                <Fact term="Charge this month">
                  {charge.amount > 0
                    ? rp(charge.amount)
                    : (SKIP[charge.skipped ?? ""] ?? "—")}
                </Fact>
                <Fact term="Charge type">{t.charge}</Fact>
              </Facts>
            ) : (
              <p className="mt-2 text-meta text-bad-fg">
                Not assessed Finance.
              </p>
            )}
          </div>

          {parts.length > 0 && (
            <div>
              <SubHead>Cost components</SubHead>
              <Table head={["Komponen", "Document", ">Value", "Journal"]}>
                {parts.map((p) => (
                  <Row
                    key={p.component_id}
                    tone={p.entry_id ? undefined : "warn"}
                  >
                    <Cell>{p.kind}</Cell>
                    <Cell mono>{p.document_ref}</Cell>
                    <Cell right>
                      <Amount minor={p.amount} />
                    </Cell>
                    <Cell mono className="text-mute">
                      {p.entry_id
                        ? b.ledger.entry(p.entry_id)?.entry_number
                        : "not yet"}
                    </Cell>
                  </Row>
                ))}
                <Row tone="total">
                  <Cell colSpan={2}>Harga perolehan</Cell>
                  <Cell right>
                    <Amount minor={parts.reduce((n, p) => n + p.amount, 0)} />
                  </Cell>
                  <Cell />
                </Row>
              </Table>
            </div>
          )}

          {entrieses.length > 0 && (
            <div>
              <SubHead>Journal</SubHead>
              <div className="mt-2">
                {entrieses.map(
                  (e) => e && <EntryView key={e.entry_id} entry={e} />
                )}
              </div>
            </div>
          )}
        </>
      )}

      {view === "GA" && <GaActions assetId={assetId} />}
    </div>
  )
}
