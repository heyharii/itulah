import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, X } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input, Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Sheet } from "@/components/ui/sheet"
import { EmptyState, Problem } from "@/components/ui/states"
import { Thumbnail } from "@/components/ui/thumbnail"
import { cn } from "@/lib/utils"
import { ago, count, day, dayMonth } from "@/lib/format"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { colourKeys, listColours } from "@/lib/queries/colours"
import { catalogueVocabulary, procurementKeys } from "@/lib/queries/procurement"
import {
  countQuantityCheck,
  listQuantityChecks,
  quantityCheckKeys,
  type QuantityCheck,
  type QuantityCheckCell,
  type QuantityCheckRow,
} from "@/lib/queries/quantity-checks"
import { queryState } from "@/lib/query-state"
import { COUNT_HEAD, COUNT_ROW } from "@/screens/operations/intake/receiving"
import { TwoLines } from "@/screens/operations/two-lines"
import { titled } from "@/screens/procurement/po-print"
import { STAMP, termLabel } from "@/screens/procurement/shared"
import { VariantPhoto, variantLabel } from "@/screens/procurement/variant-photo"
import { useSupplierName } from "@/screens/procurement/supplier-name"

/// **Quantity Checks** — counts head office asked the warehouse for.
///
/// From New articles, while a delivery is being named: how many of each colour
/// and size actually came. The answer is a flat list — a colour, a size, a
/// quantity — and the name is not the warehouse's to change. It is a reference
/// for whoever is naming the article; nothing waits for it and nothing is
/// compared with the delivery's own count.
type Stage = "REQUESTED" | "COUNTED"

