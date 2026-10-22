import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import {
  Boxes,
  CalendarDays,
  ChevronRight,
  FileOutput,
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
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { count, day } from "@/lib/format"
import { assetClassesQuery } from "@/lib/queries/finance"
import {
  gaContractTypes,
  gaKeys,
  gaOverviewQuery,
  useGaSites,
} from "@/lib/queries/ga"
import { useSheet, type SheetKey } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import {
  replacementStageWords,
  repairStageWords,
} from "@/screens/maintenance/format"
import { OriginalSheet } from "@/screens/workplace/original-sheets"
import type { GaAttention, GaOverview } from "@itulah/contract"

/// One place to see what needs a GA decision or follow-up.
///
/// # A to-do list, said in words
///
/// Eight sections, each a question GA is asked on a different clock — a
/// contract running out, a paper in somebody's hands, a service that was due,
/// a repair nobody finished — and each shows only while it has rows. The strip
/// over them counts the four a person comes here for and scrolls to them; the
/// rows themselves never print what the server stores. The server writes a
/// row's second line as "IN_PROGRESS · AC split toko 01" or "store-01"
/// because it cannot know the hub's words, so the screen turns each part
/// into the word the rest of the hub uses: "In progress", "Store 01", the
/// contract type's name.
export function GaOverviewScreen() {
  // An original that is out opens here, as it does in Files: the same sheet,
  // kept in the address.
  const original = useSheet("original")
  return (
    <PageContent>
      <PageHeader title="Overview" small />

      <Suspense fallback={<LoadingState>Loading GA overview…</LoadingState>}>
        <GaAttentionList onOpenOriginal={original.open} />
      </Suspense>

      <OriginalSheet
        originalId={original.value}
        open={original.isOpen}
        onClose={original.close}
      />
    </PageContent>
  )
}

/// The overview answers with `originals_out` since migration 0974; the
/// generated type has not caught up with it yet (`make contract`), so it is
/// read through this one cast.
type WithOriginals = GaOverview & { originals_out?: GaAttention[] }

/// One section: a question, the rows that answer it, and how its date reads.
type AttentionSection = {
  key: string
  title: string
  icon: LucideIcon
  rows: GaAttention[]
  /// What the date at the right of a row is: "Ends", "Due", "Reported".
  dateWord: string
  /// A deadline: a date before today is late and is drawn in the bad colour.
  /// The date of something that already happened is not.
  deadline: boolean
  /// A section whose rows open a sheet of their own rather than another
  /// screen.
  onOpen?: (row: GaAttention) => void
}

/// Where the strip's figures go, and what each counts.
const STRIP: readonly {
  label: string
  sections: readonly string[]
}[] = [
  { label: "Renewals", sections: ["expiring_contracts", "expiring_documents"] },
  { label: "Originals out", sections: ["originals_out"] },
  { label: "Service due", sections: ["due_maintenance"] },
  { label: "Open repairs", sections: ["open_repairs"] },
]

const sectionId = (key: string) => `ga-section-${key}`

/// Scroll a section up under the head. Reduced motion jumps.
function scrollToSection(key: string) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  document
    .getElementById(sectionId(key))
    ?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
}

