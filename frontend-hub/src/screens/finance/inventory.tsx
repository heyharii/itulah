import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { count, day, money, quantity } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  financeKeys,
  inventoryValuation,
  stockVsLedger,
  type AwaitingSetupRow,
  type InventoryValuationRow,
} from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import { cn } from "@/lib/utils"
import {
  CardRow,
  Code,
  Grid,
  NumberCard,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { CardFigure, PhoneList } from "@/components/ui/phone-cards"
import {
  PhoneChoice,
  PhoneFigures,
  SiteName,
  SupplierName,
} from "@/screens/finance/parts"

/// Finance › Inventory. One article is bought once, so what a piece is worth
/// is the price on its PO / receipt; value = quantity × that cost.

const sum = <T,>(rows: readonly T[], pick: (row: T) => number) =>
  rows.reduce((total, row) => total + pick(row), 0)

export function UnitRail({
  value,
  onChange,
}: {
  value: string | null
  onChange: (id: string | null) => void
}) {
  const units = useUnits()
  const list = useMemo(
    () =>
      (units.data ?? [])
        .filter((unit) => unit.status !== "CLOSED")
        .sort((a, b) => {
          if (a.kind === "HO" && b.kind !== "HO") return -1
          if (b.kind === "HO" && a.kind !== "HO") return 1
          return a.code.localeCompare(b.code)
        }),
    [units.data]
  )
  const choices: { id: string | null; name: string; code: string | null }[] = [
    { id: null, name: "All units", code: null },
    ...list.map((unit) => ({ id: unit.id, name: unit.name, code: unit.code })),
  ]
  return (
    <>
      {/* A column of units beside the page leaves a phone 122px to read in:
          there the unit is a chip in the dock. */}
      <PhoneChoice
        title="Unit"
        value={value ?? ""}
        onChange={(next) => onChange(next === "" ? null : next)}
        options={choices.map((choice) => ({
          value: choice.id ?? "",
          label:
            choice.code === null
              ? choice.name
              : `${choice.name} · ${choice.code}`,
          short: choice.name,
        }))}
      />
      <nav
        aria-label="Units"
        className="sticky top-4 w-56 shrink-0 overflow-hidden rounded-card border border-hairline-2 bg-canvas shadow-soft max-md:hidden"
      >
        {choices.map((choice) => (
          <button
            key={choice.id ?? "all"}
            type="button"
            onClick={() => onChange(choice.id)}
            aria-current={choice.id === value ? "page" : undefined}
            className={cn(
              "flex w-full flex-col items-start border-b border-hairline px-4 py-3 text-left transition-colors last:border-b-0",
              choice.id === value ? "bg-accent-bg" : "hover:bg-soft"
            )}
          >
            <span
              className={cn(
                "truncate",
                choice.id === value ? "font-medium text-ink" : "text-text"
              )}
            >
              {choice.name}
            </span>
            {choice.code !== null && (
              <span className="font-mono text-[0.875rem] text-mute">
                {choice.code}
              </span>
            )}
          </button>
        ))}
      </nav>
    </>
  )
}

export function InventoryValuationScreen() {
  const [unit, setUnit] = useState<string | null>(null)
  const [tab, setTab] = useState("article")
  const [needle, setNeedle] = useState("")

  const valuation = useQuery({
    queryKey: financeKeys.inventoryValuation(unit),
    queryFn: ({ signal }) => inventoryValuation({ unit }, signal),
  })

  const data = valuation.data
  const onHand = useMemo(
    () => (data?.rows ?? []).filter((row) => !row.in_transit),
    [data]
  )
  const transit = useMemo(
    () => (data?.rows ?? []).filter((row) => row.in_transit),
    [data]
  )
  const awaiting = data?.awaiting_setup ?? []
  const onHandValue = sum(onHand, (row) => row.value_minor)
  const transitValue = sum(transit, (row) => row.value_minor)
  const awaitingValue = sum(awaiting, (row) => row.value_minor)

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Inventory"
        title="Inventory Valuation"
        sub="What the stock is worth: every piece on hand × the price it was bought at."
      />
      <div className="flex items-start gap-6 max-md:block">
        <UnitRail value={unit} onChange={setUnit} />
        <div className="min-w-0 flex-1">
          {valuation.isPending ? (
            <LoadingState>Reading the stock…</LoadingState>
          ) : valuation.isError ? (
            <ErrorState
              error={valuation.error}
              onRetry={() => void valuation.refetch()}
            />
          ) : (
            <>
              <PhoneFigures
                items={[
                  { label: "Stock on hand", value: onHandValue },
                  { label: "In transit", value: transitValue },
                  { label: "Awaiting setup", value: awaitingValue },
                  {
                    label: "Inventory value",
                    value: onHandValue + transitValue + awaitingValue,
                  },
                ]}
              />
              <div className="max-md:hidden">
                <CardRow columns={4}>
                  <NumberCard label="Stock on hand" value={onHandValue} />
                  <NumberCard label="In transit" value={transitValue} />
                  <NumberCard label="Awaiting setup" value={awaitingValue} />
                  <NumberCard
                    label="Inventory value"
                    value={onHandValue + transitValue + awaitingValue}
                  />
                </CardRow>
              </div>
              <div className="mt-5 max-md:mt-0">
                <SubTabs
                  tabs={[
                    { value: "article", label: "By article" },
                    { value: "site", label: "By site" },
                    { value: "awaiting", label: "Awaiting setup" },
                  ]}
                  value={tab}
                  onChange={setTab}
                />
                {tab === "article" ? (
                  <ByArticle
                    onHand={onHand}
                    transit={transit}
                    needle={needle}
                    setNeedle={setNeedle}
                  />
                ) : tab === "site" ? (
                  <BySite rows={data?.rows ?? []} />
                ) : (
                  <Awaiting rows={awaiting} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </PageContent>
  )
}

function ByArticle({
  onHand,
  transit,
  needle,
  setNeedle,
}: {
  onHand: InventoryValuationRow[]
  transit: InventoryValuationRow[]
  needle: string
  setNeedle: (value: string) => void
}) {
  const filter = (rows: InventoryValuationRow[]) => {
    const q = needle.trim().toLowerCase()
    return rows
      .filter(
        (row) =>
          q === "" ||
          row.article_code.toLowerCase().includes(q) ||
          row.article_name.toLowerCase().includes(q) ||
          (row.po_numbers ?? "").toLowerCase().includes(q)
      )
      .sort((a, b) => b.value_minor - a.value_minor)
  }
  const here = filter(onHand)
  const road = filter(transit)
  const all = [...here, ...road]
  const phone = useLayout() === "phone"

  const line = (row: InventoryValuationRow, onTheRoad: boolean) => (
    <tr key={`${row.site_id}-${row.in_transit}-${row.article_code}`}>
      <Td>
        <div className="flex flex-col">
          <Code>{row.article_code}</Code>
          <span className="text-ink">{row.article_name}</span>
        </div>
      </Td>
      <Td className="text-mute">{row.division_code ?? "—"}</Td>
      <Td align="right">{count(row.quantity)}</Td>
      <Td align="right">
        {row.cost_source === "NONE" ? "—" : money(row.unit_cost_minor)}
      </Td>
      <Td align="right">{money(row.value_minor)}</Td>
      <Td>
        <span>{row.po_numbers ?? "—"}</span>
        {row.po_count > 1 && (
          <span className="ml-2 text-[0.875rem] text-mute">
            avg of {row.po_count} POs
          </span>
        )}
        {onTheRoad && (
          <span className="ml-2 text-[0.875rem] text-mute">in transit</span>
        )}
      </Td>
    </tr>
  )

  return (
    <>
      <Toolbar>
        <Input
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
          aria-label="Search articles"
          placeholder="Search articles"
          className="h-control w-64"
        />
      </Toolbar>
      {all.length === 0 ? (
        <EmptyState>
          {needle.trim() === "" ? "No stock to value." : "Nothing matches."}
        </EmptyState>
      ) : phone ? (
        <PhoneList
          rows={all.map((row) => ({
            key: `${row.site_id}-${row.in_transit}-${row.article_code}`,
            title: row.article_name,
            code: row.article_code,
            lead: (
              <CardFigure
                value={money(row.value_minor)}
                caption={`${count(row.quantity)} pcs`}
              />
            ),
            foot: (
              <span className="tabular-nums">
                {row.cost_source === "NONE"
                  ? "No cost"
                  : `${money(row.unit_cost_minor)} each`}
                {row.po_numbers ? ` · ${row.po_numbers}` : ""}
                {row.po_count > 1 ? ` (avg of ${row.po_count} POs)` : ""}
                {row.in_transit ? " · in transit" : ""}
              </span>
            ),
          }))}
        />
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th>Article</Th>
              <Th>Division</Th>
              <Th align="right">Quantity</Th>
              <Th align="right">Unit cost</Th>
              <Th align="right">Value</Th>
              <Th>PO</Th>
            </tr>
          </thead>
          <tbody>
            {here.map((row) => line(row, false))}
            {road.length > 0 && (
              <tr data-total>
                <Td colSpan={6} className="bg-soft text-mute">
                  In transit
                </Td>
              </tr>
            )}
            {road.map((row) => line(row, true))}
            <TotalRow>
              <Td>Total set up</Td>
              <Td />
              <Td align="right">{count(sum(all, (row) => row.quantity))}</Td>
              <Td />
              <Td align="right">{money(sum(all, (row) => row.value_minor))}</Td>
              <Td />
            </TotalRow>
          </tbody>
        </Grid>
      )}
    </>
  )
}

function BySite({ rows }: { rows: InventoryValuationRow[] }) {
  const sites = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string
        name: string
        transit: boolean
        pieces: number
        value: number
      }
    >()
    for (const row of rows) {
      const key = `${row.site_id}:${row.in_transit}`
      const one = map.get(key) ?? {
        id: row.site_id,
        name: row.site_name,
        transit: row.in_transit,
        pieces: 0,
        value: 0,
      }
      one.pieces += row.quantity
      one.value += row.value_minor
      map.set(key, one)
    }
    return [...map.values()].sort((a, b) => b.value - a.value)
  }, [rows])

  const phone = useLayout() === "phone"
  if (sites.length === 0) return <EmptyState>No stock to value.</EmptyState>
  if (phone)
    return (
      <PhoneList
        rows={sites.map((site) => ({
          key: `${site.id}:${site.transit}`,
          title: site.transit ? (
            <>
              {site.name}
              <span className="ml-2 text-[0.875rem] font-normal text-mute">
                in transit
              </span>
            </>
          ) : (
            <SiteName id={site.id} />
          ),
          lead: money(site.value),
          foot: `${quantity(site.pieces)}`,
        }))}
      />
    )
  return (
    <Grid>
      <thead>
        <tr>
          <Th>Site</Th>
          <Th align="right">Pcs</Th>
          <Th align="right">Value</Th>
        </tr>
      </thead>
      <tbody>
        {sites.map((site) => (
          <tr key={`${site.id}:${site.transit}`}>
            <Td>
              {site.transit ? (
                <>
                  {site.name}
                  <span className="ml-2 text-[0.875rem] text-mute">
                    in transit
                  </span>
                </>
              ) : (
                <SiteName id={site.id} />
              )}
            </Td>
            <Td align="right">{count(site.pieces)}</Td>
            <Td align="right">{money(site.value)}</Td>
          </tr>
        ))}
        <TotalRow>
          <Td>Total set up</Td>
          <Td align="right">{count(sum(sites, (site) => site.pieces))}</Td>
          <Td align="right">{money(sum(sites, (site) => site.value))}</Td>
        </TotalRow>
      </tbody>
    </Grid>
  )
}

function Awaiting({ rows }: { rows: AwaitingSetupRow[] }) {
  const phone = useLayout() === "phone"
  return (
    <>
      <p className="mb-3 text-[0.875rem] text-mute">
        Received and in the books, not yet tagged — valued at the receipt price.
      </p>
      {rows.length === 0 ? (
        <EmptyState>Every receipt has been set up.</EmptyState>
      ) : phone ? (
        <PhoneList
          rows={rows.map((row) => ({
            key: row.receipt_number,
            title: <SupplierName id={row.supplier_id} />,
            code: row.receipt_number,
            lead: (
              <CardFigure
                value={money(row.value_minor)}
                caption={`${count(row.quantity)} pcs`}
              />
            ),
            foot: (
              <span>
                {row.po_number ?? "No PO"}
                {row.received_on === null ? "" : ` · ${day(row.received_on)}`}
                {` · ${count(row.lines)} ${row.lines === 1 ? "line" : "lines"}`}
              </span>
            ),
          }))}
        />
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th>Receipt</Th>
              <Th>PO</Th>
              <Th>Supplier</Th>
              <Th>Received</Th>
              <Th align="right">Lines</Th>
              <Th align="right">Quantity</Th>
              <Th align="right">Value</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.receipt_number}>
                <Td>
                  <Code>{row.receipt_number}</Code>
                </Td>
                <Td>{row.po_number ?? "—"}</Td>
                <Td>
                  <SupplierName id={row.supplier_id} />
                </Td>
                <Td>{row.received_on === null ? "—" : day(row.received_on)}</Td>
                <Td align="right">{count(row.lines)}</Td>
                <Td align="right">{count(row.quantity)}</Td>
                <Td align="right">{money(row.value_minor)}</Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td />
              <Td />
              <Td />
              <Td align="right">{count(sum(rows, (row) => row.lines))}</Td>
              <Td align="right">{count(sum(rows, (row) => row.quantity))}</Td>
              <Td align="right">
                {money(sum(rows, (row) => row.value_minor))}
              </Td>
            </TotalRow>
          </tbody>
        </Grid>
      )}
    </>
  )
}

