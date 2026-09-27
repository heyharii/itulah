import { useQuery } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { MiniRow, MiniTable } from "@/components/ui/rows"
import { ActionBar, Screen } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import { ago, count } from "@/lib/format"
import { useGo } from "@/lib/go"
import { enqueue } from "@/lib/outbox"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { reads } from "@/lib/queries"
import { useActor } from "@/lib/session"

/// One tagging job: the variants it covers, and the one thing left to say about
/// it.
///
/// Confirming is not paperwork. It is what tells the node that this many pieces
/// of this article now exist as tracked units in the warehouse — so it is a
/// single deliberate press, after a person has looked at what is on the table
/// against what is on the screen, and it carries their name.
export function TagKerjaan() {
  const go = useGo()
  const actor = useActor()
  const id = useParam("id").value
  const jobs = useQuery(reads.taggingJobs())

  const job = (jobs.data ?? []).find((row) => row.job_id === id) ?? null
  // Whether the labels have actually come out of the printer. Printing
  // happens at the bench (the hub), so this phone would otherwise let somebody
  // confirm a job whose tags were never printed — and confirming is what makes
  // the pieces exist. Said, not enforced: labels printed some other way are
  // still labels.
  const run = useQuery({ ...reads.jobRun(id ?? ""), enabled: id !== null })
  const unprinted =
    job === null || run.data === undefined
      ? 0
      : run.data === null
        ? job.total_quantity
        : run.data.pending_count + run.data.failed_count

  return (
    <>
      <Screen foot="none">
        {queryState(jobs, {
          loading: "Menanyakan kerjaan…",
          render: () =>
            job === null ? (
              <EmptyState>
                Kerjaan itu sudah tidak menunggu — mungkin sudah dikonfirmasi
                orang lain.
              </EmptyState>
            ) : (
              <>
                <div className="pt-1 pb-4">
                  <h2 className="text-title font-semibold text-ink">
                    {job.article_name}
                  </h2>
                  <p className="mt-0.5 font-mono text-[0.6875rem] text-mute">
                    {job.article_code} · {ago(job.issued_at)}
                  </p>
                </div>

                {unprinted > 0 && (
                  <Banner tone="warn" className="mb-4">
                    {run.data === null
                      ? "Label kerjaan ini belum dicetak sama sekali."
                      : `${count(unprinted)} dari ${count(job.total_quantity)} label belum tercetak.`}{" "}
                    Cetak dulu di meja cetak, baru konfirmasi.
                  </Banner>
                )}

                <Banner tone="info" className="mb-4">
                  Konfirmasi berarti label sudah menempel di barangnya. Setelah
                  itu {count(job.total_quantity)} potong tercatat ada di gudang
                  ini.
                </Banner>

                <div className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
                  <MiniTable head={["Varian", "SKU", "Jumlah"]}>
                    {job.lines.map((line) => (
                      <MiniRow key={line.sku_code}>
                        <td>
                          {line.colour_label} · {line.size_label}
                        </td>
                        <td className="font-mono text-[0.65625rem]">
                          {line.sku_code}
                        </td>
                        <td>{count(line.quantity)}</td>
                      </MiniRow>
                    ))}
                  </MiniTable>
                </div>
              </>
            ),
        })}
      </Screen>

      {job !== null && (
        <ActionBar>
          <Button
            variant="primary"
            size="lg"
            block
            onClick={() => {
              enqueue(
                {
                  kind: "tag",
                  job_id: job.job_id,
                  article_code: job.article_code,
                  quantity: job.total_quantity,
                },
                actor,
              )
              go("/tag", undefined, { replace: true })
            }}
          >
            Tag sudah terpasang — konfirmasi
          </Button>
        </ActionBar>
      )}
    </>
  )
}
