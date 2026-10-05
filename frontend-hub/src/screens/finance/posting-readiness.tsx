import { useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { Checkbox, Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, label } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { usePostingReadiness } from "@/screens/finance/badges"
import {
  encodeLinkSource,
  sourceTypeLabel,
} from "@/screens/finance/master-data"
import type { ReadinessRow } from "@itulah/contract"

/// "If this happened now in this unit's books, would it post?" — for every
/// role and every source, in every unit.
///
/// # Why a matrix
///
/// A gap is a (role, source, unit), and the question somebody brings here is
/// never "which role" alone — it is "which store cannot post rent". The rows
/// are the roles, the columns are the units (head office and each store, by
/// the client's code), and a red dash is exactly one posting that will be
/// refused. The cell is the account the server resolved, most specific link
/// winning, and not something this screen worked out.
///
/// # Why only gaps by default
///
/// There are a few hundred rows and on a good day nearly all of them are
/// complete. The screen is for the ones that are not; the rest is one click
/// away.
///
/// Fixing a gap happens on Account links, so a row opens that role's sheet
/// there rather than growing a second editor here.
export function PostingReadinessScreen() {
  const navigate = useNavigate()
  const readiness = usePostingReadiness()
  const [onlyGaps, setOnlyGaps] = useState(true)
  const [needle, setNeedle] = useState("")

  const rows = useMemo<ReadinessRow[]>(() => {
    const text = needle.trim().toLowerCase()
    return (readiness.data?.rows ?? []).filter(
      (row) =>
        (!onlyGaps || row.gaps > 0) &&
        (text === "" ||
          row.role.includes(text) ||
          row.source_id.toLowerCase().includes(text) ||
          sourceTypeLabel(row.source_type).toLowerCase().includes(text) ||
          (row.label ?? "").toLowerCase().includes(text))
    )
  }, [readiness.data, onlyGaps, needle])

  // A row decided by a master record opens Account links narrowed to that
  // record, so the add form arrives with the source filled in.
  const open = (row: ReadinessRow) =>
    navigate({
      to: "/finance/setup/account-links",
      search: {
        mapping: row.role,
        linkSource:
          row.source_type === "COMPANY" && row.source_id === ""
            ? undefined
            : encodeLinkSource(row),
      },
    } as never)

  const gaps = readiness.data?.gaps ?? 0
  const rolesWithGaps = new Set(
    (readiness.data?.rows ?? [])
      .filter((row) => row.gaps > 0)
      .map((row) => row.role)
  ).size

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Posting readiness"
        sub="Every role the posting rules use, against every unit: the account a posting would land on now, or a gap where it would be refused."
        actions={
          <Input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            className="h-8 w-56"
          />
        }
      />

      <Toolbar>
        <Checkbox
          label="Only rows with gaps"
          checked={onlyGaps}
          onChange={(next) => setOnlyGaps(next)}
        />
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute">
          {count(rows.length)} of {count(readiness.data?.rows.length ?? 0)}{" "}
          role-and-source rows · open one to fix it on Account links
        </span>
      </Toolbar>

      {readiness.data && (
        <KpiStrip className="md:grid-cols-3 xl:grid-cols-3">
          <Kpi label="Gaps" value={count(gaps)} />
          <Kpi label="Roles with a gap" value={count(rolesWithGaps)} />
          <Kpi label="Units" value={count(readiness.data.locations.length)} />
        </KpiStrip>
      )}

      <Card className="overflow-hidden">
        {queryState(readiness, {
          loading: "Asking every unit…",
          render: (data) =>
            rows.length === 0 ? (
              <EmptyState>
                {onlyGaps && needle.trim() === ""
                  ? "Every role reaches an account in every unit. Everything the rules post can post."
                  : "No row matches the search."}
              </EmptyState>
            ) : (
              <div className="max-h-[calc(100vh-20rem)] overflow-auto">
                <table className="w-max min-w-full border-collapse text-[0.875rem]">
                  <thead className="sticky top-0 z-10 bg-canvas">
                    <tr>
                      <th className="sticky left-0 z-20 border-b border-hairline-2 bg-canvas px-3 py-2 text-left font-medium whitespace-nowrap text-mute">
                        Role
                      </th>
                      <th className="border-b border-hairline-2 px-2 py-2 text-left font-medium whitespace-nowrap text-mute">
                        Source
                      </th>
                      <th className="border-b border-hairline-2 px-2 py-2 text-right font-medium whitespace-nowrap text-mute">
                        Gaps
                      </th>
                      {data.locations.map((location) => (
                        <th
                          key={location.unit_id}
                          title={location.name}
                          className="border-b border-hairline-2 px-2 py-2 text-left font-medium whitespace-nowrap text-mute"
                        >
                          {location.code}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={`${row.role}\t${row.source_type}\t${row.source_id}`}
                        onClick={() => open(row)}
                        className="group cursor-pointer hover:bg-soft"
                      >
                        <td className="sticky left-0 border-b border-hairline bg-canvas px-3 py-2 group-hover:bg-soft">
                          <div className="font-medium whitespace-nowrap text-ink">
                            {row.label ?? label(row.role)}
                          </div>
                          <div className="font-mono text-mute">{row.role}</div>
                        </td>
                        <td className="border-b border-hairline px-2 py-2 whitespace-nowrap text-body">
                          {row.source_type !== "COMPANY" && (
                            <span className="mr-1.5 text-mute">
                              {sourceTypeLabel(row.source_type)}
                            </span>
                          )}
                          {row.source_id === "" ? (
                            <span className="text-faint">—</span>
                          ) : (
                            row.source_id
                          )}
                        </td>
                        <td
                          className={cn(
                            "border-b border-hairline px-2 py-2 text-right tabular-nums",
                            row.gaps > 0
                              ? "font-medium text-bad-fg"
                              : "text-ok-fg"
                          )}
                        >
                          {row.gaps > 0 ? count(row.gaps) : "None"}
                        </td>
                        {data.locations.map((location) => {
                          const cell = row.cells.find(
                            (one) => one.unit_id === location.unit_id
                          )
                          return (
                            <td
                              key={location.unit_id}
                              className="border-b border-hairline px-2 py-2"
                            >
                              {cell === undefined ||
                              cell.account_code === null ? (
                                <Tag tone="bad">—</Tag>
                              ) : (
                                <span
                                  className={cn(
                                    "font-mono",
                                    cell.scope_type === "UNIT"
                                      ? "text-info-fg"
                                      : "text-body"
                                  )}
                                  title={
                                    cell.scope_type === null
                                      ? undefined
                                      : `Decided by a ${label(cell.scope_type).toLowerCase()} link`
                                  }
                                >
                                  {cell.account_code}
                                </span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ),
        })}
      </Card>
    </PageContent>
  )
}