function Diff({ minor }: { minor: number }) {
  return minor === 0 ? (
    <span className="text-mute">·</span>
  ) : (
    <span className="text-bad-fg">{money(minor)}</span>
  )
}

export function StockVsLedger() {
  const result = useQuery({
    queryKey: financeKeys.stockVsLedger(),
    queryFn: ({ signal }) => stockVsLedger(signal),
  })
  const rows = result.data ?? []
  const phone = useLayout() === "phone"
  const stock = sum(rows, (row) => row.stock_minor)
  const ledger = sum(rows, (row) => row.ledger_minor)
  const difference = sum(rows, (row) => row.difference_minor)

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Inventory"
        title="Stock vs Ledger"
        sub="Each unit's stock at cost against its inventory ledger, and goods in transit against the in-transit ledger."
      />
      {result.isPending ? (
        <LoadingState>Reading stock and ledger…</LoadingState>
      ) : result.isError ? (
        <ErrorState
          error={result.error}
          onRetry={() => void result.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState>No unit holds stock yet.</EmptyState>
      ) : (
        <>
          <PhoneFigures
            items={[
              { label: "Stock", value: stock },
              { label: "Ledger", value: ledger },
              {
                label: "Difference",
                value: difference,
                tone: difference === 0 ? "ok" : "bad",
              },
            ]}
          />
          <div className="max-md:hidden">
            <CardRow>
              <NumberCard label="Stock" value={stock} />
              <NumberCard label="Ledger" value={ledger} />
              <NumberCard
                label="Difference"
                value={difference}
                tone={difference === 0 ? "ok" : "bad"}
              />
            </CardRow>
          </div>
          {phone && (
            <PhoneList
              rows={rows.map((row) => ({
                key: row.unit_id,
                title: row.unit_name,
                lead: (
                  <CardFigure
                    value={
                      row.difference_minor === 0
                        ? "—"
                        : money(row.difference_minor)
                    }
                    caption="difference"
                    tone={row.difference_minor === 0 ? undefined : "bad"}
                  />
                ),
                alert:
                  row.difference_minor !== 0 ||
                  row.in_transit_difference_minor !== 0,
                foot: (
                  <span className="block tabular-nums">
                    <span className="block">
                      Stock {money(row.stock_minor)} · Ledger{" "}
                      {money(row.ledger_minor)}
                    </span>
                    <span className="block">
                      In transit {money(row.in_transit_stock_minor)} · Ledger{" "}
                      {money(row.in_transit_ledger_minor)}
                      {row.in_transit_difference_minor === 0
                        ? ""
                        : ` · off ${money(row.in_transit_difference_minor)}`}
                    </span>
                  </span>
                ),
              }))}
            />
          )}
          <div className="mt-5 max-md:hidden">
            <Grid>
              <thead>
                <tr>
                  <Th>Unit</Th>
                  <Th align="right">On hand</Th>
                  <Th align="right">Awaiting setup</Th>
                  <Th align="right">Stock</Th>
                  <Th align="right">Ledger</Th>
                  <Th align="right">Difference</Th>
                  <Th align="right">In transit</Th>
                  <Th align="right">In transit ledger</Th>
                  <Th align="right">Difference</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.unit_id}>
                    <Td>{row.unit_name}</Td>
                    <Td align="right">{money(row.on_hand_minor)}</Td>
                    <Td align="right">{money(row.awaiting_setup_minor)}</Td>
                    <Td align="right">{money(row.stock_minor)}</Td>
                    <Td align="right">{money(row.ledger_minor)}</Td>
                    <Td align="right">
                      <Diff minor={row.difference_minor} />
                    </Td>
                    <Td align="right">{money(row.in_transit_stock_minor)}</Td>
                    <Td align="right">{money(row.in_transit_ledger_minor)}</Td>
                    <Td align="right">
                      <Diff minor={row.in_transit_difference_minor} />
                    </Td>
                  </tr>
                ))}
                <TotalRow>
                  <Td>Total</Td>
                  <Td align="right">
                    {money(sum(rows, (r) => r.on_hand_minor))}
                  </Td>
                  <Td align="right">
                    {money(sum(rows, (r) => r.awaiting_setup_minor))}
                  </Td>
                  <Td align="right">{money(stock)}</Td>
                  <Td align="right">{money(ledger)}</Td>
                  <Td align="right">
                    <Diff minor={difference} />
                  </Td>
                  {/* Not added up: the unit that sent a box and the unit it is
                      bound for both carry it until it is counted in, so a
                      total across units would count every box twice. */}
                  <Td align="right">
                    <span title="Sender and receiver both carry a box until it is counted in, so units are not added">
                      —
                    </span>
                  </Td>
                  <Td align="right">
                    <span title="Sender and receiver both carry a box until it is counted in, so units are not added">
                      —
                    </span>
                  </Td>
                  <Td align="right">
                    <Diff
                      minor={sum(rows, (r) => r.in_transit_difference_minor)}
                    />
                  </Td>
                </TotalRow>
              </tbody>
            </Grid>
            <p className="mt-3 text-[0.875rem] text-mute">
              Read as at today — the stores and DC report where each piece is
              now.
            </p>
          </div>
        </>
      )}
    </PageContent>
  )
}
