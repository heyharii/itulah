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
import { financeKeys, siteAccounts } from "@/lib/queries/finance"
import { searchDocuments, uploadDocument } from "@/lib/queries/workplace"
import { useIdentity } from "@/lib/session"
import { cn } from "@/lib/utils"
import { FinanceMark } from "@/screens/contracts/parts"
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
/// # The money reads zero today, and says so
///
/// `actual_cost_minor` counts POSTED bill lines pointing at the repair, and
/// the column that lets a bill line point (`repair_id`) lands in tahap 6.
/// Dropping the Biaya tab until then would hide the place the number will
/// live; showing it unmarked would read as "cost nothing", which is a
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

  const row = repair.data
  const actor = useIdentity()
  const nexts = row === undefined ? [] : repairNextStages(row.status)
  const mine = actor.data?.username === row?.created_by
  const canApprove =
    row !== undefined &&
    row.status === "OPEN" &&
    row.approved_budget_minor === null

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      width="wide"
      title={row === undefined ? "Perbaikan" : row.title}
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
                  ? "Pembuat tidak bisa menyetujui sendiri"
                  : "Setujui budget"}
              </Button>
            )}
            {nexts.length > 0 && (
              <Button variant="soft" onClick={() => setMoving(true)}>
                Pindah tahap
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
        ) : undefined
      }
      tabs={
        row === undefined
          ? undefined
          : [
              {
                value: "detail",
                label: "Detail",
                content: <RepairDetail row={row} />,
              },
              {
                value: "cost",
                label: "Biaya",
                content: <RepairCost row={row} />,
              },
              {
                value: "accounts",
                label: "Akun",
                content: <RepairAccounts row={row} />,
              },
              {
                value: "documents",
                label: "Dokumen",
                content: <Documents kind="repair" id={row.repair_id} />,
              },
            ]
      }
    >
      {repair.isLoading && <LoadingState>Membuka perbaikannya…</LoadingState>}
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
          Detail
        </h4>
        <Facts>
          <Fact term="Aset">{row.asset_name ?? "Tanpa aset"}</Fact>
          <Fact term="Site">{row.site_id}</Fact>
          <Fact term="Objek">{row.objek_name}</Fact>
          <Fact term="Vendor">{row.supplier_name}</Fact>
          <Fact term="Kontrak">
            {row.contract_id === null ? (
              "—"
            ) : (
              <span className="font-mono text-id">
                {row.contract_id.slice(0, 8)}
              </span>
            )}
          </Fact>
          <Fact term="Dilaporkan">{day(row.failure_at)}</Fact>
          <Fact term="Selesai">
            {row.completed_at === null ? "—" : day(row.completed_at)}
          </Fact>
          {row.approved_by !== null && (
            <Fact term="Disetujui oleh">
              {row.approved_by} · {day(row.approved_at)}
            </Fact>
          )}
          <Fact term="Dicatat oleh">{row.created_by}</Fact>
          {row.notes !== null && <Fact term="Catatan">{row.notes}</Fact>}
        </Facts>
      </section>
      <section>
        <h4 className="mb-2.5 border-b border-hairline pb-1.5 text-card-title font-semibold text-ink">
          Tahap
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
            Estimasi
          </figcaption>
          <div className="mt-1 text-[1.125rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {money(row.estimated_cost_minor)}
          </div>
        </figure>
        <figure>
          <figcaption className="text-eyebrow font-medium text-body">
            Budget disetujui
          </figcaption>
          <div className="mt-1 text-[1.125rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {money(row.approved_budget_minor)}
            {row.approved_budget_minor === null && (
              <span className="text-pill font-normal text-mute">
                {" "}
                · belum ada
              </span>
            )}
          </div>
        </figure>
        <figure>
          <figcaption className="text-eyebrow font-medium text-body">
            Aktual <FinanceMark className="ml-1 align-[0.125rem]" />
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
              ? `Di atas ${capWord} ${money(cap)}.`
              : `${money(cap - row.actual_cost_minor)} tersisa dari ${capWord}.`}
          </span>
        </div>
      )}

      <p className="text-pill text-mute">
        Estimasi dan budget adalah fakta GA. Aktual dibaca dari bill POSTED yang
        menunjuk perbaikan ini — baris tagihan bisa menunjuk mulai tahap 6, jadi
        angkanya membaca nol sampai sana, bukan karena kosong.
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
    return <LoadingState>Membaca daftar objek…</LoadingState>

  const object = (objects.data ?? []).find((one) => one.code === row.objek)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col">
        <div className="flex items-baseline gap-3 border-b border-hairline py-2 last:border-b-0">
          <span className="w-28 shrink-0 text-meta text-body">
            Beban ({row.objek_name})
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
        <FinanceMark className="align-[0.0625rem]" /> Diusulkan di baris bill
        yang menunjuk perbaikan ini, dari account map untuk objek{" "}
        {row.objek_name.toLowerCase()}. Finance tetap bisa mengganti.
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
        label={`Budget untuk ${row.title}`}
        aside="angka yang disetujui, bukan estimasi"
        className="flex-1"
      >
        <Money
          value={budget}
          onChange={setBudget}
          placeholder="6000000"
          autoFocus
        />
      </Field>
      <Button
        variant="primary"
        disabled={budget === "" || approve.isPending}
        onClick={() => approve.mutate()}
      >
        {approve.isPending ? "Menyetujui…" : "Setujui budget"}
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Batal
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
        label="Tahap berikutnya"
        columns={2}
        value={to}
        onChange={setTo}
        options={repairNextStages(row.status).map((stage) => ({
          value: stage,
          label: repairStageWords(stage),
          note:
            stage === "CANCELLED"
              ? "Hentikan perbaikan ini; tahapannya tidak bisa lanjut setelahnya."
              : undefined,
        }))}
      />
      <Field label="Catatan" aside="opsional, masuk riwayat tahapan">
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="mis. Disetujui manajer GA"
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          disabled={to === "" || move.isPending}
          onClick={() => move.mutate()}
        >
          {move.isPending ? "Memindahkan…" : "Pindahkan"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Batal
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
          ? "Penggantian"
          : `Ganti ${row.old_asset_name ?? "aset"}`
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
                label: "Detail",
                content: <ReplacementDetail row={row} />,
              },
              {
                value: "accounts",
                label: "Akun",
                content: <ReplacementAccounts row={row} />,
              },
              {
                value: "cost",
                label: "Biaya",
                content: <ReplacementCost />,
              },
            ]
      }
    >
      {replacement.isLoading && (
        <LoadingState>Membuka penggantian…</LoadingState>
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
        Lanjut: {replacementStageWords(to)}
      </Button>
    )
  }

  return (
    <Button
      variant="soft"
      disabled={disabled || move.isPending}
      onClick={() => move.mutate()}
    >
      {disabled
        ? "Pembuat tidak bisa menyetujui sendiri"
        : move.isPending
          ? "Memindahkan…"
          : `Lanjut: ${replacementStageWords(to)}`}
    </Button>
  )
}

