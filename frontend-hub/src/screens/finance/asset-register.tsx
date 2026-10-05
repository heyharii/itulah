import { useQuery } from "@tanstack/react-query"
import { Fragment, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Panel } from "@/components/ui/dialog"
import { ExportButton } from "@/components/ui/export-button"
import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Banner, EmptyState } from "@/components/ui/states"
import type { ExportSheet } from "@/lib/export-xlsx"
import { count, day, money } from "@/lib/format"
import {
  assetSchedule,
  financeKeys,
  listAllAssets,
} from "@/lib/queries/finance"
import { useSiteLabel } from "@/lib/queries/organisation"
import { queryState } from "@/lib/query-state"
import { Code, Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import {
  DEPRECIATION_METHODS,
  monthOf,
  todayIso,
} from "@/screens/finance/chart"
import { SiteSelect } from "@/screens/finance/parts"
import { ReportFilters, ReportSummary } from "@/screens/finance/report"

import type { AssetRow } from "@itulah/contract"

/// Fixed Asset Register: what the company owns today, at what it cost, what has
/// been written off against it and what is left — grouped by category, the way
/// ERPNext's Asset Depreciations and Balances report reads.
///
/// Only assets Finance has **capitalised** and that have not left the books. An
/// expensed asset has no cost on the balance sheet, an unassessed one has not
/// been decided, and a disposed one is on Asset Disposals — listing any of them
/// here would put figures in the total that the balance sheet does not carry.
///
/// The figures are today's. `GET /finance/assets` carries accumulated
/// depreciation as it stands, not as it stood at a past date, so a date box
/// would only be a way to print a number labelled with the wrong day. The
/// schedule behind a row (click it) is the record month by month.
///
/// The server pages the register and the total is a sum, so every page is read
/// (`listAllAssets`) rather than the first 200 — a total over a first page is a
/// wrong figure that looks right.

export function AssetRegister() {
  const [site, setSite] = useState("")
  const [category, setCategory] = useState("")
  const [needle, setNeedle] = useState("")
  const [opened, setOpened] = useState<AssetRow | null>(null)
  const siteName = useSiteLabel()

  const register = useQuery({
    queryKey: financeKeys.assetsAll("CAPITALIZE", null, site || null),
    queryFn: ({ signal }) =>
      listAllAssets(
        { decision: "CAPITALIZE", site: site || undefined },
        signal
      ),
  })

  /// Capitalised and still owned. `disposed_on` is the fact; the status text
  /// follows it.
  const owned = useMemo(
    () => (register.data?.rows ?? []).filter((row) => row.disposed_on === null),
    [register.data]
  )
  const categories = useMemo(() => {
    const names = new Map<string, string>()
    for (const row of owned) names.set(row.category_code, row.category_name)
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [owned])

  const groups = useMemo(() => {
    const byCategory = new Map<string, { name: string; rows: AssetRow[] }>()
    const text = needle.trim().toLowerCase()
    for (const row of owned) {
      if (category !== "" && row.category_code !== category) continue
      if (
        text !== "" &&
        !row.name.toLowerCase().includes(text) &&
        !row.asset_number.toLowerCase().includes(text)
      )
        continue
      const held = byCategory.get(row.category_code) ?? {
        name: row.category_name,
        rows: [],
      }
      held.rows.push(row)
      byCategory.set(row.category_code, held)
    }
    return [...byCategory.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([code, group]) => ({
        code,
        name: group.name,
        rows: group.rows.sort((a, b) =>
          a.asset_number.localeCompare(b.asset_number)
        ),
        ...totals(group.rows),
      }))
  }, [owned, category, needle])

  const all = totals(groups.flatMap((group) => group.rows))

  const build = (): ExportSheet | null => {
    if (register.data === undefined) return null
    return {
      filename: `Fixed-Asset-Register-${todayIso()}`,
      sheet: "Asset Register",
      title: "Fixed Asset Register",
      subtitle: `As at ${day(todayIso())} · ${site === "" ? "every site" : siteName(site)}${
        category === ""
          ? ""
          : ` · ${categories.find(([code]) => code === category)?.[1] ?? category}`
      }`,
      columns: [
        { header: "Asset No", kind: "text", width: 16 },
        { header: "Name", kind: "text", width: 40 },
        { header: "Category", kind: "text", width: 28 },
        { header: "In Service", kind: "date" },
        { header: "Method", kind: "text", width: 18 },
        { header: "Life (months)", kind: "number" },
        { header: "Cost", kind: "money" },
        { header: "Accumulated Depreciation", kind: "money" },
        { header: "Book Value", kind: "money" },
        { header: "Charged Through", kind: "text", width: 18 },
      ],
      rows: groups.flatMap((group) => [
        ...group.rows.map((row) => [
          row.asset_number,
          row.name,
          row.category_name,
          row.in_service_on,
          methodLabel(row.method),
          row.useful_life_months,
          row.capitalized_cost_minor ?? 0,
          row.accumulated_minor,
          row.book_value_minor ?? 0,
          row.last_depreciated_month === null
            ? null
            : monthOf(row.last_depreciated_month),
        ]),
        [
          null,
          `Subtotal — ${group.name}`,
          null,
          null,
          null,
          null,
          group.cost,
          group.accumulated,
          group.book,
          null,
        ],
      ]),
      // Each group's subtotal is the last row of its block, so the styles are
      // laid out the same way.
      rowStyles: groups.flatMap((group) => [
        ...group.rows.map(() => undefined),
        { bold: true },
      ]),
      totalRow: [
        null,
        "Total",
        null,
        null,
        null,
        null,
        all.cost,
        all.accumulated,
        all.book,
        null,
      ],
    }
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Financial Reports"
        title="Fixed Asset Register"
        actions={
          <ExportButton
            build={build}
            disabled={register.data === undefined || groups.length === 0}
          />
        }
      />

      <ReportFilters
        note={`As at ${day(todayIso())} · capitalised assets still owned`}
      >
        <Input
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
          aria-label="Search"
          className="h-control w-64"
        />
        <SiteSelect
          value={site}
          onChange={setSite}
          className="h-control w-52"
          aria-label="Site"
        />
        <span className="inline-flex w-52 shrink-0">
          <Select
            value={category}
            onChange={setCategory}
            className="h-control w-52"
            aria-label="Category"
          >
            <option value="">Every category</option>
            {categories.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
        </span>
      </ReportFilters>

      {queryState(register, {
        loading: "Reading the asset register…",
        render: (data) => (
          <>
            {!data.complete && (
              <Banner tone="warn" className="mb-3">
                The register is larger than this report reads in one go, so the
                figures below are for part of it. Narrow the site.
              </Banner>
            )}
            <ReportSummary
              items={[
                { label: "Assets", display: count(all.assets) },
                { label: "Cost", value: all.cost },
                { label: "Accumulated depreciation", value: all.accumulated },
                { label: "Book value", value: all.book },
              ]}
            />
            {groups.length === 0 ? (
              <EmptyState>
                No capitalised asset is on the books
                {needle.trim() !== ""
                  ? ` that matches “${needle.trim()}”.`
                  : site === "" && category === ""
                    ? " yet. An asset appears here once Finance has capitalised it and until it is disposed of."
                    : " for this narrowing."}
              </EmptyState>
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th>Asset</Th>
                    <Th>In service</Th>
                    <Th align="right">Cost</Th>
                    <Th align="right">Accumulated depreciation</Th>
                    <Th align="right">Book value</Th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <Fragment key={group.code}>
                      {/* The category is the band, so it is not a column. */}
                      <tr className="bg-soft [&>td]:h-10">
                        <Td colSpan={5} className="font-medium text-ink">
                          {group.name}{" "}
                          <span className="font-normal text-mute">
                            · {count(group.rows.length)}
                          </span>
                        </Td>
                      </tr>
                      {group.rows.map((row) => (
                        <tr
                          key={row.asset_id}
                          onClick={() => setOpened(row)}
                          className="cursor-pointer"
                        >
                          <Td className="max-w-[26rem]">
                            <span
                              className="block truncate text-ink"
                              title={row.name}
                            >
                              {row.name}
                            </span>
                            <span className="block">
                              <Code>{row.asset_number}</Code>
                            </span>
                          </Td>
                          <Td>
                            {day(row.in_service_on)}
                            <span className="block text-[0.875rem] text-mute">
                              {methodLabel(row.method)} ·{" "}
                              {count(row.useful_life_months)} months
                            </span>
                          </Td>
                          <Td align="right">
                            {money(row.capitalized_cost_minor)}
                          </Td>
                          <Td align="right">{money(row.accumulated_minor)}</Td>
                          <Td align="right" className="font-medium text-ink">
                            {money(row.book_value_minor)}
                          </Td>
                        </tr>
                      ))}
                      <tr className="border-t border-hairline-strong">
                        <Td colSpan={2} className="font-medium text-ink">
                          Subtotal — {group.name}
                        </Td>
                        <Td align="right" className="font-medium text-ink">
                          {money(group.cost)}
                        </Td>
                        <Td align="right" className="font-medium text-ink">
                          {money(group.accumulated)}
                        </Td>
                        <Td align="right" className="font-medium text-ink">
                          {money(group.book)}
                        </Td>
                      </tr>
                    </Fragment>
                  ))}
                  <TotalRow>
                    <Td colSpan={2}>Total</Td>
                    <Td align="right">{money(all.cost)}</Td>
                    <Td align="right">{money(all.accumulated)}</Td>
                    <Td align="right">{money(all.book)}</Td>
                  </TotalRow>
                </tbody>
              </Grid>
            )}
          </>
        ),
      })}

      {opened !== null && (
        <ScheduleSheet asset={opened} onClose={() => setOpened(null)} />
      )}
    </PageContent>
  )
}

