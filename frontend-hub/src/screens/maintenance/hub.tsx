import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileText, Plus, Receipt } from "lucide-react"
import { useRef, useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Pill, Status } from "@/components/ui/pill"
import { MiniCell, MiniTable, SheetSection } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { SheetEmpty, SheetQuery } from "@/components/ui/sheet-states"
import { Timeline, type TimelineEvent } from "@/components/ui/timeline"
import { EMPTY, day, money } from "@/lib/format"
import {
  approveGaRepairBudget,
  decideGaDisposal,
  gaAssets,
  gaDisposal,
  gaKeys,
  gaRepair,
  gaReplacement,
  moveGaRepair,
  moveGaReplacement,
  useGaSites,
} from "@/lib/queries/ga"
import { claimsQuery, type GaInsuranceClaimRow } from "@/lib/queries/ga-records"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import { recordInfo, recordKeys, type RecordInfo } from "@/lib/queries/records"
import {
  documentDownloadUrl,
  searchDocuments,
  uploadDocument,
} from "@/lib/queries/workplace"
import { useSheet } from "@/lib/sheets"
import { useIdentity } from "@/lib/session"
import { toast } from "@/lib/toast"
import {
  NameCell,
  OpenRow,
  SectionAside,
  TextAction,
} from "@/screens/assets/asset-sections"
import { left, right } from "@/screens/assets/asset-words"
import { ClaimRows, ClaimSheetHost } from "@/screens/contracts/claims"
import { BillRequestForm } from "@/screens/ga/bill-request"
import {
  DISPOSAL_FLOW,
  REPAIR_FLOW,
  REPLACEMENT_FLOW,
  disposalMethodWords,
  disposalStageWords,
  repairNextStages,
  repairOver,
  repairState,
  replacementNextStage,
  replacementStageWords,
} from "@/screens/maintenance/format"
import {
  DisposalStagePill,
  ReplacementStagePill,
} from "@/screens/maintenance/parts"
import { useSupplierName } from "@/screens/procurement/supplier-name"
import type {
  GaDisposalRow,
  GaRepairRow,
  GaReplacementRow,
} from "@itulah/contract"

/// The three maintenance record sheets: the repair, the replacement and the
/// disposal request.
///
/// One file rather than three because they share the same grammar: one scroll
/// (no tabs), the stage as numbered steps with who did each and when, every
/// linked record a blue word that opens it, and a foot that names the one step
/// the record can take next. Every maker ≠ checker step says so in plain words
/// where the button would have stood, rather than as a disabled button that
/// reads as broken.

// ── small parts ─────────────────────────────────────────────────────────────

/// A blue word that opens a record on its own screen.
function RecordLink({
  to,
  sheet,
  children,
}: {
  to: string
  sheet: {
    key: "asset" | "contract" | "location" | "supplier" | "repair"
    value: string
  }
  children: React.ReactNode
}) {
  return (
    <AppLink to={to} sheet={sheet} className="record-link">
      {children}
    </AppLink>
  )
}

/// One entry of a record's activity, as the server writes it.
type Entry = RecordInfo["activity"][number]

/// What was done to a record, read from the same answer the sheet's Activity
/// fold reads — one request between them. The steps take who and when from it,
/// because the record itself keeps only the last of each.
function useActivity(kind: string, id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: recordKeys.info(kind, id ?? ""),
    queryFn: ({ signal }) => recordInfo(kind, id ?? "", signal),
    enabled: enabled && id !== undefined,
    staleTime: 15_000,
  })
}

/// The stage moves made on a record, oldest first. Each is one POST to
/// `…/move`; the ladders are straight, so the first move after approval is the
/// next rung, the second the one after, and a record that was cancelled has
/// the cancellation as its last.
function movesOf(info: RecordInfo | undefined): readonly Entry[] {
  return (info?.activity ?? [])
    .filter((entry) => entry.status < 400 && entry.path.endsWith("/move"))
    .sort((a, b) => a.at.localeCompare(b.at))
}

const by = (who: string | null | undefined) =>
  who === null || who === undefined || who === "" ? undefined : `By ${who}`
const when = (at: string | null | undefined) =>
  at === null || at === undefined ? undefined : day(at)

/// The Next-step rule of every ladder: a step is done once the record has
/// reached it, the next is what the record waits for, the rest are not yet.
function stateAt(index: number, reached: number): "done" | "current" | "todo" {
  return index <= reached ? "done" : index === reached + 1 ? "current" : "todo"
}

// ── the repair ──────────────────────────────────────────────────────────────

/// The act a repair's foot can start. Each opens its own small form over the
/// foot, asking only what that act brings.
type RepairStep = "approve" | "start" | "finish" | "close" | "cancel" | "bill"

/// The stage each act moves the repair to.
const STEP_STAGE: Readonly<
  Record<"start" | "finish" | "close" | "cancel", string>
