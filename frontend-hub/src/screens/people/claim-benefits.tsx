import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { PickOne } from "@/components/ui/pick"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Banner } from "@/components/ui/states"
import { money } from "@/lib/format"
import {
  claimBalances,
  claimBenefitKeys,
  overrideClaimBenefit,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"

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
                { label: "A Year", align: "right" },
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
