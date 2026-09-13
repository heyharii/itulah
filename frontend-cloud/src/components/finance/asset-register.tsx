import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { FinanceNav } from "@/components/finance/finance-nav"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import {
  assessAsset,
  financeKeys,
  listAssets,
  runDepreciation,
  type StatementKind,
} from "@/lib/finance"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { AssetRow, DepreciationRun } from "@itulah/contract"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CircleDashed, Play, TriangleAlert } from "lucide-react"
import { useState } from "react"

/// What the company owns, and what Finance has decided about it.
///
/// # Why "not assessed" is a state and not a blank
///
/// An asset with no decision against it is an open control gap: nobody has
/// looked at whether it belongs in the books. An asset decided to be an expense
/// is a closed one. A register that showed both as empty cells would hide the
/// first behind the second, so unassessed rows are marked, counted in the
/// header, and filterable on their own — that list is the work.
///
/// # Why the money is not on the asset
///
/// Operations registers the thing; Finance decides the number. The cost, life
/// and method live on an assessment, appended, and the newest one is in force.
/// A wrong assessment is corrected by recording another, never by editing —
/// "expensed in January, capitalised in March" is itself the audit trail.
export function AssetRegisterScreen() {
  const client = useQueryClient()
  const [onlyUnassessed, setOnlyUnassessed] = useState(false)
  const [run, setRun] = useState<DepreciationRun | null>(null)

  const assets = useQuery({
    queryKey: financeKeys.assets(undefined, onlyUnassessed),
    queryFn: ({ signal }) =>
      listAssets({ unassessed: onlyUnassessed }, signal).then((page) => page.rows),
  })

  const now = new Date()
  const depreciate = useMutation({
    mutationFn: () => runDepreciation(now.getFullYear(), now.getMonth() + 1),
    onSuccess: (result) => {
      setRun(result)
      void client.invalidateQueries({ queryKey: ["finance"] })
    },
  })

  const rows = assets.data ?? []
  const unassessed = rows.filter((row) => row.decision === null).length
  const capitalised = rows.filter((row) => row.decision === "CAPITALIZE")
  const bookValue = capitalised.reduce((sum, row) => sum + (row.book_value_minor ?? 0), 0)

  return (
    <AppShell nav={<Nav />} section={<FinanceNav />}>
      <ScreenHeader
        title="Asset Register"
        subtitle={rows.length === 0 ? undefined : `${rows.length} assets · ${money(bookValue)} book value`}
      >
        <Button
          size="sm"
          variant={onlyUnassessed ? "default" : "outline"}
          className="h-7 text-[12px]"
          onClick={() => setOnlyUnassessed((was) => !was)}
        >
          Not assessed{unassessed > 0 && ` (${unassessed})`}
        </Button>
        <Button
          size="sm"
          className="h-7 gap-1 text-[12px]"
          disabled={depreciate.isPending}
          onClick={() => depreciate.mutate()}
        >
          <Play className="size-3" />
          Run {now.toLocaleString("en", { month: "long" })}
        </Button>
      </ScreenHeader>

      {depreciate.error !== null && (
        <p className="text-destructive shrink-0 border-b px-3.5 py-2 text-[12px]">
          {depreciate.error instanceof Error
            ? depreciate.error.message
            : "the run could not start"}
        </p>
      )}
      {run !== null && <RunReport run={run} onDismiss={() => setRun(null)} />}

      <ScreenBody>
        {assets.isPending ? (
          <ScreenState>Loading the register…</ScreenState>
        ) : assets.error !== null ? (
          <ScreenState tone="problem">
            {assets.error instanceof Error ? assets.error.message : "could not load assets"}
          </ScreenState>
        ) : rows.length === 0 ? (
          <ScreenState>
            {onlyUnassessed
              ? "Every asset has been assessed."
              : "Nothing is registered yet. An asset is registered by Operations — what it is and where — and Finance decides separately whether it belongs in the books."}
          </ScreenState>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-card sticky top-0 border-b">
              <tr className="text-muted-foreground text-[11px]">
                <th className="px-3.5 py-1.5 text-left font-medium">Asset</th>
                <th className="px-3 py-1.5 text-left font-medium">Category</th>
                <th className="px-3 py-1.5 text-left font-medium">Site</th>
                <th className="px-3 py-1.5 text-left font-medium">Treatment</th>
                <th className="px-3 py-1.5 text-right font-medium">Cost</th>
                <th className="px-3 py-1.5 text-right font-medium">Depreciated</th>
                <th className="px-3 py-1.5 text-right font-medium">Book value</th>
                <th className="px-3 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <AssetLine key={row.asset_id} row={row} />
              ))}
            </tbody>
          </table>
        )}
      </ScreenBody>
    </AppShell>
  )
}

