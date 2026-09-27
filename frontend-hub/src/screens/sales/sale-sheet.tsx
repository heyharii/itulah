import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input, Money, Textarea } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
  TotalsLadder,
} from "@/components/ui/rows"
import { Segmented } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { Lifecycle } from "@/components/ui/timeline"
import { count, label, money, moment, toneFor } from "@/lib/format"
import { ApiError } from "@itulah/contract/client"
import {
  addSaleLine,
  addSalePayment,
  completeSale,
  createSaleReturn,
  saleDetail,
  shopSaleDetail,
  saleReceipt,
  storeopsKeys,
  voidSale,
  type SaleDetail,
  type ShopSale,
} from "@/lib/queries/storeops"
import { queryState } from "@/lib/query-state"
import { useIdentity } from "@/lib/session"
import { problemText, useIdempotencyKey } from "@/screens/sales/writes"
import type { PaymentMethod } from "@itulah/contract"
import { parseMoneyToMinor } from "@itulah/contract/money"

/// One sale, and everything that can still be done to it.
///
/// Every write in this module lives in this sheet, which is deliberate: a sale
/// is a single document that a line, a tender, a completion and a refund all
/// act on, and spreading those across four screens would mean four places that
/// have to agree about what state the record is in. The sheet asks the server
/// once and lets the record's own status decide what is offered — an OPEN sale
/// gets a composer, a COMPLETED one gets a receipt and a refund desk, and a
/// VOIDED one gets neither.
///
/// The composers are mounted with `key={id}` so their half-typed state cannot
/// follow the reader to the next sale. That is React's own reset, and it is
/// better than an effect that clears them: an effect runs after the wrong
/// values have already been rendered once.

/// How a shopper handed money over. Four values and no more — `sale_payment`
/// and `sale_return_payment` both CHECK against exactly this list, so a screen
/// offering a fifth would be inventing a tender the database refuses.
const METHODS: readonly { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "QRIS", label: "QRIS" },
  { value: "OTHER", label: "Other" },
]

type SalePanel = "sale" | "receipt" | "pricing" | "refund"

export function SaleSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const detail = useQuery({
    queryKey: storeopsKeys.sale(id ?? ""),
    queryFn: ({ signal }) => saleDetail(id!, signal),
    enabled: id !== null,
  })
  const isStoreReceipt =
    detail.error instanceof ApiError && detail.error.status === 404
  const shopDetail = useQuery({
    queryKey: storeopsKeys.shopSale(id ?? ""),
    queryFn: ({ signal }) => shopSaleDetail(id!, signal),
    enabled: id !== null && isStoreReceipt,
  })
  const [chosen, setChosen] = useState<{ id: string; panel: SalePanel } | null>(
    null
  )

  // Shop receipts are immutable Cloud facts and live in edge_sale, not in the
  // centre's interactive sale lifecycle. The same `?sale=` links can open both
  // populations, but an Edge receipt is deliberately read-only here.
  if (id !== null && isStoreReceipt) {
    return (
      <ShopSaleReceipt
        id={id}
        record={shopDetail.data}
        pending={shopDetail.isPending}
        failed={shopDetail.isError}
        onClose={onClose}
      />
    )
  }

  // Which panel is open, remembered against the record it was chosen for.
  // Derived rather than reset in an effect: an effect would render the previous
  // sale's panel once before clearing it, and "Refund" flashing up on a sale
  // that cannot be refunded is exactly the wrong reassurance.
  const sale = detail.data
  const completed = sale?.status === "COMPLETED"
  const panel: SalePanel =
    completed && chosen && chosen.id === id ? chosen.panel : "sale"

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "sale", id }}
      onOpenChange={(open) => !open && onClose()}
      id={sale?.sale_number}
      title={sale?.site_id ?? "Sale"}
      actions={
        sale?.status === "OPEN" && id !== null ? (
          <OpenSaleActions key={id} sale={sale} />
        ) : undefined
      }
      footer={
        sale?.status === "OPEN" && id !== null ? (
          <OpenSaleComposer key={id} sale={sale} />
        ) : undefined
      }
    >
      {queryState(detail, {
        loading: "Loading the sale…",
        render: (record) => (
          <div className="flex flex-col gap-5">
            {completed && (
              <SubTabs
                tabs={[
                  { value: "sale", label: "Sale" },
                  { value: "receipt", label: "Receipt" },
                  { value: "pricing", label: "Pricing" },
                  { value: "refund", label: "Refund" },
                ]}
                value={panel}
                onChange={(next) =>
                  id !== null && setChosen({ id, panel: next as SalePanel })
                }
                className="mb-0"
              />
            )}

            {panel === "sale" && <SaleRecord sale={record} />}
            {panel === "receipt" && <ReceiptPanel saleId={record.id} />}
            {panel === "pricing" && <PricingPanel saleId={record.id} />}
            {panel === "refund" && (
              <RefundPanel key={record.id} sale={record} />
            )}
          </div>
        ),
      })}
    </Sheet>
  )
}

