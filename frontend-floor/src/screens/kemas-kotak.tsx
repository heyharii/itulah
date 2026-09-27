import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"

import { SkuEntry } from "@/components/entry"
import { RecountSheet } from "@/components/recount-sheet"
import { TallyRow } from "@/components/tally"
import { Button } from "@/components/ui/button"
import { BottomSheet, MorphHeight } from "@/components/ui/picker-sheet"
import { Pill } from "@/components/ui/pill"
import { Section } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { tallyLines, tallyTotal, useDraft, type Tally } from "@/lib/draft"
import { count } from "@/lib/format"
import { useGo } from "@/lib/go"
import { notice } from "@/lib/notice"
import { enqueue } from "@/lib/outbox"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { reads } from "@/lib/queries"
import { useActor } from "@/lib/session"

/// `/kemas/kotak?toko=` — where the pack sheet used to be pushed — now opens
/// the same shop's sheet over the packing queue.
///
/// The address is kept rather than retired because it is on phones already:
/// in a tab left open in a pocket, in the history a reload walks back through.
/// A link that used to open a shop's carton should still open that carton, and
/// the carton itself is on disk (`pack:<toko>`), so nothing is lost in the move.
export function KemasKotak() {
  const go = useGo()
  const toko = useParam("toko").value

  useEffect(() => {
    go("/kemas", { lihat: "antre", toko }, { replace: true })
  }, [go, toko])

  return null
}

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
/// So this sheet checks both before anything is queued. A pack that leaves the
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
///
/// **A sheet over the queue, not a pushed screen.** A packer works down the
/// queue shop by shop, and a push put the queue a back-arrow away from every
/// carton. Here it stays behind the glass, and a swipe down is "not now" rather
/// than "throw it away": the carton is the shop's draft, on disk, and the
/// queue's card says so until it is packed. A carton packed closes the sheet
/// onto the same queue, so the next shop is the next tap.
export function KotakSheet({
  toko,
  open,
  onClose,
}: {
  /// The shop, held by the caller past the close so the sheet keeps its words
  /// while it slides away.
  toko: string | undefined
  open: boolean
  /// A swipe, the back button's pop and a carton packed all end here, so they
  /// all leave the phone on the same entry: the queue the card was tapped on.
  onClose: () => void
}) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={toko ?? ""}
    >
      {/* Keyed by the shop, so the seal choice and the SKU in the box start
          over for the next one — sealing defaults to open for every carton,
          not only the first. */}
      {toko !== undefined && (
        <Kotak key={toko} toko={toko} onPacked={onClose} />
      )}
    </BottomSheet>
  )
}

