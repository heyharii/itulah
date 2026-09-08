import { Printer } from "lucide-react"
import { useState } from "react"

import { PageHeader } from "@/components/ui/page-header"
import { Tag } from "@/components/ui/tag"
import { cn } from "@/lib/utils"
import { useBook } from "@/screens/finance-lab/state"
import {
  Amount,
  Blocked,
  Cell,
  EntryView,
  Panel,
  Row,
  Section,
  SimBadge,
  Table,
  rp,
} from "@/screens/finance-lab/parts"
import type { Payment, PaymentStatus } from "@/screens/finance-lab/engine/types"

/// Cash & Bank — money leaving and arriving, by the action that caused it.
///
/// # Why there is no "Buat BKK" button
///
/// §7 is explicit and it is right: the document is what an action PRODUCES, it
/// is not the action. So the verbs on this screen are Bayar Pengadaan, Bayar
/// Tagihan, Terima Dana, Catat Pengeluaran, Setor Hasil Penjualan — and every
/// one of them still yields a numbered BKK or BKM with its counterparty,
/// account, allocation lines, approvals and journal reference, which is what
/// `Lihat/Cetak Bukti` shows.
///
/// A person who has used the client's old system will look for "Buat BKK" and
/// not find it. That is the change, and the document they were looking for is
/// on the right-hand side of every row.

const STATUS_TONE: Record<PaymentStatus, "neutral" | "info" | "warn" | "ok" | "bad"> = {
  REQUESTED: "neutral",
  APPROVED: "info",
  INSTRUCTED: "warn",
  SETTLED: "ok",
  FAILED: "bad",
  CANCELLED: "neutral",
  RECONCILED: "ok",
}

const STATUS_MEANS: Record<PaymentStatus, string> = {
  REQUESTED: "Diminta. Belum disetujui, belum ada instruksi ke bank.",
  APPROVED: "Disetujui. Uang belum bergerak dan belum ada jurnal.",
  INSTRUCTED: "Instruksi sudah dikirim ke bank. Masih belum ada jurnal.",
  SETTLED: "Dana benar-benar keluar. Ini satu-satunya status yang memposting.",
  FAILED: "Bank menolak. Bukan draft — kegagalan adalah hasil yang nyata.",
  CANCELLED: "Dibatalkan sebelum uang bergerak.",
  RECONCILED: "Sudah dicocokkan dengan rekening koran.",
}

const ACTION_LABEL: Record<string, string> = {
  PAY_PROCUREMENT: "Bayar Pengadaan",
  PAY_BILL: "Bayar Tagihan",
  PAY_OE_REPLACEMENT: "Bayar Penggantian OE",
  PAY_PAYROLL: "Bayar Tagihan (payroll)",
  RECEIVE_FUNDS: "Terima Dana",
  RECORD_EXPENSE: "Catat Pengeluaran",
  DEPOSIT_TAKINGS: "Setor Hasil Penjualan",
}

