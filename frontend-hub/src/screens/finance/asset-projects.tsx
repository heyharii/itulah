import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"

import { FilterChips } from "@/components/ui/filter-chips"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Status } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import {
  contractorProjectsQuery,
  type ContractorProject,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import { todayIso } from "@/screens/finance/chart"
import { useUnitName } from "@/screens/finance/hooks"
import { financeProjectPath } from "@/screens/projects/shared"

/// Assets › Projects: the store-opening and renovation work GA runs and Finance
/// capitalises. The figures are the projects' own (`/contractor-projects`):
/// what was paid into Uang Muka, what is invoiced, and where each project
/// stands — Open, Ready to capitalise (GA handed it over), Capitalised.
///
/// A row opens the project's page, where its tranches and the split into
/// assets are read and where Capitalise is pressed.

const WORDS: Record<
  ContractorProject["status"],
  readonly [string, "neutral" | "info" | "ok"]
> = {
  OPEN: ["Open", "neutral"],
  READY: ["Ready to capitalise", "info"],
  CAPITALISED: ["Capitalised", "ok"],
}

export function ProjectsTab() {
  const navigate = useNavigate()
  const unitName = useUnitName()
  const projects = useQuery(contractorProjectsQuery())
  const [status, setStatus] = useState<ContractorProject["status"] | null>(null)
  const year = todayIso().slice(0, 4)

  const all = useMemo(() => projects.data ?? [], [projects.data])
  const n = (k: ContractorProject["status"]) =>
    all.filter((one) => one.status === k).length
  const rows = all.filter((one) => status === null || one.status === status)

  return (
    <>
      <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
        <Kpi
          label="In Uang Muka"
          value={money(
            all
              .filter((one) => one.status !== "CAPITALISED")
              .reduce((sum, one) => sum + one.advance_left_minor, 0)
          )}
        />
        <Kpi
          label="Ready to capitalise"
          value={count(n("READY"))}
          onClick={() => setStatus("READY")}
        />
        <Kpi
          label={`Capitalised in ${year}`}
          value={money(
            all
              .filter(
                (one) =>
                  one.status === "CAPITALISED" &&
                  (one.closed_on ?? "").startsWith(year)
              )
              .reduce((sum, one) => sum + one.applied_minor, 0)
          )}
        />
        <Kpi label="Projects" value={count(all.length)} />
      </KpiStrip>
      <Toolbar>
        <FilterChips
          label="Status"
          value={status}
          onChange={(next) =>
            setStatus(
              next === null ? null : (next as ContractorProject["status"])
            )
          }
          options={[
            { value: null, label: "All", count: all.length },
            { value: "OPEN", label: "Open", count: n("OPEN") },
            {
              value: "READY",
              label: "Ready to capitalise",
              count: n("READY"),
            },
            {
              value: "CAPITALISED",
              label: "Capitalised",
              count: n("CAPITALISED"),
            },
          ]}
        />
      </Toolbar>
      {queryState(projects, {
        loading: "Reading the projects…",
        render: () =>
          rows.length === 0 ? (
            <EmptyState>No project matches.</EmptyState>
          ) : (
            <Grid followRows>
              <thead>
                <tr>
                  <Th>Project</Th>
                  <Th width="12rem">Shop</Th>
                  <Th width="11rem">GA lead</Th>
                  <Th width="9rem">Handed over</Th>
                  <Th align="right" width="12rem">
                    Paid to contractor
                  </Th>
                  <Th width="13rem">Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((one) => {
                  const [word, tone] = WORDS[one.status]
                  return (
                    <tr
                      key={one.project_id}
                      className="cursor-pointer hover:bg-soft"
                      onClick={() =>
                        void navigate({
                          to: financeProjectPath(one.project_id),
                        })
                      }
                    >
                      <Td className="max-w-0 text-ink">
                        <span className="block truncate" title={one.name}>
                          {one.name}
                        </span>
                      </Td>
                      <Td>{unitName(one.unit_id).replace(/^[^·]*· /, "")}</Td>
                      {/* GA's lead is not on the finance read. */}
                      <Td>
                        <span className="text-faint">—</span>
                      </Td>
                      <Td>
                        {one.ready_on === null ? (
                          <span className="text-faint">—</span>
                        ) : (
                          day(one.ready_on)
                        )}
                      </Td>
                      <Td align="right">{money(one.advanced_minor)}</Td>
                      <Td>
                        <Status tone={tone}>{word}</Status>
                      </Td>
                    </tr>
                  )
                })}
                <TotalRow>
                  <Td>
                    {count(rows.length)}{" "}
                    {rows.length === 1 ? "project" : "projects"}
                  </Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td align="right">
                    {money(
                      rows.reduce((sum, one) => sum + one.advanced_minor, 0)
                    )}
                  </Td>
                  <Td />
                </TotalRow>
              </tbody>
            </Grid>
          ),
      })}
    </>
  )
}
