import { SheetShell } from "@/components/sheets/sheet-shell"
import { StatusDot, Tag } from "@/components/sourcing/columns"
import type { SourcingRow } from "@/components/sourcing/rows"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useBasketActions } from "@/lib/basket"
import { money } from "@/lib/money"
import { useItemSheet } from "@/lib/sheets/sourcing"
import { ApiError } from "@itulah/contract/client"
import { useForm, useStore } from "@tanstack/react-form"
import { Check, Minus, Plus, ShoppingBasket } from "lucide-react"
import { useMemo, useState } from "react"

/// One candidate, looked at properly.
///
/// The list is for comparing; this is for deciding. It shows the things a
/// buyer needs before committing a quantity and that the row has no room for —
/// the photo at a size you can judge a garment by, the supplier's own
/// description, the full tag set, and whether head office has matched it to one
/// of our articles yet.
///
/// A sheet rather than the dialog this was, and the ↑/↓ in its header is the
/// whole argument. Buying a range is looking at thirty candidates in a row, and
/// a dialog makes that thirty rounds of open, judge, close, find your place,
/// open the next. The sheet keeps the catalogue on screen behind it and moves
/// through it in place.
///
/// Fed by the screen rather than fetching for itself: `GET /supplier-items`
/// answers with the page the catalogue is already showing, and there is no
/// endpoint for one item — so a sheet that fetched would be asking the server
/// again for a row three feet away in memory. It is still opened by the URL
/// like every other sheet, which is what a colleague needs when the link
/// arrives in a conversation.
export function ItemSheet({
  rows,
  held,
}: {
  /// The catalogue as it is currently ordered and filtered, so ↑/↓ walk what
  /// the buyer can see rather than what the server happened to send.
  rows: readonly SourcingRow[]
  /// How many of each item is already in the basket.
  held: ReadonlyMap<string, number>
}) {
  const sheet = useItemSheet()
  const ids = useMemo(() => rows.map((row) => row.id), [rows])
  const row = rows.find((candidate) => candidate.id === sheet.itemId) ?? null

  return (
    <SheetShell
      open={row !== null}
      onClose={sheet.close}
      title={row?.name ?? ""}
      subtitle={row?.code}
      description="One supplier item, with the quotation and everything known about it."
      rows={ids}
      current={sheet.itemId}
      onMove={sheet.open}
      className="sm:max-w-md"
      footer={
        row === null ? undefined : (
          <AddToBasket
            key={row.id}
            row={row}
            inBasket={held.get(row.id) ?? 0}
          />
        )
      }
    >
      {/* Keyed by the item, so moving to the next one starts from a fresh
          panel rather than inheriting the last one's scroll. */}
      {row !== null && <Body key={row.id} row={row} />}
    </SheetShell>
  )
}

function Body({ row }: { row: SourcingRow }) {
  return (
    <div className="flex flex-col">
      <div className="bg-muted">
        {row.image === null ? (
          <div className="grid h-64 place-items-center text-xs text-muted-foreground">
            no photo
          </div>
        ) : (
          <img
            src={row.image}
            alt={row.name}
            className="h-72 w-full object-cover"
          />
        )}
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="font-mono text-2xl font-semibold tabular-nums">
          {money(row.price, row.currency)}
          <span className="pl-1.5 font-sans text-[11px] font-normal text-muted-foreground">
            per piece, as quoted
          </span>
        </div>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
          <Row label="Supplier">
            {row.supplier}
            <span className="pl-1.5 font-mono text-[10.5px] text-muted-foreground">
              {row.supplierCode}
            </span>
          </Row>
          <Row label="Division">{row.division}</Row>
          <Row label="Status">
            <StatusDot status={row.status} />
          </Row>
          <Row label="Our article">
            {row.article ?? (
              // Not an error and not "none": nobody has matched this supplier's
              // item to one of our own articles yet, which is the normal state
              // for something newly offered.
              <span className="text-muted-foreground">not matched yet</span>
            )}
          </Row>
        </dl>

        {row.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {row.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
        )}

        {row.description !== null && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {row.description}
          </p>
        )}
      </div>
    </div>
  )
}

/// The decision, kept out of the scroller.
///
/// In the footer rather than at the bottom of the panel because it is the one
/// thing the sheet is for, and a buyer should never have to scroll a
/// description to reach it.
function AddToBasket({
  row,
  inBasket,
}: {
  row: SourcingRow
  inBasket: number
}) {
  const { add } = useBasketActions()
  /// How many, as a form: the number is typed and then sent, and the two
  /// steppers beside it are writing the same field the box is.
  const form = useForm({
    defaultValues: { quantity: 1 },
    onSubmit: ({ value }) => {
      add.mutate(
        { supplier_item_id: row.id, quantity: value.quantity },
        { onSuccess: () => setAdded(true) }
      )
    },
  })
  const quantity = useStore(form.store, (state) => state.values.quantity)
  // Not a field: it says what became of the last request, and the request is
  // the mutation's business rather than the form's.
  const [added, setAdded] = useState(false)

  if (row.status !== "ACTIVE") {
    return (
      <p className="text-[11.5px] text-[var(--os-warn,#b7791f)]">
        This item is on hold, so it cannot go on an order. The supplier has to
        put it back in line first.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {inBasket > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {inBasket} already in your basket.
        </p>
      )}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="One fewer"
            onClick={() =>
              form.setFieldValue("quantity", Math.max(1, quantity - 1))
            }
          >
            <Minus className="size-3.5" />
          </Button>
          <form.Field name="quantity">
            {(field) => (
              <Input
                value={field.state.value}
                inputMode="numeric"
                aria-label="Quantity to add"
                onBlur={field.handleBlur}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10)
                  field.handleChange(
                    Number.isFinite(parsed) && parsed > 0 ? parsed : 1
                  )
                }}
                className="h-8 w-16 text-center font-mono text-xs"
              />
            )}
          </form.Field>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="One more"
            onClick={() => form.setFieldValue("quantity", quantity + 1)}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        <Button
          className="flex-1"
          disabled={add.isPending}
          onClick={() => void form.handleSubmit()}
        >
          {added ? (
            <>
              <Check className="size-3.5" />
              In the basket
            </>
          ) : (
            <>
              <ShoppingBasket className="size-3.5" />
              {add.isPending ? "Adding…" : "Add to basket"}
            </>
          )}
        </Button>
      </div>
      {add.isError && (
        <p className="text-[11.5px] text-destructive">
          {add.error instanceof ApiError
            ? add.error.message
            : "It could not be added to the basket."}
        </p>
      )}
      <p className="text-[10.5px] text-muted-foreground">
        Adding does not order anything. An order is raised from the basket, per
        supplier, and priced by the server from this catalogue.
      </p>
    </div>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </>
  )
}
