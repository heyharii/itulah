import { useState } from "react"

import { PageHeader } from "@/components/ui/page-header"
import { Tag } from "@/components/ui/tag"
import { cn } from "@/lib/utils"
import { useBook } from "@/screens/finance-lab/state"
import { PaymentDetail } from "@/screens/finance-lab/cash"
import {
  Amount,
  Cell,
  Panel,
  Row,
  Section,
  SimBadge,
  Table,
} from "@/screens/finance-lab/parts"

/// Accruals / YMHD — what is owed, and what has answered it.
///
/// # The point of this screen existing separately
///
/// It shows the SAME payment records as Cash & Bank, from the other end. A
/// payroll settlement is one object: under Cash & Bank it is money leaving a
/// petty cash box, here it is two liabilities being discharged. The plan asks
/// that this be visible without duplication, and the way it is proved is that
/// the payment number in both places is the same number and the journal
/// reference is the same entry.
///
/// # Why salary and BPJS are two rows
///
/// Because the client's own accrual entry credits two accounts —
/// `Biaya Gaji dan Upah YMHD` and `Biaya Asuransi dan BPJS YMHD` — and they
/// settle to different people. A single lumped accrual could not be allocated
/// against, and the payment that answers both would have to guess how to split
/// its own debit.
export function LabAccruals() {
  const b = useBook()
  const items = b.payments.allItems()
  const [open, setOpen] = useState<string | null>(items[0]?.item_id ?? null)
  const item = items.find((i) => i.item_id === open)
  const touching = item ? b.payments.touching(item.item_id) : []

  return (
    <div>
      <PageHeader
        crumb="Finance lab"
        title="Accruals / YMHD"
        sub="Kewajiban yang sudah diakui dan belum dibayar. Sisa dihitung dari alokasi, bukan disimpan."
        actions={<SimBadge />}
      />

      <Section
        title="Open item"
        sub="Sisa dan yang sudah dijanjikan ke payment yang belum settle adalah dua angka berbeda."
      >
        <Panel>
          <Table
            head={["Kewajiban", "Pihak lawan", "Jatuh tempo", ">Nilai awal", ">Sisa", ">Dijanjikan", "Status"]}
          >
            {items.map((i) => {
              const out = b.payments.outstanding(i.item_id)
              const res = b.payments.reserved(i.item_id)
              const state = out === 0 ? "SETTLED" : out < i.original ? "PARTIAL" : res > 0 ? "IN FLIGHT" : "OPEN"
              return (
                <Row
                  key={i.item_id}
                  className={cn("cursor-pointer hover:bg-soft-1", open === i.item_id && "bg-accent-bg")}
                >
                  <Cell onClick={() => setOpen(i.item_id)}>
                    <span className="text-ink">{i.description}</span>
                    <div className="font-mono text-[0.6875rem] text-faint">{i.source_ref}</div>
                  </Cell>
                  <Cell onClick={() => setOpen(i.item_id)}>{i.counterparty}</Cell>
                  <Cell>{i.due_on ?? "—"}</Cell>
                  <Cell right>
                    <Amount minor={i.original} />
                  </Cell>
                  <Cell right className={out > 0 ? "font-semibold text-ink" : undefined}>
                    <Amount minor={out} muted />
                  </Cell>
                  <Cell right>
                    <Amount minor={res} muted />
                  </Cell>
                  <Cell>
                    <Tag
                      tone={
                        state === "SETTLED" ? "ok" : state === "IN FLIGHT" ? "warn" : state === "PARTIAL" ? "info" : "neutral"
                      }
                    >
                      {state}
                    </Tag>
                  </Cell>
                </Row>
              )
            })}
          </Table>
        </Panel>
      </Section>

      {item && (
        <Section
          title={`Payment yang menyentuh ${item.description}`}
          sub="Record yang sama persis dengan yang ada di Cash & Bank — nomor sama, jurnal sama."
        >
          {touching.length === 0 ? (
            <Panel>
              <p className="px-3.5 py-3 text-[0.8125rem] text-mute">
                Belum ada payment terhadap kewajiban ini.
              </p>
            </Panel>
          ) : (
            <div className="space-y-5">
              {touching.map((p) => (
                <PaymentDetail key={p.payment_id} payment={p} />
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  )
}