/// The swap's own facts, with the stage line under them.
function ReplacementDetail({ row }: { row: GaReplacementRow }) {
  return (
    <div className="flex flex-col gap-5">
      <section>
        <h4 className="mb-2.5 border-b border-hairline pb-1.5 text-card-title font-semibold text-ink">
          Penggantian
        </h4>
        <Facts>
          <Fact term="Aset lama">{row.old_asset_name ?? "—"}</Fact>
          <Fact term="Aset baru">
            {row.new_asset_name ?? "— dibuat saat terpasang"}
          </Fact>
          <Fact term="Alasan">{row.reason}</Fact>
          <Fact term="Perbaikan">
            {row.repair_id === null ? (
              "—"
            ) : (
              <span className="font-mono text-id">
                {row.repair_id.slice(0, 8)}
              </span>
            )}
          </Fact>
          <Fact term="Vendor">{row.supplier_name ?? "—"}</Fact>
          <Fact term="Tanggal usul">{day(row.proposed_on)}</Fact>
          {row.decided_by !== null && (
            <Fact term="Diputuskan oleh">{row.decided_by}</Fact>
          )}
        </Facts>
      </section>
      <section>
        <h4 className="mb-2.5 border-b border-hairline pb-1.5 text-card-title font-semibold text-ink">
          Tahap
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
  const site = oldAsset.data?.asset.site_id ?? null
  const map = useQuery({
    queryKey: financeKeys.siteAccounts(site),
    queryFn: ({ signal }) => siteAccounts(site, signal),
    enabled: site !== null,
    staleTime: 5 * 60 * 1000,
  })

  if (oldAsset.isLoading)
    return <LoadingState>Membaca aset lamanya…</LoadingState>

  const build = oldAsset.data?.asset.build
  const classCode = oldAsset.data?.asset.class_code

  if (build === "OE") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col">
          <AccountRow role="Beban replacement" code="7024" />
          <AccountRow role="Reserve" code="1100" />
        </div>
        <p className="flex items-center gap-1.5 text-pill text-mute">
          <FinanceMark className="align-[0.0625rem]" /> OE memakai replacement:
          biaya penggantinya dibebankan ke 7024 lewat reserve 1100; aset lamanya
          tidak disusutkan. Dibaca lewat tagihan yang menunjuk replacement ini.
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
          role="Pelepasan aset lama"
          missing="Laba/Rugi Pelepasan Aset · belum ada di COA"
        />
      </div>
      <p className="flex items-center gap-1.5 text-pill text-mute">
        <FinanceMark className="align-[0.0625rem]" /> Aset baru dikapitalisasi
        lewat tagihan dengan kelas aset lamanya; aset lama dilepas di Finance.
      </p>
    </div>
  )
}

