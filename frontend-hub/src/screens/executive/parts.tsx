import { Link, useHydrated, type LinkProps } from "@tanstack/react-router"
import { ArrowRight, Check, ChevronDown, Store } from "lucide-react"
import { Suspense, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockPortal, useDock } from "@/components/shell/dock"
import { CardHeader, CardTitle } from "@/components/ui/card"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { ChoiceMenu, SHEET_ROW } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { Segmented } from "@/components/ui/segmented"
import { cn } from "@/lib/utils"
import { change, changeTone, percent } from "@/screens/executive/format"
import { usePlaces } from "@/screens/executive/places"
import { TERMS, type ReportScope } from "@/screens/executive/scope"

/// The pieces every executive page is built from, so six pages read as one
/// report: the same header, the same scope bar, the same figure grammar.

/// A movement for a KPI tile: arrow, percentage, and what it is measured
/// against — the one sentence of context a figure needs.
export function Movement({ now, before }: { now: number; before: number }) {
  const fraction = change(now, before)
  if (fraction === null) {
    return <span className="font-normal text-mute">vs previous period —</span>
  }
  return (
    <>
      <span aria-hidden>{fraction > 0 ? "↗" : fraction < 0 ? "↘" : "→"}</span>
      {percent(Math.abs(fraction))}
      <span className="ml-1 font-normal text-mute">vs previous period</span>
    </>
  )
}

export function Figure({
  label,
  value,
  now,
  before,
  good = "up",
  note,
}: {
  label: React.ReactNode
  value: React.ReactNode
  /// With `before`, draws the movement. Leave both out for a balance, which is
  /// a position rather than a flow and has no "vs last period" of its own.
  now?: number
  before?: number
  good?: "up" | "down"
  note?: React.ReactNode
}) {
  const moved = now !== undefined && before !== undefined
  return (
    <Kpi
      label={label}
      value={value}
      tone={moved ? changeTone(change(now, before), good) : "flat"}
      delta={
        moved ? (
          <Movement now={now} before={before} />
        ) : note !== undefined ? (
          <span className="font-normal">{note}</span>
        ) : undefined
      }
    />
  )
}

export function Figures({ children }: { children: React.ReactNode }) {
  return (
    <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
      {children}
    </KpiStrip>
  )
}

// ── the page ────────────────────────────────────────────────────────────────

/// Title, then the one bar that says what the whole page is about: which
/// period, which shop, against what.
///
/// The bar offers the shops the sales report names, so it waits for that answer
/// in a boundary of its own: the title and the period stand at once, and the
/// shop menu fills in beside them.
export function ReportPage({
  title,
  scope,
  children,
  storeFilter = true,
}: {
  title: string
  scope: ReportScope
  children: React.ReactNode
  /// Off for a page whose figures are the company's only.
  storeFilter?: boolean
}) {
  return (
    <PageContent>
      <PageHeader crumb="Executive" title={title} className="mb-4" />

      <Suspense
        fallback={
          <ScopeBar
            scope={scope}
            stores={[]}
            storeFilter={storeFilter}
            nameOf={(siteId) => siteId}
          />
        }
      >
        <NamedScopeBar scope={scope} storeFilter={storeFilter} />
      </Suspense>

      {children}
    </PageContent>
  )
}

/// The bar with the shops the report knows by name.
function NamedScopeBar({
  scope,
  storeFilter,
}: {
  scope: ReportScope
  storeFilter: boolean
}) {
  const { places, nameOf } = usePlaces(scope)
  const stores = places.filter((place) => place.kind === "STORE")
  return (
    <ScopeBar
      scope={scope}
      stores={stores}
      storeFilter={storeFilter}
      nameOf={nameOf}
    />
  )
}