function GaAttentionList({
  onOpenOriginal,
}: {
  onOpenOriginal: (originalId: string) => void
}) {
  const { data: page } = useSuspenseQuery(gaOverviewQuery())
  const words = useWords(page)

  const all: AttentionSection[] = [
    {
      key: "expiring_contracts",
      title: "Contract renewals",
      icon: CalendarDays,
      rows: page.expiring_contracts ?? [],
      dateWord: "Ends",
      deadline: true,
    },
    {
      key: "expiring_documents",
      title: "Document renewals",
      icon: FileText,
      rows: page.expiring_documents,
      dateWord: "Expires",
      deadline: true,
    },
    {
      key: "originals_out",
      title: "Originals out",
      icon: FileOutput,
      rows: (page as WithOriginals).originals_out ?? [],
      dateWord: "Back by",
      deadline: true,
      // Each opens its sheet, where the original is taken back; a row past its
      // day says so in its date.
      onOpen: (row: GaAttention) => onOpenOriginal(row.id),
    },
    {
      key: "draft_assets",
      title: "Assets needing details",
      icon: Boxes,
      rows: page.draft_assets,
      dateWord: "Registered",
      deadline: false,
    },
    {
      key: "due_maintenance",
      title: "Service schedule",
      icon: Wrench,
      rows: page.due_maintenance,
      dateWord: "Due",
      deadline: true,
    },
    {
      key: "open_repairs",
      title: "Repairs in progress",
      icon: Hammer,
      rows: page.open_repairs,
      dateWord: "Reported",
      deadline: false,
    },
    {
      key: "replacements",
      title: "Asset replacements",
      icon: Repeat,
      rows: page.replacements,
      dateWord: "Proposed",
      deadline: false,
    },
    {
      key: "supply_requests",
      title: "New supply requests",
      icon: Package,
      rows: page.supply_requests ?? [],
      dateWord: "Needed by",
      deadline: true,
    },
  ]
  const sections = all.filter((section) => section.rows.length > 0)
  const rowsOf = (keys: readonly string[]) =>
    all
      .filter((section) => keys.includes(section.key))
      .reduce((sum, section) => sum + section.rows.length, 0)

  if (sections.length === 0) {
    return (
      <Card>
        <EmptyState>
          {`Nothing needs attention as of ${day(page.generated_on)}.`}
        </EmptyState>
      </Card>
    )
  }

  return (
    <>
      <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
        {STRIP.map((figure) => {
          const n = rowsOf(figure.sections)
          // The first of its sections that has rows: that is where the figure
          // goes. A figure of nothing has nowhere to go.
          const target = sections.find((section) =>
            figure.sections.includes(section.key)
          )
          return (
            <Kpi
              key={figure.label}
              label={figure.label}
              value={count(n)}
              onClick={
                target === undefined
                  ? undefined
                  : () => scrollToSection(target.key)
              }
            />
          )
        })}
      </KpiStrip>

      {/* The last row has to clear the account bubble that floats at the
          bottom right of a phone, and the dock under it: its date is the one
          thing a row says at the right. */}
      <div className="flex flex-col gap-3 max-md:pb-20">
        {sections.map((section) => (
          <AttentionCard
            key={section.key}
            section={section}
            words={words}
            today={page.generated_on}
          />
        ))}
      </div>
    </>
  )
}

/// The words the server's second lines are turned into: the site's name for
/// its id, the contract type's name for its code, the asset class's for its
/// code. Each is read once beside the page and the rows draw as they are until
/// it arrives; a role that cannot read one keeps the stored word, made
/// readable.
interface Words {
  readonly part: (part: string, kind: string, index: number) => string
}

function useWords(page: GaOverview): Words {
  const needsTypes = (page.expiring_contracts ?? []).length > 0
  const needsClasses = page.draft_assets.length > 0
  const { sites } = useGaSites()
  const types = useQuery({
    queryKey: gaKeys.contractTypes(null),
    queryFn: ({ signal }) => gaContractTypes(null, signal),
    staleTime: Infinity,
    enabled: needsTypes,
    retry: false,
  })
  const classes = useQuery({
    ...assetClassesQuery(),
    enabled: needsClasses,
    retry: false,
  })

  const siteNames = new Map(
    sites.map((one) => [one.value.toLowerCase(), one.label])
  )
  const typeNames = new Map(
    (types.data ?? []).map((one) => [one.code, one.name])
  )
  const classNames = new Map(
    (classes.data?.classes ?? []).map((one) => [
      one.class_code,
      one.name_en ?? one.name,
    ])
  )

  return {
    part: (part, kind, index) => {
      const site = siteNames.get(part.toLowerCase())
      if (site !== undefined) return site
      if (index === 0 && kind === "contract" && typeNames.has(part))
        return typeNames.get(part)!
      if (index === 0 && kind === "asset" && classNames.has(part))
        return classNames.get(part)!
      return storedWord(part, kind, index)
    },
  }
}

/// A word the server stores, in the hub's own. Only the FIRST part of a line
/// is ever a stored word ("IN_PROGRESS · AC split toko 01"): a stage is its
/// stage's word, a paper's type is English, a contract type's or an asset
/// class's code is sentence case when the name is not to hand. Every other
/// part is already words — a name, an asset, a reason — and is left alone.
function storedWord(part: string, kind: string, index: number): string {
  if (index !== 0) return part
  if (kind === "repair" && REPAIR_STAGES.has(part))
    return repairStageWords(part)
  if (kind === "replacement" && REPLACEMENT_STAGES.has(part))
    return replacementStageWords(part)
  if (kind === "document") return PAPER_WORDS[part] ?? part
  if (
    (kind === "contract" || kind === "asset") &&
    /^[A-Z][A-Z0-9_]+$/.test(part)
  ) {
    const words = part.toLowerCase().replaceAll("_", " ")
    return words.charAt(0).toUpperCase() + words.slice(1)
  }
  return part
}

