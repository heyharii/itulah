import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, day } from "@/lib/format"
import { problemOf } from "@/lib/problem"
import {
  createFlowTemplate,
  flowKeys,
  flowTemplateDetail,
  listFlowTemplates,
  saveFlowTemplateVersion,
  updateFlowTemplate,
  useFlowVocabulary,
  validateFlowTemplate,
  type FlowRoleCode,
  type FlowTemplateDetail,
  type FlowTemplateDraft,
  type FlowTemplateSummary,
  type FlowVocabulary,
  type PoolRoleCode,
  type ProofKindCode,
  type RouteEndCode,
  type StageCatalogueEntry,
  type StageKindCode,
  type TemplateProblem,
  type TemplateStage,
} from "@/lib/queries/flows"
import { queryState } from "@/lib/query-state"
import { useIdentity } from "@/lib/session"
import { useDebounced } from "@/lib/use-debounced"
import { cn } from "@/lib/utils"

/// Alur barang — the flow templates.
///
/// What a stage MEANS is fixed on the server: pick takes goods off the racks,
/// "Masuk surat jalan" puts sealed koli into one SJ for one destination,
/// "Muat (dispatch)" puts them on a vehicle run, receive is one confirm with no
/// refusal. What this screen edits is the order of those stages for a route,
/// who raises the plan (the allotment, or the PO from a supplier), who does
/// each stage, the proof and the deadline, what may be skipped, and where the
/// goods land.
///
/// Every save is a new version. A flow already running keeps the version it
/// started on, so nothing here rewrites work in progress.
///
/// The invariants hold whatever is typed: a flow to our own site ends in
/// Terima; to a supplier or customer in Serah terima with proof; goods
/// between our sites travel under a surat jalan; suppliers only meet the
/// Gudang. The server answers every problem with the row it belongs to, as
/// the author types, and this screen puts each sentence beside that row.

/// Used before the catalogue has answered, and for codes it does not name.
const STAGE_LABEL: Record<StageKindCode, string> = {
  APPROVAL: "Persetujuan",
  PICK: "Ambil (pick)",
  PACK: "Kemas (pack)",
  CLOSE_KOLI: "Tutup koli",
  SHIP: "Masuk surat jalan",
  LOAD: "Muat (dispatch)",
  DEPART: "Berangkat",
  RECEIVE: "Terima",
  INSPECT: "Periksa",
  READY_FOR_PICKUP: "Siap diambil",
  HANDOVER_WITH_PROOF: "Serah terima dengan bukti",
  ARRIVAL: "Kedatangan",
  BLIND_COUNT: "Hitung buta",
  VERIFICATION: "Verifikasi",
  TAGGING: "Tagging",
  PUTAWAY: "Simpan ke rak",
}

const END_LABEL: Record<RouteEndCode, string> = {
  HO: "Gudang (HO)",
  STORE: "Toko",
  SUPPLIER: "Supplier",
  CUSTOMER: "Pelanggan",
}

const ENDS: readonly RouteEndCode[] = ["HO", "STORE", "SUPPLIER", "CUSTOMER"]

const WIRING_LABEL = {
  IN_FLOW: { label: "Di alur", tone: "ok" },
  EXISTING_SURFACE: { label: "Layar sudah ada", tone: "neutral" },
  MISSING: { label: "Belum ada layar", tone: "warn" },
} as const

function isSite(end: RouteEndCode): boolean {
  return end === "HO" || end === "STORE"
}

function blankDraft(): FlowTemplateDraft {
  return {
    code: "",
    name: "",
    route: { origin: "HO", destination: "STORE" },
    starters: ["HO_MD"],
    destination_pool: "STOCKROOM",
    stages: [],
    notes: null,
  }
}

/// Only the fields the server takes: it refuses anything else.
function cleanDraft(draft: FlowTemplateDraft): FlowTemplateDraft {
  return {
    code: draft.code.trim(),
    name: draft.name.trim(),
    route: draft.route,
    starters: draft.starters,
    destination_pool: isSite(draft.route.destination)
      ? draft.destination_pool
      : null,
    stages: draft.stages.map((stage) => ({
      kind: stage.kind,
      performer: stage.performer,
      proof: stage.proof,
      deadline_hours: stage.deadline_hours,
      skippable: stage.skippable,
      params: stage.params,
    })),
    notes: draft.notes === null || draft.notes.trim() === "" ? null : draft.notes,
  }
}

