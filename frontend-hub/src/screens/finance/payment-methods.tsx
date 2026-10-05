import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox, Field, Input, Money, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, Problem } from "@/components/ui/states"
import { count, label, money } from "@/lib/format"
import { financeKeys, savePaymentMethod } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Grid, Td, Th } from "@/screens/finance-final/parts"
import { parseMinor } from "@/screens/finance/chart"
import { usePaymentMethods } from "@/screens/finance/master-data"
import {
  EditorCard,
  LinkAccountsButton,
  MasterLayout,
} from "@/screens/finance/master-parts"
import type { PaymentMethodSetting } from "@itulah/contract"

/// The tenders the company accepts, through which bank or scheme, how each
/// settles and at what MDR (ERPNext Mode of Payment).
///
/// A new e-wallet or a new bank's EDC is a row here and its links, not a
/// release. The tender type is the grammar the day posting knows; the
/// accounts are account links narrowed by the method's bank — the company's
/// own links, qualified by `bank_code` — so "Link accounts" opens those.
const TENDERS = [
  "CASH",
  "DEBIT_CARD",
  "CREDIT_CARD",
  "QRIS",
  "EWALLET",
  "VOUCHER",
  "POINTS",
  "BENEFIT",
] as const

const SETTLEMENTS = [
  "IN_DRAWER",
  "VIA_RECEIVABLE",
  "DIRECT_TO_BANK",
  "NONE",
] as const

const NEEDS_BANK = new Set(["DEBIT_CARD", "CREDIT_CARD", "QRIS", "EWALLET"])

/// Basis points as a person reads a rate: 150 → "1.50%".
function percentOfBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

export function PaymentMethods() {
  const list = usePaymentMethods()
  const [editing, setEditing] = useState<PaymentMethodSetting | "new" | null>(
    null
  )
  const [inactive, setInactive] = useState(false)
  // ERPNext's own standard filter on Mode of Payment — Type.
  const [tender, setTender] = useState("")

  const rows = useMemo(
    () =>
      (list.data ?? [])
        .filter((row) => inactive || row.is_active)
        .filter((row) => tender === "" || row.tender_type === tender),
    [list.data, inactive, tender]
  )
  const unready = (list.data ?? []).filter(
    (row) => row.is_active && row.unlinked_roles.length > 0
  ).length

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Payments"
        title="Mode of Payment"
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            New method
          </Button>
        }
      />

      <Toolbar>
        <Select
          value={tender}
          onChange={setTender}
          className="h-control w-40"
          aria-label="Type"
        >
          <option value="">Every type</option>
          {TENDERS.map((one) => (
            <option key={one} value={one}>
              {label(one)}
            </option>
          ))}
        </Select>
        <Checkbox
          label="Show inactive"
          checked={inactive}
          onChange={setInactive}
        />
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute">
          {count(rows.length)} methods
          {unready > 0 && ` · ${count(unready)} cannot post a day yet`}
        </span>
      </Toolbar>

      <MasterLayout
        list={
          <Card className="overflow-hidden">
            {queryState(list, {
              loading: "Reading the payment methods…",
              render: () =>
                rows.length === 0 ? (
                  <EmptyState>
                    No payment method yet. A sales day cannot post a tender
                    nobody declared.
                  </EmptyState>
                ) : (
                  <Grid>
                    <thead>
                      <tr>
                        <Th>Mode of Payment</Th>
                        <Th>Type</Th>
                        <Th>Bank</Th>
                        <Th>Settles</Th>
                        <Th align="right">MDR</Th>
                        <Th align="right">Shops</Th>
                        <Th align="right">Accounts</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.code}
                          onClick={() => setEditing(row)}
                          className="cursor-pointer hover:bg-soft"
                        >
                          <Td>
                            <span className="text-ink">{row.name}</span>
                            {!row.is_active && (
                              <Pill tone="neutral" className="ml-2">
                                Inactive
                              </Pill>
                            )}
                            {row.point_value_minor !== null && (
                              <div className="text-mute">
                                One point is {money(row.point_value_minor)}
                              </div>
                            )}
                          </Td>
                          <Td>{label(row.tender_type)}</Td>
                          <Td>
                            {row.bank_code === "" ? (
                              <span className="text-faint">—</span>
                            ) : (
                              row.bank_code
                            )}
                          </Td>
                          <Td>{label(row.settlement_mode)}</Td>
                          <Td align="right">
                            {row.mdr_bps === 0 ? (
                              <span className="text-faint">—</span>
                            ) : (
                              percentOfBps(row.mdr_bps)
                            )}
                          </Td>
                          <Td align="right">
                            {/* Which shops take it is set per shop, on Shop
                                payment methods; none means no till offers it. */}
                            {row.site_ids.length === 0 ? (
                              <span
                                className="text-faint"
                                title="No shop takes this method yet"
                              >
                                0
                              </span>
                            ) : (
                              count(row.site_ids.length)
                            )}
                          </Td>
                          {/* Only a method that cannot post yet asks for
                              anything here; the rest are linked, and their
                              accounts are one click away in the form. */}
                          <Td align="right">
                            {row.unlinked_roles.length > 0 ? (
                              <LinkAccountsButton
                                role={row.unlinked_roles[0]}
                                sourceType="COMPANY"
                                sourceId={row.bank_code}
                              />
                            ) : (
                              <span className="text-mute">Linked</span>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Grid>
                ),
            })}
          </Card>
        }
        editor={
          editing !== null && (
            <MethodForm
              key={editing === "new" ? "new" : editing.code}
              method={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )
        }
      />
    </PageContent>
  )
}

