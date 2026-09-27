import { useQuery } from "@tanstack/react-query"
import { ClipboardCheck, Truck } from "lucide-react"
import { useMemo, useState } from "react"

import { RecordCard } from "@/components/ui/card"
import { KeyValue } from "@/components/ui/rows"
import { CardList, Screen, Section } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { ago, count, signed } from "@/lib/format"
import { pendingOf, useOutbox } from "@/lib/outbox"
import { useParam, useSheetParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { reads } from "@/lib/queries"
import { groupByOrder } from "@/lib/work"
import {
  CheckStatus,
  CountStatus,
  HitungSheet,
  PeriksaSheet,
} from "@/screens/terima-sheets"
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
///
/// **An order opens in a sheet over the list, not on a screen of its own.** The
/// list stays under it and a swipe down puts it away, so the next lorry is one
/// tap from the last one saved. Which order is open is `?po=` — a reload, or a
/// tab the OS killed, reopens the same sheet — and what was typed into it is a
/// draft on the phone, which the order's card owns up to.
///
/// **Back puts the sheet away.** A card tap pushes an entry for the sheet
/// (`useSheetParam`), and every way of closing it — the swipe, the backdrop,
/// the save, the decision — goes back through that entry, so the phone's back
/// button does the same and nothing stale is left behind the list.
export function Terima() {
  const view = useParam("lihat")
  const po = useSheetParam("po")
  const slice = view.value === "periksa" ? "periksa" : "hitung"

  const work = useQuery(reads.purchaseWork())
  const queue = useQuery(reads.verifyQueue())
  const pendingCounts = pendingOf(useOutbox(), "hitung")
  const pendingChecks = pendingOf(useOutbox(), "periksa")

  // The order a close was asked for on, until the URL has caught up.
  //
  // Going back is answered by a `popstate`, not at once, and Base UI's drawer
  // looks on the very next frame to see whether its close was taken: a sheet
  // still open then is put back, and a swipe that let go snapped up under the
  // finger before sliding away. So the sheet is closed here, in the press, and
  // the URL follows. It is also what makes a second close a no-op — two
  // `history.back()`s before the first lands would walk off the bay.
  const [closing, setClosing] = useState<string | undefined>(undefined)
  const [was, setWas] = useState(po.value)
  if (po.value !== was) {
    setWas(po.value)
    setClosing(undefined)
  }
  const shown = po.value === closing ? undefined : po.value

  // A card tap is a fresh opening, whatever was on its way out a moment ago.
  const open = (next: string) => {
    setClosing(undefined)
    po.open(next)
  }
  const close = () => {
    if (shown === undefined) return
    setClosing(shown)
    po.close()
  }

  return (
    <>
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
              render: (lines) => <Owed lines={lines} onOpen={open} />,
            })}
          </>
        ) : (
          <>
            {pendingChecks.length > 0 && (
              <Banner tone="warn" className="mb-4">
                {count(pendingChecks.length)} pemeriksaan tersimpan di HP ini
                dan belum sampai ke node.
              </Banner>
            )}
            {queryState(queue, {
              loading: "Menanyakan hitungan yang menunggu…",
              render: (rows) => <ToVerify rows={rows} onOpen={open} />,
            })}
          </>
        )}
      </Screen>

      {/* Each sheet opens only on its own slice: the same `?po=` is a count on
        one half and a verification on the other, and the two rising over each
        other would be neither. */}
      <HitungSheet
        po={slice === "hitung" ? shown : undefined}
        onClose={close}
      />
      <PeriksaSheet
        po={slice === "periksa" ? shown : undefined}
        onClose={close}
      />
    </>
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
            status={<CountStatus order={order} />}
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
            status={<CheckStatus po={order.po_number} off={order.off} />}
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