/// One proposed account, in the prototype's grammar: role, code, name. A
/// missing code is a sentence, not a dash — "belum ada" is a decision
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

/// The cost of a swap is the bills that point at it, and no bill can point
/// until tahap 6 — so the figure reads em-dash and says why, the same
/// honesty the contract hub's Ditagih uses for its own zero.
function ReplacementCost() {
  return (
    <div className="flex flex-col gap-4">
      <figure>
        <figcaption className="text-eyebrow font-medium text-body">
          Biaya <FinanceMark className="ml-1 align-[0.125rem]" />
        </figcaption>
        <div className="mt-1 text-[1.125rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
          —
        </div>
      </figure>
      <p className="text-pill text-mute">
        Dihitung dari bill POSTED yang menunjuk replacement ini. Baris tagihan
        bisa menunjuk mulai tahap 6; sebelum itu angkanya memang belum ada,
        bukan nol.
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
      <Field label="Aset baru" aside="kosong = server menyalin aset lamanya">
        <AssetSelect
          value={newAssetId}
          onChange={setNewAssetId}
          exclude={row.old_asset_id}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          disabled={move.isPending}
          onClick={() => move.mutate()}
        >
          <Check />
          {move.isPending
            ? "Memindahkan…"
            : `Lanjut: ${replacementStageWords(to)}`}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Batal
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
        row === undefined ? "Pelepasan" : `Lepas ${row.asset_name ?? "aset"}`
      }
      caption={
        row === undefined ? undefined : (
          <>
            {disposalMethodWords(row.method)} · diajukan {day(row.requested_on)}
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
              Pembuat tidak bisa memutuskan sendiri
            </Button>
          ) : undefined
        ) : (
          <>
            <Button variant="soft" onClick={() => setRefusing(true)}>
              Tolak
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
                label: "Detail",
                content: <DisposalDetail row={row} />,
              },
              {
                value: "stage",
                label: "Tahap",
                content: (
                  <div className="flex flex-col gap-3">
                    <StageLine flow={DISPOSAL_FLOW} status={row.status} />
                    <p className="text-pill text-mute">
                      Dibukukan oleh Finance setelah jurnalnya dibuat;
                      tahapannya berhenti di sini untuk GA.
                    </p>
                  </div>
                ),
              },
            ]
      }
    >
      {disposal.isLoading && <LoadingState>Membuka pelepasannya…</LoadingState>}
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
      disabled={approve.isPending}
      onClick={() => approve.mutate()}
    >
      <Check />
      {approve.isPending ? "Menyetujui…" : "Setujui"}
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
      setProblem("Tulis alasannya dulu.")
      return
    }
    reject.mutate()
  }

  return (
    <div className="flex items-end gap-3">
      <Field
        label="Alasan menolak"
        aside="aset kembali Terdaftar"
        problem={problem || undefined}
        className="flex-1"
      >
        <Input
          value={note}
          onChange={(event) => {
            setProblem("")
            setNote(event.target.value)
          }}
          placeholder="mis. Tunggu keputusan ganti unit"
          onKeyDown={(event) => {
            if (event.key === "Enter") submit()
          }}
          autoFocus
        />
      </Field>
      <Button variant="primary" disabled={reject.isPending} onClick={submit}>
        {reject.isPending ? "Menolak…" : "Tolak"}
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Batal
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
        GA tidak memposting apa pun: pembukuan laba/rugi pelepasannya milik
        Finance, dan akun Laba/Rugi Pelepasan Aset belum ada di COA.{" "}
        <FinanceMark className="align-[0.0625rem]" />
      </Banner>

      <section>
        <h4 className="mb-2.5 border-b border-hairline pb-1.5 text-card-title font-semibold text-ink">
          Detail
        </h4>
        <Facts>
          <Fact term="Aset">{row.asset_name ?? "—"}</Fact>
          <Fact term="Cara">{disposalMethodWords(row.method)}</Fact>
          {row.method === "SOLD" && (
            <Fact term="Hasil penjualan">
              {money(row.proceeds_minor)}
              {row.proceeds_minor === null && (
                <span className="text-pill font-normal text-mute">
                  {" "}
                  · belum ada angkanya
                </span>
              )}
            </Fact>
          )}
          <Fact term="Alasan">{row.reason}</Fact>
          <Fact term="Diajukan">{day(row.requested_on)}</Fact>
          <Fact term="Diajukan oleh">{row.created_by}</Fact>
          {row.approved_by !== null && (
            <Fact term="Diputuskan oleh">
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
          Belum ada dokumen. Foto sebelum-sesudah, laporan teknisi, BAST servis
          — ditempel di sini dan terindeks di Library.
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
                  ? "tanpa masa berlaku"
                  : `s/d ${day(document.expires_on)}`}
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
            Tempel dokumen
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
      if (file === null) throw new Error("Pilih berkasnya dulu.")
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
        <Field label="Berkasnya">
          <Input
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
        <Field label="Jenis kertas" aside="laporan, BAST, foto">
          <Input
            value={form.doc_type ?? ""}
            onChange={(event) => set("doc_type", event.target.value)}
          />
        </Field>
        <Field label="Nomor">
          <Input
            value={form.doc_number ?? ""}
            onChange={(event) => set("doc_number", event.target.value)}
          />
        </Field>
        <Field label="Yang menerbitkan">
          <Input
            value={form.issuer ?? ""}
            onChange={(event) => set("issuer", event.target.value)}
          />
        </Field>
        <Field label="Diterbitkan">
          <Input
            type="date"
            value={form.issued_on ?? ""}
            onChange={(event) => set("issued_on", event.target.value)}
          />
        </Field>
        <Field label="Berlaku sampai" aside="kosong = tanpa masa berlaku">
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
          disabled={file === null || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Mengunggah…" : "Simpan dokumen"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Batal
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
    <Select value={value} onChange={onChange} aria-label="Aset">
      <option value="">Pilih aset terdaftar…</option>
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
