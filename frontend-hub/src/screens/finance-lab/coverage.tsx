import { PageHeader } from "@/components/ui/page-header"
import { Tag } from "@/components/ui/tag"
import { AppLink } from "@/components/ui/app-link"
import { Cell, Panel, Row, Section, SimBadge, Table } from "@/screens/finance-lab/parts"

/// What the fourteen Finance menus cover, honestly, across three places.
///
/// # Why this screen exists at all
///
/// §8 says the menus outside the five priority flows may show a summary or say
/// they are not available, and must not show fake active buttons. The honest
/// version of that is not fourteen empty screens with "coming soon" — it is one
/// table saying, for each menu, where the work actually is.
///
/// And in this repository the answer to "where is it" has three columns rather
/// than one, because there are three places a Finance capability can live:
///
///   * **Lab** — proved here, over the client's own fixtures, as a contract.
///   * **Produksi** — merged and running against Postgres on this branch.
///   * **Lane** — written and unmerged on `feat/finance-control` /
///     `feat/finance-control-ui`.
///
/// Collapsing those three into "done / not done" is what would make this table
/// a lie. A menu can be fully built on a sibling branch and completely absent
/// from the running system, and somebody planning the next fortnight needs to
/// see both facts at once.
type State = "FULL" | "PARTIAL" | "NONE"

interface MenuRow {
  readonly menu: string
  readonly lab: State
  readonly prod: State
  readonly lane: State
  readonly note: string
  readonly link?: string
}

const S: Record<State, { label: string; tone: "ok" | "warn" | "neutral" }> = {
  FULL: { label: "ada", tone: "ok" },
  PARTIAL: { label: "sebagian", tone: "warn" },
  NONE: { label: "tidak ada", tone: "neutral" },
}

const MENUS: readonly MenuRow[] = [
  {
    menu: "Overview",
    lab: "FULL",
    prod: "FULL",
    lane: "FULL",
    link: "/finance-lab",
    note: "Lab memimpin dengan yang masih terbuka, bukan dengan kartu statistik. Lane menambahkan attention engine (migrasi 0124).",
  },
  {
    menu: "Cash & Bank",
    lab: "FULL",
    prod: "PARTIAL",
    lane: "FULL",
    link: "/finance-lab/cash",
    note: "Produksi punya import & pencocokan rekening koran, belum punya dokumen kas. Lane punya cash_document (0115), giro (0117), petty cash toko (0114).",
  },
  {
    menu: "Receivables",
    lab: "PARTIAL",
    prod: "NONE",
    lane: "FULL",
    note: "Lab hanya piutang kartu (reklas + settlement). Lane punya acquirer.rs dan 0135. Piutang pelanggan umum tidak ada di mana pun — klien tidak menjual kredit.",
  },
  {
    menu: "Payables",
    lab: "PARTIAL",
    prod: "FULL",
    lane: "FULL",
    note: "Produksi sudah punya supplier bill + payment + ageing. Lab hanya memodelkan blokir akun hutang supplier di unit toko, karena itu yang jadi temuan.",
  },
  {
    menu: "Accruals / YMHD",
    lab: "FULL",
    prod: "NONE",
    lane: "FULL",
    link: "/finance-lab/accruals",
    note: "Lab membuktikan alokasi satu payment ke dua akrual plus biaya langsung. Produksi belum punya open item generik.",
  },
  {
    menu: "Prepaids & Advances",
    lab: "PARTIAL",
    prod: "NONE",
    lane: "PARTIAL",
    note: "Lab menjalankan pelepasan sewa dibayar dimuka satu bulan (aturan prepaid_release, bukti C006-GL-26-07-00001). Jadwal amortisasi penuh belum dibangun di mana pun.",
  },
  {
    menu: "Interunit & Principal",
    lab: "FULL",
    prod: "NONE",
    lane: "FULL",
    link: "/finance-lab/interunit",
    note: "Lab memisahkan tiga keluarga afiliasi dan menunjukkan BDP yang tidak pernah tertutup. Lane punya interunit.rs + 0120/0122.",
  },
  {
    menu: "Inventory Valuation",
    lab: "NONE",
    prod: "NONE",
    lane: "FULL",
    note: "Lane punya stock_ledger.rs, cost layer FIFO (0146), pergerakan berbiaya (0147). Lab sengaja tidak menyentuhnya: aturan penerimaan barang belum punya bukti.",
  },
  {
    menu: "Revenue & Margin",
    lab: "PARTIAL",
    prod: "NONE",
    lane: "FULL",
    note: "Lab memposting penjualan (HPP sekali, tender campuran) tapi tidak melaporkan margin. Lane punya sales_posting.rs (1.617 baris).",
  },
  {
    menu: "Assets & Projects",
    lab: "FULL",
    prod: "FULL",
    lane: "FULL",
    link: "/finance-lab/assets",
    note: "Register, penilaian, penyusutan, pelepasan dan mutasi sudah ada di produksi. Lab menambahkan konvensi bulan pertama, truncation, biaya majemuk, dan rekonsiliasi. Projects (668 baris 'Contract In Progress' di register klien) belum ada di mana pun.",
  },
  {
    menu: "Tax",
    lab: "NONE",
    prod: "PARTIAL",
    lane: "PARTIAL",
    note: "Ada backend/src/tax.rs untuk PPN di titik jual. PPh 25, PPh 21 dan withholding pembayaran tidak ada. C006 Juli hanya menyentuh 201210100506 PPH Pasal 25 OP sekali.",
  },
  {
    menu: "Financing & Equity",
    lab: "NONE",
    prod: "NONE",
    lane: "NONE",
    note: "Semantic key pinjaman dan bunga sudah dideklarasikan di ledger.rs, tidak ada aturan yang memakainya. Di luar lima alur prioritas §8.",
  },
  {
    menu: "Accounting & Close",
    lab: "FULL",
    prod: "PARTIAL",
    lane: "FULL",
    link: "/finance-lab/close",
    note: "Produksi menutup bulan dengan membalik status. Lane punya checklist berkriteria (period_close.rs, 0126/0127) dan sepuluh persamaan integritas (integrity.rs).",
  },
  {
    menu: "Reports",
    lab: "PARTIAL",
    prod: "FULL",
    lane: "FULL",
    note: "Produksi punya statement, balances, trial balance dan saved reports. Lab hanya trial balance, karena itu yang dibutuhkan untuk membuktikan posting.",
  },
]

