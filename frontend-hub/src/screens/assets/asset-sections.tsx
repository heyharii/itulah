import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import {
  Activity,
  CalendarClock,
  ClipboardCheck,
  PackagePlus,
  Plus,
  RefreshCw,
  StickyNote,
  Trash2,
  Truck,
  UserRound,
  Wrench,
} from "lucide-react"

import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Status } from "@/components/ui/pill"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  SheetSection,
} from "@/components/ui/rows"
import { Fact, Facts } from "@/components/ui/sheet"
import { SheetEmpty, SheetQuery } from "@/components/ui/sheet-states"
import { today } from "@/lib/calendar"
import { EMPTY, count, day, quantity } from "@/lib/format"
import { buildOf } from "@/lib/builds"
import { openable, FOCUSED } from "@/lib/openable"
import { gaAssetBuilds, gaKeys } from "@/lib/queries/ga"
import { financeKeys, unitAccounts } from "@/lib/queries/finance"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { useUnits } from "@/lib/queries/organisation"
import type { GaOriginalRow, GaPaper } from "@/lib/queries/ga-records"
import { cn } from "@/lib/utils"
import {
  conditionWords,
  eventLine,
  everyWords,
  left,
  nextRenewal,
  nextService,
  openRepairs,
  taskDue,
} from "@/screens/assets/asset-words"
import { standingOf, useContractParty } from "@/screens/contracts/format"
import {
  disposalMethodWords,
  disposalStageWords,
  inspectionOf,
  repairStageWords,
  replacementStageWords,
} from "@/screens/maintenance/format"
import { CONTRACT_GROUPS } from "@/screens/contracts/groups"
import { originalWords, paperIcon } from "@/screens/workplace/original-sheets"
import type {
  GaAssetEvent,
  GaAssetRow,
  GaContractRow,
  GaDisposalPage,
  GaInspectionPage,
  GaMaintenanceTaskPage,
  GaRepairPage,
  GaReplacementPage,
} from "@itulah/contract"

/// The sections of the asset sheet below its head, one component each.
///
/// They are given their data already read (`UseQueryResult`s from the sheet)
/// and hand every click back as a callback, so the sheet owns what is open
/// over it and a section never decides which layer comes next.

// ── small parts ─────────────────────────────────────────────────────────────

/// A section's action at its heading: accent words, no box. The one blue
/// SOLID thing on the sheet is the foot's primary, so these are plain text.
export function TextAction({
  onClick,
  children,
  "aria-label": label,
}: {
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
  "aria-label"?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-inner text-[0.9375rem] font-medium text-accent transition-[opacity,scale] duration-(--t-press) ease-(--ease-out) hover:opacity-80 active:scale-[0.97] max-md:min-h-tap pointer-coarse:min-h-tap [&_svg]:size-4 [&_svg]:text-accent"
    >
      {children}
    </button>
  )
}

/// What stands at the right end of a section's heading: its count, then its
/// actions.
export function SectionAside({
  total,
  children,
}: {
  total?: number | string
  children?: React.ReactNode
}) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
      {total !== undefined && (
        <span className="text-mute tabular-nums">
          {typeof total === "number" ? count(total) : total}
        </span>
      )}
      {children}
    </span>
  )
}

/// A row of a `MiniTable` that opens a record: the row itself is the target
/// (`openable`), so nothing inside it is blue. A row with nothing to open is a
/// plain `MiniRow`.
export function OpenRow({
  onOpen,
  children,
}: {
  onOpen?: () => void
  children: React.ReactNode
}) {
  if (onOpen === undefined) return <MiniRow>{children}</MiniRow>
  return (
    <tr
      className={cn("cursor-pointer border-t border-hairline", FOCUSED)}
      onClick={onOpen}
      {...openable(onOpen)}
    >
      {children}
    </tr>
  )
}

