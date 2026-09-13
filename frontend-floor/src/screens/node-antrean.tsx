import {
  Boxes,
  ClipboardCheck,
  ClipboardList,
  ListChecks,
  Tags,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { RecordCard } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { CardList, Screen, Section } from "@/components/ui/screen"
import { EmptyState } from "@/components/ui/states"
import { ago, count } from "@/lib/format"
import {
  acknowledge,
  dismissRefused,
  flush,
  retryRefused,
  useOutbox,
  type Job,
  type JobWork,
} from "@/lib/outbox"
import { describeJob } from "@/lib/work"

/// What this phone is holding that the node has not taken yet.
///
/// It exists because the outbox is otherwise invisible, and an invisible queue is
/// one nobody trusts: somebody who counted a lorry in a dead spot needs to be
/// able to look at the thing that is holding their count and see that it is
/// still there, still trying, and what it will say when it lands.
///
/// Three groups, and the order is the order of urgency: what was **refused**
/// needs a person, what is **waiting** needs the network, what **landed** is
/// there so the person who did it can see that it did.
export function NodeAntrean() {
  const queue = useOutbox()

  const refused = queue.filter((job) => job.state === "refused")
  const waiting = queue.filter(
    (job) => job.state === "waiting" || job.state === "sending",
  )
  const landed = queue
    .filter((job) => job.state === "settled")
    .slice()
    .reverse()

  return (
    <Screen foot="none">
      {queue.length === 0 ? (
        <EmptyState>
          Tidak ada apa-apa di HP ini. Semua yang Anda kerjakan sudah sampai ke
          node.
        </EmptyState>
      ) : (
        <>
          {refused.length > 0 && (
            <Section title={`Ditolak · ${count(refused.length)}`}>
              <CardList>
                {refused.map((job) => (
                  <JobCard
                    key={job.localId}
                    job={job}
                    tone="bad"
                    word="ditolak"
                    action={
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          onClick={() => retryRefused(job.localId)}
                        >
                          Coba lagi
                        </Button>
                        <Button
                          variant="quiet"
                          onClick={() => {
                            if (
                              window.confirm(
                                "Buang pekerjaan ini? Catatannya hilang dari HP dan tidak pernah sampai ke node.",
                              )
                            ) {
                              dismissRefused(job.localId)
                            }
                          }}
                        >
                          Buang
                        </Button>
                      </div>
                    }
                  />
                ))}
              </CardList>
            </Section>
          )}

          {waiting.length > 0 && (
            <Section
              title={`Menunggu jaringan · ${count(waiting.length)}`}
              action={
                <Button variant="quiet" onClick={() => void flush()}>
                  Kirim sekarang
                </Button>
              }
            >
              <CardList>
                {waiting.map((job) => (
                  <JobCard
                    key={job.localId}
                    job={job}
                    tone="warn"
                    word={job.state === "sending" ? "mengirim" : "menunggu"}
                  />
                ))}
              </CardList>
            </Section>
          )}

          {landed.length > 0 && (
            <Section title="Sudah sampai">
              <CardList>
                {landed.map((job) => (
                  <JobCard
                    key={job.localId}
                    job={job}
                    tone={job.partial ? "warn" : "ok"}
                    word={job.partial ? "sebagian" : "sampai"}
                    action={
                      job.partial ? (
                        <Button
                          variant="ghost"
                          onClick={() => acknowledge(job.localId)}
                        >
                          Saya paham
                        </Button>
                      ) : undefined
                    }
                  />
                ))}
              </CardList>
            </Section>
          )}
        </>
      )}
    </Screen>
  )
}

function JobCard({
  job,
  tone,
  word,
  action,
}: {
  job: Job
  tone: "ok" | "warn" | "bad"
  word: string
  action?: React.ReactNode
}) {
  const Icon = ICON[job.work.kind]
  return (
    <RecordCard
      icon={<Icon />}
      id={describeJob(job.work)}
      status={<Pill tone={tone}>{word}</Pill>}
    >
      <div className="px-3.5 pt-2 pb-3">
        <KeyValue term="Oleh">{job.actor}</KeyValue>
        <KeyValue term="Disimpan">{ago(job.queuedAt)}</KeyValue>
        {job.attempts > 1 && (
          <KeyValue term="Percobaan">{count(job.attempts)}</KeyValue>
        )}
        {job.outcome !== null && (
          <KeyValue term="Jawaban node">{job.outcome}</KeyValue>
        )}
        {job.lastError !== null && job.state !== "settled" && (
          <KeyValue term="Masalah" tone="bad">
            {job.lastError}
          </KeyValue>
        )}
        {action !== undefined && <div className="pt-2.5">{action}</div>}
      </div>
    </RecordCard>
  )
}

const ICON: Record<JobWork["kind"], LucideIcon> = {
  hitung: ClipboardList,
  periksa: ClipboardCheck,
  tag: Tags,
  ambil: ListChecks,
  kemas: Boxes,
  opname: ClipboardCheck,
}
