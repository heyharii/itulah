import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Search } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/field"
import { FilterChips } from "@/components/ui/filter-chips"
import { CardFigure, CardName } from "@/components/ui/phone-cards"
import { SheetSection } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Banner } from "@/components/ui/states"
import { TintButton } from "@/components/ui/tint-button"
import { useColourwayFill } from "@/lib/colourway-fill"
import { count, day, money, sku, time } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { useCatalogueIdentity } from "@/lib/operations/catalogue"
import {
  matchUnmatched,
  unmatchedKeys,
  unmatchedPlacesQuery,
  unmatchedStockQuery,
  type UnmatchedSale,
  type UnmatchedStockRow,
} from "@/lib/queries/unmatched"
import { tableSetup, type TableSetup } from "@/lib/table"
import { toast } from "@/lib/toast"
import { ROOMY } from "@/screens/operations/roomy"
import {
  KIND_WORD,
  nameOf,
  typedName,
  variantLine,
  variantOf,
} from "@/screens/sales/unmatched-model"
import { ArticleThumb, RadioDot } from "@/screens/sales/unmatched-parts"

/// One unmatched sale, opened from its row (`?unmatched=`).
///
/// A short list of what the till recorded; and, while the sale is still to
/// match, the two steps head office takes — **1 Store or HO**, then **2 the
/// article at that place** — and one primary, Match. Match asks what it will do
/// to the stock before it does it (`Dialog`), then the piece leaves that
/// place's stock and the sale counts as sold at the store where it was paid;
/// from another place that is a transfer at cost. The row moves to Matched and
/// this sheet stays on it, now reading "Matched …".
///
/// The sheet keeps its last record while it slides away.
export function UnmatchedSheet({
  row,
  onClose,
}: {
  row: UnmatchedSale | null
  onClose: () => void
}) {
  const [held, setHeld] = useState(row)
  if (row !== null && row !== held) setHeld(row)
  const shown = row ?? held
  if (shown === null) return null
  return (
    <UnmatchedRecord
      key={shown.id}
      row={shown}
      open={row !== null}
      onClose={onClose}
    />
  )
}

