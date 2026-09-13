import { useQuery } from "@tanstack/react-query"
import { Boxes, Store } from "lucide-react"

import { RecordCard } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { CardList, Screen, Section } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, label, toneFor } from "@/lib/format"
import { useGo } from "@/lib/go"
import { pendingOf, useOutbox } from "@/lib/outbox"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { reads } from "@/lib/queries"

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
export function Kemas() {
  const go = useGo()
  const view = useParam("lihat")
  const slice = view.value === "koli" ? "koli" : "antre"

  const shops = useQuery(reads.destinations())
  const koli = useQuery(reads.koli())
  const pending = pendingOf(useOutbox(), "kemas")

  return (
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
          {count(pending.length)} kemasan tersimpan di HP ini dan belum sampai ke
          node.
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
                      <RecordCard
                        key={shop.destination_id}
                        icon={<Store />}
                        id={shop.destination_id}
                        status={
                          shop.packable === 0 ? (
                            <Pill tone="neutral">stok belum ada</Pill>
                          ) : (
                            <Pill tone="ok">
                              {count(shop.packable)} bisa dikemas
                            </Pill>
                          )
                        }
                        onPress={() =>
                          go("/kemas/kotak", { toko: shop.destination_id })
                        }
                      >
                        <div className="px-3.5 pt-2 pb-3">
                          <KeyValue term="Diminta">
                            {count(shop.wanted)}
                          </KeyValue>
                          <KeyValue term="SKU">{count(shop.sku_count)}</KeyValue>
                        </div>
                      </RecordCard>
                    ))}
                  </CardList>
                </Section>
              ),
          })
        : queryState(koli, {
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
                        onPress={() => go("/kemas/koli", { id: box.koli_id })}
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
  )
}
