import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Field, Input, Select } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { MiniCell, MiniTable } from "@/components/ui/rows"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { EmptyState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import {
  capitaliseProject,
  linkProjectCost,
  projectCandidatesQuery,
  projectCostsQuery,
  projectKeys,
  type GaProjectPage,
  type ProjectCost,
  type ProjectDestination,
} from "@/lib/queries/projects"
import { queryState } from "@/lib/query-state"
import { toast } from "@/lib/toast"

const SOURCE_WORD = {
  BILL_LINE: "Bill",
  BKK_LINE: "BKK",
  CLAIM_LINE: "Claim",
} as const

const PLACED_WORD: Record<ProjectDestination, string> = {
  ASSET: "Asset",
  PRE_OPENING: "Pre-opening",
  EXPENSE: "Expense",
}

const costKey = (cost: ProjectCost) => `${cost.source_kind}:${cost.source_id}`

/// Finance's tab: every bill, BKK and claim line the project gathered.
export function CostsTab({ page }: { page: GaProjectPage }) {
  const client = useQueryClient()
  const projectId = page.project.project_id
  const costs = useQuery(projectCostsQuery(projectId))
  const [adding, setAdding] = useState(false)
  const capitalised = page.project.status === "CAPITALISED"
  const unlink = useMutation({
    mutationFn: (cost: ProjectCost) =>
      linkProjectCost(projectId, cost.source_kind, cost.source_id, true),
    onSuccess: (next) => {
      client.setQueryData(projectKeys.costs(projectId), next)
      void client.invalidateQueries({ queryKey: projectKeys.candidates(projectId) })
    },
    onError: (error) => toast.error(error.message),
  })
  const rows = costs.data ?? []
  const total = rows.reduce((sum, cost) => sum + cost.amount_minor, 0)
  const by = (where: ProjectDestination) =>
    rows
      .filter((cost) => cost.placed === where)
      .reduce((sum, cost) => sum + cost.amount_minor, 0)
  const assetName = (id: string | null) =>
    page.assets.find((asset) => asset.asset_id === id)?.name

  return (
    <>
      <KpiStrip>
        <Kpi label="Collected" value={money(total)} />
        {capitalised ? (
          <>
            <Kpi label="To assets" value={money(by("ASSET"))} />
            <Kpi label="Pre-opening" value={money(by("PRE_OPENING"))} />
            <Kpi label="Expense" value={money(by("EXPENSE"))} />
          </>
        ) : (
          <>
            <Kpi label="Lines" value={rows.length} />
            <Kpi
              label="In CIP"
              value={money(
                rows.filter((c) => c.in_cip).reduce((s, c) => s + c.amount_minor, 0)
              )}
            />
          </>
        )}
      </KpiStrip>
      {!capitalised && (
        <div className="mb-3 flex justify-end">
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            Add costs
          </Button>
        </div>
      )}
      <Card className="overflow-hidden">
        {queryState(costs, {
          loading: "Reading the costs…",
          render: (lines) =>
            lines.length === 0 ? (
              <EmptyState>No cost yet.</EmptyState>
            ) : (
              <MiniTable
                head={[
                  { label: "Date", align: "left" },
                  { label: "From", align: "left" },
                  { label: "What", align: "left" },
                  "Amount",
                  { label: capitalised ? "Went to" : "Sits in", align: "left" },
                  ...(capitalised ? [] : [""]),
                ]}
              >
                {lines.map((cost) => (
                  <tr key={costKey(cost)} className="border-t border-hairline">
                    <MiniCell>{day(cost.dated)}</MiniCell>
                    <MiniCell>{SOURCE_WORD[cost.source_kind]}</MiniCell>
                    <MiniCell>
                      <span className="block truncate font-medium text-ink">
                        {cost.what ?? cost.document}
                      </span>
                      <span className="block truncate text-mute">
                        {[cost.document, cost.party].filter(Boolean).join(" · ")}
                      </span>
                    </MiniCell>
                    <MiniCell align="right">{money(cost.amount_minor)}</MiniCell>
                    <MiniCell>
                      {capitalised
                        ? cost.placed === "ASSET"
                          ? (assetName(cost.placed_asset_id) ?? "Asset")
                          : cost.placed
                            ? PLACED_WORD[cost.placed]
                            : "—"
                        : cost.in_cip
                          ? "Contract in Progress"
                          : (cost.account_code ?? "Expense")}
                    </MiniCell>
                    {!capitalised && (
                      <MiniCell align="right">
                        <Button
                          size="sm"
                          variant="primary"
                          pending={unlink.isPending && unlink.variables === cost}
                          onClick={() => unlink.mutate(cost)}
                        >
                          Remove
                        </Button>
                      </MiniCell>
                    )}
                  </tr>
                ))}
              </MiniTable>
            ),
        })}
      </Card>
      <AddCostsSheet
        open={adding}
        projectId={projectId}
        onClose={() => setAdding(false)}
      />
    </>
  )
}

/// The lines that could join: posted, in no project, in the project's books,
/// of the last six months.
function AddCostsSheet({
  open,
  projectId,
  onClose,
}: {
  open: boolean
  projectId: string
  onClose: () => void
}) {
  const client = useQueryClient()
  const candidates = useQuery({ ...projectCandidatesQuery(projectId), enabled: open })
  const [search, setSearch] = useState("")
  const add = useMutation({
    mutationFn: (cost: ProjectCost) =>
      linkProjectCost(projectId, cost.source_kind, cost.source_id),
    onSuccess: (next, cost) => {
      client.setQueryData(projectKeys.costs(projectId), next)
      client.setQueryData(
        projectKeys.candidates(projectId),
        (old: ProjectCost[] | undefined) =>
          old?.filter((one) => costKey(one) !== costKey(cost))
      )
      toast.success(`${cost.document} added`)
    },
    onError: (error) => toast.error(error.message),
  })
  const text = search.trim().toLowerCase()
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="table"
      context="Costs"
      title="Add costs"
    >
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search bills, BKKs and claims"
        className="mb-4"
      />
      {queryState(candidates, {
        loading: "Reading the lines…",
        render: (rows) => {
          const shown = rows.filter(
            (cost) =>
              text === "" ||
              `${cost.document} ${cost.party ?? ""} ${cost.what ?? ""}`
                .toLowerCase()
                .includes(text)
          )
          return shown.length === 0 ? (
            <EmptyState>No line of the last six months is free to add.</EmptyState>
          ) : (
            <MiniTable
              head={[
                { label: "Date", align: "left" },
                { label: "What", align: "left" },
                "Amount",
                "",
              ]}
            >
              {shown.map((cost) => (
                <tr key={costKey(cost)} className="border-t border-hairline">
                  <MiniCell>{day(cost.dated)}</MiniCell>
                  <MiniCell>
                    <span className="block truncate font-medium text-ink">
                      {cost.what ?? cost.document}
                    </span>
                    <span className="block truncate text-mute">
                      {[SOURCE_WORD[cost.source_kind], cost.document, cost.party]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </MiniCell>
                  <MiniCell align="right">{money(cost.amount_minor)}</MiniCell>
                  <MiniCell align="right">
                    <Button
                      size="sm"
                      variant="primary"
                      pending={add.isPending && add.variables === cost}
                      onClick={() => add.mutate(cost)}
                    >
                      Add
                    </Button>
                  </MiniCell>
                </tr>
              ))}
            </MiniTable>
          )
        },
      })}
    </Sheet>
  )
}

type Placing = { goes: string; account: string }

/// Capitalise: where every line goes, the day the assets go into service, and
/// the months the Pre-opening amortises over.
export function CapitaliseSheet({
  open,
  page,
  onClose,
}: {
  open: boolean
  page: GaProjectPage
  onClose: () => void
}) {
  const client = useQueryClient()
  const projectId = page.project.project_id
  const costs = useQuery({ ...projectCostsQuery(projectId), enabled: open })
  const [inUse, setInUse] = useState(page.project.opens_on ?? "")
  const [months, setMonths] = useState("12")
  const [placing, setPlacing] = useState<Record<string, Placing>>({})
  const [lives, setLives] = useState<Record<string, string>>({})
  const rows = useMemo(() => costs.data ?? [], [costs.data])
  const of = (cost: ProjectCost): Placing =>
    placing[costKey(cost)] ?? { goes: "", account: "" }
  const set = (cost: ProjectCost, next: Partial<Placing>) =>
    setPlacing((current) => ({
      ...current,
      [costKey(cost)]: { ...of(cost), ...next },
    }))
  const unplaced = rows.filter((cost) => {
    const p = of(cost)
    return p.goes === "" || (p.goes === "EXPENSE" && cost.in_cip && p.account.trim() === "")
  })
  const sum = (test: (goes: string) => boolean) =>
    rows.filter((cost) => test(of(cost).goes)).reduce((s, c) => s + c.amount_minor, 0)
  const save = useMutation({
    mutationFn: () =>
      capitaliseProject(projectId, {
        in_use_on: inUse,
        pre_opening_months: Number(months) || null,
        lines: rows.map((cost) => {
          const p = of(cost)
          const asset = p.goes.startsWith("asset:") ? p.goes.slice(6) : null
          return {
            source_kind: cost.source_kind,
            source_id: cost.source_id,
            goes_to: asset !== null ? "ASSET" : (p.goes as ProjectDestination),
            asset_id: asset,
            account_code: p.account.trim() === "" ? null : p.account.trim(),
          }
        }),
        lives: Object.entries(lives)
          .filter(([, value]) => Number(value) > 0)
          .map(([asset_id, value]) => ({ asset_id, useful_life_months: Number(value) })),
      }),
    onSuccess: (next) => {
      client.setQueryData(projectKeys.costs(projectId), next)
      void client.invalidateQueries({ queryKey: projectKeys.page(projectId) })
      void client.invalidateQueries({ queryKey: ["ga"] })
      toast.success(`Capitalised · ${page.assets.length} assets in use`)
      onClose()
    },
  })
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="wide"
      context={page.project.name}
      title="Capitalise"
      footer={
        <SheetFooter
          error={save.error}
          note={unplaced.length > 0 ? `${unplaced.length} lines still to place` : undefined}
          noteTone="warn"
          primary={{
            label: "Capitalise",
            onClick: () => save.mutate(),
            pending: save.isPending,
            disabled: unplaced.length > 0 || inUse === "" || rows.length === 0,
          }}
        />
      }
    >
      <div className="flex flex-col gap-6">
        <KpiStrip>
          <Kpi label="To assets" value={money(sum((g) => g.startsWith("asset:")))} />
          <Kpi label="Pre-opening" value={money(sum((g) => g === "PRE_OPENING"))} />
          <Kpi label="Expense" value={money(sum((g) => g === "EXPENSE"))} />
          <Kpi label="Not placed" value={unplaced.length} />
        </KpiStrip>
        <div className="grid grid-cols-2 gap-4">
          <Field label="In use from" required>
            <Day value={inUse} onChange={setInUse} clearable={false} />
          </Field>
          <Field label="Pre-opening over">
            <Select value={months} onChange={setMonths}>
              {["12", "24", "36"].map((m) => (
                <option key={m} value={m}>
                  {m} months
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {queryState(costs, {
          loading: "Reading the costs…",
          render: () => (
            <MiniTable
              head={[
                { label: "What", align: "left" },
                "Amount",
                { label: "Goes to", align: "left" },
              ]}
            >
              {rows.map((cost) => {
                const p = of(cost)
                return (
                  <tr key={costKey(cost)} className="border-t border-hairline">
                    <MiniCell>
                      <span className="block truncate font-medium text-ink">
                        {cost.what ?? cost.document}
                      </span>
                      <span className="block truncate text-mute">
                        {[SOURCE_WORD[cost.source_kind], cost.document, cost.party]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </MiniCell>
                    <MiniCell align="right">{money(cost.amount_minor)}</MiniCell>
                    <MiniCell className="w-[18rem]">
                      <Select value={p.goes} onChange={(next) => set(cost, { goes: next })}>
                        <option value="">Choose…</option>
                        {page.assets.map((asset) => (
                          <option key={asset.asset_id} value={`asset:${asset.asset_id}`}>
                            {asset.name}
                            {asset.quantity > 1 ? ` × ${asset.quantity}` : ""}
                          </option>
                        ))}
                        <option value="PRE_OPENING">Pre-opening</option>
                        <option value="EXPENSE">Expense</option>
                      </Select>
                      {p.goes === "EXPENSE" && cost.in_cip && (
                        <Input
                          className="mt-2"
                          value={p.account}
                          onChange={(event) => set(cost, { account: event.target.value })}
                          placeholder="Expense account"
                        />
                      )}
                    </MiniCell>
                  </tr>
                )
              })}
            </MiniTable>
          ),
        })}
        {page.assets.length > 0 && (
          <Field label="Useful life (months)">
            <div className="grid grid-cols-2 gap-3">
              {page.assets.map((asset) => (
                <label key={asset.asset_id} className="flex items-center gap-3 text-[0.9375rem]">
                  <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                  <Input
                    className="w-24"
                    inputMode="numeric"
                    value={lives[asset.asset_id] ?? ""}
                    onChange={(event) =>
                      setLives((current) => ({
                        ...current,
                        [asset.asset_id]: event.target.value.replace(/\D/g, ""),
                      }))
                    }
                    placeholder="Class"
                  />
                </label>
              ))}
            </div>
          </Field>
        )}
      </div>
    </Sheet>
  )
}
