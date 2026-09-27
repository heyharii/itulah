import { useQuery } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type {
  AcceptInvitationRequest,
  CloudMe,
  InvitationList,
  InvitationPreview,
  InvitationRow,
  InvitePerson,
  IssuedInvitation,
  IssuedInvitationList,
  JobRole,
  JobRoleList,
  JobRolePatch,
} from "@itulah/contract"

/// Inviting somebody by link, the roles they can be invited into, and the
/// sections a role can see.
///
/// The wire shapes are generated (`@itulah/contract`, from `backend`'s 0633
/// and 0634 migrations); what lives here is the frontend's own vocabulary on
/// top of them — the section codes as the sidebar spells them, this app's
/// fallback description for a seeded role, and the functions that call the
/// endpoints. Re-exported so a screen imports one module for both.

export type {
  InvitationRow,
  InvitationPreview,
  InvitePerson,
  IssuedInvitation,
  JobRole,
}

// ── sections ─────────────────────────────────────────────────────────────

/// The sidebar's own department codes (`lib/navigation.ts`'s section map),
/// which is also the server's vocabulary for `JobRole.sections` — the same
/// strings, checked against this list rather than trusted as a bare
/// `string[]` so a typo on either end shows up as "not held" rather than as
/// a silent match.
export type SectionCode =
  | "finance"
  | "merchandise"
  | "procurement"
  | "operations"
  | "inventory"
  | "stores"
  | "sales"
  | "marketing"
  | "people"
  | "ga"
  | "system"
  | "reports"

export const SECTIONS: readonly SectionCode[] = [
  "finance",
  "merchandise",
  "procurement",
  "operations",
  "inventory",
  "stores",
  "sales",
  "marketing",
  "people",
  "ga",
  "system",
  "reports",
]

export const SECTION_LABEL: Readonly<Record<SectionCode, string>> = {
  finance: "Finance",
  merchandise: "Merchandise",
  procurement: "Procurement",
  operations: "Operations",
  inventory: "Inventory",
  stores: "Stores",
  sales: "Sales",
  marketing: "Marketing",
  people: "People",
  ga: "GA",
  system: "System",
  reports: "Reports",
}

/// `JobRole.sections` / `CloudMe.sections`, narrowed to the codes this app
/// recognises. A section the server lists that this build does not know yet
/// is dropped rather than crashing the checkbox grid — it simply cannot be
/// ticked here until this list catches up.
export function sectionsOf(value: readonly string[] | undefined): SectionCode[] {
  if (!Array.isArray(value)) return []
  return value.filter((one): one is SectionCode =>
    (SECTIONS as readonly string[]).includes(one)
  )
}

// ── roles ────────────────────────────────────────────────────────────────

/// The job-role codes the server is seeded with today.
///
/// A role the server adds later still works everywhere below — every list
/// reads `code` and `name` off the wire — this type is only for the fallback
/// one-line description this app writes for a seeded code whose own
/// `description` is blank.
export type SeededRoleCode =
  | "OWNER"
  | "ADMIN"
  | "FINANCE"
  | "MERCHANDISE"
  | "PROCUREMENT"
  | "OPERATIONS"
  | "INVENTORY"
  | "STORE_MANAGER"
  | "STORE_SUPERVISOR"
  | "CASHIER"
  | "STORE_STAFF"
  | "MARKETING"
  | "HR"
  | "GA"
  | "AUDITOR"
  | "IT"

export const ROLE_HINT: Readonly<Record<SeededRoleCode, string>> = {
  OWNER: "Full control of every screen and every store.",
  ADMIN: "Runs the centre day to day, just short of ownership.",
  FINANCE: "Books, banks, and what the company owes and is owed.",
  MERCHANDISE: "What is bought, allotted and priced for the stores.",
  PROCUREMENT: "Purchase orders and supplier terms.",
  OPERATIONS: "The warehouse: receiving, putaway and sending stock out.",
  INVENTORY: "Stock counts and adjustments across every site.",
  STORE_MANAGER: "Runs one store — its till, its floor, its people.",
  STORE_SUPERVISOR: "Backs up the store manager on the floor.",
  CASHIER: "Rings up sales at the till.",
  STORE_STAFF: "Floor work at one store.",
  MARKETING: "Promotions and how the stores are marketed.",
  HR: "Hiring, attendance, leave and pay.",
  GA: "Assets, contracts, and the offices and warehouses themselves.",
  AUDITOR: "Reads every book. Cannot change anything.",
  IT: "Devices, store servers, and who may sign in.",
}

