import { createElement, type FunctionComponent, type ReactNode } from "react"

import { EssGate } from "@/screens/me/ess-gate"

/// Which module of the employee app each screen belongs to (0813). A path
/// with no module — the profile, one's details — is always shown.
export function moduleOf(path: string): string | null {
  if (path.startsWith("/me/attendance/correction")) return "CORRECTION"
  if (path.startsWith("/me/attendance/swap")) return "SWAP"
  if (path.startsWith("/me/attendance")) return "ATTENDANCE"
  if (path.startsWith("/me/leave")) return "LEAVE"
  if (path.startsWith("/me/overtime")) return "OVERTIME"
  if (path.startsWith("/me/pay/claims")) return "CLAIMS"
  if (path.startsWith("/me/pay")) return "PAY"
  return null
}

/// The screen at `path`, behind its module's gate.
export function gated(Screen: () => ReactNode, path: string): () => ReactNode {
  const module = moduleOf(path)
  if (module === null) return Screen
  const Gated = () =>
    createElement(EssGate, {
      module,
      children: createElement(Screen as FunctionComponent),
    })
  Gated.displayName = `Gated(${module})`
  return Gated
}
