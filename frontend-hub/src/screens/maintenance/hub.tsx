import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, FileText, Paperclip } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Choices } from "@/components/ui/form"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Meter } from "@/components/ui/meter"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, LoadingState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import {
  approveGaRepairBudget,
  decideGaDisposal,
  gaAssetHub,
  gaAssets,
  gaDisposal,
  gaKeys,
  gaRepair,
  gaRepairObjects,
  gaReplacement,
  moveGaRepair,
  moveGaReplacement,
} from "@/lib/queries/ga"
import { financeKeys, unitAccounts } from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import { searchDocuments, uploadDocument } from "@/lib/queries/workplace"
import { useIdentity } from "@/lib/session"
import { cn } from "@/lib/utils"
import { FinanceMark } from "@/screens/contracts/parts"
import { BillRequestForm } from "@/screens/ga/bill-request"
import {
  DisposalStagePill,
  RepairStagePill,
  ReplacementStagePill,
  StageLine,
} from "@/screens/maintenance/parts"
import {
  DISPOSAL_FLOW,
  REPAIR_FLOW,
  REPLACEMENT_FLOW,
  disposalMethodWords,
  repairNextStages,
  repairOver,
  repairStageWords,
  replacementNextStage,
  replacementStageWords,
} from "@/screens/maintenance/format"
import { SupplierName } from "@/screens/procurement/supplier-name"
import type {
  GaDisposalRow,
  GaRepairRow,
  GaReplacementRow,
} from "@itulah/contract"

/// The three maintenance record sheets: the repair, the replacement and the
/// disposal request.
///
/// One file rather than three because they share the same fence and the same
/// grammar: every rupiah on them is Finance's ledger read over the fence and
/// marked as such, every stage move is offered as the legal `to` list the
/// server itself enforces, and every maker ≠ checker button carries its
/// refusal ON the button rather than in a toast that outlives the moment.

// ── the repair ──────────────────────────────────────────────────────────────

