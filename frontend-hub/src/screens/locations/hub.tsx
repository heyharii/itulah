import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  CalendarClock,
  Droplets,
  FileText,
  Package,
  Phone,
  RefreshCw,
  Zap,
  type LucideIcon,
} from "lucide-react"
import { useState } from "react"

import { Field, Input, Textarea } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Pill, Status } from "@/components/ui/pill"
import {
  MiniCell,
  MiniRow,
  MiniTable,
  SheetSection,
} from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SheetQuery } from "@/components/ui/sheet-states"
import { buildOf } from "@/lib/builds"
import { today } from "@/lib/calendar"
import { EMPTY, count, day, money } from "@/lib/format"
import { openable, FOCUSED } from "@/lib/openable"
import { gaKeys, updateGaLocation } from "@/lib/queries/ga"
import { toast } from "@/lib/toast"
import type { SheetKey } from "@/lib/sheets"
import { cn } from "@/lib/utils"
import { CONTRACT_GROUPS } from "@/screens/contracts/groups"
import { standingOf, useContractParty } from "@/screens/contracts/format"
import { FinanceMark } from "@/screens/contracts/parts"
import {
  repairObjectIcon,
  repairStageWords,
} from "@/screens/maintenance/format"
import {
  detailsMissing,
  kindWords,
  placeQuery,
  usePlaces,
} from "@/screens/locations/places-data"
import { useSupplierName } from "@/screens/procurement/supplier-name"
import type {
  GaAssetRow,
  GaContractRow,
  GaLocationHub,
  GaLocationRow,
  GaMaintenanceTaskRow,
  GaRepairRow,
  GaSupplyRequestRow,
} from "@itulah/contract"