> = {
  start: "IN_PROGRESS",
  finish: "COMPLETED",
  close: "CLOSED",
  cancel: "CANCELLED",
}

const STEP_VERB: Readonly<
  Record<"start" | "finish" | "close" | "cancel", string>
> = {
  start: "Start work",
  finish: "Mark done",
  close: "Close repair",
  cancel: "Cancel repair",
}

/// One repair, in one scroll: what it costs, where it stands, what was
/// reported, and everything filed against it.
///
/// # The money is Finance's
///
/// The estimate and the approved budget are GA's own facts. `actual_cost_minor`
/// counts POSTED bill lines pointing at the repair: GA sends the vendor's bill
/// from here once the work is done, and it counts once Finance posts it.
///
/// # The foot names the next step
///
/// Needs approval → Approve budget, approved → Start work, in progress → Mark
/// done, done → Send bill to Finance (and Close repair). A repair that is not
/// finished can also be cancelled, in red. The one who recorded a repair may
/// not approve its budget, and the foot says so in words.
export function RepairSheet({
  repairId,
  open,
  onClose,
}: {
  repairId: string | undefined
  open: boolean
  onClose: () => void
}) {
  const enabled = open && repairId !== undefined
  const repair = useQuery({
    queryKey: gaKeys.repair(repairId ?? ""),
    queryFn: ({ signal }) => gaRepair(repairId ?? "", signal),
    enabled,
  })
  const activity = useActivity("repair", repairId, enabled)
  const actor = useIdentity()
  const nameOf = useNameOfLogin()
  const { sites } = useGaSites(enabled)
  const claimSheet = useSheet("claim")

  const row = repair.data
  // Claims are filed against an asset; this repair's are the ones that name it.
  const claims = useQuery({
    ...claimsQuery({ asset: row?.asset_id ?? undefined }),
    enabled: enabled && row?.asset_id != null,
  })

  // The act whose small form stands over the foot, if any. The screen keys
  // this sheet per repair, so a half-typed budget drops when another opens.
  const [step, setStep] = useState<RepairStep | null>(null)

  const mine = actor.data?.username === row?.created_by
  const state = row === undefined ? undefined : repairState(row.status)

  return (
    <ClaimSheetHost>
      <Sheet
        open={open}
        onOpenChange={(next) => !next && onClose()}
        size="wide"
        stack
        context="Repairs"
        title={row === undefined ? "Repair" : row.title}
        badge={
          state === undefined ? undefined : (
            <Pill tone={state.tone}>{state.word}</Pill>
          )
        }
        subject={
          repairId === undefined ? undefined : { kind: "repair", id: repairId }
        }
        footer={
          row === undefined ? undefined : (
            <RepairFoot
              row={row}
              mine={mine}
              creator={nameOf(row.created_by)}
              step={step}
              onStep={setStep}
              onClose={onClose}
            />
          )
        }
      >
        <SheetQuery query={repair} what="repair">
          {(loaded) => (
            <RepairBody
              row={loaded}
              nameOf={nameOf}
              siteName={(siteId) =>
                sites.find((one) => one.value === siteId)?.label ?? siteId
              }
              info={activity.data}
              claims={(claims.data ?? []).filter(
                (claim) => claim.repair_id === loaded.repair_id
              )}
              onOpenClaim={claimSheet.open}
            />
          )}
        </SheetQuery>
      </Sheet>
    </ClaimSheetHost>
  )
}

