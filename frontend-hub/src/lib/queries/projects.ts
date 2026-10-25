import { queryOptions } from "@tanstack/react-query"

import { node } from "@/lib/api"

/// Projects (0997): a store opening or a renovation that GA runs and Finance
/// capitalises. One row on the server (`contractor_project`), read by both
/// desks: GA under `/api/v1/ga/projects`, Finance under
/// `/api/v1/finance/contractor-projects/{id}`.
///
/// The shapes mirror `postgres/ga_projects.rs` and `postgres/project_costs.rs`
/// field for field; they are written here until the generated contract
/// carries them (`tests/contract_types.rs` names them).

export type ProjectKind = "STORE_OPENING" | "RENOVATION" | "CONTRACTOR"
export type ProjectStatus = "OPEN" | "READY" | "CAPITALISED"
export type ProjectDepartment =
  | "ga"
  | "stores"
  | "people"
  | "merchandise"
  | "marketing"
  | "finance"

export interface GaProjectRow {
  project_id: string
  project_number: string
  name: string
  kind: ProjectKind
  site_id: string | null
  site_name: string | null
  unit_id: string
  opens_on: string | null
  pic: string | null
  status: ProjectStatus
  ready_on: string | null
  ready_by: string | null
  capitalised_on: string | null
  opened_at: string
  tasks: number
  tasks_left: number
  tasks_late: number
  assets: number
  work: number
}

export interface GaProjectTask {
  task_id: string
  name: string
  department: ProjectDepartment
  pic: string | null
  due_on: string
  milestone: boolean
  from_template: boolean
  done_on: string | null
  done_by: string | null
}

export interface GaProjectAsset {
  asset_id: string
  asset_number: string
  name: string
  class_code: string
  class_name: string
  build: string
  quantity: number
  status: string
}

export type ProjectWorkKind = "CONTRACT" | "REPAIR" | "SUPPLY_REQUEST"

export interface GaProjectWork {
  kind: ProjectWorkKind
  record_id: string
  number: string | null
  name: string
  party: string | null
  status: string
  dated: string | null
}

export interface GaProjectPage {
  project: GaProjectRow
  tasks: GaProjectTask[]
  assets: GaProjectAsset[]
  work: GaProjectWork[]
}

export interface CreateGaProjectRequest {
  name: string
  kind: "STORE_OPENING" | "RENOVATION"
  site_id: string
  opens_on: string
  pic?: string | null
  note?: string | null
}

export interface AddGaProjectTaskRequest {
  name: string
  department: ProjectDepartment
  pic?: string | null
  due_on: string
  milestone?: boolean | null
}

export interface UpdateGaProjectTaskRequest {
  name?: string | null
  pic?: string | null
  due_on?: string | null
  done?: boolean | null
}

export type ProjectCostSource = "BILL_LINE" | "BKK_LINE" | "CLAIM_LINE"
export type ProjectDestination = "ASSET" | "PRE_OPENING" | "EXPENSE"

export interface ProjectCost {
  source_kind: ProjectCostSource
  source_id: string
  dated: string
  document: string
  party: string | null
  what: string | null
  amount_minor: number
  unit_id: string
  account_code: string | null
  in_cip: boolean
  placed: ProjectDestination | null
  placed_asset_id: string | null
}

export interface CapitaliseLineRequest {
  source_kind: ProjectCostSource
  source_id: string
  goes_to: ProjectDestination
  asset_id?: string | null
  account_code?: string | null
}

export interface CapitaliseProjectRequest {
  in_use_on: string
  pre_opening_months?: number | null
  lines: CapitaliseLineRequest[]
  lives?: { asset_id: string; useful_life_months: number }[] | null
}

/// Every key starts with `ga` (GA's department) or `finance`, so signing out
/// drops them with the rest of the department; GA's writes invalidate
/// `["ga"]`, which refreshes the project page too.
export const projectKeys = {
  list: () => ["ga", "projects"] as const,
  page: (projectId: string) => ["ga", "projects", projectId] as const,
  costs: (projectId: string) =>
    ["finance", "projects", projectId, "costs"] as const,
  candidates: (projectId: string) =>
    ["finance", "projects", projectId, "candidates"] as const,
}