function ScopeBar({
  scope,
  stores,
  storeFilter,
  nameOf,
}: {
  scope: ReportScope
  stores: readonly { site_id: string; name: string }[]
  storeFilter: boolean
  nameOf: (siteId: string) => string
}) {
  const hydrated = useHydrated()
  // Until the shops are known a narrowed report names its shop by its id, so
  // the menu is never offered a value it has no row for.
  const offered =
    scope.store !== undefined &&
    !stores.some((place) => place.site_id === scope.store)
      ? [...stores, { site_id: scope.store, name: nameOf(scope.store) }]
      : stores

  return (
    <>
      {/* On a phone the period and the shop are the dock's two buttons, and
          the page opens on its figures. */}
      <div className="mb-5 flex flex-wrap items-center gap-2 max-md:hidden">
        <Segmented
          options={TERMS}
          value={scope.term}
          onChange={scope.setTerm}
        />
        {storeFilter && (
          <ChoiceMenu
            heading="Store"
            icon={Store}
            value={scope.store ?? null}
            options={[
              { value: null, label: "All stores" },
              ...offered.map((place) => ({
                value: place.site_id,
                label: place.name,
              })),
            ]}
            onChange={(value) => scope.setStore(value ?? undefined)}
            className="border border-hairline-2 bg-canvas"
          />
        )}
        <span className="ml-auto text-[0.9375rem] text-mute">
          {scope.label}
          {storeFilter &&
            scope.store !== undefined &&
            ` · ${nameOf(scope.store)}`}
          <span className="text-faint"> · vs </span>
          {scope.beforeLabel}
        </span>
      </div>

      {/* The dock is the browser's: a boundary that streams in after the page
          has hydrated finds the dock already there and would draw into it, where
          the server drew nothing. */}
      {hydrated && (
        <ScopeDock
          scope={scope}
          stores={offered}
          storeFilter={storeFilter}
          storeName={
            scope.store === undefined ? undefined : nameOf(scope.store)
          }
        />
      )}
      <p className="mb-4 text-[0.9375rem] text-mute md:hidden">
        {scope.label}
        {storeFilter &&
          scope.store !== undefined &&
          ` · ${nameOf(scope.store)}`}
        <span className="text-faint"> · vs </span>
        {scope.beforeLabel}
      </p>
    </>
  )
}

/// The period and the shop, as the two buttons over the bottom bar on a phone
/// (owner, 2026-10-06: nothing to choose at the top of a page). The period is
/// one of four, the shop one of a few dozen; each opens its own sheet.
function ScopeDock({
  scope,
  stores,
  storeFilter,
  storeName,
}: {
  scope: ReportScope
  stores: readonly { site_id: string; name: string }[]
  storeFilter: boolean
  storeName: string | undefined
}) {
  const dock = useDock()
  const [open, setOpen] = useState<"term" | "store" | null>(null)
  const term = TERMS.find((one) => one.value === scope.term)
  const chip =
    "inline-flex h-9 min-w-0 items-center gap-1 rounded-full bg-soft-2 pr-2.5 pl-3.5 text-[0.9375rem] font-medium text-ink transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97]"

  const rows = <T extends string | undefined>(
    options: readonly { value: T; label: string }[],
    current: T,
    pick: (value: T) => void
  ) => (
    <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-3">
      {options.map((one) => {
        const on = one.value === current
        return (
          <button
            key={one.label}
            type="button"
            aria-pressed={on}
            onClick={() => {
              pick(one.value)
              setOpen(null)
            }}
            className={cn(SHEET_ROW, on && "font-medium text-accent")}
          >
            <span className="flex-1">{one.label}</span>
            <Check className={cn("size-4 shrink-0", on ? "" : "opacity-0")} />
          </button>
        )
      })}
    </div>
  )

  return (
    <>
      <DockPortal slot="tabs">
        <div className="flex min-w-0 gap-1.5">
          <button
            type="button"
            onClick={() => setOpen("term")}
            aria-haspopup="dialog"
            aria-label={`Period: ${term?.label ?? ""}`}
            className={cn(chip, "shrink-0")}
          >
            <span className="truncate">{term?.label}</span>
            <ChevronDown className="size-4 shrink-0 text-line-ico" />
          </button>
          {storeFilter && (
            <button
              type="button"
              onClick={() => setOpen("store")}
              aria-haspopup="dialog"
              aria-label={`Store: ${storeName ?? "All stores"}`}
              className={chip}
            >
              <Store className="size-4 shrink-0 text-line-ico" />
              <span className="truncate">{storeName ?? "All stores"}</span>
              <ChevronDown className="size-4 shrink-0 text-line-ico" />
            </button>
          )}
        </div>
      </DockPortal>
      {dock?.available === true && (
        <>
          <BottomSheet
            open={open === "term"}
            onOpenChange={(next) => !next && setOpen(null)}
            title="Period"
          >
            {rows(TERMS, scope.term, scope.setTerm)}
          </BottomSheet>
          {storeFilter && (
            <BottomSheet
              open={open === "store"}
              onOpenChange={(next) => !next && setOpen(null)}
              title="Store"
            >
              {rows<string | undefined>(
                [
                  { value: undefined, label: "All stores" },
                  ...stores.map((place) => ({
                    value: place.site_id,
                    label: place.name,
                  })),
                ],
                scope.store,
                scope.setStore
              )}
            </BottomSheet>
          )}
        </>
      )}
    </>
  )
}

