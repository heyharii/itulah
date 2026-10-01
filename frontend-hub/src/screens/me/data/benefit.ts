/// Seconds until an ISO moment, never below zero.
export function secondsLeft(expiresAt: string): number {
  const at = new Date(expiresAt).getTime()
  return Number.isNaN(at) ? 0 : Math.max(0, Math.ceil((at - Date.now()) / 1000))
}

/// `123456` → `123 456`, so it reads aloud in two breaths.
export function codeGroups(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code
}
