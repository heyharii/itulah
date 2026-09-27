import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { Pill } from "@/components/ui/pill"
import { BottomSheet, MorphHeight } from "@/components/ui/picker-sheet"
import { KeyValue, MiniRow, MiniTable } from "@/components/ui/rows"
import { Section } from "@/components/ui/screen"
import { count, label, moment, toneFor } from "@/lib/format"
import { useGo } from "@/lib/go"
import { useParam, type Search } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { reads } from "@/lib/queries"

/// One picking round, after the fact.
///
/// Read-only, and that is not an omission. A round is closed by the node the
/// moment it is created — `create_picklist` opens the session, records the picks
/// and closes it in one transaction — so there is nothing on this sheet to
/// press. What somebody wants from it is the answer to "did the round I saved
/// twenty minutes ago actually land, and with what in it".
///
/// A **sheet over the station**, not a pushed screen, for exactly that reason:
/// it is opened from "Ronde terakhir" to check one thing and put away again, and
/// what the picker goes back to is the scan box and the trolley, which a push
/// took off the glass and a sheet leaves where they were. Which round is open
/// is `?id=` on `/ambil`, so a phone that sleeps with it open wakes up with it
/// open, and the station opens it with `useSheetParam`, so Android's back
/// button puts it away rather than leaving the station.
export function RondeSheet({
  id,
  onClose,
}: {
  /// The round to show; `undefined` is "no sheet".
  id: string | undefined
  onClose: () => void
}) {
  // The round on the glass, kept after `id` goes. The sheet slides away over
  // its own content, and one that emptied as it left would flash "Menanyakan
  // ronde…" on the way down. Adjusted during render, not in an effect: an
  // effect would draw one frame of the previous round first.
  const [shown, setShown] = useState(id)
  if (id !== undefined && id !== shown) setShown(id)

  const round = useQuery({
    ...reads.pickRound(shown ?? ""),
    enabled: shown !== undefined,
  })
  const picked = round.data?.lines ?? []
  const names = useQuery(reads.names(picked.map((line) => line.sku_code)))

  return (
    <BottomSheet
      open={id !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={
        round.data === undefined
          ? "Ronde"
          : `Ronde · ${count(round.data.total_picked)} potong`
      }
    >
      {/* One page per round: the sheet rises on the waiting sentence and the
          height travels to the round once it is here, rather than jumping. */}
      <MorphHeight page={shown ?? ""}>
        <div className="px-4 pb-4">
          {queryState(round, {
            loading: "Menanyakan ronde…",
            render: (summary) => (
              <>
                <p className="-mt-1 mb-4 text-meta text-body">
                  {count(summary.sku_count)} SKU · {summary.session.actor_id}
                </p>

                <Section>
                  <div className="rounded-card border border-hairline bg-canvas px-3.5 py-2 shadow-soft">
                    <KeyValue term="Status">
                      <Pill tone={toneFor(summary.session.status)}>
                        {label(summary.session.status)}
                      </Pill>
                    </KeyValue>
                    <KeyValue term="Mulai">
                      {moment(summary.session.started_at)}
                    </KeyValue>
                    <KeyValue term="Ditutup">
                      {moment(summary.session.closed_at)}
                    </KeyValue>
                  </div>
                </Section>

                <Section title="Isi ronde" className="mb-0">
                  <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
                    <MiniTable head={["Barang", "SKU", "Diambil"]}>
                      {picked.map((line) => (
                        <MiniRow key={line.sku_code}>
                          <td>{names.data?.get(line.sku_code)?.name ?? "—"}</td>
                          <td className="font-mono text-[0.65625rem]">
                            {line.sku_code}
                          </td>
                          <td>{count(line.picked)}</td>
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
    </BottomSheet>
  )
}

/// `/ambil/ronde`, where a round used to be pushed to.
///
/// The round is a sheet on the station now (`RondeSheet` above), and this path
/// stays so that what still points here — a link somebody kept, the back stack
/// of a phone that slept through the change — lands on the same round: it hands
/// over to `/ambil?id=…` and does not leave itself behind the back arrow.
///
/// A replace, not the sheet's own push: whatever is behind this entry is not
/// known to be the station, so the sheet it lands on carries no mark of having
/// been pushed, and closing it replaces as well (see `useSheetParam`) — the
/// picker is left on the station rather than sent back to wherever the link
/// came from.
export function AmbilRonde() {
  const go = useGo()
  const id = useParam("id").value
  const rak = useParam("rak").value
  // Once. `go` is a fresh function every render, and a second navigation to
  // the same place while the first is still settling is noise in the history.
  const handed = useRef(false)

  useEffect(() => {
    if (handed.current) return
    handed.current = true
    const search: Search = {}
    if (id !== undefined) search.id = id
    if (rak !== undefined) search.rak = rak
    go("/ambil", search, { replace: true })
  }, [go, id, rak])

  return null
}
