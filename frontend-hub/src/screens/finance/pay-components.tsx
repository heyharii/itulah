import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, Problem } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, label } from "@/lib/format"
import { financeKeys, setPayComponentPosting } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Code, Grid, Td, Th } from "@/screens/finance-final/parts"
import { usePayComponents } from "@/screens/finance/master-data"
import {
  EditorCard,
  LinkAccountsButton,
  MasterLayout,
  Reach,
  YesNo,
} from "@/screens/finance/master-parts"
import type { PayComponentPosting } from "@itulah/contract"

/// Where each pay component lands: the posting half of a component HR
/// defines.
///
/// HR owns what a component is and how much it pays; Finance owns two facts
/// about how it posts — whether the employer bears it (a BPJS share is a cost
/// and a liability, not a deduction from the employee), and whether it is paid
/// out of an accrual built up month by month (THR) — and its account, which is
/// an account link: role `payroll_expense` for an earning, `payroll_deduction`
/// for a deduction, source the component. A component with no link makes the
/// payroll run that pays it refuse, by name.
export function PayComponents() {
  const list = usePayComponents()
  const [editing, setEditing] = useState<PayComponentPosting | null>(null)
  const [needle, setNeedle] = useState("")
  const [retired, setRetired] = useState(false)

  const rows = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return (list.data ?? []).filter(
      (row) =>
        (retired || !row.retired) &&
        (text === "" ||
          row.code.toLowerCase().includes(text) ||
          row.label.toLowerCase().includes(text))
    )
  }, [list.data, needle, retired])

  const unlinked = (list.data ?? []).filter(
    (row) => !row.retired && row.linked_sites === 0
  ).length

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Setup"
        title="Pay components"
        sub="How each component HR pays posts, and the account it lands on. The account is an account link with the component as its source."
        actions={
          <Input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder="Search"
            className="h-8 w-48"
          />
        }
      />

      <Toolbar>
        <Checkbox
          label="Show retired"
          checked={retired}
          onChange={setRetired}
        />
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute">
          {count(rows.length)} components
          {unlinked > 0 &&
            ` · ${count(unlinked)} with no account — a run that pays one is refused`}
        </span>
      </Toolbar>

      <MasterLayout
        list={
          <Card className="overflow-hidden">
            {queryState(list, {
              loading: "Reading the pay components…",
              render: () =>
                rows.length === 0 ? (
                  <EmptyState>
                    {needle.trim() === ""
                      ? "HR has defined no pay component yet."
                      : "No component matches the search."}
                  </EmptyState>
                ) : (
                  <Grid>
                    <thead>
                      <tr>
                        <Th>Code</Th>
                        <Th>Component</Th>
                        <Th>Kind</Th>
                        <Th align="center">Employer borne</Th>
                        <Th align="center">From accrual</Th>
                        <Th>Role</Th>
                        <Th>Account</Th>
                        <Th />
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
                            <Code>{row.code}</Code>
                          </Td>
                          <Td>
                            <span className="text-ink">{row.label}</span>
                            {row.retired && (
                              <Pill tone="neutral" className="ml-2">
                                Retired
                              </Pill>
                            )}
                          </Td>
                          <Td>{label(row.kind)}</Td>
                          <Td align="center">
                            <YesNo on={row.employer_borne} />
                          </Td>
                          <Td align="center">
                            <YesNo on={row.paid_from_accrual} />
                          </Td>
                          <Td>
                            <Tag>{row.role}</Tag>
                          </Td>
                          <Td>
                            <Reach sites={row.linked_sites} />
                          </Td>
                          <Td align="right">
                            <LinkAccountsButton
                              role={row.role}
                              sourceType="PAY_COMPONENT"
                              sourceId={row.code}
                            />
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
            <ComponentForm
              key={editing.code}
              component={editing}
              onDone={() => setEditing(null)}
            />
          )
        }
      />
    </PageContent>
  )
}

function ComponentForm({
  component,
  onDone,
}: {
  component: PayComponentPosting
  onDone: () => void
}) {
  const client = useQueryClient()
  const [borne, setBorne] = useState(component.employer_borne)
  const [accrual, setAccrual] = useState(component.paid_from_accrual)

  const save = useMutation({
    mutationFn: () =>
      setPayComponentPosting(component.code, {
        employer_borne: borne,
        paid_from_accrual: accrual,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: financeKeys.payComponents() })
      onDone()
    },
  })

  const changed =
    borne !== component.employer_borne ||
    accrual !== component.paid_from_accrual

  return (
    <EditorCard title={component.label} onClose={onDone}>
      <p className="text-[0.875rem] text-body">
        <Code>{component.code}</Code> · {label(component.kind)} · answers{" "}
        <Tag>{component.role}</Tag>
      </p>
      <Problem error={save.error} />
      <Checkbox
        label="Employer borne"
        hint="The employer pays it on top of the salary: a cost and a liability, never taken from the employee's pay."
        checked={borne}
        onChange={setBorne}
      />
      <Checkbox
        label="Paid from an accrual"
        hint="Built up month by month and paid out of what was accrued, as THR is — the payment clears the accrual rather than landing as a cost."
        checked={accrual}
        onChange={setAccrual}
      />
      <div className="flex items-center justify-between gap-2 border-t border-hairline pt-3">
        <Reach sites={component.linked_sites} />
        <span className="flex items-center gap-2">
          <LinkAccountsButton
            role={component.role}
            sourceType="PAY_COMPONENT"
            sourceId={component.code}
          />
          <Button
            variant="primary"
            disabled={!changed || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </span>
      </div>
    </EditorCard>
  )
}
