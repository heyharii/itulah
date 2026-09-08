import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DemandSheet } from "@/components/operations/demand-sheet"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { dc, poolsAnswer } from "@/lib/api"
import { clock, count } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { useEdgeActor } from "@/lib/edge-session"
import { useSheet } from "@/lib/sheets"
import { idempotencyKey } from "@itulah/contract/client"
import type { PicklistResult } from "@itulah/contract"

/// **Picking: the picklists this warehouse has raised, and the next one.**
///
/// There is no destination anywhere in this station, and that is the whole
/// design. Which shop each piece serves is settled when it goes into a carton,
/// so a picker walks the aisles with a sheet and a quantity and has nothing
/// else to get wrong. A "pick for store 3" control would be asserting a
/// decision nobody has made yet.
///
/// # Why this is one screen and not three
///
/// It was Picklist, Rounds and Line position. The first showed what was owed
/// and let somebody take it off a rack one SKU at a time; the second showed
/// the round those picks landed in, if anybody had remembered to open one; the
/// third answered a question about an allotment line that nothing on the
/// station had asked. Three screens for one act, and the *document* — the
/// sheet a picker is actually handed — existed on none of them.
///
/// So the round became the record. A pick is composed once, against everything
/// owed, and what comes back is a picklist with a number on it that somebody
/// can read tomorrow. Everything a person does here is either "raise one" or
/// "read one back", which is two things, which is one screen.
export function Picking() {
  const composing = useSheet("new-pick")
  const opened = useSheet("pick")
  const rack = useSheet("rack")

  const picklists = useQuery({
    queryKey: keys.picklists(),
    queryFn: ({ signal }) => dc.picklists(signal),
  })

  /// What is still owed, added up by SKU. Recomputed on every read — nobody
  /// authors this list, which is exactly why it is the thing a new picklist is
  /// composed against rather than a thing anybody edits.
  const owed = useQuery({
    queryKey: keys.picklist(),
    queryFn: ({ signal }) => dc.picklist(signal),
  })

  const answer = useQuery({
    queryKey: keys.pools(),
    queryFn: ({ signal }) => poolsAnswer(signal),
  })

  // Stock comes off a rack, and a rack is a pool this node owns. Offered as a
  // choice rather than guessed from the site id: composing a pool id in the
  // browser would be inventing a wire format nobody asked it to know.
  const racks = (answer.data?.items ?? []).filter(
    (pool) => !pool.is_rollup && pool.group === "WAREHOUSE"
  )
  const source = rack.value ?? racks[0]?.id ?? null

  const lines = owed.data ?? []
  const pieces = lines.reduce((total, line) => total + line.outstanding, 0)
  const rounds = picklists.data ?? []

  return (
    <PageContent>
      <PageHeader
        crumb="Picking"
        title="Picking"
        sub="Every round this warehouse has walked, and what came back from it."
        actions={
          <Button
            variant="primary"
            onClick={() => composing.open(true)}
            disabled={racks.length === 0}
          >
            <Plus />
            New pick
          </Button>
        }
      />

      <KpiStrip className="grid-cols-2 xl:grid-cols-4">
        <Kpi label="SKUs owed" value={count(lines.length)} />
        <Kpi
          label="Pieces owed"
          value={count(pieces)}
          delta="across every accepted allotment"
        />
        <Kpi label="Picklists" value={count(rounds.length)} />
        <Kpi
          label="Pieces fetched"
          value={count(
            rounds.reduce((total, round) => total + round.total_picked, 0)
          )}
        />
      </KpiStrip>

      {racks.length === 0 && !answer.isPending && (
        <Banner tone="bad" className="mb-[1.125rem]">
          This node owns no warehouse pool, so there is nothing to pick from.
        </Banner>
      )}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Picklists</CardTitle>
          <span className="text-[0.75rem] text-mute">
            {count(rounds.length)} raised
          </span>
        </CardHeader>

        {queryState(picklists, {
          loading: "Reading the rounds…",
          render: () =>
            rounds.length === 0 ? (
              <EmptyState
                action={
                  <Button
                    variant="soft"
                    onClick={() => composing.open(true)}
                    disabled={racks.length === 0}
                  >
                    New pick
                  </Button>
                }
              >
                {lines.length === 0
                  ? "Nothing has been picked, and nothing is owed."
                  : `${count(pieces)} pieces are owed and no round has been raised for them.`}
              </EmptyState>
            ) : (
              <div className="px-4 pt-1 pb-3.5">
                <MiniTable
                  head={[
                    "Raised",
                    { label: "Picker", align: "left" },
                    "SKUs",
                    "Pieces",
                    { label: "", align: "right" },
                  ]}
                >
                  {rounds.map((round) => (
                    <MiniRow key={round.session.session_id}>
                      <MiniCell>{clock(round.session.started_at)}</MiniCell>
                      <MiniCell>{round.session.actor_id}</MiniCell>
                      <MiniCell align="right">
                        {count(round.sku_count)}
                      </MiniCell>
                      <MiniCell align="right">
                        {count(round.total_picked)}
                      </MiniCell>
                      <MiniCell align="right">
                        <button
                          type="button"
                          onClick={() => opened.open(round.session.session_id)}
                          className="text-[0.75rem] text-accent underline underline-offset-2"
                        >
                          Read it
                        </button>
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              </div>
            ),
        })}
      </Card>

      <NewPick
        open={composing.value === true}
        onClose={() => composing.close()}
        source={source}
        racks={racks}
        onRack={(id) => rack.open(id)}
      />

      <Picklist
        id={opened.value ?? null}
        onClose={() => opened.close()}
      />
    </PageContent>
  )
}

/// Compose a round: everything owed, and how much of it this trip fetches.
///
/// The node raises the whole picklist in one request. It could have been one
/// request per line from here — that is what the screen this replaces did, one
/// line at a time as somebody typed — but then a round that dropped halfway
/// through warehouse wifi would be half a document, and nothing on the sheet
/// would say which half.
function NewPick({
  open,
  onClose,
  source,
  racks,
  onRack,
}: {
  open: boolean
  onClose: () => void
  source: string | null
  racks: readonly { id: string; label: string; stock: number }[]
  onRack: (id: string) => void
}) {
  const actor = useEdgeActor()
  const client = useQueryClient()
  const [receipt, setReceipt] = useState<PicklistResult | null>(null)

  const owed = useQuery({
    queryKey: keys.picklist(),
    queryFn: ({ signal }) => dc.picklist(signal),
    enabled: open,
  })

  const raise = useMutation({
    mutationFn: (lines: readonly { sku_code: string; quantity: number }[]) =>
      dc.createPicklist({
        source_pool_id: source!,
        lines: [...lines],
        actor_id: actor,
        note: null,
        // A picklist applied twice takes the stock off the rack twice, and the
        // second round is paperwork saying a trip happened that did not.
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: (result) => {
      setReceipt(result)
      // A round empties racks, shortens what is owed, and makes something
      // packable for a shop that is not named anywhere on it.
      void client.invalidateQueries({ queryKey: keys.dc.all })
      void client.invalidateQueries({ queryKey: keys.pools() })
    },
  })

  return (
    <>
      <DemandSheet
        open={open && receipt === null}
        onOpenChange={(next) => {
          if (!next) {
            onClose()
            raise.reset()
          }
        }}
        title="New pick"
        sub="Everything still owed, added up by SKU. Type what this trip fetches — the shop each piece serves is settled at the carton, not here."
        demand={(owed.data ?? []).map((line) => ({
          sku_code: line.sku_code,
          needed: line.outstanding,
          // Picking takes off a rack whose contents this list is not counting.
          // "Owed" is the only honest number at this station.
          available: null,
        }))}
        neededLabel="Owed"
        submitLabel="Create picklist"
        submitting={raise.isPending}
        error={raise.error}
        header={
          racks.length > 1 ? (
            <div className="mt-3">
              <Select
                aria-label="Rack"
                className="w-64"
                value={source ?? ""}
                onChange={(next) => onRack(next)}
              >
                {racks.map((pool) => (
                  <option key={pool.id} value={pool.id}>
                    {pool.label} · {count(pool.stock)}
                  </option>
                ))}
              </Select>
            </div>
          ) : undefined
        }
        onSubmit={(lines) => raise.mutate(lines)}
      />

      <Sheet
        open={receipt !== null}
        onOpenChange={() => {
          setReceipt(null)
          onClose()
          raise.reset()
        }}
        title="Picklist raised"
        id={receipt?.summary.session.session_id.slice(0, 8)}
      >
        {receipt !== null && (
          <>
            <Facts>
              <Fact term="SKUs">{count(receipt.summary.sku_count)}</Fact>
              <Fact term="Pieces">{count(receipt.summary.total_picked)}</Fact>
              <Fact term="Picker">{receipt.summary.session.actor_id}</Fact>
            </Facts>

            {/* A line the racks could not answer is a fact about the racks,
                and the one thing on this receipt worth acting on. It is said
                here rather than swallowed, because the alternative is finding
                out at the carton that a shop is two lines short. */}
            {receipt.refused.length > 0 && (
              <Banner tone="warn" className="mt-3">
                {count(receipt.refused.length)}{" "}
                {receipt.refused.length === 1 ? "line" : "lines"} came back
                empty and{" "}
                {receipt.refused.length === 1 ? "is" : "are"} still owed:
                <ul className="mt-1.5 flex flex-col gap-1">
                  {receipt.refused.map((line) => (
                    <li key={line.sku_code} className="text-[0.71875rem]">
                      <span className="font-mono">{line.sku_code}</span> ·{" "}
                      {line.reason}
                    </li>
                  ))}
                </ul>
              </Banner>
            )}

            <div className="mt-3">
              <MiniTable head={["SKU", "Picked", "Trips"]}>
                {receipt.summary.lines.map((line) => (
                  <MiniRow key={line.sku_code}>
                    <MiniCell className="font-mono text-[0.71875rem]">
                      {line.sku_code}
                    </MiniCell>
                    <MiniCell align="right">{count(line.picked)}</MiniCell>
                    <MiniCell align="right">{count(line.events)}</MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            </div>
          </>
        )}
      </Sheet>
    </>
  )
}

/// One round, read back. What came off the racks, by SKU.
function Picklist({ id, onClose }: { id: string | null; onClose: () => void }) {
  const round = useQuery({
    queryKey: keys.pickRound(id ?? ""),
    queryFn: ({ signal }) => dc.pickSession(id!, signal),
    enabled: id !== null,
  })

  return (
    <Sheet
      open={id !== null}
      onOpenChange={onClose}
      title="Picklist"
      id={id?.slice(0, 8)}
    >
      {queryState(round, {
        loading: "Reading the round…",
        render: (found) => (
          <>
            <Facts>
              <Fact term="Picker">{found.session.actor_id}</Fact>
              <Fact term="Raised">{clock(found.session.started_at)}</Fact>
              <Fact term="SKUs">{count(found.sku_count)}</Fact>
              <Fact term="Pieces">{count(found.total_picked)}</Fact>
              <Fact term="Status">
                <Pill tone={found.session.closed_at === null ? "warn" : "ok"}>
                  {found.session.closed_at === null ? "open" : "closed"}
                </Pill>
              </Fact>
            </Facts>

            {found.lines.length === 0 ? (
              <EmptyState>Nothing came off the racks in this round.</EmptyState>
            ) : (
              <div className="mt-3">
                <MiniTable head={["SKU", "Picked", "Trips"]}>
                  {found.lines.map((line) => (
                    <MiniRow key={line.sku_code}>
                      <MiniCell className="font-mono text-[0.71875rem]">
                        {line.sku_code}
                      </MiniCell>
                      <MiniCell align="right">{count(line.picked)}</MiniCell>
                      {/* More than one means a picker came back to the same
                          rack — a rack that keeps needing second trips is a
                          rack in the wrong place. */}
                      <MiniCell
                        align="right"
                        className={line.events > 1 ? "text-warn-fg" : undefined}
                      >
                        {count(line.events)}
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              </div>
            )}
          </>
        ),
      })}
    </Sheet>
  )
}