/// The sheet's body: figures, steps, what was reported, then what is filed
/// against the repair.
function RepairBody({
  row,
  nameOf,
  siteName,
  info,
  claims,
  onOpenClaim,
}: {
  row: GaRepairRow
  nameOf: (login: string) => string
  siteName: (siteId: string) => string
  info: RecordInfo | undefined
  claims: readonly GaInsuranceClaimRow[]
  onOpenClaim: (claimId: string) => void
}) {
  const supplierName = useSupplierName()
  const vendor = supplierName(
    row.supplier_id,
    row.supplier_name,
    row.supplier_id
  )
  const { over } = repairOver(row)

  const approval = (info?.activity ?? []).find(
    (entry) => entry.status < 400 && entry.path.endsWith("/approve-budget")
  )
  const steps = repairSteps(row, {
    creator: nameOf(row.created_by),
    approver:
      row.approved_by !== null
        ? nameOf(row.approved_by)
        : approval?.display_name,
    approvedAt: row.approved_at ?? approval?.at ?? null,
    vendor,
    moves: movesOf(info),
  })

  return (
    <>
      <KpiStrip className="mb-2! grid-cols-2 md:grid-cols-3 xl:grid-cols-3">
        <Kpi label="Estimate" value={money(row.estimated_cost_minor)} />
        <Kpi label="Approved budget" value={money(row.approved_budget_minor)} />
        <Kpi
          label="Actual"
          value={
            over ? (
              <span className="text-bad-fg">
                {money(row.actual_cost_minor)}
              </span>
            ) : (
              money(row.actual_cost_minor)
            )
          }
        />
      </KpiStrip>

      <SheetSection title="Steps">
        <Timeline events={steps} />
      </SheetSection>

      <SheetSection title="Reported issue">
        <Facts>
          <Fact term="Location">
            <RecordLink
              to="/locations"
              sheet={{ key: "location", value: row.site_id }}
            >
              {siteName(row.site_id)}
            </RecordLink>
          </Fact>
          {row.asset_id === null ? (
            <Fact term="Kind">{row.objek_name}</Fact>
          ) : (
            <Fact term="Asset">
              <RecordLink
                to="/assets"
                sheet={{ key: "asset", value: row.asset_id }}
              >
                {row.asset_name ?? "Asset"}
              </RecordLink>
            </Fact>
          )}
          <Fact term="Vendor">
            <RecordLink
              to="/vendors"
              sheet={{ key: "supplier", value: row.supplier_id }}
            >
              {vendor}
            </RecordLink>
          </Fact>
          <Fact term="Contract">
            {row.contract_id === null ? (
              EMPTY
            ) : (
              <RecordLink
                to="/contracts"
                sheet={{ key: "contract", value: row.contract_id }}
              >
                {row.contract_number ?? "Contract"}
              </RecordLink>
            )}
          </Fact>
          <Fact term="Reported on">{day(row.failure_at)}</Fact>
          {row.notes !== null && row.notes !== "" && (
            <Fact term="Notes" wide>
              {row.notes}
            </Fact>
          )}
        </Facts>
      </SheetSection>

      <SubjectPapers kind="repair" id={row.repair_id} />

      {claims.length > 0 && (
        <SheetSection
          title="Insurance claims"
          aside={<SectionAside total={claims.length} />}
        >
          <ClaimRows claims={claims} onOpen={onOpenClaim} about="policy" />
        </SheetSection>
      )}

      <SheetSection title="Bills">
        {row.actual_cost_minor > 0 ? (
          <MiniTable head={["Bill", right("Amount"), left("Status")]}>
            <OpenRow>
              <MiniCell>
                <NameCell
                  icon={Receipt}
                  name="Supplier bills"
                  quiet="Posted by Finance"
                />
              </MiniCell>
              <MiniCell align="right">{money(row.actual_cost_minor)}</MiniCell>
              <MiniCell>
                <Status tone="ok">Posted</Status>
              </MiniCell>
            </OpenRow>
          </MiniTable>
        ) : (
          <SheetEmpty>No bill yet.</SheetEmpty>
        )}
      </SheetSection>
    </>
  )
}

/// The five steps of a repair, as numbered steps: the ones it has been through
/// with who did each and when, and the next one with who it waits for. A
/// cancelled repair shows the steps it reached and where it stopped.
function repairSteps(
  row: GaRepairRow,
  input: {
    creator: string
    approver: string | undefined
    approvedAt: string | null
    vendor: string
    moves: readonly Entry[]
  }
): TimelineEvent[] {
  const { creator, approver, approvedAt, vendor, moves } = input
  const reported: TimelineEvent = {
    id: "reported",
    title: "Reported",
    detail: by(creator),
    at: when(row.failure_at),
    state: "done",
  }

  if (row.status === "CANCELLED") {
    const stopped = moves.at(-1)
    // The repair started before it stopped when two moves were made.
    const started = moves.length >= 2 ? moves[0] : undefined
    return [
      reported,
      ...(row.approved_by !== null
        ? [
            {
              id: "approved",
              title: "Budget approved",
              detail: by(approver),
              at: when(approvedAt),
              state: "done" as const,
            },
          ]
        : []),
      ...(started === undefined
        ? []
        : [
            {
              id: "started",
              title: "In progress",
              detail: by(started.display_name),
              at: when(started.at),
              state: "done" as const,
            },
          ]),
      {
        id: "cancelled",
        title: "Cancelled",
        detail: by(stopped?.display_name),
        at: when(stopped?.at ?? row.updated_at),
        state: "done",
      },
    ]
  }

  const reachedAt = REPAIR_FLOW.indexOf(
    row.status as (typeof REPAIR_FLOW)[number]
  )
  const later = [
    {
      id: "approved",
      title: "Budget approved",
      who: approver,
      at: approvedAt,
      waits: `Waiting for approval by someone other than ${creator}`,
    },
    {
      id: "started",
      title: "In progress",
      who: moves[0]?.display_name,
      at: moves[0]?.at,
      waits: `Waiting for ${vendor} to start`,
    },
    {
      id: "done",
      title: "Done",
      who: moves[1]?.display_name,
      at: row.completed_at ?? moves[1]?.at,
      waits: `Waiting for ${vendor} to finish`,
    },
    {
      id: "closed",
      title: "Billed and closed",
      who: moves[2]?.display_name,
      at: moves[2]?.at,
      waits: "Waiting for the bill to go to Finance",
    },
  ]
  return [
    reported,
    ...later.map((one, i): TimelineEvent => {
      const state = stateAt(i + 1, reachedAt)
      return {
        id: one.id,
        title: one.title,
        state,
        detail:
          state === "done"
            ? by(one.who)
            : state === "current"
              ? one.waits
              : undefined,
        at: state === "done" ? when(one.at) : undefined,
      }
    }),
  ]
}

