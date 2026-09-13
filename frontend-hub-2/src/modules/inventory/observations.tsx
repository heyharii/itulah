import type { ColumnDef } from "@tanstack/react-table"
import { Boxes, Radar, Radio } from "lucide-react"
import { useMemo } from "react"

import { Button } from "@/kit/button"
import { SearchField } from "@/kit/field"
import { PageHead, Toolbar } from "@/kit/page"
import { ScopeLine } from "@/kit/scope"
import { Table } from "@/kit/table"
import { Tabs } from "@/kit/tabs"
import { Tag } from "@/kit/tag"
import { Truncated } from "@/kit/notice"
import { Empty, Failed, Loading } from "@/kit/state"
import { count } from "@/lib/format"
import { useBoundedList, useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import { useDebounced } from "@/lib/use-debounced"
import type { TableSetup } from "@/lib/table"
import { humanise, moment, since } from "@/modules/inventory/labels"
import { Ident, Place, PoolPicker, Quiet } from "@/modules/inventory/parts"
import type {
  FleetPoolList,
  Observation,
  ObservationAnomaly,
} from "@/modules/inventory/wire"

/// Sightings — what the readers saw, and where it disagrees with the books.
///
/// ## The claim this whole screen rests on
///
/// It is the server's own and it is hardcoded in both answers:
/// `automatic_inventory_effect: false` on an anomaly, `inventory_effect: {0,0}`
/// on an ingest. **A sighting is evidence, not a movement.** No amount of
/// reading a tag in the wrong aisle moves it in the ledger; a person has to
/// look at the mismatch and post a placement correction. That is also why this
/// is not the same list as Movements and must never be folded into it — one is
/// what the ledger did, the other is what a machine saw, and a screen that
/// merged them would be asserting that reading a tag moves stock.
///
/// ## Two lists, two shapes, two hooks
///
/// **Sightings** is `GET /inventory/observations` — `pool_id`, `epc`, `limit`
/// clamped at 500, a bare `{ items }` with no cursor and no total. So
/// `useBoundedList`, and `<Truncated>` the moment five hundred come back.
///
/// **Where they disagree** is `GET /inventory/observation-anomalies` — no
/// parameters at all, unbounded, one whole answer. So `useReport`: there are no
/// pages and nothing can be cut off, which is why the tab carries a real count
/// rather than a count of what was downloaded.
///
/// Both run on both tabs, deliberately. The count on the closed tab is the
/// reason somebody presses it, and a tab strip whose numbers appear only after
/// you have already chosen is a tab strip of guesses.

const CAP = 500

const unpackSightings = (body: unknown): Observation[] => [
  ...(body as { items: Observation[] }).items,
]

export function SightingsScreen() {
  const url = useQueryState()
  const tab = url.one("tab")
  const pool = url.one("pool")
  const typedEpc = url.one("epc")
  const epc = useDebounced(typedEpc, 200)
  const picking = url.one("panel") === "pool"

  const fleet = useReport<FleetPoolList>({
    key: ["inventory", "fleet"],
    path: "/api/v1/inventory/fleet-pools",
  })

  const places = useMemo(
    () =>
      (fleet.data?.items ?? [])
        .filter((row) => !row.is_rollup)
        .sort((a, b) => a.id.localeCompare(b.id)),
    [fleet.data],
  )

  const reads = useBoundedList<Observation>({
    key: ["inventory", "observations"],
    path: "/api/v1/inventory/observations",
    params: { pool_id: pool || null, epc: epc || null },
    limit: CAP,
    unpack: unpackSightings,
  })

  const anomalies = useReport<{ items: ObservationAnomaly[] }>({
    key: ["inventory", "observation-anomalies"],
    path: "/api/v1/inventory/observation-anomalies",
  })

  const mismatches = anomalies.data?.items ?? []
  const chosen = places.find((row) => row.id === pool)

  const sightingColumns: ColumnDef<TableSetup, Observation>[] = [
    {
      id: "tag",
      header: "Tag",
      size: 22,
      meta: { icon: <Radio className="size-[15px]" />, min: 190 },
      cell: ({ row }) => (
        <>
          <Ident className="text-cell text-ink block truncate">
            {row.original.epc}
          </Ident>
          <Ident className="block truncate">
            {row.original.sku_code ?? "no SKU bound to this tag"}
          </Ident>
        </>
      ),
    },
    {
      id: "where",
      header: "Seen in",
      size: 20,
      meta: { min: 180 },
      cell: ({ row }) =>
        row.original.pool_id === null ? (
          <Quiet why="The reader reported no pool, so this reading cannot be placed on a shelf." />
        ) : (
          <Ident className="text-cell">{row.original.pool_id}</Ident>
        ),
    },
    {
      id: "reader",
      header: "Reader",
      size: 18,
      meta: { priority: 1, min: 160 },
      cell: ({ row }) => (
        <>
          <span className="text-ink-2 block truncate">
            {row.original.device_id ?? "unnamed device"}
          </span>
          <span className="text-label text-ink-4 block truncate">
            {row.original.method === null
              ? "method not reported"
              : humanise(row.original.method)}
          </span>
        </>
      ),
    },
    {
      id: "reads",
      header: "Reads",
      size: 9,
      meta: { align: "right", priority: 3, min: 80 },
      /// How many times the tag answered in one sweep. Not a quantity of
      /// stock — one tag read forty times is one piece — which is why this
      /// column is called Reads and never Qty.
      cell: ({ row }) => (
        <span className="text-ink-3 tabular-nums">
          {count(row.original.read_count)}
        </span>
      ),
    },
    {
      id: "rssi",
      header: "Best signal",
      size: 12,
      meta: { align: "right", priority: 2, min: 110 },
      cell: ({ row }) =>
        row.original.best_rssi === null ? (
          <Quiet why="The reader reported no signal strength for this tag." />
        ) : (
          <span className="text-ink-3 tabular-nums">
            {row.original.best_rssi.toFixed(0)} dBm
          </span>
        ),
    },
    {
      id: "seen",
      header: "Last seen",
      size: 19,
      // Never dropped: a sighting is only evidence for as long as it is recent,
      // and the fleet read counts only the last 24 hours of them.
      meta: { min: 170 },
      cell: ({ row }) => (
        <>
          <span className="text-ink-2 block">
            {moment(row.original.last_seen_at)}
          </span>
          <span className="text-label text-ink-4 block">
            {since(row.original.last_seen_at)} ago
          </span>
        </>
      ),
    },
  ]

  const anomalyColumns: ColumnDef<TableSetup, ObservationAnomaly>[] = [
    {
      id: "tag",
      header: "Tag",
      size: 22,
      meta: { icon: <Radio className="size-[15px]" />, min: 190 },
      cell: ({ row }) => (
        <Ident className="text-cell text-ink">
          {row.original.epc ?? row.original.subject_id}
        </Ident>
      ),
    },
    {
      id: "kind",
      header: "Disagreement",
      size: 16,
      meta: { min: 160 },
      cell: ({ row }) => <Tag tone="warn">{humanise(row.original.type)}</Tag>,
    },
    {
      id: "ledger",
      header: "Books say",
      size: 20,
      meta: { min: 180 },
      cell: ({ row }) => (
        <span className="text-label font-mono">
          <Place id={`${row.original.ledger_pool}:on_hand`} />
        </span>
      ),
    },
    {
      id: "observed",
      header: "Reader saw",
      size: 20,
      meta: { min: 180 },
      cell: ({ row }) => (
        <span className="text-label font-mono">
          <Place id={`${row.original.observed_pool}:on_hand`} />
        </span>
      ),
    },
    {
      id: "effect",
      header: "Effect on stock",
      size: 22,
      // Never dropped. It is the point of the screen: this column says "none",
      // every row, always, and a reader who does not see it will assume the
      // ledger has already been corrected.
      meta: { min: 190 },
      cell: ({ row }) => (
        <span
          className="text-ink-4"
          title="The server hardcodes `automatic_inventory_effect: false`. Nothing here has moved a piece. Making the ledger agree takes a person and a placement correction."
        >
          {row.original.automatic_inventory_effect
            ? "the server now claims one"
            : "none — needs a person"}
        </span>
      ),
    },
    {
      id: "when",
      header: "Last seen",
      size: 18,
      meta: { priority: 1, min: 160 },
      cell: ({ row }) =>
        row.original.last_observed_at === null ? (
          <Quiet />
        ) : (
          <span className="text-ink-2">
            {moment(row.original.last_observed_at)}
          </span>
        ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="Inventory"
        title="Sightings"
        description="What the readers saw. Evidence, never a movement — the ledger is only ever corrected by a person."
      />

      <Tabs
        label="Sightings or disagreements"
        value={tab}
        onChange={(value) => url.set({ tab: value || null }, false)}
        tabs={[
          {
            value: "",
            label: "Sightings",
            // Deliberately no count. This list is capped at 500 and reports no
            // total, so a number here would be the size of a download rather
            // than the size of a set.
          },
          {
            value: "anomalies",
            label: "Where they disagree",
            count: anomalies.isPending ? undefined : mismatches.length,
          },
        ]}
      />

      <ScopeLine
        scope={{ kind: "during", period: "the newest sweeps on file" }}
        measure="tag reads"
        unit={
          chosen ? `${chosen.site_name ?? chosen.site_id} · ${chosen.label}` : undefined
        }
        note="a read is not a movement, here or anywhere"
      />

      {tab === "anomalies" ? (
        <>
          <Toolbar
            trailing={
              anomalies.isPending
                ? "Loading…"
                : `${count(mismatches.length)} disagreements, all of them`
            }
          >
            <span className="text-ctl text-ink-4">
              This comparison takes no parameters at all: it is every tag whose
              last sighting is somewhere the books do not have it, unbounded and
              unfiltered.
            </span>
          </Toolbar>

          {anomalies.isError ? (
            <Failed
              what="the comparison"
              error={anomalies.error}
              onRetry={() => void anomalies.refetch()}
            />
          ) : anomalies.isPending ? (
            <Loading cols={6} />
          ) : mismatches.length === 0 ? (
            <Empty
              what="disagreements"
              detail="Every tag was last seen where the ledger says it is."
            />
          ) : (
            <Table
              columns={anomalyColumns}
              rows={mismatches}
              rowId={(row) => `${row.subject_id}/${row.observed_pool}`}
              caption="Where the readers and the books disagree"
              foot={{
                tag: (
                  <>
                    <b className="text-ink">{count(mismatches.length)}</b> tags
                  </>
                ),
                effect: "none of them has moved anything",
              }}
            />
          )}
        </>
      ) : (
        <>
          {reads.truncated && <Truncated limit={CAP} noun="sightings" />}

          <Toolbar
            trailing={
              reads.query.isPending
                ? "Loading…"
                : `${count(reads.rows.length)} fetched, of a number this endpoint does not report`
            }
          >
            <Button
              icon={<Boxes className="size-4" />}
              onClick={() => url.set({ panel: "pool" }, false)}
            >
              {chosen
                ? `${chosen.site_name ?? chosen.site_id} · ${chosen.label}`
                : "Every pool"}
            </Button>
            <SearchField
              value={typedEpc}
              onChange={(value) => url.set({ epc: value || null })}
              // An exact tag, on the server, and only a tag: there is no `q`
              // on this endpoint and no SKU filter, so the box says what it
              // actually is rather than inviting a word nobody can search for.
              placeholder="An exact EPC"
              className="w-[18rem]"
            />
            <span className="text-ctl text-ink-4">
              <Radar className="mr-1 inline size-3.5" />
              Pool and tag are the only two narrowings on the wire.
            </span>
          </Toolbar>

          {reads.query.isError ? (
            <Failed
              what="the sweeps"
              error={reads.query.error}
              onRetry={() => void reads.query.refetch()}
            />
          ) : reads.query.isPending ? (
            <Loading cols={6} />
          ) : reads.rows.length === 0 ? (
            <Empty
              what="sightings"
              detail={
                pool === "" && epc === ""
                  ? "No reader has reported a sighting to this node."
                  : "No sighting matches this pool and tag."
              }
            />
          ) : (
            <Table
              columns={sightingColumns}
              rows={reads.rows}
              rowId={(row) => row.observation_id}
              caption="What the readers saw"
              foot={{
                tag: (
                  <>
                    <b className="text-ink">{count(reads.rows.length)}</b>{" "}
                    sightings fetched
                  </>
                ),
                seen: reads.truncated
                  ? "the newest 500; there may be more"
                  : "which is all of them",
              }}
            />
          )}
        </>
      )}

      <PoolPicker
        open={picking}
        pools={places}
        chosen={pool}
        anyLabel="Every pool"
        onPick={(id) => url.set({ pool: id || null, panel: null }, false)}
        onClose={() => url.set({ panel: null }, false)}
        subtitle="Sightings are filtered on the server by the pool the reader reported, which is not necessarily the pool the books have the tag in — that difference is the other tab."
      />
    </div>
  )
}

// ── what did not come across, and why ──────────────────────────────────────
//
// **The "submit a batch" form.** `POST /inventory/observations` exists and the
// old screen offered it, with the server's own warning attached: any node
// configured with a JWT secret refuses it outright, because a production reader
// signs its batch and submits it to its own Edge. It is a development path, it
// is a WRITE, and this app has no mutation discipline yet — see the same note
// on `stock.tsx`. Nothing on this screen is worse for its absence: the reads
// are the whole of what a person does here.
