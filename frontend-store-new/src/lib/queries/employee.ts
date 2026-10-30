import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"

import { CENTRAL_KEY_PREFIX } from "@/lib/cloud"
import {
  employeeDetail,
  hrKeys,
  leaveRequestsOf,
  proposeHire,
  type StoreScope,
} from "@/lib/queries/hr"
import {
  fileDataUpdate,
  papersKeys,
  saveHireDossier,
  uploadPapers,
} from "@/lib/queries/papers"
import type {
  EmployeeDetails,
  HireProposalView,
  PersonalChanges,
  SaveHireDossierBody,
} from "@itulah/contract"

/// What one person's page asks head office, and the two things a shop files
/// about a person: a **new employee** (a hire proposal with the papers keyed
/// in) and a **change to the file** (a data update).
///
/// Neither writes the record. Head office decides both; the shop's own screens
/// only show that the filing is waiting.

export function employeeQuery(employeeId: string) {
  return queryOptions({
    queryKey: hrKeys.employee(employeeId),
    queryFn: ({ signal }) => employeeDetail(employeeId, signal),
  })
}

export function leaveRequestsQuery(employeeId: string) {
  return queryOptions({
    queryKey: [
      CENTRAL_KEY_PREFIX,
      "hr",
      "employee",
      employeeId,
      "leave-requests",
    ] as const,
    queryFn: ({ signal }) => leaveRequestsOf(employeeId, signal),
  })
}

// ── a new employee ──────────────────────────────────────────────────────────

/// What the proposal carries, and what the dossier carries.
export interface NewEmployee {
  /// `POST /api/v1/hire-proposals` — the name, the post, the start, the
  /// contract, what the shop thinks the post is worth, and why.
  readonly terms: Parameters<typeof proposeHire>[0]
  /// `PUT /api/v1/hire-proposals/{id}/dossier` — the person's data.
  readonly dossier: Omit<SaveHireDossierBody, "documents" | "reason">
  /// Scans, each sent up first (`POST /api/v1/files`) and then named in the
  /// dossier.
  readonly scans: readonly { kind: string; file: File }[]
  readonly reason: string
}

/// File a new employee with head office: the proposal first, then the
/// dossier on it.
///
/// `existing` is the proposal an earlier try already filed. A try that failed
/// on the papers must not file a second proposal for the same person, so the
/// caller keeps the id (`onFiled`) and sends it back to finish the papers.
export async function sendNewEmployee(
  input: NewEmployee & {
    existing: string | null
    onFiled: (proposalId: string) => void
  },
): Promise<HireProposalView | null> {
  let proposal: HireProposalView | null = null
  let id = input.existing
  if (id === null) {
    proposal = await proposeHire(input.terms)
    id = proposal.id
    input.onFiled(id)
  }
  await saveHireDossier(id, {
    ...input.dossier,
    documents: await uploadPapers(input.scans),
    reason: input.reason,
  })
  return proposal
}

export function useSendNewEmployee(scope: StoreScope) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: sendNewEmployee,
    // Whether it finished or stopped half way, the proposal may exist.
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: hrKeys.hires(scope.unit_id) })
      await client.invalidateQueries({ queryKey: papersKeys.all() })
    },
  })
}

// ── a change to the file ────────────────────────────────────────────────────

export function useChangeData(employeeId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      personal: PersonalChanges
      details: EmployeeDetails | null
      scans: readonly { kind: string; file: File }[]
      reason: string
    }) =>
      fileDataUpdate(employeeId, {
        personal: input.personal,
        details: input.details,
        documents: await uploadPapers(input.scans),
        reason: input.reason,
      }),
    onSettled: () => client.invalidateQueries({ queryKey: papersKeys.all() }),
  })
}
