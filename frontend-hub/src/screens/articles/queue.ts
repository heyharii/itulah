import { useQuery } from "@tanstack/react-query"

import {
  procurementKeys,
  unidentifiedReceipts,
} from "@/lib/queries/procurement"

/// The deliveries waiting to be told what they are.
///
/// Its own module because two things read it — the trigger on `/articles`,
/// which wears its length, and the queue sheet that trigger opens — and the
/// key is the same for both, so the badge and the list cannot disagree and
/// opening the queue fetches nothing.
///
/// It reads purchasing's endpoint from an Articles file on purpose: a setup
/// starts from a delivery, which is a purchase, but what it produces is a
/// master product. Where something lives and where its data comes from are
/// different questions.
export function useAwaitingIdentity() {
  return useQuery({
    queryKey: procurementKeys.unidentified(),
    queryFn: ({ signal }) => unidentifiedReceipts(signal),
  })
}
