import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Banner, EmptyState } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { nextKeys, readRules, setRule, useReach, type RuleView } from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"

/// The rule numbers, in one place.
///
/// Every figure a store reads and head office sets: tolerance for lateness,
/// the leave entitlement, overtime multipliers, claim ceilings, allowance
/// rates, the BPJS percentages. Reading is everybody's — a rule kept from the
/// people it governs is a trap rather than a rule — and setting is head
/// office's, with a reason, which is what the server records.
///
/// # Guidance, not law
///
/// A ceiling here is the amount a form suggests; a decider may exceed it at
/// their name. Nothing computes from these numbers, so none of them is a
/// figure a journal trusts — the honest boundary between "the rules a shop
/// reads" and "what payroll may do".

const GROUPS = [
  { value: "shift", label: "Shift & absensi" },
  { value: "leave", label: "Cuti" },
  { value: "overtime", label: "Lembur" },
  { value: "claim", label: "Klaim & uang muka" },
  { value: "pay", label: "Komponen gaji" },
  { value: "statutory", label: "BPJS & pajak" },
  { value: "benefit", label: "Benefit" },
] as const

export function Policies() {
  const reach = useReach()
  const [group, setGroup] = useState<string>("shift")
  const employer = reach.data?.role === "ADMIN"

  const rules = useQuery({
    queryKey: nextKeys.rules(group),
    queryFn: ({ signal }) => readRules({ group }, signal),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="People · Setup"
        title="Rule numbers"
        sub="One place for the figures every place is measured against. Toko membaca; perubahan dipakai langsung di absensi, cuti, lembur, klaim dan tampilan bonus."
      />

      <SubTabs tabs={GROUPS.map((g) => ({ value: g.value, label: g.label }))} value={group} onChange={setGroup} />

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>{GROUPS.find((g) => g.value === group)?.label}</CardTitle>
        </CardHeader>
        {queryState(rules, {
          loading: "Reading the rules…",
          render: () =>
            (rules.data ?? []).length === 0 ? (
              <EmptyState>No rule numbers in this group yet.</EmptyState>
            ) : (
              <div className="divide-y">
                {(rules.data ?? []).map((rule) => (
                  <RuleRow key={rule.key} rule={rule} editable={employer} />
                ))}
              </div>
            ),
        })}
      </Card>
    </PageContent>
  )
}

function RuleRow({ rule, editable }: { rule: RuleView; editable: boolean }) {
  const client = useQueryClient()
  const [value, setValue] = useState(String(rule.value))
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const save = useMutation({
    mutationFn: () => setRule(rule.key, { value: Number(value), reason }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: nextKeys.rules() })
      setEditing(false)
      setReason("")
      setFailed(null)
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const dirty = Number(value) !== rule.value || reason.trim() !== ""

  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-body">{rule.label}</p>
        <p className="font-mono text-meta text-mute">{rule.key}</p>
      </div>
      {editing ? (
        <div className="w-full max-w-md space-y-2">
          <Field label="New value">
            <Input
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
            />
          </Field>
          <Field label="Why it changes">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {failed ? <Banner tone="bad">{failed}</Banner> : null}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="quiet" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={value === "" || Number(value) < 0 || reason.trim() === "" || save.isPending}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-baseline gap-3">
          <span className="text-right tabular-nums">
            <span className="text-ink">{formatRule(rule)}</span>
            <span className="ml-1 text-meta text-mute">{rule.unit.toLowerCase()}</span>
          </span>
          {editable ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={dirty}
              onClick={() => {
                setValue(String(rule.value))
                setEditing(true)
              }}
            >
              Change
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}

function formatRule(rule: RuleView): string {
  return Number.isInteger(rule.value) ? rule.value.toLocaleString("id-ID") : String(rule.value)
}
