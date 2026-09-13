import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Pill } from "@/components/ui/pill"
import { KeyValue, MiniRow, MiniTable } from "@/components/ui/rows"
import { ActionBar, Screen, Section } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { describe } from "@/lib/errors"
import { count, label, moment, toneFor } from "@/lib/format"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { keys, reads } from "@/lib/queries"

/// One carton.
///
/// **Sealing is not outbox work.** It is not a record of something that happened
/// on the floor — it is a decision about a document, taken by somebody standing
/// over the carton with the screen in their hand, and the next thing they do
/// depends on the answer. A sealed carton is what the shipping station can pick
/// up; a seal queued on a phone in a pocket would have the next station looking
/// for a carton that is still open on the node.
///
/// **The label is shown, not printed.** Printing wants a printer's host and port,
/// which is a bench setting and not something anybody types on a phone over a
/// trolley — that screen is in the hub, on the machine beside the printer. What a
/// phone can do is put the carton's own QR on the glass, which is what the person
/// at the door is going to scan.
export function KemasKoli() {
  const client = useQueryClient()
  const id = useParam("id").value
  const [showLabel, setShowLabel] = useState(false)

  const manifest = useQuery({
    ...reads.manifest(id ?? ""),
    enabled: id !== undefined,
  })
  const lines = manifest.data?.lines ?? []
  const names = useQuery(reads.names(lines.map((line) => line.sku_code)))

  const seal = useMutation({
    mutationFn: () => dc.sealKoli(id!),
    onSuccess: () => {
      // A sealed carton leaves the packing queue and joins the shipping one, and
      // the outbound pools move under both. The whole `dc` prefix is the honest
      // invalidation.
      void client.invalidateQueries({ queryKey: keys.dc.all })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
  })

  if (id === undefined) {
    return (
      <Screen foot="none">
        <EmptyState>Koli tidak disebut di alamat layar ini.</EmptyState>
      </Screen>
    )
  }

  const sealed = manifest.data?.koli.sealed_at ?? null

  return (
    <>
      <Screen foot="none">
        {queryState(manifest, {
          loading: "Menanyakan koli…",
          render: (box) => (
            <>
              <div className="pt-1 pb-4">
                <h2 className="text-title font-semibold text-ink">
                  {box.koli.koli_number}
                </h2>
                <p className="mt-0.5 text-meta text-body">
                  {box.koli.destination_store_id} ·{" "}
                  {count(box.koli.unit_count)} potong
                </p>
              </div>

              {seal.isError && (
                <Banner tone="bad" className="mb-4">
                  {describe(seal.error)}
                </Banner>
              )}

              <Section>
                <div className="rounded-card border border-hairline bg-canvas px-3.5 py-2 shadow-soft">
                  <KeyValue term="Tahap">
                    <Pill tone={toneFor(box.koli.position)}>
                      {label(box.koli.position)}
                    </Pill>
                  </KeyValue>
                  <KeyValue term="Disegel">
                    {box.koli.sealed_at === null
                      ? "belum"
                      : `${moment(box.koli.sealed_at)} · ${box.koli.sealed_by ?? "—"}`}
                  </KeyValue>
                  <KeyValue term="Kiriman">
                    {box.koli.shipment_id ?? "belum masuk kiriman"}
                  </KeyValue>
                </div>
              </Section>

              <Section
                title="Label koli"
                action={
                  <Button
                    variant="quiet"
                    onClick={() => setShowLabel((on) => !on)}
                  >
                    {showLabel ? "Sembunyikan" : "Tampilkan"}
                  </Button>
                }
              >
                {showLabel && (
                  <div className="grid place-items-center rounded-card border border-hairline bg-canvas p-4 shadow-soft">
                    {/* The node draws this, not the browser: `qr_svg` comes off
                        the manifest already rendered, so what is on the glass is
                        the same image the printer would put on the carton. */}
                    <div
                      className="w-40 max-w-full [&>svg]:h-auto [&>svg]:w-full"
                      dangerouslySetInnerHTML={{ __html: box.qr_svg }}
                    />
                    <p className="mt-3 text-center font-mono text-[0.65625rem] break-all text-mute">
                      {box.qr_payload}
                    </p>
                  </div>
                )}
              </Section>

              <Section title={`Isi · ${count(lines.length)} baris`}>
                <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
                  <MiniTable head={["Barang", "SKU", "Jumlah"]}>
                    {lines.map((line) => (
                      <MiniRow key={`${line.sku_code}:${line.allotment_line_id}`}>
                        <td>{names.data?.get(line.sku_code)?.name ?? "—"}</td>
                        <td className="font-mono text-[0.65625rem]">
                          {line.sku_code}
                        </td>
                        <td>{count(line.quantity)}</td>
                      </MiniRow>
                    ))}
                  </MiniTable>
                </div>
              </Section>
            </>
          ),
        })}
      </Screen>

      {manifest.data !== undefined && sealed === null && (
        <ActionBar>
          <Button
            variant="primary"
            size="lg"
            block
            disabled={seal.isPending}
            onClick={() => seal.mutate()}
          >
            {seal.isPending ? "Menyegel…" : "Segel koli"}
          </Button>
        </ActionBar>
      )}
    </>
  )
}
