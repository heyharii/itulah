import type { OrgChartNode, UnitView } from "@itulah/contract"

/// What the org chart and its sheet both need to say about a person, and the
/// few questions they both ask of the list: who is under whom, who belongs to
/// which unit, who has never been placed.

/// The name on a card: the full name, else the employee code.
export const nameOf = (node: OrgChartNode) =>
  node.full_name ?? node.employee_code

/// Each person's position — the latest contract's, as the workforce list
/// carries it — by employee id. The chart's own read has no job title.
export type Positions = ReadonlyMap<string, string>

/// The line under the name: their position, else level · department. Somebody
/// with none of them is told by their code, so the line is never empty.
export const roleOf = (node: OrgChartNode, positions: Positions) =>
  positions.get(node.employee_id) ||
  [node.level_name, node.department_name].filter(Boolean).join(" · ") ||
  node.employee_code

/// Two letters for the avatar: the first of the first two words of the name.
export const initialsOf = (node: OrgChartNode) =>
  nameOf(node)
    .split(/\s+/)
    .filter((word) => word !== "")
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase()

/// A unit as people read it. Head office is spelled out; a store is its name.
export const unitLabel = (unit: UnitView) =>
  unit.kind === "HO" ? "Head Office" : unit.name

/// Who reports to whom, over everybody on the chart (not just one unit's):
/// "the people under them" must be found across units, or a boss picked from
/// another unit could close a loop.
export function reportsIndex(nodes: readonly OrgChartNode[]) {
  const byId = new Map<string, OrgChartNode>()
  const under = new Map<string, OrgChartNode[]>()
  for (const node of nodes) {
    byId.set(node.employee_id, node)
    if (node.reports_to !== null) {
      const list = under.get(node.reports_to) ?? []
      list.push(node)
      under.set(node.reports_to, list)
    }
  }
  return { byId, under }
}

export type ReportsIndex = ReturnType<typeof reportsIndex>

/// The person and everybody beneath them, however many levels down.
export function withEveryoneUnder(
  id: string,
  under: ReadonlyMap<string, readonly OrgChartNode[]>
): Set<string> {
  const found = new Set<string>([id])
  const todo = [id]
  for (let next = todo.pop(); next !== undefined; next = todo.pop()) {
    for (const report of under.get(next) ?? []) {
      if (found.has(report.employee_id)) continue
      found.add(report.employee_id)
      todo.push(report.employee_id)
    }
  }
  return found
}

/// Whether somebody is on the chart of one unit. A person posted nowhere
/// belongs to head office's chart, so nobody working here drops off every
/// chart: head office is where an unposted person gets sorted out.
export function belongsTo(
  node: OrgChartNode,
  unitId: string | null,
  homeId: string | null
) {
  return (node.unit_id ?? homeId) === unitId
}

/// Nobody has said anything about them yet: no department, level, grade or
/// boss, and nobody reports to them. They are not drawn in the tree.
export function isUnplaced(
  node: OrgChartNode,
  under: ReadonlyMap<string, readonly OrgChartNode[]>
) {
  return (
    node.department_code === null &&
    node.level_name === null &&
    node.grade_code === null &&
    node.reports_to === null &&
    !under.has(node.employee_id)
  )
}