/// One repair: the fact GA keeps (what broke, where, who fixed it) and the
/// half that only exists as somebody else's ledger.
///
/// # The money is Finance's
///
/// `actual_cost_minor` counts POSTED bill lines pointing at the repair
/// (`repair_id`). GA sends the vendor's bill from here once the work is done;
/// it counts once Finance posts it. Dropping the Biaya tab before then would
/// hide the place the number will live; showing it unmarked would read as
/// "cost nothing", which is a
/// different lie. So the figure and the sentence travel together.
export function RepairSheet({
  repairId,
  open,
  onClose,
}: {
  repairId: string | undefined
  open: boolean
  onClose: () => void
}) {
  const repair = useQuery({
    queryKey: gaKeys.repair(repairId ?? ""),
    queryFn: ({ signal }) => gaRepair(repairId ?? "", signal),
    enabled: open && repairId !== undefined,
  })

  // The two head decisions. Like the contract hub's archive, the FORM each
  // one opens lands in the footer, below every tab — a decision about the
  // record, not about whichever tab is open. The screen keys this sheet per
  // repair, so a half-typed budget drops when another record opens.
  const [approving, setApproving] = useState(false)
  const [moving, setMoving] = useState(false)
  const [billing, setBilling] = useState(false)

  const row = repair.data
  const actor = useIdentity()
  const nexts = row === undefined ? [] : repairNextStages(row.status)
  const mine = actor.data?.username === row?.created_by
  const canApprove =
    row !== undefined &&
    row.status === "OPEN" &&
    row.approved_budget_minor === null
  // The vendor's bill follows the work: once it is done, GA hands it to
  // Finance from here rather than Finance typing it in from paper.
  const canBill =
    row !== undefined && (row.status === "COMPLETED" || row.status === "CLOSED")

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      width="wide"
      title={row === undefined ? "Repair" : row.title}
      caption={
        row === undefined ? undefined : (
          <>
            {row.site_id} · {row.objek_name}
            {row.asset_name !== null && ` · ${row.asset_name}`}
          </>
        )
      }
      subject={
        repairId === undefined ? undefined : { kind: "repair", id: repairId }
      }
      badge={
        row === undefined ? undefined : <RepairStagePill status={row.status} />
      }
      actions={
        row === undefined ? undefined : (
          <>
            {canApprove && (
              <Button
                variant="soft"
                disabled={mine}
                onClick={() => setApproving(true)}
              >
                {mine
                  ? "Creator cannot approve their own request"
                  : "Approve budget"}
              </Button>
            )}
            {nexts.length > 0 && (
              <Button variant="soft" onClick={() => setMoving(true)}>
                Move stage
              </Button>
            )}
            {canBill && (
              <Button variant="soft" onClick={() => setBilling(true)}>
                Send bill to Finance
              </Button>
            )}
          </>
        )
      }
      footer={
        row === undefined ? undefined : approving ? (
          <ApproveBudgetForm
            row={row}
            onDone={() => {
              setApproving(false)
              onClose()
            }}
            onCancel={() => setApproving(false)}
          />
        ) : moving ? (
          <MoveRepairForm
            row={row}
            onDone={() => {
              setMoving(false)
              onClose()
            }}
            onCancel={() => setMoving(false)}
          />
        ) : billing ? (
          <BillRequestForm
            source={{
              site_id: row.site_id,
              supplier_id: row.supplier_id,
              supplier_name: row.supplier_name,
              amount_minor:
                row.approved_budget_minor ?? row.estimated_cost_minor,
              memo: row.title,
              repair_id: row.repair_id,
            }}
            onDone={() => {
              setBilling(false)
              onClose()
            }}
            onCancel={() => setBilling(false)}
          />
        ) : undefined
      }
      tabs={
        row === undefined
          ? undefined
          : [
              {
                value: "detail",
                label: "Details",
                content: <RepairDetail row={row} />,
              },
              {
                value: "cost",
                label: "Cost",
                content: <RepairCost row={row} />,
              },
              {
                value: "accounts",
                label: "Accounts",
                content: <RepairAccounts row={row} />,
              },
              {
                value: "documents",
                label: "Documents",
                content: <Documents kind="repair" id={row.repair_id} />,
              },
            ]
      }
    >
      {repair.isLoading && <LoadingState>Opening the repair…</LoadingState>}
      {repair.error instanceof Error && (
        <Banner tone="bad">{repair.error.message}</Banner>
      )}
    </Sheet>
  )
}

/// The fact's own fields. Aset leads when there is one, because that is how
/// the reader recognises the job; a repair with no asset says so plainly —
/// "plafon bocor" is a real repair and the site is what locates it.
function RepairDetail({ row }: { row: GaRepairRow }) {
  return (
    <div className="flex flex-col gap-5">
      <section>
        <h4 className="mb-2.5 border-b border-hairline pb-1.5 text-card-title font-semibold text-ink">
          Details
        </h4>
        <Facts>
          <Fact term="Asset">{row.asset_name ?? "No asset"}</Fact>
          <Fact term="Location">{row.site_id}</Fact>
          <Fact term="Object">{row.objek_name}</Fact>
          <Fact term="Vendor">
            <SupplierName code={row.supplier_id} name={row.supplier_name} />
          </Fact>
          <Fact term="Contract">
            {row.contract_id === null ? (
              "—"
            ) : (
              <span className="font-mono text-id">
                {row.contract_id.slice(0, 8)}
              </span>
            )}
          </Fact>
          <Fact term="Reported">{day(row.failure_at)}</Fact>
          <Fact term="Done">
            {row.completed_at === null ? "—" : day(row.completed_at)}
          </Fact>
          {row.approved_by !== null && (
            <Fact term="Approved by">
              {row.approved_by} · {day(row.approved_at)}
            </Fact>
          )}
          <Fact term="Recorded by">{row.created_by}</Fact>
          {row.notes !== null && <Fact term="Notes">{row.notes}</Fact>}
        </Facts>
      </section>
      <section>
        <h4 className="mb-2.5 border-b border-hairline pb-1.5 text-card-title font-semibold text-ink">
          Stage
        </h4>
        <StageLine flow={REPAIR_FLOW} status={row.status} />
      </section>
    </div>
  )
}

