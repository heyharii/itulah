import { useQuery } from "@tanstack/react-query"
import { Tags } from "lucide-react"

import { RecordCard } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { CardList, Screen, Section } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import { ago, count } from "@/lib/format"
import { useGo } from "@/lib/go"
import { pendingOf, useOutbox } from "@/lib/outbox"
import { queryState } from "@/lib/query-state"
import { reads } from "@/lib/queries"

/// The tagging bench, on a phone.
///
/// A job is an article's worth of labels the centre has already minted — the
/// EPCs arrive as finished strings and this building never computes one. What is
/// left to do is physical: print them at the bench, attach them, and then say so.
///
/// **Only the saying-so is here.** Printing needs a printer on this node's
/// network, a session, a chunk runner and a preview, and that is a bench screen
/// on a machine beside the printer — it is in the hub's Operations module and it
/// stays there. Confirming is the step that actually puts the units into the
/// warehouse, and it is the step somebody does standing over a table with tags in
/// their hand, which is what this app is for.
export function Tag() {
  const go = useGo()
  const jobs = useQuery(reads.taggingJobs())
  const pending = pendingOf(useOutbox(), "tag")

  return (
    <Screen>
      {pending.length > 0 && (
        <Banner tone="warn" className="mt-1 mb-4">
          {count(pending.length)} konfirmasi tersimpan di HP ini dan belum sampai
          ke node.
        </Banner>
      )}

      {queryState(jobs, {
        loading: "Menanyakan kerjaan tag…",
        render: (rows) =>
          rows.length === 0 ? (
            <EmptyState>
              Tidak ada kerjaan tag. Kerjaan muncul di sini setelah sebuah
              kiriman diterima dan pusat mengirim label untuknya.
            </EmptyState>
          ) : (
            <Section title="Belum dikonfirmasi" className="pt-1">
              <CardList>
                {rows.map((job) => (
                  <RecordCard
                    key={job.job_id}
                    icon={<Tags />}
                    id={job.article_name}
                    status={
                      <Pill tone="warn">{count(job.total_quantity)} label</Pill>
                    }
                    onPress={() => go("/tag/kerjaan", { id: job.job_id })}
                  >
                    <div className="px-3.5 pt-2 pb-3">
                      <KeyValue term="Artikel">{job.article_code}</KeyValue>
                      <KeyValue term="Varian">
                        {count(job.lines.length)}
                      </KeyValue>
                      <KeyValue term="Diterbitkan">{ago(job.issued_at)}</KeyValue>
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
