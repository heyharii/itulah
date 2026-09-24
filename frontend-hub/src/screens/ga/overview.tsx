import { useQuery } from "@tanstack/react-query"
import { ChevronRight } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { day } from "@/lib/format"
import { gaKeys, gaOverview } from "@/lib/queries/ga"
import { queryState } from "@/lib/query-state"
import type { GaAttention } from "@itulah/contract"

/// What GA wants somebody to look at, and nothing else.
///
/// # Why every row is a link
///
/// Because a list of things to do that cannot be acted on is a report. Each
/// row carries the record's own id in the URL — `?asset=…` on the register —
/// so the thing opens where it is worked on, and the address can be sent to
/// somebody. There is no editing here and no second copy of any record: this
/// screen reads, and every act happens on the record's own screen.
///
/// # Why an empty screen says nothing at all
///
/// Because "nothing is expiring" is only reassuring if the screen was able to
/// ask. A section that has not been built yet is not drawn, and a section that
/// has been asked and is empty says so in the header's own count rather than
/// with an empty box per heading — six empty boxes is a screen that reads as
/// broken.
export function GaOverviewScreen() {
  const overview = useQuery({
    queryKey: gaKeys.overview(),
    queryFn: ({ signal }) => gaOverview(signal),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="GA"
        title="Overview"
        sub="Kontrak yang mau habis, dokumen yang kedaluwarsa, servis yang jatuh tempo, perbaikan dan permintaan yang menunggu."
      />

      {queryState(overview, {
        loading: "Membaca apa yang perlu dilihat…",
        render: (page) => {
          const sections = [
            {
              key: "draft_assets",
              title: "Aset draft",
              note: "Tagihannya datang lebih dulu. Barangnya sudah ada; lokasi dan pemegangnya belum.",
              to: "/assets" as const,
              rows: page.draft_assets,
            },
          ].filter((section) => section.rows.length > 0)

          if (sections.length === 0) {
            return (
              <Card>
                <EmptyState>
                  {`Tidak ada yang menunggu per hari ${day(page.generated_on)}. Kontrak, dokumen, jadwal servis dan perbaikan muncul di sini begitu tanggalnya mendekat.`}
                </EmptyState>
              </Card>
            )
          }

          return (
            <div className="flex flex-col gap-4">
              {sections.map((section) => (
                <Card key={section.key} className="overflow-hidden">
                  <div className="flex items-baseline justify-between gap-3 border-b border-hairline bg-soft px-3.5 py-2.5">
                    <b className="text-card-title font-semibold text-ink">
                      {section.title}
                    </b>
                    <span className="text-pill text-mute">
                      {section.rows.length}
                    </span>
                  </div>
                  {section.rows.map((row) => (
                    <AttentionLine
                      key={`${row.kind}:${row.id}`}
                      row={row}
                      to={section.to}
                    />
                  ))}
                  <p className="px-3.5 py-2 text-pill text-mute">
                    {section.note}
                  </p>
                </Card>
              ))}
            </div>
          )
        },
      })}
    </PageContent>
  )
}

/// One row, and the record it names.
///
/// The date is on the right and in the same weight as everything else: it is
/// what put the row here, not a figure to compare. The label leads, because
/// that is what somebody recognises — "AC cassette 5 PK" is the thing, and the
/// asset number under it is how they check they have the right one.
function AttentionLine({
  row,
  to,
}: {
  row: GaAttention
  to: "/assets"
}) {
  return (
    <AppLink
      to={to}
      className="flex items-center gap-3 border-b border-hairline px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-soft"
    >
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
        <span className="shrink-0 text-pill text-mute tabular-nums">
          {day(row.on)}
        </span>
      )}
      <ChevronRight className="size-4 shrink-0 stroke-[1.7] text-faint" />
    </AppLink>
  )
}
