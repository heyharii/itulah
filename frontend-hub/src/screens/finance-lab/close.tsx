import { Lock, Unlock } from "lucide-react"
import { useState } from "react"

import { PageHeader } from "@/components/ui/page-header"
import { Tag } from "@/components/ui/tag"
import { cn } from "@/lib/utils"
import { useBook } from "@/screens/finance-lab/state"
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
} from "@/screens/finance-lab/parts"

/// Accounting & Close — the journal, the trial balance, and the lock.
///
/// # Why the trial balance is on the same screen as the periods
///
/// Because "may this month close" is answered by looking at them together. A
/// period that closes without the books balancing is a period whose close
/// asserted only that somebody pressed a button, and the plan is explicit that
/// the lock, the audit and the trial balance arrive together with posting
/// rather than in a later release.
export function LabClose() {
  const b = useBook()
  const [openEntry, setOpenEntry] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)

  const tb = b.ledger.trialBalance({ book_id: "CFS" })
  const entries = b.ledger.allEntries()
  const periods = b.ledger.allPeriods()
  const shown = openEntry ? b.ledger.entry(openEntry) : undefined

  return (
    <div>
      <PageHeader
        crumb="Finance lab"
        title="Accounting & Close"
        sub="Buku simulasi:
        setiap entri lewat satu pintu, seimbang per buku, dan tidak bisa masuk bulan yang terkunci."
        actions={<SimBadge />}
      />

      <Section title="Periode" sub="Menutup bulan menolak posting berikutnya — dicoba di skenario G.">
        <Panel>
          <Table head={["Periode", "Buku", "Status", ">Entri", "Ditutup oleh", ""]}>
            {periods.map((p) => {
              const n = entries.filter((e) => e.dates.period === p.period).length
              return (
                <Row key={`${p.book_id}/${p.period}`}>
                  <Cell mono>{p.period}</Cell>
                  <Cell>{p.book_id}</Cell>
                  <Cell>
                    <Tag tone={p.status === "CLOSED" ? "bad" : "ok"}>{p.status}</Tag>
                  </Cell>
                  <Cell right>{n}</Cell>
                  <Cell className="text-mute">{p.closed_by ?? "—"}</Cell>
                  <Cell>
                    <button
                      type="button"
                      onClick={() => b.setPeriod(p.period, p.status !== "CLOSED")}
                      className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-2 py-1 text-[0.75rem] font-medium text-ink hover:bg-soft-1"
                    >
                      {p.status === "CLOSED" ? (
                        <>
                          <Unlock className="size-3" /> Buka
                        </>
                      ) : (
                        <>
                          <Lock className="size-3" /> Tutup
                        </>
                      )}
                    </button>
                  </Cell>
                </Row>
              )
            })}
          </Table>
        </Panel>
        <p className="mt-2 text-[0.75rem] text-mute">
          Juni sengaja ditutup pada saat buku ini dibentuk. Itulah sebabnya uang muka AC bulan Juni
          gagal diposting dan aset itu muncul di Assets dengan harga perolehan yang belum penuh masuk
          buku.
        </p>
      </Section>

      <Section
        title="Trial balance"
        sub="Dijumlah dari jurnal setiap kali dibaca. Tidak ada saldo yang disimpan."
        right={
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-[0.75rem] font-semibold",
              tb.balanced ? "bg-ok-bg text-ok-fg" : "bg-bad-bg text-bad-fg"
            )}
          >
            {tb.balanced ? "Seimbang" : "TIDAK SEIMBANG"}
          </span>
        }
      >
        <Panel>
          <Table head={["Akun", "Kode", "Unit", ">Debit", ">Kredit"]}>
            {tb.rows.map((r) => (
              <Row key={`${r.code}/${r.unit}`}>
                <Cell>{r.name}</Cell>
                <Cell mono>{r.code}</Cell>
                <Cell>{r.unit}</Cell>
                <Cell right>
                  <Amount minor={r.debit} muted />
                </Cell>
                <Cell right>
                  <Amount minor={r.credit} muted />
                </Cell>
              </Row>
            ))}
            <Row className="border-t border-hairline font-semibold">
              <Cell colSpan={3}>{tb.rows.length} akun</Cell>
              <Cell right>
                <Amount minor={tb.total_debit} />
              </Cell>
              <Cell right>
                <Amount minor={tb.total_credit} />
              </Cell>
            </Row>
          </Table>
        </Panel>
      </Section>

      <Section title="Jurnal" sub={`${entries.length} entri, semuanya dibentuk oleh aturan bernama versi.`}>
        <Panel>
          <Table head={["Nomor", "Tanggal", "Sumber", "Dokumen", "Aturan", ">Total", ""]}>
            {entries.map((e) => (
              <Row
                key={e.entry_id}
                className={cn("cursor-pointer hover:bg-soft-1", openEntry === e.entry_id && "bg-accent-bg")}
              >
                <Cell mono onClick={() => setOpenEntry(e.entry_id)}>
                  {e.entry_number}
                </Cell>
                <Cell onClick={() => setOpenEntry(e.entry_id)}>{e.dates.posting_on}</Cell>
                <Cell>
                  <Tag tone="accent">{e.source_kind}</Tag>
                </Cell>
                <Cell mono>{e.document_ref}</Cell>
                <Cell mono className="text-mute">
                  {e.rule_version}
                </Cell>
                <Cell right>
                  <Amount minor={e.total} />
                </Cell>
                <Cell className="w-8">
                  <CheckMark
                    pass={
                      e.lines.reduce((n, l) => n + l.debit, 0) ===
                      e.lines.reduce((n, l) => n + l.credit, 0)
                    }
                  />
                </Cell>
              </Row>
            ))}
          </Table>
        </Panel>
      </Section>

      {shown && (
        <Section
          title={`Entri ${shown.entry_number}`}
          right={
            shown.source_kind === "REVERSAL" ||
            b.ledger.allEntries().some((e) => e.reverses === shown.entry_id) ? (
              <span className="text-[0.75rem] text-mute">
                {shown.source_kind === "REVERSAL" ? "Ini entri pembalik" : "Sudah dibalik"}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const r = b.reverseEntry(shown.entry_id, "2026-09-09", "koreksi dari layar")
                  setSaid(
                    r.ok
                      ? `Dibalik oleh ${r.entry.entry_number}, memakai akun entri asli.`
                      : `Ditolak: ${r.message}`
                  )
                }}
                className="rounded-lg border border-hairline bg-canvas px-2.5 py-1 text-[0.75rem] font-semibold text-ink shadow-soft hover:bg-soft-1"
              >
                Balikkan
              </button>
            )
          }
        >
          {said && <p className="mb-2 text-[0.8125rem] text-body">{said}</p>}
          <EntryView entry={shown} />
          <p className="mt-2 text-[0.75rem] text-mute">
            Pembalikan memakai kode akun entri asli, bukan hasil resolver hari ini. Kalau binding
            sudah pindah, entri pembalik tetap menyentuh akun yang sama — dibuktikan di skenario H.
          </p>
        </Section>
      )}

      <Section title="Yang gagal saat buku ini dibentuk" sub="Ditampilkan, tidak disembunyikan.">
        {b.log.filter((f) => !f.outcome.ok).length === 0 ? (
          <Panel>
            <p className="px-3.5 py-3 text-[0.8125rem] text-mute">Tidak ada.</p>
          </Panel>
        ) : (
          <div className="space-y-2">
            {b.log
              .filter((f) => !f.outcome.ok)
              .map((f, i) => {
                const o = f.outcome as { ok: false; code: string; message: string }
                return (
                  <Blocked key={i}>
                    <span className="font-semibold">{f.label}</span> —{" "}
                    <span className="font-mono text-[0.75rem]">{o.code}</span> {o.message}
                  </Blocked>
                )
              })}
          </div>
        )}
      </Section>
    </div>
  )
}