/// The first cell of a row: the line's name in ink and a quiet line under it.
export function NameCell({
  name,
  quiet,
  icon: Glyph,
  children,
}: {
  name: React.ReactNode
  quiet?: React.ReactNode
  /// What kind of thing the row is — a fuel pump, a policy, a wrench — so
  /// the eye sorts a section before it reads it. The same tile the form's
  /// choices wear, so a row looks like the choice that made it.
  icon?: React.ComponentType<{ className?: string }>
  /// Lines under the name that are not the quiet line (an original's custody).
  children?: React.ReactNode
}) {
  const text = (
    <>
      <span className="block font-medium text-ink">{name}</span>
      {quiet !== undefined && quiet !== null && quiet !== "" && (
        <span className="block font-normal text-mute">{quiet}</span>
      )}
      {children}
    </>
  )
  if (Glyph === undefined) return text
  // One line sits level with its tile; more lines hang from the tile's top.
  const single =
    (quiet === undefined || quiet === null || quiet === "") &&
    children === undefined
  return (
    <span
      className={cn(
        "flex min-w-0 gap-3",
        single ? "items-center" : "items-start"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-soft-2 text-body",
          !single && "mt-px"
        )}
      >
        <Glyph className="size-4 stroke-[1.7]" />
      </span>
      <span className="min-w-0 flex-1">{text}</span>
    </span>
  )
}

function Caption({ total, children }: { total: number; children: string }) {
  return (
    <p className="mb-1 flex items-baseline gap-2 text-[0.9375rem] font-medium text-body">
      {children}
      <span className="font-normal text-mute tabular-nums">{count(total)}</span>
    </p>
  )
}

// ── figures ─────────────────────────────────────────────────────────────────

/// Condition · Next service · Open repairs · Next renewal. A figure that wants
/// somebody turns warm; nothing else on the strip is coloured.
export function AssetFigures({
  asset,
  tasks,
  repairs,
  contracts,
  odometer,
}: {
  asset: GaAssetRow
  tasks: GaMaintenanceTaskPage | undefined
  repairs: GaRepairPage | undefined
  contracts: readonly GaContractRow[] | undefined
  odometer: number | null
}) {
  const service = tasks === undefined ? null : nextService(tasks.rows, odometer)
  const open = repairs === undefined ? null : openRepairs(repairs.rows)
  const renewal = contracts === undefined ? null : nextRenewal(contracts)

  return (
    <KpiStrip className="mb-2!">
      <Kpi
        label="Condition"
        value={
          asset.condition === "RUSAK" ? (
            <span className="text-bad-fg">
              {conditionWords(asset.condition)}
            </span>
          ) : asset.condition === "PERLU_SERVIS" ? (
            <span className="text-warn-fg">
              {conditionWords(asset.condition)}
            </span>
          ) : (
            conditionWords(asset.condition)
          )
        }
      />
      <Kpi
        label="Next service"
        value={
          service === null ? (
            EMPTY
          ) : service.date !== null ? (
            service.late ? (
              <span className="text-bad-fg">{day(service.date)}</span>
            ) : (
              day(service.date)
            )
          ) : (
            (service.text ?? EMPTY)
          )
        }
      />
      <Kpi
        label="Open repairs"
        value={
          open === null ? (
            EMPTY
          ) : open > 0 ? (
            <span className="text-warn-fg">{count(open)}</span>
          ) : (
            count(open)
          )
        }
      />
      <Kpi
        label="Next renewal"
        value={
          renewal === null || renewal.date === null ? (
            EMPTY
          ) : renewal.late ? (
            <span className="text-bad-fg">{day(renewal.date)}</span>
          ) : (
            day(renewal.date)
          )
        }
      />
    </KpiStrip>
  )
}

// ── identity, location ──────────────────────────────────────────────────────

