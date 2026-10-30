import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SheetQuery } from "@/components/ui/sheet-states"
import { day } from "@/lib/format"
import { gaAssetHub, gaKeys, useGaSites } from "@/lib/queries/ga"
import {
  assetContractsQuery,
  assetDisposalsQuery,
  assetInspectionsQuery,
  assetRepairsQuery,
  assetReplacementsQuery,
  assetTasksQuery,
  claimsQuery,
  odometerQuery,
  operatingExpensesQuery,
  papersQuery,
  type GaOriginalRow,
} from "@/lib/queries/ga-records"
import { useSheet } from "@/lib/sheets"
import {
  CompleteDraft,
  DisposeSheet,
  MoveSheet,
  ReplaceSheet,
  UploadSheet,
} from "@/screens/assets/asset-forms"
import { AssetPhotoPanel, PHOTO_TYPE } from "@/screens/assets/asset-photo"
import {
  ContractsSection,
  DocumentsSection,
  IdentitySection,
  LocationSection,
  MovesSection,
  RepairsSection,
  ScheduleSection,
} from "@/screens/assets/asset-sections"
import { headStatus, isLive, lastOdometer } from "@/screens/assets/asset-words"
import {
  ExpenseSheet,
  ExpensesSection,
  RecordExpenseSheet,
} from "@/screens/assets/expenses"
import { useLayer } from "@/screens/assets/layers"
import { OdometerSheet } from "@/screens/assets/odometer"
import { isClaimablePolicy } from "@/screens/contracts/claim-words"
import {
  AssetClaimsSection,
  ClaimComposer,
  ClaimSheetHost,
} from "@/screens/contracts/claims"
import { ContractComposer } from "@/screens/contracts/composer"
import { ContractHubSheet } from "@/screens/contracts/hub"
import { RepairSheet } from "@/screens/maintenance/hub"
import { RepairComposer } from "@/screens/maintenance/repairs"
import {
  InspectionComposer,
  TaskComposer,
} from "@/screens/maintenance/schedule"
import {
  OriginalSheet,
  PaperSheet,
  RecordPaperSheet,
  ReleaseOriginalSheet,
  ReturnOriginalSheet,
} from "@/screens/workplace/original-sheets"

/// The forms and composers the sheet opens over itself, one at a time.
type Form =
  | "move"
  | "replace"
  | "dispose"
  | "upload"
  | "paper"
  | "expense"
  | "contract"
  | "task"
  | "inspection"
  | "repair"
  | "claim"