/// What the foot of a repair can do, and the small form each act opens over it.
function RepairFoot({
  row,
  mine,
  creator,
  step,
  onStep,
  onClose,
}: {
  row: GaRepairRow
  mine: boolean
  creator: string
  step: RepairStep | null
  onStep: (step: RepairStep | null) => void
  onClose: () => void
}) {
  const back = () => onStep(null)
  if (step === "approve")
    return <ApproveBudgetForm row={row} onDone={back} onCancel={back} />
  if (step === "bill")
    return (
      <BillRequestForm
        source={{
          site_id: row.site_id,
          supplier_id: row.supplier_id,
          supplier_name: row.supplier_name,
          amount_minor: row.approved_budget_minor ?? row.estimated_cost_minor,
          memo: row.title,
          repair_id: row.repair_id,
        }}
        onDone={back}
        onCancel={back}
      />
    )
  if (step !== null)
    return (
      <MoveRepairForm
        row={row}
        act={step}
        to={STEP_STAGE[step]}
        onDone={back}
        onCancel={back}
      />
    )

  const cancellable = repairNextStages(row.status).includes("CANCELLED")
  const cancel = cancellable ? (
    <Button variant="destructive" onClick={() => onStep("cancel")}>
      Cancel repair
    </Button>
  ) : undefined

  switch (row.status) {
    case "OPEN":
      return (
        <SheetFooter
          danger={cancel}
          note={
            mine
              ? `${creator} recorded this repair, so someone else approves the budget.`
              : undefined
          }
          primary={
            mine
              ? undefined
              : { label: "Approve budget", onClick: () => onStep("approve") }
          }
        />
      )
    case "APPROVED":
      return (
        <SheetFooter
          danger={cancel}
          primary={{ label: "Start work", onClick: () => onStep("start") }}
        />
      )
    case "IN_PROGRESS":
      return (
        <SheetFooter
          danger={cancel}
          primary={{ label: "Mark done", onClick: () => onStep("finish") }}
        />
      )
    case "COMPLETED":
      return (
        <SheetFooter
          secondary={
            <Button variant="ghost" onClick={() => onStep("close")}>
              Close repair
            </Button>
          }
          primary={{
            label: "Send bill to Finance",
            onClick: () => onStep("bill"),
          }}
        />
      )
    case "CLOSED":
      return (
        <SheetFooter
          onCancel={onClose}
          cancelLabel="Close"
          primary={{
            label: "Send bill to Finance",
            onClick: () => onStep("bill"),
          }}
        />
      )
    default:
      return <SheetFooter onCancel={onClose} cancelLabel="Close" />
  }
}

