/// The employee benefit balance, a tender the shop's node cannot settle alone.
///
/// An employee's rupiah balance is kept at head office. On their phone they show
/// a 6-digit code (also as a QR a keyboard-wedge scanner types as those six
/// digits). The till spends part of the basket from that balance and the rest is
/// paid as usual. Like a voucher it **needs the connection**: the shop node
/// relays to head office, and when the line is down it answers 502 rather than
/// inventing a balance. It combines with a promotion (owner, 29 Oct 2026); a
/// return gives the spent part back.
///
/// The three verbs are one conversation about one basket. `lookup` reads the
/// balance without using the code up; `spend` uses the code up, once per
/// `sale_ref`; `return` gives money back against that same `sale_ref` — both
/// when the basket is abandoned before it becomes a sale and when a returned
/// sale is refunded to the balance. The sale then carries a `BENEFIT` tender
/// whose `reference` is the `sale_ref`.
///
/// **A finger instead of the code** (client, 24 Oct 2026: "jari karyawan"). The
/// employee lays a finger on the till's scanner; it is matched here against the
/// node's roster, exactly as a supervisor's is, and the node — not this window —
/// decides what the match is worth: one grant for that person's balance
/// (`POST /api/v1/auth/fingerprints/benefit`, signed with the till's pairing
/// secret). The grant then rides on `lookup` and `spend` where the code would
/// have; the node reads the person off its own grant and never takes a name from
/// here. A node from before fingers answers that route 401/404, and the code
/// stays as the way in.

import { roster } from "@/api"
import { edge, identifyFinger, signedEdge, type EdgeReply, type FingerWait } from "@/edge"

/// Whose balance this is, and what is left on it.
export type BenefitHolder = {
  readonly employee_id: string
  readonly employee_code: string
  readonly full_name: string | null
  readonly balance_minor: number
}

const base = "/api/v1/store/benefit"

/// What opens a balance: the six digits from the employee's phone, or the grant
/// their finger earned at the node.
export type BenefitKey = { readonly code: string } | { readonly finger: string }

const keyOf = (key: BenefitKey) =>
  "finger" in key ? { finger: key.finger } : { code: key.code.trim() }

/// Read the holder and balance behind a code. Does not use the code up.
export function lookupBenefit(code: string): Promise<EdgeReply<BenefitHolder>> {
  return edge<BenefitHolder>("POST", `${base}/lookup`, { code: code.trim() })
}

/// Spend `amountMinor` from the balance for the sale named `saleRef`.
///
/// One spend per `saleRef` (a second is 409), and the node refuses more than the
/// balance and a cashier spending their own balance.
/// A finger's grant is spent with it — one finger pays one basket — and given
/// back by the node when head office does not take the spend.
export function spendBenefit(
  key: BenefitKey,
  saleRef: string,
  amountMinor: number,
  basketHasPromotion: boolean,
): Promise<EdgeReply<BenefitHolder>> {
  return edge<BenefitHolder>("POST", `${base}/spend`, {
    ...keyOf(key),
    sale_ref: saleRef,
    amount_minor: amountMinor,
    basket_has_promotion: basketHasPromotion,
  })
}

/// What the node grants for an employee's finger.
type FingerGrant = {
  readonly username: string
  readonly display_name: string
  readonly authorization: string
  readonly expires_at: string
}

/// How a finger on the scanner ended.
export type BenefitByFinger =
  /// Matched, granted, and the balance read: spend it with `grant`.
  | {
      readonly kind: "found"
      readonly grant: string
      readonly username: string
      readonly holder: BenefitHolder
    }
  /// Nobody pressed before the wait ran out.
  | { readonly kind: "none" }
  /// A finger, but nobody enrolled at this shop.
  | { readonly kind: "unknown" }
  /// The signed-in cashier's own finger: a colleague rings it up.
  | { readonly kind: "own" }
  /// This till cannot do it by finger — the web till, a terminal not paired, no
  /// scanner, or a node from before fingers. The code is the way in.
  | { readonly kind: "no-finger"; readonly problem: string }
  /// The node or head office would not open the balance.
  | { readonly kind: "refused"; readonly reply: EdgeReply<unknown> }

