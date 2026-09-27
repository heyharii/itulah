import { Plus } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Input, Select } from "@/components/ui/field"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState } from "@/components/ui/states"
import {
  Amount,
  Cell,
  Row,
  Section,
  Table,
  FILTER_W,
} from "@/screens/finance-lab/parts"
import { Funnel } from "@/screens/finance-lab/signature"
import { useBook } from "@/screens/finance-lab/state"
import type { OpenItem } from "@/screens/finance-lab/engine/types"

/// Accruals / YMHD.
///
/// Signature visual is the recognised → settled → outstanding funnel, because
/// the one idea this menu carries is that the cost is already in the profit and
/// loss while the cash has not left. Everything else is one working list.
export function LabAccruals() {
  const b = useBook()
  const [unit, setUnit] = useState("")
  const [state, setState] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const items = b.payments.allItems()
  const outstandingOf = (i: OpenItem) => b.payments.outstanding(i.item_id)
  const stateOf = (i: OpenItem) => {
    const out = outstandingOf(i)
    if (out === 0) return "SETTLED"
    if (b.payments.reserved(i.item_id) > 0) return "IN_FLIGHT"
    return out < i.original ? "PARTIAL" : "OPEN"
  }

  const rows = items.filter(
    (i) => (!unit || i.unit_id === unit) && (!state || stateOf(i) === state)
  )

  const recognised = items.reduce((n, i) => n + i.original, 0)
  const outstanding = items.reduce((n, i) => n + outstandingOf(i), 0)
  const parts = items
    .filter((i) => outstandingOf(i) > 0)
    .map((i) => ({ label: i.counterparty, amount: outstandingOf(i) }))

  const detail = items.find((i) => i.item_id === open)
  const touching = detail ? b.payments.touching(detail.item_id) : []

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Accruals / YMHD"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            New accrual
          </Button>
        }
      />

      <Section title="Juli 2026">
        <Funnel
          recognised={recognised}
          settled={recognised - outstanding}
          outstanding={outstanding}
          parts={parts}
        />
      </Section>

      <Section
        title={`Obligations — ${rows.length}`}
        right={
          <div className="flex gap-2">
            <Select value={unit} onChange={setUnit} className={FILTER_W}>
              <option value="">All units</option>
              <option value="C006">C006</option>
            </Select>
            <Select value={state} onChange={setState} className={FILTER_W}>
              <option value="">All statuses</option>
              <option value="OPEN">Terbuka</option>
              <option value="IN_FLIGHT">Sedang dibayar</option>
              <option value="SETTLED">Lunas</option>
            </Select>
          </div>
        }
      >
        {rows.length === 0 ? (
          <EmptyState>No obligation matches.</EmptyState>
        ) : (
          <Table
            head={[
              "Obligations",
              "Counterparty",
              "Maturity",
              ">Recognised",
              ">Outstanding",
              "Status",
              ">Payment",
            ]}
          >
            {rows.map((i) => {
              const out = outstandingOf(i)
              const st = stateOf(i)
              const pays = b.payments.touching(i.item_id)
              return (
                <Row
                  key={i.item_id}
                  tone={open === i.item_id ? "warn" : undefined}
                  className="hover:bg-soft-1 cursor-pointer"
                >
                  <Cell
                    onClick={() =>
                      setOpen(open === i.item_id ? null : i.item_id)
                    }
                  >
                    <span className="text-ink">{i.description}</span>
                    <div className="font-mono text-eyebrow text-faint">
                      {i.source_ref}
                    </div>
                  </Cell>
                  <Cell
                    onClick={() =>
                      setOpen(open === i.item_id ? null : i.item_id)
                    }
                  >
                    {i.counterparty}
                  </Cell>
                  <Cell className="whitespace-nowrap">{i.due_on ?? "—"}</Cell>
                  <Cell right>
                    <Amount minor={i.original} />
                  </Cell>
                  <Cell
                    right
                    className={out ? "font-semibold text-ink" : undefined}
                  >
                    <Amount minor={out} muted />
                  </Cell>
                  <Cell>
                    <Pill
                      tone={
                        st === "SETTLED"
                          ? "ok"
                          : st === "IN_FLIGHT"
                            ? "info"
                            : st === "PARTIAL"
                              ? "warn"
                              : "neutral"
                      }
                    >
                      {st === "SETTLED"
                        ? "paid"
                        : st === "IN_FLIGHT"
                          ? "in flight"
                          : st === "PARTIAL"
                            ? "partial"
                            : "open"}
                    </Pill>
                  </Cell>
                  <Cell right className="font-mono text-[0.875rem] text-mute">
                    {pays[0]?.payment_number ?? "—"}
                  </Cell>
                </Row>
              )
            })}
            <Row tone="total">
              <Cell colSpan={3}>{rows.length} obligations</Cell>
              <Cell right>
                <Amount minor={rows.reduce((n, i) => n + i.original, 0)} />
              </Cell>
              <Cell right>
                <Amount
                  minor={rows.reduce((n, i) => n + outstandingOf(i), 0)}
                />
              </Cell>
              <Cell colSpan={2} />
            </Row>
          </Table>
        )}
      </Section>

      {detail && (
        <Section
          title={detail.description}
          right={<Pill tone="accent">{detail.unit_id}</Pill>}
        >
          <Table
            head={[
              "Payment",
              "Date",
              "Funded from",
              ">Dialokasikan",
              "Status",
              ">Journal",
            ]}
          >
            {touching.length === 0 ? (
              <Row>
                <Cell colSpan={6} className="text-mute">
                  No payment yet.
                </Cell>
              </Row>
            ) : (
              touching.map((p) => {
                const alloc = p.allocations
                  .filter(
                    (a) =>
                      a.target.kind === "OPEN_ITEM" &&
                      a.target.item_id === detail.item_id
                  )
                  .reduce((n, a) => n + a.amount, 0)
                return (
                  <Row key={p.payment_id}>
                    <Cell mono>{p.payment_number}</Cell>
                    <Cell className="whitespace-nowrap">
                      {p.dates.document_on}
                    </Cell>
                    <Cell>
                      {p.source.kind === "BANK"
                        ? p.source.bank_account_id
                        : "Petty cash"}
                    </Cell>
                    <Cell right>
                      <Amount minor={alloc} />
                    </Cell>
                    <Cell>
                      <Pill tone={p.status === "SETTLED" ? "ok" : "info"}>
                        {p.status.toLowerCase()}
                      </Pill>
                    </Cell>
                    <Cell right className="font-mono text-[0.875rem] text-mute">
                      {p.entry_id
                        ? b.ledger.entry(p.entry_id)?.entry_number
                        : "—"}
                    </Cell>
                  </Row>
                )
              })
            )}
          </Table>
        </Section>
      )}
      <NewAccrual open={creating} onClose={() => setCreating(false)} />
    </PageContent>
  )
}

