import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ClipboardList,
  Package,
  PackageCheck,
  ShoppingBag,
  Truck,
} from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { TintButton } from "@/components/ui/tint-button"
import { Card } from "@/components/ui/card"
import { DocStamp } from "@/components/ui/doc-stamp"
import { Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Thumbnail } from "@/components/ui/thumbnail"
import { dc } from "@/lib/api"
import type { useColourwayFill } from "@/lib/colourway-fill"
import { count, dayTime, quantity, sku as skuNumber } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import type { ArticlePick } from "@/lib/operations/article-picks"
import type { Identity } from "@/lib/operations/catalogue"
import { moveBack } from "@/lib/operations/changes"
import { keys } from "@/lib/operations/keys"
import { rfidChecks, rfidKeys, type RfidCheck } from "@/lib/operations/rfid"
import { RfidVerifySheet, type VerifyKoli } from "@/screens/operations/board/rfid-verify"
import { toast } from "@/lib/toast"
import { idempotencyKey } from "@itulah/contract/client"
import { cn } from "@/lib/utils"
import type { KoliRef } from "@/screens/operations/board/koli-dialog"
import type { ChangeTag } from "@/screens/operations/board/owed"
import { sum } from "@/screens/operations/board/sum"
import {
  arrived,
  stopState,
  type OpenReview,
  type Trip,
} from "@/screens/operations/board/trips"
import { bare, many } from "@/screens/operations/board/words"

/// **The board as tables** (owner, 21 Oct 2026, allotment-ops-table.html E):
/// five tabs with icons, one table each, the verbs in the bar above it.
///
///  · **Picklist** — a rail of stores, All on top and chosen at first (owner,
///    21 Oct 2026: "di picklist ada all ya, default all"); every store's
///    picklists or the chosen store's, in order, each with its Pick.
///  · **Picked** — the same rail; what the store has picked and not packed,
///    article by article. Pack is per store (the Pack sheet: only a sealed
///    koli is made); Back to Picklist puts pieces back on the picklist.
///  · **Packed** — every koli made; a row opens the koli. Ticked koli go on
///    one lorry through Dispatch; Unpack sends one back to Picked.
///  · **In transit** — a row per trip, a row opens its surat jalan.
///  · **Received** — a row per trip every store on it has received.
///
/// Every way back is red, and one tab to the left. The sheets and dialogs are
/// the board's own; this file only lays the work out.
export type Flag = {
  tone: "warn" | "info" | "bad"
  label: string
  title?: string
}

export interface StoreToPack {
  readonly shopId: string
  readonly pieces: number
  readonly allotments: readonly string[]
  /// The picklists holding the pile.
  readonly sessions: readonly string[]
}

export interface SealedKoli {
  readonly koli_id: string
  readonly koli_number: string
  readonly destination_store_id: string
  readonly unit_count: number
  readonly sealed_at: string | null
}

type TabId = "picklist" | "picked" | "packed" | "transit" | "received"

const FLAG_TONE: Record<Flag["tone"], string> = {
  warn: "bg-warn-bg text-warn-fg",
  info: "bg-accent-bg text-accent",
  bad: "bg-bad-bg text-bad-fg",
}