/// Estimate and budget are GA's own facts; the actual is the ledger's.
function RepairCost({ row }: { row: GaRepairRow }) {
  const { over, cap, capWord } = repairOver(row)
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <figure>
          <figcaption className="text-eyebrow font-medium text-body">
            Estimate
          </figcaption>
          <div className="mt-1 text-[1.125rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {money(row.estimated_cost_minor)}
          </div>
        </figure>
        <figure>
          <figcaption className="text-eyebrow font-medium text-body">
            Approved budget
          </figcaption>
          <div className="mt-1 text-[1.125rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {money(row.approved_budget_minor)}
            {row.approved_budget_minor === null && (
              <span className="text-pill font-normal text-mute">
                {" "}
                · not yet set
              </span>
            )}
          </div>
        </figure>
        <figure>
          <figcaption className="text-eyebrow font-medium text-body">
            Actual <FinanceMark className="ml-1 align-[0.125rem]" />
          </figcaption>
          <div
            className={cn(
              "mt-1 text-[1.125rem] leading-none font-semibold tracking-[-0.02em] tabular-nums",
              over ? "text-bad" : "text-ink"
            )}
          >
            {money(row.actual_cost_minor)}
          </div>
        </figure>
      </div>

      {cap !== null && cap > 0 && (
        <div className="flex flex-col gap-1.5">
          <Meter
            value={row.actual_cost_minor / cap}
            tone={over ? "bad" : "accent"}
          />
          <span className={over ? "text-pill text-bad" : "text-pill text-mute"}>
            {over
              ? `Over the ${capWord} of ${money(cap)}.`
              : `${money(cap - row.actual_cost_minor)} left of the ${capWord}.`}
          </span>
        </div>
      )}

      <p className="text-pill text-mute">
        Estimate and budget are GA's own facts. Actual is counted from bills
        Finance has posted against this repair; a bill sent from here shows once
        Finance posts it.
      </p>
    </div>
  )
}

/// The object's account, read-only. GA names the KIND of thing that broke;
/// which account that bills to is Finance's map, resolved here so the person
/// filing the repair can check the proposal before a bill ever carries it.
function RepairAccounts({ row }: { row: GaRepairRow }) {
  const objects = useQuery({
    queryKey: gaKeys.repairObjects(),
    queryFn: ({ signal }) => gaRepairObjects(signal),
    staleTime: 5 * 60 * 1000,
  })

  if (objects.isLoading)
    return <LoadingState>Reading the object list…</LoadingState>

  const object = (objects.data ?? []).find((one) => one.code === row.objek)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col">
        <div className="flex items-baseline gap-3 border-b border-hairline py-2 last:border-b-0">
          <span className="w-28 shrink-0 text-meta text-body">
            Expense ({row.objek_name})
          </span>
          <span className="w-14 shrink-0 font-mono text-id text-body tabular-nums">
            {object?.account_code ?? "—"}
          </span>
          <span className="min-w-0 truncate text-meta text-mute">
            {object?.name}
          </span>
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-pill text-mute">
        <FinanceMark className="align-[0.0625rem]" /> Proposed on the bill line
        that points to this repair, from the account map for the{" "}
        {row.objek_name.toLowerCase()} object. Finance can still change it.
      </p>
    </div>
  )
}

/// Budget approval — the checker's half (brief §11). The server refuses the
/// repair's own creator, and the button refuses them first.
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
      onDone()
    },
  })

  return (
    <div className="flex items-end gap-3">
      <Field
        label={`Budget for ${row.title}`}
        required
        aside="the approved figure, not the estimate"
        className="flex-1"
      >
        <Money value={budget} onChange={setBudget} autoFocus />
      </Field>
      <Button
        variant="primary"
        pending={approve.isPending}
        disabled={budget === ""}
        onClick={() => approve.mutate()}
      >
        {approve.isPending ? "Approving…" : "Approve budget"}
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}