/// What the thing is: its kind and class, the build's own spec fields under
/// the labels the builds schema gives them, and where it came from.
export function IdentitySection({
  asset,
  odometer,
  onOpenOdometer,
}: {
  asset: GaAssetRow
  /// The vehicle's latest reading and its day (0975): the register's own
  /// figure is what it said when it was registered, and a car does not stand
  /// still.
  odometer: { km: number; on: string } | null
  /// Opens the readings layer; a vehicle only.
  onOpenOdometer?: () => void
}) {
  // The build's own field names, so a spec reads "Capacity" rather than
  // "capacity". The same cached list the register form uses — one fetch for
  // the whole app, because the eleven do not change.
  const schema = useQuery({
    queryKey: gaKeys.builds(),
    queryFn: ({ signal }) => gaAssetBuilds(signal),
    staleTime: Infinity,
  })
  const fields = schema.data?.builds.find(
    (one) => one.build === asset.build
  )?.fields
  const build = buildOf(asset.build)
  // The register keeps a count for a lot of identical things; the contract
  // type has not caught up with the column yet.
  const lot = (asset as GaAssetRow & { quantity?: number | null }).quantity
  // The odometer reads from the readings when there are any; the register's
  // spec is the floor, what it said on the day it was registered.
  const odometerFact = (term: string, registered: number | null) => {
    const km = Math.max(registered ?? 0, odometer?.km ?? 0)
    const words =
      km > 0
        ? `${quantity(km, "km")}${odometer === null ? "" : ` · ${day(odometer.on)}`}`
        : "No reading yet"
    return (
      <Fact key="odometer" term={term}>
        {onOpenOdometer === undefined ? (
          words
        ) : (
          <button
            type="button"
            className="record-link text-left"
            onClick={onOpenOdometer}
          >
            {words}
          </button>
        )}
      </Fact>
    )
  }
  const specOdometer = Object.keys(asset.specs).some((key) => {
    const field = fields?.find((one) => one.key === key)
    return /^odo/i.test(key) || /odometer/i.test(field?.label ?? "")
  })

  return (
    <SheetSection title="Identity">
      <Facts>
        <Fact term="Kind">{build.label}</Fact>
        <Fact term="Class">{asset.class_name}</Fact>
        {Object.entries(asset.specs)
          .filter(([, value]) => value !== null && value !== "")
          .map(([key, value]) => {
            const field = fields?.find((one) => one.key === key)
            if (/^odo/i.test(key) || /odometer/i.test(field?.label ?? "")) {
              const registered = Number(String(value).replace(/\D/g, ""))
              return odometerFact(
                field?.label ?? key,
                Number.isFinite(registered) ? registered : null
              )
            }
            return (
              <Fact key={key} term={field?.label ?? key}>
                {field?.kind === "DATE" ? day(String(value)) : String(value)}
              </Fact>
            )
          })}
        {asset.build === "VEHICLE" &&
          !specOdometer &&
          odometerFact("Odometer", null)}
        {asset.serial_number !== null && asset.serial_number !== "" && (
          <Fact term="Serial">{asset.serial_number}</Fact>
        )}
        <Fact term="Acquired">{day(asset.acquired_on)}</Fact>
        <Fact term="Purchase bill">{asset.acquired_via ?? EMPTY}</Fact>
        {lot !== undefined && lot !== null && lot > 1 && (
          <Fact term="Quantity">{quantity(lot)}</Fact>
        )}
      </Facts>
    </SheetSection>
  )
}

export function LocationSection({
  asset,
  siteName,
  since,
}: {
  asset: GaAssetRow
  siteName: string
  /// The day it came to where it is, or to whom: the last move or handover.
  since: string | null
}) {
  return (
    <SheetSection title="Location & holder">
      <Facts>
        <Fact term="Site">{siteName}</Fact>
        <Fact term="Area">{asset.sub_location ?? EMPTY}</Fact>
        <Fact term="Holder">{asset.holder ?? EMPTY}</Fact>
        <Fact term="Since">{since === null ? EMPTY : day(since)}</Fact>
      </Facts>
    </SheetSection>
  )
}

// ── documents ───────────────────────────────────────────────────────────────

