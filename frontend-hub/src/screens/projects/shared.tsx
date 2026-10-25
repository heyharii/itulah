import type { ProjectStatus } from "@/lib/queries/projects"

/// How a project's status reads, and its tone. GA's close is "Closed"; what
/// Finance does after is "Capitalised".
export const STATUS_WORD: Record<ProjectStatus, string> = {
  OPEN: "Open",
  READY: "Closed",
  CAPITALISED: "Capitalised",
}

export const STATUS_TONE: Record<ProjectStatus, "info" | "warn" | "ok"> = {
  OPEN: "info",
  READY: "warn",
  CAPITALISED: "ok",
}

/// A project's own page. Finance reaches the same project under Assets.
export const projectPath = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}`

export const financeProjectPath = (projectId: string) =>
  `/finance/assets/contractor-projects/${encodeURIComponent(projectId)}`

/// `H-12`, or "Opening day", counted back from the opening.
export function countdown(daysBefore: number): string {
  if (daysBefore === 0) return "Opening day"
  return daysBefore > 0 ? `H-${daysBefore}` : `H+${-daysBefore}`
}
