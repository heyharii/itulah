/**
 * Deciding whether a session holds a capability.
 *
 * The vocabulary is the hub's own permission code — `module.action`, as
 * `SystemPermission.code` defines it (`finance.settle`, `inventory.adjust`).
 * A session carries the codes it holds in `AuthUser.permissions`.
 *
 * Kept free of React so the rule can be tested directly; `./use-can` is the
 * hook around it.
 *
 * ## The one decision in this file: an empty list means "unknown", not "none"
 *
 * `readUser()` in `lib/auth/service.ts` builds `permissions` with
 * `readStringArray(value.permissions)`, which answers `[]` for a payload that
 * has no `permissions` field at all. So an empty array has two meanings that
 * cannot be told apart here: "this user holds nothing" and "this backend did
 * not say".
 *
 * Treating that as "holds nothing" would black out the suite the first time a
 * hub build stopped sending the field — every screen empty, every action
 * hidden, and no error anywhere to explain it. So an empty list is read as
 * unknown and allows.
 *
 * That is the right trade because of what this layer is for. Per
 * `docs/tanstack-gap-plan.md` §Wave 3, the UI gate is a courtesy: its job is
 * to stop offering a button that would come back 403, not to be the boundary.
 * **Go remains the enforcement point**, and it does not consult this file. A
 * gate that fails open is a worse courtesy; a gate that fails closed on
 * missing data is a broken product.
 *
 * A session that *does* carry codes is matched strictly.
 */

/** What a session was granted, as far as the client can tell. */
export interface CapabilitySet {
  /** Permission codes held, from `AuthUser.permissions`. */
  codes: readonly string[]
  /** `AuthUser.role` — `superadmin` short-circuits every check. */
  role?: string
}

export type CapabilityVerdict =
  | { allowed: true; reason?: undefined }
  /** `reason` is copy a tooltip can show next to a disabled control. */
  | { allowed: false; reason: string }

const ALLOWED: CapabilityVerdict = { allowed: true }

/**
 * The platform's own escape hatch. `system.tsx` already treats `superadmin` as
 * the role that seeds and reshapes every other one, and the development proxy
 * sends `X-User-Role: superadmin`, so honouring it here keeps local work and
 * the platform's own definition in agreement.
 */
const ROOT_ROLE = "superadmin"

/**
 * True when `held` covers `wanted`.
 *
 * Three forms are honoured, in the order the hub's catalogue uses them:
 *
 * - `*` — everything.
 * - `inventory.*` — every action in a module. This is what a role editor
 *   produces when it grants a whole module heading rather than each row.
 * - `inventory.adjust` — the exact code.
 */
function covers(held: string, wanted: string): boolean {
  if (held === "*" || held === wanted) return true
  if (!held.endsWith(".*")) return false
  return wanted.startsWith(held.slice(0, -1))
}

/**
 * Decide one capability.
 *
 * `wanted` is a permission code. An unknown session (see the note above)
 * allows; a session with codes must actually hold a covering one.
 */
export function checkCapability(
  set: CapabilitySet | null | undefined,
  wanted: string
): CapabilityVerdict {
  if (!set) return ALLOWED // no session yet — the auth gate owns that state
  if (set.role === ROOT_ROLE) return ALLOWED
  if (set.codes.length === 0) return ALLOWED // unknown, not none

  if (set.codes.some((held) => covers(held, wanted))) return ALLOWED

  return {
    allowed: false,
    reason: `Your role does not include “${wanted}”.`,
  }
}

/** True when the session covers **every** code — an AND, for a compound action. */
export function checkEveryCapability(
  set: CapabilitySet | null | undefined,
  wanted: readonly string[]
): CapabilityVerdict {
  for (const code of wanted) {
    const verdict = checkCapability(set, code)
    if (!verdict.allowed) return verdict
  }
  return ALLOWED
}

/** True when the session covers **any** code — an OR, for a screen with several ways in. */
export function checkSomeCapability(
  set: CapabilitySet | null | undefined,
  wanted: readonly string[]
): CapabilityVerdict {
  if (wanted.length === 0) return ALLOWED

  let last: CapabilityVerdict = ALLOWED
  for (const code of wanted) {
    last = checkCapability(set, code)
    if (last.allowed) return ALLOWED
  }
  return last.allowed
    ? ALLOWED
    : {
        allowed: false,
        reason: `Your role includes none of: ${wanted.join(", ")}.`,
      }
}
