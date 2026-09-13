import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { ActionBar, Screen } from "@/components/ui/screen"
import { Banner, EmptyState } from "@/components/ui/states"
import { count } from "@/lib/format"
import { useGo } from "@/lib/go"
import { enqueue } from "@/lib/outbox"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import { reads } from "@/lib/queries"
import { useActor } from "@/lib/session"
import { groupByOrder } from "@/lib/work"
import type { PurchaseWorkLine } from "@itulah/contract"

/// The count sheet: what is physically on the pallet, written down by somebody
/// who has not been told what was ordered.
///
/// The order is read out of the URL rather than handed over in state, because a
/// phone on a bay sleeps, gets killed by the OS, and is reloaded by somebody who
/// thought the wifi had stuck — and a sheet that lost which lorry it was about
/// each time would be counted twice.
///
/// **Saving does not send.** It writes the count into the outbox and comes back
/// to the bay list; the sending is a durable job that survives the gangway, the
/// locked screen and the reload. What the person did is recorded the moment they
/// press the button, which is the only guarantee worth making to somebody
/// standing next to a pallet.
export function TerimaHitung() {
  const go = useGo()
  const actor = useActor()
  const po = useParam("po").value
  const work = useQuery(reads.purchaseWork())
  const [quantities, setQuantities] = useState<Record<string, string>>({})

  const order = useMemo(() => {
    const orders = groupByOrder(work.data ?? [])
    return orders.find((row) => row.po_number === po) ?? null
  }, [work.data, po])

  // Only lines somebody actually typed a number into. A blank is "I did not
  // count this", which is a different statement from zero — and zero is a real
  // count that has to be sendable, so it cannot be filtered out here.
  const entries = (order?.lines ?? []).flatMap((line) => {
    const typed = (quantities[line.po_line_id] ?? "").trim()
    if (typed === "") return []
    const quantity = Number(typed)
    if (!Number.isInteger(quantity) || quantity < 0) return []
    return [
      {
        po_line_id: line.po_line_id,
        article_code: line.article_code,
        quantity,
      },
    ]
  })

  return (
    <>
      <Screen foot="none">
        {queryState(work, {
          loading: "Menanyakan order…",
          render: () =>
            order === null ? (
              <EmptyState>
                Order itu tidak menunggu apa-apa lagi — sudah diterima, atau
                nomornya keliru.
              </EmptyState>
            ) : (
              <>
                <div className="pt-1 pb-4">
                  <h2 className="text-title font-semibold text-ink">
                    {order.supplier_name ?? order.supplier_id}
                  </h2>
                  <p className="mt-0.5 font-mono text-[0.6875rem] text-mute">
                    {order.po_number}
                  </p>
                </div>

                <Banner tone="info" className="mb-4">
                  Tulis apa yang benar-benar ada di pallet. Anda tidak
                  diperlihatkan jumlah yang dipesan — orang lain yang
                  membandingkannya, dan orang itu tidak boleh Anda.
                </Banner>

                <div className="flex flex-col gap-2.5">
                  {order.lines.map((line) => (
                    <Line
                      key={line.po_line_id}
                      line={line}
                      value={quantities[line.po_line_id] ?? ""}
                      onChange={(next) =>
                        setQuantities((current) => ({
                          ...current,
                          [line.po_line_id]: next,
                        }))
                      }
                    />
                  ))}
                </div>
              </>
            ),
        })}
      </Screen>

      {order !== null && (
        <ActionBar>
          <div className="flex items-center gap-3">
            <span className="text-meta text-mute">
              {entries.length === 0
                ? "Belum ada yang ditulis"
                : `${count(entries.length)} dari ${count(order.lines.length)} baris`}
            </span>
            <div className="flex-1" />
            <Button
              variant="primary"
              size="lg"
              disabled={entries.length === 0}
              onClick={() => {
                enqueue(
                  {
                    kind: "hitung",
                    po_number: order.po_number,
                    supplier_id: order.supplier_id,
                    lines: entries,
                  },
                  actor,
                )
                // Back to the bay, with the counting half showing: the next thing
                // this person does is either the next order or nothing, and
                // neither is on this sheet.
                go("/terima", { lihat: "hitung" }, { replace: true })
              }}
            >
              Simpan hitungan
            </Button>
          </div>
        </ActionBar>
      )}
    </>
  )
}

/// One line of the order. Name and code so it can be found on the pallet, what
/// has already come in against it, and a box for the number.
///
/// `inputMode="numeric"` rather than `type="number"`: a spinner on a phone is
/// two 12px arrows beside a field being tapped by somebody wearing gloves, and
/// the wheel gesture on it changes a count by scrolling past it.
function Line({
  line,
  value,
  onChange,
}: {
  line: PurchaseWorkLine
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-hairline bg-canvas px-3.5 py-3 shadow-soft">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">
          {line.article_name}
        </span>
        <span className="block truncate font-mono text-[0.65625rem] text-mute">
          {line.article_code} · baris {line.line_number}
        </span>
        {line.received_stock_units > 0 && (
          <Pill tone="ok" className="mt-1">
            {count(line.received_stock_units)} sudah masuk
          </Pill>
        )}
      </span>
      <Input
        className="w-24 text-center text-[1.0625rem] font-semibold"
        inputMode="numeric"
        autoComplete="off"
        placeholder="0"
        aria-label={`Jumlah dihitung untuk ${line.article_code}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