export function BoardTables({
  picks,
  pickFlag,
  pickTags,
  storeTags,
  koliTags,
  onPick,
  toPack,
  putBackOf,
  onPack,
  onPutBack,
  onBackToPick,
  sealed,
  heldOf,
  onOpenKoli,
  onUnpack,
  onKoliPutBack,
  onDispatch,
  transit,
  received,
  onOpenTrip,
  openReview,
  shop,
  identities,
  fill,
  emptyOf,
}: {
  picks: readonly ArticlePick[]
  pickFlag: (pick: ArticlePick) => Flag | undefined
  /// What MD changed that nobody opened yet: "8 → 6", "Cancelled", "Added +2".
  pickTags: (pick: ArticlePick) => readonly ChangeTag[]
  storeTags: (shopId: string) => readonly ChangeTag[]
  koliTags: (koliId: string) => readonly ChangeTag[]
  onPick: (pick: ArticlePick) => void
  toPack: readonly StoreToPack[]
  /// Pieces MD took out of a store's pile that go back first, or null.
  putBackOf: (shopId: string) => number | null
  onPack: (shopId: string) => void
  onPutBack: (shopId: string) => void
  onBackToPick: (shopId: string) => void
  sealed: readonly SealedKoli[]
  /// Pieces MD wants out of a koli before it may go.
  heldOf: (koliId: string) => number | undefined
  onOpenKoli: (koli: KoliRef) => void
  onUnpack: (shopId: string, koliId: string) => void
  onKoliPutBack: (shopId: string, koliId: string) => void
  /// `null` = every ready koli.
  onDispatch: (ids: ReadonlySet<string> | null) => void
  transit: readonly Trip[]
  received: readonly Trip[]
  onOpenTrip: (dispatchId: string) => void
  openReview: OpenReview
  shop: (id: string) => string
  identities: ReadonlyMap<string, Identity>
  fill: ReturnType<typeof useColourwayFill>
  emptyOf: (sentence: string) => React.ReactNode
}) {
  const [tab, setTab] = useState<TabId>("picklist")
  const [pickStore, setPickStore] = useState<string>(ALL)
  const [packStore, setPackStore] = useState<string | null>(null)
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  /// The koli being verified by RFID, while its sheet is open.
  const [verifying, setVerifying] = useState<readonly VerifyKoli[] | null>(null)
  const checks = useQuery({
    queryKey: rfidKeys.checks(),
    queryFn: ({ signal }) => rfidChecks(signal),
    refetchInterval: 10_000,
  })
  const checkOf = (koliId: string) =>
    checks.data?.find((one) => one.koli_id === koliId)
  const name = (id: string) => shop(id) || id

  // ── Picklist ──
  const pickStores = uniqueStores(
    picks.map((one) => one.destination_id),
    name
  )
  const pickShop = pickStores.length === 0 ? null : pickStores.includes(pickStore) ? pickStore : ALL
  const pickAll = pickShop === ALL
  const pickRows = picks
    .filter((one) => pickAll || one.destination_id === pickShop)
    .sort(
      (a, b) =>
        (pickAll ? name(a.destination_id).localeCompare(name(b.destination_id)) : 0) ||
        (a.allotment_number ?? "").localeCompare(b.allotment_number ?? "") ||
        (a.article_name ?? a.article_code).localeCompare(b.article_name ?? b.article_code)
    )
  const piecesToPick = (id: string) =>
    sum(picks.filter((one) => one.destination_id === id), (one) => one.pieces)

  // ── Picked ──
  const packStores = uniqueStores(toPack.map((one) => one.shopId), name)
  const packShop = packStores.includes(packStore ?? "") ? packStore! : (packStores[0] ?? null)
  const packRow = toPack.find((one) => one.shopId === packShop)
  const owedHere = packShop === null ? null : putBackOf(packShop)

  // ── Packed ── numbered from 1 per store, oldest first, as the board does.
  const koliRows = numbered(sealed)
  const live = new Set(koliRows.map((row) => row.koli.koli_id))
  const chosen = new Set([...ticked].filter((id) => live.has(id)))
  const goingIds = new Set([...chosen].filter((id) => heldOf(id) === undefined))
  const readyKoli = sealed.filter((one) => heldOf(one.koli_id) === undefined).length
  const tick = (id: string) =>
    setTicked((was) => {
      const next = new Set(was)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const tabs: { id: TabId; label: string; icon: React.ReactNode; n: number }[] = [
    { id: "picklist", label: "Picklist", icon: <ClipboardList />, n: picks.length },
    { id: "picked", label: "Picked", icon: <ShoppingBag />, n: toPack.length },
    { id: "packed", label: "Packed", icon: <Package />, n: sealed.length },
    { id: "transit", label: "In transit", icon: <Truck />, n: transit.length },
    { id: "received", label: "Received", icon: <PackageCheck />, n: received.length },
  ]

  let actions: React.ReactNode = null
  if (tab === "picked" && packShop !== null)
    actions = (
      <>
        {/* One way back (owner, 21 Oct 2026): what MD took out goes back the
        same way, the dialog already filled with it. */}
        <Button
          variant="danger"
          onClick={() => (owedHere !== null ? onPutBack(packShop) : onBackToPick(packShop))}
        >
          Back to Picklist
        </Button>
        <Button
          variant="primary"
          disabled={owedHere !== null}
          title={owedHere !== null ? `Back to Picklist first: MD took ${count(owedHere)} out` : undefined}
          onClick={() => onPack(packShop)}
        >
          {`Pack ${storeCode(name(packShop))}`}
        </Button>
      </>
    )
  if (tab === "packed" && koliRows.length > 0) {
    const one = chosen.size === 1 ? koliRows.find((row) => chosen.has(row.koli.koli_id)) : undefined
    actions = (
      <>
        <Button
          variant="danger"
          disabled={one === undefined}
          title={one === undefined ? "Tick one koli" : undefined}
          onClick={() => {
            if (one === undefined) return
            setTicked(new Set())
            // A koli MD took pieces out of opens the same way, the dialog
            // filled with what goes back.
            if (heldOf(one.koli.koli_id) !== undefined)
              onKoliPutBack(one.koli.destination_store_id, one.koli.koli_id)
            else onUnpack(one.koli.destination_store_id, one.koli.koli_id)
          }}
        >
          Unpack
        </Button>
        <TintButton
          tone="ok"
          disabled={chosen.size === 0}
          title={chosen.size === 0 ? "Tick the koli to verify" : undefined}
          onClick={() =>
            setVerifying(
              koliRows
                .filter((row) => chosen.has(row.koli.koli_id))
                .map((row) => ({
                  id: row.koli.koli_id,
                  label: `Koli ${row.index}`,
                  code: bare(row.koli.koli_number),
                  store: name(row.koli.destination_store_id),
                }))
            )
          }
        >
          {chosen.size > 0 ? `Verify RFID · ${count(chosen.size)} koli` : "Verify RFID"}
        </TintButton>
        <Button
          variant="primary"
          // Nothing can go while every koli holds pieces MD took out.
          disabled={goingIds.size === 0 && readyKoli === 0}
          title={goingIds.size === 0 && readyKoli === 0 ? "Unpack the pieces MD cut first" : undefined}
          onClick={() => {
            setTicked(new Set())
            onDispatch(goingIds.size > 0 ? goingIds : null)
          }}
        >
          {goingIds.size > 0 ? `Dispatch ${count(goingIds.size)} koli` : "Dispatch"}
        </Button>
      </>
    )
  }

  return (
    <>
      <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="To pick" value={quantity(sum(picks, (one) => one.pieces))} />
        <Kpi label="Picked" value={quantity(sum(toPack, (one) => one.pieces))} />
        <Kpi label="Packed" value={`${count(sealed.length)} koli`} />
        <Kpi
          label="In transit"
          value={`${count(sum(transit, (one) => sum(one.stops, (stop) => stop.shipment.koli_count)))} koli`}
        />
      </KpiStrip>

      <div role="tablist" aria-label="Stage" className="mb-4 flex gap-1 border-b border-hairline max-md:gap-0">
        {tabs.map((one) => {
          const on = one.id === tab
          return (
            <button
              key={one.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(one.id)}
              className={cn(
                "relative flex h-12 items-center gap-2.5 rounded-t-inner pr-3.5 pl-2 transition-colors duration-150 [&_svg]:size-[1.125rem]",
                on ? "font-medium text-ink" : "text-body hover:bg-soft-2",
                "max-md:h-auto max-md:min-w-0 max-md:flex-1 max-md:basis-0 max-md:flex-col max-md:gap-1 max-md:px-0.5 max-md:py-2 max-md:text-center"
              )}
            >
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-inner",
                  on ? "bg-accent-bg text-accent" : "bg-soft-2 text-body"
                )}
              >
                {one.icon}
              </span>
              <span className="md:whitespace-nowrap max-md:leading-tight">
                {one.label} <span className="text-body tabular-nums">{count(one.n)}</span>
              </span>
              {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-ink" />}
            </button>
          )
        })}
      </div>

      {actions !== null && (
        <div className="mb-3.5 flex flex-wrap items-center justify-end gap-2">{actions}</div>
      )}

      {tab === "picklist" &&
        (pickShop === null ? (
          emptyOf("Nothing to pick")
        ) : (
          <Railed
            stores={pickStores}
            value={pickShop}
            onChange={setPickStore}
            pieces={piecesToPick}
            name={name}
            all={sum(picks, (one) => one.pieces)}
          >
            <Card className="overflow-hidden">
              {/* Fixed on a phone: the action column keeps its width and the
              article truncates, instead of the table running off the card. */}
              <table className="w-full border-collapse text-body max-md:table-fixed">
                <thead>
                  <Head>
                    <th className="w-14 pr-2 pl-4 text-right max-md:w-11 max-md:pl-3">No.</th>
                    <th>Article</th>
                    {pickAll && <th className="max-md:hidden">Store</th>}
                    <th className="pl-4 text-right max-md:hidden">Qty</th>
                    <th className="pr-4 max-md:w-[8.75rem] md:w-56" />
                  </Head>
                </thead>
                <tbody>
                  {pickRows.map((pick, index) => {
                    const identity = identities.get(pick.lines[0]?.sku_code ?? "")
                    const flag = pickFlag(pick)
                    return (
                      <Row key={`${pick.destination_id}~${pick.allotment_id}~${pick.article_code}`} onClick={() => onPick(pick)}>
                        <td className="pr-2 pl-4 text-right text-mute tabular-nums">{index + 1}</td>
                        <td className="py-2.5">
                          <ArticleCell
                            picture={
                              <Thumbnail
                                url={identity?.image_url ?? null}
                                name={pick.article_name ?? ""}
                                division={identity?.division_code}
                                colours={fill(identity?.colour ?? null)}
                                className="size-10 shrink-0 rounded-inner"
                              />
                            }
                            title={pick.article_name ?? pick.article_code}
                            sub={
                              <>
                                {many(pick.lines.length, "SKU")}
                                {" · "}
                                <span className="font-mono">{pick.article_code}</span>
                                <span className="md:hidden">{` · ${quantity(pick.pieces)}`}</span>
                                {pickAll && (
                                  <span className="md:hidden">{` · ${storeCode(name(pick.destination_id))}`}</span>
                                )}
                              </>
                            }
                          />
                        </td>
                        {pickAll && (
                          <td className="whitespace-nowrap text-ink max-md:hidden">{storeCode(name(pick.destination_id))}</td>
                        )}
                        <td className="pl-4 text-right whitespace-nowrap tabular-nums max-md:hidden">{quantity(pick.pieces)}</td>
                        <td className="pr-4 text-right">
                          <span className="inline-flex items-center gap-2 max-md:flex-col max-md:items-end max-md:gap-1.5">
                            <Tags tags={pickTags(pick)} />
                            {flag !== undefined && <FlagPill flag={flag} />}
                            <Button
                              variant="primary"
                              size="card"
                              onClick={(event) => {
                                event.stopPropagation()
                                onPick(pick)
                              }}
                            >
                              Pick
                            </Button>
                          </span>
                        </td>
                      </Row>
                    )
                  })}
                </tbody>
                <tfoot>
                  <Foot>
                    <td />
                    <td className="text-mute">{many(pickRows.length, "picklist")}</td>
                    {pickAll && <td className="max-md:hidden" />}
                    <td className="text-right font-semibold text-ink tabular-nums max-md:hidden">
                      {quantity(sum(pickRows, (one) => one.pieces))}
                    </td>
                    <td />
                  </Foot>
                </tfoot>
              </table>
            </Card>
          </Railed>
        ))}

      {tab === "picked" &&
        (packRow === undefined ? (
          emptyOf("Nothing picked")
        ) : (
          <Railed
            stores={packStores}
            value={packRow.shopId}
            onChange={setPackStore}
            pieces={(id) => toPack.find((one) => one.shopId === id)?.pieces ?? 0}
            name={name}
          >
            <PickedTable
              row={packRow}
              identities={identities}
              fill={fill}
              tags={storeTags(packRow.shopId)}
            />
          </Railed>
        ))}

      {tab === "packed" &&
        (koliRows.length === 0 ? (
          emptyOf("Nothing packed")
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full border-collapse text-body">
              <thead>
                <Head>
                  <th className="w-12 pl-4">
                    <TickAll
                      on={koliRows.every((row) => chosen.has(row.koli.koli_id))}
                      onChange={(on) =>
                        setTicked(on ? new Set(koliRows.map((row) => row.koli.koli_id)) : new Set())
                      }
                    />
                  </th>
                  <th>Koli</th>
                  <th className="max-md:hidden">Store</th>
                  <th className="max-md:hidden">Sealed</th>
                  <th className="max-md:hidden">RFID</th>
                  <th className="pr-4 text-right">Pcs</th>
                </Head>
              </thead>
              <tbody>
                {koliRows.map(({ koli, index }) => {
                  const ref = {
                    id: koli.koli_id,
                    label: `Koli ${index}`,
                    code: koli.koli_number,
                    store: name(koli.destination_store_id),
                    sealedAt: koli.sealed_at,
                    pieces: koli.unit_count,
                  }
                  return (
                    <Row key={koli.koli_id} selected={chosen.has(koli.koli_id)} onClick={() => onOpenKoli(ref)}>
                      <td className="pl-4" onClick={(event) => event.stopPropagation()}>
                        <Tick on={chosen.has(koli.koli_id)} label={`Koli ${index} · ${name(koli.destination_store_id)}`} onChange={() => tick(koli.koli_id)} />
                      </td>
                      <td className="py-2.5">
                        <span className="flex min-w-0 flex-col leading-5">
                          <span className="font-medium text-ink">{`Koli ${index}`}</span>
                          <span className="truncate font-mono text-[0.9375rem] text-mute">{bare(koli.koli_number)}</span>
                          {koliTags(koli.koli_id).length > 0 && (
                            <span className="mt-1">
                              <Tags tags={koliTags(koli.koli_id)} />
                            </span>
                          )}
                          <span className="truncate text-[0.9375rem] text-mute md:hidden">{name(koli.destination_store_id)}</span>
                        </span>
                      </td>
                      <td className="max-md:hidden">{name(koli.destination_store_id)}</td>
                      <td className="tabular-nums max-md:hidden">{koli.sealed_at === null ? "—" : dayTime(koli.sealed_at)}</td>
                      <td className="whitespace-nowrap max-md:hidden">
                        <RfidState check={checkOf(koli.koli_id)} />
                      </td>
                      <td className="pr-4 text-right tabular-nums">
                        {count(koli.unit_count)}
                      </td>
                    </Row>
                  )
                })}
              </tbody>
            </table>
          </Card>
        ))}

      {verifying !== null && (
        <RfidVerifySheet
          koli={verifying}
          open
          onClose={() => {
            setVerifying(null)
            setTicked(new Set())
          }}
        />
      )}

      {tab === "transit" &&
        (transit.length === 0 ? (
          emptyOf("Nothing in transit")
        ) : (
          <TripTable trips={transit} name={name} openReview={openReview} onOpen={onOpenTrip} />
        ))}

      {tab === "received" &&
        (received.length === 0 ? (
          emptyOf("Nothing received yet")
        ) : (
          <TripTable trips={received} name={name} openReview={openReview} onOpen={onOpenTrip} receivedView />
        ))}
    </>
  )
}

/// What a store has picked and not packed, article by article — read off
/// the same picklists the Pack sheet reads, so the two never disagree.
/// What a store picked, one group per allotment (owner, 21 Oct 2026: a store
/// can hold pieces of several allotments, so MD's Cancelled or Edited stands
/// on its own allotment's header, never over the whole table).
function PickedTable({
  row,
  identities,
  fill,
  tags,
}: {
  row: StoreToPack
  identities: ReadonlyMap<string, Identity>
  fill: ReturnType<typeof useColourwayFill>
  /// MD's changes on this store, each naming its allotment.
  tags: readonly ChangeTag[]
}) {
  const rounds = useQueries({
    queries: row.sessions.map((id) => ({
      queryKey: keys.pickRound(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => dc.pickSession(id, signal),
    })),
  })
  // One row per SKU, no allotment numbers (owner, 21 Oct 2026: "allotment
  // number disini hapus ya").
  const by = new Map<string, { sku: string; pieces: number }>()
  for (const round of rounds)
    for (const line of round.data?.lines ?? []) {
      if (line.waiting <= 0) continue
      const was = by.get(line.sku_code)
      by.set(line.sku_code, {
        sku: line.sku_code,
        pieces: (was?.pieces ?? 0) + line.waiting,
      })
    }
  const lines = [...by.values()].sort(
    (a, b) =>
      (identities.get(a.sku)?.article_name ?? a.sku).localeCompare(
        identities.get(b.sku)?.article_name ?? b.sku
      ) || a.sku.localeCompare(b.sku)
  )
  const loading = rounds.some((one) => one.isPending)
  void tags
  /// Unpick (owner, 21 Oct 2026): a SKU's picked pieces go back on the
  /// picklist, all of them, at once.
  const client = useQueryClient()
  const unpick = useMutation({
    mutationFn: (line: { sku: string; pieces: number }) =>
      moveBack({
        idempotency_key: idempotencyKey(),
        destination_id: row.shopId,
        from: "picked",
        to: "pick",
        koli_id: null,
        lines: [{ sku_code: line.sku, quantity: line.pieces }],
      }),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: keys.dc.all })
      void client.invalidateQueries({ queryKey: keys.pools() })
      toast.success(`${quantity(result.moved)} back to Picklist`)
    },
    onError: (error) => toast.error(String((error as Error)?.message ?? error)),
  })
  return (
    <Card className="overflow-hidden">
      <table className="w-full border-collapse text-body">
        <thead>
          <Head>
            <th className="pl-4">Article</th>
            <th className="pr-4 text-right">Picked</th>
          </Head>
        </thead>
        <tbody>
          {loading && lines.length === 0 ? (
            <tr>
              <td colSpan={2} className="px-4 py-6 text-center text-mute">
                Reading what was picked…
              </td>
            </tr>
          ) : (
            lines.map((line) => {
              const identity = identities.get(line.sku)
              return (
                <Row key={line.sku}>
                  <td className="py-2.5 pl-4">
                    <ArticleCell
                      picture={
                        <Thumbnail
                          url={identity?.image_url ?? null}
                          name={identity?.article_name ?? ""}
                          division={identity?.division_code}
                          colours={fill(identity?.colour ?? null)}
                          className="size-10 shrink-0 rounded-inner"
                        />
                      }
                      title={identity?.article_name ?? skuNumber(line.sku)}
                      sub={
                        <>
                          <span className="font-mono">{skuNumber(line.sku)}</span>
                          {[identity?.colour, identity?.size]
                            .filter((part) => part)
                            .map((part) => ` · ${part}`)
                            .join("")}
                        </>
                      }
                    />
                  </td>
                  <td className="pr-4 text-right tabular-nums">
                    <span className="inline-flex items-center gap-4">
                      {quantity(line.pieces)}
                      <button
                        type="button"
                        disabled={unpick.isPending}
                        onClick={() => unpick.mutate(line)}
                        className="font-semibold text-bad-fg hover:underline disabled:opacity-50"
                      >
                        Unpick
                      </button>
                    </span>
                  </td>
                </Row>
              )
            })
          )}
        </tbody>
        <tfoot>
          <Foot>
            <td className="pl-4 text-mute">{many(lines.length, "SKU")}</td>
            <td className="pr-4 text-right font-semibold text-ink tabular-nums">{quantity(row.pieces)}</td>
          </Foot>
        </tfoot>
      </table>
    </Card>
  )
}