export const roleKeys = {
  all: ["roles"] as const,
  list: () => ["roles", "list"] as const,
}

export async function listRoles(signal?: AbortSignal): Promise<JobRole[]> {
  const answer = await node.get<JobRoleList>("/api/v1/roles", { signal })
  return answer.items
}

export function useRoles() {
  return useQuery({
    queryKey: roleKeys.list(),
    queryFn: ({ signal }) => listRoles(signal),
    // Sixteen-odd rows that change when an admin edits one — not worth
    // re-asking every time a screen that reads role names remounts.
    staleTime: 60_000,
  })
}

export function updateRole(
  code: string,
  patch: JobRolePatch
): Promise<JobRole> {
  return node.put<JobRole>(`/api/v1/roles/${encodeURIComponent(code)}`, patch)
}

/// Only a role nobody holds and nobody seeded — the server refuses
/// otherwise (409), naming which of the two it is.
export async function deleteRole(code: string): Promise<void> {
  await node.delete(`/api/v1/roles/${encodeURIComponent(code)}`)
}

/// A role's one-line description: the server's own when it wrote one, else
/// this app's fallback for the codes it was seeded with — never invented for
/// a role that answers neither, since a made-up sentence about somebody's
/// permissions is worse than none.
export function roleHint(role: {
  readonly code: string
  readonly description: string
}): string | null {
  if (role.description.trim() !== "") return role.description
  return (ROLE_HINT as Readonly<Record<string, string>>)[role.code] ?? null
}

// ── invitations (admin) ──────────────────────────────────────────────────

export type InvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED"

export function createInvitations(
  people: readonly InvitePerson[]
): Promise<IssuedInvitationList> {
  return node.post<IssuedInvitationList>("/api/v1/invitations", { people })
}

export const invitationKeys = {
  all: ["invitations"] as const,
  list: (status?: InvitationStatus, unitId?: string) =>
    ["invitations", "list", status ?? "ALL", unitId ?? "ALL"] as const,
}

export function listInvitations(
  scope: { status?: InvitationStatus; unitId?: string },
  signal?: AbortSignal
): Promise<InvitationRow[]> {
  const params = new URLSearchParams()
  if (scope.status) params.set("status", scope.status)
  if (scope.unitId) params.set("unit_id", scope.unitId)
  const qs = params.toString()
  return node
    .get<InvitationList>(`/api/v1/invitations${qs ? `?${qs}` : ""}`, {
      signal,
    })
    .then((answer) => answer.items)
}

export function useInvitations(status?: InvitationStatus, unitId?: string) {
  return useQuery({
    queryKey: invitationKeys.list(status, unitId),
    queryFn: ({ signal }) => listInvitations({ status, unitId }, signal),
  })
}

export function revokeInvitation(id: string): Promise<InvitationRow> {
  return node.post<InvitationRow>(
    `/api/v1/invitations/${encodeURIComponent(id)}/revoke`,
    {}
  )
}

export function renewInvitation(id: string): Promise<IssuedInvitation> {
  return node.post<IssuedInvitation>(
    `/api/v1/invitations/${encodeURIComponent(id)}/renew`,
    {}
  )
}

// ── accepting an invitation (public, no session) ────────────────────────

/// An ordinary GET — no bearer, no cookie the server would recognise, and
/// none of that is a problem: this route answers anybody holding the token,
/// by design, the way the link itself does. An unknown token is a 404, a
/// used/expired/withdrawn one a 409, and too many unknown tokens from one
/// place a 429 — all three are shown as the server wrote them, never
/// replaced with a code of this app's own.
export function previewInvitation(
  token: string,
  signal?: AbortSignal
): Promise<InvitationPreview> {
  return node.get<InvitationPreview>(
    `/api/v1/invitations/accept/${encodeURIComponent(token)}`,
    { signal }
  )
}

/// Sets the person's username and password, and signs them in — an ordinary
/// `POST`, exactly like `Auth.login`, and for the same reason: there is no
/// session yet for a CSRF token to belong to, so this travels the same way
/// the login request does. The answer is `CloudMe`, with the session's
/// cookies attached, exactly as `/auth/login` answers.
export function acceptInvitation(
  token: string,
  body: AcceptInvitationRequest
): Promise<CloudMe> {
  return node.post<CloudMe>(
    `/api/v1/invitations/accept/${encodeURIComponent(token)}`,
    body
  )
}
