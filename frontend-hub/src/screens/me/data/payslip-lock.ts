import { useSyncExternalStore } from "react"

import { ApiError } from "@itulah/contract/client"

/// The payslip password, held for this tab only.
///
/// In memory and nowhere else: not in the URL, not in storage, not in a query
/// key. The lock is against a phone left open on a shop counter, so it lasts
/// as long as the page does — a reload asks again, which is the point.
let password: string | null = null
let generation = 0
const listeners = new Set<() => void>()

function changed() {
  generation += 1
  for (const listener of listeners) listener()
}

export function payslipPassword(): string | null {
  return password
}

export function unlockPayslips(next: string): void {
  password = next
  changed()
}

export function lockPayslips(): void {
  password = null
  changed()
}

/// Bumps every time the password changes, so the payslip queries ask again —
/// the number goes in the query key, the password never does.
export function usePayslipGeneration(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => generation,
    // The server holds no password: its render is the locked one.
    () => 0
  )
}

/// Which of the server's two refusals this is, told apart by their first
/// words: none set yet, or one needed.
export type LockState = "unset" | "required"

export function lockState(error: unknown): LockState | null {
  if (!(error instanceof ApiError) || error.status !== 403) return null
  // The server's text arrives behind its status word ("forbidden: …"), so
  // the refusal is found inside the message rather than at its start.
  if (error.message.includes("payslip password not set")) return "unset"
  if (error.message.includes("payslip password required")) return "required"
  return null
}
