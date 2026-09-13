import { useQuery } from "@tanstack/react-query"
import { Check } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { MiniRow, MiniTable } from "@/components/ui/rows"
import { ActionBar, Screen } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import { ago, count, signed } from "@/lib/format"
import { useGo } from "@/lib/go"
import { enqueue } from "@/lib/outbox"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { reads } from "@/lib/queries"
import { useActor } from "@/lib/session"
import { cn } from "@/lib/utils"
import type { PurchaseCountAwaitingVerification } from "@itulah/contract"

/// The second pair of eyes.
///
/// Here everything is shown: what was ordered, what was counted, and the
/// difference between them. Accepting is what turns the goods into stock — it is
/// the only step on the bay that moves anything — so it is a deliberate press
/// against a list somebody has read, not a swipe on a row.
///
/// **A person cannot verify their own count.** The node refuses it outright
/// (`edge/sqlite.rs`: "counted this delivery and cannot also approve it"), and
/// this screen says so before the press rather than after: an outbox job that
/// was refused an hour later, on a phone in somebody's pocket, is a delivery
/// nobody knows is stuck.
export function TerimaPeriksa() {
  const go = useGo()
  const actor = useActor()
  const po = useParam("po").value
  const queue = useQuery(reads.verifyQueue())
  const [note, setNote] = useState("")
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set())

  const rows = useMemo(
    () => (queue.data ?? []).filter((row) => row.po_number === po),
    [queue.data, po],
  )

  // Everything is chosen until somebody un-chooses it. A verifier goes through a
  // delivery agreeing with it; the exceptions are what they touch.
  const picked = rows.filter((row) => !dropped.has(row.count_id))
  const mine = rows.some((row) => row.counted_by === actor)
  const countedBy = rows[0]?.counted_by ?? "—"

  const decide = (decision: "Accept" | "Recount") => {
    enqueue(
      {
        kind: "periksa",
        po_number: po ?? "",
        decision,
        note: note.trim() === "" ? null : note.trim(),
        count_ids: picked.map((row) => row.count_id),
      },
      actor,
    )
    go("/terima", { lihat: "periksa" }, { replace: true })
  }

  return (
    <>
      <Screen foot="none">
        {queryState(queue, {
          loading: "Menanyakan hitungan…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                Tidak ada hitungan yang menunggu di order itu. Mungkin sudah
                diperiksa orang lain.
              </EmptyState>
            ) : (
              <>
                <div className="pt-1 pb-4">
                  <h2 className="text-title font-semibold text-ink">
                    {po ?? "Order"}
                  </h2>
                  <p className="mt-0.5 text-meta text-body">
                    Dihitung {countedBy} · {ago(rows[0]?.counted_at ?? null)}
                  </p>
                </div>

                {mine ? (
                  <Banner tone="bad" className="mb-4">
                    Anda yang menghitung kiriman ini, jadi Anda tidak boleh
                    memeriksanya. Panggil orang kedua.
                  </Banner>
                ) : (
                  <Banner tone="info" className="mb-4">
                    Terima berarti barang ini jadi stok. Hitung ulang
                    mengembalikannya ke bay untuk dihitung lagi.
                  </Banner>
                )}

                <div className="mb-5 overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
                  <MiniTable head={["Barang", "Pesan", "Hitung", "Selisih"]}>
                    {rows.map((row) => (
                      <Row
                        key={row.count_id}
                        row={row}
                        chosen={!dropped.has(row.count_id)}
                        onToggle={() =>
                          setDropped((current) => {
                            const next = new Set(current)
                            if (next.has(row.count_id))
                              next.delete(row.count_id)
                            else next.add(row.count_id)
                            return next
                          })
                        }
                      />
                    ))}
                  </MiniTable>
                </div>

                <Field
                  label="Catatan"
                  hint="Ikut tersimpan pada keputusan. Kosongkan kalau tidak ada yang perlu dijelaskan."
                  className="mb-4"
                >
                  <Input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="mis. dua karton basah"
                  />
                </Field>
              </>
            ),
        })}
      </Screen>

      {rows.length > 0 && (
        <ActionBar>
          {/* Two buttons on a 375px screen, and the label is what decides
              whether they fit: `Button` is `shrink-0` everywhere in this kit, so
              a sentence in the primary one pushes the secondary off the glass
              rather than wrapping. The count is a number, not "N baris". */}
          <div className="flex items-center gap-2.5">
            <Button
              variant="ghost"
              size="lg"
              disabled={mine || picked.length === 0}
              onClick={() => decide("Recount")}
            >
              Hitung ulang
            </Button>
            <Button
              variant="primary"
              size="lg"
              block
              className="min-w-0 shrink"
              disabled={mine || picked.length === 0}
              onClick={() => decide("Accept")}
            >
              Terima {count(picked.length)}
            </Button>
          </div>
        </ActionBar>
      )}
    </>
  )
}

/// One counted line, and the tap target that drops it out of the decision.
///
/// The whole row toggles rather than a checkbox in a column: a checkbox sized
/// for a mouse is 16px, and this is read by a thumb over a pallet.
function Row({
  row,
  chosen,
  onToggle,
}: {
  row: PurchaseCountAwaitingVerification
  chosen: boolean
  onToggle: () => void
}) {
  return (
    <MiniRow
      className={cn("cursor-pointer", !chosen && "opacity-40")}
      onClick={onToggle}
    >
      <td>
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "grid size-[1.125rem] shrink-0 place-items-center rounded-[0.3125rem] border",
              chosen
                ? "border-accent bg-accent text-on-dark"
                : "border-hairline-2 bg-canvas",
            )}
          >
            {chosen && <Check className="size-3" strokeWidth={3} />}
          </span>
          <span className="min-w-0">
            <span className="block truncate">{row.article_name}</span>
            <span className="block truncate font-mono text-[0.65625rem] text-mute">
              {row.article_code}
            </span>
          </span>
        </span>
      </td>
      <td>{count(row.expected_stock_units)}</td>
      <td>{count(row.counted_quantity)}</td>
      <td>
        {row.variance === 0 ? (
          <Pill tone="ok">0</Pill>
        ) : (
          <Pill tone={row.variance > 0 ? "warn" : "bad"}>
            {signed(row.variance)}
          </Pill>
        )}
      </td>
    </MiniRow>
  )
}
