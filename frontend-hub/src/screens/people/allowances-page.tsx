import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import {
  claimBenefitKeys,
  claimBenefits,
  claimsKeys,
  listClaimTypes,
  stateClaimBenefit,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"

/// Claims & loans › Yearly allowances — how much one person may be
/// reimbursed for a kind of claim in a calendar year. An approval that would
/// pass it is refused. Each row is a figure stated from a date; stating a new
/// one for the same kind supersedes it from its own date.
export function ClaimAllowancesPage() {
  const canWrite = useCanWrite()
  const [setting, setSetting] = useState(false)
  const rules = useQuery({
    queryKey: claimBenefitKeys.rules(),
    queryFn: ({ signal }) => claimBenefits(signal),
  })
  const rows = rules.data ?? []

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Yearly allowances"
        sub="How much one person may be reimbursed for each kind of claim in a year."
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => setSetting(true)}>
              Set allowance
            </Button>
          )
        }
      />

      <Card className="overflow-hidden px-4 py-2">
        {queryState(rules, {
          loading: "Reading the allowances…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No kind of claim has a yearly limit. Use Set allowance to give
                one — medical up to Rp3.000.000 a year, say — and approvals past
                it are refused.
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  "Kind",
                  { label: "From", align: "left" },
                  { label: "A Year", align: "right" },
                  { label: "Stated by", align: "left" },
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={`${row.type_code}-${row.effective_from}`}>
                    <MiniCell>
                      <span className="text-ink">{row.type_name}</span>
                    </MiniCell>
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
      </Card>

      {setting && <AllowanceSheet onClose={() => setSetting(false)} />}
    </PageContent>
  )
}

/// State an allowance from a date.
function AllowanceSheet({ onClose }: { onClose: () => void }) {
  const client = useQueryClient()
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
      void client.invalidateQueries({ queryKey: claimBenefitKeys.rules() })
      onClose()
    },
  })

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Set allowance"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={type === null || from === "" || reason.trim() === ""}
            onClick={() => save.mutate()}
          >
            Save allowance
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        {save.error !== null && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}
        <Field label="Kind" required>
          <PickOne
            label="Kind"
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
          />
        </Field>
        <Field label="Why" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  )
}