export function LabCoverage() {
  const count = (k: keyof MenuRow, v: State) => MENUS.filter((m) => m[k] === v).length
  return (
    <div>
      <PageHeader
        crumb="Finance lab"
        title="Cakupan menu"
        sub="Empat belas menu Finance, dan di mana pekerjaannya benar-benar berada. Tidak ada tombol aktif palsu di modul ini."
        actions={<SimBadge />}
      />

      <Section
        title="Ringkasan"
        sub="Tiga tempat, dan sebuah menu bisa lengkap di satu tempat dan tidak ada di tempat lain."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Box
            title="Lab (di sini)"
            full={count("lab", "FULL")}
            partial={count("lab", "PARTIAL")}
            none={count("lab", "NONE")}
            hint="Terbukti terhadap fixture jurnal klien, sebagai kontrak. Bukan buku produksi."
          />
          <Box
            title="Produksi (branch ini)"
            full={count("prod", "FULL")}
            partial={count("prod", "PARTIAL")}
            none={count("prod", "NONE")}
            hint="Berjalan di Postgres hari ini: ledger, jurnal, aset, payables, bank."
          />
          <Box
            title="Lane finance (belum merge)"
            full={count("lane", "FULL")}
            partial={count("lane", "PARTIAL")}
            none={count("lane", "NONE")}
            hint="feat/finance-control dan feat/finance-control-ui: 49 migrasi, 22 modul, 14 layar."
          />
        </div>
      </Section>

      <Section title="Per menu">
        <Panel>
          <Table head={["Menu", "Lab", "Produksi", "Lane", "Keadaan sebenarnya"]}>
            {MENUS.map((m) => (
              <Row key={m.menu}>
                <Cell>
                  {m.link ? (
                    <AppLink to={m.link} className="font-medium text-accent hover:underline">
                      {m.menu}
                    </AppLink>
                  ) : (
                    <span className="text-ink">{m.menu}</span>
                  )}
                </Cell>
                <Cell>
                  <Tag tone={S[m.lab].tone}>{S[m.lab].label}</Tag>
                </Cell>
                <Cell>
                  <Tag tone={S[m.prod].tone}>{S[m.prod].label}</Tag>
                </Cell>
                <Cell>
                  <Tag tone={S[m.lane].tone}>{S[m.lane].label}</Tag>
                </Cell>
                <Cell className="text-mute">{m.note}</Cell>
              </Row>
            ))}
          </Table>
        </Panel>
      </Section>

      <Section title="Yang seharusnya dibaca dari tabel ini">
        <ul className="space-y-2 text-[0.8125rem] text-body">
          <li className="flex gap-2">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-mute" />
            Kolom Lane hampir penuh. Sebagian besar yang diminta rencana ini{" "}
            <span className="font-semibold text-ink">sudah ditulis</span>, di dua branch yang belum
            digabung. Yang dibutuhkan berikutnya adalah rencana merge, bukan implementasi kedua.
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-mute" />
            Nomor migrasi <span className="font-mono text-[0.75rem]">0106</span> dipakai dua kali
            dengan isi berbeda di kedua branch. Itu harus diselesaikan sebelum apa pun digabung.
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-mute" />
            Inventory Valuation adalah satu-satunya baris yang Lab sengaja kosongkan. Bukan karena
            sulit — karena aturan yang memindahkan BDP ke Persediaan belum punya bukti, dan menilai
            persediaan di atas aturan yang ditebak menghasilkan margin yang salah tanpa ada yang bisa
            menyebutkan sebabnya.
          </li>
        </ul>
      </Section>
    </div>
  )
}

function Box({
  title,
  full,
  partial,
  none,
  hint,
}: {
  title: string
  full: number
  partial: number
  none: number
  hint: string
}) {
  return (
    <div className="rounded-[0.8125rem] border border-hairline bg-canvas px-3.5 py-3 shadow-soft">
      <div className="text-eyebrow font-semibold text-mute uppercase">{title}</div>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-[1.25rem] leading-none font-semibold text-ok-fg tabular-nums">
          {full}
        </span>
        <span className="text-[1rem] leading-none font-semibold text-warn-fg tabular-nums">
          {partial}
        </span>
        <span className="text-[1rem] leading-none font-semibold text-faint tabular-nums">{none}</span>
        <span className="text-[0.6875rem] text-mute">ada / sebagian / tidak</span>
      </div>
      <p className="mt-2 text-[0.75rem] text-body">{hint}</p>
    </div>
  )
}