/// Budget approval — the checker's half (brief §11). The server refuses the
/// repair's own creator, and the foot does not offer it to them.
function ApproveBudgetForm({
  row,
  onDone,
  onCancel,
}: {
  row: GaRepairRow
  onDone: () => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const [budget, setBudget] = useState("")

  const approve = useMutation({
    mutationFn: (signal?: AbortSignal) =>
      approveGaRepairBudget(
        row.repair_id,
        { approved_budget_minor: Number(budget) },
        signal
      ),
    onSuccess: () => {
      // The book's lists, the overview and this record all change together;
      // the GA namespace drops as one, as every GA write here does.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      void client.invalidateQueries({ queryKey: ["record"] })
      onDone()
    },
  })

  return (
    <div className="flex flex-col gap-3">
      <Field label="Approved budget" required className="max-w-xs">
        <Money value={budget} onChange={setBudget} prefix="Rp" autoFocus />
      </Field>
      <SheetFooter
        error={approve.error}
        onCancel={onCancel}
        primary={{
          label: "Approve budget",
          pending: approve.isPending,
          disabled: budget === "",
          onClick: () => approve.mutate(undefined),
        }}
      />
    </div>
  )
}

/// A stage move: one act, one stage — the same law the server enforces
/// (`repairNextStages`), so a move that 409s cannot be offered. Asks only for a
/// note.
function MoveRepairForm({
  row,
  act,
  to,
  onDone,
  onCancel,
}: {
  row: GaRepairRow
  act: "start" | "finish" | "close" | "cancel"
  to: string
  onDone: () => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const [note, setNote] = useState("")

  const move = useMutation({
    mutationFn: () =>
      moveGaRepair(row.repair_id, {
        to,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      void client.invalidateQueries({ queryKey: ["record"] })
      onDone()
    },
  })

  return (
    <div className="flex flex-col gap-3">
      <Field label="Note">
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          autoFocus
        />
      </Field>
      <SheetFooter
        error={move.error}
        onCancel={onCancel}
        cancelLabel={act === "cancel" ? "Keep repair" : "Cancel"}
        primary={{
          label: STEP_VERB[act],
          tone: act === "cancel" ? "danger" : "primary",
          pending: move.isPending,
          onClick: () => move.mutate(),
        }}
      />
    </div>
  )
}

// ── the replacement ─────────────────────────────────────────────────────────

/// One replacement: the swap of an old asset for a new one, proposed with a
/// reason and moved forward one deliberate step at a time.
///
/// # INSTALLED is where the register changes
///
/// Moving to Installed is not a status flip: the server copies the old asset
/// into a new one — name, class, site, specs — and marks the old one
/// REPLACED, in one transaction. The form asks for the new asset only to
/// ADOPT one that was registered earlier; left empty, the copy is made.
export function ReplacementSheet({
  replacementId,
  open,
  onClose,
}: {
  replacementId: string | undefined
  open: boolean
  onClose: () => void
}) {
  const enabled = open && replacementId !== undefined
  const replacement = useQuery({
    queryKey: gaKeys.replacement(replacementId ?? ""),
    queryFn: ({ signal }) => gaReplacement(replacementId ?? "", signal),
    enabled,
  })
  const activity = useActivity("replacement", replacementId, enabled)
  const actor = useIdentity()
  const nameOf = useNameOfLogin()
  const supplierName = useSupplierName()
  const client = useQueryClient()
  const [installing, setInstalling] = useState(false)

  const row = replacement.data
  const next = row === undefined ? null : replacementNextStage(row.status)
  const mine = actor.data?.username === row?.created_by

  const advance = useMutation({
    mutationFn: () =>
      moveGaReplacement(row?.replacement_id ?? "", {
        to: next ?? "",
        new_asset_id: null,
      }),
    onSuccess: () => {
      // The register changes with this move, and INSTALLED changes it most
      // of all — the whole GA namespace drops, as every GA write here does.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      void client.invalidateQueries({ queryKey: ["record"] })
    },
  })

  /// The foot's one verb, named by the step it takes.
  const verb: Readonly<Record<string, string>> = {
    APPROVED: "Approve",
    PURCHASED: "Mark purchased",
    INSTALLED: "Mark installed",
    CLOSED: "Close replacement",
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(step) => !step && onClose()}
      size="rail"
      stack
      context="Replacements"
      title={
        row === undefined
          ? "Replacement"
          : `Replace ${row.old_asset_name ?? "asset"}`
      }
      subject={
        replacementId === undefined
          ? undefined
          : { kind: "replacement", id: replacementId }
      }
      badge={
        row === undefined ? undefined : (
          <ReplacementStagePill status={row.status} />
        )
      }
      footer={
        row === undefined ? undefined : installing && next !== null ? (
          <InstallForm
            row={row}
            to={next}
            onDone={() => setInstalling(false)}
            onCancel={() => setInstalling(false)}
          />
        ) : next === null ? (
          <SheetFooter onCancel={onClose} cancelLabel="Close" />
        ) : (
          <SheetFooter
            error={advance.error}
            note={
              next === "APPROVED" && mine
                ? `${nameOf(row.created_by)} proposed this, so someone else approves it.`
                : undefined
            }
            primary={
              next === "APPROVED" && mine
                ? undefined
                : {
                    label: verb[next] ?? replacementStageWords(next),
                    pending: advance.isPending,
                    onClick:
                      next === "INSTALLED"
                        ? () => setInstalling(true)
                        : () => advance.mutate(),
                  }
            }
          />
        )
      }
    >
      <SheetQuery query={replacement} what="replacement">
        {(loaded) => (
          <>
            <SheetSection title="Steps">
              <Timeline
                events={replacementSteps(loaded, {
                  nameOf,
                  vendor:
                    loaded.supplier_name === null && loaded.supplier_id === null
                      ? "the vendor"
                      : supplierName(
                          loaded.supplier_id,
                          loaded.supplier_name,
                          loaded.supplier_id
                        ),
                  moves: movesOf(activity.data),
                })}
              />
            </SheetSection>

            <SheetSection title="Replacement">
              <Facts>
                <Fact term="Old asset">
                  <RecordLink
                    to="/assets"
                    sheet={{ key: "asset", value: loaded.old_asset_id }}
                  >
                    {loaded.old_asset_name ?? "Asset"}
                  </RecordLink>
                </Fact>
                <Fact term="New asset">
                  {loaded.new_asset_id === null ? (
                    EMPTY
                  ) : (
                    <RecordLink
                      to="/assets"
                      sheet={{ key: "asset", value: loaded.new_asset_id }}
                    >
                      {loaded.new_asset_name ?? "Asset"}
                    </RecordLink>
                  )}
                </Fact>
                <Fact term="Repair">
                  {loaded.repair_id === null ? (
                    EMPTY
                  ) : (
                    <RecordLink
                      to="/maintenance"
                      sheet={{ key: "repair", value: loaded.repair_id }}
                    >
                      {loaded.repair_title ?? "Repair"}
                    </RecordLink>
                  )}
                </Fact>
                <Fact term="Vendor">
                  {loaded.supplier_id === null ? (
                    EMPTY
                  ) : (
                    <RecordLink
                      to="/vendors"
                      sheet={{ key: "supplier", value: loaded.supplier_id }}
                    >
                      {supplierName(
                        loaded.supplier_id,
                        loaded.supplier_name,
                        loaded.supplier_id
                      )}
                    </RecordLink>
                  )}
                </Fact>
                <Fact term="Proposed on">{day(loaded.proposed_on)}</Fact>
                <Fact term="Reason" wide>
                  {loaded.reason}
                </Fact>
              </Facts>
            </SheetSection>
          </>
        )}
      </SheetQuery>
    </Sheet>
  )
}

/// The five steps of a replacement: proposed, approved, purchased, installed,
/// closed. Each done one says who and when; the next says who it waits for.
function replacementSteps(
  row: GaReplacementRow,
  input: {
    nameOf: (login: string) => string
    vendor: string
    moves: readonly Entry[]
  }
): TimelineEvent[] {
  const { nameOf, vendor, moves } = input
  const reachedAt = REPLACEMENT_FLOW.indexOf(
    row.status as (typeof REPLACEMENT_FLOW)[number]
  )
  // Every rung after the proposal is one move, in order.
  const stages = [
    {
      id: "approved",
      title: "Approved",
      who:
        row.approved_by !== null
          ? nameOf(row.approved_by)
          : (moves[0]?.display_name ??
            (row.decided_by === null ? undefined : nameOf(row.decided_by))),
      at: row.approved_at ?? moves[0]?.at,
      waits: `Waiting for approval by someone other than ${nameOf(row.created_by)}`,
    },
    {
      id: "purchased",
      title: "Purchased",
      who: moves[1]?.display_name,
      at: moves[1]?.at,
      waits: `Waiting for ${vendor} to supply it`,
    },
    {
      id: "installed",
      title: "Installed",
      who: moves[2]?.display_name,
      at: moves[2]?.at,
      waits: "Waiting for it to be installed",
    },
    {
      id: "closed",
      title: "Done",
      who: moves[3]?.display_name,
      at: moves[3]?.at,
      waits: "Waiting for GA to close it",
    },
  ]
  return [
    {
      id: "proposed",
      title: "Proposed",
      detail: by(nameOf(row.created_by)),
      at: when(row.proposed_on),
      state: "done",
    },
    ...stages.map((one, i): TimelineEvent => {
      const state = stateAt(i + 1, reachedAt)
      return {
        id: one.id,
        title: one.title,
        state,
        detail:
          state === "done"
            ? by(one.who)
            : state === "current"
              ? one.waits
              : undefined,
        at: state === "done" ? when(one.at) : undefined,
      }
    }),
  ]
}

/// The one step with a question: Installed. Name a new asset that GA already
/// registered and the replacement adopts it; leave it empty and the server
/// copies the old one — name, class, site, specs — in the same transaction
/// that retires the original.
function InstallForm({
  row,
  to,
  onDone,
  onCancel,
}: {
  row: GaReplacementRow
  to: string
  onDone: () => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const [newAssetId, setNewAssetId] = useState("")

  const move = useMutation({
    mutationFn: () =>
      moveGaReplacement(row.replacement_id, {
        to,
        new_asset_id: newAssetId === "" ? null : newAssetId,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      void client.invalidateQueries({ queryKey: ["record"] })
      onDone()
    },
  })

  return (
    <div className="flex flex-col gap-3">
      <Field label="New asset">
        <AssetSelect
          value={newAssetId}
          onChange={setNewAssetId}
          exclude={row.old_asset_id}
        />
      </Field>
      <SheetFooter
        error={move.error}
        onCancel={onCancel}
        primary={{
          label: "Mark installed",
          pending: move.isPending,
          onClick: () => move.mutate(),
        }}
      />
    </div>
  )
}

// ── the disposal ────────────────────────────────────────────────────────────

/// One disposal request — GA's half of taking an asset out of service.
///
/// # Where this sheet stops
///
/// At APPROVED. POSTED is Finance's word and Finance's act: the gain or loss
/// of letting a thing go is booked by the desk that owns the books. The last
/// step says so by waiting for Finance.
export function DisposalSheet({
  disposalId,
  open,
  onClose,
}: {
  disposalId: string | undefined
  open: boolean
  onClose: () => void
}) {
  const enabled = open && disposalId !== undefined
  const disposal = useQuery({
    queryKey: gaKeys.disposal(disposalId ?? ""),
    queryFn: ({ signal }) => gaDisposal(disposalId ?? "", signal),
    enabled,
  })
  const actor = useIdentity()
  const nameOf = useNameOfLogin()
  const [refusing, setRefusing] = useState(false)

  const row = disposal.data
  const decidable = row !== undefined && row.status === "REQUESTED"
  const mine = actor.data?.username === row?.created_by

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="rail"
      stack
      context="Disposals"
      title={
        row === undefined ? "Disposal" : `Dispose ${row.asset_name ?? "asset"}`
      }
      subject={
        disposalId === undefined
          ? undefined
          : { kind: "disposal", id: disposalId }
      }
      badge={
        row === undefined ? undefined : (
          <DisposalStagePill status={row.status} />
        )
      }
      footer={
        row === undefined ? undefined : !decidable ? (
          <SheetFooter onCancel={onClose} cancelLabel="Close" />
        ) : refusing ? (
          <RejectDisposalForm
            row={row}
            onDone={() => setRefusing(false)}
            onCancel={() => setRefusing(false)}
          />
        ) : mine ? (
          <SheetFooter
            onCancel={onClose}
            cancelLabel="Close"
            note={`${nameOf(row.created_by)} requested this, so someone else decides.`}
          />
        ) : (
          <ApproveDisposalFoot row={row} onReject={() => setRefusing(true)} />
        )
      }
    >
      <SheetQuery query={disposal} what="disposal">
        {(loaded) => (
          <>
            <SheetSection title="Steps">
              <Timeline events={disposalSteps(loaded, nameOf)} />
            </SheetSection>

            <SheetSection title="Disposal">
              <Facts>
                <Fact term="Asset">
                  <RecordLink
                    to="/assets"
                    sheet={{ key: "asset", value: loaded.asset_id }}
                  >
                    {loaded.asset_name ?? "Asset"}
                  </RecordLink>
                </Fact>
                <Fact term="Method">{disposalMethodWords(loaded.method)}</Fact>
                {loaded.method === "SOLD" && (
                  <Fact term="Sale proceeds">
                    {money(loaded.proceeds_minor)}
                  </Fact>
                )}
                <Fact term="Submitted on">{day(loaded.requested_on)}</Fact>
                <Fact term="Reason" wide>
                  {loaded.reason}
                </Fact>
              </Facts>
            </SheetSection>
          </>
        )}
      </SheetQuery>
    </Sheet>
  )
}

/// The three steps of a disposal request. Finance posts the last; GA's sheet
/// only waits for it.
function disposalSteps(
  row: GaDisposalRow,
  nameOf: (login: string) => string
): TimelineEvent[] {
  const submitted: TimelineEvent = {
    id: "submitted",
    title: disposalStageWords("REQUESTED"),
    detail: by(nameOf(row.created_by)),
    at: when(row.requested_on),
    state: "done",
  }
  if (row.status === "REJECTED")
    return [
      submitted,
      {
        id: "rejected",
        title: "Rejected",
        detail: [
          by(row.approved_by === null ? null : nameOf(row.approved_by)),
          row.notes,
        ]
          .filter((part) => part !== undefined && part !== null && part !== "")
          .join(" · "),
        at: when(row.approved_at),
        state: "done",
      },
    ]
  const reachedAt = DISPOSAL_FLOW.indexOf(
    row.status as (typeof DISPOSAL_FLOW)[number]
  )
  return [
    submitted,
    {
      id: "approved",
      title: "Approved",
      state: stateAt(1, reachedAt),
      detail:
        reachedAt >= 1
          ? by(row.approved_by === null ? null : nameOf(row.approved_by))
          : `Waiting for a decision by someone other than ${nameOf(row.created_by)}`,
      at: reachedAt >= 1 ? when(row.approved_at) : undefined,
    },
    {
      id: "posted",
      title: "Posted",
      state: stateAt(2, reachedAt),
      detail:
        reachedAt >= 2
          ? by(row.closed_by === null ? null : nameOf(row.closed_by))
          : stateAt(2, reachedAt) === "current"
            ? "Waiting for Finance to post it"
            : undefined,
      at: reachedAt >= 2 ? when(row.closed_at) : undefined,
    },
  ]
}

/// Deciding: Reject on the left, Approve the one primary. The refusal path asks
/// for a reason; the approval has the request's own reason standing above it.
function ApproveDisposalFoot({
  row,
  onReject,
}: {
  row: GaDisposalRow
  onReject: () => void
}) {
  const client = useQueryClient()
  const approve = useMutation({
    mutationFn: (signal?: AbortSignal) =>
      decideGaDisposal(row.disposal_id, { approve: true, note: null }, signal),
    onSuccess: () => {
      // The asset's own status changes with the decision, so the whole GA
      // namespace drops — the register's pill reads the same fact.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      void client.invalidateQueries({ queryKey: ["record"] })
    },
  })

  return (
    <SheetFooter
      error={approve.error}
      danger={
        <Button variant="destructive" onClick={onReject}>
          Reject
        </Button>
      }
      primary={{
        label: "Approve",
        pending: approve.isPending,
        onClick: () => approve.mutate(undefined),
      }}
    />
  )
}

/// Refusing, with the reason the asset's holder will read. The server puts
/// the asset back to Registered; the sentence explains why it is still there.
function RejectDisposalForm({
  row,
  onDone,
  onCancel,
}: {
  row: GaDisposalRow
  onDone: () => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const [note, setNote] = useState("")
  const [problem, setProblem] = useState("")

  const reject = useMutation({
    mutationFn: () =>
      decideGaDisposal(row.disposal_id, {
        approve: false,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      void client.invalidateQueries({ queryKey: ["record"] })
      onDone()
    },
  })

  const submit = () => {
    if (note.trim() === "") {
      setProblem("Enter a reason first.")
      return
    }
    reject.mutate()
  }

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Reason for rejecting"
        required
        problem={problem || undefined}
      >
        <Input
          value={note}
          onChange={(event) => {
            setProblem("")
            setNote(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit()
          }}
          autoFocus
        />
      </Field>
      <SheetFooter
        error={reject.error}
        onCancel={onCancel}
        primary={{
          label: "Reject",
          tone: "danger",
          pending: reject.isPending,
          onClick: submit,
        }}
      />
    </div>
  )
}

// ── shared drawing ──────────────────────────────────────────────────────────

/// The papers filed against a maintenance record, as the claim sheet shows
/// its own: the same door onto the Library — what is filed here lands there,
/// linked, not copied. A row downloads the file.
function SubjectPapers({ kind, id }: { kind: string; id: string }) {
  const client = useQueryClient()
  const picker = useRef<HTMLInputElement>(null)
  const key = ["documents", kind, id] as const
  const papers = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      searchDocuments({ subjectKind: kind, subjectId: id }, signal),
  })
  const attach = useMutation({
    mutationFn: async (files: readonly File[]) => {
      for (const file of files) {
        await uploadDocument(file, {
          title: file.name,
          sha256: null,
          language: null,
          doc_date: null,
          doc_type: null,
          doc_number: null,
          issuer: null,
          issued_on: null,
          expires_on: null,
          path_tokens: ["GA", id],
          tags: [],
          links: [{ subject_kind: kind, subject_id: id }],
        })
      }
    },
    onSuccess: (_done, files) => {
      void client.invalidateQueries({ queryKey: key })
      toast.success(files.length === 1 ? "Paper attached" : "Papers attached")
    },
    onError: (error) => toast.error(error.message),
  })
  const download = async (documentId: string) => {
    try {
      const { url } = await documentDownloadUrl(documentId)
      window.open(url, "_blank", "noopener")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <SheetSection
      title="Documents"
      aside={
        <SectionAside total={papers.data?.length}>
          <TextAction
            aria-label="Attach papers"
            onClick={() => picker.current?.click()}
          >
            <Plus />
            {attach.isPending ? "Attaching…" : "Attach"}
          </TextAction>
          <input
            ref={picker}
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ""
              if (files.length > 0) attach.mutate(files)
            }}
          />
        </SectionAside>
      }
    >
      <SheetQuery query={papers} what="documents">
        {(rows) =>
          rows.length === 0 ? (
            <SheetEmpty>No documents yet.</SheetEmpty>
          ) : (
            <MiniTable head={["Document", left("Filed")]}>
              {rows.map((paper) => (
                <OpenRow
                  key={paper.document_id}
                  onOpen={() => void download(paper.document_id)}
                >
                  <MiniCell>
                    <NameCell
                      icon={FileText}
                      name={paper.title ?? paper.name}
                      quiet={paper.doc_type}
                    />
                  </MiniCell>
                  <MiniCell>{day(paper.created_at)}</MiniCell>
                </OpenRow>
              ))}
            </MiniTable>
          )
        }
      </SheetQuery>
    </SheetSection>
  )
}

/// Registered assets, as a picker. Shared by the forms that need to name a
/// thing that already exists; the register's own draft rows are hidden,
/// because an asset nobody has walked the floor for cannot be the target of
/// a swap.
function AssetSelect({
  value,
  onChange,
  exclude,
}: {
  value: string
  onChange: (next: string) => void
  exclude?: string
}) {
  const assets = useQuery({
    queryKey: gaKeys.assets({}),
    queryFn: ({ signal }) => gaAssets({ limit: 200 }, signal),
    staleTime: 5 * 60 * 1000,
  })
  const { sites } = useGaSites()
  const siteName = (siteId: string) =>
    sites.find((one) => one.value === siteId)?.label ?? siteId

  return (
    <Select value={value} onChange={onChange} aria-label="Asset">
      <option value="">Create from the old asset</option>
      {(assets.data?.rows ?? [])
        .filter(
          (one) =>
            one.status !== "DRAFT" &&
            (exclude === undefined || one.asset_id !== exclude)
        )
        .map((one) => (
          <option key={one.asset_id} value={one.asset_id}>
            {one.name} · {one.asset_number} · {siteName(one.site_id)}
          </option>
        ))}
    </Select>
  )
}