function MethodForm({
  method,
  onDone,
}: {
  method: PaymentMethodSetting | null
  onDone: () => void
}) {
  const client = useQueryClient()
  const [code, setCode] = useState(method?.code ?? "")
  const [name, setName] = useState(method?.name ?? "")
  const [tender, setTender] = useState(method?.tender_type ?? "DEBIT_CARD")
  const [bank, setBank] = useState(method?.bank_code ?? "")
  // "" is the tender's own default, which the server picks.
  const [settlement, setSettlement] = useState(method?.settlement_mode ?? "")
  const [mdr, setMdr] = useState(String(method?.mdr_bps ?? 0))
  const [pointValue, setPointValue] = useState(
    method?.point_value_minor === null || method === null
      ? ""
      : String(method.point_value_minor)
  )
  const [active, setActive] = useState(method?.is_active ?? true)
  const [note, setNote] = useState(method?.note ?? "")

  const mdrBps = Number.parseInt(mdr.trim() === "" ? "0" : mdr, 10)
  const mdrValid = Number.isInteger(mdrBps) && mdrBps >= 0 && mdrBps <= 10000

  const save = useMutation({
    mutationFn: () =>
      savePaymentMethod({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        tender_type: tender,
        bank_code: bank.trim().toUpperCase(),
        settlement_mode: settlement === "" ? null : settlement,
        mdr_bps: mdrBps,
        point_value_minor: tender === "POINTS" ? parseMinor(pointValue) : null,
        is_active: active,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: financeKeys.paymentMethods() })
      onDone()
    },
  })

  const bankMissing = NEEDS_BANK.has(tender) && bank.trim() === ""

  return (
    <EditorCard
      title={method === null ? "New payment method" : `Edit ${method.code}`}
      onClose={onDone}
    >
      <Problem error={save.error} />
      <Field
        label="Code"
        required
        aside={method === null ? "Never changes" : undefined}
      >
        <Input
          value={code}
          disabled={method !== null}
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      <Field label="Name" required>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Tender">
        <Select value={tender} onChange={setTender}>
          {TENDERS.map((one) => (
            <option key={one} value={one}>
              {label(one)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Bank, scheme or provider"
        required={NEEDS_BANK.has(tender)}
        aside={NEEDS_BANK.has(tender) ? undefined : "Not used"}
        hint="The qualifier its account links are narrowed by, e.g. BCA."
      >
        <Input
          value={bank}
          onChange={(event) => setBank(event.target.value.toUpperCase())}
          disabled={!NEEDS_BANK.has(tender) && bank === ""}
        />
      </Field>
      <Field label="Settles">
        <Select value={settlement} onChange={setSettlement}>
          <option value="">Default for the tender</option>
          {SETTLEMENTS.map((one) => (
            <option key={one} value={one}>
              {label(one)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="MDR"
        aside={mdrValid ? percentOfBps(mdrBps) : undefined}
        problem={mdrValid ? undefined : "Basis points, 0 to 10,000."}
        hint="In basis points: 150 is 1.50%."
      >
        <Input
          value={mdr}
          inputMode="numeric"
          onChange={(event) => setMdr(event.target.value.replace(/\D/g, ""))}
        />
      </Field>
      {tender === "POINTS" && (
        <Field label="Value of one point">
          <Money value={pointValue} onChange={setPointValue} prefix="Rp" />
        </Field>
      )}
      <Checkbox label="Active" checked={active} onChange={setActive} />
      <Field label="Note">
        <Input value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <div className="flex items-center justify-end gap-2">
        {method !== null && method.roles.length > 0 && (
          <LinkAccountsButton
            role={method.unlinked_roles[0] ?? method.roles[0]}
            sourceType="COMPANY"
            sourceId={method.bank_code}
          />
        )}
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={
            code.trim() === "" || name.trim() === "" || bankMissing || !mdrValid
          }
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </EditorCard>
  )
}