export function Flows() {
  const identity = useIdentity()
  const isAdmin = identity.data?.role === "ADMIN"
  const vocabulary = useFlowVocabulary()
  const [showRetired, setShowRetired] = useState(false)
  const [editing, setEditing] = useState<
    { mode: "new" } | { mode: "edit"; id: string } | null
  >(null)

  const templates = useQuery({
    queryKey: flowKeys.templates(showRetired),
    queryFn: ({ signal }) => listFlowTemplates(showRetired, signal),
  })

  const stageLabel = useStageLabel(vocabulary.data)

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Alur barang"
        sub="Urutan tahap tiap rute barang: siapa membuat rencananya, siapa mengerjakan tiap tahap, bukti, dan tenggat. Makna tahap ada di sistem; urutannya diatur di sini."
        actions={
          isAdmin ? (
            <Button variant="primary" onClick={() => setEditing({ mode: "new" })}>
              <Plus />
              Alur baru
            </Button>
          ) : undefined
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          options={[
            { value: "active", label: "Aktif" },
            { value: "all", label: "Termasuk yang dipensiunkan" },
          ]}
          value={showRetired ? "all" : "active"}
          onChange={(next) => setShowRetired(next === "all")}
        />
        {!isAdmin && identity.data !== undefined && (
          <span className="text-[0.875rem] text-mute">
            Hanya Admin HO yang bisa mengubah alur.
          </span>
        )}
      </div>

      <Card className="overflow-hidden">
        {queryState(templates, {
          loading: "Membaca alur…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>Belum ada alur.</EmptyState>
            ) : (
              <TemplateTable
                rows={rows}
                stageLabel={stageLabel}
                onOpen={(id) => setEditing({ mode: "edit", id })}
              />
            ),
        })}
      </Card>

      <TemplateEditor
        target={editing}
        vocabulary={vocabulary.data}
        isAdmin={isAdmin}
        onClose={() => setEditing(null)}
      />
    </PageContent>
  )
}

function useStageLabel(vocabulary: FlowVocabulary | undefined) {
  return useMemo(() => {
    const labels = new Map<string, string>(
      (vocabulary?.stages ?? []).map((stage) => [stage.code, stage.label])
    )
    return (code: string) =>
      labels.get(code) ?? STAGE_LABEL[code as StageKindCode] ?? code
  }, [vocabulary])
}

