import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { SkuEntry } from "@/components/entry"
import { TallyRow } from "@/components/tally"
import { Button } from "@/components/ui/button"
import { Pill } from "@/components/ui/pill"
import { ActionBar, Screen, Section } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { tallyLines, tallyTotal, useDraft, type Tally } from "@/lib/draft"
import { count } from "@/lib/format"
import { useGo } from "@/lib/go"
import { enqueue } from "@/lib/outbox"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { reads } from "@/lib/queries"
import { useActor } from "@/lib/session"

/// The pack sheet for one shop: name a SKU, type how many go in the carton.
///
/// The entry is the picker's — a code and a number — but the arithmetic behind
/// it is the opposite of picking's, and that difference is the node's:
///
///   - **Picking is free.** No allotment is consulted, and a short pick is an
///     ordinary outcome the node records.
///   - **Packing is bounded twice.** `pack_by_quantity` refuses a line asking
///     for more than is standing in the picking area — *"a short pack is not an
///     ordinary outcome the way a short pick is"* — and `pack_koli` refuses a
///     piece it cannot attach to an open allotment line for this shop.
///
/// So this screen checks both before anything is queued. A pack that leaves the
/// phone wrong comes back refused out of the outbox an hour later, on a bench
/// where the carton is already taped shut.
///
/// **Both numbers are shown, never just their minimum.** `outstanding_for_
/// destination` keeps them apart on purpose: "the shop does not want more" and
/// "nobody has fetched it yet" call for very different next actions — the first
/// closes the carton, the second sends somebody back to the racks.
///
/// Sealing is chosen before the pack, because the node takes it as a flag on the
/// pack itself. Left open, the same carton can be added to again; sealed, it
/// becomes something the shipping station can pick up. The default is open: a
/// packer who has not said they are finished is not finished.
export function KemasKotak() {
  const go = useGo()
  const actor = useActor()
  const toko = useParam("toko").value ?? ""
  const [sku, setSku] = useState<string | null>(null)
  const [seal, setSeal] = useState<"buka" | "segel">("buka")

  const outstanding = useQuery({
    ...reads.outstanding(toko),
    enabled: toko !== "",
  })
  const lines = useMemo(() => outstanding.data ?? [], [outstanding.data])
  const owed = useMemo(
    () => new Map(lines.map((line) => [line.sku_code, line])),
    [lines],
  )

  const [tally, setTally, clearTally] = useDraft<Tally>(`pack:${toko}`, {})
  const inCarton = tallyLines(tally)
  const names = useQuery(
    reads.names([
      ...lines.map((line) => line.sku_code),
      ...inCarton.map((line) => line.sku_code),
    ]),
  )
  const nameOf = (code: string) => names.data?.get(code)?.name ?? code

  const change = (code: string, by: number) => {
    setTally((current) => {
      const next = Math.max(0, (current[code] ?? 0) + by)
      const rest: Record<string, number> = { ...current }
      if (next === 0) delete rest[code]
      else rest[code] = next
      return rest
    })
  }

  /// What the shop is owed and what is standing in the packing area, as one
  /// pill. Two numbers because they mean different things and the packer acts on
  /// the difference.
  const note = (code: string) => {
    const line = owed.get(code)
    if (line === undefined) return <Pill tone="bad">tidak dialokasikan</Pill>
    return (
      <Pill tone={line.outstanding > 0 ? "neutral" : "warn"}>
        diminta {count(line.wanted)} · siap {count(line.available)}
      </Pill>
    )
  }

  /// Why the node would refuse this line, in the words of whichever limit binds.
  /// `null` means it would take it.
  const refusal = (code: string, adding: number): string | null => {
    const line = owed.get(code)
    if (line === undefined) {
      return `${toko} tidak punya alokasi terbuka untuk SKU ini, jadi node akan menolak koli ini.`
    }
    const already = tally[code] ?? 0
    const total = already + adding
    if (total > line.available) {
      return `Hanya ${count(line.available)} yang berdiri di area kemas${already > 0 ? ` dan ${count(already)} sudah di koli ini` : ""}. Sisanya harus diambil dulu dari rak.`
    }
    if (total > line.wanted) {
      return `${toko} hanya menunggu ${count(line.wanted)}. Kelebihannya tidak punya alokasi dan akan ditolak.`
    }
    return null
  }

  const packed = tallyTotal(tally)

  if (toko === "") {
    return (
      <Screen foot="none">
        <EmptyState>Toko tidak disebut di alamat layar ini.</EmptyState>
      </Screen>
    )
  }

  return (
    <>
      <Screen foot="none">
        <div className="pt-1 pb-4">
          <h2 className="mb-3 text-title font-semibold text-ink">{toko}</h2>
          <SkuEntry
            placeholder="Pindai atau ketik SKU"
            sku={sku}
            onSku={setSku}
            addLabel="Masukkan"
            onAdd={change}
            lookup={(code, quantity) => ({
              note: note(code),
              problem: refusal(code, quantity),
            })}
          />
        </div>

        <div className="mb-5">
          <Segmented
            value={seal}
            onChange={setSeal}
            options={[
              { value: "buka", label: "Biarkan terbuka" },
              { value: "segel", label: "Segel koli" },
            ]}
          />
        </div>

        {inCarton.length > 0 && (
          <Section title={`Di koli ini · ${count(packed)} potong`}>
            <div className="flex flex-col gap-2.5">
              {inCarton.map((line) => (
                <TallyRow
                  key={line.sku_code}
                  name={nameOf(line.sku_code)}
                  code={line.sku_code}
                  have={line.quantity}
                  note={note(line.sku_code)}
                  tone={
                    refusal(line.sku_code, 0) === null ? "normal" : "bad"
                  }
                  onLess={() => change(line.sku_code, -1)}
                  onMore={() => change(line.sku_code, 1)}
                  onRemove={() => change(line.sku_code, -line.quantity)}
                />
              ))}
            </div>
          </Section>
        )}

        {queryState(outstanding, {
          loading: "Menanyakan yang masih ditunggu toko…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>Toko ini tidak menunggu apa-apa lagi.</EmptyState>
            ) : (
              <Section title={`Ditunggu toko · ${count(rows.length)} SKU`}>
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
                        <span className="block text-meta text-mute">
                          bisa dikemas
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </Section>
            ),
        })}
      </Screen>

      <ActionBar>
        <div className="flex items-center gap-3">
          <span className="min-w-0">
            <span className="block text-metric font-semibold text-ink tabular-nums">
              {count(packed)}
            </span>
            <span className="block truncate text-meta text-mute">
              potong di koli ini
            </span>
          </span>
          <div className="flex-1" />
          <Button
            variant="primary"
            size="lg"
            className="min-w-0"
            disabled={packed === 0}
            onClick={() => {
              enqueue(
                {
                  kind: "kemas",
                  destination_store_id: toko,
                  seal: seal === "segel",
                  lines: inCarton,
                },
                actor,
              )
              clearTally()
              go("/kemas", { lihat: "koli" }, { replace: true })
            }}
          >
            {seal === "segel" ? "Kemas & segel" : "Kemas"}
          </Button>
        </div>
      </ActionBar>
    </>
  )
}
