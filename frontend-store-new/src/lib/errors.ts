import { ApiError } from "@itulah/contract/client"

/// The node's own words when it managed to say any.
///
/// Every route answers a failure with `{"error": "…"}` written for a person —
/// an EPC this shop has never seen, a tender that does not cover the basket, a
/// price book that never arrived. That sentence is the operator's explanation
/// and it is repeated verbatim; inventing a code here would translate an answer
/// somebody could act on into one they cannot.
///
/// Anything that is not an `ApiError` never reached the node at all.
export function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "This node could not be reached."
}
