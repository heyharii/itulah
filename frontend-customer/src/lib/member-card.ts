/// What the barcode on the back of the card says.
///
/// `M1:` is "member identifier, payload version 1" — the same convention the
/// till already reads tags by (`R1:` for a retail identifier in
/// `frontend-store-new/src/lib/epc.ts`), so the counter's scan field can tell a
/// member card from a garment without guessing, and a future `M2:` is noticed
/// as new rather than misread.
export function memberCardPayload(memberId: string): string {
  return `M1:${memberId}`
}
