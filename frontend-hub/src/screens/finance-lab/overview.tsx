import { AppLink } from "@/components/ui/app-link"
import { PageHeader } from "@/components/ui/page-header"
import { Tag } from "@/components/ui/tag"
import { cn } from "@/lib/utils"
import { useBook } from "@/screens/finance-lab/state"
import { PACKAGES } from "@/screens/finance-lab/engine/rules"
import { SCENARIOS, World } from "@/screens/finance-lab/engine/scenarios"
import {
  Amount,
  Blocked,
  Cell,
  Panel,
  Row,
  Section,
  SimBadge,
  Table,
} from "@/screens/finance-lab/parts"
import { useMemo } from "react"

/// The overview, which leads with what is still open rather than with figures.
///
/// Everything on this screen is either a link into work or a statement of what
/// this prototype does NOT establish. The second half matters more than the
/// first: a prototype that passes its own scenarios is a prototype that passes
/// its own scenarios, and the distance between that and a Finance module in
/// production is what somebody reading this needs to be told.
export function LabOverview() {
  const b = useBook()
  const results = useMemo(
    () =>
      SCENARIOS.map((s) => {
        try {
          return s.run(new World())
        } catch {
          return { id: s.id, steps: [], checks: [{ label: "threw", pass: false }], passed: false }
        }
      }),
    []
  )
  const checks = results.reduce((n, r) => n + r.checks.length, 0)
  const failed = results.reduce((n, r) => n + r.checks.filter((c) => !c.pass).length, 0)
  const queue = b.reviewQueue()
  const off = PACKAGES.filter((p) => !p.activation.enabled)
  const tb = b.ledger.trialBalance({ book_id: "CFS" })

  const openItems = b.payments
    .allItems()
    .map((i) => ({ i, out: b.payments.outstanding(i.item_id) }))
    .filter((x) => x.out > 0)

  return (
    <div>
      <PageHeader
        crumb="Finance lab"
        title="Finance lab"
        sub="Harness kontrak Finance & Asset. Semua angka di sini adalah simulasi di atas fixture dari jurnal C006 Juli 2026."
        actions={<SimBadge />}
      />

      <Blocked>
        <span className="font-semibold">Modul ini bukan Finance produksi.</span> Buku produksi ada di{" "}
        <AppLink to="/finance" className="underline">
          Finance
        </AppLink>
        , dan tidak ada satu pun yang di halaman ini menyentuhnya — tidak ada permintaan jaringan,
        tidak ada database, tidak ada pembayaran. Yang dibuktikan di sini adalah bahwa aturan
        postingnya benar dan penolakannya beralasan; yang tidak dibuktikan adalah bahwa Finance siap
        produksi.
      </Blocked>

      <Section title="Perlu perhatian" className="mt-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Att
            to="/finance-lab/scenarios"
            label="Skenario penerimaan"
            value={`${checks - failed}/${checks}`}
            hint={failed === 0 ? "Semua lolos, termasuk enam yang harus ditolak" : `${failed} gagal`}
            tone={failed === 0 ? "ok" : "bad"}
          />
          <Att
            to="/finance-lab/contract"
            label="Aturan tidak aktif"
            value={String(off.length)}
            hint="Diblokir oleh bukti, bukan oleh pekerjaan yang belum selesai"
            tone="warn"
          />
          <Att
            to="/finance-lab/assets"
            label="Aset menunggu Finance"
            value={String(queue.unassessed.length)}
            hint="Belum dinilai — gap kontrol, bukan nol"
            tone={queue.unassessed.length ? "warn" : "ok"}
          />
          <Att
            to="/finance-lab/accruals"
            label="Kewajiban terbuka"
            value={String(openItems.length)}
            hint={openItems.length ? `Sisa ${openItems.reduce((n, x) => n + x.out, 0) / 100 > 0 ? "" : ""}` : "Tidak ada"}
            tone={openItems.length ? "warn" : "ok"}
          />
        </div>
      </Section>

      <Section
        title="Buku simulasi"
        sub="C006 Juli 2026, dipadatkan: kiriman, penjualan, setoran, payroll, penyusutan, dan telepon."
      >
        <Panel>
          <Table head={["", ">Nilai"]}>
            <Row>
              <Cell>Entri jurnal</Cell>
              <Cell right>{b.ledger.allEntries().length}</Cell>
            </Row>
            <Row>
              <Cell>Akun tersentuh</Cell>
              <Cell right>{tb.rows.length}</Cell>
            </Row>
            <Row>
              <Cell>Total debit</Cell>
              <Cell right>
                <Amount minor={tb.total_debit} />
              </Cell>
            </Row>
            <Row>
              <Cell>Total kredit</Cell>
              <Cell right>
                <Amount minor={tb.total_credit} />
              </Cell>
            </Row>
            <Row tone={tb.balanced ? undefined : "bad"}>
              <Cell>Seimbang</Cell>
              <Cell right>
                <Tag tone={tb.balanced ? "ok" : "bad"}>{tb.balanced ? "ya" : "TIDAK"}</Tag>
              </Cell>
            </Row>
          </Table>
        </Panel>
      </Section>

      <Section
        title="Keputusan accounting yang masih dibutuhkan"
        sub="Setiap baris memblokir sesuatu yang spesifik. Tidak ada yang ditebak di prototype ini."
      >
        <Panel>
          <Table head={["Pertanyaan", "Memblokir", "Bukti yang diminta"]}>
            {BLOCKERS.map((b, i) => (
              <Row key={i} tone="warn">
                <Cell>
                  <span className="text-ink">{b.q}</span>
                  <div className="text-[0.75rem] text-mute">{b.why}</div>
                </Cell>
                <Cell className="text-body">{b.blocks}</Cell>
                <Cell className="text-mute">{b.need}</Cell>
              </Row>
            ))}
          </Table>
        </Panel>
      </Section>
    </div>
  )
}

