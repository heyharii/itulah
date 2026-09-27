import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input, Money, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, Problem } from "@/components/ui/states"
import { money } from "@/lib/format"
import {
  financeKeys,
  listFinanceSettings,
  setFinanceSetting,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Code, Grid, Td, Th } from "@/screens/finance-final/parts"
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
  "journal.two_person_from_minor": "Two-person journal threshold",
  mdr_tolerance_minor: "MDR tolerance",
  mdr_tolerance_bps: "MDR tolerance (rate)",
  return_window_days: "Return window",
}

/// The DB keeps `numeric`, so "12.0000" can come back for 12.
function tidy(value: string): string {
  if (!/^-?\d+\.\d+$/.test(value)) return value
  return value.replace(/\.?0+$/, "")
}

export function FinanceSettings() {
  const list = useQuery({
    queryKey: financeKeys.settings(),
    queryFn: ({ signal }) => listFinanceSettings(signal),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Settings"
        title="Accounts settings"
        sub="The thresholds, windows and switches Finance's rules read. A change applies to everything posted from now on."
      />
      <Card className="overflow-hidden">
        {queryState(list, {
          loading: "Reading the settings…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>No setting is kept on this node.</EmptyState>
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th>Setting</Th>
                    <Th width="18rem">Value</Th>
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

function SettingRow({ setting }: { setting: FinanceSetting }) {
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

  return (
    <tr>
      <Td>
        <div className="font-medium text-ink">
          {NAMES[setting.setting_key] ?? setting.setting_key}
        </div>
        <Code>{setting.setting_key}</Code>
      </Td>
      <Td>
        <div className="flex items-center gap-2">
          {setting.unit === "flag" ? (
            <Select
              value={draft}
              onChange={setDraft}
              className="h-8"
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
              className="h-8"
              label={setting.setting_key}
            />
          ) : (
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              inputMode="decimal"
              className="h-8"
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
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
        {setting.unit === "IDR" && !changed && (
          <div className="mt-1 text-faint">{money(Number(current))}</div>
        )}
        <Problem error={save.error} className="mt-1.5" />
      </Td>
      <Td>
        <span className="text-body">{setting.note ?? ""}</span>
      </Td>
    </tr>
  )
}