export function LabCashBank() {
  const b = useBook()
  const [open, setOpen] = useState<string | null>(b.payments.all()[0]?.payment_id ?? null)
  const payment = b.payments.all().find((p) => p.payment_id === open)

  const balances: [string, string, number][] = [
    ["Cash on Hand C006", "101100100106", b.ledger.balance("101100100106", { unit_id: "C006" })],
    ["Petty Cash C006", "101100100206", b.ledger.balance("101100100206", { unit_id: "C006" })],
    ["BCA Tabungan C006", "101100300106", b.ledger.balance("101100300106", { unit_id: "C006" })],
    ["BCA Tabungan C004", "101100300104", b.ledger.balance("101100300104", { unit_id: "C004" })],
  ]

  return (
    <div>
      <PageHeader
        crumb="Finance lab"
        title="Cash & Bank"
        sub="Tindakan bisnis di depan, dokumen di belakang. Satu payment bisa menjawab beberapa kewajiban sekaligus."
        actions={<SimBadge />}
      />

      <Section title="Tindakan" sub="Kata kerjanya adalah pekerjaannya. BKK/BKM tetap terbit, di belakang.">
        <div className="flex flex-wrap gap-2">
          {[
            "Bayar Pengadaan",
            "Bayar Tagihan",
            "Bayar Penggantian OE",
            "Terima Dana",
            "Catat Pengeluaran",
            "Setor Hasil Penjualan",
          ].map((v) => (
            <span
              key={v}
              className="rounded-lg border border-hairline bg-canvas px-2.5 py-1.5 text-[0.8125rem] font-medium text-ink shadow-soft"
            >
              {v}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[0.75rem] text-mute">
          Di prototype ini keenamnya dijalankan lewat Skenario A–H, yang memposting sungguhan ke buku
          simulasi. Yang ditampilkan di halaman ini adalah hasilnya.
        </p>
      </Section>

      <Section title="Saldo kas dan bank" sub="Dijumlah dari jurnal, tidak pernah disimpan.">
        <Panel>
          <Table head={["Rekening", "Kode", ">Saldo"]}>
            {balances.map(([name, code, bal]) => (
              <Row key={code}>
                <Cell>{name}</Cell>
                <Cell mono>{code}</Cell>
                <Cell right className={bal < 0 ? "font-semibold text-bad-fg" : undefined}>
                  <Amount minor={bal} />
                </Cell>
              </Row>
            ))}
          </Table>
        </Panel>
        <p className="mt-2 text-[0.75rem] text-mute">
          Saldo negatif di sini bukan bug: buku simulasi ini dimulai dari nol dan tidak memuat saldo
          awal, jadi setiap pembayaran mendorong rekeningnya ke bawah nol. Saldo awal adalah alur
          tersendiri dan belum ada di prototype ini.
        </p>
      </Section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Section title="Payment" sub="Termasuk yang belum keluar dari bank.">
          <Panel>
            <Table head={["Nomor", "Tindakan", "Status", ">Nilai"]}>
              {b.payments.all().map((p) => (
                <Row
                  key={p.payment_id}
                  className={cn(
                    "cursor-pointer hover:bg-soft-1",
                    open === p.payment_id && "bg-accent-bg"
                  )}
                >
                  <Cell mono onClick={() => setOpen(p.payment_id)}>
                    {p.payment_number}
                    <div className="font-sans text-[0.6875rem] text-faint">{p.dates.document_on}</div>
                  </Cell>
                  <Cell onClick={() => setOpen(p.payment_id)}>{ACTION_LABEL[p.action] ?? p.action}</Cell>
                  <Cell>
                    <Tag tone={STATUS_TONE[p.status]}>{p.status}</Tag>
                  </Cell>
                  <Cell right>
                    <Amount minor={p.total} />
                  </Cell>
                </Row>
              ))}
            </Table>
          </Panel>
        </Section>

        <div className="min-w-0">{payment && <PaymentDetail payment={payment} />}</div>
      </div>
    </div>
  )
}

export function PaymentDetail({ payment }: { payment: Payment }) {
  const b = useBook()
  const [said, setSaid] = useState<string | null>(null)
  const entry = payment.entry_id ? b.ledger.entry(payment.entry_id) : undefined
  return (
    <Section title={payment.payment_number} sub={ACTION_LABEL[payment.action] ?? payment.action}>
      <Panel className="mb-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-3.5 py-3 text-[0.8125rem]">
          <F label="Pihak lawan" v={payment.counterparty} />
          <F
            label="Sumber dana"
            v={
              payment.source.kind === "BANK"
                ? `Bank ${payment.source.bank_account_id}`
                : payment.source.kind === "PETTY_CASH"
                  ? "Petty cash"
                  : "Cash on hand"
            }
          />
          <F label="Tanggal dokumen" v={payment.dates.document_on} />
          <F label="Tanggal posting" v={payment.dates.posting_on} />
          <F label="Unit" v={payment.unit_id} />
          <F label="Total" v={rp(payment.total)} />
        </dl>
      </Panel>

      <div className="mb-3">
        <Tag tone={STATUS_TONE[payment.status]}>{payment.status}</Tag>
        <span className="ml-2 text-[0.8125rem] text-body">{STATUS_MEANS[payment.status]}</span>
      </div>

      <Section title="Alokasi" sub="Satu pembayaran, beberapa kewajiban, plus biaya langsung.">
        <Panel>
          <Table head={["Menjawab", "Jenis", ">Nilai"]}>
            {payment.allocations.map((a, i) => {
              const item =
                a.target.kind === "OPEN_ITEM" ? b.payments.item(a.target.item_id) : undefined
              return (
                <Row key={i}>
                  <Cell>
                    {a.target.kind === "OPEN_ITEM" ? (
                      <>
                        <span className="text-ink">{item?.description ?? a.target.item_id}</span>
                        <div className="font-mono text-[0.6875rem] text-faint">
                          {item?.source_ref}
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="text-ink">{a.target.description}</span>
                        <div className="font-mono text-[0.6875rem] text-faint">
                          {a.target.role}
                        </div>
                      </>
                    )}
                  </Cell>
                  <Cell>
                    <Tag tone={a.target.kind === "OPEN_ITEM" ? "info" : "neutral"}>
                      {a.target.kind === "OPEN_ITEM" ? "Kewajiban" : "Biaya langsung"}
                    </Tag>
                  </Cell>
                  <Cell right>
                    <Amount minor={a.amount} />
                  </Cell>
                </Row>
              )
            })}
            <Row className="border-t border-hairline font-semibold">
              <Cell colSpan={2}>Total</Cell>
              <Cell right>
                <Amount minor={payment.total} />
              </Cell>
            </Row>
          </Table>
        </Panel>
      </Section>

      <Section title="Riwayat">
        <ol className="space-y-1.5">
          {payment.history.map((h, i) => (
            <li key={i} className="flex items-baseline gap-2 text-[0.8125rem]">
              <span className="w-20 shrink-0 text-mute tabular-nums">{h.at}</span>
              <Tag tone={STATUS_TONE[h.status]}>{h.status}</Tag>
              <span className="text-body">{h.actor}</span>
              {h.note && <span className="text-mute">— {h.note}</span>}
            </li>
          ))}
        </ol>
      </Section>

      <Advance payment={payment} said={said} setSaid={setSaid} />

      {entry ? (
        <Section
          title="Bukti"
          right={
            <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-mute">
              <Printer className="size-3.5" />
              Nomor, tanggal, pihak lawan, rincian dan referensi jurnal tersimpan
            </span>
          }
        >
          <EntryView entry={entry} />
        </Section>
      ) : (
        <Blocked>
          Belum ada jurnal, karena uangnya belum keluar. Payment ini {payment.status.toLowerCase()};
          jurnal terbentuk saat statusnya SETTLED, bukan saat tombol Bayar ditekan.
        </Blocked>
      )}
    </Section>
  )
}

/// The lifecycle, as buttons that do what they say.
///
/// Which buttons appear comes from the engine's own transition table, not from
/// a list retyped here — a screen that offered "Settle" on a draft would be a
/// screen whose rules disagree with the ledger's.
function Advance({
  payment,
  said,
  setSaid,
}: {
  payment: Payment
  said: string | null
  setSaid: (s: string | null) => void
}) {
  const b = useBook()
  const next = NEXT_UI[payment.status]
  if (next.length === 0) {
    return (
      <div className="mb-4">
        {said && <p className="mb-1 text-[0.8125rem] font-medium text-ok-fg">{said}</p>}
        <p className="text-[0.8125rem] text-mute">
          {payment.status === "SETTLED"
            ? "Sudah settle. Yang tersisa hanyalah mencocokkannya dengan rekening koran."
            : "Tidak ada langkah berikutnya untuk status ini."}
        </p>
      </div>
    )
  }
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        {next.map((n) => (
          <button
            key={n.to}
            type="button"
            onClick={() => {
              const r = b.advancePayment(
                payment.payment_id,
                n.to,
                n.role === "FINANCE_MANAGER" ? "manager@lab" : "finance@lab",
                n.role,
                n.note
              )
              setSaid("error" in r ? `Ditolak: ${r.error}` : n.done)
            }}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[0.8125rem] font-semibold shadow-soft",
              n.primary
                ? "bg-accent text-white hover:brightness-95"
                : "border border-hairline bg-canvas text-ink hover:bg-soft-1"
            )}
          >
            {n.label}
          </button>
        ))}
        {said && <span className="text-[0.8125rem] text-body">{said}</span>}
      </div>
      <p className="mt-1.5 text-[0.75rem] text-mute">
        Menyetujui adalah tindakan finance manager, bukan penyiapnya. Menekan Settle langsung dari
        draft ditolak — dan jurnal baru muncul di langkah terakhir, bukan di langkah pertama.
      </p>
    </div>
  )
}

