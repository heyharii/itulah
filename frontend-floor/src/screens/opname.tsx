import { useQuery } from "@tanstack/react-query"
import { ClipboardCheck } from "lucide-react"

import { RecordCard } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { CardList, Screen, Section } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import { ago, count, label, signed, toneFor } from "@/lib/format"
import { useGo } from "@/lib/go"
import { pendingOf, useOutbox } from "@/lib/outbox"
import { queryState } from "@/lib/query-state"
import { reads } from "@/lib/queries"

/// Stock takes this node has been told to walk.
///
/// A count is **not** started here, and that is not a missing feature. An
/// official count is the only thing in this estate allowed to tell the ledger it
/// is wrong: it is opened at head office against a named pool with a reason, and
/// this building is sent the instruction. What the floor does is the part only
/// the floor can do — walk the racks with a reader and say what is actually
/// there.
///
/// So this list is a work list, and the only counts on it that can be worked are
/// the ones the centre has activated.
export function Opname() {
  const go = useGo()
  const counts = useQuery(reads.counts())
  const pending = pendingOf(useOutbox(), "opname")

  return (
    <Screen>
      {pending.length > 0 && (
        <Banner tone="warn" className="mt-1 mb-4">
          {count(pending.length)} hasil opname tersimpan di HP ini dan belum
          sampai ke node.
        </Banner>
      )}

      {queryState(counts, {
        loading: "Menanyakan opname…",
        render: (rows) =>
          rows.length === 0 ? (
            <EmptyState>
              Tidak ada opname. Opname dibuka dari pusat, terhadap satu pool dan
              dengan alasan tertulis.
            </EmptyState>
          ) : (
            <Section title={`${count(rows.length)} opname`} className="pt-1">
              <CardList>
                {rows.map((row) => {
                  const difference = row.found - row.expected
                  return (
                    <RecordCard
                      key={row.count_id}
                      icon={<ClipboardCheck />}
                      id={label(row.kind)}
                      status={
                        <Pill tone={toneFor(row.status)}>
                          {label(row.status)}
                        </Pill>
                      }
                      onPress={() => go("/opname/lembar", { id: row.count_id })}
                    >
                      <div className="px-3.5 pt-2 pb-3">
                        <KeyValue term="Pool">{row.pool_id}</KeyValue>
                        <KeyValue term="Alasan">{row.reason}</KeyValue>
                        <KeyValue term="Diharapkan">
                          {count(row.expected)}
                        </KeyValue>
                        <KeyValue
                          term="Ditemukan"
                          tone={
                            row.found === 0
                              ? "normal"
                              : difference === 0
                                ? "ok"
                                : "bad"
                          }
                        >
                          {count(row.found)}
                          {row.found > 0 && difference !== 0
                            ? ` (${signed(difference)})`
                            : ""}
                        </KeyValue>
                        <KeyValue term="Dibuka">{ago(row.activated_at)}</KeyValue>
                      </div>
                    </RecordCard>
                  )
                })}
              </CardList>
            </Section>
          ),
      })}
    </Screen>
  )
}