/// The papers about the asset, each with the originals that exist of it.
///
/// A paper is a document that may have no scan at all: the BPKB is a thing in
/// a safe, and the register only needs to say where. So the row says "No scan"
/// quietly, and the line under it says where the original is, or who has it.
export function DocumentsSection({
  papers,
  onOpenPaper,
  onOpenOriginal,
  onRelease,
  onReturn,
  onRecord,
  onUpload,
}: {
  papers: UseQueryResult<GaPaper[]>
  onOpenPaper: (documentId: string) => void
  onOpenOriginal: (originalId: string) => void
  onRelease: (original: GaOriginalRow) => void
  onReturn: (original: GaOriginalRow) => void
  onRecord: () => void
  onUpload: () => void
}) {
  return (
    <SheetSection
      title="Documents"
      aside={
        <SectionAside total={papers.data?.length}>
          <TextAction aria-label="Add paper" onClick={onRecord}>
            <Plus />
            Paper
          </TextAction>
          <TextAction onClick={onUpload}>Upload file</TextAction>
        </SectionAside>
      }
    >
      <SheetQuery query={papers} what="papers">
        {(rows) =>
          rows.length === 0 ? (
            <SheetEmpty>No papers yet.</SheetEmpty>
          ) : (
            <MiniTable head={["Paper", left("Valid until")]}>
              {rows.map((paper) => {
                const lapsed =
                  paper.expires_on !== null && paper.expires_on < today()
                return (
                  <OpenRow
                    key={paper.document_id}
                    onOpen={() => onOpenPaper(paper.document_id)}
                  >
                    <MiniCell>
                      <NameCell
                        icon={paperIcon(paper.doc_type)}
                        name={paper.title}
                        quiet={[
                          // Not twice: "BPKB · M-12345678" already says it.
                          paper.doc_number !== null &&
                          paper.title.includes(paper.doc_number)
                            ? null
                            : paper.doc_number,
                          paper.has_scan ? null : "No scan",
                        ]
                          .filter((part) => part !== null && part !== "")
                          .join(" · ")}
                      >
                        {paper.originals.map((original) => (
                          <OriginalLine
                            key={original.original_id}
                            original={original}
                            onOpen={onOpenOriginal}
                            onRelease={onRelease}
                            onReturn={onReturn}
                          />
                        ))}
                      </NameCell>
                    </MiniCell>
                    <MiniCell>
                      <span className={cn(lapsed && "text-bad-fg")}>
                        {paper.expires_on === null
                          ? "No expiry"
                          : day(paper.expires_on)}
                      </span>
                    </MiniCell>
                  </OpenRow>
                )
              })}
            </MiniTable>
          )
        }
      </SheetQuery>
    </SheetSection>
  )
}

/// One original under its paper: where it is, who has it, and the one verb
/// that moves it. Both stop the row's own click — they open their own record.
function OriginalLine({
  original,
  onOpen,
  onRelease,
  onReturn,
}: {
  original: GaOriginalRow
  onOpen: (originalId: string) => void
  onRelease: (original: GaOriginalRow) => void
  onReturn: (original: GaOriginalRow) => void
}) {
  const words = originalWords(original)
  const lead =
    original.kind === "CERTIFIED_COPY" ? "Certified copy" : "Original"
  const text = `${lead} · ${words.word}`
  const out = original.status === "OUT"
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-normal">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onOpen(original.original_id)
        }}
        className={cn(
          "min-w-0 rounded-inner text-left underline-offset-2 hover:underline max-md:min-h-tap pointer-coarse:min-h-tap",
          words.tone === "bad"
            ? "text-bad-fg"
            : words.tone === "warn"
              ? "text-warn-fg"
              : "text-mute"
        )}
      >
        {text}
      </button>
      <TextAction
        onClick={(event) => {
          event.stopPropagation()
          if (out) onReturn(original)
          else onRelease(original)
        }}
      >
        {out ? "Take back" : "Hand over"}
      </TextAction>
    </span>
  )
}

// ── contracts ───────────────────────────────────────────────────────────────