export function QuantityChecks() {
  const [opened, setOpened] = useState<string | null>(null)
  /// Where a check stands (owner, 16 Oct 2026): asked of the warehouse, or
  /// counted by it. Those are the two statuses the node keeps.
  const [tab, setTab] = useState<Stage>("REQUESTED")
  const open = useQuery({
    queryKey: quantityCheckKeys.book(),
    queryFn: ({ signal }) => listQuantityChecks(signal),
    refetchInterval: 15_000,
  })
  const all = open.data ?? []
  const asked = all.filter((one) => one.status === "REQUESTED")
  const counted = all.filter((one) => one.status === "COUNTED")
  const rows = tab === "REQUESTED" ? asked : counted
  const countedPieces = counted.reduce(
    (sum, one) => sum + one.lines.reduce((s, line) => s + line.quantity, 0),
    0
  )
  // One still asked for opens to be answered; one counted opens to be read.
  const chosen = all.find((one) => one.check_id === opened) ?? null

  return (
    <PageContent>
      <PageHeader crumb="Operations" title="Quantity Checks" />
      <DockTools
        status={{
          value: tab,
          options: [
            { value: "REQUESTED", label: "To count", count: asked.length },
            { value: "COUNTED", label: "Counted", count: counted.length },
          ],
          onChange: (next) => setTab(next as Stage),
        }}
      />
      <KpiStrip className="grid-cols-3">
        <Kpi label="To count" value={count(asked.length)} />
        <Kpi label="Counted" value={count(counted.length)} />
        <Kpi label="Pieces counted" value={`${count(countedPieces)} pcs`} />
      </KpiStrip>
      {/* On a phone the two stages are the dock's status button. */}
      <SubTabs
        className="max-md:hidden"
        value={tab}
        onChange={(next) => setTab(next as Stage)}
        tabs={[
          { value: "REQUESTED", label: `To count ${count(asked.length)}` },
          { value: "COUNTED", label: `Counted ${count(counted.length)}` },
        ]}
      />
      {queryState(open, {
        loading: "Loading the counts asked for…",
        render: () =>
          rows.length === 0 ? (
            <EmptyState>
              {tab === "COUNTED"
                ? "Nothing counted yet."
                : "No counts are asked for."}
            </EmptyState>
          ) : (
            <Card className="overflow-hidden">
              {rows.map((one) => (
                <button
                  key={one.check_id}
                  type="button"
                  onClick={() => setOpened(one.check_id)}
                  className="flex min-h-16 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors not-first:border-t not-first:border-hairline hover:bg-soft active:bg-soft-2"
                >
                  <Thumbnail
                    url={one.image_url}
                    name={one.article_name}
                    className="size-11 shrink-0 rounded-inner border border-hairline"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[0.9375rem] font-medium text-ink">
                      {one.article_name}
                    </span>
                    <span className="truncate text-[0.9375rem] text-mute">
                      {one.po_number} · {count(one.receipt_quantity)} pcs
                      received
                    </span>
                  </span>
                  {one.status === "COUNTED" ? (
                    <span className={cn(STAMP, "shrink-0 text-ok-fg")}>
                      Counted
                      {one.counted_at !== null && (
                        <span className="block tabular-nums">
                          {dayMonth(one.counted_at)}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[0.9375rem] text-mute">
                      {ago(one.requested_at)}
                    </span>
                  )}
                </button>
              ))}
            </Card>
          ),
      })}
      <CountSheet
        check={chosen?.status === "REQUESTED" ? chosen : null}
        onClose={() => setOpened(null)}
      />
      <CountedSheet
        check={chosen?.status === "COUNTED" ? chosen : null}
        onClose={() => setOpened(null)}
      />
    </PageContent>
  )
}

/// A check the warehouse has answered, as facts: who counted it and when, and
/// each colour and size with what was counted against it. Nothing to type.
function CountedSheet({
  check,
  onClose,
}: {
  check: QuantityCheck | null
  onClose: () => void
}) {
  const supplierOf = useSupplierName()
  const nameOfLogin = useNameOfLogin()
  const groups: { name: string; lines: QuantityCheckRow[] }[] = []
  for (const line of check?.lines ?? []) {
    const name = line.article ? line.article : (check?.article_name ?? "")
    const group = groups.find((one) => one.name === name)
    if (group) group.lines.push(line)
    else groups.push({ name, lines: [line] })
  }
  const counted = (check?.lines ?? []).reduce(
    (sum, one) => sum + one.quantity,
    0
  )
  const received = check?.receipt_quantity ?? 0
  const photos = check?.image_url != null && check.image_url !== ""

  return (
    <Sheet
      open={check !== null}
      onOpenChange={(next) => !next && onClose()}
      id={check?.po_number}
      title={
        check === null
          ? "Quantity Check"
          : supplierOf(
              check.supplier_id,
              check.supplier_name ?? check.supplier_id,
              check.supplier_id
            )
      }
      width="table"
    >
      {check && (
        <div className="flex min-w-0 flex-col gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2 text-[0.9375rem]">
            <dt className="text-mute">Counted by</dt>
            <dd className="text-ink">
              {check.counted_by ? titled(nameOfLogin(check.counted_by)) : "—"}
            </dd>
            <dt className="text-mute">Counted on</dt>
            <dd className="text-ink tabular-nums">
              {check.counted_at ? day(check.counted_at) : "—"}
            </dd>
            <dt className="text-mute">Asked by</dt>
            <dd className="text-ink">
              {titled(nameOfLogin(check.requested_by))}
            </dd>
          </dl>
          <Card className="overflow-hidden">
            <div
              className={cn(
                COUNT_ROW,
                "h-10 items-center border-b border-hairline bg-soft"
              )}
            >
              <span className={COUNT_HEAD}>Article</span>
              <span className={cn(COUNT_HEAD, "max-sm:hidden")}>Counted</span>
              <span className={cn(COUNT_HEAD, "text-right")}>In pieces</span>
            </div>
            {groups.length === 0 ? (
              <EmptyState>No pieces were counted.</EmptyState>
            ) : (
              <div className="divide-y divide-hairline">
                {groups.map((group) => {
                  const sum = group.lines.reduce(
                    (total, one) => total + one.quantity,
                    0
                  )
                  return (
                    <div key={group.name} className="pb-3.5">
                      <div className={cn(COUNT_ROW, "py-3.5")}>
                        <TwoLines
                          top={group.name}
                          bottom={
                            groups.length === 1
                              ? `${count(received)} pcs received`
                              : "—"
                          }
                          className="min-h-11"
                        />
                        <span className="max-sm:hidden" />
                        <span className="flex min-h-11 items-center justify-end text-right font-medium text-ink tabular-nums">
                          {count(sum)} pcs
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {group.lines.map((line) => {
                          const label = variantLabel(check.article_name, {
                            colour_code: line.colour,
                            size_code: line.size,
                          })
                          return (
                            <div
                              key={`${line.colour}|${line.size}`}
                              className={cn(COUNT_ROW, "items-center")}
                            >
                              <span className="flex min-h-11 min-w-0 items-center gap-3">
                                <VariantPhoto
                                  urls={undefined}
                                  fallback={check.image_url}
                                  name={label}
                                  slot={photos}
                                />
                                <span className="line-clamp-2 min-w-0 text-body">
                                  {label}
                                </span>
                              </span>
                              <span className="text-[0.9375rem] text-ink tabular-nums">
                                {count(line.quantity)} pcs
                              </span>
                              <span className="max-sm:hidden" />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          <div className="flex justify-end">
            <dl className="grid w-full grid-cols-[1fr_auto] gap-x-12 rounded-card border border-hairline bg-soft px-5 py-2 tabular-nums md:w-auto md:min-w-[22rem]">
              <dt className="flex min-h-11 items-center text-[1rem] font-medium text-ink">
                Total Counted
              </dt>
              <dd className="flex min-h-11 items-center justify-end text-right text-[1.0625rem] font-semibold text-ink">
                {count(counted)} pcs
              </dd>
              <dt className="flex min-h-11 items-center text-[1rem] font-medium text-ink">
                Pieces Received
              </dt>
              <dd className="flex min-h-11 items-center justify-end text-right text-[1.0625rem] font-semibold text-ink">
                {count(received)} pcs
              </dd>
            </dl>
          </div>
        </div>
      )}
    </Sheet>
  )
}

interface Entry {
  readonly id: number
  readonly colour: string
  readonly size: string
  readonly quantity: string
}

let entryId = 0
const blank = (): Entry => ({
  id: (entryId += 1),
  colour: "",
  size: "",
  quantity: "",
})

/// One check, answered as a flat list. When head office chose its colours and
/// sizes the rows are fixed (article, colour and size are read-only) and the
/// warehouse only types a quantity on each; a row left empty is not sent.
/// Without them (an older check) the sheet is the editable list it always was.
function CountSheet({
  check,
  onClose,
}: {
  check: QuantityCheck | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const supplierOf = useSupplierName()
  const colours = useQuery({
    queryKey: colourKeys.list(),
    queryFn: ({ signal }) => listColours(signal),
    staleTime: 30 * 60 * 1000,
  })
  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    staleTime: 30 * 60 * 1000,
  })
  const [entries, setEntries] = useState<readonly Entry[]>(() => [blank()])
  // The sheet stays mounted between checks: rows typed for one are tagged with
  // it, so the next opens clean without an effect to clear them.
  const [forId, setForId] = useState<string | null>(null)
  const rows = forId === check?.check_id ? entries : [blank()]
  const change = (next: readonly Entry[]) => {
    setForId(check?.check_id ?? null)
    setEntries(next)
  }
  const patch = (id: number, part: Partial<Entry>) =>
    change(rows.map((one) => (one.id === id ? { ...one, ...part } : one)))

  // Head office's combinations, one fixed row each, with the quantity typed
  // against its position.
  const fixed = check?.expected ?? []
  const [typed, setTyped] = useState<Readonly<Record<number, string>>>({})
  const quantities = forId === check?.check_id ? typed : {}
  const type = (at: number, value: string) => {
    setForId(check?.check_id ?? null)
    setTyped({ ...quantities, [at]: value })
  }

  const filled: QuantityCheckRow[] =
    fixed.length > 0
      ? fixed
          .map((one, at) => ({
            ...one,
            quantity: Number(quantities[at] ?? "") || 0,
          }))
          .filter((one) => one.quantity > 0)
      : rows
          .filter(
            (one) =>
              one.colour !== "" && one.size !== "" && Number(one.quantity) > 0
          )
          .map((one) => ({
            colour: one.colour,
            size: one.size,
            quantity: Number(one.quantity),
          }))
  /// What the warehouse counted has to be what came: the total of the rows
  /// equals the pieces received, as New articles asks of its own grid.
  const counted = filled.reduce((sum, one) => sum + one.quantity, 0)
  const received = check?.receipt_quantity ?? 0
  const left = received - counted
  const balanced = left === 0
  const submit = useMutation({
    mutationFn: () => countQuantityCheck(check!.check_id, filled),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: quantityCheckKeys.all })
      setForId(null)
      onClose()
    },
  })

  /// The rows by article: a delivery split into sibling articles has one group
  /// each, as an order's lines do on the Receiving count sheet.
  const groups: {
    name: string
    cells: { cell: QuantityCheckCell; at: number }[]
  }[] = []
  fixed.forEach((cell, at) => {
    const name = cell.article ? cell.article : (check?.article_name ?? "")
    const group = groups.find((one) => one.name === name)
    if (group) group.cells.push({ cell, at })
    else groups.push({ name, cells: [{ cell, at }] })
  })
  const kind =
    check === null
      ? ""
      : [
          ...((check.division_code ?? "") !== ""
            ? [termLabel(vocabulary.data?.divisions, check.division_code)]
            : []),
          ...check.tags.map((code) => termLabel(vocabulary.data?.tags, code)),
        ].join(" · ")
  const tone =
    left < 0 ? "text-bad-fg" : balanced ? "text-ok-fg" : "text-warn-fg"
  const photos = check?.image_url != null && check.image_url !== ""

  return (
    <Sheet
      open={check !== null}
      onOpenChange={(next) => !next && onClose()}
      id={check?.po_number}
      title={
        check === null
          ? "Quantity Check"
          : supplierOf(
              check.supplier_id,
              check.supplier_name ?? check.supplier_id,
              check.supplier_id
            )
      }
      width="table"
      footer={
        check === null ? undefined : (
          <div className="flex items-center justify-end gap-3">
            <Button
              variant="primary"
              disabled={filled.length === 0 || !balanced}
              pending={submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? "Sending…" : "Submit count"}
            </Button>
          </div>
        )
      }
    >
      {check && (
        <div className="flex min-w-0 flex-col gap-4">
          {/* One grid, header and rows sharing the Receiving count sheet's
          own tracks: what, what was counted, and what that comes to. */}
          <Card className="overflow-hidden">
            <div
              className={cn(
                COUNT_ROW,
                "h-10 items-center border-b border-hairline bg-soft"
              )}
            >
              <span className={COUNT_HEAD}>Article</span>
              <span className={cn(COUNT_HEAD, "max-sm:hidden")}>Counted</span>
              <span className={cn(COUNT_HEAD, "text-right")}>In pieces</span>
            </div>
            {fixed.length > 0 ? (
              <div className="divide-y divide-hairline">
                {groups.map((group) => {
                  const sum = group.cells.reduce(
                    (total, { at }) =>
                      total + (Number(quantities[at] ?? "") || 0),
                    0
                  )
                  return (
                    <div key={group.name} className="pb-3.5">
                      <div className={cn(COUNT_ROW, "py-3.5")}>
                        <TwoLines
                          top={group.name}
                          bottom={
                            groups.length === 1
                              ? [`${count(received)} pcs received`, kind]
                                  .filter((part) => part !== "")
                                  .join(" · ")
                              : kind || "—"
                          }
                          className="min-h-11"
                        />
                        <span className="max-sm:hidden" />
                        <span
                          className={cn(
                            "flex min-h-11 items-center justify-end text-right tabular-nums",
                            sum > 0 ? "font-medium text-ink" : "text-mute"
                          )}
                        >
                          {sum > 0 ? `${count(sum)} pcs` : "—"}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {group.cells.map(({ cell, at }) => {
                          const label = variantLabel(check.article_name, {
                            colour_code: cell.colour,
                            size_code: cell.size,
                          })
                          return (
                            <div
                              key={`${cell.colour}|${cell.size}`}
                              className={cn(COUNT_ROW, "items-center")}
                            >
                              <span className="flex min-h-11 min-w-0 items-center gap-3">
                                <VariantPhoto
                                  urls={undefined}
                                  fallback={check.image_url}
                                  name={label}
                                  slot={photos}
                                />
                                <span className="line-clamp-2 min-w-0 text-body">
                                  {label}
                                </span>
                              </span>
                              <div className="flex items-center gap-2">
                                <Input
                                  className="h-11 w-24 text-center font-semibold"
                                  inputMode="numeric"
                                  autoComplete="off"
                                  aria-label={`Counted pieces of ${label}`}
                                  padLabel={label}
                                  value={quantities[at] ?? ""}
                                  onChange={(event) =>
                                    type(
                                      at,
                                      event.target.value.replace(/\D/g, "")
                                    )
                                  }
                                />
                                <span className="w-28 text-[0.9375rem] text-body max-sm:w-auto">
                                  pieces
                                </span>
                                <span className="size-11 max-sm:hidden" />
                              </div>
                              <span className="max-sm:hidden" />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-4 px-4 py-3.5">
                <TwoLines
                  top={check.article_name}
                  bottom={[`${count(received)} pcs received`, kind]
                    .filter((part) => part !== "")
                    .join(" · ")}
                />
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5.5rem_2.25rem] gap-2 text-[0.9375rem] text-body">
                  <span>Color</span>
                  <span>Size</span>
                  <span>Quantity</span>
                  <span />
                </div>
                {rows.map((one) => (
                  <div
                    key={one.id}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5.5rem_2.25rem] items-center gap-2"
                  >
                    <Select
                      aria-label="Color"
                      value={one.colour}
                      onChange={(next) => patch(one.id, { colour: next })}
                    >
                      <option value="">—</option>
                      {(colours.data?.colours ?? []).map((term) => (
                        <option key={term.code} value={term.label}>
                          {term.label}
                        </option>
                      ))}
                    </Select>
                    <Select
                      aria-label="Size"
                      value={one.size}
                      onChange={(next) => patch(one.id, { size: next })}
                    >
                      <option value="">—</option>
                      {(vocabulary.data?.sizes ?? []).map((term) => (
                        <option key={term.code} value={term.label}>
                          {term.label}
                        </option>
                      ))}
                    </Select>
                    <Input
                      inputMode="numeric"
                      className="text-right tabular-nums"
                      aria-label="Quantity"
                      value={one.quantity}
                      onChange={(event) =>
                        patch(one.id, {
                          quantity: event.target.value.replace(/\D/g, ""),
                        })
                      }
                    />
                    <button
                      type="button"
                      aria-label="Remove row"
                      disabled={rows.length === 1}
                      onClick={() =>
                        change(rows.filter((row) => row.id !== one.id))
                      }
                      className="grid size-9 place-items-center rounded-full text-mute transition-colors hover:bg-soft-2 hover:text-ink disabled:opacity-40"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  className="self-start"
                  onClick={() => change([...rows, blank()])}
                >
                  <Plus />
                  Add Row
                </Button>
              </div>
            )}
          </Card>

          {/* The totals, in a box at the right as on the Receiving count: the
          counter sees how far from the delivery's own figure the rows are. */}
          <div className="flex justify-end">
            <dl className="grid w-full grid-cols-[1fr_auto] gap-x-12 rounded-card border border-hairline bg-soft px-5 py-2 tabular-nums md:w-auto md:min-w-[22rem]">
              <dt className="flex min-h-11 items-center text-[1rem] font-medium text-ink">
                Total Counted
              </dt>
              <dd className="flex min-h-11 items-center justify-end text-right text-[1.0625rem] font-semibold text-ink">
                {count(counted)} pcs
              </dd>
              <dt className="flex min-h-11 items-center text-[1rem] font-medium text-ink">
                Pieces Received
              </dt>
              <dd className="flex min-h-11 items-center justify-end text-right text-[1.0625rem] font-semibold text-ink">
                {count(received)} pcs
              </dd>
              <dt className="flex min-h-11 items-center text-[1rem] font-medium text-ink">
                {left < 0 ? "Over" : "Left"}
              </dt>
              <dd
                className={cn(
                  "flex min-h-11 items-center justify-end text-right text-[1.0625rem] font-semibold",
                  tone
                )}
              >
                {count(Math.abs(left))} pcs
              </dd>
            </dl>
          </div>

          <Problem error={submit.error} />
        </div>
      )}
    </Sheet>
  )
}
