import { useQuery } from "@tanstack/react-query"

import { node } from "@/lib/api"

/// Flow templates — "Alur barang" (migrations 0615–0619, `domain::flow`).
///
/// A stage's MEANING is code on the server (pick, pack, masuk surat jalan,
/// muat, berangkat, terima…); a template is the data an Admin edits: a route,
/// the stages in order, who raises the source document, who performs each
/// stage, proof, deadlines, what may be skipped and where the goods land.
/// Every save is a new version; a running flow keeps the one it started on.
///
/// The types are written here rather than generated: the contract package is
/// regenerated from the Rust with `ts-rs`, which this step did not run.

export type RouteEndCode = "HO" | "STORE" | "SUPPLIER" | "CUSTOMER"

export type StageKindCode =
  | "APPROVAL"
  | "PICK"
  | "PACK"
  | "CLOSE_KOLI"
  | "SHIP"
  | "LOAD"
  | "DEPART"
  | "RECEIVE"
  | "INSPECT"
  | "READY_FOR_PICKUP"
  | "HANDOVER_WITH_PROOF"
  | "ARRIVAL"
  | "BLIND_COUNT"
  | "VERIFICATION"
  | "TAGGING"
  | "PUTAWAY"

export type FlowRoleCode =
  | "HO_MD"
  | "HO_BUYER"
  | "HO_ADMIN"
  | "GUDANG_STAFF"
  | "GUDANG_SUPERVISOR"
  | "HO_DELIVERY"
  | "STORE_STAFF"
  | "STORE_MANAGER"

export type ProofKindCode =
  | "RFID_SCAN"
  | "MANUAL_COUNT"
  | "PHOTO"
  | "SIGNATURE"
  | "SIGNED_RETURN_NOTE"

export type PoolRoleCode =
  | "PENDING"
  | "WAREHOUSE"
  | "RETURN"
  | "REJECT"
  | "STOCKROOM"
  | "FLOOR"

export interface TemplateStage {
  kind: StageKindCode
  performer: FlowRoleCode
  proof: ProofKindCode[]
  deadline_hours: number | null
  skippable: boolean
  params: Record<string, unknown>
}

export interface FlowTemplateDraft {
  code: string
  name: string
  route: { origin: RouteEndCode; destination: RouteEndCode }
  starters: FlowRoleCode[]
  destination_pool: PoolRoleCode | null
  stages: TemplateStage[]
  notes: string | null
}

/// One thing wrong with a draft, placed on the row it belongs to.
export interface TemplateProblem {
  stage: number | null
  field: string | null
  rule: string
  message: string
}

export interface FlowTemplateSummary {
  id: string
  code: string
  name: string
  origin: RouteEndCode
  destination: RouteEndCode
  status: "ACTIVE" | "RETIRED"
  is_default: boolean
  current_version: number | null
  stages: StageKindCode[]
  starters: FlowRoleCode[]
  updated_by: string
  updated_at: string
}

export interface FlowTemplateVersion {
  id: string
  version: number
  is_current: boolean
  created_by: string
  created_at: string
  documents: number
  template: FlowTemplateDraft
}

export interface FlowTemplateDetail extends FlowTemplateSummary {
  versions: FlowTemplateVersion[]
}

export type RequiredProof =
  | { type: "NONE" }
  | { type: "COUNT_METHOD" }
  | { type: "ANY_OF"; kinds: ProofKindCode[] }

/// One stage of the catalogue, as the server fixes it.
export interface StageCatalogueEntry {
  code: StageKindCode
  kind: StageKindCode
  label: string
  meaning: string
  side: "ORIGIN" | "DESTINATION" | "HEAD_OFFICE"
  executed_at: "NODE" | "HUB"
  custody: "NONE" | "LEAVES" | "ACCEPTS" | "HANDS_OVER"
  count: "NONE" | "MUST_COUNT" | "CARRIES_UPSTREAM"
  blind: boolean
  allowed_proof: ProofKindCode[]
  required_proof: RequiredProof
  fixed_rules: string[]
  fixed_rule_texts: string[]
  may_skip: boolean
  parks: "SCAN" | "APPROVAL" | "HANDOVER" | null
}

