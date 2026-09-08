/// Role + dimensions + date → one account, or a refusal that says which fault.
///
/// # Why it refuses on two as loudly as on none
///
/// A resolver that picked the first of two matching bindings would be a
/// resolver whose answer depends on insertion order. The client has two BCA
/// savings accounts at C006 in the fixtures — one current, one closed and
/// still mapped — and the difference between "refused, two bindings match" and
/// "posted to the closed one" is a month of somebody's life at the year end.
///
/// # Why the date is an argument
///
/// Because a reversal must not re-resolve. `poster.reverse` in the production
/// backend copies the ORIGINAL lines' codes for exactly this reason, and the
/// same rule holds here: `reverseEntry` never calls this function. The date
/// argument is for FORWARD posting into a period whose bindings have since
/// been corrected — a February invoice keyed in April resolves with February's
/// map, not April's.

import { account } from "./chart"
import type { Account, Binding, Day, Dimensions, Resolution, AccountRole } from "./types"

/// Does this binding's narrowing hold for this request?
///
/// Every dimension the binding NAMES must equal the request's. A dimension the
/// binding is silent about is a dimension it does not care about — that is what
/// makes a unit-wide default expressible without a wildcard token.
function narrowsMatch(binding: Binding, dims: Dimensions): boolean {
  const n = binding.narrows
  if (n.unit_id !== dims.unit_id) return false
  const keys: (keyof Omit<Dimensions, "unit_id">)[] = [
    "bank_account_id",
    "asset_class",
    "counterparty_unit_id",
    "acquirer",
    "expense_kind",
  ]
  for (const k of keys) {
    const want = n[k]
    if (want === undefined) continue
    if (dims[k] !== want) return false
  }
  return true
}

function liveOn(binding: Binding, on: Day): boolean {
  if (binding.valid_from > on) return false
  if (binding.valid_to && binding.valid_to < on) return false
  return true
}

/// How specific a binding is. Used only to REPORT a tie, never to break one.
///
/// Reporting it matters: "two bindings match and both name the same three
/// dimensions" and "two match, one is the unit default" are different mistakes,
/// and the message says which.
function specificity(binding: Binding): number {
  return Object.keys(binding.narrows).length
}

export interface ResolveRequest {
  readonly role: AccountRole
  readonly dims: Dimensions
  readonly on: Day
}

export function resolve(
  bindings: readonly Binding[],
  req: ResolveRequest
): Resolution {
  const candidates = bindings.filter(
    (b) => b.role === req.role && narrowsMatch(b, req.dims) && liveOn(b, req.on)
  )

  if (candidates.length === 0) {
    const anyRole = bindings.some((b) => b.role === req.role)
    return {
      ok: false,
      reason: "MISSING",
      message: anyRole
        ? `No account is mapped for ${req.role} at ${req.dims.unit_id}${describe(req.dims)} on ${req.on}. ` +
          `The role is mapped elsewhere, so this is a gap in the narrowing, not a missing role.`
        : `${req.role} has no binding anywhere. Nothing can post until the Account map answers it.`,
    }
  }

  if (candidates.length > 1) {
    return {
      ok: false,
      reason: "AMBIGUOUS",
      message:
        `${candidates.length} bindings match ${req.role} at ${req.dims.unit_id}${describe(req.dims)} on ${req.on}: ` +
        candidates.map((c) => `${c.binding_id} → ${c.account_code}`).join(", ") +
        `. A resolver never picks; retire one or narrow it${
          candidates.every((c) => specificity(c) === specificity(candidates[0]))
            ? " — both name the same dimensions, so one of them is stale"
            : ""
        }.`,
      candidates,
    }
  }

  const binding = candidates[0]
  const acct: Account | undefined = account(binding.account_code)
  if (!acct) {
    return {
      ok: false,
      reason: "MISSING",
      message: `${binding.binding_id} points at ${binding.account_code}, which is not in the chart.`,
    }
  }
  if (!acct.postable) {
    return {
      ok: false,
      reason: "NOT_POSTABLE",
      message: `${acct.code} ${acct.name} is a heading or is inactive in the client's own chart.`,
    }
  }
  if (acct.blocked_units?.includes(req.dims.unit_id)) {
    return {
      ok: false,
      reason: "BLOCKED",
      message:
        `${acct.code} ${acct.name} is listed in the chart for ${req.dims.unit_id} but that unit may not post to it. ` +
        `Confirmed: shops do not carry merchandise supplier payable — they owe head office for goods.`,
    }
  }
  return { ok: true, account: acct, binding }
}

function describe(dims: Dimensions): string {
  const bits: string[] = []
  if (dims.bank_account_id) bits.push(`bank ${dims.bank_account_id}`)
  if (dims.asset_class) bits.push(`class ${dims.asset_class}`)
  if (dims.counterparty_unit_id) bits.push(`vs ${dims.counterparty_unit_id}`)
  if (dims.acquirer) bits.push(`acquirer ${dims.acquirer}`)
  if (dims.expense_kind) bits.push(`expense ${dims.expense_kind}`)
  return bits.length ? ` (${bits.join(", ")})` : ""
}
