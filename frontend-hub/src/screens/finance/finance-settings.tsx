import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input, Money, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, Problem } from "@/components/ui/states"
import {
  financeKeys,
  listFinanceSettings,
  setFinanceSetting,
} from "@/lib/queries/finance"
import { useLayout } from "@/lib/layout"
import { queryState } from "@/lib/query-state"
import { Grid, Td, Th } from "@/screens/finance-final/parts"
import type { FinanceSetting } from "@itulah/contract"

/// Accounts Settings: the numbers Finance's rules read — tolerances, windows,
/// thresholds and switches — each changed here rather than in a release.
///
/// Every setting is a number with a unit. A `flag` is 0 or 1, an `IDR` is whole
/// rupiah, anything else is typed as the number it is. The server refuses a
/// value its rule cannot use and says why.
const NAMES: Record<string, string> = {
  assistant_monthly_budget_usd: "Assistant monthly budget",
  assistant_brief_hour: "Morning brief hour",
  "sales.discount_accounting": "Discount accounting",
  "payroll.thr_accrual_months": "THR accrual months",
  "store_expense.manager_limit_minor": "Store manager approval limit",
  "store_expense.code_above_minor": "Expense code above",
  "journal.two_person_from_minor": "Two-person journal threshold",
  mdr_tolerance_minor: "MDR tolerance",
  mdr_tolerance_bps: "MDR tolerance (rate)",
  return_window_days: "Return window",
  "sync.publish_payment_methods": "Send payment methods to shops",
}

/// The DB keeps `numeric`, so "12.0000" can come back for 12.
function tidy(value: string): string {
  if (!/^-?\d+\.\d+$/.test(value)) return value
  return value.replace(/\.?0+$/, "")
}

export function FinanceSettings() {
  const phone = useLayout() === "phone"
  const list = useQuery({
    queryKey: financeKeys.settings(),
    queryFn: ({ signal }) => listFinanceSettings(signal),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Accounting Masters"
        title="Accounts Settings"
      />
      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(list, {
          loading: "Reading the settings…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>No setting is kept on this node.</EmptyState>
            ) : phone ? (
              <ul className="flex flex-col gap-2.5">
                {rows.map((row) => (
                  <SettingRow key={row.setting_key} setting={row} phone />
                ))}
              </ul>
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th width="15rem">Setting</Th>
                    <Th width="17rem">Value</Th>
                    <Th>What it does</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <SettingRow key={row.setting_key} setting={row} />
                  ))}
                </tbody>
              </Grid>
            ),
        })}
      </Card>
    </PageContent>
  )
}

function SettingRow({
  setting,
  phone = false,
}: {
  setting: FinanceSetting
  /// A card of its own on a phone: the name, what it does, and the control.
  phone?: boolean
}) {
  const client = useQueryClient()
  const current = tidy(setting.value)
  const [draft, setDraft] = useState(current)

  const save = useMutation({
    mutationFn: () => setFinanceSetting(setting.setting_key, { value: draft }),
    onSuccess: (saved) => {
      client.setQueryData<FinanceSetting[]>(financeKeys.settings(), (was) =>
        (was ?? []).map((one) =>
          one.setting_key === saved.setting_key ? saved : one
        )
      )
      setDraft(tidy(saved.value))
    },
  })

  const changed = draft.trim() !== current && draft.trim() !== ""
  const note = (setting.note ?? "").replace(/\s*\(\d{4}\)/g, "")

  const control = (
    <>
      <div className="flex items-center gap-2">
        {setting.unit === "flag" ? (
          <Select
            value={draft}
            onChange={setDraft}
            className="h-8 w-36"
            aria-label={setting.setting_key}
          >
            <option value="0">Off</option>
            <option value="1">On</option>
          </Select>
        ) : setting.unit === "IDR" ? (
          <Money
            value={draft}
            onChange={setDraft}
            prefix="Rp"
            className="h-8 w-36"
            label={setting.setting_key}
          />
        ) : (
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            inputMode="decimal"
            className="h-8 w-24"
            aria-label={setting.setting_key}
          />
        )}
        {setting.unit !== "flag" && setting.unit !== "IDR" && (
          <span className="shrink-0 text-mute">{setting.unit}</span>
        )}
        <Button
          size="sm"
          variant={changed ? "primary" : "quiet"}
          pending={save.isPending}
          disabled={!changed}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </div>
      <Problem error={save.error} className="mt-1.5" />
    </>
  )

  if (phone) {
    return (
      <li className="flex flex-col gap-2 rounded-card border border-hairline bg-canvas p-4 shadow-soft">
        <div className="text-card-title font-semibold text-ink">
          {NAMES[setting.setting_key] ?? setting.setting_key}
        </div>
        {note !== "" && <p className="text-[0.875rem] text-mute">{note}</p>}
        <div className="mt-1">{control}</div>
      </li>
    )
  }

  return (
    <tr>
      <Td>
        <div className="font-medium text-ink" title={setting.setting_key}>
          {NAMES[setting.setting_key] ?? setting.setting_key}
        </div>
      </Td>
      <Td>{control}</Td>
      <Td className="whitespace-normal">
        {/* The note as the owner reads it: without the migration numbers the
            server's copy carries for its own reference. */}
        <span className="text-body">{note}</span>
      </Td>
    </tr>
  )
}
