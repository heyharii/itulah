import { ArrowRight, Eye, Play, Search, Wrench, X } from "lucide-react"
import { useMemo, useState } from "react"

import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented } from "@/components/ui/segmented"
import { Tag } from "@/components/ui/tag"
import { cn } from "@/lib/utils"
import { CUTOVER } from "@/screens/finance-lab/engine/book"
import * as dep from "@/screens/finance-lab/engine/depreciation"
import { JULY_DEPRECIATION_ACTUAL } from "@/screens/finance-lab/engine/fixtures"
import {
  Amount,
  Blocked,
  Cell,
  CheckMark,
  EntryView,
  Panel,
  Row,
  Section,
  SimBadge,
  Table,
  rp,
} from "@/screens/finance-lab/parts"
import { useBook } from "@/screens/finance-lab/state"
import type { AssetFact } from "@/screens/finance-lab/engine/types"

/// Assets & Projects — the one register both GA and Finance read.
///
/// # Why the view switch is a first-class control and not a permission trick
///
/// GA and Finance look at the same rows and need different columns. GA needs
/// where the thing is, who holds it, what condition it is in; Finance needs
/// what it cost, over how long, and which entry put it in the books. Showing
/// everything to everybody makes GA's screen a spreadsheet of numbers they
/// cannot act on, and hiding the money behind a role makes the register look
/// like two registers.
///
/// So the toggle changes the COLUMNS and the ACTIONS, and the row is the same
/// row. GA never sees a debit or a credit anywhere in this screen — not
/// because the field is hidden, but because nothing GA does produces one, and
/// `MAY_POST.GA` is false in the engine so a URL cannot get around it.
export function LabAssets() {
  const b = useBook()
  const [view, setView] = useState<"GA" | "FINANCE">("FINANCE")
  const [selected, setSelected] = useState<string | null>("A-C006-047")
  const [month, setMonth] = useState("2026-07")

  // Filters. §9 asks that a transaction table be scannable — which on a
  // 48-row register means a search box and three narrowings, not a facet rail.
  const [q, setQ] = useState("")
  const [fUnit, setFUnit] = useState("")
  const [fClass, setFClass] = useState("")
  const [fCharge, setFCharge] = useState("")
  const [fStatus, setFStatus] = useState("")

  const classes = useMemo(
    () => [...new Set(b.assets.map((a) => a.asset_class))].sort(),
    [b.assets]
  )

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return b.assets.filter((a) => {
      const t = b.treatments.find((x) => x.asset_id === a.asset_id)
      if (needle && !`${a.name} ${a.asset_number} ${a.asset_class}`.toLowerCase().includes(needle))
        return false
      if (fUnit && a.unit_id !== fUnit) return false
      if (fClass && a.asset_class !== fClass) return false
      if (fCharge && (t?.charge ?? "UNASSESSED") !== fCharge) return false
      if (fStatus && a.status !== fStatus) return false
      return true
    })
  }, [b.assets, b.treatments, q, fUnit, fClass, fCharge, fStatus])

  const queue = b.reviewQueue()
  const charges = useMemo(
    () => dep.run(b.assets, b.treatments, "C006", month),
    [b.assets, b.treatments, month]
  )
  const charging = charges.filter((c) => c.amount > 0)
  const names = useMemo(() => new Map(b.assets.map((a) => [a.asset_id, a.name])), [b.assets])
  const recon = useMemo(
    () => dep.reconcile(charging, JULY_DEPRECIATION_ACTUAL, names),
    [charging, names]
  )
  const posted = b.depreciationEntry("C006", month)

  const asset = b.assets.find((a) => a.asset_id === selected)
  const filtered = q || fUnit || fClass || fCharge || fStatus

  return (
    <div>
      <PageHeader
        crumb="Finance lab"
        title="Assets & Projects"
        sub="Satu data aset. GA memelihara fakta fisik; Finance menetapkan dampak keuangannya."
        actions={
          <div className="flex items-center gap-2">
            <SimBadge />
            <Segmented
              value={view}
              onChange={(v) => setView(v as "GA" | "FINANCE")}
              options={[
                { value: "GA", label: "GA" },
                { value: "FINANCE", label: "Finance" },
              ]}
            />
          </div>
        }
      />

      <Section
        title="Yang perlu dikerjakan"
        sub="Antrean, bukan kartu statistik. Setiap angka di bawah adalah daftar yang bisa dikerjakan."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Queue
            label="Register belum lengkap"
            n={queue.incomplete.length}
            hint="Dibeli dan dibayar, tapi lokasi, penanggung jawab atau foto belum diisi."
            owner="GA"
            onPick={() => queue.incomplete[0] && setSelected(queue.incomplete[0].asset_id)}
          />
          <Queue
            label="Menunggu penilaian Finance"
            n={queue.unassessed.length}
            hint="Belum ada keputusan kapitalisasi. Bukan nol — ini gap kontrol yang terbuka."
            owner="Finance"
            onPick={() => queue.unassessed[0] && setSelected(queue.unassessed[0].asset_id)}
          />
          <Queue
            label="Tidak ada dokumen pembelian"
            n={queue.unbacked.length}
            hint={`Aset yang didaftarkan sejak ${CUTOVER} tanpa pembayaran di belakangnya. Aset lama tidak dihitung di sini.`}
            owner="Finance"
            onPick={() => queue.unbacked[0] && setSelected(queue.unbacked[0].asset_id)}
          />
        </div>
      </Section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Section
            title={`Register — ${rows.length} dari ${b.assets.length} baris`}
            right={
              filtered ? (
                <button
                  type="button"
                  onClick={() => {
                    setQ("")
                    setFUnit("")
                    setFClass("")
                    setFCharge("")
                    setFStatus("")
                  }}
                  className="inline-flex items-center gap-1 text-[0.75rem] font-medium text-accent"
                >
                  <X className="size-3" /> Hapus filter
                </button>
              ) : null
            }
          >
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[11rem] flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Cari nama, nomor, kelas"
                  className="pl-8"
                />
              </div>
              <Select value={fUnit} onChange={setFUnit}>
                <option value="">Semua unit</option>
                <option value="C006">C006</option>
                <option value="C004">C004</option>
              </Select>
              <Select value={fClass} onChange={setFClass}>
                <option value="">Semua kelas</option>
                {classes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
              <Select value={fCharge} onChange={setFCharge}>
                <option value="">Semua beban</option>
                <option value="DEPRECIATION">DEPRECIATION</option>
                <option value="NONE">NONE (OE)</option>
                <option value="UNASSESSED">Belum dinilai</option>
              </Select>
              <Select value={fStatus} onChange={setFStatus}>
                <option value="">Semua status</option>
                <option value="IN_SERVICE">IN_SERVICE</option>
                <option value="INSTALLED">INSTALLED</option>
                <option value="RECEIVED">RECEIVED</option>
              </Select>
            </div>

            <Panel>
              {rows.length === 0 ? (
                <p className="px-3.5 py-6 text-center text-[0.8125rem] text-mute">
                  Tidak ada baris yang cocok dengan filter ini.
                </p>
              ) : (
                <Table
                  head={
                    view === "GA"
                      ? ["Aset", "Kelas", "Lokasi", "Penanggung jawab", "Kondisi", "Status"]
                      : ["Aset", "Kelas", ">Perolehan", "Umur", "Beban", ">Bulan ini", "Status"]
                  }
                >
                  {rows.map((a) => {
                    const t = b.treatments.find((x) => x.asset_id === a.asset_id)
                    const c = charges.find((x) => x.asset_id === a.asset_id)
                    return (
                      <Row
                        key={a.asset_id}
                        className={cn(
                          "cursor-pointer hover:bg-soft-1",
                          selected === a.asset_id && "bg-accent-bg"
                        )}
                      >
                        <Cell onClick={() => setSelected(a.asset_id)}>
                          <span className="text-ink">{a.name}</span>
                          <div className="font-mono text-[0.6875rem] text-faint">
                            {a.asset_number}
                          </div>
                        </Cell>
                        <Cell onClick={() => setSelected(a.asset_id)}>
                          <Tag>{a.asset_class}</Tag>
                        </Cell>
                        {view === "GA" ? (
                          <>
                            <Cell>{a.location}</Cell>
                            <Cell className={a.custodian === "—" ? "text-bad-fg" : undefined}>
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
                                <span className="text-bad-fg">belum dinilai</span>
                              )}
                            </Cell>
                            <Cell>{t ? `${t.life_months} bln` : "—"}</Cell>
                            <Cell>
                              {t ? (
                                <Tag tone={t.charge === "NONE" ? "warn" : "neutral"}>{t.charge}</Tag>
                              ) : (
                                "—"
                              )}
                            </Cell>
                            <Cell right>
                              <Amount minor={c?.amount ?? 0} muted />
                            </Cell>
                          </>
                        )}
                        <Cell>
                          <Tag tone={a.status === "IN_SERVICE" ? "ok" : "warn"}>{a.status}</Tag>
                        </Cell>
                      </Row>
                    )
                  })}
                  {view === "FINANCE" && (
                    <Row className="border-t border-hairline font-semibold">
                      <Cell colSpan={2}>Total yang terlihat</Cell>
                      <Cell right>
                        <Amount
                          minor={rows.reduce(
                            (n, a) =>
                              n + (b.treatments.find((t) => t.asset_id === a.asset_id)?.cost ?? 0),
                            0
                          )}
                        />
                      </Cell>
                      <Cell colSpan={2} />
                      <Cell right>
                        <Amount
                          minor={rows.reduce(
                            (n, a) => n + (charges.find((c) => c.asset_id === a.asset_id)?.amount ?? 0),
                            0
                          )}
                        />
                      </Cell>
                      <Cell />
                    </Row>
                  )}
                </Table>
              )}
            </Panel>
          </Section>
        </div>

        <div className="min-w-0">{asset && <Detail asset={asset} view={view} month={month} />}</div>
      </div>

      {view === "FINANCE" && (
        <>
          <DepreciationRun
            month={month}
            setMonth={setMonth}
            charging={charging.length}
            total={charging.reduce((n, c) => n + c.amount, 0)}
            posted={posted}
            onRun={() => b.runDepreciation("C006", month)}
          />

          <Section
            title={`Preview penyusutan ${month}`}
            sub={`${charging.length} aset membebankan, ${charges.length - charging.length} tidak. Alasan setiap yang tidak dibebankan ditampilkan.`}
          >
            <Panel>
              <Table head={["Aset", "Kelas", ">Perolehan", ">Beban", "Alasan tidak membebankan"]}>
                {charges
                  .slice()
                  .sort((x, y) => y.amount - x.amount)
                  .map((c) => {
                    const a = b.assets.find((z) => z.asset_id === c.asset_id)!
                    const t = b.treatments.find((z) => z.asset_id === c.asset_id)
                    return (
                      <Row key={c.asset_id} tone={c.amount > 0 ? undefined : "muted"}>
                        <Cell>{a.name}</Cell>
                        <Cell>
                          <Tag>{c.asset_class}</Tag>
                        </Cell>
                        <Cell right>
                          <Amount minor={t?.cost} muted />
                        </Cell>
                        <Cell right className={c.amount > 0 ? "font-semibold text-ink" : undefined}>
                          <Amount minor={c.amount} muted />
                        </Cell>
                        <Cell className="text-mute">{SKIP[c.skipped ?? ""] ?? "—"}</Cell>
                      </Row>
                    )
                  })}
                <Row className="border-t border-hairline font-semibold">
                  <Cell colSpan={3}>Total</Cell>
                  <Cell right>
                    <Amount minor={charging.reduce((n, c) => n + c.amount, 0)} />
                  </Cell>
                  <Cell />
                </Row>
              </Table>
            </Panel>
          </Section>

          {month === "2026-07" && (
            <Section
              title="Rekonsiliasi ke GL-26-07-00004"
              sub="Replay dari register dibandingkan dengan entri klien. Yang tidak berpasangan tetap ditampilkan."
            >
              <Panel>
                <Table head={["Aset", ">Replay", ">Klien", "", "Catatan"]}>
                  {recon.rows.map((r, i) => (
                    <Row key={i} tone={r.matched ? undefined : "warn"}>
                      <Cell>{r.label}</Cell>
                      <Cell right>
                        <Amount minor={r.computed} muted />
                      </Cell>
                      <Cell right>
                        <Amount minor={r.actual} muted />
                      </Cell>
                      <Cell className="w-8">
                        <CheckMark pass={r.matched} />
                      </Cell>
                      <Cell className="text-mute">{r.note ?? "cocok persis"}</Cell>
                    </Row>
                  ))}
                  <Row className="border-t border-hairline font-semibold">
                    <Cell>Total</Cell>
                    <Cell right>
                      <Amount minor={recon.computedTotal} />
                    </Cell>
                    <Cell right>
                      <Amount minor={recon.actualTotal} />
                    </Cell>
                    <Cell colSpan={2}>
                      {recon.computedTotal === recon.actualTotal ? "Selisih nol" : "ADA SELISIH"}
                    </Cell>
                  </Row>
                </Table>
              </Panel>
            </Section>
          )}

          <OeReplacement />
        </>
      )}
    </div>
  )
}