/// One place, as GA keeps the facilities half of it — and everything the books
/// already point back at.
///
/// # One scroll, no tabs
///
/// A record has one scroll of sections (owner, 14 Oct 2026; option A ·
/// Sections of `sites-options.html`, 17 Oct): the figures, the facts as label
/// over value, and then one table for each kind of thing at the site. A kind
/// the site has none of is left out rather than drawn with a sentence saying
/// so — a short site is a short sheet, and "what is standing here" is read off
/// the figures. Each row opens the record it names on that record's own
/// screen, as the sheet's links always did.
///
/// # Edit is a mode of the same frame
///
/// Edit in the foot swaps the facts for fields where they stood; the figures
/// and tables step aside while it is open, and Cancel and Save changes take
/// the foot. Name and code are the register's — they are read here and
/// written nowhere on this sheet. A site nobody has filled in says so in its
/// head ("Details missing") and its one verb is Complete details; the form is
/// the same, because "fill in" and "correct" are the same act on a row that
/// upserts by `site_id`.
///
/// # Utilities is not a fourth list
///
/// `utilities` is the site's Subscriptions contracts — the same rows as
/// contracts, with the meter reading carried on each. The server splits them
/// because that is how a facilities person asks; here they leave the
/// Contracts table and stand in their own, with the meter beside them.
export function LocationHubSheet({
  siteId,
  open,
  onClose,
}: {
  siteId: string | undefined
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const hub = useQuery({
    ...placeQuery(siteId ?? ""),
    enabled: open && siteId !== undefined,
  })
  const placeOf = usePlaces()

  const row = hub.data?.location
  const place = row === undefined ? undefined : placeOf(row)

  // `null` is reading; a draft is the form, held here because the foot's Save
  // is outside the body.
  const [draft, setDraft] = useState<Draft | null>(null)
  const editing = draft !== null
  const dirty =
    row !== undefined && draft !== null && !sameDraft(draft, draftOf(row))

  const save = useMutation({
    mutationFn: async () => {
      if (row === undefined || draft === null)
        throw new Error("Nothing to save.")
      return updateGaLocation(row.site_id, {
        kind: wire(draft.building, row.kind),
        address: wire(draft.address, row.address),
        floor_area_sqm:
          draft.area.trim() === "" ? null : Number(draft.area.trim()),
        contact_name: wire(draft.contact, row.contact_name),
        contact_phone: wire(draft.phone, row.contact_phone),
        notes: wire(draft.notes, row.notes),
      })
    },
    onSuccess: () => {
      // The list's address column and this hub are the same answer under the
      // GA prefix; both drop together.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      setDraft(null)
      toast.success("Details saved")
    },
  })

  const startEdit = () => {
    if (row === undefined) return
    save.reset()
    setDraft(draftOf(row))
  }
  const cancelEdit = () => {
    save.reset()
    setDraft(null)
  }

  const missing = row !== undefined && detailsMissing(row)

  return (
    <Sheet
      open={open}
      onOpenChange={(next, reason) => {
        if (next) return
        // Esc while editing cancels the edit and stays on the record; ×, a
        // swipe and the veil leave the sheet.
        if (editing && reason === "escape") {
          cancelEdit()
          return
        }
        setDraft(null)
        onClose()
      }}
      size="wide"
      stack
      dirty={dirty}
      context="Sites"
      id={place?.code ?? undefined}
      title={place === undefined ? "Site" : place.name}
      badge={missing ? <Pill tone="warn">Details missing</Pill> : undefined}
      caption={row === undefined ? undefined : kindWords(row.site_kind)}
      subject={
        siteId === undefined || editing
          ? undefined
          : { kind: "location", id: siteId }
      }
      footer={
        row === undefined ? undefined : editing ? (
          <SheetFooter
            onCancel={cancelEdit}
            primary={{
              label: "Save changes",
              pending: save.isPending,
              disabled: !dirty,
              onClick: () => save.mutate(),
            }}
            error={save.error}
          />
        ) : (
          <SheetFooter
            primary={{
              label: missing ? "Complete details" : "Edit",
              onClick: startEdit,
            }}
          />
        )
      }
    >
      <SheetQuery query={hub} what="site">
        {(loaded) =>
          draft !== null ? (
            <EditFields
              row={loaded.location}
              name={place?.name ?? loaded.location.site_name}
              code={place?.code ?? null}
              draft={draft}
              set={(patch) => setDraft({ ...draft, ...patch })}
              onSubmit={() => {
                if (dirty) save.mutate()
              }}
            />
          ) : (
            <ReadBody hub={loaded} />
          )
        }
      </SheetQuery>
    </Sheet>
  )
}

// ── the form ────────────────────────────────────────────────────────────────

/// The six facts GA writes, as the boxes hold them.
interface Draft {
  readonly building: string
  readonly area: string
  readonly address: string
  readonly contact: string
  readonly phone: string
  readonly notes: string
}

function draftOf(row: GaLocationRow): Draft {
  return {
    building: row.kind ?? "",
    area: row.floor_area_sqm === null ? "" : String(row.floor_area_sqm),
    address: row.address ?? "",
    contact: row.contact_name ?? "",
    phone: row.contact_phone ?? "",
    notes: row.notes ?? "",
  }
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.building.trim() === b.building.trim() &&
    a.area.trim() === b.area.trim() &&
    a.address.trim() === b.address.trim() &&
    a.contact.trim() === b.contact.trim() &&
    a.phone.trim() === b.phone.trim() &&
    a.notes.trim() === b.notes.trim()
  )
}

/// A box's text as the wire spells it. The server leaves a field alone on
/// `null` and clears it on an empty string, so a box somebody emptied says
/// "" — and a box that was never filled says nothing, so no row is made of
/// blanks.
function wire(value: string, was: string | null): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? (was === null ? null : "") : trimmed
}

/// The kinds of building people write, offered as they type; anything goes.
const BUILDINGS = [
  "Ruko",
  "Ruko 2 lantai",
  "Mall unit",
  "Standalone",
  "Gudang",
  "Kantor",
  "Mess",
]

