import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Archive, FileText, Paperclip } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, LoadingState } from "@/components/ui/states"
import { Meter } from "@/components/ui/meter"
import { Pill } from "@/components/ui/pill"
import { count, day, money, span } from "@/lib/format"
import {
  archiveGaContract,
  gaContractHub,
  gaContractTypes,
  gaKeys,
  recordMeterReading,
} from "@/lib/queries/ga"
import { uploadDocument } from "@/lib/queries/workplace"
import { monthLabel, partyOf, siteOf } from "@/screens/contracts/format"
import { FinanceMark, StandingPill } from "@/screens/contracts/parts"
import type {
  GaContractHub,
  GaContractRow,
  GaDocument,
  GaMeterReading,
} from "@itulah/contract"

/// One contract, as GA keeps the deal — and the half that belongs to the
/// other desk is marked as the other desk's.
///
/// # Tabs, and why bills are not GA's tab to act on
///
/// Detail is GA's own fact. Tagihan and Tagihan rutin are Finance's answers
/// pointed back at this contract through `contract_id` — read here so the
/// person renewing the deal can see what it has been costing, and marked
/// Finance's because the ledger behind them is not this register's. Raising a
/// bill from here is tahap 6; until then this sheet reads Finance's figures
/// and acts on GA's half only.
///
/// # Pemakaian exists for one group
///
/// A meter is a Langganan fact: listrik, air, telepon. A rent contract has no
/// meter, so the tab is not drawn for it — a tab that always says "no
/// readings" is a tab asking to be ignored.
export function ContractHubSheet({
  contractId,
  open,
  onClose,
}: {
  contractId: string | undefined
  open: boolean
  onClose: () => void
}) {
  const hub = useQuery({
    queryKey: gaKeys.contract(contractId ?? ""),
    queryFn: ({ signal }) => gaContractHub(contractId ?? "", signal),
    enabled: open && contractId !== undefined,
  })

  // The archive is the sheet's one head action, and its form — reason and
  // all — lands in the footer, below every tab: a decision about the RECORD,
  // not about whichever tab happens to be open. The screen keys this sheet
  // per contract, so the question drops whenever another record opens.
  const [archiving, setArchiving] = useState(false)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      width="wide"
      title={hub.data === undefined ? "Kontrak" : partyOf(hub.data.contract)}
      id={
        hub.data === undefined
          ? undefined
          : (hub.data.contract.contract_number ?? hub.data.contract.contract_id)
      }
      caption={
        hub.data === undefined ? undefined : (
          <>
            {hub.data.contract.contract_type_name} · {siteOf(hub.data.contract)}
          </>
        )
      }
      subject={
        contractId === undefined
          ? undefined
          : { kind: "contract", id: contractId }
      }
      badge={
        hub.data === undefined ? undefined : (
          <>
            <StandingPill row={hub.data.contract} />
            {hub.data.contract.archived && <Pill tone="neutral">Arsip</Pill>}
          </>
        )
      }
      actions={
        hub.data === undefined || hub.data.contract.archived ? undefined : (
          <Button variant="soft" onClick={() => setArchiving(true)}>
            <Archive />
            Arsipkan
          </Button>
        )
      }
      footer={
        hub.data !== undefined && archiving ? (
          <ArchiveForm
            row={hub.data.contract}
            onDone={onClose}
            onCancel={() => setArchiving(false)}
          />
        ) : undefined
      }
      tabs={
        hub.data === undefined
          ? undefined
          : [
              {
                value: "detail",
                label: "Detail",
                content: <DetailTab hub={hub.data} />,
              },
              {
                value: "bills",
                label: "Tagihan (Finance)",
                content: (
                  <BillsTab row={hub.data.contract} bills={hub.data.bills} />
                ),
              },
              // Only the subscribers carry meters. The other fifteen types
              // would draw a tab with nothing to read.
              ...(hub.data.contract.group_code === "LANGGANAN"
                ? [
                    {
                      value: "usage",
                      label: "Pemakaian",
                      content: (
                        <UsageTab
                          contractId={hub.data.contract.contract_id}
                          readings={hub.data.meter_readings}
                        />
                      ),
                    },
                  ]
                : []),
              {
                value: "templates",
                label: "Tagihan rutin (Finance)",
                content: <TemplatesTab templates={hub.data.templates} />,
              },
              {
                value: "documents",
                label: "Dokumen",
                content: (
                  <DocumentsTab
                    row={hub.data.contract}
                    documents={hub.data.documents}
                  />
                ),
              },
            ]
      }
    >
      {hub.isLoading && <LoadingState>Membuka kontraknya…</LoadingState>}
      {hub.error instanceof Error && (
        <Banner tone="bad">{hub.error.message}</Banner>
      )}
    </Sheet>
  )
}

