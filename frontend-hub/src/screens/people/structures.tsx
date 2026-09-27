import { useQuery } from "@tanstack/react-query"

import { PageContent } from "@/components/shell/app-shell"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { money } from "@/lib/format"
import { listGrades, listPositions, listStructures, nextKeys } from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"

/// Salary structures and the organisation they hang from.
///
/// A structure names which pay components a slip may carry for the kind of
/// job it is — staf toko earns overtime and a KPI bonus, a kepala toko earns
/// the bonus without the overtime line, manajer HO carries neither. The
/// position maps to the structure; the grade carries the band the base is
/// checked against. All three are head office's vocabulary, and the rows ship
/// seeded: a shop does not invent its own idea of a grade.
///
/// Read only, deliberately. Editing waits for a need somebody actually has.

export function Structures() {
  const structures = useQuery({
    queryKey: nextKeys.org(),
    queryFn: ({ signal }) => listStructures(signal),
  })
  const positions = useQuery({
    queryKey: [...nextKeys.org(), "positions"],
    queryFn: ({ signal }) => listPositions(signal),
  })
  const grades = useQuery({
    queryKey: [...nextKeys.org(), "grades"],
    queryFn: ({ signal }) => listGrades(signal),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="People · Setup"
        title="Salary structures"
        sub="Struktur menentukan komponen apa yang dihitung; penugasan gaji menentukan base per karyawan dengan tanggal berlaku. Perubahan gaji membuat baris baru, tidak menimpa yang lama."
      />

      <Card className="mb-4 overflow-hidden">
        <CardHeader>
          <CardTitle>Structures</CardTitle>
        </CardHeader>
        {queryState(structures, {
          loading: "Reading the structures…",
          render: () => (
            <div className="divide-y">
              {(structures.data ?? []).map((structure) => (
                <div key={structure.code} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-ink">
                      {structure.name}{" "}
                      <span className="font-mono text-meta text-mute">{structure.code}</span>
                    </span>
                    {structure.bonus_cap_policy !== null && (
                      <span className="text-meta text-mute">
                        bonus cap: {structure.bonus_cap_policy}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 font-mono text-meta text-body">
                    {structure.components.join(" · ")}
                  </p>
                </div>
              ))}
              {(structures.data ?? []).length === 0 && (
                <EmptyState>No structure is defined.</EmptyState>
              )}
            </div>
          ),
        })}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Positions</CardTitle>
          </CardHeader>
          {queryState(positions, {
            loading: "Reading the positions…",
            render: () => (
              <div className="divide-y">
                {(positions.data ?? []).map((position) => (
                  <div key={position.name} className="flex items-baseline justify-between gap-3 px-4 py-2">
                    <span className="text-body">{position.name}</span>
                    <span className="text-meta text-mute">
                      grade {position.grade_floor}
                      {position.grade_ceiling !== position.grade_floor
                        ? `–${position.grade_ceiling}`
                        : ""}{" "}
                      · {position.structure}
                    </span>
                  </div>
                ))}
                {(positions.data ?? []).length === 0 && (
                  <EmptyState>No position is defined.</EmptyState>
                )}
              </div>
            ),
          })}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Grades</CardTitle>
          </CardHeader>
          {queryState(grades, {
            loading: "Reading the grades…",
            render: () => (
              <div className="divide-y">
                {(grades.data ?? []).map((grade) => (
                  <div key={grade.code} className="flex items-baseline justify-between gap-3 px-4 py-2">
                    <span className="font-medium text-ink">{grade.code}</span>
                    <span className="text-meta text-body">
                      {money(grade.floor_minor)} – {money(grade.ceiling_minor)}
                    </span>
                  </div>
                ))}
                {(grades.data ?? []).length === 0 && (
                  <EmptyState>No grade is defined.</EmptyState>
                )}
              </div>
            ),
          })}
        </Card>
      </div>
    </PageContent>
  )
}