const id = encodeURIComponent

export const projectsQuery = () =>
  queryOptions({
    queryKey: projectKeys.list(),
    queryFn: ({ signal }) =>
      node.get<GaProjectRow[]>("/api/v1/ga/projects", { signal }),
  })

/// The project's page. Finance reads the same page through its own path, so
/// the job sections gate each desk where it already is.
export const projectPageQuery = (projectId: string, finance = false) =>
  queryOptions({
    queryKey: projectKeys.page(projectId),
    queryFn: ({ signal }) =>
      node.get<GaProjectPage>(
        finance
          ? `/api/v1/finance/contractor-projects/${id(projectId)}/page`
          : `/api/v1/ga/projects/${id(projectId)}`,
        { signal }
      ),
  })

export const projectCostsQuery = (projectId: string) =>
  queryOptions({
    queryKey: projectKeys.costs(projectId),
    queryFn: ({ signal }) =>
      node.get<ProjectCost[]>(
        `/api/v1/finance/contractor-projects/${id(projectId)}/costs`,
        { signal }
      ),
  })

export const projectCandidatesQuery = (projectId: string) =>
  queryOptions({
    queryKey: projectKeys.candidates(projectId),
    queryFn: ({ signal }) =>
      node.get<ProjectCost[]>(
        `/api/v1/finance/contractor-projects/${id(projectId)}/cost-candidates`,
        { signal }
      ),
  })

export function createProject(request: CreateGaProjectRequest) {
  return node.post<GaProjectPage>("/api/v1/ga/projects", request)
}

export function addProjectTask(
  projectId: string,
  request: AddGaProjectTaskRequest
) {
  return node.post<GaProjectPage>(
    `/api/v1/ga/projects/${id(projectId)}/tasks`,
    request
  )
}

export function updateProjectTask(
  projectId: string,
  taskId: string,
  request: UpdateGaProjectTaskRequest
) {
  return node.patch<GaProjectPage>(
    `/api/v1/ga/projects/${id(projectId)}/tasks/${id(taskId)}`,
    request
  )
}

/// Bring an asset, a contract, a repair or a supply request into the project
/// (or, with `unlink`, take it out). The record is made by its own form first.
export function linkToProject(
  projectId: string,
  kind: "ASSET" | ProjectWorkKind,
  recordId: string,
  unlink = false
) {
  return node.post<GaProjectPage>(`/api/v1/ga/projects/${id(projectId)}/links`, {
    kind,
    record_id: recordId,
    unlink,
  })
}

export function closeProject(projectId: string, readyOn: string) {
  return node.post<GaProjectPage>(`/api/v1/ga/projects/${id(projectId)}/close`, {
    ready_on: readyOn,
  })
}

export function linkProjectCost(
  projectId: string,
  sourceKind: ProjectCostSource,
  sourceId: string,
  unlink = false
) {
  return node.post<ProjectCost[]>(
    `/api/v1/finance/contractor-projects/${id(projectId)}/costs`,
    { source_kind: sourceKind, source_id: sourceId, unlink }
  )
}

export function capitaliseProject(
  projectId: string,
  request: CapitaliseProjectRequest
) {
  return node.post<ProjectCost[]>(
    `/api/v1/finance/contractor-projects/${id(projectId)}/capitalise`,
    request
  )
}

/// How each department is called on a task row.
export const DEPARTMENT_LABEL: Record<ProjectDepartment, string> = {
  ga: "GA",
  stores: "Stores",
  people: "HR",
  merchandise: "Merchandise",
  marketing: "Marketing",
  finance: "Finance",
}

export const KIND_LABEL: Record<ProjectKind, string> = {
  STORE_OPENING: "Store opening",
  RENOVATION: "Renovation",
  CONTRACTOR: "Contractor",
}

/// Days from `from` to `to`, both `YYYY-MM-DD`.
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}