/// One asset, with everything connected to it, in one scroll.
///
/// # What is on it
///
/// The thing (its identity, where it is and who holds it), then everything
/// filed against it, in the order a person asks: its papers, its contracts, its
/// schedule and inspections, its repairs, what it costs to run, and what has
/// happened to it. Each section reads from the list that owns the records
/// (Files, Contracts, Routine Service, Repairs), filtered to this asset, and a
/// row opens the same record those screens open, as a layer over this one. The
/// `+` at a section's heading opens that screen's own form with this asset
/// already chosen.
///
/// # Why there is no rupiah on the register's facts
///
/// Finance has the same asset with the cost, the method and the monthly charge
/// on it, and that is the screen for somebody deciding what to do with the
/// money. This one is for the person standing in front of the thing. The only
/// money here is what GA itself records: the operating expenses.
///
/// # Why there are no tabs
///
/// A record has one scroll of sections (design system, sheets). The three
/// things GA does to an asset — Move, Propose replacement, Request disposal —
/// are the foot's verbs, and each opens as a rail layer over the sheet.
///
/// # Papers and originals are keyed in the address
///
/// A paper opens through the `paper` sheet key and an original through
/// `original`, so a paper opened from here, from Files or from the Overview is
/// the same record opened the same way. Their sheets are mounted here for the
/// screen this sheet stands on.
export function AssetHubSheet({
  assetId,
  open,
  onClose,
  onProposeReplacement,
  onRequestDisposal,
}: {
  assetId: string | undefined
  open: boolean
  onClose: () => void
  /// Opens the replacement sheet when a proposal is filed — the swap is a
  /// record people read in Maintenance › Replacement, and the proposal
  /// should land them on it, not leave them guessing whether it saved. A
  /// replacement in the asset's history opens the same way.
  onProposeReplacement?: (replacementId: string) => void
  /// Opens the disposal sheet when a request is filed, for the same reason.
  onRequestDisposal?: (disposalId: string) => void
}) {
  const id = assetId ?? ""
  const enabled = open && assetId !== undefined

  const hub = useQuery({
    queryKey: gaKeys.asset(id),
    queryFn: ({ signal }) => gaAssetHub(id, signal),
    enabled,
  })
  // Everything filed against the asset. Each key is under the GA prefix, so
  // every GA write that invalidates `["ga"]` refreshes the sections too.
  // The photo is a document too; it is drawn at the top, not listed here.
  const papers = useQuery({
    ...papersQuery({ asset: id }),
    select: (rows) => rows.filter((paper) => paper.doc_type !== PHOTO_TYPE),
    enabled,
  })
  const contracts = useQuery({ ...assetContractsQuery(id), enabled })
  const tasks = useQuery({ ...assetTasksQuery(id), enabled })
  const inspections = useQuery({ ...assetInspectionsQuery(id), enabled })
  const repairs = useQuery({ ...assetRepairsQuery(id), enabled })
  const replacements = useQuery({ ...assetReplacementsQuery(id), enabled })
  const disposals = useQuery({ ...assetDisposalsQuery(id), enabled })
  const expenses = useQuery({
    ...operatingExpensesQuery({ asset: id }),
    enabled,
  })
  const claims = useQuery({ ...claimsQuery({ asset: id }), enabled })
  // A vehicle's odometer readings (0975), once the hub says it is one.
  const vehicle = hub.data?.asset.build === "VEHICLE"
  const readings = useQuery({
    ...odometerQuery(id),
    enabled: enabled && vehicle,
  })

  const { sites } = useGaSites(enabled)
  const siteName = (siteId: string) =>
    sites.find((one) => one.value === siteId)?.label ?? siteId

  // What is open over this sheet. Forms and composers are local and one at a
  // time; `round` counts the openings so a form starts clean each time.
  const [form, setForm] = useState<{ name: Form | null; round: number }>({
    name: null,
    round: 0,
  })
  const openForm = (name: Form) =>
    setForm((current) => ({ name, round: current.round + 1 }))
  const closeForm = () => setForm((current) => ({ ...current, name: null }))

  // Records with an address of their own open through their sheet key, so the
  // link can be sent and Esc walks back one layer.
  const contractSheet = useSheet("contract")
  const repairSheet = useSheet("repair")
  const paperSheet = useSheet("paper")
  const originalSheet = useSheet("original")
  const claimSheet = useSheet("claim")
  // And the ones with none are layers held here.
  const expense = useLayer<string>()
  const release = useLayer<GaOriginalRow>()
  const giveBack = useLayer<GaOriginalRow>()
  const [odometerOpen, setOdometerOpen] = useState(false)

  const asset = hub.data?.asset
  const status = asset === undefined ? undefined : headStatus(asset.status)
  const live = asset !== undefined && isLive(asset.status)
  const lastReading = lastOdometer(readings.data ?? [])
  const odometer = lastReading?.km ?? null
  // The policies a claim about this asset can be made under: the activated
  // vehicle and property policies covering it today.
  const policies = (contracts.data ?? []).filter(isClaimablePolicy)

  return (
    <ClaimSheetHost
      onOpenPolicy={contractSheet.open}
      onOpenRepair={repairSheet.open}
    >
      <Sheet
        open={open}
        onOpenChange={(next) => !next && onClose()}
        size="wide"
        stack
        context="Assets"
        title={asset === undefined ? "Asset" : asset.name}
        id={asset?.asset_number}
        badge={
          status === undefined ? undefined : (
            <Pill tone={status.tone}>{status.word}</Pill>
          )
        }
        caption={
          asset === undefined
            ? undefined
            : asset.acquired_via === null
              ? `Acquired ${day(asset.acquired_on)}`
              : `Bought on ${asset.acquired_via} · ${day(asset.acquired_on)}`
        }
        subject={
          assetId === undefined ? undefined : { kind: "asset", id: assetId }
        }
        footer={
          live ? (
            <SheetFooter
              start={
                <Button variant="ghost" onClick={() => openForm("replace")}>
                  Replace
                </Button>
              }
              danger={
                <Button
                  variant="destructive"
                  onClick={() => openForm("dispose")}
                >
                  Request disposal
                </Button>
              }
              primary={{ label: "Move", onClick: () => openForm("move") }}
            />
          ) : (
            <SheetFooter onCancel={onClose} cancelLabel="Close" />
          )
        }
      >
        <SheetQuery query={hub} what="asset">
          {(loaded) => (
            <>
              {loaded.asset.status === "DRAFT" && (
                <CompleteDraft asset={loaded.asset} />
              )}

              <AssetPhotoPanel asset={loaded.asset} />

              <IdentitySection
                asset={loaded.asset}
                odometer={lastReading}
                onOpenOdometer={
                  vehicle ? () => setOdometerOpen(true) : undefined
                }
              />
              <LocationSection
                asset={loaded.asset}
                siteName={siteName(loaded.asset.site_id)}
                since={
                  // The last time it moved or changed hands.
                  loaded.events
                    .filter((event) =>
                      ["REGISTERED", "TRANSFER", "ASSIGN"].includes(event.kind)
                    )
                    .map((event) => event.occurred_on)
                    .sort()
                    .pop() ?? null
                }
              />

              <DocumentsSection
                papers={papers}
                onOpenPaper={paperSheet.open}
                onOpenOriginal={originalSheet.open}
                onRelease={release.open}
                onReturn={giveBack.open}
                onRecord={() => openForm("paper")}
                onUpload={() => openForm("upload")}
              />

              <ContractsSection
                contracts={contracts}
                onOpen={contractSheet.open}
                onAdd={() => openForm("contract")}
              />

              <AssetClaimsSection
                claims={claims}
                policies={policies}
                onOpen={claimSheet.open}
                onAdd={() => openForm("claim")}
              />

              <ScheduleSection
                tasks={tasks}
                inspections={inspections}
                odometer={odometer}
                onAddTask={() => openForm("task")}
                onAddInspection={() => openForm("inspection")}
              />

              <RepairsSection
                repairs={repairs}
                onOpen={repairSheet.open}
                onAdd={() => openForm("repair")}
              />

              <ExpensesSection
                expenses={expenses}
                onOpen={expense.open}
                onAdd={() => openForm("expense")}
              />

              <MovesSection
                assetId={loaded.asset.asset_id}
                events={loaded.events}
                replacements={replacements}
                disposals={disposals}
                siteName={siteName}
                onOpenReplacement={onProposeReplacement}
                onOpenDisposal={onRequestDisposal}
              />

            </>
          )}
        </SheetQuery>
      </Sheet>

      {asset !== undefined && (
        <>
          {/* The three things GA does to an asset, and the forms its sections
              open. Ours are keyed by their opening so a form starts clean; the
              composers of other screens keep their own state, so they are keyed
              by the asset they were opened for. */}
          <MoveSheet
            key={`move:${asset.asset_id}:${form.round}`}
            asset={asset}
            open={form.name === "move"}
            onClose={closeForm}
          />
          <ReplaceSheet
            key={`replace:${asset.asset_id}:${form.round}`}
            asset={asset}
            open={form.name === "replace"}
            onClose={closeForm}
            onSaved={onProposeReplacement}
          />
          <DisposeSheet
            key={`dispose:${asset.asset_id}:${form.round}`}
            asset={asset}
            open={form.name === "dispose"}
            onClose={closeForm}
            onSaved={onRequestDisposal}
          />
          <UploadSheet
            key={`upload:${asset.asset_id}:${form.round}`}
            asset={asset}
            open={form.name === "upload"}
            onClose={closeForm}
          />
          <RecordExpenseSheet
            key={`new-expense:${asset.asset_id}:${form.round}`}
            asset={asset}
            siteName={siteName(asset.site_id)}
            open={form.name === "expense"}
            onClose={closeForm}
          />
          <RecordPaperSheet
            key={`new-paper:${asset.asset_id}`}
            open={form.name === "paper"}
            onClose={closeForm}
            subject={{ kind: "asset", id: asset.asset_id, label: asset.name }}
          />
          <ContractComposer
            key={`new-contract:${asset.asset_id}`}
            open={form.name === "contract"}
            group=""
            presetAsset={{
              asset_id: asset.asset_id,
              name: asset.name,
              site_id: asset.site_id,
            }}
            onClose={closeForm}
            onSaved={(contractId) => {
              closeForm()
              contractSheet.open(contractId)
            }}
          />
          <TaskComposer
            key={`new-task:${asset.asset_id}`}
            open={form.name === "task"}
            presetAssetId={asset.asset_id}
            onClose={closeForm}
          />
          <InspectionComposer
            key={`new-inspection:${asset.asset_id}`}
            open={form.name === "inspection"}
            presetAssetId={asset.asset_id}
            onClose={closeForm}
          />
          <ClaimComposer
            key={`new-claim:${asset.asset_id}:${form.round}`}
            open={form.name === "claim"}
            policies={policies}
            asset={{ asset_id: asset.asset_id, name: asset.name }}
            onClose={closeForm}
            onSaved={(claimId) => {
              closeForm()
              claimSheet.open(claimId)
            }}
          />
          {vehicle && (
            <OdometerSheet
              asset={asset}
              readings={readings}
              open={odometerOpen}
              onClose={() => setOdometerOpen(false)}
            />
          )}
          <RepairComposer
            key={`new-repair:${asset.asset_id}`}
            open={form.name === "repair"}
            presetAssetId={asset.asset_id}
            onClose={closeForm}
            onSaved={(repairId) => {
              closeForm()
              repairSheet.open(repairId)
            }}
          />
        </>
      )}

      {/* The records the sections open. They stand over this sheet as layers.
          The contract and the repair are mounted only while the address names
          one, keyed per record as the screens that own them key them. */}
      {contractSheet.value !== undefined && (
        <ContractHubSheet
          key={`contract:${contractSheet.value}`}
          contractId={contractSheet.value}
          open={contractSheet.isOpen}
          onClose={contractSheet.close}
        />
      )}
      {repairSheet.value !== undefined && (
        <RepairSheet
          key={`repair:${repairSheet.value}`}
          repairId={repairSheet.value}
          open={repairSheet.isOpen}
          onClose={repairSheet.close}
        />
      )}
      <PaperSheet
        documentId={paperSheet.value}
        open={paperSheet.isOpen}
        onClose={paperSheet.close}
      />
      <OriginalSheet
        originalId={originalSheet.value}
        open={originalSheet.isOpen}
        onClose={originalSheet.close}
      />
      <ReleaseOriginalSheet
        original={release.value}
        open={release.isOpen}
        onClose={release.close}
      />
      <ReturnOriginalSheet
        original={giveBack.value}
        open={giveBack.isOpen}
        onClose={giveBack.close}
      />
      <ExpenseSheet
        key={`expense-sheet:${expense.session}`}
        expenseId={expense.value}
        rows={expenses.data?.rows ?? []}
        open={expense.isOpen}
        onClose={expense.close}
      />
    </ClaimSheetHost>
  )
}

/// The register's own lifecycle, in the client's words.
///
/// DISPOSAL_REQUESTED and REPLACED are tahap 4's additions: statuses GA's
/// own actions write (a disposal request, a replacement installed) and that
/// Finance never touches — the money side of leaving service is the other
/// desk's record, not this status. The sheet's head says it in four words
/// (`headStatus`); the register's list still prints these.
export function gaStatusWords(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft · needs details"
    case "IN_PROGRESS":
      return "In progress"
    case "IN_SERVICE":
      return "Registered"
    case "DISPOSAL_REQUESTED":
      return "Disposal requested"
    case "REPLACED":
      return "Replaced"
    case "DISPOSED":
      return "Disposed"
    default:
      return "Registered"
  }
}
