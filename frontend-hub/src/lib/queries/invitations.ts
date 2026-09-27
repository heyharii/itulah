import { useQuery } from "@tanstack/react-query"

import { node } from "@/lib/api"
import type { Identity } from "@itulah/contract/client"

/// Inviting somebody by link, the roles they can be invited into, and the
/// sections a role can see.
///
/// The backend for this is being built alongside this file, so nothing here
/// is generated — every shape is written by hand, against the API as it was
/// specified, and kept in this one module rather than scattered per screen.
/// When the server's own contract catches up (`@itulah/contract`), these can
/// be traded for the generated types; nothing that reads them here should
/// have to change, since the fields are named the same.

// ── sections ─────────────────────────────────────────────────────────────

/// The sidebar's own department codes (`lib/navigation.ts`'s section map),
/// and now the server's too: a role carries the sections its holder may see.
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

function sectionsOf(value: unknown): SectionCode[] {
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

export interface RoleItem {
  readonly code: string
  readonly name: string
  /// Where the role stands on the ladder — a small integer, not shown as
  /// anything but the number itself: this app does not know the server's
  /// ordering well enough to name the rungs.
  readonly rung: number
  readonly sections: readonly SectionCode[]
  readonly description: string | null
  /// Seeded by the server rather than raised by an admin. A builtin role can
  /// be edited but not deleted — there is no delete route for any role today.
  readonly builtin: boolean
}

function roleItemOf(raw: unknown): RoleItem {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    code: String(r.code ?? ""),
    name: String(r.name ?? r.code ?? ""),
    rung: typeof r.rung === "number" ? r.rung : 0,
    sections: sectionsOf(r.sections),
    description: typeof r.description === "string" ? r.description : null,
    builtin: r.builtin === true,
  }
}

export interface UpdateRoleRequest {
  name?: string
  rung?: number
  sections?: readonly SectionCode[]
  description?: string
}

export const roleKeys = {
  all: ["roles"] as const,
  list: () => ["roles", "list"] as const,
}

export async function listRoles(signal?: AbortSignal): Promise<RoleItem[]> {
  const answer = await node.get<{ items: unknown[] }>("/api/v1/roles", {
    signal,
  })
  return (answer.items ?? []).map(roleItemOf)
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

export async function updateRole(
  code: string,
  patch: UpdateRoleRequest
): Promise<RoleItem> {
  const answer = await node.put<unknown>(
    `/api/v1/roles/${encodeURIComponent(code)}`,
    patch
  )
  return roleItemOf(answer)
}

/// A role's one-line description: the server's own when it wrote one, else
/// this app's fallback for the codes it was seeded with — never invented for
/// a role that answers neither, since a made-up sentence about somebody's
/// permissions is worse than none.
export function roleHint(role: {
  readonly code: string
  readonly description: string | null
}): string | null {
  if (role.description !== null && role.description.trim() !== "") {
    return role.description
  }
  return (ROLE_HINT as Readonly<Record<string, string>>)[role.code] ?? null
}

// ── invitations (admin) ──────────────────────────────────────────────────

export type InvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED"

export interface InvitationDraft {
  readonly name: string
  readonly role_code: string
  readonly unit_id: string
  readonly position?: string
}

export interface IssuedInvitation {
  readonly invitation_id: string
  readonly employee_id: string
  readonly name: string
  readonly role_code: string
  readonly unit_id: string
  /// Shown once, by this response alone — nothing later reads it back. See
  /// `screens/people/invite-sheet.tsx`.
  readonly link: string
  readonly expires_at: string
}

export interface CreateInvitationsResponse {
  readonly items: readonly IssuedInvitation[]
}

export function createInvitations(
  people: readonly InvitationDraft[]
): Promise<CreateInvitationsResponse> {
  return node.post<CreateInvitationsResponse>("/api/v1/invitations", {
    people,
  })
}

export interface InvitationRow {
  readonly invitation_id: string
  readonly name: string
  readonly role_code: string
  readonly unit_id: string
  readonly status: InvitationStatus
  readonly created_by: string
  readonly created_at: string
  readonly expires_at: string
  readonly accepted_at: string | null
  readonly username: string | null
}

export const invitationKeys = {
  all: ["invitations"] as const,
  list: (status?: InvitationStatus) =>
    ["invitations", "list", status ?? "ALL"] as const,
}

export function listInvitations(
  status?: InvitationStatus,
  signal?: AbortSignal
): Promise<InvitationRow[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : ""
  return node
    .get<{ items: InvitationRow[] }>(`/api/v1/invitations${qs}`, { signal })
    .then((answer) => answer.items)
}

export function useInvitations(status?: InvitationStatus) {
  return useQuery({
    queryKey: invitationKeys.list(status),
    queryFn: ({ signal }) => listInvitations(status, signal),
  })
}

export async function revokeInvitation(id: string): Promise<void> {
  await node.post(`/api/v1/invitations/${encodeURIComponent(id)}/revoke`, {})
}

export interface RenewedInvitation {
  readonly link: string
  readonly expires_at: string
}

export function renewInvitation(id: string): Promise<RenewedInvitation> {
  return node.post<RenewedInvitation>(
    `/api/v1/invitations/${encodeURIComponent(id)}/renew`,
    {}
  )
}

// ── accepting an invitation (public, no session) ────────────────────────

export interface InvitationPreview {
  readonly name: string
  readonly role_name: string
  readonly unit_name: string
  readonly company_name: string
  readonly suggested_username: string
  readonly expires_at: string
}

/// An ordinary GET — no bearer, no cookie the server would recognise, and
/// none of that is a problem: this route answers anybody holding the token,
/// by design, the way the link itself does.
export function previewInvitation(
  token: string,
  signal?: AbortSignal
): Promise<InvitationPreview> {
  return node.get<InvitationPreview>(
    `/api/v1/invitations/accept/${encodeURIComponent(token)}`,
    { signal }
  )
}

/// The fields `/auth/me` answers beyond the rung `Identity` already carries —
/// see `lib/session.tsx`. Optional here because this file is written ahead of
/// the server change that adds them: a caller still signed in against an
/// older node reads `null`/`[]` rather than crashing.
export interface JobFields {
  readonly role_code: string
  readonly role_name: string
  readonly sections: readonly SectionCode[]
}

export type MeAnswer = Identity & Partial<JobFields>

/// Sets the person's username and password, and signs them in — an ordinary
/// `POST`, exactly like `Auth.login`, and for the same reason: there is no
/// session yet for a CSRF token to belong to, so this travels the same way
/// the login request does.
export function acceptInvitation(
  token: string,
  body: { username: string; password: string }
): Promise<MeAnswer> {
  return node.post<MeAnswer>(
    `/api/v1/invitations/accept/${encodeURIComponent(token)}`,
    body
  )
}
