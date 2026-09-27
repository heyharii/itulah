import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { BottomSheet, MorphHeight } from "@/components/ui/picker-sheet"
import { Pill } from "@/components/ui/pill"
import { KeyValue, MiniRow, MiniTable } from "@/components/ui/rows"
import { Section } from "@/components/ui/screen"
import { Banner } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { confirm } from "@/lib/confirm"
import { describe } from "@/lib/errors"
import { count, label, moment, toneFor } from "@/lib/format"
import { useGo } from "@/lib/go"
import { notice } from "@/lib/notice"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { keys, reads } from "@/lib/queries"

/// `/kemas/koli?id=` — where a carton used to be pushed — now opens that
/// carton's sheet over the list of cartons. Kept for the same reason as
/// `/kemas/kotak`: the address is already in tabs and histories on the floor.
export function KemasKoli() {
  const go = useGo()
  const id = useParam("id").value

  useEffect(() => {
    go("/kemas", { lihat: "koli", id }, { replace: true })
  }, [go, id])

  return null
}

/// One carton.
///
/// **Sealing is not outbox work.** It is not a record of something that happened
/// on the floor — it is a decision about a document, taken by somebody standing
/// over the carton with the screen in their hand, and the next thing they do
/// depends on the answer. A sealed carton is what the shipping station can pick
/// up; a seal queued on a phone in a pocket would have the next station looking
/// for a carton that is still open on the node.
///
/// **Sealing is asked once.** The node refuses to unseal, and on a sheet the
/// button that does it sits where the thumb already is — the same foot a swipe
/// starts from. A carton sealed by a stray press is a carton that has to be
/// unpacked into a new one, so the press asks, and says what it closes.
///
/// **The label is shown, not printed.** Printing wants a printer's host and port,
/// which is a bench setting and not something anybody types on a phone over a
/// trolley — that screen is in the hub, on the machine beside the printer. What a
/// phone can do is put the carton's own QR on the glass, which is what the person
/// at the door is going to scan.
export function KoliSheet({
  id,
  open,
  onClose,
}: {
  /// The carton, held by the caller past the close so the sheet keeps its
  /// words while it slides away.
  id: string | undefined
  open: boolean
  /// A swipe, the back button's pop and a seal the node took all end here,
  /// so each leaves the phone on the list of cartons the card was tapped on.
  onClose: () => void
}) {
  // Only the number, for the title: the sheet's head is drawn outside the
  // body below, and the manifest is one read either way — same key, same
  // cache entry, asked once.
  const number = useQuery({
    ...reads.manifest(id ?? ""),
    enabled: open && id !== undefined,
    select: (box) => box.koli.koli_number,
  })

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={number.data ?? "Koli"}
    >
      {id !== undefined && <Koli key={id} id={id} onSealed={onClose} />}
    </BottomSheet>
  )
}

function Koli({ id, onSealed }: { id: string; onSealed: () => void }) {
  const client = useQueryClient()
  const [showLabel, setShowLabel] = useState(false)

  const manifest = useQuery(reads.manifest(id))
  const lines = manifest.data?.lines ?? []
  const names = useQuery(reads.names(lines.map((line) => line.sku_code)))

  const seal = useMutation({
    mutationFn: () => dc.sealKoli(id),
    onSuccess: (box) => {
      // A sealed carton leaves the packing queue and joins the shipping one, and
      // the outbound pools move under both. The whole `dc` prefix is the honest
      // invalidation.
      void client.invalidateQueries({ queryKey: keys.dc.all })
      void client.invalidateQueries({ queryKey: keys.pools() })
      // Said here rather than beside the press: a seal the packer swiped away
      // from while it was in flight still happened, and still gets its line.
      notice(`Koli ${box.koli.koli_number} disegel.`)
    },
  })

  const sealed = manifest.data?.koli.sealed_at ?? null

  const ask = async () => {
    const box = manifest.data
    if (box === undefined) return
    const yes = await confirm({
      title: "Segel koli ini?",
      body: `${count(box.koli.unit_count)} potong untuk ${box.koli.destination_store_id}. Koli yang sudah disegel tidak bisa diisi lagi, dan siap diambil stasiun kirim.`,
      yes: "Segel",
    })
    if (!yes) return
    // The sheet closes only on the node's yes. A refusal keeps it open, with
    // the node's sentence above the contents, and the carton still in hand.
    seal.mutate(undefined, { onSuccess: onSealed })
  }

  return (
    <>
      {/* Two pages — asking, then the carton — so the sheet grows to the
          contents on the drawer curve rather than jumping as they land, and
          again when the label is put on the glass. */}
      <MorphHeight page={manifest.data === undefined ? "tanya" : "koli"}>
        <div className="px-4 pt-1 pb-4">
          {queryState(manifest, {
            loading: "Menanyakan koli…",
            render: (box) => (
              <>
                <p className="-mt-1 mb-4 text-meta text-body">
                  {box.koli.destination_store_id} · {count(box.koli.unit_count)}{" "}
                  potong
                </p>

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
                    <div className="grid place-items-center rounded-card border border-hairline bg-canvas p-4 shadow-soft transition-opacity duration-200 ease-(--ease-out) starting:opacity-0">
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

                <Section
                  title={`Isi · ${count(lines.length)} baris`}
                  className="mb-0"
                >
                  <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
                    <MiniTable head={["Barang", "SKU", "Jumlah"]}>
                      {lines.map((line) => (
                        <MiniRow
                          key={`${line.sku_code}:${line.allotment_line_id}`}
                        >
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
        </div>
      </MorphHeight>

      {/* Outside the scroll, like the carton sheet's foot: the contents of a
          big carton run past the sheet's cap, and the seal stays in reach. */}
      {manifest.data !== undefined && sealed === null && (
        <div className="shrink-0 border-t border-hairline px-4 pt-3 pb-3">
          <Button
            variant="primary"
            size="lg"
            block
            disabled={seal.isPending}
            onClick={() => void ask()}
          >
            {seal.isPending ? "Menyegel…" : "Segel koli"}
          </Button>
        </div>
      )}
    </>
  )
}
