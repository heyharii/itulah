import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { SavedDialog } from "@/components/ui/dialog"
import { Field, Input } from "@/components/ui/field"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  fleetPools,
  idempotencyKey,
  inventoryKeys,
  resolveMissing,
} from "@/lib/queries/inventory"
import { cn } from "@/lib/utils"
import {
  groupMissing,
  useMissingRows,
  type MissingGroup,
} from "@/screens/inventory/missing-data"
import { Choice } from "@/screens/inventory/parts"
import { useActor, writablePools } from "@/screens/inventory/shared"
import { CardFigure, CardName, PhoneCard } from "@/components/ui/phone-cards"

/// Missing, grouped by SKU and the pool it went missing from.
///
/// The endpoint answers per tag; a person answers per article, so rows with the
/// same SKU and origin pool are one line here. **Move** and **Write off** take
/// a number of pieces and spend it across the group's rows, oldest first — each
/// row is one existing `found` / `lost` call, so nothing new is asked of the
/// server.

const OVERDUE_DAYS = 30

export function MissingList({ canWriteOff }: { canWriteOff: boolean }) {
  const { query, rows } = useMissingRows()
  const groups = useMemo(() => groupMissing(rows), [rows])
  const phone = useLayout() === "phone"
  const [move, setMove] = useState<string | null>(null)
  const [off, setOff] = useState<string | null>(null)

  if (query.isPending)
    return <LoadingState>Reading what is missing…</LoadingState>
  if (query.isError)
    return <Banner tone="bad">The missing list could not be read.</Banner>

  return (
    <>
      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {groups.length === 0 ? (
          <EmptyState>Nothing missing.</EmptyState>
        ) : phone ? (
          // A phone's cards: the article over its SKU, what is missing, where
          // from and how long ago on the foot, and the two things to do.
          <ul className="flex flex-col gap-2.5">
            {groups.map((group) => (
              <PhoneCard
                key={group.key}
                onOpen={() => setMove(group.key)}
                head={
                  <CardName
                    name={group.name ?? group.sku}
                    code={group.name ? group.sku : undefined}
                  />
                }
                lead={
                  <CardFigure value={count(group.left)} caption="missing" />
                }
                body={
                  <div className="flex flex-col gap-1 text-[0.9375rem]">
                    <span className="text-ink">
                      {group.poolLabel} · {group.site}
                    </span>
                    {group.from !== null && (
                      <span className="text-mute">
                        From {group.from}
                        {group.fromRef && ` · ${group.fromRef}`}
                      </span>
                    )}
                  </div>
                }
                foot={
                  <span
                    className={cn(
                      "tabular-nums",
                      group.days !== null &&
                        group.days > OVERDUE_DAYS &&
                        "font-medium text-bad-fg"
                    )}
                  >
                    {group.days === null ? "—" : `${group.days} days`}
                  </span>
                }
                action={
                  <span className="inline-flex gap-2">
                    <Button
                      variant="tint"
                      size="card"
                      onClick={(event) => {
                        event.stopPropagation()
                        setMove(group.key)
                      }}
                    >
                      Move
                    </Button>
                    {canWriteOff && (
                      <Button
                        variant="tint"
                        size="card"
                        onClick={(event) => {
                          event.stopPropagation()
                          setOff(group.key)
                        }}
                      >
                        Write off
                      </Button>
                    )}
                  </span>
                }
              />
            ))}
          </ul>
        ) : (
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="h-12 border-b border-hairline bg-soft text-left text-[0.9375rem] font-medium text-body">
                <th className="pl-4">Article</th>
                <th>Pool</th>
                <th>From</th>
                <th className="text-right">Missing</th>
                <th className="text-right">Age</th>
                <th className="pr-4" />
              </tr>
            </thead>
            <tbody className="[&_td]:py-3.5">
              {groups.map((group) => (
                <tr
                  key={group.key}
                  className="h-[4.5rem] border-b border-hairline last:border-b-0"
                >
                  <td className="pl-4">
                    <span className="block leading-snug font-medium text-ink">
                      {group.name ?? group.sku}
                    </span>
                    {group.name && (
                      <span className="mt-1 block font-mono text-id text-mute">
                        {group.sku}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="block leading-snug text-ink">
                      {group.poolLabel}
                    </span>
                    <span className="mt-1 block text-[0.9375rem] text-mute">
                      {group.site}
                    </span>
                  </td>
                  <td>
                    <span className="block leading-snug text-ink">
                      {group.from ?? "—"}
                    </span>
                    {group.fromRef && (
                      <span className="mt-1 block font-mono text-id text-mute">
                        {group.fromRef}
                      </span>
                    )}
                  </td>
                  <td className="text-right font-medium text-ink tabular-nums">
                    {count(group.left)}
                  </td>
                  <td
                    className={cn(
                      "text-right tabular-nums",
                      group.days !== null && group.days > OVERDUE_DAYS
                        ? "font-medium text-bad-fg"
                        : "text-body"
                    )}
                  >
                    {group.days === null ? "—" : `${group.days} days`}
                  </td>
                  <td className="pr-4 text-right whitespace-nowrap">
                    <span className="inline-flex gap-2">
                      <Button variant="soft" onClick={() => setMove(group.key)}>
                        Move
                      </Button>
                      {canWriteOff && (
                        <Button
                          variant="danger"
                          onClick={() => setOff(group.key)}
                        >
                          Write off
                        </Button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <ResolveSheet
        mode="found"
        group={groups.find((group) => group.key === move) ?? null}
        onClose={() => setMove(null)}
      />
      <ResolveSheet
        mode="lost"
        group={groups.find((group) => group.key === off) ?? null}
        onClose={() => setOff(null)}
      />
    </>
  )
}

/// Spends `pieces` across the group's rows, oldest first, one call per row.
function ResolveSheet({
  mode,
  group,
  onClose,
}: {
  mode: "found" | "lost"
  group: MissingGroup | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const [pieces, setPieces] = useState("")
  const [pool, setPool] = useState("")
  /// What the receipt dialog says once the write lands, until it is read.
  const [resolved, setResolved] = useState<string | null>(null)

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
    enabled: group !== null && mode === "found",
  })
  const destinations = useMemo(
    () =>
      writablePools(fleet.data?.items ?? []).map((one) => ({
        value: one.id,
        label: `${one.site_id} · ${one.label}`,
      })),
    [fleet.data]
  )

  const qty = Number(pieces)
  const valid =
    group !== null && Number.isInteger(qty) && qty > 0 && qty <= group.left

  const resolve = useMutation({
    mutationFn: async () => {
      let remaining = qty
      for (const row of group!.rows) {
        if (remaining <= 0) break
        const take = Math.min(remaining, row.quantity)
        await resolveMissing(row.id, mode, {
          actor_id: actor,
          idempotency_key: idempotencyKey(),
          quantity: take,
          destination_pool_id:
            mode === "found" && pool !== "" && pool !== row.origin_pool
              ? pool
              : null,
          reason: mode === "found" ? "Found" : "Written off",
          reference: null,
        })
        remaining -= take
      }
    },
    onSuccess: () => {
      setResolved(
        mode === "found"
          ? `${qty} pcs moved`
          : `${qty} pcs written off · Stock Adjustment`
      )
      setPieces("")
      onClose()
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: inventoryKeys.missing() })
      client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
      client.invalidateQueries({ queryKey: ["inventory", "pools"] })
    },
  })

  return (
    <Sheet
      open={group !== null}
      onOpenChange={(open) => {
        if (!open) {
          setPieces("")
          setPool("")
          resolve.reset()
          onClose()
        }
      }}
      title={mode === "found" ? "Move" : "Write off"}
      caption={
        group && `${group.name ?? group.sku} · ${count(group.left)} missing`
      }
    >
      {group && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (valid) resolve.mutate()
          }}
        >
          {resolve.isError && (
            <Banner tone="bad">
              {resolve.error instanceof Error
                ? resolve.error.message
                : "Refused."}
            </Banner>
          )}
          <Field
            label={mode === "found" ? "Pcs found" : "Pcs"}
            hint={
              mode === "found" && valid && qty < group.left
                ? `${count(group.left - qty)} stays missing`
                : undefined
            }
          >
            <Input
              type="number"
              min={1}
              max={group.left}
              value={pieces}
              onChange={(event) => setPieces(event.target.value)}
              autoFocus
            />
          </Field>
          {mode === "found" && (
            <Field label="Found in">
              <Choice
                value={pool === "" ? group.pool : pool}
                onChange={setPool}
                options={destinations}
                className="h-9 w-full max-w-none"
              />
            </Field>
          )}
          <Button
            type="submit"
            variant="primary"
            pending={resolve.isPending}
            disabled={!valid || actor === ""}
          >
            {mode === "found" ? "Move" : "Write off"}
          </Button>
        </form>
      )}
      <SavedDialog
        open={resolved !== null}
        onOpenChange={(next) => {
          if (!next) setResolved(null)
        }}
        title={resolved ?? ""}
      />
    </Sheet>
  )
}