const BLOCKERS = [
  {
    q: "Jurnal penerimaan barang yang membersihkan BDP",
    why: "Juli: 147 dispatch, Rp470.488.453 didebit ke BDP, nol kredit — sementara penjualan mengkredit Persediaan.",
    blocks: "interunit_receipt, dan arti dari saldo Persediaan",
    need: "Satu jurnal penerimaan barang di sisi unit",
  },
  {
    q: "Apa yang memilih Pembiayaan versus Principal",
    why: "Keduanya dipakai di bulan yang sama, untuk hal yang berbeda, tanpa aturan tertulis.",
    blocks: "Resolver untuk penerimaan dana; sekarang wajib disebut di event",
    need: "Kebijakan tertulis, atau tiga contoh yang berbeda",
  },
  {
    q: "Jurnal HO pasangan bulan Juli",
    why: "Dua file 'BY HO' yang dikirim identik baris-per-baris dengan ekspor C006 — keduanya jurnal unit.",
    blocks: "Pemeriksaan dua sisi interunit",
    need: "Ekspor jurnal HEAD OFFICE Juli 2026",
  },
  {
    q: "Apakah reserve replacement OE dibentuk bulanan",
    why: "Akunnya ada untuk 36 kelas; Juli tidak memposting satu rupiah pun ke sana.",
    blocks: "oe_reserve_accrual — sengaja dimatikan",
    need: "Tarif dan basisnya, atau satu jurnal reserve yang nyata",
  },
  {
    q: "Kartu: bank dulu lalu reklas, atau clearing sejak checkout",
    why: "Praktik sekarang bank-dulu. Model clearing adalah perubahan kebijakan, bukan perbaikan bug.",
    blocks: "card_clearing_at_checkout — dimatikan sampai diputuskan",
    need: "Keputusan pemilik, bukan bukti",
  },
  {
    q: "AC C004: Rp26,39 juta atau Rp33,39 juta, C004 atau HO",
    why: "BKK, screenshot modul aset, dan MASTER ASSET.xls memberi tiga jawaban.",
    blocks: "Nilai perolehan dan unit satu aset",
    need: "Konfirmasi mana yang benar — tidak dipilih di sini",
  },
] as const

function Att({
  to,
  label,
  value,
  hint,
  tone,
}: {
  to: string
  label: string
  value: string
  hint: string
  tone: "ok" | "warn" | "bad"
}) {
  return (
    <AppLink
      to={to}
      className={cn(
        "block rounded-[0.8125rem] border px-3.5 py-3 transition-colors",
        tone === "ok" && "border-hairline bg-canvas hover:bg-soft-1",
        tone === "warn" && "border-warn-fg/25 bg-warn-bg/40 hover:bg-warn-bg/60",
        tone === "bad" && "border-bad-fg/25 bg-bad-bg/40 hover:bg-bad-bg/60"
      )}
    >
      <div className="text-eyebrow font-semibold text-mute uppercase">{label}</div>
      <div className="mt-1.5 text-[1.25rem] leading-none font-semibold text-ink tabular-nums">
        {value}
      </div>
      <p className="mt-1.5 text-[0.75rem] text-body">{hint}</p>
    </AppLink>
  )
}