function TemplateTable({
  rows,
  stageLabel,
  onOpen,
}: {
  rows: readonly FlowTemplateSummary[]
  stageLabel: (code: string) => string
  onOpen: (id: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[0.875rem]">
        <thead>
          <tr className="border-b border-hairline text-left text-meta text-mute">
            <th className="px-3 py-2 font-medium">Alur</th>
            <th className="px-3 py-2 font-medium">Rute</th>
            <th className="px-3 py-2 font-medium">Tahap</th>
            <th className="px-3 py-2 text-right font-medium">Versi</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-hairline last:border-b-0">
              <td className="px-3 py-2 align-top">
                <div className="text-ink">{row.name}</div>
                <div className="font-mono text-id text-mute">{row.code}</div>
              </td>
              <td className="px-3 py-2 align-top whitespace-nowrap text-body">
                {END_LABEL[row.origin] ?? row.origin} →{" "}
                {END_LABEL[row.destination] ?? row.destination}
              </td>
              <td className="px-3 py-2 align-top text-body">
                {row.stages.length === 0
                  ? "—"
                  : row.stages.map(stageLabel).join(" · ")}
              </td>
              <td className="px-3 py-2 text-right align-top tabular-nums text-body">
                {row.current_version === null ? "—" : `v${row.current_version}`}
              </td>
              <td className="px-3 py-2 align-top">
                <div className="flex flex-wrap gap-1.5">
                  {row.status === "RETIRED" ? (
                    <Pill tone="neutral">Dipensiunkan</Pill>
                  ) : (
                    <Pill tone="ok">Aktif</Pill>
                  )}
                  {row.is_default && <Pill tone="accent">Bawaan rute</Pill>}
                </div>
              </td>
              <td className="px-3 py-2 text-right align-top">
                <Button size="sm" variant="quiet" onClick={() => onOpen(row.id)}>
                  Buka
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TemplateEditor({
  target,
  vocabulary,
  isAdmin,
  onClose,
}: {
  target: { mode: "new" } | { mode: "edit"; id: string } | null
  vocabulary: FlowVocabulary | undefined
  isAdmin: boolean
  onClose: () => void
}) {
  const editId = target?.mode === "edit" ? target.id : null
  const detail = useQuery({
    queryKey: flowKeys.template(editId ?? ""),
    queryFn: ({ signal }) => flowTemplateDetail(editId ?? "", signal),
    enabled: editId !== null,
  })

  const current = detail.data?.versions.find((version) => version.is_current)
  const title =
    target?.mode === "new"
      ? "Alur baru"
      : detail.data === undefined
        ? "Alur"
        : detail.data.name

  return (
    <Sheet
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      width="workspace"
      title={title}
      id={detail.data?.code}
      badge={
        detail.data?.current_version != null ? (
          <Pill tone="neutral">v{detail.data.current_version}</Pill>
        ) : undefined
      }
    >
      {target === null ? null : vocabulary === undefined ? (
        <EmptyState>Membaca katalog tahap…</EmptyState>
      ) : target.mode === "new" ? (
        <EditorBody
          key="new"
          initial={blankDraft()}
          templateId={null}
          detail={null}
          vocabulary={vocabulary}
          isAdmin={isAdmin}
          onDone={onClose}
        />
      ) : detail.data === undefined ? (
        detail.isError ? (
          <Banner tone="bad">{problemOf(detail.error)}</Banner>
        ) : (
          <EmptyState>Membaca alur…</EmptyState>
        )
      ) : (
        <EditorBody
          key={`${detail.data.id}:${current?.id ?? "none"}`}
          initial={current?.template ?? blankDraft()}
          templateId={detail.data.id}
          detail={detail.data}
          vocabulary={vocabulary}
          isAdmin={isAdmin}
          onDone={onClose}
        />
      )}
    </Sheet>
  )
}

/// Who a new stage is given to, before the author chooses: the floor of the
/// site where the stage happens.
function defaultPerformer(
  stage: StageCatalogueEntry,
  route: FlowTemplateDraft["route"]
): FlowRoleCode {
  if (stage.side === "HEAD_OFFICE") return "HO_ADMIN"
  const end = stage.side === "ORIGIN" ? route.origin : route.destination
  if (end === "STORE") return "STORE_STAFF"
  if (stage.kind === "VERIFICATION" || stage.kind === "INSPECT")
    return "GUDANG_SUPERVISOR"
  if (stage.kind === "DEPART" || stage.kind === "HANDOVER_WITH_PROOF")
    return "HO_DELIVERY"
  return "GUDANG_STAFF"
}

/// The proof a new stage starts with: what it demands whatever the template
/// says, so a fresh row is not born broken.
function defaultProof(stage: StageCatalogueEntry): ProofKindCode[] {
  switch (stage.required_proof.type) {
    case "COUNT_METHOD":
      return stage.allowed_proof.includes("RFID_SCAN") ? ["RFID_SCAN"] : ["MANUAL_COUNT"]
    case "ANY_OF":
      return stage.required_proof.kinds.slice(0, 1)
    case "NONE":
      return []
  }
}

function EditorBody({
  initial,
  templateId,
  detail,
  vocabulary,
  isAdmin,
  onDone,
}: {
  initial: FlowTemplateDraft
  templateId: string | null
  detail: FlowTemplateDetail | null
  vocabulary: FlowVocabulary
  isAdmin: boolean
  onDone: () => void
}) {
  const client = useQueryClient()
  const [draft, setDraft] = useState<FlowTemplateDraft>(initial)
  const [makeDefault, setMakeDefault] = useState(true)
  const [activate, setActivate] = useState(true)
  const [dragging, setDragging] = useState<number | null>(null)
  const [adding, setAdding] = useState("")
  const creating = templateId === null
  const readOnly = !isAdmin || detail?.status === "RETIRED"

  const catalogue = useMemo(
    () => new Map(vocabulary.stages.map((stage) => [stage.code, stage])),
    [vocabulary]
  )
  const delegates = useMemo(
    () => new Map(vocabulary.delegates.map((delegate) => [delegate.stage, delegate])),
    [vocabulary]
  )

  // Asked as the author types, a moment after they stop. Writes nothing.
  const cleaned = useMemo(() => cleanDraft(draft), [draft])
  const settled = useDebounced(JSON.stringify(cleaned), 350)
  const validation = useQuery({
    queryKey: flowKeys.validation(templateId, settled),
    queryFn: ({ signal }) =>
      validateFlowTemplate(
        JSON.parse(settled) as FlowTemplateDraft,
        templateId,
        signal
      ),
    enabled: isAdmin,
    placeholderData: (previous) => previous,
  })
  const problems: readonly TemplateProblem[] = validation.data?.problems ?? []
  const upToDate = settled === JSON.stringify(cleaned) && !validation.isFetching
  const onTemplate = (field: string) =>
    problems
      .filter((problem) => problem.stage === null && problem.field === field)
      .map((problem) => problem.message)
  const onStage = (index: number) =>
    problems.filter((problem) => problem.stage === index)

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: flowKeys.all })
  }

  const save = useMutation({
    mutationFn: () =>
      templateId === null
        ? createFlowTemplate(cleaned, makeDefault)
        : saveFlowTemplateVersion(templateId, cleaned, activate),
    onSuccess: () => {
      invalidate()
      onDone()
    },
  })

  const patch = useMutation({
    mutationFn: (body: Parameters<typeof updateFlowTemplate>[1]) =>
      updateFlowTemplate(templateId ?? "", body),
    onSuccess: invalidate,
  })

  const setRoute = (side: "origin" | "destination", end: RouteEndCode) => {
    setDraft((previous) => {
      const route = { ...previous.route, [side]: end }
      let pool = previous.destination_pool
      if (!isSite(route.destination)) pool = null
      else if (pool === null)
        pool = route.destination === "STORE" ? "STOCKROOM" : "WAREHOUSE"
      return { ...previous, route, destination_pool: pool }
    })
  }

  const setStage = (index: number, next: Partial<TemplateStage>) => {
    setDraft((previous) => ({
      ...previous,
      stages: previous.stages.map((stage, at) =>
        at === index ? { ...stage, ...next } : stage
      ),
    }))
  }

  const changeKind = (index: number, kind: StageKindCode) => {
    const entry = catalogue.get(kind)
    if (entry === undefined) return
    setDraft((previous) => ({
      ...previous,
      stages: previous.stages.map((stage, at) =>
        at === index
          ? {
              ...stage,
              kind,
              performer: defaultPerformer(entry, previous.route),
              proof: defaultProof(entry),
              skippable: entry.may_skip ? stage.skippable : false,
            }
          : stage
      ),
    }))
  }

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= draft.stages.length) return
    setDraft((previous) => {
      const stages = [...previous.stages]
      const [moved] = stages.splice(from, 1)
      if (moved === undefined) return previous
      stages.splice(to, 0, moved)
      return { ...previous, stages }
    })
  }

  const remove = (index: number) => {
    setDraft((previous) => ({
      ...previous,
      stages: previous.stages.filter((_, at) => at !== index),
    }))
  }

  const add = (kind: StageKindCode) => {
    const entry = catalogue.get(kind)
    if (entry === undefined) return
    setDraft((previous) => ({
      ...previous,
      stages: [
        ...previous.stages,
        {
          kind,
          performer: defaultPerformer(entry, previous.route),
          proof: defaultProof(entry),
          deadline_hours: null,
          skippable: false,
          params: {},
        },
      ],
    }))
  }

  const used = new Set(draft.stages.map((stage) => stage.kind))
  const saveProblem = problemOf(save.error)
  const patchProblem = problemOf(patch.error)
  const ready =
    isAdmin &&
    !readOnly &&
    !save.isPending &&
    upToDate &&
    validation.data?.valid === true

  return (
    <div className="flex flex-col gap-5">
      <Banner tone="info">
        Tiap simpan menjadi versi baru. Alur yang sedang berjalan tetap memakai
        versinya sendiri. Alur lahir dari rencananya — allotment, atau PO dari
        supplier — dan tidak pernah membuatnya.
      </Banner>
      {!isAdmin && (
        <Banner tone="warn">
          Anda bisa membaca alur ini. Mengubahnya hanya Admin HO.
        </Banner>
      )}
      {detail?.status === "RETIRED" && (
        <Banner tone="warn">
          Alur ini dipensiunkan: tidak memulai dokumen baru. Aktifkan dulu untuk
          mengubahnya.
        </Banner>
      )}
      {saveProblem !== null && <Banner tone="bad">{saveProblem}</Banner>}
      {patchProblem !== null && <Banner tone="bad">{patchProblem}</Banner>}
      {validation.isError && isAdmin && (
        <Banner tone="warn">
          Pemeriksaan otomatis tidak menjawab: {problemOf(validation.error)}
        </Banner>
      )}

      {/* The template */}
      <section className="grid gap-4 md:grid-cols-2">
        <Field label="Nama" problem={onTemplate("name")[0]}>
          <Input
            value={draft.name}
            disabled={readOnly}
            onChange={(event) =>
              setDraft((previous) => ({ ...previous, name: event.target.value }))
            }
            placeholder="Kirim gudang → toko"
          />
        </Field>
        <Field
          label="Kode"
          aside={creating ? undefined : "tetap"}
          problem={onTemplate("code")[0]}
        >
          <Input
            value={draft.code}
            disabled={readOnly || !creating}
            className="font-mono"
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                code: event.target.value.toUpperCase(),
              }))
            }
            placeholder="KIRIM_GUDANG_TOKO"
          />
        </Field>
        <Field
          label="Dari"
          aside={creating ? undefined : "rute tetap"}
          problem={onTemplate("route")[0]}
        >
          <Select
            value={draft.route.origin}
            disabled={readOnly || !creating}
            onChange={(value) => setRoute("origin", value as RouteEndCode)}
          >
            {ENDS.map((end) => (
              <option key={end} value={end}>
                {END_LABEL[end]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ke">
          <Select
            value={draft.route.destination}
            disabled={readOnly || !creating}
            onChange={(value) => setRoute("destination", value as RouteEndCode)}
          >
            {ENDS.map((end) => (
              <option key={end} value={end}>
                {END_LABEL[end]}
              </option>
            ))}
          </Select>
        </Field>
        {onTemplate("route")
          .slice(1)
          .map((message) => (
            <p key={message} className="text-[0.875rem] text-bad md:col-span-2">
              {message}
            </p>
          ))}
        {isSite(draft.route.destination) && (
          <Field
            label="Pool tujuan"
            hint="Tempat barang diterima di tujuan."
            problem={onTemplate("destination_pool")[0]}
          >
            <Select
              value={draft.destination_pool ?? ""}
              disabled={readOnly}
              onChange={(value) =>
                setDraft((previous) => ({
                  ...previous,
                  destination_pool: value === "" ? null : (value as PoolRoleCode),
                }))
              }
            >
              <option value="">Pilih pool…</option>
              {vocabulary.pool_roles.map((pool) => (
                <option key={pool.code} value={pool.code}>
                  {pool.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="flex flex-col gap-2 md:col-span-2">
          <span className="text-[0.875rem] font-medium text-text">
            Siapa boleh memulai
          </span>
          <span className="text-[0.875rem] text-mute">
            Yang boleh membuat rencananya untuk rute ini: allotment, atau PO dari
            supplier.
          </span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {vocabulary.roles.map((role) => (
              <Checkbox
                key={role.code}
                label={role.label}
                disabled={readOnly}
                checked={draft.starters.includes(role.code)}
                onChange={(checked) =>
                  setDraft((previous) => ({
                    ...previous,
                    starters: checked
                      ? [...previous.starters, role.code]
                      : previous.starters.filter((code) => code !== role.code),
                  }))
                }
              />
            ))}
          </div>
          {onTemplate("starters").map((message) => (
            <p key={message} className="text-[0.875rem] text-bad">
              {message}
            </p>
          ))}
        </div>
      </section>

      {/* The stages */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-card-title font-semibold text-ink">
            Tahap, berurutan
          </h4>
          <span className="text-[0.875rem] text-mute">
            Seret atau pakai panah untuk mengubah urutan.
          </span>
        </div>

        {draft.stages.length === 0 ? (
          <EmptyState>Belum ada tahap. Tambahkan dari daftar di bawah.</EmptyState>
        ) : (
          <ol className="flex flex-col gap-2.5">
            {draft.stages.map((stage, index) => {
              const entry = catalogue.get(stage.kind)
              const delegate = delegates.get(stage.kind)
              const rowProblems = onStage(index)
              const wiring =
                delegate === undefined ? undefined : WIRING_LABEL[delegate.wiring]
              return (
                <li
                  key={`${stage.kind}-${index}`}
                  draggable={!readOnly}
                  onDragStart={(event) => {
                    setDragging(index)
                    event.dataTransfer.effectAllowed = "move"
                  }}
                  onDragOver={(event) => {
                    if (dragging !== null) event.preventDefault()
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (dragging !== null) move(dragging, index)
                    setDragging(null)
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={cn(
                    "rounded-inner border bg-canvas p-3 transition-colors",
                    rowProblems.length > 0 ? "border-bad-fg/40" : "border-hairline",
                    dragging === index && "opacity-60"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <GripVertical
                      aria-hidden
                      className={cn(
                        "mt-2.5 size-4 shrink-0 text-mute",
                        !readOnly && "cursor-grab"
                      )}
                    />
                    <span className="mt-2 w-6 shrink-0 text-right font-mono text-id text-mute">
                      {index + 1}
                    </span>
                    <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-[1.3fr_1fr_0.6fr]">
                      <Field label="Tahap">
                        <Select
                          value={stage.kind}
                          disabled={readOnly}
                          onChange={(value) =>
                            changeKind(index, value as StageKindCode)
                          }
                        >
                          {vocabulary.stages.map((option) => (
                            <option
                              key={option.code}
                              value={option.code}
                              disabled={
                                option.code !== stage.kind && used.has(option.code)
                              }
                            >
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Dikerjakan oleh">
                        <Select
                          value={stage.performer}
                          disabled={readOnly}
                          onChange={(value) =>
                            setStage(index, { performer: value as FlowRoleCode })
                          }
                        >
                          {vocabulary.roles.map((role) => (
                            <option key={role.code} value={role.code}>
                              {role.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Tenggat (jam)">
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={720}
                          disabled={readOnly}
                          value={stage.deadline_hours ?? ""}
                          placeholder="—"
                          onChange={(event) => {
                            const raw = event.target.value.trim()
                            const hours = Number(raw)
                            setStage(index, {
                              deadline_hours:
                                raw === "" || !Number.isFinite(hours)
                                  ? null
                                  : Math.round(hours),
                            })
                          }}
                        />
                      </Field>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 pt-6">
                      <Button
                        size="icon"
                        variant="quiet"
                        aria-label="Naikkan"
                        disabled={readOnly || index === 0}
                        onClick={() => move(index, index - 1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        size="icon"
                        variant="quiet"
                        aria-label="Turunkan"
                        disabled={readOnly || index === draft.stages.length - 1}
                        onClick={() => move(index, index + 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        size="icon"
                        variant="quiet"
                        aria-label="Hapus tahap"
                        disabled={readOnly}
                        onClick={() => remove(index)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-col gap-2 pl-[3.25rem]">
                    {entry !== undefined && (
                      <p className="text-[0.875rem] text-body">{entry.meaning}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                      {(entry?.allowed_proof ?? []).map((proof) => (
                        <Checkbox
                          key={proof}
                          label={
                            vocabulary.proofs.find((choice) => choice.code === proof)
                              ?.label ?? proof
                          }
                          disabled={readOnly}
                          checked={stage.proof.includes(proof)}
                          onChange={(checked) =>
                            setStage(index, {
                              proof: checked
                                ? [...stage.proof, proof]
                                : stage.proof.filter((kind) => kind !== proof),
                            })
                          }
                        />
                      ))}
                      <Checkbox
                        label="Boleh dilewati"
                        disabled={readOnly || entry?.may_skip !== true}
                        hint={
                          entry?.may_skip === true ? undefined : "tahap ini wajib"
                        }
                        checked={stage.skippable}
                        onChange={(checked) =>
                          setStage(index, { skippable: checked })
                        }
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {wiring !== undefined && (
                        <Pill tone={wiring.tone} title={delegate?.surface}>
                          {wiring.label}
                        </Pill>
                      )}
                      {entry?.executed_at === "HUB" && (
                        <Pill tone="neutral">Di hub</Pill>
                      )}
                      {entry?.blind === true && (
                        <Pill tone="info">Buta: tanpa kuantitas rencana</Pill>
                      )}
                      {(entry?.fixed_rule_texts ?? []).map((text) => (
                        <Pill key={text} tone="neutral" className="whitespace-normal">
                          {text}
                        </Pill>
                      ))}
                    </div>
                    {rowProblems.map((problem) => (
                      <p
                        key={`${problem.rule}-${problem.message}`}
                        className="text-[0.875rem] text-bad"
                      >
                        {problem.message}
                      </p>
                    ))}
                  </div>
                </li>
              )
            })}
          </ol>
        )}

        {!readOnly && (
          <div className="max-w-sm">
            <Select
              value={adding}
              aria-label="Tambah tahap"
              onChange={(value) => {
                if (value !== "") add(value as StageKindCode)
                setAdding("")
              }}
            >
              <option value="">Tambah tahap…</option>
              {vocabulary.stages
                .filter((option) => !used.has(option.code))
                .map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
            </Select>
          </div>
        )}
      </section>

      <Field label="Catatan" hint="Untuk orang yang membaca alur ini nanti.">
        <Textarea
          rows={2}
          disabled={readOnly}
          value={draft.notes ?? ""}
          onChange={(event) =>
            setDraft((previous) => ({ ...previous, notes: event.target.value }))
          }
        />
      </Field>

      {/* Saving */}
      {isAdmin && !readOnly && (
        <section className="flex flex-col gap-3 border-t border-hairline pt-4">
          {problems.length > 0 && (
            <Banner tone="warn">
              {count(problems.length)} hal harus dibenahi sebelum disimpan; tiap
              kalimat ada di baris yang bersangkutan.
            </Banner>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {creating ? (
              <Checkbox
                label="Jadikan alur bawaan rute ini"
                checked={makeDefault}
                onChange={setMakeDefault}
              />
            ) : (
              <Checkbox
                label="Langsung dipakai untuk dokumen baru"
                checked={activate}
                onChange={setActivate}
              />
            )}
            <div className="flex gap-2">
              <Button variant="quiet" onClick={onDone}>
                Batal
              </Button>
              <Button
                variant="primary"
                disabled={!ready}
                onClick={() => save.mutate()}
              >
                {save.isPending
                  ? "Menyimpan…"
                  : creating
                    ? "Buat alur"
                    : "Simpan versi baru"}
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* The template's own life: default, retirement, versions */}
      {detail !== null && (
        <section className="flex flex-col gap-3 border-t border-hairline pt-4">
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              {detail.status === "ACTIVE" && !detail.is_default && (
                <Button
                  variant="ghost"
                  disabled={patch.isPending}
                  onClick={() => patch.mutate({ is_default: true })}
                >
                  Jadikan bawaan rute
                </Button>
              )}
              {detail.status === "ACTIVE" ? (
                <Button
                  variant="ghost"
                  disabled={patch.isPending}
                  onClick={() => patch.mutate({ status: "RETIRED" })}
                >
                  Pensiunkan
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  disabled={patch.isPending}
                  onClick={() => patch.mutate({ status: "ACTIVE" })}
                >
                  Aktifkan lagi
                </Button>
              )}
            </div>
          )}
          <h4 className="text-card-title font-semibold text-ink">Versi</h4>
          <ul className="flex flex-col gap-1.5 text-[0.875rem]">
            {detail.versions.map((version) => (
              <li
                key={version.id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
              >
                <span className="font-mono text-id text-ink">v{version.version}</span>
                {version.is_current && <Pill tone="accent">Dipakai</Pill>}
                <span className="text-mute">
                  {day(version.created_at)} · {version.created_by} ·{" "}
                  {count(version.documents)} dokumen
                </span>
                {isAdmin && !version.is_current && detail.status === "ACTIVE" && (
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={patch.isPending}
                    onClick={() => patch.mutate({ current_version: version.version })}
                  >
                    Pakai versi ini
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