/// The deal's own facts, plus the one warning this register owes the reader:
/// when Finance's map has no expense account for this type, every bill under
/// the contract is a decision Finance has not made yet (brief §4.2).
function DetailTab({ hub }: { hub: GaContractHub }) {
  const contract = hub.contract

  // Resolved for the contract's own site; a scope contract (semua toko) is
  // read at the server's default, which is where Finance reads it too.
  const types = useQuery({
    queryKey: gaKeys.contractTypes(contract.site_id),
    queryFn: ({ signal }) => gaContractTypes(contract.site_id, signal),
    staleTime: 5 * 60 * 1000,
  })

  const type = types.data?.find((one) => one.code === contract.contract_type)

  return (
    <div className="flex flex-col gap-5">
      {type?.expense_account_code === null && (
        <MissingAccountBox
          contractType={contract.contract_type}
          prepaid={type.prepaid_account_code}
        />
      )}

      <section>
        <h4 className="mb-2.5 border-b border-hairline pb-1.5 text-card-title font-semibold text-ink">
          Detail kontrak
        </h4>
        <Facts>
          <Fact term="Pihak">
            {partyOf(contract)}
            {contract.counterparty_name !== null && (
              <span className="text-pill font-normal text-mute">
                {" "}
                · teks, bukan supplier
              </span>
            )}
          </Fact>
          <Fact term="Jenis">{contract.contract_type_name}</Fact>
          {contract.objek_name !== null && (
            <Fact term="Objek">{contract.objek_name}</Fact>
          )}
          <Fact term="Site / cakupan">{siteOf(contract)}</Fact>
          <Fact term="Periode">
            {span(contract.starts_on, contract.ends_on)}
          </Fact>
          {contract.customer_number !== null && (
            <Fact term="ID pelanggan">{contract.customer_number}</Fact>
          )}
          <Fact term="Ditandatangani">
            {contract.is_signed
              ? contract.signed_by === null
                ? "Ya"
                : `Ya · oleh ${contract.signed_by}`
              : "Belum"}
          </Fact>
          <Fact term="Nilai kontrak">
            {money(contract.contract_value_minor)}
            {contract.contract_value_minor === null && (
              <span className="text-pill font-normal text-mute">
                {" "}
                · tidak ada nilai kontrak
              </span>
            )}
          </Fact>
          <Fact term="Pengingat">
            {`${contract.reminder_days} hari sebelum habis`}
          </Fact>
          {contract.notes !== null && (
            <Fact term="Keterangan">{contract.notes}</Fact>
          )}
        </Facts>
      </section>
    </div>
  )
}

/// The account Finance would bill this contract's expense to does not exist —
/// either because the COA itself has no such account yet, or because the type
/// deliberately borrows its expense from somewhere else. Both are Finance's
/// decision to unblock; the box exists so a GA reader stops wondering why the
/// bills under this contract look odd.
function MissingAccountBox({
  contractType,
  prepaid,
}: {
  contractType: string
  prepaid: string | null
}) {
  let sentence: string
  if (contractType === "SEWA_KENDARAAN") {
    sentence = `Biaya Sewa Kendaraan belum ada di COA; tagihannya bisa dicatat ke akun bayar dimuka${prepaid === null ? "" : ` (${prepaid})`}, tapi pelepasannya tertahan. Keputusan Finance.`
  } else if (contractType === "JASA_MAINTENANCE") {
    sentence = `Beban kontrak maintenance mengikuti objek yang dirawat (repair_expense); pemetaannya dibuka bersama modul Perbaikan. Sementara itu tagihannya bisa dicatat ke akun bayar dimuka${prepaid === null ? "" : ` (${prepaid})`}.`
  } else {
    sentence =
      "Jenis kontrak ini belum punya akun beban di account map untuk site ini. Finance yang memetakannya; sampai itu, tagihan di bawah jenis ini tertahan di akun bayar dimuka."
  }
  return <Banner tone="warn">{sentence}</Banner>
}

