import { useQuery } from "@tanstack/react-query"
import { ClipboardCheck, Truck } from "lucide-react"
import { useMemo } from "react"

import { RecordCard } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { CardList, Screen, Section } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { ago, count, signed } from "@/lib/format"
import { useGo } from "@/lib/go"
import { pendingOf, useOutbox } from "@/lib/outbox"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { reads } from "@/lib/queries"
import { groupByOrder } from "@/lib/work"
import type {
  PurchaseCountAwaitingVerification,
  PurchaseWorkLine,
} from "@itulah/contract"

/// The loading bay.
///
/// The ceremony is the node's and this screen does not soften it: a delivery is
/// **counted** by somebody who is not shown what was ordered, then **verified**
/// by somebody else who is shown everything, and only that second step turns
/// goods into stock. So the two halves are two slices of one screen rather than
/// two places to be — a person walks over to a lorry, not to a tab.
///
/// **The counting list shows no quantity.** Not a single expected number reaches
/// this half of the screen, and that is the whole point of the ceremony: a
/// counter who has seen "120" counts to 120. The lines are there so somebody can
/// find the order on the paperwork in their hand; the numbers are on the other
/// slice, where the verifier is entitled to them.
export function Terima() {
  const go = useGo()
  const view = useParam("lihat")
  const slice = view.value === "periksa" ? "periksa" : "hitung"

  const work = useQuery(reads.purchaseWork())
  const queue = useQuery(reads.verifyQueue())
  const pendingCounts = pendingOf(useOutbox(), "hitung")
  const pendingChecks = pendingOf(useOutbox(), "periksa")

  return (
    <Screen>
      <div className="pt-1 pb-4">
        <Segmented
          value={slice}
          onChange={(next) => view.set(next)}
          options={[
            { value: "hitung", label: "Hitung" },
            { value: "periksa", label: "Periksa" },
          ]}
        />
      </div>

      {slice === "hitung" ? (
        <>
          {pendingCounts.length > 0 && (
            <Banner tone="warn" className="mb-4">
              {count(pendingCounts.length)} hitungan tersimpan di HP ini dan
              belum sampai ke node.
            </Banner>
          )}
          {queryState(work, {
            loading: "Menanyakan order yang belum datang…",
            render: (lines) => <Owed lines={lines} onOpen={(po) => go("/terima/hitung", { po })} />,
          })}
        </>
      ) : (
        <>
          {pendingChecks.length > 0 && (
            <Banner tone="warn" className="mb-4">
              {count(pendingChecks.length)} pemeriksaan tersimpan di HP ini dan
              belum sampai ke node.
            </Banner>
          )}
          {queryState(queue, {
            loading: "Menanyakan hitungan yang menunggu…",
            render: (rows) => (
              <ToVerify rows={rows} onOpen={(po) => go("/terima/periksa", { po })} />
            ),
          })}
        </>
      )}
    </Screen>
  )
}

/// Orders this node is still owed a delivery against, one card per order.
///
/// Grouped by PO rather than listed by line because a lorry arrives against an
/// order: nine lines owed on one order is one thing to walk over to, and nine
/// cards would be nine decisions about the same pallet.
function Owed({
  lines,
  onOpen,
}: {
  lines: readonly PurchaseWorkLine[]
  onOpen: (po: string) => void
}) {
  const orders = useMemo(() => groupByOrder(lines), [lines])

  if (orders.length === 0) {
    return (
      <EmptyState>
        Tidak ada order yang masih ditunggu. Begitu pusat mengaktifkan PO baru,
        order itu muncul di sini.
      </EmptyState>
    )
  }

  return (
    <Section title="Order menunggu bongkar">
      <CardList>
        {orders.map((order) => (
          <RecordCard
            key={order.po_number}
            icon={<Truck />}
            id={order.po_number}
            status={<Pill tone="info">{count(order.lines.length)} baris</Pill>}
            onPress={() => onOpen(order.po_number)}
          >
            <div className="px-3.5 pt-2 pb-3">
              <KeyValue term="Pemasok">
                {order.supplier_name ?? order.supplier_id}
              </KeyValue>
              <KeyValue term="Aktif sejak">{ago(order.activated_at)}</KeyValue>
            </div>
          </RecordCard>
        ))}
      </CardList>
    </Section>
  )
}

/// Counts waiting for a second person.
///
/// Here the numbers are shown, all of them: the verifier is the one who is meant
/// to see the difference between what was ordered and what was counted, and
/// hiding it would leave them approving a number they cannot judge.
function ToVerify({
  rows,
  onOpen,
}: {
  rows: readonly PurchaseCountAwaitingVerification[]
  onOpen: (po: string) => void
}) {
  const orders = useMemo(() => {
    const byOrder = new Map<string, PurchaseCountAwaitingVerification[]>()
    for (const row of rows) {
      const held = byOrder.get(row.po_number)
      if (held === undefined) byOrder.set(row.po_number, [row])
      else held.push(row)
    }
    return [...byOrder.entries()].map(([po_number, counts]) => ({
      po_number,
      counts,
      off: counts.filter((row) => row.variance !== 0).length,
      counted_by: counts[0]?.counted_by ?? "—",
      counted_at: counts[0]?.counted_at ?? null,
    }))
  }, [rows])

  if (orders.length === 0) {
    return (
      <EmptyState>
        Tidak ada hitungan yang menunggu. Hitungan muncul di sini begitu orang
        lain selesai menghitung sebuah kiriman.
      </EmptyState>
    )
  }

  return (
    <Section title="Menunggu diperiksa">
      <CardList>
        {orders.map((order) => (
          <RecordCard
            key={order.po_number}
            icon={<ClipboardCheck />}
            id={order.po_number}
            status={
              order.off === 0 ? (
                <Pill tone="ok">Cocok</Pill>
              ) : (
                <Pill tone="warn">{count(order.off)} selisih</Pill>
              )
            }
            onPress={() => onOpen(order.po_number)}
          >
            <div className="px-3.5 pt-2 pb-3">
              <KeyValue term="Baris dihitung">
                {count(order.counts.length)}
              </KeyValue>
              <KeyValue term="Dihitung oleh">{order.counted_by}</KeyValue>
              <KeyValue term="Kapan">{ago(order.counted_at)}</KeyValue>
              <KeyValue
                term="Selisih total"
                tone={sumVariance(order.counts) === 0 ? "normal" : "bad"}
              >
                {signed(sumVariance(order.counts))}
              </KeyValue>
            </div>
          </RecordCard>
        ))}
      </CardList>
    </Section>
  )
}

function sumVariance(
  rows: readonly PurchaseCountAwaitingVerification[],
): number {
  return rows.reduce((total, row) => total + row.variance, 0)
}