/// Cost, depreciation to date and what is left, summed over some assets.
/// Book value is the row's own (`cost − accumulated`, which the server derives),
/// so a group's book value is the sum of the figures printed above it.
function totals(rows: readonly AssetRow[]) {
  let cost = 0
  let accumulated = 0
  let book = 0
  for (const row of rows) {
    cost += row.capitalized_cost_minor ?? 0
    accumulated += row.accumulated_minor
    book += row.book_value_minor ?? 0
  }
  return { assets: rows.length, cost, accumulated, book }
}

/// The client's own word for how an asset is written down.
function methodLabel(method: string | null): string {
  if (method === null) return "—"
  return (
    DEPRECIATION_METHODS.find((one) => one.value === method)?.label ?? method
  )
}

// ---------------------------------------------------------------------------
// The schedule behind a row
// ---------------------------------------------------------------------------

/// What has been charged against one asset, month by month, and what is left —
/// the record and not a projection: a month the run never reached is simply
/// not in the list, which is the only way to see an asset the run has been
/// skipping.
function ScheduleSheet({
  asset,
  onClose,
}: {
  asset: AssetRow
  onClose: () => void
}) {
  const schedule = useQuery({
    queryKey: financeKeys.assetSchedule(asset.asset_id),
    queryFn: ({ signal }) => assetSchedule(asset.asset_id, signal),
  })

  return (
    <Panel
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={`${asset.asset_number} · ${asset.name}`}
      sub={asset.category_name}
    >
      {queryState(schedule, {
        loading: "Reading what has been charged…",
        render: (data) => {
          const facts: (readonly [string, React.ReactNode])[] = [
            ["Cost", money(data.capitalized_cost_minor)],
            ["Salvage value", money(data.salvage_value_minor)],
            ["Method", methodLabel(data.method)],
            ["Life", `${count(data.useful_life_months)} months`],
            ["In service", day(data.in_service_on)],
          ]
          // What the old system had already charged when this one took over:
          // a figure somebody carried in, not a list of journals.
          if (data.opening_accumulated_minor !== null)
            facts.push([
              "Carried in",
              `${money(data.opening_accumulated_minor)} · through ${monthOf(data.opening_through)}`,
            ])
          facts.push(
            ["Charged so far", money(data.charged_total_minor)],
            ["Charged through", monthOf(data.last_depreciated_month)],
            ["Months remaining", count(data.months_remaining)],
            ["Left to spread", money(data.remaining_depreciable_minor)]
          )
          return (
            <div className="flex flex-col gap-4">
              <dl className="grid grid-cols-[11rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[0.9375rem]">
                {facts.map(([term, value]) => (
                  <div key={term} className="contents">
                    <dt className="text-mute">{term}</dt>
                    <dd className="min-w-0 text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
              {data.charged.length === 0 ? (
                <p className="text-[0.875rem] text-mute">
                  Nothing has been charged yet. Land never charges, and an asset
                  capitalised this month has not been reached by the run.
                </p>
              ) : (
                <Grid>
                  <thead>
                    <tr>
                      <Th>Month</Th>
                      <Th>Entry</Th>
                      <Th align="right">Charged</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.charged].reverse().map((row) => (
                      <tr key={row.period_month}>
                        <Td>{monthOf(row.period_month)}</Td>
                        <Td>
                          <AppLink
                            to="/finance/accounting/journal-entries"
                            sheet={{ key: "entry", value: row.entry_id }}
                            className="font-mono text-[0.875rem] text-accent hover:underline"
                          >
                            {row.entry_number}
                          </AppLink>
                        </Td>
                        <Td align="right">{money(row.amount_minor)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Grid>
              )}
            </div>
          )
        },
      })}
    </Panel>
  )
}