/// A koli's RFID check (owner, 21 Oct 2026): Verified in green once every
/// tag was read; how many were not, in amber; nothing until it is checked.
function RfidState({ check: one }: { check: RfidCheck | undefined }) {
  if (one === undefined) return <span className="text-mute">Not verified</span>
  // A cap, as a finished document wears (owner, 21 Oct 2026: "verify rfid
  // cap saja").
  if (one.verified_at !== null)
    return (
      <DocStamp
        word="RFID verified"
        tone="ok"
        at={one.verified_at}
        className="static text-[1rem] leading-5"
      />
    )
  return <span className="font-semibold text-warn-fg">{`${count(one.missing)} not read`}</span>
}

/// One row per trip: its surat jalan, the stores on it and how each stands.
function TripTable({
  trips,
  name,
  openReview,
  onOpen,
  receivedView = false,
}: {
  trips: readonly Trip[]
  name: (id: string) => string
  openReview: OpenReview
  onOpen: (dispatchId: string) => void
  receivedView?: boolean
}) {
  return (
    <Card className="overflow-hidden">
      <table className="w-full border-collapse text-body">
        <thead>
          <Head>
            {/* The trip's number (DSP-…); each store's surat jalan (SJ-…) is
            in the trip sheet, the paper the store holds (21 Oct 2026). */}
            <th className="pl-4">Trip</th>
            <th className="max-md:hidden">Store</th>
            <th className="max-md:hidden">{receivedView ? "Received" : "Left"}</th>
            <th className="text-right max-md:hidden">Koli</th>
            <th className="text-right">Pcs</th>
            <th className="pr-4 text-right">Status</th>
          </Head>
        </thead>
        <tbody>
          {trips.map((one) => {
            const states = one.stops.map((stop) =>
              stopState(stop, openReview(one.trip.dispatch_id, stop.shipment.destination_store_id))
            )
            const warn = states.find((state) => state.tone === "warn")
            const last = one.stops
              .map((stop) => stop.received?.received_at ?? "")
              .sort()
              .at(-1)
            const sent = sum(one.stops, (stop) => stop.shipment.unit_count)
            // What reached the store: counted at its door plus found later.
            // A stop the centre has no count of yet reads as sent: only a
            // store's own count can say it is short.
            const got = sum(one.stops, (stop) =>
              stop.received !== undefined
                ? stop.received.received_qty + stop.received.found_qty
                : stop.shipment.unit_count
            )
            return (
              <Row key={one.trip.dispatch_id} onClick={() => onOpen(one.trip.dispatch_id)}>
                <td className="py-2.5 pl-4">
                  <span className="flex min-w-0 flex-col leading-5">
                    <span className="truncate font-mono font-medium text-ink">{one.number}</span>
                    <span className="truncate text-[0.9375rem] text-mute md:hidden">
                      {one.stops.map((stop) => name(stop.shipment.destination_store_id)).join(", ")}
                    </span>
                  </span>
                </td>
                <td className="max-md:hidden">
                  {one.stops.map((stop) => name(stop.shipment.destination_store_id)).join(", ")}
                </td>
                <td className="tabular-nums max-md:hidden">
                  {receivedView ? (last ? dayTime(last) : "—") : dayTime(one.left)}
                </td>
                <td className="text-right tabular-nums max-md:hidden">
                  {count(sum(one.stops, (stop) => stop.shipment.koli_count))}
                </td>
                <td className="text-right tabular-nums">
                  {receivedView && got !== sent ? (
                    <span className="text-warn-fg">{`${count(got)} of ${count(sent)}`}</span>
                  ) : (
                    count(sent)
                  )}
                </td>
                <td className="pr-4 text-right">
                  {warn !== undefined ? (
                    <FlagPill flag={{ tone: "warn", label: warn.label }} />
                  ) : (
                    <span
                      className={cn(
                        "whitespace-nowrap",
                        one.stops.every(arrived) ? "text-ok-fg" : "text-accent"
                      )}
                    >
                      {states[0]?.label}
                    </span>
                  )}
                </td>
              </Row>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}

/// The thin rail of stores beside a table, with their pieces; a phone's
/// store select. All on top only where `all` (the pieces of every store) is
/// given: the Picklist. The rail grows with its stores and the page scrolls,
/// never the rail on its own (owner, 21 Oct 2026: "jangan ada scroll cukup 1
/// scroll window").
export function Railed({
  stores,
  value,
  onChange,
  pieces,
  name,
  all,
  children,
}: {
  stores: readonly string[]
  value: string
  onChange: (id: string) => void
  pieces: (id: string) => number
  name: (id: string) => string
  all?: number
  children: React.ReactNode
}) {
  const rows = all === undefined ? stores : [ALL, ...stores]
  const label = (id: string) => (id === ALL ? "All" : name(id))
  const piecesOf = (id: string) => (id === ALL ? (all ?? 0) : pieces(id))
  const phone = useLayout() === "phone"
  if (phone)
    return (
      <>
        <Select className="mb-3 h-11 w-full" value={value} onChange={onChange} aria-label="Store">
          {rows.map((id) => (
            <option key={id} value={id}>
              {`${label(id)} · ${quantity(piecesOf(id))}`}
            </option>
          ))}
        </Select>
        {children}
      </>
    )
  return (
    <div className="grid grid-cols-[13.5rem_minmax(0,1fr)] items-start gap-4">
      <nav
        aria-label="Stores"
        className="overflow-hidden rounded-card border border-hairline bg-canvas"
      >
        {rows.map((id) => {
          const on = id === value
          return (
            <button
              key={id}
              type="button"
              aria-current={on || undefined}
              onClick={() => onChange(id)}
              className={cn(
                "flex h-11 w-full items-center justify-between gap-3 border-t border-hairline px-3 text-left transition-colors duration-150 first:border-t-0",
                on ? "bg-accent-bg font-medium text-accent shadow-[inset_3px_0_0_var(--color-accent)]" : "text-ink hover:bg-soft-2"
              )}
            >
              <span className="truncate">{label(id)}</span>
              <span className={cn("shrink-0 tabular-nums", on ? "text-accent" : "text-body")}>
                {count(piecesOf(id))}
              </span>
            </button>
          )
        })}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function ArticleCell({
  picture,
  title,
  sub,
}: {
  picture: React.ReactNode
  title: React.ReactNode
  sub: React.ReactNode
}) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      {picture}
      <span className="flex min-w-0 flex-col gap-0.5 leading-5">
        <span className="truncate font-medium text-ink">{title}</span>
        <span className="truncate text-[0.9375rem] text-mute">{sub}</span>
      </span>
    </span>
  )
}

/// MD cancelled it: drawn as the stamp, not a pill.
function isCancelTag(tag: ChangeTag): boolean {
  return tag.tone === "bad" && tag.label === "Cancelled"
}

function tagLabel(tag: ChangeTag): string {
  const what =
    tag.was !== undefined && tag.now !== undefined
      ? `Edited ${count(tag.was)} → ${count(tag.now)}`
      : tag.label
  return tag.allotment === undefined ? what : `${tag.allotment} ${what.toLowerCase()}`
}

/// MD's changes on a row, as small pills.
function Tags({ tags }: { tags: readonly ChangeTag[] }) {
  if (tags.length === 0) return null
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {tags.map((tag) =>
        // A cancel is the stamp, wherever it shows (owner, 21 Oct 2026).
        isCancelTag(tag) ? (
          <DocStamp
            key={`${tag.allotment ?? ""}${tag.label}`}
            word="Cancelled"
            tone="mute"
            at={tag.at}
            className="static text-[1rem] leading-5"
          />
        ) : (
          <FlagPill
            key={`${tag.allotment ?? ""}${tag.label}`}
            flag={{
              tone: tag.tone,
              label: tagLabel(tag),
            }}
          />
        )
      )}
    </span>
  )
}

function FlagPill({ flag }: { flag: Flag }) {
  return (
    <span
      title={flag.title}
      className={cn(
        "inline-flex min-h-7 items-center rounded-full px-2.5 text-[0.9375rem] font-medium md:whitespace-nowrap max-md:py-0.5 max-md:text-left max-md:leading-tight",
        // A short word never breaks; a long one may, on a phone.
        flag.label.length <= 14 && "whitespace-nowrap",
        FLAG_TONE[flag.tone]
      )}
    >
      {flag.label}
    </span>
  )
}

function Head({ children }: { children: React.ReactNode }) {
  return (
    <tr className="h-11 border-b border-hairline bg-soft text-left text-eyebrow font-medium whitespace-nowrap text-body">
      {children}
    </tr>
  )
}

function Foot({ children }: { children: React.ReactNode }) {
  return <tr className="h-12 border-t border-hairline bg-soft">{children}</tr>
}

function Row({
  children,
  onClick,
  selected = false,
}: {
  children: React.ReactNode
  onClick?: () => void
  selected?: boolean
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "border-b border-hairline last:border-b-0",
        onClick !== undefined && "cursor-pointer transition-colors duration-150 hover:bg-soft",
        selected && "bg-accent-bg hover:bg-accent-bg"
      )}
    >
      {children}
    </tr>
  )
}

function Tick({ on, label, onChange }: { on: boolean; label: string; onChange: () => void }) {
  return (
    <input
      type="checkbox"
      checked={on}
      onChange={onChange}
      aria-label={label}
      className="size-[1.125rem] cursor-pointer accent-[var(--color-accent)]"
    />
  )
}

function TickAll({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <input
      type="checkbox"
      checked={on}
      onChange={() => onChange(!on)}
      aria-label="Every koli"
      className="size-[1.125rem] cursor-pointer accent-[var(--color-accent)]"
    />
  )
}

/// The stores once each, by name (the name leads with the code).
/// The rail's All row: no store id is empty.
const ALL = ""

function uniqueStores(ids: readonly string[], name: (id: string) => string): string[] {
  return [...new Set(ids)].sort((a, b) => name(a).localeCompare(name(b)))
}

/// "C001 · Cikupa" → "C001".
const storeCode = (label: string) => label.split(" · ")[0] ?? label

/// Every koli with its number for its store: 1 for the oldest sealed.
function numbered(sealed: readonly SealedKoli[]): { koli: SealedKoli; index: number }[] {
  const seen = new Map<string, number>()
  return [...sealed]
    .sort((a, b) => (a.sealed_at ?? "").localeCompare(b.sealed_at ?? ""))
    .map((koli) => {
      const index = (seen.get(koli.destination_store_id) ?? 0) + 1
      seen.set(koli.destination_store_id, index)
      return { koli, index }
    })
    .sort(
      (a, b) =>
        a.koli.destination_store_id.localeCompare(b.koli.destination_store_id) || a.index - b.index
    )
}
