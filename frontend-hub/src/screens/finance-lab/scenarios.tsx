import { ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { Tag } from "@/components/ui/tag"
import { cn } from "@/lib/utils"
import {
  Amount,
  Cell,
  CheckMark,
  EntryView,
  Row,
  Section,
  Table,
} from "@/screens/finance-lab/parts"
import type { ReconRow } from "@/screens/finance-lab/engine/depreciation"
import {
  SCENARIOS,
  World,
  type ScenarioResult,
} from "@/screens/finance-lab/engine/scenarios"

/// The acceptance scenarios, run in the browser, with every step shown.
///
/// This is the screen the whole module exists to make possible: eight flows
/// that either reproduce the client's own journal or refuse for a stated
/// reason, and a person can press each one and read what happened. A plan
/// document claims those things; this demonstrates them.
///
/// The runs happen on mount and are memoised. They are pure and take
/// milliseconds — there is no loading state because there is nothing to wait
/// for, and inventing a spinner for a synchronous function is a lie about
/// where the work is.
export function Scenarios() {
  const results = useMemo(() => {
    const out = new Map<string, ScenarioResult>()
    for (const s of SCENARIOS) {
      try {
        out.set(s.id, s.run(new World()))
      } catch (err) {
        out.set(s.id, {
          id: s.id,
          steps: [{ title: "The scenario threw", detail: String(err) }],
          checks: [
            { label: "The scenario ran", pass: false, actual: String(err) },
          ],
          passed: false,
        })
      }
    }
    return out
  }, [])

  const [openId, setOpenId] = useState<string>("A")
  const open = SCENARIOS.find((s) => s.id === openId)
  const openResult = results.get(openId)

  const totalChecks = [...results.values()].reduce(
    (n, r) => n + r.checks.length,
    0
  )
  const failed = [...results.values()].reduce(
    (n, r) => n + r.checks.filter((c) => !c.pass).length,
    0
  )

  return (
    <PageContent>
      <PageHeader crumb="Finance" title="Acceptance scenarios" />

      <div
        className={cn(
          "mb-5 rounded-[0.8125rem] border px-3.5 py-3",
          failed === 0
            ? "border-ok-fg/25 bg-ok-bg/50"
            : "border-bad-fg/25 bg-bad-bg/50"
        )}
      >
        <div className="text-[0.9375rem] font-semibold text-ink">
          {totalChecks - failed} of {totalChecks} checks pass
        </div>
        <p className="mt-0.5 text-[0.875rem] text-body">
          {failed === 0
            ? "Every scenario reproduces what it claims, including the six that must be refused. This proves the contract, not the production ledger — see Kontrak for what is still blocked."
            : `${failed} checks fail. A failing check is a defect in the rule, the binding or the fixture, and the expected and actual figures are shown beside it.`}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <Card className="h-max overflow-hidden">
          <ul>
            {SCENARIOS.map((s) => {
              const r = results.get(s.id)
              const bad = r ? r.checks.filter((c) => !c.pass).length : 0
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(s.id)}
                    className={cn(
                      "flex w-full items-start gap-2.5 border-b border-hairline/60 px-3 py-2.5 text-left last:border-0",
                      openId === s.id ? "bg-accent-bg" : "hover:bg-soft-1"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md text-[0.875rem] font-semibold",
                        bad === 0
                          ? "bg-ok-bg text-ok-fg"
                          : "bg-bad-bg text-bad-fg"
                      )}
                    >
                      {s.letter}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.875rem] font-medium text-ink">
                        {s.title}
                      </span>
                      <span className="block text-[0.875rem] text-mute">
                        {r
                          ? `${r.checks.length - bad}/${r.checks.length} checks`
                          : "—"}
                      </span>
                    </span>
                    <ChevronRight className="mt-1 size-3.5 shrink-0 text-faint" />
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>

        <div className="min-w-0">
          {open && openResult && (
            <ScenarioDetail scenario={open} result={openResult} />
          )}
        </div>
      </div>
    </PageContent>
  )
}

function ScenarioDetail({
  scenario,
  result,
}: {
  scenario: (typeof SCENARIOS)[number]
  result: ScenarioResult
}) {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-[1.0625rem] font-semibold text-ink">
          {scenario.letter}. {scenario.title}
        </h2>
      </div>

      <Section title="What happened">
        <ol className="space-y-3">
          {result.steps.map((s, i) => (
            <li key={i}>
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className="inline-flex size-[1.125rem] shrink-0 items-center justify-center rounded-full bg-soft-2 text-[0.875rem] font-semibold text-body">
                  {i + 1}
                </span>
                <span className="text-[0.875rem] font-medium text-ink">
                  {s.title}
                </span>
              </div>
              {s.detail && (
                <p className="mb-1.5 pl-6 text-[0.875rem] text-body">
                  {s.detail}
                </p>
              )}
              {s.refusal && <div className="pl-6"></div>}
              {s.entry && (
                <div className="pl-6">
                  <EntryView entry={s.entry} />
                </div>
              )}
            </li>
          ))}
        </ol>
      </Section>

      {result.extra?.recon ? <Reconciliation extra={result.extra} /> : null}
      {result.extra?.disagreement ? (
        <Disagreement extra={result.extra} />
      ) : null}

      <Section
        title="What was checked"
        sub="Every line is a claim that can fail."
      >
        <>
          <Table head={["", "Check", "Expected", "Actual"]}>
            {result.checks.map((c, i) => (
              <Row key={i} tone={c.pass ? undefined : "bad"}>
                <Cell className="w-8">
                  <CheckMark pass={c.pass} />
                </Cell>
                <Cell>
                  <span className="text-ink">{c.label}</span>
                  {c.note && (
                    <div className="text-[0.875rem] text-mute">{c.note}</div>
                  )}
                </Cell>
                <Cell className="text-body">{c.expected ?? "—"}</Cell>
                <Cell
                  className={c.pass ? "text-body" : "font-semibold text-bad-fg"}
                >
                  {c.actual ?? "—"}
                </Cell>
              </Row>
            ))}
          </Table>
        </>
      </Section>
    </div>
  )
}

function Reconciliation({ extra }: { extra: Record<string, unknown> }) {
  const recon = extra.recon as {
    rows: readonly ReconRow[]
    computedTotal: number
    actualTotal: number
  }
  return (
    <Section title="Reconciliation terhyesp GL-26-07-00004">
      <>
        <Table head={["Asset", ">Replay", ">Klien", "", "Note"]}>
          {recon.rows.map((r, i) => (
            <Row key={i} tone={r.matched ? undefined : "warn"}>
              <Cell>{r.label}</Cell>
              <Cell right>
                <Amount minor={r.computed} muted />
              </Cell>
              <Cell right>
                <Amount minor={r.actual} muted />
              </Cell>
              <Cell className="w-8">
                <CheckMark pass={r.matched} />
              </Cell>
              <Cell className="text-mute">{r.note ?? "exact match"}</Cell>
            </Row>
          ))}
          <Row className="border-t border-hairline font-semibold">
            <Cell>Total</Cell>
            <Cell right>
              <Amount minor={recon.computedTotal} />
            </Cell>
            <Cell right>
              <Amount minor={recon.actualTotal} />
            </Cell>
            <Cell colSpan={2} />
          </Row>
        </Table>
      </>
    </Section>
  )
}

function Disagreement({ extra }: { extra: Record<string, unknown> }) {
  const rows = extra.disagreement as readonly {
    source: string
    amount: string
    unit: string
    note: string
  }[]
  return (
    <Section title="Three sources that disagree">
      <>
        <Table head={["Source", "Value", "Unit", "Note"]}>
          {rows.map((r, i) => (
            <Row key={i} tone="warn">
              <Cell>{r.source}</Cell>
              <Cell className="font-semibold text-ink">{r.amount}</Cell>
              <Cell>
                <Tag tone={r.unit === "HO" ? "warn" : "neutral"}>{r.unit}</Tag>
              </Cell>
              <Cell className="text-mute">{r.note}</Cell>
            </Row>
          ))}
        </Table>
      </>
    </Section>
  )
}
