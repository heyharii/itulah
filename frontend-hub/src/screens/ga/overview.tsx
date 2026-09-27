import { useQuery } from "@tanstack/react-query"
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

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { day } from "@/lib/format"
import { gaKeys, gaOverview } from "@/lib/queries/ga"
import { queryState } from "@/lib/query-state"
import type { SheetKey } from "@/lib/sheets"
import type { GaAttention } from "@itulah/contract"

/// One place to see what needs a GA decision or follow-up.
export function GaOverviewScreen() {
  const overview = useQuery({
    queryKey: gaKeys.overview(),
    queryFn: ({ signal }) => gaOverview(signal),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="GA"
        title="Ringkasan"
        sub="Hal yang perlu ditinjau atau ditindaklanjuti."
      />

      {queryState(overview, {
        loading: "Memuat ringkasan GA…",
        render: (page) => {
          const sections: AttentionSection[] = [
            {
              key: "expiring_contracts",
              title: "Perpanjangan kontrak",
              note: "Perpanjang atau tutup kontrak yang perlu perhatian.",
              icon: CalendarDays,
              rows: page.expiring_contracts ?? [],
            },
            {
              key: "expiring_documents",
              title: "Pembaruan dokumen",
              note: "Siapkan dokumen yang perlu diperpanjang.",
              icon: FileText,
              rows: page.expiring_documents,
            },
            {
              key: "draft_assets",
              title: "Aset belum dilengkapi",
              note: "Lengkapi lokasi dan pemegang aset.",
              icon: Boxes,
              rows: page.draft_assets,
            },
            {
              key: "due_maintenance",
              title: "Jadwal servis",
              note: "Servis yang segera jatuh tempo atau terlewat.",
              icon: Wrench,
              rows: page.due_maintenance,
            },
            {
              key: "open_repairs",
              title: "Perbaikan berjalan",
              note: "Lanjutkan sampai perbaikan selesai.",
              icon: Hammer,
              rows: page.open_repairs,
            },
            {
              key: "replacements",
              title: "Penggantian aset",
              note: "Pantau proses penggantian aset.",
              icon: Repeat,
              rows: page.replacements,
            },
            {
              key: "supply_requests",
              title: "Permintaan barang baru",
              note: "Tinjau permintaan yang baru diajukan.",
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
                      Perlu ditindaklanjuti
                    </p>
                    <p className="mt-0.5 text-pill text-mute">
                      Data per {day(page.generated_on)}
                    </p>
                  </div>
                  <span className="rounded-full border border-hairline bg-canvas px-3 py-1 text-meta font-semibold text-ink tabular-nums">
                    {total} item terlihat
                  </span>
                </div>
              </Card>

              {sections.length === 0 ? (
                <Card>
                  <EmptyState>
                    {`Belum ada hal yang perlu ditindaklanjuti per ${day(page.generated_on)}.`}
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
        },
      })}
    </PageContent>
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
        to: "/contracts/sewa",
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