/// The stage move, as cards of the legal `to` list — the same law the server
/// enforces, so a card that 409s cannot be built. A cancelled repair ends a
/// repair; the tile says what choosing it means.
function MoveRepairForm({
  row,
  onDone,
  onCancel,
}: {
  row: GaRepairRow
  onDone: () => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const [to, setTo] = useState("")
  const [note, setNote] = useState("")

  const move = useMutation({
    mutationFn: () =>
      moveGaRepair(row.repair_id, {
        to,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      onDone()
    },
  })

  return (
    <div className="flex flex-col gap-3">
      {move.error instanceof Error && (
        <Banner tone="bad">{move.error.message}</Banner>
      )}
      <Choices
        label="Next stage"
        columns={2}
        value={to}
        onChange={setTo}
        options={repairNextStages(row.status).map((stage) => ({
          value: stage,
          label: repairStageWords(stage),
          note:
            stage === "CANCELLED"
              ? "Stops this repair; its stage cannot move forward after this."
              : undefined,
        }))}
      />
      <Field label="Notes" aside="optional, added to the stage history">
        <Input value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          pending={move.isPending}
          disabled={to === ""}
          onClick={() => move.mutate()}
        >
          {move.isPending ? "Moving…" : "Move"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ── the replacement ─────────────────────────────────────────────────────────

/// One replacement: the swap of an old asset for a new one, proposed with a
/// reason and moved forward one deliberate step at a time.
///
/// # INSTALLED is where the register changes
///
/// Moving to Terpasang is not a status flip: the server copies the old asset
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
  const replacement = useQuery({
    queryKey: gaKeys.replacement(replacementId ?? ""),
    queryFn: ({ signal }) => gaReplacement(replacementId ?? "", signal),
    enabled: open && replacementId !== undefined,
  })

  const row = replacement.data
  const actor = useIdentity()
  const next = row === undefined ? null : replacementNextStage(row.status)
  const mine = actor.data?.username === row?.created_by
  const [installing, setInstalling] = useState(false)

  return (
    <Sheet
      open={open}
      onOpenChange={(step) => !step && onClose()}
      width="wide"
      title={
        row === undefined
          ? "Replacement"
          : `Replace ${row.old_asset_name ?? "asset"}`
      }
      caption={row === undefined ? undefined : row.reason}
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
      actions={
        row === undefined || next === null ? undefined : (
          <AdvanceButton
            row={row}
            to={next}
            disabled={next === "APPROVED" && mine}
            onOpenInstall={() => setInstalling(true)}
          />
        )
      }
      footer={
        row === undefined || next === null || !installing ? undefined : (
          <InstallForm
            row={row}
            to={next}
            onDone={() => {
              setInstalling(false)
              onClose()
            }}
            onCancel={() => setInstalling(false)}
          />
        )
      }
      tabs={
        row === undefined
          ? undefined
          : [
              {
                value: "detail",
                label: "Details",
                content: <ReplacementDetail row={row} />,
              },
              {
                value: "accounts",
                label: "Accounts",
                content: <ReplacementAccounts row={row} />,
              },
              {
                value: "cost",
                label: "Cost",
                content: <ReplacementCost />,
              },
            ]
      }
    >
      {replacement.isLoading && (
        <LoadingState>Opening the replacement…</LoadingState>
      )}
      {replacement.error instanceof Error && (
        <Banner tone="bad">{replacement.error.message}</Banner>
      )}
    </Sheet>
  )
}

/// The one-step advance, in a button. Only Terpasang has a question to ask
/// (which new asset), and that one opens the footer form instead; every
/// other step is one deliberate click, like the prototype's Lanjut.
function AdvanceButton({
  row,
  to,
  disabled,
  onOpenInstall,
}: {
  row: GaReplacementRow
  to: string
  disabled: boolean
  onOpenInstall: () => void
}) {
  const client = useQueryClient()
  const move = useMutation({
    mutationFn: (signal?: AbortSignal) =>
      moveGaReplacement(row.replacement_id, { to, new_asset_id: null }, signal),
    onSuccess: () => {
      // The register changes with this move, and INSTALLED changes it most
      // of all — the whole GA namespace drops, as every GA write here does.
      void client.invalidateQueries({ queryKey: gaKeys.all })
    },
  })

  if (to === "INSTALLED") {
    return (
      <Button variant="soft" onClick={onOpenInstall}>
        Next: {replacementStageWords(to)}
      </Button>
    )
  }

  return (
    <Button
      variant="soft"
      pending={move.isPending}
      disabled={disabled}
      onClick={() => move.mutate()}
    >
      {disabled
        ? "Creator cannot approve their own request"
        : move.isPending
          ? "Moving…"
          : `Next: ${replacementStageWords(to)}`}
    </Button>
  )
}

/// The swap's own facts, with the stage line under them.
function ReplacementDetail({ row }: { row: GaReplacementRow }) {
  return (
    <div className="flex flex-col gap-5">
      <section>
        <h4 className="mb-2.5 border-b border-hairline pb-1.5 text-card-title font-semibold text-ink">
          Replacement
        </h4>
        <Facts>
          <Fact term="Old asset">{row.old_asset_name ?? "—"}</Fact>
          <Fact term="New asset">
            {row.new_asset_name ?? "— created once installed"}
          </Fact>
          <Fact term="Reason">{row.reason}</Fact>
          <Fact term="Repair">
            {row.repair_id === null ? (
              "—"
            ) : (
              <span className="font-mono text-id">
                {row.repair_id.slice(0, 8)}
              </span>
            )}
          </Fact>
          <Fact term="Vendor">
            <SupplierName code={row.supplier_id} name={row.supplier_name} />
          </Fact>
          <Fact term="Date proposed">{day(row.proposed_on)}</Fact>
          {row.decided_by !== null && (
            <Fact term="Decided by">{row.decided_by}</Fact>
          )}
        </Facts>
      </section>
      <section>
        <h4 className="mb-2.5 border-b border-hairline pb-1.5 text-card-title font-semibold text-ink">
          Stage
        </h4>
        <StageLine flow={REPLACEMENT_FLOW} status={row.status} />
      </section>
    </div>
  )
}

/// Whose books the swap touches. Operating Equipment is its own story — the
/// replacement is EXPENSED (7024, out of the 1100 reserve), not capitalised
/// — and that fork reads from the old asset's build, fetched from the same
/// hub the register keeps.
function ReplacementAccounts({ row }: { row: GaReplacementRow }) {
  const oldAsset = useQuery({
    queryKey: gaKeys.asset(row.old_asset_id),
    queryFn: ({ signal }) => gaAssetHub(row.old_asset_id, signal),
    staleTime: 5 * 60 * 1000,
  })
  // The asset stays at its site; its accounts are the books of the unit
  // owning that site (0605).
  const site = oldAsset.data?.asset.site_id ?? null
  const units = useUnits()
  const unit =
    site === null
      ? null
      : ((units.data ?? []).find((one) =>
          one.sites.some((premises) => premises.id === site)
        )?.id ?? null)
  const map = useQuery({
    queryKey: financeKeys.unitAccounts(unit),
    queryFn: ({ signal }) => unitAccounts(unit, signal),
    enabled: unit !== null,
    staleTime: 5 * 60 * 1000,
  })

  if (oldAsset.isLoading)
    return <LoadingState>Reading the old asset…</LoadingState>

  const build = oldAsset.data?.asset.build
  const classCode = oldAsset.data?.asset.class_code

  if (build === "OE") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col">
          <AccountRow role="Replacement expense" code="7024" />
          <AccountRow role="Reserve" code="1100" />
        </div>
        <p className="flex items-center gap-1.5 text-pill text-mute">
          <FinanceMark className="align-[0.0625rem]" /> OE uses replacement: the
          replacement cost is charged to 7024 through reserve 1100; the old
          asset is not depreciated. Read from the bill that points to this
          replacement.
        </p>
      </div>
    )
  }

  const rows = (map.data ?? []).filter((one) => one.source_id === classCode)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col">
        {rows.map((one) => (
          <AccountRow
            key={`${one.role}:${one.source_id}`}
            role={one.role}
            code={one.account_code}
            name={one.account_name}
          />
        ))}
        <AccountRow
          role="Disposal of old asset"
          missing="Gain/Loss on Asset Disposal · not yet in the COA"
        />
      </div>
      <p className="flex items-center gap-1.5 text-pill text-mute">
        <FinanceMark className="align-[0.0625rem]" /> The new asset is
        capitalised through the bill using the old asset's class; the old asset
        is disposed of in Finance.
      </p>
    </div>
  )
}

/// One proposed account, in the prototype's grammar: role, code, name. A
/// missing code is a sentence, not a dash — "not yet" is a decision
/// somebody made, and a dash would read as data nobody typed.
function AccountRow({
  role,
  code,
  name,
  missing,
}: {
  role: string
  code?: string
  name?: string
  missing?: string
}) {
  return (
    <div className="flex items-baseline gap-3 border-b border-hairline py-2 last:border-b-0">
      <span className="w-28 shrink-0 text-meta text-body">{role}</span>
      <span className="w-14 shrink-0 font-mono text-id text-body tabular-nums">
        {code ?? "—"}
      </span>
      <span className="min-w-0 truncate text-meta text-mute">
        {missing ?? name}
      </span>
    </div>
  )
}

/// The cost of a swap is the bills that point at it. The replacement's record
/// does not carry that figure back yet, so it reads em-dash and says why
/// rather than showing a zero that would read as "cost nothing".
function ReplacementCost() {
  return (
    <div className="flex flex-col gap-4">
      <figure>
        <figcaption className="text-eyebrow font-medium text-body">
          Cost <FinanceMark className="ml-1 align-[0.125rem]" />
        </figcaption>
        <div className="mt-1 text-[1.125rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
          —
        </div>
      </figure>
      <p className="text-pill text-mute">
        Bills posted against this replacement are not read back here yet.
        Finance holds the cost until they are.
      </p>
    </div>
  )
}

/// The one step with a question: Terpasang. Name a new asset that GA already
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
      onDone()
    },
  })

  return (
    <div className="flex flex-col gap-3">
      {move.error instanceof Error && (
        <Banner tone="bad">{move.error.message}</Banner>
      )}
      <Field label="New asset" aside="empty = the server copies the old asset">
        <AssetSelect
          value={newAssetId}
          onChange={setNewAssetId}
          exclude={row.old_asset_id}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          pending={move.isPending}
          onClick={() => move.mutate()}
        >
          <Check />
          {move.isPending ? "Moving…" : `Next: ${replacementStageWords(to)}`}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ── the disposal ────────────────────────────────────────────────────────────

/// One disposal request — GA's half of taking an asset out of service.
///
/// # Where this sheet stops
///
/// At APPROVED. POSTED is Finance's word and Finance's act: the gain or loss
/// of letting a thing go is booked by the desk that owns the books, in an
/// account that does not exist in the COA yet (brief §4.2). This sheet says
/// that in one sentence rather than pretending the record is complete.
export function DisposalSheet({
  disposalId,
  open,
  onClose,
}: {
  disposalId: string | undefined
  open: boolean
  onClose: () => void
}) {
  const disposal = useQuery({
    queryKey: gaKeys.disposal(disposalId ?? ""),
    queryFn: ({ signal }) => gaDisposal(disposalId ?? "", signal),
    enabled: open && disposalId !== undefined,
  })

  const row = disposal.data
  const actor = useIdentity()
  const [refusing, setRefusing] = useState(false)
  const decidable = row !== undefined && row.status === "REQUESTED"
  const mine = actor.data?.username === row?.created_by

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      width="rail"
      title={
        row === undefined ? "Disposal" : `Dispose ${row.asset_name ?? "asset"}`
      }
      caption={
        row === undefined ? undefined : (
          <>
            {disposalMethodWords(row.method)} · submitted{" "}
            {day(row.requested_on)}
          </>
        )
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
      actions={
        !decidable || mine ? (
          // The refusal the server will also make, said where the button
          // would have been — a disabled control with a tooltip is a
          // refusal nobody reads.
          decidable && mine ? (
            <Button variant="soft" disabled>
              Creator cannot decide on their own request
            </Button>
          ) : undefined
        ) : (
          <>
            <Button variant="soft" onClick={() => setRefusing(true)}>
              Reject
            </Button>
            <ApproveDisposalButton row={row} onDone={onClose} />
          </>
        )
      }
      footer={
        !decidable || !refusing ? undefined : (
          <RejectDisposalForm
            row={row}
            onDone={() => {
              setRefusing(false)
              onClose()
            }}
            onCancel={() => setRefusing(false)}
          />
        )
      }
      tabs={
        row === undefined
          ? undefined
          : [
              {
                value: "detail",
                label: "Details",
                content: <DisposalDetail row={row} />,
              },
              {
                value: "stage",
                label: "Stage",
                content: (
                  <div className="flex flex-col gap-3">
                    <StageLine flow={DISPOSAL_FLOW} status={row.status} />
                    <p className="text-pill text-mute">
                      Posted by Finance once the journal is made; the stage
                      stops here for GA.
                    </p>
                  </div>
                ),
              },
            ]
      }
    >
      {disposal.isLoading && <LoadingState>Opening the disposal…</LoadingState>}
      {disposal.error instanceof Error && (
        <Banner tone="bad">{disposal.error.message}</Banner>
      )}
    </Sheet>
  )
}

/// Approving, in one click. The refusal path asks for a reason; the approval
/// has the request's own reason standing above it.
function ApproveDisposalButton({
  row,
  onDone,
}: {
  row: GaDisposalRow
  onDone: () => void
}) {
  const client = useQueryClient()
  const approve = useMutation({
    mutationFn: (signal?: AbortSignal) =>
      decideGaDisposal(row.disposal_id, { approve: true, note: null }, signal),
    onSuccess: () => {
      // The asset's own status changes with the decision, so the whole GA
      // namespace drops — the register's pill reads the same fact.
      void client.invalidateQueries({ queryKey: gaKeys.all })
      onDone()
    },
  })

  return (
    <Button
      variant="primary"
      pending={approve.isPending}
      onClick={() => approve.mutate()}
    >
      <Check />
      {approve.isPending ? "Approving…" : "Approve"}
    </Button>
  )
}

/// Refusing, with the reason the asset's holder will read. The server puts
/// the asset back to REGISTERED; the sentence explains why it is still
/// there.
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
    <div className="flex items-end gap-3">
      <Field
        label="Reason for rejecting"
        required
        aside="asset returns to Registered"
        problem={problem || undefined}
        className="flex-1"
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
      <Button variant="primary" pending={reject.isPending} onClick={submit}>
        {reject.isPending ? "Rejecting…" : "Reject"}
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}

