import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import {
  accountLinksQuery,
  assetClassesQuery,
  assetDepreciationStatus,
  assetsAllQuery,
  financeKeys,
  previewDepreciation,
  runDepreciation,
} from "@/lib/queries/finance"
import { monthLabel, previousMonthOf } from "@/screens/finance/chart"
import type {
  AccountLink,
  AccountLinkPage,
  AssetRow,
  DepreciationRun,
} from "@itulah/contract"

/// 7Soft's ACCOUNT block on an asset: the asset account, the Debet (the charge)
/// and the Kredit (the accumulated depreciation) of its category. The hub keeps
/// them as account links of the category's posting roles, so the register reads
/// the links and shows the account each one resolves to. An intangible answers
/// to the amortisation pair, the rest to depreciation.
const ACCOUNT_ROLES = {
  asset: { cost: "fixed_asset", intangible: "intangible_asset" },
  debit: {
    cost: "depreciation_expense",
    intangible: "amortisation_expense",
  },
  credit: {
    cost: "accumulated_depreciation",
    intangible: "accumulated_amortisation",
  },
} as const

export type AccountSide = keyof typeof ACCOUNT_ROLES

/// 7Soft's Intangible tick: the asset is amortised, not depreciated.
export function isIntangible(asset: AssetRow): boolean {
  return (
    asset.charge_kind === "AMORTISATION" ||
    asset.category_code.startsWith("10217")
  )
}

/// Every link of the asset roles, keyed `role|category`, the company-wide one
/// ahead of a unit's.
function indexLinks(page: AccountLinkPage): Map<string, AccountLink> {
  const roles = new Set<string>(
    Object.values(ACCOUNT_ROLES).flatMap((side) => Object.values(side))
  )
  const index = new Map<string, AccountLink>()
  for (const link of page.rows) {
    if (!roles.has(link.role)) continue
    for (const key of [link.category_code, link.source_id]) {
      if (key === null || key === "") continue
      const at = `${link.role}|${key}`
      const held = index.get(at)
      if (
        held === undefined ||
        (link.scope_type === "ALL" && held.scope_type !== "ALL")
      )
        index.set(at, link)
    }
  }
  return index
}

/// The account one side of an asset's category resolves to, or null while the
/// links are read or when the category has none.
export function useAssetAccount(
  asset: AssetRow,
  side: AccountSide
): AccountLink | null {
  const links = useQuery({ ...accountLinksQuery(), select: indexLinks })
  const classes = useQuery(assetClassesQuery())
  if (links.data === undefined) return null
  const role = ACCOUNT_ROLES[side][isIntangible(asset) ? "intangible" : "cost"]
  const classCode = classes.data?.classes.find(
    (one) => one.legacy_code === asset.category_code
  )?.class_code
  return (
    links.data.get(`${role}|${asset.category_code}`) ??
    (classCode === undefined
      ? undefined
      : links.data.get(`${role}|${classCode}`)) ??
    null
  )
}

