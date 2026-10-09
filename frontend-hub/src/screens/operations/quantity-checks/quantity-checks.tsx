import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, X } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { EmptyState, Problem } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { Thumbnail } from "@/components/ui/thumbnail"
import { cn } from "@/lib/utils"
import { ago, count } from "@/lib/format"
import { colourKeys, listColours } from "@/lib/queries/colours"
import { catalogueVocabulary, procurementKeys } from "@/lib/queries/procurement"
import {
  countQuantityCheck,
  listOpenQuantityChecks,
  quantityCheckKeys,
  type QuantityCheck,
  type QuantityCheckRow,
} from "@/lib/queries/quantity-checks"
import { queryState } from "@/lib/query-state"
import { termLabel } from "@/screens/procurement/shared"
import { useSupplierName } from "@/screens/procurement/supplier-name"

/// "5 pieces", "1 piece": the kit's `quantity` is not in this tree yet.
const quantity = (n: number) => `${count(n)} ${n === 1 ? "piece" : "pieces"}`

/// **Quantity Checks** — counts head office asked the warehouse for.
///
/// From New articles, while a delivery is being named: how many of each colour
/// and size actually came. The answer is a flat list — a colour, a size, a
/// quantity — and the name is not the warehouse's to change. It is a reference
/// for whoever is naming the article; nothing waits for it and nothing is
/// compared with the delivery's own count.
export function QuantityChecks() {
  const [opened, setOpened] = useState<string | null>(null)
  const open = useQuery({
    queryKey: quantityCheckKeys.open(),
    queryFn: ({ signal }) => listOpenQuantityChecks(signal),
    refetchInterval: 15_000,
  })
  const rows = open.data ?? []
  const chosen = rows.find((one) => one.check_id === opened) ?? null

  return (
    <PageContent>
      <PageHeader crumb="Operations" title="Quantity Checks" />
      {queryState(open, {
        loading: "Loading the counts asked for…",
        render: () =>
          rows.length === 0 ? (
            <EmptyState>No counts are asked for.</EmptyState>
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
                    <span className="truncate text-[0.875rem] text-mute">
                      {one.po_number} · {count(one.receipt_quantity)} pcs
                      received
                    </span>
                  </span>
                  <span className="shrink-0 text-[0.875rem] text-mute">
                    {ago(one.requested_at)}
                  </span>
                </button>
              ))}
            </Card>
          ),
      })}
      <CountSheet check={chosen} onClose={() => setOpened(null)} />
    </PageContent>
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

  return (
    <Sheet
      open={check !== null}
      onOpenChange={(next) => !next && onClose()}
      title={check?.article_name ?? "Quantity Check"}
      caption={
        check
          ? `${check.po_number} · ${count(check.receipt_quantity)} pcs received`
          : undefined
      }
      footer={
        check === null ? undefined : (
          <div className="flex flex-col gap-3">
            <Problem error={submit.error} />
            <p
              className={cn(
                "text-[0.9375rem] font-medium tabular-nums",
                left < 0
                  ? "text-bad"
                  : balanced
                    ? "text-ok-fg"
                    : "text-warn-fg"
              )}
            >
              Counted {count(counted)} / {count(received)} pcs
              {" · "}
              {left < 0 ? `${count(-left)} over` : `${count(left)} left`}
            </p>
            <Button
              variant="primary"
              className="w-full"
              disabled={filled.length === 0 || !balanced}
              pending={submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? "Submitting…" : "Submit"}
            </Button>
          </div>
        )
      }
    >
      {check && (
        <div className="mb-6 flex flex-col gap-4">
          <Thumbnail
            url={check.image_url}
            name={check.article_name}
            division={check.division_code}
            className="size-24 shrink-0 rounded-inner border border-hairline"
          />
          <Facts className="grid-cols-1">
            <Fact term="Supplier">
              {supplierOf(
                check.supplier_id,
                check.supplier_name ?? check.supplier_id,
                check.supplier_id
              )}
            </Fact>
            <Fact term="Counted">{quantity(check.receipt_quantity)}</Fact>
            <Fact term="Name">{check.article_name}</Fact>
            {(check.division_code ?? "") !== "" && (
              <Fact term="Division">
                {termLabel(vocabulary.data?.divisions, check.division_code)}
              </Fact>
            )}
            {check.tags.length > 0 && (
              <Fact term="Tags">
                <span className="flex flex-wrap gap-1.5">
                  {check.tags.map((code) => (
                    <Tag key={code}>
                      {termLabel(vocabulary.data?.tags, code)}
                    </Tag>
                  ))}
                </span>
              </Fact>
            )}
          </Facts>
        </div>
      )}
      {check && fixed.length > 0 && (
        <div className="flex flex-col gap-3">
          {fixed.map((one, at) => (
            <div
              key={`${one.article ?? ""}|${one.colour}|${one.size}`}
              className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3"
            >
              <span className="min-w-0 text-[0.9375rem] text-ink">
                {one.article ? `${one.article} · ` : ""}
                {one.colour} · {one.size}
              </span>
              <Input
                inputMode="numeric"
                aria-label={`Quantity, ${one.article ? `${one.article}, ` : ""}${one.colour}, ${one.size}`}
                value={quantities[at] ?? ""}
                onChange={(event) =>
                  type(at, event.target.value.replace(/\D/g, ""))
                }
              />
            </div>
          ))}
        </div>
      )}
      {check && fixed.length === 0 && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5.5rem_2.25rem] gap-2 text-[0.875rem] text-body">
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
                onClick={() => change(rows.filter((row) => row.id !== one.id))}
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
    </Sheet>
  )
}