function Kotak({ toko, onPacked }: { toko: string; onPacked: () => void }) {
  const actor = useActor()
  const [sku, setSku] = useState<string | null>(null)
  const [seal, setSeal] = useState<"buka" | "segel">("buka")
  // The carton line being set outright. Kept, with `open` off, while its
  // sheet slides away, so the sheet still has a name on the way down.
  const [recount, setRecount] = useState<{
    readonly code: string
    readonly open: boolean
  } | null>(null)

  const outstanding = useQuery(reads.outstanding(toko))
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

  /// A carton line outright: the number somebody got by counting what is in
  /// the carton again, not a difference from the last one. A zero takes the
  /// line off, as it does in `change`.
  const set = (code: string, quantity: number) => {
    setTally((current) => {
      const rest: Record<string, number> = { ...current }
      if (quantity <= 0) delete rest[code]
      else rest[code] = quantity
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

  /// Why the node would refuse `total` of this SKU in the carton, in the words
  /// of whichever limit binds. `null` means it would take it.
  ///
  /// Asked of the line's whole number, not of a step, because the count sheet
  /// REPLACES a line: what it types is the total, and `already + typed` there
  /// would count what is in the carton twice and could refuse a recount from
  /// 10 down to 8. `already` is only for the words — the part of the total the
  /// carton holds before this step.
  const refusalAt = (
    code: string,
    total: number,
    already = 0,
  ): string | null => {
    const line = owed.get(code)
    if (line === undefined) {
      return `${toko} tidak punya alokasi terbuka untuk SKU ini, jadi node akan menolak koli ini.`
    }
    if (total > line.available) {
      return `Hanya ${count(line.available)} yang berdiri di area kemas${already > 0 ? ` dan ${count(already)} sudah di koli ini` : ""}. Sisanya harus diambil dulu dari rak.`
    }
    if (total > line.wanted) {
      return `${toko} hanya menunggu ${count(line.wanted)}. Kelebihannya tidak punya alokasi dan akan ditolak.`
    }
    return null
  }

  /// The same two bounds for a step — what the scan box would add to the
  /// line, or 0 for the line as it stands.
  const refusal = (code: string, adding: number): string | null => {
    const already = tally[code] ?? 0
    return refusalAt(code, already + adding, already)
  }

  const packed = tallyTotal(tally)
  // A line already in the carton that the node would refuse — pushed past a
  // bound by its + key, or left over in a draft from before the queue moved.
  // The row turns red, and the carton cannot be sent while one does: "checks
  // both before anything is queued" is a promise about the whole carton, not
  // only about the line being added.
  const refused = inCarton.some((line) => refusal(line.sku_code, 0) !== null)

  const pack = () => {
    const sealed = seal === "segel"
    enqueue(
      {
        kind: "kemas",
        destination_store_id: toko,
        seal: sealed,
        lines: inCarton,
      },
      actor,
    )
    clearTally()
    // Back down onto the queue, not on to the cartons: a packer works the
    // shops one after another, and jumping to Koli after every carton put the
    // next shop a slice-switch away. Nothing is lost by staying — the outbox
    // invalidates the whole `dc` prefix the moment the node takes the pack,
    // and the station watches both lists whichever slice is showing, so the
    // queue's numbers move and the carton is in Koli when somebody goes there.
    onPacked()
    notice(
      sealed
        ? `${count(packed)} potong dikemas untuk ${toko}, koli disegel.`
        : `${count(packed)} potong dikemas untuk ${toko}.`,
    )
  }

  return (
    <>
      {/* One page, but still a `MorphHeight`: the queue below arrives after
          the sheet has started rising, and a line added or taken off changes
          what the carton needs — the sheet travels to the new height instead
          of jumping, and scrolls once it reaches its cap. */}
      <MorphHeight page="kotak">
        <div className="px-4 pt-1 pb-4">
          {/* The caret in the scan box as the sheet arrives, so a handheld's
              wedge scanner types the first tag straight in. No keyboard rises
              on a phone until the box is tapped (`ScanField`). */}
          <SkuEntry
            className="mb-4"
            placeholder="Pindai atau ketik SKU"
            sku={sku}
            onSku={setSku}
            autoFocus
            addLabel="Masukkan"
            onAdd={change}
            lookup={(code, quantity) => ({
              note: note(code),
              problem: refusal(code, quantity),
            })}
          />

          <Segmented
            className="mb-5"
            value={seal}
            onChange={setSeal}
            options={[
              { value: "buka", label: "Biarkan terbuka" },
              { value: "segel", label: "Segel koli" },
            ]}
          />

          {inCarton.length > 0 && (
            <Section
              title={`Di koli ini · ${count(packed)} potong`}
              action={
                <span className="text-meta text-faint">
                  Ketuk untuk ketik jumlah
                </span>
              }
            >
              <div className="flex flex-col gap-2.5">
                {inCarton.map((line) => (
                  <TallyRow
                    key={line.sku_code}
                    name={nameOf(line.sku_code)}
                    code={line.sku_code}
                    have={line.quantity}
                    note={note(line.sku_code)}
                    tone={refusal(line.sku_code, 0) === null ? "normal" : "bad"}
                    onLess={() => change(line.sku_code, -1)}
                    onMore={() => change(line.sku_code, 1)}
                    onRemove={() => change(line.sku_code, -line.quantity)}
                    onCount={() =>
                      setRecount({ code: line.sku_code, open: true })
                    }
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
                <Section
                  title={`Ditunggu toko · ${count(rows.length)} SKU`}
                  className="mb-0"
                >
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
        </div>
      </MorphHeight>

      {/* The foot is outside the scroll, not sticky inside it: at 375px the
          queue is taller than the sheet, and the one action the sheet exists
          for has to stay under the thumb however far down the list it is. */}
      <div className="flex shrink-0 items-center gap-3 border-t border-hairline px-4 pt-3 pb-3">
        <span className="min-w-0">
          <span className="block text-metric font-semibold text-ink tabular-nums">
            {count(packed)}
          </span>
          <span
            className={
              refused
                ? "block truncate text-meta text-bad"
                : "block truncate text-meta text-mute"
            }
          >
            {refused ? "ada baris yang akan ditolak" : "potong di koli ini"}
          </span>
        </span>
        <div className="flex-1" />
        <Button
          variant="primary"
          size="lg"
          className="min-w-0"
          disabled={packed === 0 || refused}
          onClick={pack}
        >
          {seal === "segel" ? "Kemas & segel" : "Kemas"}
        </Button>
      </div>

      {/* Bounded by the same two limits as the scan box, asked of the typed
          number as the line's new total — the sheet replaces the line. */}
      <RecountSheet
        open={recount?.open === true}
        code={recount?.code ?? ""}
        name={recount === null ? "" : nameOf(recount.code)}
        have={recount === null ? 0 : (tally[recount.code] ?? 0)}
        note={recount === null ? null : note(recount.code)}
        where="koli"
        problem={(quantity) =>
          recount === null ? null : refusalAt(recount.code, quantity)
        }
        onSet={(quantity) => {
          if (recount === null) return
          set(recount.code, quantity)
          notice(
            quantity === 0
              ? `${nameOf(recount.code)} dikeluarkan dari koli.`
              : `${nameOf(recount.code)}: ${count(quantity)} potong di koli ini.`,
          )
        }}
        onClose={() =>
          setRecount((current) =>
            current === null ? null : { ...current, open: false },
          )
        }
      />
    </>
  )
}