// ── cards ───────────────────────────────────────────────────────────────────

export function Head({
  title,
  sub,
  to,
  link,
  children,
}: {
  title: string
  sub?: React.ReactNode
  /// A page in this report that reads the same figures in full.
  to?: string
  link?: string
  children?: React.ReactNode
}) {
  return (
    <CardHeader className="items-start px-[1.125rem] pt-4 pb-3 max-md:flex-wrap">
      <div className="min-w-0">
        <CardTitle>{title}</CardTitle>
        {sub !== undefined && (
          <p className="mt-[0.1875rem] text-[0.9375rem] text-body">{sub}</p>
        )}
      </div>
      {children}
      {to !== undefined && (
        <Link
          to={to as LinkProps["to"]}
          // The period and the shop travel with the reader; nothing else on
          // this page's URL means anything on the next one.
          search={
            ((prev: { term?: string; store?: string }) => ({
              term: prev.term,
              store: prev.store,
            })) as never
          }
          className="inline-flex shrink-0 items-center gap-1 text-[0.9375rem] font-medium whitespace-nowrap text-accent hover:underline"
        >
          {link}
          <ArrowRight className="size-3" />
        </Link>
      )}
    </CardHeader>
  )
}

/// A label and a figure on one line, hairline between rows — the shape a
/// statement is read in.
export function Line({
  label,
  value,
  strong = false,
  aside,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  strong?: boolean
  aside?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 border-t border-hairline py-2 text-[0.9375rem] first:border-t-0",
        strong ? "font-semibold text-ink" : "text-text",
        className
      )}
    >
      <span className="min-w-0">{label}</span>
      <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
        {aside !== undefined && (
          <span className="text-[0.9375rem] font-normal text-mute">
            {aside}
          </span>
        )}
        {value}
      </span>
    </div>
  )
}

/// A horizontal bar with its label and figure, for "how is this split".
export function Bar({
  label,
  value,
  share,
  tone = "accent",
}: {
  label: React.ReactNode
  value: React.ReactNode
  /// 0–1 of the widest bar in the set.
  share: number
  tone?: "accent" | "warn" | "bad" | "mute"
}) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_5.5rem] items-center gap-3 py-1.5 text-[0.9375rem]">
      <span className="truncate text-body">{label}</span>
      <span className="h-2 overflow-hidden rounded-[3px] bg-soft-2">
        <span
          className={cn(
            "block h-full rounded-[3px]",
            tone === "accent" && "bg-accent",
            tone === "warn" && "bg-warn",
            tone === "bad" && "bg-bad",
            tone === "mute" && "bg-hairline-strong"
          )}
          style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }}
        />
      </span>
      <span className="text-right text-ink tabular-nums">{value}</span>
    </div>
  )
}
