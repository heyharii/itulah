import { useQuery } from "@tanstack/react-query"
import { ArrowRight, ScrollText } from "lucide-react"

import { RecordCard } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { CardList, Screen, Section } from "@/components/ui/screen"
import { EmptyState } from "@/components/ui/states"
import { Tag as Code } from "@/components/ui/tag"
import { moment, label as titleCase, toneFor } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import { fetchMovements, movementsKey } from "@/lib/queries"
import type { MovementView } from "@itulah/contract"

/// The ledger, newest first.
///
/// Append-only: nothing on this screen can be edited, because nothing in the
/// ledger can be. A mistake is corrected by another movement that says what it
/// is correcting, and this is where both of them show up.
///
/// The node caps a read at 500 and defaults to 100. A hundred is a shop's day.
const LIMIT = 100

export function Movements() {
  const ledger = useQuery({
    queryKey: movementsKey(LIMIT),
    queryFn: ({ signal }) => fetchMovements(LIMIT, signal),
  })

  return (
    <Screen foot="none">
      <Section className="pt-4">
        {queryState(ledger, {
          loading: "Reading this shop's ledger…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                Nothing has moved in this shop yet. Receiving a garment or
                selling one writes the first line here.
              </EmptyState>
            ) : (
              <CardList>
                {rows.map((row) => (
                  <MovementCard key={row.movement_id} row={row} />
                ))}
              </CardList>
            ),
        })}
      </Section>
    </Screen>
  )
}

function MovementCard({ row }: { row: MovementView }) {
  return (
    <RecordCard
      icon={<ScrollText />}
      id={titleCase(row.cause)}
      status={
        <Pill tone={CAUSE_TONE[row.cause] ?? toneFor(row.cause)}>
          ×{row.quantity}
        </Pill>
      }
    >
      <div className="flex items-center gap-2 px-3 pt-3 text-cell text-ink">
        <span className="min-w-0 flex-1 truncate">{place(row.from)}</span>
        <ArrowRight className="size-4 shrink-0 text-line-ico" />
        <span className="min-w-0 flex-1 truncate text-right">
          {place(row.to)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 px-3 pt-2.5 pb-3">
        <Code>{row.epc.slice(-8)}</Code>
        <span className="text-meta text-mute">
          {row.actor_id} · {moment(row.occurred_at)}
        </span>
      </div>
    </RecordCard>
  )
}

/// Which movements mean something is wrong, and which are the ordinary day.
///
/// `toneFor` covers the shared status taxonomy; these are causes it has never
/// seen, and guessing at them from the word would put "confirmed lost" and
/// "found" in the same colour.
const CAUSE_TONE: Readonly<
  Record<string, "ok" | "warn" | "bad" | "info" | "neutral">
> = {
  SALE: "ok",
  STORE_RECEIVE: "ok",
  FOUND: "ok",
  COUNT_GAIN: "ok",
  NORMAL_MOVE: "neutral",
  OPENING: "neutral",
  IDENTIFICATION: "neutral",
  TAGGING: "neutral",
  CUSTOMER_RETURN: "info",
  RETURN_TO_DC: "info",
  SUPPLIER_RETURN: "info",
  PLACEMENT_CORRECTION: "warn",
  COUNT_SHORTAGE: "warn",
  CONFIRMED_LOST: "bad",
  DISPOSAL: "bad",
}

/// `store-01.floor:on_hand` → `Shop floor`. A place id is a wire format and
/// nobody standing at a counter should have to read one.
function place(id: string): string {
  const [pool] = id.split(":")
  const segment = pool.split(".").slice(1).join(" ")
  switch (segment) {
    case "warehouse":
      return "Warehouse"
    case "floor":
      return "Shop floor"
    case "reject":
      return "Reject"
    default:
      break
  }
  if (id.startsWith("external/customer")) return "A customer"
  if (id.startsWith("external/supplier")) return "A supplier"
  if (id.startsWith("external/disposal")) return "Disposal"
  if (id.startsWith("system/opening")) return "Opening balance"
  if (id.startsWith("system/count_gain")) return "Found in a count"
  if (id.startsWith("system/lost")) return "Written off"
  if (id.startsWith("system/identification")) return "Identified"
  return segment === "" ? id : titleCase(segment)
}