/// The facts as fields, in the frame the facts stood in. Name and code are
/// the register's and stay words.
function EditFields({
  row,
  name,
  code,
  draft,
  set,
  onSubmit,
}: {
  row: GaLocationRow
  name: string
  code: string | null
  draft: Draft
  set: (patch: Partial<Draft>) => void
  onSubmit: () => void
}) {
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <Facts>
        <Fact term="Name">{name}</Fact>
        {code !== null && <Fact term="Code">{code}</Fact>}
      </Facts>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Building">
          <Input
            list={`buildings-${row.site_id}`}
            value={draft.building}
            onChange={(event) => set({ building: event.target.value })}
            autoFocus
          />
          <datalist id={`buildings-${row.site_id}`}>
            {BUILDINGS.map((one) => (
              <option key={one} value={one} />
            ))}
          </datalist>
        </Field>
        <Field label="Floor area" aside="m²">
          <Input
            type="number"
            inputMode="numeric"
            value={draft.area}
            onChange={(event) => set({ area: event.target.value })}
          />
        </Field>
        <Field label="Address" className="md:col-span-2">
          <Input
            value={draft.address}
            onChange={(event) => set({ address: event.target.value })}
          />
        </Field>
        <Field label="Contact">
          <Input
            value={draft.contact}
            onChange={(event) => set({ contact: event.target.value })}
          />
        </Field>
        <Field label="Phone number">
          <Input
            type="tel"
            inputMode="tel"
            value={draft.phone}
            onChange={(event) => set({ phone: event.target.value })}
          />
        </Field>
        <Field label="Notes" className="md:col-span-2">
          <Textarea
            rows={3}
            value={draft.notes}
            onChange={(event) => set({ notes: event.target.value })}
          />
        </Field>
      </div>
    </form>
  )
}

// ── the record ──────────────────────────────────────────────────────────────

/// The figures, the facts, the notes, and a table for each thing at the site.
function ReadBody({ hub }: { hub: GaLocationHub }) {
  const placeOf = usePlaces()
  const row = hub.location
  const place = placeOf(row)

  // The subscriptions leave the Contracts table: they stand in Utilities with
  // their meter beside them.
  const metered = new Set(hub.utilities.map((one) => one.contract_id))
  const contracts = hub.contracts.filter((one) => !metered.has(one.contract_id))

  return (
    <>
      <Figures row={row} tasks={hub.tasks} />

      <Facts>
        <Fact term="Type">{kindWords(row.site_kind)}</Fact>
        <Fact term="Building">{row.kind ?? EMPTY}</Fact>
        <Fact term="Contact">{row.contact_name ?? EMPTY}</Fact>
        <Fact term="Phone number">{row.contact_phone ?? EMPTY}</Fact>
        <Fact term="Floor area">
          {row.floor_area_sqm === null
            ? EMPTY
            : `${count(row.floor_area_sqm)} m²`}
        </Fact>
        {place.unit !== null && (
          <Fact term="Unit">{`${place.code} · ${place.unit}`}</Fact>
        )}
        <Fact term="Address" wide>
          {row.address ?? EMPTY}
        </Fact>
      </Facts>

      {row.notes !== null && row.notes.trim() !== "" && (
        <SheetSection title="Notes">
          <p className="text-[0.9375rem] leading-[1.375rem] whitespace-pre-wrap text-ink">
            {row.notes}
          </p>
        </SheetSection>
      )}

      <ContractsTable contracts={contracts} />
      <UtilitiesTable utilities={hub.utilities} />
      <AssetsTable assets={hub.assets} />
      <RepairsTable repairs={hub.repairs} />
      <ServiceTable tasks={hub.tasks} />
      <SuppliesTable supplies={hub.supplies} />
    </>
  )
}

/// Assets · Contracts · Open repairs · Service due · Billed this month. What
/// wants somebody turns warm, and a service already late turns red.
function Figures({
  row,
  tasks,
}: {
  row: GaLocationRow
  tasks: readonly GaMaintenanceTaskRow[]
}) {
  const late = tasks.some(
    (task) => task.next_due !== null && task.next_due < today()
  )
  return (
    <KpiStrip className="mb-0! md:grid-cols-3 xl:grid-cols-5">
      <Kpi label="Assets" value={count(row.asset_count)} />
      <Kpi label="Contracts" value={count(row.contract_count)} />
      <Kpi
        label="Open repairs"
        value={
          row.open_repair_count > 0 ? (
            <span className="text-warn-fg">{count(row.open_repair_count)}</span>
          ) : (
            count(row.open_repair_count)
          )
        }
      />
      <Kpi
        label="Service due"
        value={
          late ? (
            <span className="text-bad-fg">{count(row.due_task_count)}</span>
          ) : (
            count(row.due_task_count)
          )
        }
      />
      <Kpi
        label={
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            Billed this month <FinanceMark />
          </span>
        }
        value={money(row.billed_this_month_minor)}
      />
    </KpiStrip>
  )
}