function AssetLine({ row }: { row: AssetRow }) {
  const client = useQueryClient()
  const [assessing, setAssessing] = useState(false)
  const assess = useMutation({
    mutationFn: (body: Parameters<typeof assessAsset>[1]) => assessAsset(row.asset_id, body),
    onSuccess: () => {
      setAssessing(false)
      void client.invalidateQueries({ queryKey: ["finance", "assets"] })
    },
  })
  const unassessed = row.decision === null

  return (
    <>
      <tr className={cn("hover:bg-muted/40 border-b", unassessed && "bg-amber-50/40")}>
        <td className="px-3.5 py-1">
          <span className="text-muted-foreground font-mono text-[11px]">
            {row.asset_number}
          </span>{" "}
          {row.name}
        </td>
        <td className="text-muted-foreground px-3 py-1">
          <span className="font-mono text-[10.5px]">{row.category_code}</span>{" "}
          {row.category_name}
        </td>
        <td className="text-muted-foreground px-3 py-1 font-mono text-[11px]">
          {row.site_id}
        </td>
        <td className="px-3 py-1">
          {unassessed ? (
            <span className="flex items-center gap-1 text-amber-700">
              <CircleDashed className="size-3" /> not assessed
            </span>
          ) : (
            <span className="text-muted-foreground">
              {row.decision === "CAPITALIZE"
                ? `capitalised · ${methodLabel(row.method)} · ${row.useful_life_months} mo`
                : "expensed"}
            </span>
          )}
        </td>
        <td className="px-3 py-1 text-right font-mono tabular-nums">
          {row.capitalized_cost_minor === null ? "–" : money(row.capitalized_cost_minor)}
        </td>
        <td className="px-3 py-1 text-right font-mono tabular-nums">
          {row.accumulated_minor === 0 ? "–" : money(row.accumulated_minor)}
        </td>
        <td className="px-3 py-1 text-right font-mono tabular-nums">
          {row.book_value_minor === null ? "–" : money(row.book_value_minor)}
        </td>
        <td className="px-3 py-1 text-right">
          <Button
            size="sm"
            variant={unassessed ? "default" : "ghost"}
            className="h-6 px-2 text-[11px]"
            onClick={() => setAssessing((was) => !was)}
          >
            {assessing ? "Cancel" : unassessed ? "Assess" : "Reassess"}
          </Button>
        </td>
      </tr>
      {assessing && (
        <tr>
          <td colSpan={8} className="bg-muted/40 px-3.5 py-2">
            <AssessForm
              onSubmit={(body) => assess.mutate(body)}
              busy={assess.isPending}
              error={
                assess.error instanceof Error ? assess.error.message : null
              }
            />
          </td>
        </tr>
      )}
    </>
  )
}

function methodLabel(method: string | null): string {
  switch (method) {
    case "STRAIGHT_LINE":
      return "Garis Lurus"
    case "DECLINING":
      return "Saldo Menurun"
    case "NONE":
      return "Tidak Disusutkan"
    default:
      return "—"
  }
}