/// The request's facts, and the one sentence this sheet owes the reader:
/// the books are not GA's, and the account is not in the COA yet.
function DisposalDetail({ row }: { row: GaDisposalRow }) {
  return (
    <div className="flex flex-col gap-5">
      <Banner tone="warn">
        GA does not post anything: the gain/loss bookkeeping for the disposal
        belongs to Finance, and the Gain/Loss on Asset Disposal account does not
        yet exist in the COA. <FinanceMark className="align-[0.0625rem]" />
      </Banner>

      <section>
        <h4 className="mb-2.5 border-b border-hairline pb-1.5 text-card-title font-semibold text-ink">
          Details
        </h4>
        <Facts>
          <Fact term="Asset">{row.asset_name ?? "—"}</Fact>
          <Fact term="Method">{disposalMethodWords(row.method)}</Fact>
          {row.method === "SOLD" && (
            <Fact term="Sale proceeds">
              {money(row.proceeds_minor)}
              {row.proceeds_minor === null && (
                <span className="text-pill font-normal text-mute">
                  {" "}
                  · no figure yet
                </span>
              )}
            </Fact>
          )}
          <Fact term="Reason">{row.reason}</Fact>
          <Fact term="Submitted">{day(row.requested_on)}</Fact>
          <Fact term="Submitted by">{row.created_by}</Fact>
          {row.approved_by !== null && (
            <Fact term="Decided by">
              {row.approved_by} · {day(row.approved_at)}
            </Fact>
          )}
        </Facts>
      </section>
    </div>
  )
}