// ── the tables ──────────────────────────────────────────────────────────────

/// A head that reads left, for a text column that is not the first (a
/// `MiniTable` head is right-aligned past the first column by default).
const left = (label: string) => ({ label, align: "left" as const })

/// A row that opens another screen's record: the row itself is the target, so
/// nothing inside it is blue. The sheet's links always led there.
function GoRow({
  to,
  sheet,
  children,
}: {
  to: string
  sheet: { readonly key: SheetKey; readonly value: string }
  children: React.ReactNode
}) {
  const navigate = useNavigate()
  const go = () =>
    void navigate({
      to: to as never,
      search: { [sheet.key]: sheet.value } as never,
    })
  return (
    <tr
      className={cn("cursor-pointer border-t border-hairline", FOCUSED)}
      onClick={go}
      {...openable(go)}
    >
      {children}
    </tr>
  )
}

/// The first cell of a row: a glyph tile for what kind of thing it is, the
/// name in ink and one quiet line under it.
function NameCell({
  name,
  quiet,
  icon: Glyph,
}: {
  name: React.ReactNode
  quiet?: React.ReactNode
  icon: LucideIcon
}) {
  return (
    <span className="flex min-w-0 items-start gap-3">
      <span
        aria-hidden
        className="mt-px grid size-[1.875rem] shrink-0 place-items-center rounded-inner bg-soft-2 text-body"
      >
        <Glyph className="size-4 stroke-[1.7]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-ink">{name}</span>
        {quiet !== undefined && quiet !== null && quiet !== "" && (
          <span className="block font-normal text-mute">{quiet}</span>
        )}
      </span>
    </span>
  )
}

/// A grey em dash for a cell with nothing in it.
const Dash = () => <span className="text-mute">{EMPTY}</span>

/// The deals that apply to this place. A scope contract (all stores) is not
/// listed here — the server's `contracts` are the ones that name this site,
/// and the estate-wide ones live in Contracts.
function ContractsTable({
  contracts,
}: {
  contracts: readonly GaContractRow[]
}) {
  const partyName = useContractParty()
  if (contracts.length === 0) return null
  return (
    <SheetSection title="Contracts" aside={count(contracts.length)}>
      <MiniTable head={["Contract", left("Party"), "Ends", "Value"]}>
        {contracts.map((contract) => {
          const standing = standingOf(contract)
          return (
            <GoRow
              key={contract.contract_id}
              to="/contracts"
              sheet={{ key: "contract", value: contract.contract_id }}
            >
              <MiniCell>
                <NameCell
                  icon={
                    CONTRACT_GROUPS.find(
                      (one) => one.group_code === contract.group_code
                    )?.icon ?? FileText
                  }
                  name={contract.contract_type_name}
                  quiet={contract.contract_number}
                />
              </MiniCell>
              <MiniCell>{partyName(contract)}</MiniCell>
              <MiniCell
                align="right"
                className={cn(
                  !contract.archived &&
                    standing.tone === "warn" &&
                    "text-warn-fg",
                  !contract.archived && standing.tone === "bad" && "text-bad-fg"
                )}
              >
                {contract.ends_on === null ? <Dash /> : day(contract.ends_on)}
              </MiniCell>
              <MiniCell align="right">
                {contract.contract_value_minor === null ? (
                  <Dash />
                ) : (
                  money(contract.contract_value_minor)
                )}
              </MiniCell>
            </GoRow>
          )
        })}
      </MiniTable>
    </SheetSection>
  )
}

/// What a subscription is for, as a mark.
function utilityIcon(contract: GaContractRow): LucideIcon {
  switch (contract.contract_type) {
    case "LANGGANAN_LISTRIK":
      return Zap
    case "LANGGANAN_AIR":
      return Droplets
    case "LANGGANAN_TELEKOM":
      return Phone
    default:
      return RefreshCw
  }
}