/// The contracts that name the asset: its insurance, its tax, its service.
export function ContractsSection({
  contracts,
  onOpen,
  onAdd,
}: {
  contracts: UseQueryResult<GaContractRow[]>
  onOpen: (contractId: string) => void
  onAdd: () => void
}) {
  const partyName = useContractParty()
  return (
    <SheetSection
      title="Contracts"
      aside={
        <SectionAside total={contracts.data?.length}>
          <TextAction aria-label="Add contract" onClick={onAdd}>
            <Plus />
            Contract
          </TextAction>
        </SectionAside>
      }
    >
      <SheetQuery query={contracts} what="contracts">
        {(rows) =>
          rows.length === 0 ? (
            <SheetEmpty>No contracts yet.</SheetEmpty>
          ) : (
            <MiniTable head={["Contract", left("Ends"), left("Status")]}>
              {rows.map((row) => {
                const standing = standingOf(row)
                return (
                  <OpenRow
                    key={row.contract_id}
                    onOpen={() => onOpen(row.contract_id)}
                  >
                    <MiniCell>
                      <NameCell
                        icon={
                          CONTRACT_GROUPS.find(
                            (group) => group.group_code === row.group_code
                          )?.icon
                        }
                        name={row.contract_type_name}
                        quiet={[partyName(row), row.contract_number]
                          .filter(
                            (part): part is string =>
                              part !== null && part !== EMPTY
                          )
                          .join(" · ")}
                      />
                    </MiniCell>
                    <MiniCell>
                      {row.ends_on === null ? "No end" : day(row.ends_on)}
                    </MiniCell>
                    <MiniCell>
                      <Status tone={standing.tone}>{standing.word}</Status>
                    </MiniCell>
                  </OpenRow>
                )
              })}
            </MiniTable>
          )
        }
      </SheetQuery>
    </SheetSection>
  )
}

// ── schedule and inspections ────────────────────────────────────────────────

const RESULT_TONE = { BAIK: "ok", PERHATIAN: "warn", RUSAK: "bad" } as const

