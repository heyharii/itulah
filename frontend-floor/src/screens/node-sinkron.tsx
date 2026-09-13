import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Radio, Send, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { RecordCard } from "@/components/ui/card"
import { BigNumber } from "@/components/ui/kpi"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { ActionBar, Screen, Section } from "@/components/ui/screen"
import { Banner } from "@/components/ui/states"
import { Tag as Code } from "@/components/ui/tag"
import { sync } from "@/lib/api"
import { describe } from "@/lib/errors"
import { ago, count } from "@/lib/format"
import { useGo } from "@/lib/go"
import { unsentCount, useOutbox } from "@/lib/outbox"
import { keys, reads } from "@/lib/queries"
import { useNodeIdentity } from "@/lib/session"
import { syncHealth, type SyncHealth } from "@itulah/contract/client"

/// How often to ask. The sender's own cycle is five seconds, so polling much
/// faster only makes the screen busy without making it more truthful.
const POLL_MS = 5_000

/// Whether today's work has reached head office.
///
/// There are **two** backlogs on this screen and they are different things,
/// which is why they are shown apart:
///
///   - the node's outbox — facts captured in this building's SQLite that head
///     office has not acknowledged. That is what would be lost if the warehouse
///     burned down tonight.
///   - this phone's queue — counts, picks and packs done on this browser that
///     have not reached the node in the building. Those are not in the node's
///     number at all, because the node has never seen them.
///
/// A screen that showed only the first would say "semua terkirim" while a phone
/// in somebody's apron held eleven cartons' worth of work.
export function NodeSinkron() {
  const go = useGo()
  const client = useQueryClient()
  const where = useNodeIdentity()
  const queue = useOutbox()
  const unsent = unsentCount(queue)

  const backlog = useQuery({ ...reads.syncStatus(), refetchInterval: POLL_MS })

  const send = useMutation({
    mutationFn: () => sync.trigger(),
    // Whether the sender ran or refused to, the backlog on screen was read
    // before it happened.
    onSettled: () => client.invalidateQueries({ queryKey: keys.syncStatus() }),
  })

  const status = backlog.data
  const health: SyncHealth | null =
    status === undefined ? null : syncHealth(status)

  // A refusal is not a failure: the request reached the node and the node said
  // no, which is worth reading in the same place as a request that never
  // arrived.
  const refusal =
    send.data === undefined || send.data.triggered
      ? null
      : (send.data.reason ?? "node ini tidak punya pengirim")
  const problem =
    backlog.error !== null
      ? describe(backlog.error)
      : send.error !== null
        ? describe(send.error)
        : refusal

  return (
    <>
      <Screen foot="none">
        <div className="py-5">
          <BigNumber
            label="Belum sampai pusat"
            value={status === undefined ? "…" : count(status.pending_facts)}
            tone={
              health === "blocked" ? "bad" : health === "current" ? "ok" : "ink"
            }
            sub={health === null ? "Membaca node ini…" : HEADLINE[health]}
          />
        </div>

        {problem !== null && (
          <Banner tone="bad" className="mb-4">
            {problem}
          </Banner>
        )}

        {unsent > 0 && (
          <Banner
            tone="warn"
            className="mb-4"
            action={
              <button
                type="button"
                onClick={() => go("/node/antrean")}
                className="shrink-0 underline underline-offset-2"
              >
                Buka
              </button>
            }
          >
            {count(unsent)} pekerjaan masih di HP ini dan belum sampai ke node —
            jadi belum ikut terhitung di angka atas.
          </Banner>
        )}

        {status !== undefined && (
          <Section title="Outbox node ini">
            <RecordCard
              icon={<Radio />}
              id={where.data?.site_id ?? where.data?.node_id ?? "Node ini"}
              status={
                health === null ? undefined : (
                  <Pill tone={TONE[health]}>{WORD[health]}</Pill>
                )
              }
            >
              <div className="px-3 pt-1 pb-3">
                <KeyValue term="Terkonfirmasi sampai">
                  {status.durable_through}
                </KeyValue>
                <KeyValue term="Terakhir terkirim">
                  {ago(status.last_success_at)}
                </KeyValue>
                {status.dead_lettered > 0 && (
                  <KeyValue term="Ditolak pusat" tone="bad">
                    {/* These never retry. Somebody has to look at them. */}
                    {count(status.dead_lettered)} — perlu orang
                  </KeyValue>
                )}
                {status.consecutive_failures > 0 && (
                  <KeyValue term="Gagal berturut-turut" tone="bad">
                    {count(status.consecutive_failures)}
                  </KeyValue>
                )}
                {status.interval_seconds !== null && (
                  <KeyValue term="Kirim tiap">
                    {status.interval_seconds} detik
                  </KeyValue>
                )}
              </div>
              {status.origin_id !== null && (
                <div className="flex items-center justify-between gap-3 border-t border-hairline px-3 py-2.5">
                  <Code>{status.origin_id}</Code>
                  <span className="text-meta text-mute">
                    generasi {status.generation}
                  </span>
                </div>
              )}
            </RecordCard>

            {status.last_error !== null && (
              <Banner tone="bad" className="mt-3">
                {status.last_error}
              </Banner>
            )}

            {!status.sender_enabled && (
              <Banner tone="warn" className="mt-3">
                Node ini tidak punya alamat unggah. Semua yang dicatatnya tetap
                tersimpan dan aman — tetapi tidak ada yang dikirim ke mana pun,
                dan pusat tidak bisa melihat hari ini.
              </Banner>
            )}
          </Section>
        )}
      </Screen>

      <ActionBar>
        <div className="flex gap-2.5">
          {unsent > 0 && (
            <Button size="lg" onClick={() => go("/node/antrean")}>
              <Upload />
              {count(unsent)}
            </Button>
          )}
          <Button
            variant="primary"
            size="lg"
            block
            disabled={send.isPending || status?.sender_enabled !== true}
            onClick={() => send.mutate()}
          >
            <Send />
            {send.isPending ? "Mengirim…" : "Kirim sekarang"}
          </Button>
        </div>
        {/* Said plainly rather than hidden behind a disabled button: asking for a
            send during a cooldown would only hide the outage. */}
        {status !== undefined && status.breaker_open_until !== null && (
          <p className="mt-2 text-center text-meta text-mute">
            Menekan kirim tidak memperpendek jeda. Pengirim sedang menunggu
            dengan sengaja.
          </p>
        )}
      </ActionBar>
    </>
  )
}

const HEADLINE: Record<SyncHealth, string> = {
  current: "Semua yang dicatat gudang ini sudah sampai di pusat.",
  behind: "Masih antre dikirim. Ini biasa dan beres sendiri.",
  blocked: "Tidak tembus. Ada yang harus dilihat orang.",
  off: "Tidak ada yang diunggah dari node ini.",
}

const TONE = {
  current: "ok",
  behind: "warn",
  blocked: "bad",
  off: "neutral",
} as const

const WORD = {
  current: "Terkini",
  behind: "Mengirim",
  blocked: "Macet",
  off: "Mati",
} as const
