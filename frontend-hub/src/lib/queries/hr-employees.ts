import { useQuery } from "@tanstack/react-query"

import { node } from "@/lib/api"
import {
  listChangeProposals,
  listEmployees,
  listLifecycleTasks,
  peopleKeys,
  type LifecycleTaskView,
} from "@/lib/queries/people"
import type { EmployeeSummary, WarningLetterView } from "@itulah/contract"

/// The employee-lifecycle lists behind People › Employees: change proposals,
/// onboarding and offboarding checklists, and every warning letter ever
/// issued. The writes stay in `people.ts`; this file only reads what those
/// screens list.

export const hrEmployeeKeys = {
  all: () => ["people", "hr"] as const,
  changes: () => ["people", "hr", "changes"] as const,
  tasks: (kind: "ONBOARDING" | "SEPARATION") =>
    ["people", "hr", "lifecycle-tasks", kind] as const,
  letters: () => ["people", "warning-letters", "all"] as const,
}

/// Every letter, in force or not — `?all=true`. The in-force list the
/// directory used to show is `activeWarningLetters`; this is the register
/// head office reads when a dispute asks what was issued, and when.
export function allWarningLetters(
  signal?: AbortSignal
): Promise<WarningLetterView[]> {
  return node.get<WarningLetterView[]>("/api/v1/warning-letters?all=true", {
    signal,
  })
}

export function useAllWarningLetters() {
  return useQuery({
    queryKey: hrEmployeeKeys.letters(),
    queryFn: ({ signal }) => allWarningLetters(signal),
  })
}

export function useChangeProposals() {
  return useQuery({
    queryKey: hrEmployeeKeys.changes(),
    queryFn: ({ signal }) => listChangeProposals({}, signal),
  })
}

export function useLifecycleTasks(kind: "ONBOARDING" | "SEPARATION") {
  return useQuery({
    queryKey: hrEmployeeKeys.tasks(kind),
    queryFn: ({ signal }) => listLifecycleTasks({ kind }, signal),
  })
}

/// Everybody on the books, for naming rows and filling pickers. One cached
/// read shared by every screen in this group.
export function useEveryEmployee() {
  return useQuery({
    queryKey: peopleKeys.employees({ limit: 1000 }),
    queryFn: ({ signal }) => listEmployees({ limit: 1000 }, signal),
  })
}

export function nameOf(
  people: readonly EmployeeSummary[] | undefined,
  employeeId: string
): string {
  const one = people?.find((person) => person.employee_id === employeeId)
  return one?.full_name ?? one?.employee_code ?? employeeId
}

export type ChecklistProgress = {
  employeeId: string
  done: number
  total: number
  tasks: LifecycleTaskView[]
}

/// One row per person: how many of their tasks are ticked.
export function progressByEmployee(
  tasks: readonly LifecycleTaskView[]
): ChecklistProgress[] {
  const byPerson = new Map<string, ChecklistProgress>()
  for (const task of tasks) {
    const row = byPerson.get(task.employee_id) ?? {
      employeeId: task.employee_id,
      done: 0,
      total: 0,
      tasks: [],
    }
    row.total += 1
    if (task.state === "DONE") row.done += 1
    row.tasks.push(task)
    byPerson.set(task.employee_id, row)
  }
  return [...byPerson.values()]
}

export const CHANGE_KIND_LABEL: Readonly<Record<string, string>> = {
  PROMOTION: "Promotion",
  TRANSFER: "Transfer",
  SALARY: "Salary",
  SEPARATION: "Separation",
}

export const CHANGE_STATE_LABEL: Readonly<Record<string, string>> = {
  PENDING: "Waiting",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
}

export const LETTER_LEVEL_LABEL: Readonly<Record<string, string>> = {
  TEGURAN: "Teguran",
  SP1: "SP 1",
  SP2: "SP 2",
  SP3: "SP 3",
}