const SKIP: Record<string, string> = {
  FULLY_DEPRECIATED: "Umur habis — bulan terakhirnya sudah lewat",
  NOT_IN_SERVICE: "Belum mulai",
  NOT_CAPITALISED: "Belum dinilai Finance",
  NO_MONTHLY_CHARGE:
    "Operating equipment. Tidak ada tarif reserve yang dikonfirmasi, dan Juli tidak membebankan apa pun untuknya.",
  DISPOSED: "Sudah dilepas",
  "": "",
}

/// Review, then post. Two steps because §6 asks for them, and because posting a
/// month is the one scheduled action nobody should be able to do by accident.
function DepreciationRun({
  month,
  setMonth,
  charging,
  total,
  posted,
  onRun,
}: {
  month: string
  setMonth: (m: string) => void
  charging: number
  total: number
  posted: ReturnType<ReturnType<typeof useBook>["depreciationEntry"]>
  onRun: () => void
}) {
  const [result, setResult] = useState<string | null>(null)
  return (
    <Section
      title="Jalankan penyusutan"
      sub="Periksa dulu, lalu posting. Menjalankan ulang bulan yang sama tidak menggandakan apa pun."
    >
      <Panel>
        <div className="flex flex-wrap items-end gap-3 px-3.5 py-3">
          <label className="min-w-[8rem]">
            <span className="mb-1 block text-eyebrow font-semibold text-mute uppercase">Bulan</span>
            <Select value={month} onChange={setMonth}>
              {["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </label>
          <div className="min-w-[10rem]">
            <span className="mb-1 block text-eyebrow font-semibold text-mute uppercase">
              Akan dibebankan
            </span>
            <span className="text-[0.9375rem] font-semibold text-ink tabular-nums">
              {charging} aset · {rp(total)}
            </span>
          </div>
          <button
            type="button"
            disabled={charging === 0}
            onClick={() => {
              const r = onRun() as unknown as { ok: boolean; message?: string; replayed?: boolean }
              setResult(
                r.ok
                  ? r.replayed
                    ? "Sudah pernah diposting — entri yang sama dikembalikan, tidak ada entri baru."
                    : "Diposting."
                  : `Ditolak: ${r.message}`
              )
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.8125rem] font-semibold shadow-soft",
              charging === 0
                ? "cursor-not-allowed bg-soft-2 text-faint"
                : "bg-accent text-white hover:opacity-90"
            )}
          >
            <Play className="size-3.5" />
            {posted ? "Jalankan ulang" : "Posting"}
          </button>
          {result && <span className="text-[0.8125rem] text-body">{result}</span>}
        </div>
        {charging === 0 && (
          <div className="border-t border-hairline px-3.5 py-2.5">
            <span className="text-[0.8125rem] text-mute">
              Tidak ada aset yang membebankan di {month}, jadi tidak ada yang bisa diposting. Bulan
              tanpa beban bukan kegagalan.
            </span>
          </div>
        )}
      </Panel>
      {posted && (
        <div className="mt-3">
          <EntryView entry={posted} />
        </div>
      )}
    </Section>
  )
}

/// Ajukan penggantian OE — the action §7 names, doing exactly what §4 says.
function OeReplacement() {
  const b = useBook()
  const [amount, setAmount] = useState("2750000")
  const [desc, setDesc] = useState("Rak besi pengganti")
  const [said, setSaid] = useState<string | null>(null)

  const entries = b.ledger
    .allEntries()
    .filter((e) => e.rule_version.startsWith("oe_replacement"))

  return (
    <Section
      title="Penggantian OE"
      sub="Menjadi biaya replacement. Tidak menambah nilai register, tidak memulai jadwal, tidak menarik reserve."
    >
      <Panel>
        <div className="flex flex-wrap items-end gap-3 px-3.5 py-3">
          <label className="min-w-[12rem] flex-1">
            <span className="mb-1 block text-eyebrow font-semibold text-mute uppercase">
              Apa yang diganti
            </span>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </label>
          <label className="min-w-[9rem]">
            <span className="mb-1 block text-eyebrow font-semibold text-mute uppercase">
              Nilai (Rp)
            </span>
            <Input
              value={amount}
              inputMode="numeric"
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              const n = Number(amount)
              if (!n) {
                setSaid("Nilai harus diisi.")
                return
              }
              const r = b.replaceOperatingEquipment({
                unit_id: "C006",
                asset_class: "OE_RAK_1",
                amount: n * 100,
                bank_account_id: "BCA-TAB-C006",
                on: "2026-08-04",
                description: desc,
              }) as unknown as { ok: boolean; message?: string }
              setSaid(r.ok ? "Diposting sebagai biaya replacement." : `Ditolak: ${r.message}`)
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[0.8125rem] font-semibold text-white shadow-soft hover:opacity-90"
          >
            <Wrench className="size-3.5" />
            Bayar Penggantian OE
          </button>
          {said && <span className="text-[0.8125rem] text-body">{said}</span>}
        </div>
        <div className="border-t border-hairline px-3.5 py-2.5 text-[0.75rem] text-mute">
          Aset OE C006 di register: {b.assets.filter((a) => a.asset_class === "OE_RAK_1").length}{" "}
          baris, nilai{" "}
          {rp(
            b.treatments
              .filter((t) =>
                b.assets.some((a) => a.asset_id === t.asset_id && a.asset_class === "OE_RAK_1")
              )
              .reduce((n, t) => n + t.cost, 0)
          )}
          . Angka ini tidak berubah setelah penggantian — itulah maksudnya. Saldo akun aset OE{" "}
          {rp(b.ledger.balance("102150700106", { unit_id: "C006" }))}, saldo reserve{" "}
          {rp(b.ledger.balance("102160700106", { unit_id: "C006" }))}.
        </div>
      </Panel>
      {entries.length > 0 && (
        <div className="mt-3 space-y-3">
          {entries.map((e) => (
            <EntryView key={e.entry_id} entry={e} />
          ))}
        </div>
      )}
    </Section>
  )
}

function Queue({
  label,
  n,
  hint,
  owner,
  onPick,
}: {
  label: string
  n: number
  hint: string
  owner: string
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={n === 0}
      className={cn(
        "rounded-[0.8125rem] border px-3.5 py-3 text-left transition-colors",
        n === 0
          ? "cursor-default border-hairline bg-canvas"
          : "border-warn-fg/25 bg-warn-bg/40 hover:bg-warn-bg/60"
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-eyebrow font-semibold text-mute uppercase">{label}</span>
        <Tag tone={owner === "GA" ? "info" : "accent"}>{owner}</Tag>
      </div>
      <div className="mt-1.5 text-[1.25rem] leading-none font-semibold text-ink tabular-nums">
        {n}
      </div>
      <p className="mt-1.5 text-[0.75rem] text-body">{hint}</p>
    </button>
  )
}

function Detail({
  asset,
  view,
  month,
}: {
  asset: AssetFact
  view: "GA" | "FINANCE"
  month: string
}) {
  const b = useBook()
  const t = b.treatments.find((x) => x.asset_id === asset.asset_id)
  const parts = b.components.filter((c) => c.asset_id === asset.asset_id)
  const cost = b.costOf(asset.asset_id)
  const recognised = b.recognisedOf(asset.asset_id)
  const entries = parts
    .map((p) => (p.entry_id ? b.ledger.entry(p.entry_id) : undefined))
    .filter(Boolean)
  const acc = t ? dep.accumulated(asset, t, month) : 0

  return (
    <Section title={asset.name} sub={`${asset.asset_number} · ${asset.unit_id}`}>
      <Panel className="mb-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-3.5 py-3 text-[0.8125rem]">
          <Field label="Kelas" value={asset.asset_class} />
          <Field label="Jumlah" value={String(asset.quantity)} />
          <Field label="Lokasi" value={asset.location} />
          <Field label="Penanggung jawab" value={asset.custodian} bad={asset.custodian === "—"} />
          <Field label="Tanggal dokumen" value={asset.document_on} />
          <Field
            label="Tanggal register"
            value={asset.register_on}
            hint="Awal bulan sejak Juni 2026. Bukan tanggal mulai penyusutan."
          />
          <Field label="Kondisi" value={asset.condition} />
          <Field label="Foto" value={String(asset.photo_count)} bad={asset.photo_count === 0} />
        </dl>
      </Panel>

      {view === "GA" ? (
        <div className="flex flex-wrap gap-2">
          <LabButton icon={Wrench}>Lengkapi data fisik</LabButton>
          <LabButton icon={ArrowRight}>Ajukan mutasi</LabButton>
          <LabButton icon={Eye}>Ajukan pelepasan</LabButton>
          <p className="mt-1 w-full text-[0.75rem] text-mute">
            GA tidak memilih debit dan kredit. Tidak ada satu pun tindakan di atas yang menghasilkan
            jurnal — semuanya mengubah fakta fisik dan mengantre untuk Finance. Di engine, peran GA
            memang tidak boleh memposting: dicoba di skenario G.7 dan ditolak.
          </p>
        </div>
      ) : (
        <>
          <Section title="Komponen biaya perolehan" className="mb-4">
            <Panel>
              {parts.length === 0 ? (
                <p className="px-3.5 py-3 text-[0.8125rem] text-mute">
                  Tidak ada komponen. Aset ini sudah dimiliki sebelum sistem ini ada, yang merupakan
                  keadaan biasa dan bukan temuan.
                </p>
              ) : (
                <Table head={["Komponen", "Dokumen", "Dibayar", ">Nilai", "Diakui di buku"]}>
                  {parts.map((p) => (
                    <Row key={p.component_id} tone={p.entry_id ? undefined : "warn"}>
                      <Cell>{p.kind}</Cell>
                      <Cell mono>{p.document_ref}</Cell>
                      <Cell>{p.paid_on}</Cell>
                      <Cell right>
                        <Amount minor={p.amount} />
                      </Cell>
                      <Cell>
                        {p.entry_id ? (
                          <span className="font-mono text-[0.6875rem] text-ok-fg">
                            {b.ledger.entry(p.entry_id)?.entry_number}
                          </span>
                        ) : (
                          <span className="text-warn-fg">belum</span>
                        )}
                      </Cell>
                    </Row>
                  ))}
                  <Row className="border-t border-hairline font-semibold">
                    <Cell colSpan={3}>Harga perolehan</Cell>
                    <Cell right>
                      <Amount minor={cost} />
                    </Cell>
                    <Cell />
                  </Row>
                </Table>
              )}
            </Panel>
          </Section>

          {cost !== recognised && (
            <Blocked>
              <span className="font-semibold">
                {rp(cost - recognised)} dari harga perolehan belum masuk buku.
              </span>{" "}
              Komponen yang belum diakui dibayar pada periode yang sudah ditutup, jadi pembayarannya
              ditolak. Buka kembali periodenya di Accounting &amp; Close, atau posting koreksi
              bertanggal periode berjalan — melengkapi register tidak akan mengakuinya.
            </Blocked>
          )}

          {t ? (
            <Section title="Perlakuan Finance" className="mt-4">
              <Panel>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-3.5 py-3 text-[0.8125rem]">
                  <Field label="Keputusan" value={t.decision} />
                  <Field label="Metode" value={t.method} />
                  <Field label="Harga perolehan" value={rp(t.cost)} />
                  <Field label="Umur" value={`${t.life_months} bulan`} />
                  <Field label="Jenis beban" value={t.charge} />
                  <Field label="Mulai dibebankan" value={t.in_service_on} />
                  <Field label={`Akumulasi s/d ${month}`} value={rp(acc)} />
                  <Field label="Nilai buku" value={rp(t.cost - acc)} />
                </dl>
                <p className="border-t border-hairline px-3.5 py-2 text-[0.75rem] text-mute">
                  {t.reason}
                </p>
              </Panel>
            </Section>
          ) : (
            <Blocked>
              Belum ada keputusan kapitalisasi. Sampai Finance menilainya, aset ini tidak
              menghasilkan beban bulanan — dan itu berbeda dari &ldquo;dinilai, lalu
              dibiayakan&rdquo;.
            </Blocked>
          )}

          {entries.length > 0 && (
            <Section title="Jurnal yang menyentuh aset ini" className="mt-4">
              <div className="space-y-3">
                {entries.map((e) => e && <EntryView key={e.entry_id} entry={e} />)}
              </div>
            </Section>
          )}
        </>
      )}
    </Section>
  )
}

function Field({
  label,
  value,
  hint,
  bad,
}: {
  label: string
  value: string
  hint?: string
  bad?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-eyebrow font-semibold text-mute uppercase">{label}</dt>
      <dd className={cn("mt-0.5 text-ink", bad && "text-bad-fg")}>{value}</dd>
      {hint && <dd className="text-[0.6875rem] text-faint">{hint}</dd>}
    </div>
  )
}

/// A button that says what it would do, and says where the boundary is.
///
/// Not a dead control: pressing it explains why it cannot run, which is §9's
/// "tampilkan alasan ketika tindakan belum bisa dijalankan" applied to a
/// prototype whose write path is deliberately narrow.
function LabButton({ icon: Icon, children }: { icon: typeof Wrench; children: React.ReactNode }) {
  const [said, setSaid] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setSaid((s) => !s)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-canvas px-2.5 py-1.5 text-[0.8125rem] font-medium text-ink shadow-soft hover:bg-soft-1"
      >
        <Icon className="size-3.5" />
        {children}
      </button>
      {said && (
        <p className="mt-1.5 max-w-[22rem] text-[0.75rem] text-mute">
          Alur ini ada di kontrak sebagai draft dan belum bisa memposting: mutasi dan pelepasan
          menunggu jurnal aktualnya. Yang sudah berjalan penuh ada di Skenario A–H dan di tombol
          Penggantian OE di bawah.
        </p>
      )}
    </div>
  )
}
