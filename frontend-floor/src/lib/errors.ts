import { ApiError } from "@itulah/contract/client"

/// The node's own words when it managed to say any.
///
/// Every route answers a failure with `{"error": "…"}` written for a person — a
/// delivery somebody already closed, a verification by the person who counted, a
/// SKU this building has never held. That sentence is the operator's explanation
/// and it is repeated verbatim; inventing a code here would translate an answer
/// somebody could act on into one they cannot.
///
/// **The exception is a failure the node did not write.** A 502 from the proxy in
/// front of it, a connection that never landed, a gateway timeout: those carry
/// `statusText` — "Bad Gateway" — which is English, is about plumbing, and is
/// exactly the case a person on a floor meets most often. That one gets said in
/// their language, because the useful part is not the status line but "it is the
/// link, not you, and your work is safe".
export function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0 || error.status >= 500) {
      return "Node gudang tidak menjawab. Pekerjaan Anda tetap tersimpan di HP ini."
    }
    return error.message
  }
  if (error instanceof Error) return error.message
  return "Node gudang ini tidak bisa dihubungi."
}