/// The list of facts under the title: the label at the left, the value beside
/// it, a hairline between (`unmatched-sales-prototype.html`'s record sheet).
function Info({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className="flex flex-col border-t border-hairline">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="flex gap-4 border-b border-hairline py-2.5 text-[0.9375rem]"
        >
          <dt className="w-[7.5rem] shrink-0 text-body">{label}</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere] text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/// "1" or "2" in a round chip before the step's name.
function Step({ no, children }: { no: number; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="grid size-6 place-items-center rounded-full bg-soft-2 text-[0.9375rem] font-semibold text-ink">
        {no}
      </span>
      {children}
    </span>
  )
}

interface Ask {
  readonly siteId: string
  readonly placeName: string
  readonly skuCode: string
  readonly key: string
}

function UnmatchedRecord({
  row,
  open,
  onClose,
}: {
  row: UnmatchedSale
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const editable = row.status === "OPEN"
  const [placeId, setPlaceId] = useState<string | null>(null)
  const [skuCode, setSkuCode] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)
  // The question Match asks, as it was put: it stays as it was while the
  // dialog fades out, and the stock read that follows a match cannot change
  // the numbers in it on the way. `asking` is its idempotency key.
  const [asking, setAsking] = useState<string | null>(null)
  const [said, setSaid] = useState("")

  const places = useQuery({
    ...unmatchedPlacesQuery(),
    enabled: editable && open,
  })
  const place = places.data?.find((one) => one.site_id === placeId) ?? null
  const stock = useQuery({
    ...unmatchedStockQuery(placeId ?? ""),
    enabled: editable && open && placeId !== null,
  })
  const held = stock.data
  const chosen =
    skuCode === null
      ? null
      : (held?.find((one) => one.sku_code === skuCode) ?? null)

  const identities = useCatalogueIdentity()
  const fill = useColourwayFill()

  const match = useMutation({
    mutationFn: (ask: Ask) =>
      matchUnmatched(row.id, {
        site_id: ask.siteId,
        sku_code: ask.skuCode,
        idempotency_key: ask.key,
      }),
    onSuccess: (done, ask) => {
      setAsking(null)
      // The row changes tab at once; the read that follows only confirms it.
      client.setQueryData<UnmatchedSale[]>(unmatchedKeys.list("open"), (rows) =>
        rows?.filter((one) => one.id !== done.id)
      )
      client.setQueryData<UnmatchedSale[]>(
        unmatchedKeys.list("matched"),
        (rows) =>
          rows === undefined
            ? rows
            : [done, ...rows.filter((one) => one.id !== done.id)]
      )
      toast.success(
        ask.siteId === row.site_id
          ? `Matched · ${row.site_name} stock`
          : `Matched · transfer ${ask.placeName} → ${row.site_name}`
      )
    },
    onSettled: () => {
      // The place's stock went down by one, and the lists moved.
      client.invalidateQueries({ queryKey: unmatchedKeys.all })
    },
  })

  const same = place !== null && place.site_id === row.site_id
  // What Match will do, said before it is done.
  const sentence =
    place === null || chosen === null
      ? ""
      : `1 pcs of ${chosen.article_name}${variantOf(chosen) === "" ? "" : ` · ${variantOf(chosen)}`} leaves ${place.name}'s stock (${count(chosen.on_hand)} → ${count(Math.max(0, chosen.on_hand - 1))}) and counts as sold at ${row.site_name} on receipt ${row.receipt_no}.${same ? "" : ` A transfer from ${place.name} to ${row.site_name} is made at cost.`}`

  const facts: [string, string][] = [
    ["Sold", `${day(row.sold_at)} · ${time(row.sold_at)} · ${row.site_name}`],
    ["Receipt", row.receipt_no],
    ["Cashier", row.cashier_name ?? "—"],
    ["Price", money(row.price_minor)],
    ["Kind", KIND_WORD[row.kind]],
  ]
  if (row.kind === "UNKNOWN" && row.name !== null)
    facts.push([
      "Typed as",
      row.priced_by_name === null
        ? typedName(row)
        : `${typedName(row)} · priced by ${row.priced_by_name}`,
    ])
  if (row.status !== "OPEN")
    facts.push([
      "Matched",
      `${row.matched_with ?? "—"} · ${day(row.matched_at)}`,
    ])

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
        size="wide"
        stack
        title={nameOf(row)}
        caption={variantLine(row)}
        footer={
          editable ? (
            <SheetFooter
              primary={
                <Button
                  variant="primary"
                  disabled={place === null || chosen === null}
                  onClick={() => {
                    match.reset()
                    setSaid(sentence)
                    setAsking(crypto.randomUUID())
                  }}
                >
                  Match
                </Button>
              }
            />
          ) : undefined
        }
      >
        <Info rows={facts} />

        {editable && (
          <SheetSection title={<Step no={1}>Store or HO</Step>}>
            {places.isError && (
              <Banner tone="bad">The places could not be read.</Banner>
            )}
            <FilterChips
              label="Place"
              value={placeId}
              onChange={(next) => {
                if (next === null || next === placeId) return
                setPlaceId(next)
                setSkuCode(null)
              }}
              options={(places.data ?? []).map((one) => ({
                value: one.site_id,
                label: one.name,
              }))}
            />
          </SheetSection>
        )}

        {editable && place !== null && (
          <SheetSection title={<Step no={2}>Article at {place.name}</Step>}>
            <div className="rounded-card border border-hairline">
              <div className="flex items-center gap-3.5 px-4 py-3">
                {chosen !== null ? (
                  <>
                    <ArticleThumb
                      skuCode={chosen.sku_code}
                      name={chosen.article_name}
                      colour={chosen.colour}
                      identities={identities}
                      fill={fill}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-ink">
                        {chosen.article_name}
                      </span>
                      <span className="truncate text-mute">
                        {[variantOf(chosen), sku(chosen.sku_code)]
                          .filter((part) => part !== "")
                          .join(" · ")}
                        {` · Stock ${count(chosen.on_hand)}`}
                      </span>
                    </span>
                  </>
                ) : (
                  <span className="min-w-0 flex-1 text-mute">
                    {held !== undefined
                      ? `${count(held.length)} ${held.length === 1 ? "article" : "articles"}`
                      : stock.isError
                        ? "The stock could not be read."
                        : "Reading the stock…"}
                  </span>
                )}
                <TintButton
                  disabled={held === undefined}
                  onClick={() => setBrowsing(true)}
                >
                  {chosen !== null ? "Change" : "Browse articles"}
                </TintButton>
              </div>
            </div>
          </SheetSection>
        )}
      </Sheet>

      {editable && place !== null && (
        <BrowseLayer
          open={browsing}
          onClose={() => setBrowsing(false)}
          placeName={place.name}
          stock={held ?? []}
          sale={row}
          picked={skuCode}
          onPick={(next) => {
            setSkuCode(next)
            setBrowsing(false)
          }}
          identities={identities}
          fill={fill}
        />
      )}

      {/* Says what Match does to the stock before it is done. */}
      <Dialog
        open={asking !== null}
        onOpenChange={(next) => {
          if (!next) {
            setAsking(null)
            match.reset()
          }
        }}
        title="Match this sale?"
        confirm="Match"
        cancelTint
        pending={match.isPending}
        problem={match.error}
        ready={place !== null && chosen !== null}
        onConfirm={() => {
          if (place === null || chosen === null || asking === null) return
          match.mutate({
            siteId: place.site_id,
            placeName: place.name,
            skuCode: chosen.sku_code,
            key: asking,
          })
        }}
      >
        {said}
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Browse: every article at the place, over the sheet
// ---------------------------------------------------------------------------

type StockColumn = ColumnDef<TableSetup, UnmatchedStockRow>

/// The second layer: "Articles at {place}" with a search and a table; a row
/// picks the article and the layer closes. The article the sale was typed as,
/// when this place holds it, stands first.
function BrowseLayer({
  open,
  onClose,
  placeName,
  stock,
  sale,
  picked,
  onPick,
  identities,
  fill,
}: {
  open: boolean
  onClose: () => void
  placeName: string
  stock: readonly UnmatchedStockRow[]
  sale: UnmatchedSale
  picked: string | null
  onPick: (skuCode: string) => void
  identities: ReturnType<typeof useCatalogueIdentity>
  fill: ReturnType<typeof useColourwayFill>
}) {
  const phone = useLayout() === "phone"
  const [typed, setTyped] = useState("")
  const needle = typed.trim().toLowerCase()

  const rows = useMemo(
    () =>
      stock
        .filter(
          (one) =>
            needle === "" ||
            `${one.article_name} ${one.colour ?? ""} ${one.size ?? ""} ${one.sku_code} ${sku(one.sku_code)}`
              .toLowerCase()
              .includes(needle)
        )
        .sort(
          (x, y) =>
            Number(y.sku_code === sale.sku_code) -
              Number(x.sku_code === sale.sku_code) ||
            x.article_name.localeCompare(y.article_name) ||
            x.sku_code.localeCompare(y.sku_code)
        ),
    [stock, needle, sale.sku_code]
  )

  const columns = useMemo<StockColumn[]>(() => {
    const plain = (
      id: string,
      header: string,
      cell: (one: UnmatchedStockRow) => React.ReactNode,
      meta: { align?: "right" } = {}
    ): StockColumn => ({
      id,
      accessorFn: (one) => one.sku_code,
      header,
      enableSorting: false,
      meta: { card: "hide", ...meta },
      cell: ({ row }) => cell(row.original),
    })
    return [
      plain("pick", "", (one) => <RadioDot on={one.sku_code === picked} />),
      plain("article", "Article", (one) => (
        <span className="flex min-w-0 items-center gap-3">
          <ArticleThumb
            skuCode={one.sku_code}
            name={one.article_name}
            colour={one.colour}
            identities={identities}
            fill={fill}
          />
          <span className="truncate text-ink">{one.article_name}</span>
        </span>
      )),
      plain("colour", "Colour", (one) => one.colour ?? "—"),
      plain("size", "Size", (one) => one.size ?? "—"),
      plain("sku", "SKU", (one) => (
        <span className="tabular-nums">{sku(one.sku_code)}</span>
      )),
      plain(
        "stock",
        "Stock",
        (one) => <span className="tabular-nums">{count(one.on_hand)}</span>,
        { align: "right" }
      ),
      // Two columns that exist only on a card (a phone).
      {
        id: "head",
        accessorFn: (one) => one.article_name,
        header: "",
        enableHiding: false,
        enableSorting: false,
        meta: { card: "title" },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-3">
            <ArticleThumb
              skuCode={row.original.sku_code}
              name={row.original.article_name}
              colour={row.original.colour}
              identities={identities}
              fill={fill}
            />
            <CardName
              name={row.original.article_name}
              line={[
                [variantOf(row.original), sku(row.original.sku_code)]
                  .filter((part) => part !== "")
                  .join(" · "),
              ]}
            />
          </span>
        ),
      },
      {
        id: "lead",
        accessorFn: (one) => one.on_hand,
        header: "",
        enableHiding: false,
        enableSorting: false,
        meta: { card: "lead" },
        cell: ({ row }) => (
          <CardFigure value={count(row.original.on_hand)} caption="in stock" />
        ),
      },
    ]
  }, [picked, identities, fill])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (one: UnmatchedStockRow) => one.sku_code,
        state: {
          columnVisibility: {
            pick: !phone,
            article: !phone,
            colour: !phone,
            size: !phone,
            sku: !phone,
            stock: !phone,
            head: phone,
            lead: phone,
          },
        },
      }),
      [rows, columns, phone]
    )
  )

  const total = stock.length
  const find = "Search article or SKU"
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose()
          setTyped("")
        }
      }}
      size="wide"
      context={false}
      title={`Articles at ${placeName}`}
      caption={`${count(total)} ${total === 1 ? "article" : "articles"}`}
    >
      <div className="flex flex-col gap-3.5">
        <div className="relative w-[21.25rem] max-w-full">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute"
          />
          <Input
            type="search"
            autoFocus={!phone}
            aria-label={find}
            placeholder={find}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className="pl-9"
          />
        </div>
        <div className="overflow-clip rounded-card border border-hairline max-md:border-0">
          <DataTable<UnmatchedStockRow>
            table={table}
            onRowClick={(one) => {
              onPick(one.sku_code)
              setTyped("")
            }}
            isSelected={(one) => one.sku_code === picked}
            empty="Nothing here"
            virtualizeAbove={1_000_000}
            cardSort={false}
            cardsApart
            cardLead
            className={ROOMY}
          />
        </div>
      </div>
    </Sheet>
  )
}