const REPAIR_STAGES: ReadonlySet<string> = new Set([
  "OPEN",
  "APPROVED",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED",
  "CANCELLED",
])

const REPLACEMENT_STAGES: ReadonlySet<string> = new Set([
  "PROPOSED",
  "APPROVED",
  "PURCHASED",
  "INSTALLED",
  "CLOSED",
])

/// How the stored types of paper read in English. The ones the register has a
/// word for (BPKB, STNK, KIR) are already the word.
const PAPER_WORDS: Readonly<Record<string, string>> = {
  Kontrak: "Contract",
  Sertifikat: "Certificate",
  Polis: "Policy",
  Garansi: "Warranty",
}

/// A row's second line, part by part: "IN_PROGRESS · AC split toko 01 (lama)"
/// is "In progress · AC split toko 01 (lama)".
function detailOf(row: GaAttention, words: Words): string | null {
  if (row.detail === null || row.detail === "") return null
  return row.detail
    .split(" · ")
    .map((part, index) => words.part(part, row.kind, index))
    .join(" · ")
}

function AttentionCard({
  section,
  words,
  today,
}: {
  section: AttentionSection
  words: Words
  today: string
}) {
  const Icon = section.icon

  return (
    <Card id={sectionId(section.key)} className="scroll-mt-24 overflow-hidden">
      <div className="flex items-center gap-3 border-b border-hairline px-3.5 py-3">
        <span className="grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-soft-2 text-body">
          <Icon className="size-4 stroke-[1.7]" aria-hidden="true" />
        </span>
        <h2 className="min-w-0 flex-1 text-card-title font-semibold break-words whitespace-normal text-ink">
          {section.title}
        </h2>
        <span className="text-[0.9375rem] text-mute tabular-nums">
          {count(section.rows.length)}
        </span>
      </div>
      <div>
        {section.rows.map((row) => (
          <AttentionLine
            key={`${row.kind}:${row.id}`}
            row={row}
            second={detailOf(row, words)}
            when={
              row.on === null
                ? null
                : {
                    word: section.dateWord,
                    date: day(row.on),
                    late: section.deadline && row.on < today,
                  }
            }
            onOpen={section.onOpen}
          />
        ))}
      </div>
    </Card>
  )
}

/// A row's date, said with what it is: "Ends" "31 Dec 2026". Late when it is a
/// deadline already gone by.
interface When {
  word: string
  date: string
  late: boolean
}

/// One row links straight to the record that needs attention.
function AttentionLine({
  row,
  second,
  when,
  onOpen,
}: {
  row: GaAttention
  second: string | null
  when: When | null
  onOpen?: (row: GaAttention) => void
}) {
  const target = destinationOf(row)
  const className =
    "flex min-h-11 items-center gap-3 border-b border-hairline px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-soft focus-visible:bg-soft"
  const text = <AttentionText row={row} second={second} when={when} />

  if (onOpen !== undefined) {
    return (
      <button
        type="button"
        onClick={() => onOpen(row)}
        className={cn(className, "w-full text-left")}
      >
        {text}
        <ChevronRight className="size-4 shrink-0 stroke-[1.7] text-faint" />
      </button>
    )
  }

  if (target === null) {
    return <div className={className}>{text}</div>
  }

  return (
    <AppLink to={target.to} sheet={target.sheet} className={className}>
      {text}
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

function AttentionText({
  row,
  second,
  when,
}: {
  row: GaAttention
  second: string | null
  when: When | null
}) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-medium text-ink max-md:break-words md:truncate">
          {row.label}
        </span>
        {second !== null && (
          <span className="block text-[0.9375rem] text-mute max-md:break-words md:truncate">
            {second}
          </span>
        )}
      </span>
      {when !== null && (
        <span
          className={cn(
            "shrink-0 text-right text-[0.9375rem] tabular-nums md:whitespace-nowrap",
            when.late ? "text-bad-fg" : "text-body"
          )}
        >
          {/* On a phone the word and the day stand over each other, which
              gives the name the width a line of words needs. */}
          {when.word} <span className="max-md:block">{when.date}</span>
        </span>
      )}
    </>
  )
}