// ── shared drawing ──────────────────────────────────────────────────────────

/// The papers filed against a maintenance record. The same door the asset
/// and contract hubs open onto the Library: the person holding the paper is
/// standing at this record, and what they file still lands in the Library —
/// linked, not copied.
function Documents({ kind, id }: { kind: string; id: string }) {
  const client = useQueryClient()
  const [adding, setAdding] = useState(false)
  const documents = useQuery({
    queryKey: ["documents", kind, id],
    queryFn: ({ signal }) =>
      searchDocuments({ subjectKind: kind, subjectId: id }, signal),
  })

  return (
    <div className="flex flex-col gap-4">
      {(documents.data ?? []).length === 0 ? (
        <p className="text-meta text-body">
          No documents yet. Before-and-after photos, technician reports, service
          handover certificates — attached here and indexed in the Library.
        </p>
      ) : (
        <ul className="flex flex-col">
          {(documents.data ?? []).map((document) => (
            <li
              key={document.document_id}
              className="flex items-center gap-3 border-b border-hairline py-2.5 last:border-b-0"
            >
              <FileText className="size-4 shrink-0 stroke-[1.7] text-line-ico" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-cell text-ink">
                  {document.doc_type ?? document.title ?? document.name}
                </span>
                <span className="block truncate font-mono text-pill text-mute">
                  {document.doc_number ?? document.name}
                </span>
              </span>
              <span className="shrink-0 text-pill text-mute tabular-nums">
                {document.expires_on === null
                  ? "no expiry"
                  : `until ${day(document.expires_on)}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <AttachForm
          kind={kind}
          id={id}
          onDone={() => {
            setAdding(false)
            void client.invalidateQueries({ queryKey: ["documents", kind, id] })
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div>
          <Button variant="soft" onClick={() => setAdding(true)}>
            <Paperclip />
            Attach document
          </Button>
        </div>
      )}
    </div>
  )
}

/// Filing one paper — bytes first, document row second, so a slow
/// photograph never blocks the form.
function AttachForm({
  kind,
  id,
  onDone,
  onCancel,
}: {
  kind: string
  id: string
  onDone: () => void
  onCancel: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  const save = useMutation({
    mutationFn: () => {
      if (file === null) throw new Error("Choose a file first.")
      return uploadDocument(file, {
        title: blank(form.title),
        doc_type: blank(form.doc_type),
        doc_number: blank(form.doc_number),
        issuer: blank(form.issuer),
        issued_on: blank(form.issued_on),
        expires_on: blank(form.expires_on),
        path_tokens: ["GA", id],
        tags: [],
        links: [{ subject_kind: kind, subject_id: id }],
      })
    },
    onSuccess: onDone,
  })

  return (
    <div className="rounded-inner border border-hairline-2 p-3.5">
      {save.error instanceof Error && (
        <Banner tone="bad">{save.error.message}</Banner>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field label="File" required>
          <Input
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
        <Field
          label="Document type"
          aside="report, handover certificate, photo"
        >
          <Input
            value={form.doc_type ?? ""}
            onChange={(event) => set("doc_type", event.target.value)}
          />
        </Field>
        <Field label="Number">
          <Input
            value={form.doc_number ?? ""}
            onChange={(event) => set("doc_number", event.target.value)}
          />
        </Field>
        <Field label="Issued by">
          <Input
            value={form.issuer ?? ""}
            onChange={(event) => set("issuer", event.target.value)}
          />
        </Field>
        <Field label="Issued on">
          <Input
            type="date"
            value={form.issued_on ?? ""}
            onChange={(event) => set("issued_on", event.target.value)}
          />
        </Field>
        <Field label="Valid until" aside="empty = no expiry">
          <Input
            type="date"
            value={form.expires_on ?? ""}
            onChange={(event) => set("expires_on", event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={file === null}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
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

  return (
    <Select value={value} onChange={onChange} aria-label="Asset">
      <option value="">Choose a registered asset…</option>
      {(assets.data?.rows ?? [])
        .filter(
          (one) =>
            one.status !== "DRAFT" &&
            (exclude === undefined || one.asset_id !== exclude)
        )
        .map((one) => (
          <option key={one.asset_id} value={one.asset_id}>
            {one.name} · {one.asset_number} · {one.site_id}
          </option>
        ))}
    </Select>
  )
}

/// The form's empty string, as the wire spells "not given".
function blank(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? undefined : trimmed
}
