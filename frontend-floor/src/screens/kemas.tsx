import { useQuery } from "@tanstack/react-query"
import { Boxes, Store } from "lucide-react"
import { useState } from "react"

import { RecordCard } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { CardList, Screen, Section } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { tallyTotal, useDraft, type Tally } from "@/lib/draft"
import { count, label, toneFor } from "@/lib/format"
import { pendingOf, useOutbox } from "@/lib/outbox"
import { useParam, useSheetParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { reads } from "@/lib/queries"
import { KoliSheet } from "@/screens/kemas-koli"
import { KotakSheet } from "@/screens/kemas-kotak"
import type { DestinationDemand } from "@itulah/contract"

/// Packing: putting picked stock into a carton for one shop.
///
/// Two slices, and they are the two halves of the station rather than two views
/// of one list. **Antre** is the queue — every shop with something outstanding,
/// and how much of it this building can actually pack today. **Koli** is what has
/// been made: the cartons, open and sealed, that the next station will ask for by
/// number.
///
/// A pack decides something a pick does not: a picklist fetches garments off the
/// racks for nobody in particular, and a carton is for one shop. That is why the
/// queue is a list of shops and not of SKUs.
///
/// A shop's carton and a made carton both open as sheets over their list —
/// `toko` and `id` in the address, so a phone reloaded mid-carton comes back to
/// the carton — and the list stays where it was behind them, so the next shop
/// or the next carton is one tap away.
///
/// Each sheet is opened as its own history entry (`useSheetParam`), not written
/// over the list's: on Android the back button is how a sheet is put away, and
/// over a replaced entry that press left the station with a carton half-built
/// on the glass. The slice is still a plain `useParam` — Antre and Koli are the
/// screen's own control, and back should not walk through every switch.
export function Kemas() {
  const view = useParam("lihat")
  const slice = view.value === "koli" ? "koli" : "antre"
  const toko = useSheetParam("toko")
  const koli = useSheetParam("id")
  const shownToko = useHeld(toko.value)
  const shownKoli = useHeld(koli.value)

  const shops = useQuery(reads.destinations())
  const boxes = useQuery(reads.koli())
  const pending = pendingOf(useOutbox(), "kemas")

  return (
    <>
      <Screen>
        <div className="pt-1 pb-4">
          <Segmented
            value={slice}
            onChange={(next) => view.set(next)}
            options={[
              { value: "antre", label: "Antre" },
              { value: "koli", label: "Koli" },
            ]}
          />
        </div>

        {pending.length > 0 && (
          <Banner tone="warn" className="mb-4">
            {count(pending.length)} kemasan tersimpan di HP ini dan belum sampai
            ke node.
          </Banner>
        )}

        {slice === "antre"
          ? queryState(shops, {
              loading: "Menanyakan antrean toko…",
              render: (rows) =>
                rows.length === 0 ? (
                  <EmptyState>
                    Tidak ada toko yang menunggu kiriman. Antrean terisi begitu
                    alokasi baru turun dari pusat.
                  </EmptyState>
                ) : (
                  <Section title="Toko menunggu">
                    <CardList>
                      {rows.map((shop) => (
                        <ShopCard
                          key={shop.destination_id}
                          shop={shop}
                          onPress={() => toko.open(shop.destination_id)}
                        />
                      ))}
                    </CardList>
                  </Section>
                ),
            })
          : queryState(boxes, {
              loading: "Menanyakan koli…",
              render: (rows) =>
                rows.length === 0 ? (
                  <EmptyState>
                    Belum ada koli. Koli pertama muncul begitu Anda mengemas
                    sesuatu untuk sebuah toko.
                  </EmptyState>
                ) : (
                  <Section title={`${count(rows.length)} koli`}>
                    <CardList>
                      {rows.map((box) => (
                        <RecordCard
                          key={box.koli_id}
                          icon={<Boxes />}
                          id={box.koli_number}
                          status={
                            box.sealed_at === null ? (
                              <Pill tone="warn">terbuka</Pill>
                            ) : (
                              <Pill tone={toneFor(box.position)}>
                                {label(box.position)}
                              </Pill>
                            )
                          }
                          onPress={() => koli.open(box.koli_id)}
                        >
                          <div className="px-3.5 pt-2 pb-3">
                            <KeyValue term="Untuk">
                              {box.destination_store_id}
                            </KeyValue>
                            <KeyValue term="Isi">
                              {count(box.unit_count)} potong
                            </KeyValue>
                          </div>
                        </RecordCard>
                      ))}
                    </CardList>
                  </Section>
                ),
            })}
      </Screen>

      <KotakSheet
        toko={shownToko}
        open={toko.value !== undefined}
        onClose={() => toko.close()}
      />
      <KoliSheet
        id={shownKoli}
        open={koli.value !== undefined}
        onClose={() => koli.close()}
      />
    </>
  )
}

/// One shop in the queue, and whether a carton for it is already half-built
/// on this phone.
///
/// The draft is the packer's own unfinished work — a carton the sheet was
/// swiped away from, or the phone slept on — and it is only on this phone. A
/// queue that did not say so would leave it there until the next time
/// somebody happened to open that shop.
function ShopCard({
  shop,
  onPress,
}: {
  shop: DestinationDemand
  onPress: () => void
}) {
  const [tally] = useDraft<Tally>(`pack:${shop.destination_id}`, {})
  const drafted = tallyTotal(tally)

  return (
    <RecordCard
      icon={<Store />}
      id={shop.destination_id}
      status={
        shop.packable === 0 ? (
          <Pill tone="neutral">stok belum ada</Pill>
        ) : (
          <Pill tone="ok">{count(shop.packable)} bisa dikemas</Pill>
        )
      }
      onPress={onPress}
    >
      <div className="px-3.5 pt-2 pb-3">
        {drafted > 0 && (
          <KeyValue term="Di HP ini">
            <Pill tone="warn">Draf · {count(drafted)} potong</Pill>
          </KeyValue>
        )}
        <KeyValue term="Diminta">{count(shop.wanted)}</KeyValue>
        <KeyValue term="SKU">{count(shop.sku_count)}</KeyValue>
      </div>
    </RecordCard>
  )
}

/// The record a sheet was last opened on, kept after its parameter has gone.
///
/// Closing a sheet clears its key from the address at once, but the sheet
/// takes a moment to slide away — and a sheet that lost its shop the instant
/// it began to leave would drop its title and collapse to a grip on the way
/// down. The same reason `lib/confirm.ts` keeps its question after the answer.
function useHeld(value: string | undefined): string | undefined {
  const [held, setHeld] = useState(value)
  if (value !== undefined && value !== held) setHeld(value)
  return value ?? held
}
