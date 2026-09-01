import type { QueryClient } from "@tanstack/react-query"

import { dc } from "@/lib/api"
import { keys } from "@/lib/queries/keys"
import type { SheetKey } from "@/lib/sheets"

/// What ⌘K can find, besides screens.
///
/// A warehouse searches for exactly one thing: **a number somebody read off a
/// label.** A carton number on a sticker, a consignment number on a surat
/// jalan, a delivery number on a clipboard. Somebody at the gate holding a box
/// wants that box, and the difference between finding it and walking to the
/// office is whether this file exists.
///
/// There is no search endpoint on an edge node, so a source filters what Query
/// already holds and fetches its list if the cache is cold. That is honest at
/// a DC's volumes — a few hundred open cartons, not a catalogue — and when a
/// list outgrows it only that source's `run` changes.
export interface SearchHit {
  readonly id: string
  readonly title: string
  readonly subtitle?: string
  /// Where to go, and which sheet to open on arrival. "Show me this carton" is
  /// one link, and it lands on the record rather than on the list holding it.
  readonly to: string
  readonly sheet?: { readonly key: SheetKey; readonly value: string }
}

interface Source {
  /// Which station this source belongs to, so a search made while standing at
  /// a station finds that station's records first.
  readonly station: string
  readonly label: string
  readonly run: (
    needle: string,
    client: QueryClient,
    signal?: AbortSignal
  ) => Promise<SearchHit[]>
}

/// Read a list out of the cache, or fetch it. `ensureQueryData` is what makes
/// the palette usable on a cold tab without every source becoming a request on
/// every keystroke — the answer is cached under the same key the screens use,
/// so opening the palette warms the screen and vice versa.
function cached<T>(
  client: QueryClient,
  key: readonly unknown[],
  fetcher: (signal?: AbortSignal) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  return client.ensureQueryData({
    queryKey: key,
    queryFn: () => fetcher(signal),
    staleTime: 15_000,
  })
}

const contains = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.toLowerCase())

const searchSources: readonly Source[] = [
  {
    station: "intake",
    label: "Delivery",
    run: async (needle, client, signal) => {
      const rows = await cached(
        client,
        keys.receipts(),
        (s) => dc.goodsReceipts(s),
        signal
      )
      return rows
        .filter(
          (row) =>
            contains(row.receipt_number, needle) ||
            contains(row.supplier_id, needle) ||
            (row.invoice_number !== null &&
              contains(row.invoice_number, needle))
        )
        .map((row) => ({
          id: row.receipt_id,
          title: row.receipt_number,
          subtitle: `${row.supplier_id} · ${row.counted_lines} counted`,
          to: "/intake",
          sheet: { key: "receipt" as const, value: row.receipt_id },
        }))
    },
  },
  {
    station: "tagging",
    label: "Tagging job",
    run: async (needle, client, signal) => {
      const rows = await cached(
        client,
        keys.taggingJobs(),
        (s) => dc.taggingJobs(s),
        signal
      )
      return rows
        .filter(
          (row) =>
            contains(row.article_code, needle) ||
            contains(row.article_name, needle)
        )
        .map((row) => ({
          id: row.job_id,
          title: row.article_code,
          subtitle: `${row.article_name} · ${row.total_quantity} labels`,
          to: "/tagging",
          sheet: { key: "job" as const, value: row.job_id },
        }))
    },
  },
  {
    station: "packing",
    label: "Carton",
    run: async (needle, client, signal) => {
      const rows = await cached(
        client,
        keys.koli(),
        (s) => dc.koli({}, s),
        signal
      )
      return rows
        .filter(
          (row) =>
            contains(row.koli_number, needle) ||
            contains(row.destination_store_id, needle)
        )
        .map((row) => ({
          id: row.koli_id,
          title: row.koli_number,
          subtitle: `${row.destination_store_id} · ${row.position.toLowerCase()} · ${row.unit_count} pcs`,
          to: "/packing",
          sheet: { key: "koli" as const, value: row.koli_id },
        }))
    },
  },
  {
    station: "despatch",
    label: "Consignment",
    run: async (needle, client, signal) => {
      const rows = await cached(
        client,
        keys.shipments(),
        (s) => dc.shipments({}, s),
        signal
      )
      return rows
        .filter(
          (row) =>
            contains(row.shipment_number, needle) ||
            contains(row.destination_store_id, needle)
        )
        .map((row) => ({
          id: row.shipment_id,
          title: row.shipment_number,
          subtitle: `${row.destination_store_id} · ${row.koli_count} cartons`,
          to: "/despatch",
          sheet: { key: "shipment" as const, value: row.shipment_id },
        }))
    },
  },
  {
    station: "despatch",
    label: "Truck",
    run: async (needle, client, signal) => {
      const rows = await cached(
        client,
        keys.dispatches(),
        (s) => dc.dispatches({}, s),
        signal
      )
      return rows
        .filter(
          (row) =>
            contains(row.dispatch_number, needle) ||
            (row.vehicle_plate !== null &&
              contains(row.vehicle_plate, needle)) ||
            (row.driver_name !== null && contains(row.driver_name, needle))
        )
        .map((row) => ({
          id: row.dispatch_id,
          title: row.dispatch_number,
          subtitle: [row.vehicle_plate, row.driver_name]
            .filter((part) => part !== null)
            .join(" · "),
          to: "/despatch/trucks",
          sheet: { key: "dispatch" as const, value: row.dispatch_id },
        }))
    },
  },
]

/// Run the sources, scoped to a station or across the whole node.
///
/// A failing source is dropped rather than failing the search: the palette is
/// how somebody finds a carton while holding it, and one unreachable list
/// should not empty the answer.
export async function runSearch(
  needle: string,
  scope: string | "everywhere",
  client: QueryClient,
  signal?: AbortSignal
): Promise<(SearchHit & { source: string })[]> {
  const trimmed = needle.trim()
  if (trimmed.length < 2) return []
  const chosen =
    scope === "everywhere"
      ? searchSources
      : searchSources.filter((source) => source.station === scope)

  const answers = await Promise.all(
    chosen.map(async (source) => {
      try {
        const hits = await source.run(trimmed, client, signal)
        return hits.map((hit) => ({ ...hit, source: source.label }))
      } catch {
        return []
      }
    })
  )
  return answers.flat().slice(0, 20)
}