/// Finance's decision, and everything a schedule needs to be complete.
///
/// Capitalising demands the whole basis at once — cost, salvage, life, method,
/// in-service date. Half a basis is what makes a depreciation run guess, and
/// the database refuses it anyway; asking for all of it here means the refusal
/// never has to happen.
function AssessForm({
  onSubmit,
  busy,
  error,
}: {
  onSubmit: (body: {
    decision: string
    capitalized_cost_minor: number | null
    salvage_value_minor: number | null
    useful_life_months: number | null
    method: string | null
    in_service_on: string | null
    reason: string
  }) => void
  busy: boolean
  error: string | null
}) {
  const [capitalise, setCapitalise] = useState(true)
  const [cost, setCost] = useState("")
  const [salvage, setSalvage] = useState("0")
  const [months, setMonths] = useState("60")
  const [method, setMethod] = useState("STRAIGHT_LINE")
  const [inService, setInService] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState("")

  const submit = () =>
    onSubmit(
      capitalise
        ? {
            decision: "CAPITALIZE",
            capitalized_cost_minor: Number(cost) || 0,
            salvage_value_minor: Number(salvage) || 0,
            useful_life_months: Number(months) || 0,
            method,
            in_service_on: inService,
            reason: reason.trim(),
          }
        : {
            decision: "EXPENSE",
            capitalized_cost_minor: null,
            salvage_value_minor: null,
            useful_life_months: null,
            method: null,
            in_service_on: null,
            reason: reason.trim(),
          },
    )

  return (
    <div className="space-y-2 text-[12px]">
      <div className="flex gap-1">
        {[true, false].map((choice) => (
          <button
            key={String(choice)}
            type="button"
            onClick={() => setCapitalise(choice)}
            className={cn(
              "rounded-md px-2 py-1",
              capitalise === choice ? "bg-foreground text-background" : "hover:bg-muted",
            )}
          >
            {choice ? "Capitalise" : "Expense"}
          </button>
        ))}
      </div>

      {capitalise && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Field label="Cost (minor)" value={cost} onChange={setCost} placeholder="12000000" />
          <Field label="Salvage" value={salvage} onChange={setSalvage} />
          <Field label="Life (months)" value={months} onChange={setMonths} />
          <label className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-[10.5px]">Method</span>
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              className="h-7 rounded-md border px-1.5 text-[12px]"
            >
              <option value="STRAIGHT_LINE">Garis Lurus</option>
              <option value="DECLINING">Saldo Menurun</option>
              <option value="NONE">Tidak Disusutkan</option>
            </select>
          </label>
          <Field label="In service" value={inService} onChange={setInService} />
        </div>
      )}

      {/* Required on both decisions. An expensed asset with no reason is the one
          somebody queries a year later and nobody can answer. */}
      <Field
        label="Why — required, and the only record of the decision"
        value={reason}
        onChange={setReason}
        placeholder="di bawah batas kapitalisasi"
      />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-6 px-2 text-[11px]"
          disabled={busy || reason.trim() === ""}
          onClick={submit}
        >
          Record
        </Button>
        {error !== null && <span className="text-destructive text-[11px]">{error}</span>}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-[10.5px]">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 rounded-md border px-1.5 text-[12px]"
      />
    </label>
  )
}

/// What the run did, asset by asset — including what it did not do and why.
///
/// The skips are the point. A run that reported only its postings would leave
/// somebody to work out for themselves why eleven of thirty assets produced
/// nothing, and the answers are all different: one is land, one is already at
/// salvage, one rounds to nothing this month, one was charged an hour ago.
function RunReport({ run, onDismiss }: { run: DepreciationRun; onDismiss: () => void }) {
  return (
    <section className="shrink-0 border-b bg-muted/30 px-3.5 py-2">
      <div className="flex items-baseline gap-2 text-[12px]">
        <span className="font-medium">{run.period_month}</span>
        <span>
          posted {run.posted_count} · {money(run.posted_total_minor)}
        </span>
        {run.skipped_count > 0 && (
          <span className="text-muted-foreground">skipped {run.skipped_count}</span>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted-foreground ml-auto text-[11px] hover:underline"
        >
          dismiss
        </button>
      </div>
      {run.skipped_count > 0 && (
        <ul className="text-muted-foreground pt-1 text-[11.5px]">
          {run.lines
            .filter((line) => line.skipped_because !== null)
            .map((line) => (
              <li key={line.asset_id} className="flex items-baseline gap-1.5">
                <TriangleAlert className="size-3 shrink-0 text-amber-600" />
                <span className="font-mono text-[10.5px]">{line.asset_number}</span>
                <span>{line.skipped_because}</span>
              </li>
            ))}
        </ul>
      )}
    </section>
  )
}

export type { StatementKind }
