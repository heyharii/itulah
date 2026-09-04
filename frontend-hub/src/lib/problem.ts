import { ApiError } from "@itulah/contract/client"

/// The server's sentence, or nothing.
///
/// A write fails for reasons a person acts on — a carton already sealed, a
/// count the same person may not verify, a period already closed. All of those
/// come back as `ApiError.message`, written for an operator, and the only
/// wrong thing to do with them is to replace them with a code of our own.
///
/// In its own module rather than beside `<Problem>`: a file that exports both
/// components and plain functions loses fast refresh, and this one is wanted
/// by mutation handlers as well as by the banner that draws it.
export function problemOf(error: unknown): string | null {
  if (error === null || error === undefined) return null
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "The server could not be reached."
}