/// Raising an accrual recognises the cost and opens the obligation in one act.
/// Splitting them would allow an obligation with no journal behind it, which is
/// a number somebody typed rather than a liability.
function NewAccrual({ open, onClose }: { open: boolean; onClose: () => void }) {
  const b = useBook()
  const [kind, setKind] = useState<"SALARY" | "BENEFIT">("SALARY")
  const [desc, setDesc] = useState("Salaries payable August 2026")
  const [party, setParty] = useState("Staff C006")
  const [amount, setAmount] = useState("57250000")
  const [on, setOn] = useState("2026-08-31")
  const [said, setSaid] = useState<string | null>(null)

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="New accrual"
    >
      <div className="flex flex-col gap-3">
        <Field label="Type">
          <Select
            value={kind}
            onChange={(v) => setKind(v as "SALARY" | "BENEFIT")}
            className={FILTER_W}
          >
            <option value="SALARY">Salaries and wages payable</option>
            <option value="BENEFIT">Insurance and BPJS payable</option>
          </Select>
        </Field>
        <Field label="Description">
          <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <Field label="Counterparty">
          <Input value={party} onChange={(e) => setParty(e.target.value)} />
        </Field>
        <Field label="Amount (Rp)">
          <Input
            value={amount}
            inputMode="numeric"
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          />
        </Field>
        <Field label="Recognised on">
          <Input value={on} onChange={(e) => setOn(e.target.value)} />
        </Field>
        {said && <p className="text-meta text-bad-fg">{said}</p>}
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => {
              const n = Number(amount)
              if (!n) return setSaid("Amount is required.")
              const r = b.createAccrual({
                unit_id: "C006",
                kind,
                counterparty: party,
                description: desc,
                amount: n * 100,
                on,
                due_on: on,
              })
              if (r.ok) onClose()
              else setSaid(r.message)
            }}
          >
            Recognise
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Sheet>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-eyebrow tracking-[0.04em] text-body uppercase">
        {label}
      </span>
      {children}
    </label>
  )
}
