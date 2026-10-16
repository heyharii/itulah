import { useSuspenseQuery } from "@tanstack/react-query"
import {
  Boxes,
  CalendarDays,
  ChevronRight,
  FileText,
  Hammer,
  Package,
  Repeat,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { Suspense } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { day } from "@/lib/format"
import { gaOverviewQuery } from "@/lib/queries/ga"
import type { SheetKey } from "@/lib/sheets"
import type { GaAttention } from "@itulah/contract"

/// One place to see what needs a GA decision or follow-up.
export function GaOverviewScreen() {
  return (
    <PageContent>
      <PageHeader
        crumb="GA"
        title="Overview"
        sub="Things that need review or follow-up."
      />

      <Suspense fallback={<LoadingState>Loading GA overview…</LoadingState>}>
        <GaAttentionList />
      </Suspense>
    </PageContent>
  )
}

function GaAttentionList() {
  const { data: page } = useSuspenseQuery(gaOverviewQuery())
  const sections: AttentionSection[] = [
    {
      key: "expiring_contracts",
      title: "Contract renewals",
      note: "Renew or close contracts that need attention.",
      icon: CalendarDays,
      rows: page.expiring_contracts ?? [],
    },
    {
      key: "expiring_documents",
      title: "Document renewals",
      note: "Prepare documents that need renewing.",
      icon: FileText,
      rows: page.expiring_documents,
    },
    {
      key: "draft_assets",
      title: "Assets needing details",
      note: "Fill in the asset's area and holder.",
      icon: Boxes,
      rows: page.draft_assets,
    },
    {
      key: "due_maintenance",
      title: "Service schedule",
      note: "Service that's due soon or overdue.",
      icon: Wrench,
      rows: page.due_maintenance,
    },
    {
      key: "open_repairs",
      title: "Repairs in progress",
      note: "Follow through until the repair is done.",
      icon: Hammer,
      rows: page.open_repairs,
    },
    {
      key: "replacements",
      title: "Asset replacements",
      note: "Track the asset replacement process.",
      icon: Repeat,
      rows: page.replacements,
    },
    {
      key: "supply_requests",
      title: "New supply requests",
      note: "Review newly submitted requests.",
      icon: Package,
      rows: page.supply_requests ?? [],
    },
  ].filter((section) => section.rows.length > 0)

  const total = sections.reduce(
    (count, section) => count + section.rows.length,
    0
  )

  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-soft px-4 py-3">
          <div>
            <p className="text-card-title font-semibold text-ink">
              Needs attention
            </p>
            <p className="mt-0.5 text-pill text-mute">
              Data as of {day(page.generated_on)}
            </p>
          </div>
          <span className="rounded-full border border-hairline bg-canvas px-3 py-1 text-meta font-semibold text-ink tabular-nums">
            {total} {total === 1 ? "item" : "items"} shown
          </span>
        </div>
      </Card>

      {sections.length === 0 ? (
        <Card>
          <EmptyState>
            {`Nothing needs attention as of ${day(page.generated_on)}.`}
          </EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {sections.map((section) => (
            <AttentionCard key={section.key} section={section} />
          ))}
        </div>
      )}
    </div>
  )
}

type AttentionSection = {
  key: string
  title: string
  note: string
  icon: LucideIcon
  rows: GaAttention[]
}

function AttentionCard({ section }: { section: AttentionSection }) {
  const Icon = section.icon

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 border-b border-hairline px-3.5 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-inner bg-soft text-line-ico">
          <Icon className="size-4 stroke-[1.7]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-card-title font-semibold break-words whitespace-normal text-ink">
            {section.title}
          </h2>
          <p className="mt-0.5 text-pill break-words whitespace-normal text-mute">
            {section.note}
          </p>
        </div>
        <span className="grid min-w-7 shrink-0 place-items-center rounded-full bg-soft px-2 py-1 text-pill font-semibold text-body tabular-nums">
          {section.rows.length}
        </span>
      </div>
      <div>
        {section.rows.map((row) => (
          <AttentionLine key={`${row.kind}:${row.id}`} row={row} />
        ))}
      </div>
    </Card>
  )
}

/// One row links straight to the record that needs attention.
function AttentionLine({ row }: { row: GaAttention }) {
  const target = destinationOf(row)
  const className =
    "flex min-h-11 items-center gap-3 border-b border-hairline px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-soft focus-visible:bg-soft"

  if (target === null) {
    return (
      <div className={className}>
        <AttentionText row={row} />
      </div>
    )
  }

  return (
    <AppLink to={target.to} sheet={target.sheet} className={className}>
      <AttentionText row={row} />
      <ChevronRight className="size-4 shrink-0 stroke-[1.7] text-faint" />
    </AppLink>
  )
}

function destinationOf(
  row: GaAttention
): { to: string; sheet?: { key: SheetKey; value: string } } | null {
  switch (row.kind) {
    case "asset":
      return { to: "/assets", sheet: { key: "asset", value: row.id } }
    case "contract":
      return {
        to: "/contracts",
        sheet: { key: "contract", value: row.id },
      }
    case "document":
      return { to: "/library", sheet: { key: "document", value: row.id } }
    case "repair":
      return { to: "/maintenance", sheet: { key: "repair", value: row.id } }
    case "replacement":
      return {
        to: "/maintenance/replacements",
        sheet: { key: "replacement", value: row.id },
      }
    case "task":
      return { to: "/maintenance/schedule" }
    case "supply_request":
      return { to: "/supplies", sheet: { key: "supply", value: row.id } }
    default:
      return null
  }
}

function AttentionText({ row }: { row: GaAttention }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-cell font-medium text-ink">
          {row.label}
        </span>
        {row.detail !== null && (
          <span className="block truncate text-pill text-mute">
            {row.detail}
          </span>
        )}
      </span>
      {row.on !== null && (
        <span className="shrink-0 rounded-full bg-soft px-2 py-1 text-pill text-body tabular-nums">
          {day(row.on)}
        </span>
      )}
    </>
  )
}
