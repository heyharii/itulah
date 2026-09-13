import { useQuery } from "@tanstack/react-query"

import { Pill } from "@/components/ui/pill"
import { KeyValue, MiniRow, MiniTable } from "@/components/ui/rows"
import { Screen, Section } from "@/components/ui/screen"
import { EmptyState } from "@/components/ui/states"
import { count, label, moment, toneFor } from "@/lib/format"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { reads } from "@/lib/queries"

/// One picking round, after the fact.
///
/// Read-only, and that is not an omission. A round is closed by the node the
/// moment it is created — `create_picklist` opens the session, records the picks
/// and closes it in one transaction — so there is nothing on this screen to
/// press. What somebody wants from it is the answer to "did the round I saved
/// twenty minutes ago actually land, and with what in it".
export function AmbilRonde() {
  const id = useParam("id").value
  const round = useQuery({
    ...reads.pickRound(id ?? ""),
    enabled: id !== undefined,
  })
  const picked = round.data?.lines ?? []
  const names = useQuery(reads.names(picked.map((line) => line.sku_code)))

  if (id === undefined) {
    return (
      <Screen foot="none">
        <EmptyState>Ronde tidak disebut di alamat layar ini.</EmptyState>
      </Screen>
    )
  }

  return (
    <Screen foot="none">
      {queryState(round, {
        loading: "Menanyakan ronde…",
        render: (summary) => (
          <>
            <div className="pt-1 pb-4">
              <h2 className="text-title font-semibold text-ink">
                {count(summary.total_picked)} potong
              </h2>
              <p className="mt-0.5 text-meta text-body">
                {count(summary.sku_count)} SKU · {summary.session.actor_id}
              </p>
            </div>

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

            <Section title="Isi ronde">
              <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
                <MiniTable head={["Barang", "SKU", "Diambil"]}>
                  {picked.map((line) => (
                    <MiniRow key={line.sku_code}>
                      <td>
                        {names.data?.get(line.sku_code)?.name ?? "—"}
                      </td>
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
    </Screen>
  )
}