export function ScheduleSection({
  tasks,
  inspections,
  odometer,
  onAddTask,
  onAddInspection,
}: {
  tasks: UseQueryResult<GaMaintenanceTaskPage>
  inspections: UseQueryResult<GaInspectionPage>
  odometer: number | null
  onAddTask: () => void
  onAddInspection: () => void
}) {
  return (
    <SheetSection
      title="Routine service & inspections"
      aside={
        <SectionAside>
          <TextAction aria-label="Add task" onClick={onAddTask}>
            <Plus />
            Task
          </TextAction>
          <TextAction aria-label="Add inspection" onClick={onAddInspection}>
            <Plus />
            Inspection
          </TextAction>
        </SectionAside>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <Caption total={tasks.data?.rows.length ?? 0}>Tasks</Caption>
          <SheetQuery query={tasks} what="schedule">
            {(page) =>
              page.rows.length === 0 ? (
                <SheetEmpty>No recurring task yet.</SheetEmpty>
              ) : (
                <MiniTable head={["Task", left("Every"), left("Next due")]}>
                  {page.rows.map((task) => {
                    const due = taskDue(task, odometer)
                    return (
                      <MiniRow key={task.task_id}>
                        <MiniCell>
                          <NameCell
                            icon={CalendarClock}
                            name={task.title}
                            quiet={task.contract_number}
                          />
                        </MiniCell>
                        <MiniCell>
                          {everyWords(task.interval_kind, task.interval_value)}
                        </MiniCell>
                        <MiniCell>
                          <span className={cn(due.late && "text-bad-fg")}>
                            {/^\d{4}-\d{2}-\d{2}$/.test(due.text)
                              ? day(due.text)
                              : due.text}
                          </span>
                        </MiniCell>
                      </MiniRow>
                    )
                  })}
                </MiniTable>
              )
            }
          </SheetQuery>
        </div>
        <div>
          <Caption total={inspections.data?.rows.length ?? 0}>
            Inspections
          </Caption>
          <SheetQuery query={inspections} what="inspections">
            {(page) =>
              page.rows.length === 0 ? (
                <SheetEmpty>No inspection yet.</SheetEmpty>
              ) : (
                <MiniTable head={["Date", left("Findings"), left("Result")]}>
                  {page.rows.map((row) => (
                    <MiniRow key={row.inspection_id}>
                      <MiniCell>
                        <NameCell
                          icon={ClipboardCheck}
                          name={day(row.inspected_on)}
                          quiet={row.inspected_by}
                        />
                      </MiniCell>
                      <MiniCell>{row.findings}</MiniCell>
                      <MiniCell>
                        <Status
                          tone={
                            RESULT_TONE[
                              row.result as keyof typeof RESULT_TONE
                            ] ?? "neutral"
                          }
                        >
                          {inspectionOf(row).label}
                        </Status>
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              )
            }
          </SheetQuery>
        </div>
      </div>
    </SheetSection>
  )
}

// ── repairs ─────────────────────────────────────────────────────────────────

function repairTone(
  status: string
): "warn" | "info" | "ok" | "bad" | "neutral" {
  switch (status) {
    case "OPEN":
      return "warn"
    case "APPROVED":
    case "IN_PROGRESS":
      return "info"
    case "COMPLETED":
      return "ok"
    case "CANCELLED":
      return "bad"
    default:
      return "neutral"
  }
}

export function RepairsSection({
  repairs,
  onOpen,
  onAdd,
}: {
  repairs: UseQueryResult<GaRepairPage>
  onOpen: (repairId: string) => void
  onAdd: () => void
}) {
  return (
    <SheetSection
      title="Repairs"
      aside={
        <SectionAside total={repairs.data?.rows.length}>
          <TextAction aria-label="Add repair" onClick={onAdd}>
            <Plus />
            Repair
          </TextAction>
        </SectionAside>
      }
    >
      <SheetQuery query={repairs} what="repairs">
        {(page) =>
          page.rows.length === 0 ? (
            <SheetEmpty>No repairs yet.</SheetEmpty>
          ) : (
            <MiniTable head={["Repair", left("Failed on"), left("Status")]}>
              {page.rows.map((row) => (
                <OpenRow
                  key={row.repair_id}
                  onOpen={() => onOpen(row.repair_id)}
                >
                  <MiniCell>
                    <NameCell
                      icon={Wrench}
                      name={row.title}
                      quiet={row.supplier_name}
                    />
                  </MiniCell>
                  <MiniCell>{day(row.failure_at)}</MiniCell>
                  <MiniCell>
                    <Status tone={repairTone(row.status)}>
                      {repairStageWords(row.status)}
                    </Status>
                  </MiniCell>
                </OpenRow>
              ))}
            </MiniTable>
          )
        }
      </SheetQuery>
    </SheetSection>
  )
}

// ── moves, replacement, disposal ────────────────────────────────────────────

interface Step {
  readonly key: string
  readonly on: string
  readonly what: string
  readonly sub: string | null
  readonly by: string
  readonly icon: React.ComponentType<{ className?: string }>
  readonly open?: () => void
}

/// The glyph of one line of an asset's own history.
const EVENT_ICON: Readonly<
  Record<string, React.ComponentType<{ className?: string }>>
> = {
  REGISTERED: PackagePlus,
  TRANSFER: Truck,
  ASSIGN: UserRound,
  CONDITION: Activity,
  NOTE: StickyNote,
}

/// Everything that happened to the asset as a thing: where it went, who held
/// it, what it was swapped for and whether it left. One list, newest first;
/// a replacement or a disposal opens its own record.
export function MovesSection({
  assetId,
  events,
  replacements,
  disposals,
  siteName,
  onOpenReplacement,
  onOpenDisposal,
}: {
  assetId: string
  events: readonly GaAssetEvent[]
  replacements: UseQueryResult<GaReplacementPage>
  disposals: UseQueryResult<GaDisposalPage>
  siteName: (siteId: string) => string
  onOpenReplacement?: (replacementId: string) => void
  onOpenDisposal?: (disposalId: string) => void
}) {
  const nameOf = useNameOfLogin()

  const steps: Step[] = [
    ...events.map((event): Step => {
      const line = eventLine(event, siteName)
      return {
        key: `event:${event.event_id}`,
        on: event.occurred_on,
        what: line.what,
        sub: line.sub,
        by: nameOf(event.recorded_by),
        icon: EVENT_ICON[event.kind] ?? StickyNote,
      }
    }),
    ...(replacements.data?.rows ?? []).map((row): Step => {
      const asOld = row.old_asset_id === assetId
      return {
        key: `replacement:${row.replacement_id}`,
        on: row.proposed_on,
        what: asOld
          ? row.new_asset_name === null
            ? "Replacement proposed"
            : `Replaced by ${row.new_asset_name}`
          : `Replaces ${row.old_asset_name}`,
        sub: `${replacementStageWords(row.status)} · ${row.reason}`,
        by: nameOf(row.created_by),
        icon: RefreshCw,
        open:
          onOpenReplacement === undefined
            ? undefined
            : () => onOpenReplacement(row.replacement_id),
      }
    }),
    ...(disposals.data?.rows ?? []).map((row): Step => ({
      key: `disposal:${row.disposal_id}`,
      on: row.requested_on,
      what: `Disposal · ${disposalMethodWords(row.method)}`,
      sub: `${disposalStageWords(row.status)} · ${row.reason}`,
      by: nameOf(row.created_by),
      icon: Trash2,
      open:
        onOpenDisposal === undefined
          ? undefined
          : () => onOpenDisposal(row.disposal_id),
    })),
  ].sort((a, b) => b.on.localeCompare(a.on))

  return (
    <SheetSection
      title="Moves, replacement & disposal"
      aside={<SectionAside total={steps.length} />}
    >
      {steps.length === 0 ? (
        <SheetEmpty>Nothing yet.</SheetEmpty>
      ) : (
        <MiniTable head={["Date", left("What"), left("By")]}>
          {steps.map((step) => (
            <OpenRow key={step.key} onOpen={step.open}>
              <MiniCell>{day(step.on)}</MiniCell>
              <MiniCell>
                <NameCell icon={step.icon} name={step.what} quiet={step.sub} />
              </MiniCell>
              <MiniCell>{step.by}</MiniCell>
            </OpenRow>
          ))}
        </MiniTable>
      )}
    </SheetSection>
  )
}

// ── class accounts ──────────────────────────────────────────────────────────

/// Which accounts this class posts to — Finance's decision, read here.
///
/// Read-only, and deliberately so: the class is GA's fact and the account is
/// Finance's, and a GA screen that could set one would be a GA screen that
/// could change the chart. It is the last section and draws only when there is
/// something to read: the asset stays at its site, and its accounts are the
/// books of the unit owning that site (0605).
/// "accumulated_depreciation" → "Accumulated depreciation".
function roleWords(role: string): string {
  const words = role.replace(/_/g, " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function AccountsSection({ asset }: { asset: GaAssetRow }) {
  const units = useUnits()
  const unit = (units.data ?? []).find((one) =>
    one.sites.some((premises) => premises.id === asset.site_id)
  )
  const map = useQuery({
    queryKey: financeKeys.unitAccounts(unit?.id ?? null),
    queryFn: ({ signal }) => unitAccounts(unit?.id ?? null, signal),
    enabled: unit !== undefined,
  })

  const rows = (map.data ?? []).filter(
    (row) => row.source_id === asset.class_code
  )
  if (rows.length === 0) return null

  return (
    <SheetSection title="Class accounts">
      <Facts>
        {rows.map((row) => (
          <Fact key={`${row.role}:${row.source_id}`} term={roleWords(row.role)}>
            {row.account_code} {row.account_name}
          </Fact>
        ))}
      </Facts>
    </SheetSection>
  )
}
