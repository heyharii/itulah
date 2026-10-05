import { Link, type LinkProps } from "@tanstack/react-router"
import { ArrowRight, Store } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { CardHeader, CardTitle } from "@/components/ui/card"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { ChoiceMenu } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
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
    return <span className="font-normal text-mute">vs periode lalu —</span>
  }
  return (
    <>
      <span aria-hidden>{fraction > 0 ? "↗" : fraction < 0 ? "↘" : "→"}</span>
      {percent(Math.abs(fraction))}
      <span className="ml-1 font-normal text-mute">vs periode lalu</span>
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
  const { places, nameOf } = usePlaces(scope)
  const stores = places.filter((place) => place.kind === "STORE")

  return (
    <PageContent>
      <PageHeader crumb="Executive" title={title} className="mb-4" />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Segmented
          options={TERMS}
          value={scope.term}
          onChange={scope.setTerm}
        />
        {storeFilter && (
          <ChoiceMenu
            heading="Toko"
            icon={Store}
            value={scope.store ?? null}
            options={[
              { value: null, label: "Semua toko" },
              ...stores.map((place) => ({
                value: place.site_id,
                label: place.name,
              })),
            ]}
            onChange={(value) => scope.setStore(value ?? undefined)}
            className="border border-hairline-2 bg-canvas"
          />
        )}
        <span className="w-full text-[0.875rem] text-mute md:ml-auto md:w-auto">
          {scope.label}
          {storeFilter &&
            scope.store !== undefined &&
            ` · ${nameOf(scope.store)}`}
          <span className="text-faint"> · dibanding </span>
          {scope.beforeLabel}
        </span>
      </div>

      {children}
    </PageContent>
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
    <CardHeader className="items-start px-[1.125rem] pt-4 pb-3">
      <div className="min-w-0">
        <CardTitle>{title}</CardTitle>
        {sub !== undefined && (
          <p className="mt-[0.1875rem] text-[0.875rem] text-body">{sub}</p>
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
          className="inline-flex shrink-0 items-center gap-1 text-[0.875rem] font-medium whitespace-nowrap text-accent hover:underline"
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
        "flex items-baseline justify-between gap-3 border-t border-hairline py-2 text-[0.875rem] first:border-t-0",
        strong ? "font-semibold text-ink" : "text-text",
        className
      )}
    >
      <span className="min-w-0">{label}</span>
      <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
        {aside !== undefined && (
          <span className="text-[0.875rem] font-normal text-mute">{aside}</span>
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
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_5.5rem] items-center gap-3 py-1.5 text-[0.875rem]">
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