/// The site's subscriptions, with the meter reading carried on each row. The
/// amount billed is Finance's; the usage is GA's own.
function UtilitiesTable({
  utilities,
}: {
  utilities: readonly GaContractRow[]
}) {
  const partyName = useContractParty()
  if (utilities.length === 0) return null
  return (
    <SheetSection title="Utilities" aside={count(utilities.length)}>
      <MiniTable head={["Utility", left("Provider"), "Last reading", "Billed"]}>
        {utilities.map((contract) => (
          <GoRow
            key={contract.contract_id}
            to="/contracts"
            sheet={{ key: "contract", value: contract.contract_id }}
          >
            <MiniCell>
              <NameCell
                icon={utilityIcon(contract)}
                name={contract.contract_type_name}
                quiet={contract.customer_number}
              />
            </MiniCell>
            <MiniCell>{partyName(contract)}</MiniCell>
            <MiniCell align="right">
              {contract.last_usage === null ? (
                <Dash />
              ) : (
                `${count(contract.last_usage)} ${contract.last_unit ?? ""}`.trim()
              )}
            </MiniCell>
            <MiniCell align="right">
              {contract.billed_minor === 0 ? (
                <Dash />
              ) : (
                money(contract.billed_minor)
              )}
            </MiniCell>
          </GoRow>
        ))}
      </MiniTable>
    </SheetSection>
  )
}

/// The condition in the words the register prints.
function conditionOf(condition: string): {
  word: string
  tone: "neutral" | "warn" | "bad"
} {
  switch (condition) {
    case "PERLU_SERVIS":
      return { word: "Needs service", tone: "warn" }
    case "RUSAK":
      return { word: "Broken", tone: "bad" }
    default:
      return { word: "Good", tone: "neutral" }
  }
}

/// The things standing here. Each opens the asset's own sheet, the one the
/// register opens — a related list is a door, not a copy.
function AssetsTable({ assets }: { assets: readonly GaAssetRow[] }) {
  if (assets.length === 0) return null
  return (
    <SheetSection title="Assets" aside={count(assets.length)}>
      <MiniTable
        head={["Asset", left("Where"), left("Holder"), left("Condition")]}
      >
        {assets.map((asset) => {
          const condition = conditionOf(asset.condition)
          return (
            <GoRow
              key={asset.asset_id}
              to="/assets"
              sheet={{ key: "asset", value: asset.asset_id }}
            >
              <MiniCell>
                <NameCell
                  icon={buildOf(asset.build).icon}
                  name={asset.name}
                  quiet={asset.asset_number}
                />
              </MiniCell>
              <MiniCell>{asset.sub_location ?? <Dash />}</MiniCell>
              <MiniCell>{asset.holder ?? <Dash />}</MiniCell>
              <MiniCell>
                <Status tone={condition.tone}>{condition.word}</Status>
              </MiniCell>
            </GoRow>
          )
        })}
      </MiniTable>
    </SheetSection>
  )
}

/// A repair's stage as a dot and a word.
function repairTone(
  status: string
): "warn" | "accent" | "info" | "ok" | "neutral" {
  switch (status) {
    case "OPEN":
      return "warn"
    case "APPROVED":
      return "accent"
    case "IN_PROGRESS":
      return "info"
    case "COMPLETED":
      return "ok"
    default:
      return "neutral"
  }
}

/// The breakdowns filed here, each opening its own repair sheet.
function RepairsTable({ repairs }: { repairs: readonly GaRepairRow[] }) {
  const supplierName = useSupplierName()
  if (repairs.length === 0) return null
  return (
    <SheetSection title="Repairs" aside={count(repairs.length)}>
      <MiniTable head={["Repair", left("Supplier"), "Budget", left("Status")]}>
        {repairs.map((repair) => {
          const budget =
            repair.approved_budget_minor ?? repair.estimated_cost_minor
          return (
            <GoRow
              key={repair.repair_id}
              to="/maintenance"
              sheet={{ key: "repair", value: repair.repair_id }}
            >
              <MiniCell>
                <NameCell
                  icon={repairObjectIcon(repair.objek)}
                  name={repair.title}
                  quiet={
                    repair.asset_name ?? `Reported ${day(repair.failure_at)}`
                  }
                />
              </MiniCell>
              <MiniCell>
                {supplierName(repair.supplier_id, repair.supplier_name)}
              </MiniCell>
              <MiniCell align="right">
                {budget === null ? <Dash /> : money(budget)}
              </MiniCell>
              <MiniCell>
                <Status tone={repairTone(repair.status)}>
                  {repairStageWords(repair.status)}
                </Status>
              </MiniCell>
            </GoRow>
          )
        })}
      </MiniTable>
    </SheetSection>
  )
}

