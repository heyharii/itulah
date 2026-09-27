import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Pill } from "@/components/ui/pill"
import { KeyValue, MiniRow, MiniTable } from "@/components/ui/rows"
import { ScanField } from "@/components/ui/scan-field"
import { ActionBar, Screen, Section } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import { confirm } from "@/lib/confirm"
import { dc } from "@/lib/api"
import { useDraft } from "@/lib/draft"
import { readScan } from "@/lib/epc"
import { describe } from "@/lib/errors"
import { count, label, signed, toneFor } from "@/lib/format"
import { enqueue, pendingOf, useOutbox } from "@/lib/outbox"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { keys, reads } from "@/lib/queries"
import { useActor } from "@/lib/session"
import { idempotencyKey } from "@itulah/contract/client"

/// The count sheet: every tag actually found in the pool.
///
/// **Only a tag will do here.** A hang tag's barcode names the *product* — this
/// shop has forty of that shirt and the barcode says nothing about which one is
/// on the shelf — and an official count is a statement about pieces. The node's
/// entry carries an EPC for exactly that reason, so a barcode scan is refused
/// with the reason rather than quietly counted as a piece.
///
/// Scanning the same tag twice is one garment, so the walk is a **set**, not a
/// tally. That is the difference between this station and picking: a picker
/// taking two of a SKU means two; a counter passing the same rail twice means
/// one.
///
/// Sending the sheet is outbox work — the walking is the irreplaceable part.
/// **Submitting the count is not**: it closes the walk and hands the difference
/// to whoever approves adjustments, and that is a decision somebody makes once,
/// looking at the totals.
export function OpnameLembar() {
  const client = useQueryClient()
  const actor = useActor()
  const id = useParam("id").value ?? ""
  const [problem, setProblem] = useState<string | null>(null)

  const detail = useQuery({ ...reads.count(id), enabled: id !== "" })
  const pending = pendingOf(useOutbox(), "opname").filter(
    (job) => job.work.kind === "opname" && job.work.count_id === id,
  )

  /// The walk, on disk. Held as `epc → sku_code` so a reload in the middle of a
  /// rack does not lose the morning, and so the same tag read twice cannot be
  /// counted twice.
  const [found, setFound, clearFound] = useDraft<Record<string, string>>(
    `count:${id}`,
    {},
  )
  const walked = useMemo(() => Object.entries(found), [found])

  const submit = useMutation({
    mutationFn: () =>
      dc.submitOfficialCount(id, {
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.dc.all })
    },
  })

  const onScan = (raw: string) => {
    const read = readScan(raw)
    if (read.kind === "sku") {
      setProblem(
        "Opname butuh tag barangnya. Barcode hanya menyebut jenis barang, bukan potongan yang ada di rak.",
      )
      return
    }
    if (read.kind === "unknown") {
      setProblem(`Kode "${read.raw}" tidak dikenali sebagai tag.`)
      return
    }
    if (found[read.epc] !== undefined) {
      setProblem(`Tag itu sudah dihitung — satu tag, satu potong.`)
      return
    }
    setProblem(null)
    setFound((current) => ({ ...current, [read.epc]: read.sku_code }))
  }

  if (id === "") {
    return (
      <Screen foot="none">
        <EmptyState>Opname tidak disebut di alamat layar ini.</EmptyState>
      </Screen>
    )
  }

  const summary = detail.data?.summary ?? null
  const active = summary?.status === "ACTIVE"

  return (
    <>
      <Screen foot="none">
        {queryState(detail, {
          loading: "Menanyakan opname…",
          render: (data) => (
            <>
              <div className="pt-1 pb-4">
                <h2 className="text-title font-semibold text-ink">
                  {label(data.summary.kind)} · {data.summary.pool_id}
                </h2>
                <p className="mt-0.5 text-meta text-body">
                  {data.summary.reason}
                </p>
              </div>

              {active && (
                <div className="mb-4">
                  <ScanField
                    onScan={onScan}
                    placeholder="Pindai tag barang"
                    autoFocus={false}
                  />
                </div>
              )}

              {problem !== null && (
                <Banner tone="bad" className="mb-4">
                  {problem}
                </Banner>
              )}
              {submit.isError && (
                <Banner tone="bad" className="mb-4">
                  {describe(submit.error)}
                </Banner>
              )}
              {pending.length > 0 && (
                <Banner tone="warn" className="mb-4">
                  {count(pending.length)} kiriman hasil masih menunggu jaringan.
                  Jangan tutup opname sebelum semuanya sampai.
                </Banner>
              )}
              {!active && (
                <Banner tone="info" className="mb-4">
                  Opname ini {label(data.summary.status).toLowerCase()}, jadi
                  tidak bisa dihitung lagi dari sini.
                </Banner>
              )}

              <Section>
                <div className="rounded-card border border-hairline bg-canvas px-3.5 py-2 shadow-soft">
                  <KeyValue term="Status">
                    <Pill tone={toneFor(data.summary.status)}>
                      {label(data.summary.status)}
                    </Pill>
                  </KeyValue>
                  <KeyValue term="Diharapkan">
                    {count(data.summary.expected)}
                  </KeyValue>
                  <KeyValue term="Sudah tercatat">
                    {count(data.summary.found)}
                  </KeyValue>
                  <KeyValue
                    term="Kurang"
                    tone={data.summary.shortage_epcs === 0 ? "normal" : "bad"}
                  >
                    {count(data.summary.shortage_epcs)}
                  </KeyValue>
                  <KeyValue
                    term="Lebih"
                    tone={data.summary.gain_epcs === 0 ? "normal" : "bad"}
                  >
                    {count(data.summary.gain_epcs)}
                  </KeyValue>
                </div>
              </Section>

              {walked.length > 0 && (
                <Section
                  title={`Belum dikirim · ${count(walked.length)} tag`}
                  action={
                    <Button
                      variant="quiet"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: "Buang hasil jalan ini?",
                            yes: "Buang",
                            danger: true,
                          })
                        )
                          clearFound()
                      }}
                    >
                      Buang
                    </Button>
                  }
                >
                  <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
                    <MiniTable head={["Tag", "SKU"]}>
                      {walked.slice(0, 50).map(([epc, sku]) => (
                        <MiniRow key={epc}>
                          <td className="font-mono text-[0.65625rem]">{epc}</td>
                          <td className="font-mono text-[0.65625rem]">{sku}</td>
                        </MiniRow>
                      ))}
                    </MiniTable>
                  </div>
                  {walked.length > 50 && (
                    <p className="mt-2 text-meta text-mute">
                      {count(walked.length - 50)} tag lagi tidak ditampilkan.
                    </p>
                  )}
                </Section>
              )}

              {data.lines.length > 0 && (
                <Section title={`Sudah tercatat · ${count(data.lines.length)}`}>
                  <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
                    <MiniTable head={["SKU", "Harap", "Temu", "Selisih"]}>
                      {data.lines.slice(0, 50).map((line) => (
                        <MiniRow key={line.epc}>
                          <td className="font-mono text-[0.65625rem]">
                            {line.sku_code}
                          </td>
                          <td>{count(line.expected_quantity)}</td>
                          <td>{count(line.found_quantity)}</td>
                          <td>{signed(line.adjustment_quantity)}</td>
                        </MiniRow>
                      ))}
                    </MiniTable>
                  </div>
                </Section>
              )}
            </>
          ),
        })}
      </Screen>

      {active && (
        <ActionBar>
          <div className="flex items-center gap-2.5">
            <Button
              variant="ghost"
              size="lg"
              disabled={
                walked.length > 0 || pending.length > 0 || submit.isPending
              }
              onClick={async () => {
                if (
                  !(await confirm({
                    title: "Tutup opname ini?",
                    body: "Selisihnya diserahkan untuk disetujui.",
                    yes: "Tutup opname",
                  }))
                ) {
                  return
                }
                submit.mutate()
              }}
            >
              Tutup opname
            </Button>
            <Button
              variant="primary"
              size="lg"
              block
              className="min-w-0 shrink"
              disabled={walked.length === 0}
              onClick={() => {
                enqueue(
                  {
                    kind: "opname",
                    count_id: id,
                    entries: walked.map(([epc, sku_code]) => ({
                      epc,
                      sku_code,
                      found_quantity: 1,
                    })),
                  },
                  actor,
                )
                clearFound()
              }}
            >
              Kirim {count(walked.length)} tag
            </Button>
          </div>
        </ActionBar>
      )}
    </>
  )
}