/// 7Soft's PENYUSUTAN step: pick a month, see what each asset is charged, and
/// create the journal.
///
/// The hub's month-end checklist charges the same month from Closing Periode;
/// this is the same server call, asked about the month picked here and never
/// the calendar's. Rehearse writes nothing. Charging is safe to repeat — the
/// server refuses a second charge for an asset and month rather than doubling
/// it — and it refuses outright while an asset category has no account, naming
/// the categories.
export function Penyusutan() {
  const client = useQueryClient()
  const [month, setMonth] = useState(previousMonthOf())
  const [report, setReport] = useState<{
    kind: "rehearsal" | "posted"
    month: string
    run: DepreciationRun
  } | null>(null)

  const year = Number(month.slice(0, 4))
  const monthNo = Number(month.slice(5, 7))
  const valid = Number.isFinite(year) && monthNo >= 1 && monthNo <= 12

  const status = useQuery({
    queryKey: financeKeys.depreciationStatus(year, monthNo),
    queryFn: ({ signal }) => assetDepreciationStatus(year, monthNo, signal),
    enabled: valid,
  })

  const rehearse = useMutation({
    mutationFn: () => previewDepreciation(year, monthNo),
    onSuccess: (run) => setReport({ kind: "rehearsal", month, run }),
  })
  const charge = useMutation({
    mutationFn: () => runDepreciation(year, monthNo),
    onSuccess: (run) => {
      setReport({ kind: "posted", month, run })
      // The register, the journal, the balances and what this month still owes.
      void client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  const shown = report !== null && report.month === month ? report : null
  const lines = shown?.run.lines ?? []

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="w-56">
          <Field label="Periode">
            <Input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </Field>
        </div>
        <Button
          variant="primary"
          pending={rehearse.isPending}
          disabled={!valid || charge.isPending}
          onClick={() => rehearse.mutate()}
        >
          Rehearse
        </Button>
        <Button
          variant="primary"
          pending={charge.isPending}
          disabled={!valid || rehearse.isPending}
          onClick={() => charge.mutate()}
        >
          {valid ? `Charge ${monthLabel(year, monthNo)}` : "Charge"}
        </Button>
      </Card>

      <Problem error={rehearse.error ?? charge.error} />

      {status.data && (
        <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
          <Kpi
            label={valid ? `${monthLabel(year, monthNo)} charge` : "Charge"}
            value={money(status.data.posted_total_minor)}
          />
          <Kpi label="Assets charged" value={count(status.data.posted_count)} />
          {/* The year's charge is not a figure the register states. */}
          <Kpi label={`Charged in ${year}`} value="—" />
          <Kpi
            label="Month"
            value={status.data.complete ? "Posted" : "To charge"}
          />
        </KpiStrip>
      )}

      {shown !== null && (
        <Banner tone={shown.kind === "posted" ? "ok" : "info"}>
          {shown.kind === "posted"
            ? `Charged: ${count(shown.run.posted_count)} assets, ${money(shown.run.posted_total_minor)}.`
            : `Rehearsal, nothing written: ${count(shown.run.posted_count)} assets would be charged, ${money(shown.run.posted_total_minor)}.`}
          {shown.run.skipped_count > 0 &&
            ` ${count(shown.run.skipped_count)} skipped.`}
          {shown.run.blocked_count > 0 &&
            ` ${count(shown.run.blocked_count)} blocked.`}
        </Banner>
      )}

      {shown !== null &&
        (lines.length === 0 ? (
          <EmptyState>No asset has a charge in this month.</EmptyState>
        ) : (
          <Card className="overflow-clip">
            <MiniTable
              head={[
                "Kode Asset",
                "Nama Asset",
                { label: "Nilai Penyusutan", align: "right" },
                "Note",
              ]}
            >
              {lines.map((line) => (
                <MiniRow key={line.asset_id}>
                  <MiniCell className="font-mono">{line.asset_number}</MiniCell>
                  <MiniCell>{line.name}</MiniCell>
                  <MiniCell align="right" className="tabular-nums">
                    {line.amount_minor === null
                      ? "—"
                      : money(line.amount_minor)}
                  </MiniCell>
                  <MiniCell className="text-body">
                    {line.blocked_because ?? line.skipped_because ?? ""}
                  </MiniCell>
                </MiniRow>
              ))}
            </MiniTable>
          </Card>
        ))}

      {shown !== null && (
        <Journal
          run={shown.run}
          month={shown.month}
          posted={shown.kind === "posted"}
        />
      )}
    </div>
  )
}

/// The 7Soft journal of a run: one Debet line to the category's charge account
/// and one Kredit line to its accumulated depreciation, per asset charged,
/// with the Total and the Selisih underneath. The server's run answers amounts
/// per asset, so the accounts are the category's links.
function Journal({
  run,
  month,
  posted,
}: {
  run: DepreciationRun
  month: string
  posted: boolean
}) {
  const assets = useQuery(assetsAllQuery(null, null))
  const links = useQuery({ ...accountLinksQuery(), select: indexLinks })
  const classes = useQuery(assetClassesQuery())
  const byId = new Map(
    (assets.data?.rows ?? []).map((one) => [one.asset_id, one])
  )
  const charged = run.lines.filter(
    (line) => line.amount_minor !== null && line.amount_minor !== 0
  )
  if (charged.length === 0) return null

  const accountOf = (asset: AssetRow | undefined, side: AccountSide) => {
    if (asset === undefined || links.data === undefined) return null
    const role =
      ACCOUNT_ROLES[side][isIntangible(asset) ? "intangible" : "cost"]
    const classCode = classes.data?.classes.find(
      (one) => one.legacy_code === asset.category_code
    )?.class_code
    return (
      links.data.get(`${role}|${asset.category_code}`) ??
      (classCode === undefined
        ? undefined
        : links.data.get(`${role}|${classCode}`)) ??
      null
    )
  }

  const total = charged.reduce((sum, line) => sum + (line.amount_minor ?? 0), 0)
  const dash = <span className="text-faint">—</span>
  return (
    <Card className="overflow-clip">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-hairline px-4 py-3 text-[0.9375rem]">
        <span>
          <span className="text-mute">No Jurnal </span>
          <span className="font-mono text-ink">{dash}</span>
        </span>
        <span>
          <span className="text-mute">Keterangan </span>
          <span className="text-ink">
            Penyusutan {month.slice(5, 7)}/{month.slice(0, 4)}
          </span>
        </span>
        <span className="text-mute">{posted ? "Posted" : "Rehearsal"}</span>
      </div>
      <MiniTable
        head={[
          { label: "Deskripsi Account", align: "left" },
          { label: "Kode", align: "left" },
          { label: "Uraian", align: "left" },
          { label: "Debet", align: "right" },
          { label: "Kredit", align: "right" },
        ]}
      >
        {charged.flatMap((line) => {
          const asset = byId.get(line.asset_id)
          const amount = line.amount_minor ?? 0
          const debit = accountOf(asset, "debit")
          const credit = accountOf(asset, "credit")
          const uraian = `Penyusutan ${line.name}`
          return [
            <MiniRow key={`${line.asset_id}-d`}>
              <MiniCell>{debit?.account_name ?? dash}</MiniCell>
              <MiniCell className="font-mono">
                {debit?.account_code ?? dash}
              </MiniCell>
              <MiniCell>{uraian}</MiniCell>
              <MiniCell align="right" className="tabular-nums">
                {money(amount)}
              </MiniCell>
              <MiniCell align="right" className="text-faint tabular-nums">
                0
              </MiniCell>
            </MiniRow>,
            <MiniRow key={`${line.asset_id}-k`}>
              <MiniCell>{credit?.account_name ?? dash}</MiniCell>
              <MiniCell className="font-mono">
                {credit?.account_code ?? dash}
              </MiniCell>
              <MiniCell>{uraian}</MiniCell>
              <MiniCell align="right" className="text-faint tabular-nums">
                0
              </MiniCell>
              <MiniCell align="right" className="tabular-nums">
                {money(amount)}
              </MiniCell>
            </MiniRow>,
          ]
        })}
        <MiniRow>
          <MiniCell colSpan={3} className="font-semibold text-ink">
            Total
          </MiniCell>
          <MiniCell align="right" className="font-semibold tabular-nums">
            {money(total)}
          </MiniCell>
          <MiniCell align="right" className="font-semibold tabular-nums">
            {money(total)}
          </MiniCell>
        </MiniRow>
        <MiniRow>
          <MiniCell colSpan={3} className="font-semibold text-ink">
            Selisih
          </MiniCell>
          <MiniCell align="right" colSpan={2} className="tabular-nums">
            {money(0)}
          </MiniCell>
        </MiniRow>
      </MiniTable>
    </Card>
  )
}
