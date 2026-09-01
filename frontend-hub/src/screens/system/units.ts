/// The two formatters the System screens need beyond `lib/format`.
///
/// A plain module rather than part of `shared.tsx`: a file that exports both
/// components and functions breaks fast refresh, and these are wanted by the
/// query layer and the screens alike.

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/// A span of seconds as an operator says it: "7 d", "24 h", "15 min".
///
/// Coarse on purpose. These are offline leases and acknowledgement ages, and
/// the decision they drive — is this node stale, is this lease too long — never
/// turns on the seconds.
export function span(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—"
  const value = Math.max(0, Math.round(seconds))
  if (value >= DAY) return `${Math.round(value / DAY)} d`
  if (value >= HOUR) return `${Math.round(value / HOUR)} h`
  if (value >= MINUTE) return `${Math.round(value / MINUTE)} min`
  return `${value} s`
}

/// The server's sentence, or the honest admission that we never reached it.
/// Errors quote the server; they never invent a code.
export function saying(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The server could not be reached."
}