const NEXT_UI: Record<
  PaymentStatus,
  readonly {
    to: "APPROVED" | "INSTRUCTED" | "SETTLED" | "FAILED" | "CANCELLED"
    label: string
    role: "FINANCE" | "FINANCE_MANAGER"
    primary?: boolean
    note?: string
    done: string
  }[]
> = {
  REQUESTED: [
    { to: "APPROVED", label: "Setujui", role: "FINANCE_MANAGER", primary: true, done: "Disetujui. Uang belum bergerak." },
    { to: "SETTLED", label: "Coba settle langsung", role: "FINANCE", done: "Seharusnya ditolak." },
    { to: "CANCELLED", label: "Batalkan", role: "FINANCE", done: "Dibatalkan." },
  ],
  APPROVED: [
    { to: "INSTRUCTED", label: "Kirim instruksi ke bank", role: "FINANCE", primary: true, done: "Instruksi terkirim. Masih belum ada jurnal." },
    { to: "CANCELLED", label: "Batalkan", role: "FINANCE", done: "Dibatalkan." },
  ],
  INSTRUCTED: [
    { to: "SETTLED", label: "Bank mengonfirmasi", role: "FINANCE", primary: true, done: "Settle. Jurnal terbentuk sekarang." },
    { to: "FAILED", label: "Bank menolak", role: "FINANCE", note: "Saldo tidak cukup", done: "Gagal. Ini hasil yang nyata, bukan draft." },
  ],
  SETTLED: [],
  FAILED: [
    { to: "INSTRUCTED", label: "Kirim ulang instruksi", role: "FINANCE", primary: true, done: "Dikirim ulang." },
    { to: "CANCELLED", label: "Batalkan", role: "FINANCE", done: "Dibatalkan." },
  ],
  CANCELLED: [],
  RECONCILED: [],
}

function F({ label, v }: { label: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-eyebrow font-semibold text-mute uppercase">{label}</dt>
      <dd className="mt-0.5 text-ink">{v}</dd>
    </div>
  )
}