function ShopSaleReceipt({
  id,
  record,
  pending,
  failed,
  onClose,
}: {
  id: string
  record: ShopSale | undefined
  pending: boolean
  failed: boolean
  onClose: () => void
}) {
  return (
    <Sheet
      open
      subject={{ kind: "sale", id }}
      onOpenChange={(open) => !open && onClose()}
      id={`POS-${id.slice(0, 8)}`}
      title={record?.site_id ?? "Store sale"}
    >
      {pending ? (
        <p className="py-6 text-center text-meta text-body">
          Reading the store receipt…
        </p>
      ) : failed || record === undefined ? (
        <Banner tone="warn">
          This sale is not available as a centre or store receipt.
        </Banner>
      ) : (
        <div className="flex flex-col gap-5">
          <Facts>
            <Fact term="Rang at">{moment(record.occurred_at)}</Fact>
            <Fact term="Reached Cloud">
              {record.received_at === null ? "—" : moment(record.received_at)}
            </Fact>
            <Fact term="Discount">{money(record.discount_total_minor)}</Fact>
            <Fact term="Points earned">{count(record.points_earned)}</Fact>
          </Facts>

          <div>
            <SubHead>Items</SubHead>
            <MiniTable head={["Item", "Qty", "Unit", "Charged"]}>
              {record.lines.map((line) => (
                <MiniRow key={line.sku_code}>
                  <MiniCell>
                    <span className="block text-ink">
                      {line.article_name ?? line.sku_code}
                    </span>
                    <span className="font-mono text-[0.875rem] text-mute">
                      {line.sku_code}
                    </span>
                  </MiniCell>
                  <MiniCell align="right">{count(line.quantity)}</MiniCell>
                  <MiniCell align="right">
                    {money(line.unit_price_minor)}
                  </MiniCell>
                  <MiniCell align="right">
                    {line.line_total_minor === null
                      ? "—"
                      : money(line.line_total_minor)}
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          </div>

          {record.promotions.length > 0 && (
            <div>
              <SubHead>Promotions</SubHead>
              <MiniTable head={["Promotion", "Saved"]}>
                {record.promotions.map((promotion, index) => (
                  <MiniRow key={promotion.rule_id ?? index}>
                    <MiniCell>
                      {promotion.name ?? promotion.rule_id ?? "—"}
                    </MiniCell>
                    <MiniCell align="right">
                      {money(promotion.benefit_minor)}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            </div>
          )}

          <div>
            <SubHead>Paid with</SubHead>
            <MiniTable head={["Method", "Amount"]}>
              {record.tenders.map((tender) => (
                <MiniRow key={tender.tender_seq}>
                  <MiniCell>{tender.method}</MiniCell>
                  <MiniCell align="right">
                    {money(tender.amount_minor)}
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          </div>

          <TotalsLadder
            rows={[
              { label: "Paid", value: money(record.paid_minor) },
              { label: "Change", value: money(record.change_minor) },
            ]}
            total={{ label: "Total", value: money(record.total_minor) }}
          />
          <p className="break-all font-mono text-[0.875rem] text-mute">
            Cloud sale ID: {record.sale_id}
          </p>
        </div>
      )}
    </Sheet>
  )
}

// ---- The record --------------------------------------------------------

function SaleRecord({ sale }: { sale: SaleDetail }) {
  const owing = sale.total_minor - sale.paid_minor

  return (
    <div className="flex flex-col gap-5">
      {sale.status === "VOIDED" ? (
        <div>
          <Pill tone={toneFor(sale.status)}>{label(sale.status)}</Pill>
        </div>
      ) : (
        // Where the sale has got to, as a position on a track rather than as a
        // word. "Tendered" is its own step because a basket that is fully paid
        // and not yet completed is the state a cashier is standing in.
        <Lifecycle
          steps={[
            { label: "Open", state: "done" },
            {
              label: "Tendered",
              state:
                sale.paid_minor >= sale.total_minor && sale.lines.length > 0
                  ? "done"
                  : sale.lines.length > 0
                    ? "current"
                    : "todo",
            },
            {
              label: "Completed",
              state:
                sale.status === "COMPLETED"
                  ? "done"
                  : sale.paid_minor >= sale.total_minor && sale.lines.length > 0
                    ? "current"
                    : "todo",
            },
          ]}
        />
      )}

      <Facts>
        <Fact term="Store">{sale.site_id}</Fact>
        <Fact term="Channel">{label(sale.channel)}</Fact>
        <Fact term="Cashier">{sale.actor_id}</Fact>
        <Fact term="Opened">{moment(sale.created_at)}</Fact>
        <Fact term="Completed">{moment(sale.completed_at)}</Fact>
        <Fact term="Price book">v{count(sale.commercial_version)}</Fact>
      </Facts>

      <div>
        <h4 className="mb-2 text-card-title font-semibold text-ink">Basket</h4>
        {sale.lines.length === 0 ? (
          <p className="text-meta text-body">
            Nothing scanned onto this sale yet.
          </p>
        ) : (
          <MiniTable head={["Item", "Qty", "Unit", "Line total"]}>
            {sale.lines.map((line) => (
              <tr key={line.id} className="border-t border-hairline">
                <td className="py-2 pr-2">
                  <span className="block text-[0.875rem] text-ink">
                    {line.sku_code}
                  </span>
                  {/* The tag, not the SKU, is what was actually scanned: a line
                      here is one physical garment. */}
                  <span className="font-mono text-[0.875rem] text-mute">
                    {line.epc}
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums">
                  {count(line.quantity)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {money(line.unit_price_minor)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {money(line.total_minor)}
                </td>
              </tr>
            ))}
          </MiniTable>
        )}
      </div>

      {sale.payments.length > 0 && (
        <div>
          <h4 className="mb-2 text-card-title font-semibold text-ink">
            Tendered
          </h4>
          <MiniTable head={["Method", "Reference", "Amount"]}>
            {sale.payments.map((payment) => (
              <tr key={payment.id} className="border-t border-hairline">
                <td className="py-2 pr-2">
                  <Tag>{payment.method}</Tag>
                </td>
                <td className="py-2 text-right text-[0.875rem] text-mute">
                  {payment.reference ?? "—"}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {money(payment.amount_minor)}
                </td>
              </tr>
            ))}
          </MiniTable>
        </div>
      )}

      <TotalsLadder
        rows={[
          { label: "Net", value: money(sale.net_minor) },
          { label: "Tax", value: money(sale.tax_minor) },
          { label: "Paid", value: money(sale.paid_minor) },
          { label: "Change", value: money(sale.change_minor) },
          ...(owing > 0 ? [{ label: "Still owing", value: money(owing) }] : []),
        ]}
        total={{ label: "Total", value: money(sale.total_minor) }}
      />
    </div>
  )
}

// ---- The reprint -------------------------------------------------------

/// The receipt, rebuilt from the durable rows every time rather than cached as
/// text — so a reprint five weeks later is exactly as faithful as the original.
function ReceiptPanel({ saleId }: { saleId: string }) {
  const receipt = useQuery({
    queryKey: storeopsKeys.receipt(saleId),
    queryFn: ({ signal }) => saleReceipt(saleId, signal),
  })

  return queryState(receipt, {
    loading: "Rebuilding the receipt…",
    render: (printed) => (
      <div className="flex flex-col gap-5">
        <Facts>
          <Fact term="Store">{printed.site.name}</Fact>
          <Fact term="Cashier">{printed.cashier}</Fact>
          <Fact term="Completed">{moment(printed.completed_at)}</Fact>
          <Fact term="Currency">{printed.currency}</Fact>
        </Facts>

        <div>
          <h4 className="mb-2 text-card-title font-semibold text-ink">Sold</h4>
          <MiniTable head={["Item", "Qty", "Unit", "Line total"]}>
            {printed.lines.map((line) => (
              <tr key={line.sale_line_id} className="border-t border-hairline">
                <td className="py-2 pr-2">
                  <span className="block text-[0.875rem] text-ink">
                    {line.article_name}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-[0.875rem] text-mute">
                      {line.sku_code}
                    </span>
                    {/* A line some later return document names. The receipt
                        keeps saying what was sold; this only says it came
                        back. */}
                    {line.returned && <Tag tone="warn">Returned</Tag>}
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums">
                  {count(line.quantity)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {money(line.unit_price_minor)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {money(line.total_minor)}
                </td>
              </tr>
            ))}
          </MiniTable>
        </div>

        {printed.tax_summary.length > 0 && (
          <div>
            <h4 className="mb-2 text-card-title font-semibold text-ink">Tax</h4>
            <MiniTable head={["Band", "Rate", "Net", "Tax"]}>
              {printed.tax_summary.map((band) => (
                <tr
                  key={`${band.category}-${band.rate_bps}-${String(band.inclusive)}`}
                  className="border-t border-hairline"
                >
                  <td className="py-2 pr-2">
                    <Tag>{band.category}</Tag>
                    {band.inclusive && (
                      <span className="ml-1.5 text-[0.875rem] text-mute">
                        inclusive
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {(band.rate_bps / 100).toFixed(2)}%
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {money(band.net_minor)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {money(band.tax_minor)}
                  </td>
                </tr>
              ))}
            </MiniTable>
            {/* The server's own sentence about how that tax was arrived at.
                Quoted rather than paraphrased: it is the difference between
                two totals that would otherwise look like a rounding bug. */}
            <p className="mt-2 text-[0.875rem] text-mute">
              {printed.tax_note}
            </p>
          </div>
        )}

        {printed.payments.length > 0 && (
          <div>
            <h4 className="mb-2 text-card-title font-semibold text-ink">
              Paid with
            </h4>
            <MiniTable head={["Method", "Reference", "Amount"]}>
              {printed.payments.map((payment, index) => (
                <tr
                  key={`${payment.method}-${index}`}
                  className="border-t border-hairline"
                >
                  <td className="py-2 pr-2">
                    <Tag>{payment.method}</Tag>
                  </td>
                  <td className="py-2 text-right text-[0.875rem] text-mute">
                    {payment.reference ?? "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {money(payment.amount_minor)}
                  </td>
                </tr>
              ))}
            </MiniTable>
          </div>
        )}

        {printed.returns.length > 0 && (
          <div>
            <h4 className="mb-2 text-card-title font-semibold text-ink">
              Came back
            </h4>
            <MiniTable head={["Return", "Reason", "Refunded"]}>
              {printed.returns.map((entry) => (
                <tr
                  key={entry.return_number}
                  className="border-t border-hairline"
                >
                  <td className="py-2 pr-2 font-mono text-id text-body">
                    {entry.return_number}
                  </td>
                  <td className="py-2 text-right text-[0.875rem] text-mute">
                    {entry.reason}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {money(entry.refund_total_minor)}
                  </td>
                </tr>
              ))}
            </MiniTable>
          </div>
        )}

        <TotalsLadder
          rows={[
            { label: "Net", value: money(printed.totals.net_minor) },
            { label: "Tax", value: money(printed.totals.tax_minor) },
            { label: "Paid", value: money(printed.totals.paid_minor) },
            { label: "Change", value: money(printed.totals.change_minor) },
            {
              label: "Refunded since",
              value: money(printed.totals.refunded_minor),
            },
          ]}
          total={{
            label: "Total",
            value: money(printed.totals.total_minor),
          }}
        />
      </div>
    ),
  })
}

// ---- The refund desk ---------------------------------------------------

/// Take goods back against a completed sale.
///
/// Its own document, never an edit of the sale: a finalized sale is immutable,
/// and the shortfall between what was charged and what came back is exactly the
/// thing the accounts need to keep. Each line says whether the garment goes
/// back on the floor as sellable or into the store's reject pool — that choice
/// is a stock movement, not a note.
/// The return as it is composed. `choice` is the per-line decision — absent
/// means the garment is not coming back, `true` means it goes on the floor,
/// `false` means it goes to the reject pool — and it sits on the same draft as
/// the money because they are one document, not two.
interface ReturnDraft {
  choice: Record<string, boolean>
  method: PaymentMethod
  amount: string
  reference: string
  reason: string
}

function RefundPanel({ sale }: { sale: SaleDetail }) {
  const client = useQueryClient()
  const identity = useIdentity()
  const actor = identity.data?.username
  const [key, renewKey] = useIdempotencyKey()

  /// What the return is worth, from whatever is chosen and typed so far. A
  /// blank amount is the sum of the lines coming back; an unreadable one is -1,
  /// which is what stops the form.
  const totals = (draft: ReturnDraft) => {
    const taken = sale.lines.filter((line) => line.id in draft.choice)
    const suggested = taken.reduce((sum, line) => sum + line.total_minor, 0)
    return {
      taken,
      suggested,
      refundMinor:
        draft.amount.trim() === ""
          ? suggested
          : (parseMoneyToMinor(draft.amount) ?? -1),
    }
  }

  const record = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: ReturnDraft) => {
      const { taken, refundMinor } = totals(draft)
      return createSaleReturn(sale.id, {
        lines: taken.map((line) => ({
          sale_line_id: line.id,
          restock: draft.choice[line.id],
        })),
        refunds: [
          {
            method: draft.method,
            amount_minor: refundMinor,
            reference:
              draft.reference.trim() === "" ? null : draft.reference.trim(),
          },
        ],
        reason: draft.reason.trim(),
        actor_id: actor ?? "",
        idempotency_key: key,
      })
    },
    onSuccess: () => {
      renewKey()
      // Everything but the tender method, which is whatever the desk is set up
      // to pay out in.
      form.setFieldValue("choice", {})
      form.setFieldValue("amount", "")
      form.setFieldValue("reference", "")
      form.setFieldValue("reason", "")
      // The sale itself now names a return, the reprint has to show it, and the
      // refund desk's own list has gained a row.
      client.invalidateQueries({ queryKey: storeopsKeys.sale(sale.id) })
      client.invalidateQueries({ queryKey: storeopsKeys.receipt(sale.id) })
      client.invalidateQueries({ queryKey: storeopsKeys.returns() })
    },
  })

  const form = useForm({
    defaultValues: {
      choice: {},
      method: "CASH",
      amount: "",
      reference: "",
      reason: "",
    } as ReturnDraft,
    onSubmit: ({ value }) => record.mutate(value),
  })

  const ready = (draft: ReturnDraft) => {
    const { taken, refundMinor } = totals(draft)
    return (
      actor !== undefined &&
      taken.length > 0 &&
      draft.reason.trim() !== "" &&
      refundMinor > 0
    )
  }

  const problem = problemText(record.error)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (ready(form.state.values) && !record.isPending) form.handleSubmit()
      }}
      className="flex flex-col gap-4"
    >
      {problem && <Banner tone="bad">{problem}</Banner>}
      {actor === undefined && (
        <Banner tone="warn">
          A return has to name who took it back, and this browser has no
          signed-in identity to name.
        </Banner>
      )}

      <div>
        <h4 className="mb-2 text-card-title font-semibold text-ink">
          What is coming back
        </h4>
        <form.Field name="choice">
          {(field) => {
            /// Toggling one line between the three states. Off is the absence
            /// of a key, so a line nobody touched is not a line.
            const pick = (id: string, restock: boolean) => {
              const next = { ...field.state.value }
              if (next[id] === restock) delete next[id]
              else next[id] = restock
              field.handleChange(next)
            }
            return (
              <div className="flex flex-col">
                {sale.lines.map((line) => {
                  const restock = field.state.value[line.id]
                  return (
                    <div
                      key={line.id}
                      className="flex items-center gap-2 border-b border-hairline py-2 last:border-b-0"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.875rem] text-ink">
                          {line.sku_code}
                        </span>
                        <span className="font-mono text-[0.875rem] text-mute">
                          {line.epc}
                        </span>
                      </span>
                      <span className="shrink-0 text-meta tabular-nums">
                        {money(line.total_minor)}
                      </span>
                      {/* Three states, not a checkbox: not coming back, coming
                          back sellable, coming back damaged. The middle and the
                          last are different stock movements and a tick could
                          not say which. */}
                      <Button
                        size="sm"
                        variant={restock === true ? "soft" : "quiet"}
                        onClick={() => pick(line.id, true)}
                      >
                        Sellable
                      </Button>
                      <Button
                        size="sm"
                        variant={restock === false ? "soft" : "quiet"}
                        onClick={() => pick(line.id, false)}
                      >
                        Damaged
                      </Button>
                    </div>
                  )
                })}
              </div>
            )
          }}
        </form.Field>
      </div>

      <div className="flex flex-col gap-2.5">
        <form.Field name="method">
          {(field) => (
            <Segmented
              options={METHODS.map((entry) => ({
                value: entry.value,
                label: entry.label,
              }))}
              value={field.state.value}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => totals(state.values).suggested}>
          {(suggested) => (
            <form.Field name="amount">
              {(field) => (
                <Money
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={field.handleChange}
                  placeholder={`Refund ${money(suggested)}`}
                />
              )}
            </form.Field>
          )}
        </form.Subscribe>
        <form.Field name="reference">
          {(field) => (
            <Input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="Reference for the reconciliation (optional)"
            />
          )}
        </form.Field>
        <form.Field name="reason">
          {(field) => (
            <Textarea
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="Why it came back"
              rows={2}
            />
          )}
        </form.Field>
      </div>

      <form.Subscribe selector={(state) => state.values}>
        {(draft) => {
          const { taken, suggested, refundMinor } = totals(draft)
          return (
            <>
              <TotalsLadder
                rows={[
                  { label: "Lines coming back", value: count(taken.length) },
                  { label: "Sold for", value: money(suggested) },
                ]}
                total={{
                  label: "Refunding",
                  value: money(Math.max(refundMinor, 0)),
                }}
              />

              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="soft"
                  disabled={!ready(draft) || record.isPending}
                >
                  {record.isPending ? "Recording…" : "Record the return"}
                </Button>
              </div>
            </>
          )
        }}
      </form.Subscribe>
    </form>
  )
}

// ---- Acting on an open sale --------------------------------------------

/// Complete and Void, pinned in the sheet's header.
///
/// Completing moves the goods off the store floor in the same transaction, so
/// there is no undo — a completed sale is unwound by a return, which is a
/// different document with its own reason. Voiding is only ever available on an
/// OPEN sale, and the server enforces that rather than trusting this button.
function OpenSaleActions({ sale }: { sale: SaleDetail }) {
  const client = useQueryClient()
  const identity = useIdentity()
  const actor = identity.data?.username
  const [completeKey, renewCompleteKey] = useIdempotencyKey()
  const [voidKey, renewVoidKey] = useIdempotencyKey()

  const settled = () => {
    client.invalidateQueries({ queryKey: storeopsKeys.sale(sale.id) })
    // The row moves between the status tabs, and the overview and the store
    // roll-up both count it — all three read the same list.
    client.invalidateQueries({ queryKey: storeopsKeys.salesAll() })
  }

  const settle = useMutation({
    mutationFn: () =>
      completeSale(sale.id, {
        actor_id: actor ?? "",
        idempotency_key: completeKey,
      }),
    onSuccess: () => {
      renewCompleteKey()
      settled()
    },
  })

  const abandon = useMutation({
    mutationFn: () =>
      voidSale(sale.id, {
        actor_id: actor ?? "",
        idempotency_key: voidKey,
      }),
    onSuccess: () => {
      renewVoidKey()
      settled()
    },
  })

  const busy = settle.isPending || abandon.isPending

  return (
    <>
      <Button
        size="sm"
        variant="soft"
        disabled={busy || actor === undefined || sale.lines.length === 0}
        onClick={() => settle.mutate()}
      >
        {settle.isPending ? "Completing…" : "Complete"}
      </Button>
      <Button
        size="sm"
        variant="danger"
        disabled={busy || actor === undefined}
        onClick={() => abandon.mutate()}
      >
        Void
      </Button>
    </>
  )
}

/// The till composer: scan a garment on, take money for it.
///
/// Both live in the sheet's footer because both are things done *to* the record
/// while looking at it, and both keep their own idempotency key so a
/// double-tapped Scan adds one shirt rather than two.
function OpenSaleComposer({ sale }: { sale: SaleDetail }) {
  const client = useQueryClient()
  const identity = useIdentity()
  const actor = identity.data?.username

  const [epc, setEpc] = useState("")
  const [lineKey, renewLineKey] = useIdempotencyKey()

  const [method, setMethod] = useState<PaymentMethod>("CASH")
  const [amount, setAmount] = useState("")
  const [paymentKey, renewPaymentKey] = useIdempotencyKey()

  const owing = Math.max(sale.total_minor - sale.paid_minor, 0)
  const amountMinor =
    amount.trim() === "" ? owing : (parseMoneyToMinor(amount) ?? -1)

  const scan = useMutation({
    mutationFn: () =>
      addSaleLine(sale.id, {
        epc: epc.trim(),
        actor_id: actor ?? "",
        idempotency_key: lineKey,
      }),
    onSuccess: () => {
      renewLineKey()
      setEpc("")
      // Only the record changes: a line moves the sale's totals, and the list
      // carries no line count to go stale.
      client.invalidateQueries({ queryKey: storeopsKeys.sale(sale.id) })
    },
  })

  const tender = useMutation({
    mutationFn: () =>
      addSalePayment(sale.id, {
        method,
        amount_minor: amountMinor,
        reference: null,
        actor_id: actor ?? "",
        idempotency_key: paymentKey,
      }),
    onSuccess: () => {
      renewPaymentKey()
      setAmount("")
      client.invalidateQueries({ queryKey: storeopsKeys.sale(sale.id) })
      // `paid_minor` is a column on the list, so this one does show there.
      client.invalidateQueries({ queryKey: storeopsKeys.salesAll() })
    },
  })

  const problem = problemText(scan.error) ?? problemText(tender.error)

  return (
    <div className="flex flex-col gap-2.5">
      {problem && <Banner tone="bad">{problem}</Banner>}

      <div className="flex items-center gap-1.5">
        <Input
          value={epc}
          onChange={(event) => setEpc(event.target.value)}
          placeholder="Scan a tag"
          className="h-8 flex-1 font-mono text-id"
        />
        <Button
          variant="soft"
          disabled={epc.trim() === "" || actor === undefined || scan.isPending}
          onClick={() => scan.mutate()}
        >
          {scan.isPending ? "Adding…" : "Add"}
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <Segmented
          options={METHODS.map((entry) => ({
            value: entry.value,
            label: entry.label,
          }))}
          value={method}
          onChange={setMethod}
        />
        {/* `<Money>` fills the slot it is given, so the slot is what has to
            flex — the box itself only carries its height. */}
        <span className="flex min-w-0 flex-1">
          <Money
            value={amount}
            onChange={setAmount}
            placeholder={money(owing)}
            className="h-8"
          />
        </span>
        <Button
          variant="soft"
          disabled={
            amountMinor <= 0 ||
            actor === undefined ||
            sale.lines.length === 0 ||
            tender.isPending
          }
          onClick={() => tender.mutate()}
        >
          {tender.isPending ? "Taking…" : "Take"}
        </Button>
      </div>
    </div>
  )
}

/// Why each line cost what it cost.
///
/// A different read from the sale itself, and the reason it is a separate
/// panel: the receipt answers what the customer paid, this answers which rung
/// of the cascade set it and which published book the till was on at the time.
/// That last number is how a shop quietly selling from an older version gets
/// found — the sale looks perfectly correct until you ask what version it was
/// correct against.
function PricingPanel({ saleId }: { saleId: string }) {
  const trace = useQuery({
    queryKey: storeopsKeys.shopSale(saleId),
    queryFn: ({ signal }) => shopSaleDetail(saleId, signal),
  })

  return queryState(trace, {
    loading: "Reading the pricing trace…",
    render: (record) => (
      <div className="flex flex-col gap-5">
        <Facts>
          <Fact term="Rang at">{moment(record.occurred_at)}</Fact>
          <Fact term="Reached centre">{moment(record.received_at)}</Fact>
          <Fact term="Discount">{money(record.discount_total_minor)}</Fact>
          <Fact term="Points earned">{count(record.points_earned)}</Fact>
        </Facts>

        <div>
          <SubHead
            aside={
              record.pricing_trace_id === null
                ? "no trace"
                : record.pricing_trace_id
            }
          >
            Lines
          </SubHead>
          <MiniTable head={["Item", "Qty", "Unit", "Source"]}>
            {record.lines.map((line) => (
              <MiniRow key={line.sku_code}>
                <MiniCell>
                  <span className="block text-ink">
                    {line.article_name ?? line.sku_code}
                  </span>
                  <span className="font-mono text-[0.875rem] text-mute">
                    {line.sku_code}
                  </span>
                </MiniCell>
                <MiniCell align="right">{count(line.quantity)}</MiniCell>
                <MiniCell align="right">
                  {money(line.unit_price_minor)}
                </MiniCell>
                <MiniCell align="right">
                  <span className="text-[0.875rem] text-body">
                    {line.price_source ?? "—"}
                    {line.publication_version !== null &&
                      ` · v${line.publication_version}`}
                  </span>
                </MiniCell>
              </MiniRow>
            ))}
          </MiniTable>
        </div>

        {record.promotions.length > 0 && (
          <div>
            <SubHead>What took money off</SubHead>
            <MiniTable head={["Promotion", "Amount"]}>
              {record.promotions.map((promotion, index) => (
                <MiniRow key={promotion.rule_id ?? index}>
                  <MiniCell>
                    {promotion.name ?? promotion.rule_id ?? "—"}
                  </MiniCell>
                  <MiniCell align="right">
                      {money(promotion.benefit_minor)}
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          </div>
        )}

        <TotalsLadder
          rows={[
            { label: "Discount", value: money(record.discount_total_minor) },
            { label: "Paid", value: money(record.paid_minor) },
            { label: "Change", value: money(record.change_minor) },
          ]}
          total={{ label: "Total", value: money(record.total_minor) }}
        />
      </div>
    ),
  })
}