/// The bills pointed at this contract: Finance's ledger, read.
///
/// The figures read zero today for a reason worth saying in the interface
/// itself: a bill line can only point at a contract from tahap 6, so an
/// honest zero beats a column pretending it is empty by accident.
function BillsTab({
  row,
  bills,
}: {
  row: GaContractRow
  bills: GaContractHub["bills"]
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <figure>
          <figcaption className="text-eyebrow font-medium text-body">
            {row.group_code === "DISEWAKAN"
              ? "Diterima s/d hari ini"
              : "Ditagih s/d hari ini"}{" "}
            <FinanceMark />
          </figcaption>
          <div className="mt-1 text-[1.125rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {money(row.billed_minor)}
          </div>
        </figure>
        <figure>
          <figcaption className="text-eyebrow font-medium text-body">
            {row.group_code === "DISEWAKAN" ? "Belum diterima" : "Sisa"}{" "}
            <FinanceMark />
          </figcaption>
          <div className="mt-1 text-[1.125rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {money(row.remaining_minor)}
            {row.remaining_minor === null && (
              <span className="text-pill font-normal text-mute">
                {" "}
                · tanpa nilai kontrak
              </span>
            )}
          </div>
        </figure>
      </div>

      {row.contract_value_minor !== null && row.contract_value_minor > 0 && (
        <Meter value={row.billed_minor / row.contract_value_minor} />
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[26rem]">
          <MiniTable
            head={[
              "Nomor",
              { label: "Tanggal", align: "left" },
              { label: "Jumlah", align: "right" },
              { label: "Akun", align: "left" },
            ]}
          >
            {bills.length === 0 ? (
              <MiniRow>
                <MiniCell colSpan={4}>
                  <span className="text-meta text-mute">
                    Belum ada tagihan yang menunjuk kontrak ini.
                  </span>
                </MiniCell>
              </MiniRow>
            ) : (
              bills.map((bill) => (
                <MiniRow key={bill.invoice_id}>
                  <MiniCell>
                    <span className="font-mono text-id">
                      {bill.invoice_number}
                    </span>
                  </MiniCell>
                  <MiniCell>{day(bill.invoice_date)}</MiniCell>
                  <MiniCell align="right" className="tabular-nums">
                    {money(bill.amount_minor)}
                  </MiniCell>
                  <MiniCell>
                    <span className="font-mono text-id">
                      {bill.account_code}
                    </span>
                  </MiniCell>
                </MiniRow>
              ))
            )}
          </MiniTable>
        </div>
      </div>

      <p className="text-pill text-mute">
        Dihitung dari baris tagihan POSTED yang menunjuk kontrak ini. Sampai
        tahap 6 tak ada baris tagihan yang bisa menunjuk, jadi angkanya membaca
        nol. Periode prepaid adalah periode tagihannya sendiri, bukan periode
        kontrak.
      </p>
    </div>
  )
}

/// Meter readings, one bar a month — GA's own record, so nothing here is
/// marked Finance's.
function UsageTab({
  contractId,
  readings,
}: {
  contractId: string
  readings: readonly GaMeterReading[]
}) {
  const [recording, setRecording] = useState(false)

  // Relative to the heaviest month, never absolute: 40.100 kWh and 105 m³
  // must read as the same shape of chart, and both must survive a month
  // where nothing was recorded without dividing by zero.
  const max = Math.max(1, ...readings.map((one) => one.usage))

  return (
    <div className="flex flex-col gap-4">
      {readings.length === 0 ? (
        <p className="text-meta text-body">
          Belum ada bacaan. Angka meter dicatat GA sekali sebulan, dari angka
          awal ke angka akhir; selisihnya adalah pemakaiannya.
        </p>
      ) : (
        <div>
          <div className="text-eyebrow font-medium text-body">
            Pemakaian per bulan · {readings[readings.length - 1].unit}
          </div>
          <div className="mt-3 flex items-end gap-3">
            {readings.map((one) => (
              <div
                key={one.reading_id}
                className="flex w-[2.5rem] flex-col items-center gap-1"
              >
                <span className="text-pill text-mute tabular-nums">
                  {abbr(one.usage)}
                </span>
                <span
                  className="w-full rounded-t-inner bg-accent"
                  style={{
                    height: Math.max(2, Math.round((one.usage / max) * 64)),
                  }}
                />
                <span className="text-pill text-mute">
                  {monthLabel(one.period).split(" ")[0]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-pill text-mute">
        Angka meter dicatat GA per bulan; nominal tagihannya dibaca dari
        Finance. Merekam bulan yang sudah ada mengganti angkanya, bukan menambah
        baris.
      </p>

      {recording ? (
        <ReadingForm
          contractId={contractId}
          readings={readings}
          onDone={() => setRecording(false)}
          onCancel={() => setRecording(false)}
        />
      ) : (
        <div>
          <Button variant="soft" onClick={() => setRecording(true)}>
            Catat bacaan
          </Button>
        </div>
      )}
    </div>
  )
}

/// Thousands, said the way the prototype's usage strip says them: 40100
/// above a bar is "40,1rb", because a nine-character figure over a 64px bar
/// is wider than the bar. Names the abbreviation rule the JSX would not.
function abbr(value: number): string {
  return value >= 1000
    ? `${(value / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}rb`
    : count(value)
}

/// One reading: the month, the unit, awal → akhir, and when it was read.
///
/// Errors only ever name the field that is wrong, appear on the submit that
/// finds the problem and disappear the moment that field is edited again —
/// brief §10.2's rule, kept by clearing per field on change.
function ReadingForm({
  contractId,
  readings,
  onDone,
  onCancel,
}: {
  contractId: string
  readings: readonly GaMeterReading[]
  onDone: () => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const last = readings[readings.length - 1]
  const [form, setForm] = useState<Record<string, string>>({
    unit: last?.unit ?? "",
    read_on: new Date().toISOString().slice(0, 10),
  })
  const [problems, setProblems] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    // Editing a field is the reader taking the error back; keep the sentence
    // only while the field itself stays wrong.
    setProblems((current) => ({ ...current, [key]: "" }))
    setForm((current) => ({ ...current, [key]: value }))
  }

  const save = useMutation({
    mutationFn: () =>
      recordMeterReading(contractId, {
        period: `${form.period ?? ""}-01`,
        unit: (form.unit ?? "").trim(),
        opening: Number(form.opening),
        closing: Number(form.closing),
        read_on: form.read_on ?? "",
      }),
    onSuccess: () => {
      // The reading changes the contract's hub and the register's usage
      // column; both live under the GA prefix.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      onDone()
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if ((form.period ?? "") === "") next.period = "Isi bulan bacaannya."
    if ((form.unit ?? "").trim() === "") next.unit = "Isi satuannya."
    if ((form.opening ?? "") === "") next.opening = "Isi angka awalnya."
    if ((form.closing ?? "") === "") next.closing = "Isi angka akhirnya."
    if (
      (form.opening ?? "") !== "" &&
      (form.closing ?? "") !== "" &&
      Number(form.closing) < Number(form.opening)
    ) {
      next.closing = "Angka akhir tidak boleh di bawah angka awal."
    }
    if (Object.keys(next).length > 0) {
      setProblems(next)
      return
    }
    save.mutate()
  }

  return (
    <div className="rounded-inner border border-hairline-2 p-3.5">
      {save.error instanceof Error && (
        <Banner tone="bad">{save.error.message}</Banner>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Bulan bacaan"
          aside={
            last === undefined
              ? undefined
              : `terakhir ${monthLabel(last.period)}`
          }
          problem={problems.period || undefined}
        >
          <Input
            type="month"
            value={form.period ?? ""}
            onChange={(event) => set("period", event.target.value)}
          />
        </Field>
        <Field label="Satuan" problem={problems.unit || undefined}>
          <Input
            value={form.unit ?? ""}
            onChange={(event) => set("unit", event.target.value)}
            placeholder="kWh / m³"
          />
        </Field>
        <Field label="Angka awal" problem={problems.opening || undefined}>
          <Input
            inputMode="numeric"
            value={form.opening ?? ""}
            onChange={(event) => set("opening", event.target.value)}
            placeholder={last === undefined ? "0" : String(last.closing)}
          />
        </Field>
        <Field label="Angka akhir" problem={problems.closing || undefined}>
          <Input
            inputMode="numeric"
            value={form.closing ?? ""}
            onChange={(event) => set("closing", event.target.value)}
          />
        </Field>
        <Field label="Tanggal baca">
          <Input
            type="date"
            value={form.read_on ?? ""}
            onChange={(event) => set("read_on", event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" disabled={save.isPending} onClick={submit}>
          {save.isPending ? "Menyimpan…" : "Simpan bacaan"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </div>
  )
}

/// The recurring templates raised under this contract — Finance's, read only.
///
/// A template is how the bills HAPPEN: Finance names the amount and the day,
/// and this register only gets to see which template points here. A GA screen
/// that could edit one would be editing Finance's billing run from the wrong
/// side of the fence.
function TemplatesTab({
  templates,
}: {
  templates: GaContractHub["templates"]
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <div className="min-w-[34rem]">
          <MiniTable
            head={[
              "Label",
              { label: "Estimasi", align: "right" },
              { label: "Toleransi", align: "right" },
              { label: "Datang tgl", align: "right" },
              { label: "Status", align: "left" },
            ]}
          >
            {templates.length === 0 ? (
              <MiniRow>
                <MiniCell colSpan={5}>
                  <span className="text-meta text-mute">
                    Belum ada tagihan rutin yang menunjuk kontrak ini. Template
                    dibuat Finance di Tagihan rutin.
                  </span>
                </MiniCell>
              </MiniRow>
            ) : (
              templates.map((template) => (
                <MiniRow key={template.template_id}>
                  <MiniCell>{template.label}</MiniCell>
                  <MiniCell align="right" className="tabular-nums">
                    {money(template.expected_subtotal_minor)}
                  </MiniCell>
                  <MiniCell align="right" className="tabular-nums">
                    {template.tolerance_bps / 100}%
                  </MiniCell>
                  <MiniCell align="right" className="tabular-nums">
                    {template.due_day}
                  </MiniCell>
                  <MiniCell>
                    <Pill tone={template.active ? "ok" : "neutral"}>
                      {template.active ? "Aktif" : "Nonaktif"}
                    </Pill>
                  </MiniCell>
                </MiniRow>
              ))
            )}
          </MiniTable>
        </div>
      </div>
      <p className="text-pill text-mute">
        <FinanceMark className="mr-1 align-[0.0625rem]" /> Nominal per bulan
        milik tagihan rutin (Finance); kontrak menyimpan nilai total yang
        disepakati, bukan angka bulanannya.
      </p>
    </div>
  )
}

/// The papers with a date on them, filed from the record they belong to.
///
/// The same door the asset hub opens onto the Library: the person holding the
/// paper is standing at this contract, and a door here still lands in the
/// Library like every other document — linked, not copied.
function DocumentsTab({
  row,
  documents,
}: {
  row: GaContractRow
  documents: readonly GaDocument[]
}) {
  const client = useQueryClient()
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      {documents.length === 0 ? (
        <p className="text-meta text-body">
          Belum ada dokumen. Perjanjian yang ditandatangani, lampiran amenemen,
          surat pemberitahuan — ditempel di sini dan terindeks di Library.
        </p>
      ) : (
        <ul className="flex flex-col">
          {documents.map((document) => (
            <li
              key={document.document_id}
              className="flex items-center gap-3 border-b border-hairline py-2.5 last:border-b-0"
            >
              <FileText className="size-4 shrink-0 stroke-[1.7] text-line-ico" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-cell text-ink">
                  {document.doc_type ?? document.title ?? document.name}
                </span>
                <span className="block truncate font-mono text-pill text-mute">
                  {document.doc_number ?? document.name}
                </span>
              </span>
              <span className="shrink-0 text-pill text-mute tabular-nums">
                {document.expires_on === null
                  ? "tanpa masa berlaku"
                  : `s/d ${day(document.expires_on)}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <AttachForm
          row={row}
          onDone={() => {
            setAdding(false)
            void client.invalidateQueries({ queryKey: gaKeys.all })
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div>
          <Button variant="soft" onClick={() => setAdding(true)}>
            <Paperclip />
            Tempel dokumen
          </Button>
        </div>
      )}
    </div>
  )
}

/// The form's empty string, as the wire spells "not given". Five fields read
/// it, so they stay honest about absence in one place rather than five ways.
function blank(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}

/// Filing one paper against this contract — the Library's two-step: bytes
/// first, document row second, so a slow photograph never blocks the form.
function AttachForm({
  row,
  onDone,
  onCancel,
}: {
  row: GaContractRow
  onDone: () => void
  onCancel: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  const save = useMutation({
    mutationFn: () => {
      if (file === null) throw new Error("Pilih berkasnya dulu.")
      return uploadDocument(file, {
        title: blank(form.title) ?? undefined,
        doc_type: blank(form.doc_type) ?? undefined,
        doc_number: blank(form.doc_number) ?? undefined,
        issuer: blank(form.issuer) ?? undefined,
        issued_on: blank(form.issued_on) ?? undefined,
        expires_on: blank(form.expires_on) ?? undefined,
        path_tokens: ["GA", row.contract_number ?? row.contract_id],
        tags: [],
        links: [{ subject_kind: "contract", subject_id: row.contract_id }],
      })
    },
    onSuccess: onDone,
  })

  return (
    <div className="rounded-inner border border-hairline-2 p-3.5">
      {save.error instanceof Error && (
        <Banner tone="bad">{save.error.message}</Banner>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Berkasnya">
          <Input
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
        <Field label="Jenis kertas" aside="perjanjian, amenemen, surat">
          <Input
            value={form.doc_type ?? ""}
            onChange={(event) => set("doc_type", event.target.value)}
          />
        </Field>
        <Field label="Nomor">
          <Input
            value={form.doc_number ?? ""}
            onChange={(event) => set("doc_number", event.target.value)}
          />
        </Field>
        <Field label="Yang menerbitkan">
          <Input
            value={form.issuer ?? ""}
            onChange={(event) => set("issuer", event.target.value)}
          />
        </Field>
        <Field label="Diterbitkan">
          <Input
            type="date"
            value={form.issued_on ?? ""}
            onChange={(event) => set("issued_on", event.target.value)}
          />
        </Field>
        <Field label="Berlaku sampai" aside="kosong = tanpa masa berlaku">
          <Input
            type="date"
            value={form.expires_on ?? ""}
            onChange={(event) => set("expires_on", event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="primary"
          disabled={file === null || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Mengunggah…" : "Simpan dokumen"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </div>
  )
}

/// Archiving — the register's only exit, and a reasoned one.
///
/// There is no delete on this register (brief §12): a contract a bill has
/// pointed at must stay answerable. The reason is the server's requirement
/// and the form's: a deal that leaves the living list without a recorded why
/// is a question six months later that nobody can answer.
function ArchiveForm({
  row,
  onDone,
  onCancel,
}: {
  row: GaContractRow
  onDone: () => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [problem, setProblem] = useState("")

  const archive = useMutation({
    mutationFn: () =>
      archiveGaContract(row.contract_id, { archived: true, reason }),
    onSuccess: () => {
      // The register's lists and the overview both count this contract; the
      // whole GA namespace drops together, as every GA write does here.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      onDone()
    },
  })

  const submit = () => {
    if (reason.trim() === "") {
      setProblem("Tulis alasannya dulu.")
      return
    }
    archive.mutate()
  }

  return (
    <div className="flex items-end gap-3">
      <Field
        label={`Arsipkan ${row.contract_number ?? row.contract_id}`}
        problem={problem || undefined}
        className="flex-1"
      >
        <Input
          value={reason}
          onChange={(event) => {
            setProblem("")
            setReason(event.target.value)
          }}
          placeholder="mis. Perjanjian berakhir, diperbarui lewat kontrak baru"
          onKeyDown={(event) => {
            if (event.key === "Enter") submit()
          }}
        />
      </Field>
      <Button variant="primary" disabled={archive.isPending} onClick={submit}>
        {archive.isPending ? "Mengarsipkan…" : "Arsipkan"}
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Batal
      </Button>
    </div>
  )
}