/// Open an employee's balance by their finger.
///
/// `person` stands in for the scanner on a rig with no scanner
/// (`VITE_SIM_FINGERS`): that person's enrolled finger is the one claimed, and
/// the claim, the grant and the balance are the node's real answers.
/// `actorId` is the signed-in cashier.
export async function benefitByFinger(
  actorId: string,
  wait: FingerWait & { readonly onPlaced?: () => void; readonly person?: string } = {},
): Promise<BenefitByFinger> {
  const book = await roster()
  if (!book.ok) {
    return { kind: "no-finger", problem: book.problem ?? "Daftar sidik jari toko tidak terbaca." }
  }
  const fingers = book.body?.items ?? []
  let fingerId: string | null = null
  let score: number | null = null
  if (wait.person !== undefined) {
    fingerId = fingers.find((one) => one.username === wait.person)?.finger_id ?? null
  } else {
    const seen = await identifyFinger(
      fingers.map((one) => ({
        actor_id: one.finger_id,
        username: one.username,
        template_base64: one.template_base64,
      })),
      wait,
    )
    if (!seen.bound) return { kind: "no-finger", problem: seen.detail }
    if (!seen.placed) return { kind: "none" }
    wait.onPlaced?.()
    fingerId = fingers.some((one) => one.finger_id === seen.actor_id) ? seen.actor_id : null
    score = seen.score
  }

  // A miss is claimed too: the node writes it down, as it does a sign-in's.
  const claimed = await signedEdge<FingerGrant>("POST", "/api/v1/auth/fingerprints/benefit", {
    finger_id: fingerId,
    score,
  })
  if (fingerId === null) return { kind: "unknown" }
  if (!claimed.ok || claimed.body === undefined || claimed.body === null) {
    // 404 / 405: no such route. 401 "missing session": a node from before
    // fingers, whose door does not know the path is the terminal's to sign.
    const old =
      claimed.status === 404 ||
      claimed.status === 405 ||
      (claimed.status === 401 && (claimed.problem ?? "").toLowerCase().includes("missing session"))
    if (old || claimed.status === 0) {
      return {
        kind: "no-finger",
        problem: old ? "Node toko belum bisa membuka saldo dengan jari." : (claimed.problem ?? ""),
      }
    }
    if (claimed.status === 401 && /not enrolled|not active/.test(claimed.problem ?? "")) {
      return { kind: "unknown" }
    }
    return { kind: "refused", reply: claimed }
  }
  const grant = claimed.body.authorization
  if (claimed.body.username === actorId) return { kind: "own" }

  const looked = await edge<BenefitHolder>("POST", `${base}/lookup`, { finger: grant })
  if (!looked.ok || looked.body === undefined || looked.body === null) {
    return looked.status === 403 && (looked.problem ?? "").includes("own benefit")
      ? { kind: "own" }
      : { kind: "refused", reply: looked }
  }
  return { kind: "found", grant, username: claimed.body.username, holder: looked.body }
}

/// Give back at most what `saleRef` spent. Answers the new balance.
export function returnBenefit(
  saleRef: string,
  amountMinor: number,
  reason: string,
): Promise<EdgeReply<number>> {
  return edge<number>("POST", `${base}/return`, {
    sale_ref: saleRef,
    amount_minor: amountMinor,
    reason,
  })
}

/// Head office's and the node's refusals, in the counter's words. Anything not
/// known here is passed through as said.
export function benefitSaid(problem: string | null): string | null {
  if (problem === null) return null
  const said = problem.toLowerCase()
  if (said.includes("not turned on")) return "Diskon karyawan belum diaktifkan HR."
  if (said.includes("does not combine with a promotion")) {
    return "Diskon karyawan tidak bisa dipakai bersama promo."
  }
  if (said.includes("own benefit")) return "Saldo diskon sendiri dilayani kasir lain"
  if (said.includes("may sign in at")) return "Karyawan ini tidak terdaftar di toko ini · ketik kode dari HP karyawan"
  if (said.includes("not an employee")) return "Akun ini bukan akun karyawan, tidak punya saldo."
  if (said.includes("not working here now")) return "Karyawan ini sudah tidak aktif."
  if (said.includes("is left on this balance")) return "Saldo tidak cukup untuk jumlah ini."
  if (said.includes("has already spent a benefit")) return "Transaksi ini sudah memakai saldo karyawan."
  if (said.includes("code is not good")) return "Kode salah, sudah dipakai, atau kedaluwarsa · minta kode baru."
  return problem
}
