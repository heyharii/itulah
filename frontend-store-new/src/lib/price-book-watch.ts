import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { catalogueKey, offersQuery } from "@/lib/queries"

/// How often the shell asks the node which price book it holds. The answer is
/// a handful of rules from the next room, so a minute costs nothing.
const PRICE_BOOK_POLL_MS = 60_000

/// Keeps the prices on screen the node's, when head office publishes.
///
/// A new book reaches the node over sync within seconds, and the till prices
/// from it at once. This app's cache is five minutes long and nothing else
/// tells it a book has landed, so a catalogue left open all afternoon would go
/// on showing the morning's prices beside a till charging the new ones. The
/// offers carry the resident book's number; when it moves, the catalogue is
/// dropped and read again. The first answer only sets the mark — a sign-in is
/// not a new book.
export function usePriceBookWatch(): void {
  const client = useQueryClient()
  const offers = useQuery({
    ...offersQuery(),
    refetchInterval: PRICE_BOOK_POLL_MS,
  })
  const version = offers.data?.publication_version ?? null
  const seen = useRef<number | null>(null)

  useEffect(() => {
    if (version === null) return
    if (seen.current !== null && seen.current !== version) {
      void client.invalidateQueries({ queryKey: catalogueKey() })
    }
    seen.current = version
  }, [client, version])
}