/// "3 months", "10.000 km": how often, without the sentence round it.
function everyOf(task: GaMaintenanceTaskRow): string {
  const unit =
    task.interval_kind === "DAYS"
      ? "days"
      : task.interval_kind === "MONTHS"
        ? "months"
        : "km"
  return `${count(task.interval_value)} ${unit}`
}

/// The days a date is behind today: more than nothing, and it is late.
function daysLate(nextDue: string): number {
  return Math.round(
    (Date.parse(`${today()}T00:00:00`) - Date.parse(`${nextDue}T00:00:00`)) /
      86_400_000
  )
}

/// The recurring work at this place. A task has no sheet — the schedule IS its
/// surface — so these rows say what is due and stop there.
function ServiceTable({ tasks }: { tasks: readonly GaMaintenanceTaskRow[] }) {
  if (tasks.length === 0) return null
  return (
    <SheetSection title="Routine service" aside={count(tasks.length)}>
      <MiniTable head={["Task", left("Every"), "Next due"]}>
        {tasks.map((task) => {
          const late = task.next_due === null ? 0 : daysLate(task.next_due)
          return (
            <MiniRow key={task.task_id}>
              <MiniCell>
                <NameCell
                  icon={CalendarClock}
                  name={task.title}
                  quiet={task.asset_name}
                />
              </MiniCell>
              <MiniCell>{everyOf(task)}</MiniCell>
              <MiniCell align="right" className={cn(late > 0 && "text-bad-fg")}>
                {task.next_due === null ? (
                  <Dash />
                ) : (
                  <>
                    {day(task.next_due)}
                    {late > 0 && (
                      <span className="block text-mute">
                        {late === 1 ? "1 day late" : `${count(late)} days late`}
                      </span>
                    )}
                  </>
                )}
              </MiniCell>
            </MiniRow>
          )
        })}
      </MiniTable>
    </SheetSection>
  )
}

/// A supply request's stage, in the words the Supplies screen prints.
function supplyStage(status: string): {
  word: string
  tone: "warn" | "accent" | "info" | "ok" | "bad"
} {
  switch (status) {
    case "REQUESTED":
      return { word: "Submitted", tone: "warn" }
    case "APPROVED":
      return { word: "Approved", tone: "accent" }
    case "ORDERED":
      return { word: "PO created", tone: "accent" }
    case "RECEIVED":
      return { word: "Received", tone: "info" }
    case "BILLED":
      return { word: "Billed", tone: "ok" }
    default:
      return { word: "Rejected", tone: "bad" }
  }
}

/// What was asked for from this place, each opening its own supply sheet.
function SuppliesTable({
  supplies,
}: {
  supplies: readonly GaSupplyRequestRow[]
}) {
  if (supplies.length === 0) return null
  return (
    <SheetSection title="Supply requests" aside={count(supplies.length)}>
      <MiniTable head={["Item", "Quantity", "Needed by", left("Status")]}>
        {supplies.map((supply) => {
          const stage = supplyStage(supply.status)
          return (
            <GoRow
              key={supply.request_id}
              to="/supplies"
              sheet={{ key: "supply", value: supply.request_id }}
            >
              <MiniCell>
                <NameCell
                  icon={Package}
                  name={supply.item}
                  quiet={`${supply.category_name} · ${supply.requested_by}`}
                />
              </MiniCell>
              <MiniCell align="right">{supply.quantity ?? <Dash />}</MiniCell>
              <MiniCell align="right">
                {supply.needed_by === null ? <Dash /> : day(supply.needed_by)}
              </MiniCell>
              <MiniCell>
                <Status tone={stage.tone}>{stage.word}</Status>
              </MiniCell>
            </GoRow>
          )
        })}
      </MiniTable>
    </SheetSection>
  )
}
