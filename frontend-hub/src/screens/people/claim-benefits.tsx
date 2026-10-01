import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Field, Input } from "@/components/ui/field"
import { PickOne } from "@/components/ui/pick"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import {
  claimBalances,
  claimBenefitKeys,
  claimBenefits,
  claimsKeys,
  listClaimTypes,
  overrideClaimBenefit,
  stateClaimBenefit,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"

/// Saldo / benefit: how much one person may be reimbursed for a kind of
/// claim in a calendar year. An approval that would pass it is refused.
export function ClaimAllowances() {
  const client = useQueryClient()
  const rules = useQuery({
    queryKey: claimBenefitKeys.rules(),
    queryFn: ({ signal }) => claimBenefits(signal),
  })
  const types = useQuery({
    queryKey: claimsKeys.types(),
    queryFn: ({ signal }) => listClaimTypes(signal),
  })
  const [type, setType] = useState<string | null>(null)
  const [from, setFrom] = useState("")
  const [limit, setLimit] = useState("")
  const [reason, setReason] = useState("")
  const save = useMutation({
    mutationFn: () =>
      stateClaimBenefit({
        type_code: type ?? "",
        effective_from: from,
        yearly_limit_minor:
          limit.replace(/\D/g, "") === ""
            ? null
            : Number(limit.replace(/\D/g, "")),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setLimit("")
      setReason("")
      void client.invalidateQueries({ queryKey: claimBenefitKeys.rules() })
    },
  })

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Yearly allowances</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {queryState(rules, {
          loading: "Reading the allowances…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                No kind of claim has a yearly limit. Give one — medical up to
                Rp3.000.000 a year — and approvals past it are refused.
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  "Kind",
                  "From",
                  { label: "A year", align: "right" },
                  "By",
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={`${row.type_code}-${row.effective_from}`}>
                    <MiniCell>{row.type_name}</MiniCell>
                    <MiniCell>{day(row.effective_from)}</MiniCell>
                    <MiniCell align="right">
                      {row.yearly_limit_minor === null
                        ? "no limit"
                        : money(row.yearly_limit_minor)}
                    </MiniCell>
                    <MiniCell>{row.ratified_by}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
        <SubHead>State an allowance from a date</SubHead>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Kind" required>
            <PickOne
              label="Kind"
              placeholder="Choose…"
              choices={(types.data ?? [])
                .filter((one) => one.retired_at === null)
                .map((one) => ({ value: one.code, label: one.name }))}
              value={type}
              onChange={setType}
            />
          </Field>
          <Field label="From" required>
            <Day value={from} onChange={setFrom} />
          </Field>
          <Field label="A year, per person" aside="empty: no limit">
            <Input
              inputMode="numeric"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="3000000"
            />
          </Field>
          <Field label="Why" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        {save.error !== null && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}
        <div>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={type === null || from === "" || reason.trim() === ""}
            onClick={() => save.mutate()}
          >
            Save allowance
          </Button>
        </div>
      </div>
    </Card>
  )
}

/// One person's allowances this year: the limit, what is used, what waits,
/// what is left — and head office may give them their own figure.
export function ClaimBalances({
  employeeId,
  editable,
}: {
  employeeId: string
  editable: boolean
}) {
  const client = useQueryClient()
  const year = new Date().getFullYear()
  const balances = useQuery({
    queryKey: claimBenefitKeys.balances(employeeId, year),
    queryFn: ({ signal }) => claimBalances(employeeId, year, signal),
  })
  const [type, setType] = useState<string | null>(null)
  const [limit, setLimit] = useState("")
  const [reason, setReason] = useState("")
  const set = useMutation({
    mutationFn: () =>
      overrideClaimBenefit(employeeId, {
        type_code: type ?? "",
        year,
        limit_minor: Number(limit.replace(/\D/g, "") || "0"),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setLimit("")
      setReason("")
      void client.invalidateQueries({
        queryKey: claimBenefitKeys.balances(employeeId, year),
      })
    },
  })
  const rows = (balances.data ?? []).filter(
    (row) =>
      row.limit_minor !== null || row.used_minor > 0 || row.pending_minor > 0
  )

  return (
    <div>
      <SubHead aside={String(year)}>Allowances</SubHead>
      {queryState(balances, {
        loading: "Reading the allowances…",
        render: () =>
          rows.length === 0 ? (
            <p className="text-[0.875rem] text-mute">
              No allowance and nothing claimed this year.
            </p>
          ) : (
            <MiniTable
              head={[
                "Kind",
                { label: "A year", align: "right" },
                { label: "Used", align: "right" },
                { label: "Left", align: "right" },
              ]}
            >
              {rows.map((row) => (
                <MiniRow key={row.type_code}>
                  <MiniCell>
                    {row.type_name}
                    {row.personal && (
                      <span className="block text-[0.875rem] text-mute">
                        their own figure
                      </span>
                    )}
                  </MiniCell>
                  <MiniCell align="right">
                    {row.limit_minor === null
                      ? "no limit"
                      : money(row.limit_minor)}
                  </MiniCell>
                  <MiniCell align="right">
                    {money(row.used_minor)}
                    {row.pending_minor > 0 && (
                      <span className="block text-[0.875rem] text-mute">
                        +{money(row.pending_minor)} waiting
                      </span>
                    )}
                  </MiniCell>
                  <MiniCell align="right">
                    {row.left_minor === null ? "—" : money(row.left_minor)}
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          ),
      })}
      {editable && (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Their own figure for">
            <PickOne
              label="Kind"
              placeholder="Choose…"
              choices={(balances.data ?? []).map((one) => ({
                value: one.type_code,
                label: one.type_name,
              }))}
              value={type}
              onChange={setType}
            />
          </Field>
          <Field label="This year">
            <Input
              inputMode="numeric"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </Field>
          <Field label="Why">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div>
            <Button
              variant="ghost"
              pending={set.isPending}
              disabled={
                type === null || limit.trim() === "" || reason.trim() === ""
              }
              onClick={() => set.mutate()}
            >
              Set their allowance
            </Button>
          </div>
          {set.error !== null && (
            <Banner tone="bad">{set.error.message}</Banner>
          )}
        </div>
      )}
    </div>
  )
}
