import { useQuery } from "@tanstack/react-query"
import { ListChecks } from "lucide-react"
import { useMemo, useState } from "react"

import { NotWanted, SkuEntry } from "@/components/entry"
import { TallyRow } from "@/components/tally"
import { Button } from "@/components/ui/button"
import { RecordCard } from "@/components/ui/card"
import { Select } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { CardList, FloatingBar, Screen, Section } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import { pickingPool, racks } from "@/lib/api"
import { tallyLines, tallyTotal, useDraft, type Tally } from "@/lib/draft"
import { ago, count } from "@/lib/format"
import { useGo } from "@/lib/go"
import { enqueue, pendingOf, useOutbox } from "@/lib/outbox"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { reads } from "@/lib/queries"
import { useActor } from "@/lib/session"

/// Picking: taking stock off the racks and saying what was taken.
///
/// **Nobody is handed a list to work through.** That is the node's own design
/// rather than a simplification for a phone — `edge/sqlite.rs::pick_stock` is
/// explicit: *"No allotment is consulted here. Picking fetches a SKU and a
/// number; which piece serves which shop is settled when it goes into a
/// carton."* A picker walks the racks, takes what is on them, and types how
/// many. A SKU no shop has asked for is still a SKU that can be picked, and the
/// node takes it.
///
/// What the shops are owed is shown underneath, as **reference**: it is where
/// somebody looks to decide where to walk next, and tapping a line puts that SKU
/// in the box above. It is not a set of rows to tick off, and nothing typed here
/// is capped by it.
///
/// A short pick is ordinary. Asking for 300 and finding 200 is a statement about
/// the racks; the node records the 200 rather than failing, and the outbox
/// repeats what it said.
///
/// The round is committed at the end, as one picklist, rather than one request
/// per garment: that is the node's shape (`POST /dc/picklists` performs the picks
/// and closes the session) and the right shape for a phone in a gangway, where
/// forty little writes over bad wifi are forty chances to lose one.
export function Ambil() {
  const go = useGo()
  const actor = useActor()
  const rak = useParam("rak")
  const [sku, setSku] = useState<string | null>(null)

  const pools = useQuery(reads.pools())
  const picklist = useQuery(reads.picklist())
  const rounds = useQuery(reads.picklists())
  const pending = pendingOf(useOutbox(), "ambil")

  const shelves = racks(pools.data?.items ?? [])
  // The rack, chosen once and then remembered in the URL. Defaulting to the
  // first is not a guess about the building: a node with one warehouse pool —
  // which is every DC in this fleet today — would otherwise make every picker
  // answer a question with one answer.
  const source = rak.value ?? shelves[0]?.id ?? null
  // Already off the rack and waiting to be packed. See `pickingPool`: this
  // number is the difference between the list below and reality, and a picker
  // who is not shown it picks the same garment twice.
  const standing = pickingPool(pools.data?.items ?? [])?.stock ?? 0

  const lines = useMemo(() => picklist.data ?? [], [picklist.data])
  const wanted = useMemo(
    () => new Map(lines.map((line) => [line.sku_code, line.outstanding])),
    [lines],
  )

  const [tally, setTally, clearTally] = useDraft<Tally>(
    `pick:${source ?? "none"}`,
    {},
  )
  const taken = tallyLines(tally)
  const names = useQuery(
    reads.names([
      ...lines.map((line) => line.sku_code),
      ...taken.map((line) => line.sku_code),
    ]),
  )
  const nameOf = (code: string) => names.data?.get(code)?.name ?? code

  /// What is on the trolley for this SKU, by however much. Adding the same SKU
  /// twice sums rather than replaces: a picker who finds six more on the next
  /// rack types six, not the new total.
  const change = (code: string, by: number) => {
    setTally((current) => {
      const next = Math.max(0, (current[code] ?? 0) + by)
      const rest: Record<string, number> = { ...current }
      // A zero is removed rather than kept: a tally is what is on the trolley,
      // and `{"31001101001": 0}` sent as a pick line is a line the node has to
      // reason about for no reason.
      if (next === 0) delete rest[code]
      else rest[code] = next
      return rest
    })
  }

  /// The pill that says what a SKU means to the shops — a note, never a gate.
  const asked = (code: string) => {
    const owed = wanted.get(code)
    return owed === undefined ? (
      <NotWanted />
    ) : (
      <Pill tone="neutral">diminta {count(owed)}</Pill>
    )
  }

  const picked = tallyTotal(tally)

  return (
    <>
      <Screen foot={picked > 0 ? "both" : "tabs"}>
        <div className="pt-1 pb-4">
          <SkuEntry
            placeholder="Pindai atau ketik SKU"
            sku={sku}
            onSku={setSku}
            addLabel="Ambil"
            onAdd={change}
            lookup={(code) => ({ note: asked(code) })}
          />
        </div>

        {shelves.length > 1 && (
          <div className="mb-4">
            <Select
              aria-label="Rak asal"
              value={source ?? ""}
              onChange={(next) => rak.set(next)}
            >
              {shelves.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.label} · {count(pool.stock)}
                </option>
              ))}
            </Select>
          </div>
        )}

        {pending.length > 0 && (
          <Banner tone="warn" className="mb-4">
            {count(pending.length)} ronde tersimpan di HP ini dan belum sampai ke
            node.
          </Banner>
        )}
        {standing > 0 && (
          <Banner tone="info" className="mb-4">
            {count(standing)} potong sudah di area kemas. Angka “diminta” baru
            turun saat barang masuk koli, bukan saat diambil — jangan ambil dua
            kali.
          </Banner>
        )}
        {source === null && (
          <Banner tone="bad" className="mb-4">
            Node ini tidak punya rak gudang, jadi tidak ada tempat mengambil
            barang.
          </Banner>
        )}

        {taken.length > 0 && (
          <Section title={`Di troli · ${count(picked)} potong`}>
            <div className="flex flex-col gap-2.5">
              {taken.map((line) => (
                <TallyRow
                  key={line.sku_code}
                  name={nameOf(line.sku_code)}
                  code={line.sku_code}
                  have={line.quantity}
                  note={asked(line.sku_code)}
                  onLess={() => change(line.sku_code, -1)}
                  onMore={() => change(line.sku_code, 1)}
                  onRemove={() => change(line.sku_code, -line.quantity)}
                />
              ))}
            </div>
          </Section>
        )}

        {queryState(picklist, {
          loading: "Menanyakan permintaan toko…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                Tidak ada yang diminta toko. Anda tetap bisa mengambil barang apa
                pun dari rak — kotak di atas menerima SKU mana saja.
              </EmptyState>
            ) : (
              <Section title={`Diminta toko · ${count(rows.length)} SKU`}>
                <div className="flex flex-col gap-2">
                  {rows.map((line) => (
                    <button
                      key={line.sku_code}
                      type="button"
                      onClick={() => setSku(line.sku_code)}
                      className="pressable flex items-center gap-3 rounded-card border border-hairline bg-canvas px-3.5 py-3 text-left shadow-soft"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">
                          {nameOf(line.sku_code)}
                        </span>
                        <span className="block truncate font-mono text-[0.65625rem] text-mute">
                          {line.sku_code}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block text-metric font-semibold text-ink tabular-nums">
                          {count(line.outstanding)}
                        </span>
                        <span className="block text-meta text-mute">diminta</span>
                      </span>
                    </button>
                  ))}
                </div>
              </Section>
            ),
        })}

        {queryState(rounds, {
          loading: "…",
          render: (all) =>
            all.length === 0 ? null : (
              <Section title="Ronde terakhir">
                <CardList>
                  {all.slice(0, 5).map((round) => (
                    <RecordCard
                      key={round.session.session_id}
                      icon={<ListChecks />}
                      id={`${count(round.total_picked)} potong`}
                      onPress={() =>
                        go("/ambil/ronde", { id: round.session.session_id })
                      }
                    >
                      <div className="px-3.5 pt-2 pb-3">
                        <KeyValue term="SKU">{count(round.sku_count)}</KeyValue>
                        <KeyValue term="Oleh">{round.session.actor_id}</KeyValue>
                        <KeyValue term="Mulai">
                          {ago(round.session.started_at)}
                        </KeyValue>
                      </div>
                    </RecordCard>
                  ))}
                </CardList>
              </Section>
            ),
        })}
      </Screen>

      {picked > 0 && (
        <FloatingBar>
          <div className="flex items-center gap-3 px-3.5 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-metric font-semibold text-ink tabular-nums">
                {count(picked)} potong
              </span>
              <span className="block truncate text-meta text-mute">
                {count(taken.length)} SKU di troli
              </span>
            </span>
            <Button
              variant="quiet"
              onClick={() => {
                if (window.confirm("Buang tally ronde ini?")) clearTally()
              }}
            >
              Buang
            </Button>
            <Button
              variant="primary"
              disabled={source === null}
              onClick={() => {
                enqueue(
                  {
                    kind: "ambil",
                    source_pool_id: source!,
                    note: null,
                    lines: taken,
                  },
                  actor,
                )
                clearTally()
              }}
            >
              Simpan ronde
            </Button>
          </div>
        </FloatingBar>
      )}
    </>
  )
}