/// Where a stage's work is done today.
export interface StageDelegate {
  stage: StageKindCode
  wiring: "IN_FLOW" | "EXISTING_SURFACE" | "MISSING"
  surface: string
  fact: string | null
  note: string
}

export interface FlowChoice<C extends string = string> {
  code: C
  label: string
  works_at?: "HO" | "STORE"
  min_role?: "CASHIER" | "SUPERVISOR" | "ADMIN"
}

export interface FlowVocabulary {
  stages: StageCatalogueEntry[]
  delegates: StageDelegate[]
  roles: FlowChoice<FlowRoleCode>[]
  proofs: FlowChoice<ProofKindCode>[]
  pool_roles: FlowChoice<PoolRoleCode>[]
  route_ends: FlowChoice<RouteEndCode>[]
}

export const flowKeys = {
  all: ["flows"] as const,
  vocabulary: () => ["flows", "vocabulary"] as const,
  templates: (includeRetired: boolean) =>
    ["flows", "templates", { includeRetired }] as const,
  template: (id: string) => ["flows", "templates", id] as const,
  validation: (templateId: string | null, draft: string) =>
    ["flows", "validation", templateId, draft] as const,
}

const BASE = "/api/v1/flow-templates"

export function flowVocabulary(signal?: AbortSignal): Promise<FlowVocabulary> {
  return node.get<FlowVocabulary>(`${BASE}/catalogue`, { signal })
}

/// The catalogue changes only with a deploy.
export function useFlowVocabulary() {
  return useQuery({
    queryKey: flowKeys.vocabulary(),
    queryFn: ({ signal }) => flowVocabulary(signal),
    staleTime: Infinity,
  })
}

export function listFlowTemplates(
  includeRetired: boolean,
  signal?: AbortSignal
): Promise<FlowTemplateSummary[]> {
  const query = includeRetired ? "?include_retired=true" : ""
  return node.get<FlowTemplateSummary[]>(`${BASE}${query}`, { signal })
}

export function flowTemplateDetail(
  id: string,
  signal?: AbortSignal
): Promise<FlowTemplateDetail> {
  return node.get<FlowTemplateDetail>(`${BASE}/${encodeURIComponent(id)}`, {
    signal,
  })
}

/// Every problem in a draft. Writes nothing; the editor asks as it changes.
export function validateFlowTemplate(
  template: FlowTemplateDraft,
  templateId: string | null,
  signal?: AbortSignal
): Promise<{ valid: boolean; problems: TemplateProblem[] }> {
  return node.post<{ valid: boolean; problems: TemplateProblem[] }>(
    `${BASE}/validate`,
    { template, template_id: templateId },
    { signal }
  )
}

export function createFlowTemplate(
  template: FlowTemplateDraft,
  makeDefault: boolean
): Promise<FlowTemplateDetail> {
  return node.post<FlowTemplateDetail>(BASE, {
    template,
    make_default: makeDefault,
  })
}

/// Save the next version. `activate: false` keeps it aside; running flows
/// keep theirs either way.
export function saveFlowTemplateVersion(
  id: string,
  template: FlowTemplateDraft,
  activate: boolean
): Promise<FlowTemplateDetail> {
  return node.post<FlowTemplateDetail>(
    `${BASE}/${encodeURIComponent(id)}/versions`,
    { template, activate }
  )
}

export function updateFlowTemplate(
  id: string,
  patch: {
    name?: string
    is_default?: boolean
    status?: "ACTIVE" | "RETIRED"
    current_version?: number
  }
): Promise<FlowTemplateDetail> {
  return node.patch<FlowTemplateDetail>(
    `${BASE}/${encodeURIComponent(id)}`,
    patch
  )
}
