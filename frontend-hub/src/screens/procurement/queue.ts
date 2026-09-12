import { useQuery } from "@tanstack/react-query"

import {
  procurementKeys,
  unidentifiedReceipts,
} from "@/lib/queries/procurement"

/// The deliveries waiting to be told what they are.
///
/// Its own module because two things read it — the trigger on the order book,
/// which wears its length, and the queue sheet that trigger opens — and the
/// key is the same for both, so the badge and the list cannot disagree and
/// opening the queue fetches nothing.
///
/// It lived in the Articles module until 2026-09-12, on the argument that what
/// a setup PRODUCES is a master product. It moved here with the sheets that
/// read it: what a setup starts from is a delivery, and a delivery is a
/// purchase — which is also where its endpoint always was.
export function useAwaitingIdentity() {
  return useQuery({
    queryKey: procurementKeys.unidentified(),
    queryFn: ({ signal }) => unidentifiedReceipts(signal),
  })
}
