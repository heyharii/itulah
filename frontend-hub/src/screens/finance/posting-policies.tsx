import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmButton } from "@/components/ui/dialog"
import { Checkbox, Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { EmptyState, Problem } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { label, moment } from "@/lib/format"
import {
  financeKeys,
  listHeadOfficeAccounts,
  listSourceRules,
  postingSwitches,
  removeHeadOfficeAccount,
  removeSourceRule,
  setAutomaticPosting,
  setHeadOfficeAccount,
  setPostingSwitch,
  setSourceRule,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Code, Grid, Td, Th } from "@/screens/finance-final/parts"
import { AccountPicker, type PickedAccount } from "@/screens/finance/parts"
import type { PostingSwitch } from "@itulah/contract"

/// The owner's rules about posting, kept as data rather than code.
///
/// Three of them. Whether automatic posting runs at all, and per document
/// kind — the switch somebody reaches for while a flow is being fixed. Which
/// documents may reach which account — ALLOW narrows an account to the kinds
/// named, DENY keeps a kind out and wins. And which accounts belong to head
/// office alone, which a store's document is refused on.
const MODULES = [
  "SALES",
  "INVENTORY",
  "FINANCE",
  "PAYROLL",
  "ASSETS",
  "PURCHASING",
] as const

const HO_KINDS = [
  "SUPPLIER",
  "SERVICE",
  "BANK",
  "TAX",
  "BPJS",
  "LENDER",
  "OTHER",
] as const

type Tab = "switches" | "rules" | "head-office"

export function PostingPolicies() {
  const [tab, setTab] = useState<Tab>("switches")
  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Settings"
        title="Posting policies"
        sub="Whether automatic posting runs, which documents may reach which account, and which accounts belong to head office alone."
      />
      <SubTabs
        tabs={[
          { value: "switches", label: "Automatic posting" },
          { value: "rules", label: "Account source rules" },
          { value: "head-office", label: "Head-office accounts" },
        ]}
        value={tab}
        onChange={(next) => setTab(next as Tab)}
      />
      {tab === "switches" && <Switches />}
      {tab === "rules" && <SourceRules />}
      {tab === "head-office" && <HeadOfficeAccounts />}
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// Automatic posting
// ---------------------------------------------------------------------------

function Switches() {
  const client = useQueryClient()
  const switches = useQuery({
    queryKey: financeKeys.postingSwitches(),
    queryFn: ({ signal }) => postingSwitches(signal),
  })
  const [kind, setKind] = useState("")
  const [module, setModule] = useState<string>("FINANCE")

  const master = useMutation({
    mutationFn: (enabled: boolean) => setAutomaticPosting({ enabled }),
    onSuccess: (next) =>
      client.setQueryData(financeKeys.postingSwitches(), next),
  })
  const one = useMutation({
    mutationFn: (posting: PostingSwitch) => setPostingSwitch(posting),
    onSuccess: (next) => {
      client.setQueryData(financeKeys.postingSwitches(), next)
      setKind("")
    },
  })

  return queryState(switches, {
    loading: "Reading the switches…",
    render: (data) => {
      const byModule = new Map<string, PostingSwitch[]>()
      for (const row of data.sources) {
        const held = byModule.get(row.module)
        if (held === undefined) byModule.set(row.module, [row])
        else held.push(row)
      }
      return (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="text-card-title font-semibold text-ink">
                Automatic posting is{" "}
                {data.automatic_posting_enabled ? "on" : "off"}
              </div>
              <div className="text-[0.875rem] text-mute">
                Every automatic flow at once. Last changed by {data.changed_by}{" "}
                · {moment(data.changed_at)}
              </div>
            </div>
            <ConfirmButton
              label={
                data.automatic_posting_enabled
                  ? "Turn everything off"
                  : "Turn automatic posting on"
              }
              title={
                data.automatic_posting_enabled
                  ? "Stop every automatic posting?"
                  : "Start automatic posting?"
              }
              description={
                data.automatic_posting_enabled
                  ? "Sales days, stock movements, payroll, depreciation and every other flow stop writing to the books until this is turned back on. Nothing already posted changes."
                  : "Every flow whose own switch is on starts posting again."
              }
              confirmLabel={
                data.automatic_posting_enabled ? "Turn off" : "Turn on"
              }
              tone={data.automatic_posting_enabled ? "danger" : "primary"}
              variant={data.automatic_posting_enabled ? "danger" : "primary"}
              pending={master.isPending}
              onConfirm={() => master.mutate(!data.automatic_posting_enabled)}
            />
          </Card>
          <Problem error={master.error ?? one.error} />

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Per document kind</CardTitle>
            </CardHeader>
            {data.sources.length === 0 ? (
              <EmptyState>No document kind has a switch of its own.</EmptyState>
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th>Module</Th>
                    <Th>Document kind</Th>
                    <Th>Posts</Th>
                    <Th>Note</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...byModule.entries()].map(([group, rows]) =>
                    rows.map((row, index) => (
                      <tr key={row.source_kind}>
                        <Td>{index === 0 ? label(group) : ""}</Td>
                        <Td>
                          <Code>{row.source_kind}</Code>
                        </Td>
                        <Td>
                          <Checkbox
                            label={row.enabled ? "On" : "Off"}
                            checked={row.enabled}
                            disabled={
                              one.isPending || !data.automatic_posting_enabled
                            }
                            onChange={(enabled) =>
                              one.mutate({ ...row, enabled })
                            }
                          />
                        </Td>
                        <Td>
                          <span className="text-mute">{row.note ?? ""}</span>
                        </Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Grid>
            )}
            <div className="flex flex-wrap items-end gap-2 border-t border-hairline p-4">
              <Field label="Document kind" required className="w-56">
                <Input
                  value={kind}
                  onChange={(event) =>
                    setKind(event.target.value.toUpperCase())
                  }
                  placeholder="CASH_SHIFT"
                />
              </Field>
              <Field label="Module" className="w-44">
                <Select value={module} onChange={setModule}>
                  {MODULES.map((one) => (
                    <option key={one} value={one}>
                      {label(one)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                pending={one.isPending}
                disabled={kind.trim() === ""}
                onClick={() =>
                  one.mutate({
                    source_kind: kind.trim(),
                    module,
                    enabled: true,
                    note: null,
                  })
                }
              >
                Add a switch
              </Button>
            </div>
          </Card>
        </div>
      )
    },
  })
}

// ---------------------------------------------------------------------------
// Account source rules
// ---------------------------------------------------------------------------

function ChosenAccount({
  value,
  onChange,
}: {
  value: PickedAccount | null
  onChange: (next: PickedAccount | null) => void
}) {
  if (value === null) return <AccountPicker onPick={onChange} />
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Tag>{value.account_code}</Tag>
      <span className="min-w-0 flex-1 truncate text-[0.875rem] text-ink">
        {value.name}
      </span>
      <Button size="sm" variant="quiet" onClick={() => onChange(null)}>
        Change
      </Button>
    </span>
  )
}

function SourceRules() {
  const client = useQueryClient()
  const rules = useQuery({
    queryKey: financeKeys.sourceRules(),
    queryFn: ({ signal }) => listSourceRules(signal),
  })
  const [account, setAccount] = useState<PickedAccount | null>(null)
  const [kind, setKind] = useState("")
  const [effect, setEffect] = useState("ALLOW")
  const [category, setCategory] = useState("")
  const [note, setNote] = useState("")

  const add = useMutation({
    mutationFn: () =>
      setSourceRule({
        account_code: account!.account_code,
        source_kind: kind.trim().toUpperCase(),
        effect,
        category_code: category.trim() === "" ? null : category.trim(),
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: (rows) => {
      client.setQueryData(financeKeys.sourceRules(), rows)
      setAccount(null)
      setKind("")
      setCategory("")
      setNote("")
    },
  })
  const remove = useMutation({
    mutationFn: removeSourceRule,
    onSuccess: (rows) => client.setQueryData(financeKeys.sourceRules(), rows),
  })

  const sorted = useMemo(
    () =>
      [...(rules.data ?? [])].sort(
        (a, b) =>
          a.account_code.localeCompare(b.account_code) ||
          a.source_kind.localeCompare(b.source_kind)
      ),
    [rules.data]
  )

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <Card className="overflow-hidden">
        {queryState(rules, {
          loading: "Reading the rules…",
          render: () =>
            sorted.length === 0 ? (
              <EmptyState>
                No rule: every document kind may reach every account.
              </EmptyState>
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th>Account</Th>
                    <Th>Document kind</Th>
                    <Th>Effect</Th>
                    <Th>Category</Th>
                    <Th>Note</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((rule) => (
                    <tr
                      key={`${rule.account_code}\t${rule.source_kind}\t${rule.category_code ?? ""}`}
                    >
                      <Td>
                        <Code>{rule.account_code}</Code>
                      </Td>
                      <Td>
                        <Code>{rule.source_kind}</Code>
                      </Td>
                      <Td>
                        <Pill tone={rule.effect === "DENY" ? "bad" : "ok"}>
                          {label(rule.effect)}
                        </Pill>
                      </Td>
                      <Td>
                        {rule.category_code ?? (
                          <span className="text-faint">Any</span>
                        )}
                      </Td>
                      <Td>
                        <span className="text-mute">{rule.note ?? ""}</span>
                      </Td>
                      <Td align="right">
                        <Button
                          size="sm"
                          variant="quiet"
                          pending={remove.isPending}
                          onClick={() => remove.mutate(rule)}
                        >
                          Remove
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Grid>
            ),
        })}
        <Problem error={remove.error} className="m-3" />
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h3 className="text-card-title font-semibold text-ink">Add a rule</h3>
        <p className="text-[0.875rem] text-body">
          An account with any ALLOW takes only the kinds allowed. A DENY keeps a
          kind out, and wins over an ALLOW.
        </p>
        <Problem error={add.error} />
        <Field label="Account" required>
          <ChosenAccount value={account} onChange={setAccount} />
        </Field>
        <Field
          label="Document kind"
          required
          hint="journal_entry.source_kind, e.g. CASH_SHIFT"
        >
          <Input
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          />
        </Field>
        <Field label="Effect">
          <Select value={effect} onChange={setEffect}>
            <option value="ALLOW">Allow — only the kinds allowed</option>
            <option value="DENY">Deny — never this kind</option>
          </Select>
        </Field>
        <Field label="Category">
          <Input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
        </Field>
        <Field label="Note">
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <div className="flex justify-end">
          <Button
            variant="primary"
            pending={add.isPending}
            disabled={account === null || kind.trim() === ""}
            onClick={() => add.mutate()}
          >
            {add.isPending ? "Saving…" : "Save rule"}
          </Button>
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Head-office accounts
// ---------------------------------------------------------------------------

function HeadOfficeAccounts() {
  const client = useQueryClient()
  const accounts = useQuery({
    queryKey: financeKeys.headOfficeAccounts(),
    queryFn: ({ signal }) => listHeadOfficeAccounts(signal),
  })
  const [account, setAccount] = useState<PickedAccount | null>(null)
  const [kind, setKind] = useState<string>("SUPPLIER")
  const [note, setNote] = useState("")

  const add = useMutation({
    mutationFn: () =>
      setHeadOfficeAccount({
        account_code: account!.account_code,
        kind,
        note: note.trim(),
      }),
    onSuccess: (rows) => {
      client.setQueryData(financeKeys.headOfficeAccounts(), rows)
      setAccount(null)
      setNote("")
    },
  })
  const remove = useMutation({
    mutationFn: removeHeadOfficeAccount,
    onSuccess: (rows) =>
      client.setQueryData(financeKeys.headOfficeAccounts(), rows),
  })

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <Card className="overflow-hidden">
        {queryState(accounts, {
          loading: "Reading the head-office accounts…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                No account is kept for head office alone: a store's document may
                post to any account.
              </EmptyState>
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th>Account</Th>
                    <Th>Kind</Th>
                    <Th>Why</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.account_code}>
                      <Td>
                        <Code>{row.account_code}</Code>
                      </Td>
                      <Td>{label(row.kind)}</Td>
                      <Td>
                        <span className="text-body">{row.note}</span>
                      </Td>
                      <Td align="right">
                        <Button
                          size="sm"
                          variant="quiet"
                          pending={remove.isPending}
                          onClick={() => remove.mutate(row.account_code)}
                        >
                          Remove
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Grid>
            ),
        })}
        <Problem error={remove.error} className="m-3" />
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h3 className="text-card-title font-semibold text-ink">
          Keep an account for head office
        </h3>
        <p className="text-[0.875rem] text-body">
          A store's document that lands on it is refused: suppliers, banks, tax
          and lenders are head office's to settle.
        </p>
        <Problem error={add.error} />
        <Field label="Account" required>
          <ChosenAccount value={account} onChange={setAccount} />
        </Field>
        <Field label="Kind">
          <Select value={kind} onChange={setKind}>
            {HO_KINDS.map((one) => (
              <option key={one} value={one}>
                {label(one)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Why" required>
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <div className="flex justify-end">
          <Button
            variant="primary"
            pending={add.isPending}
            disabled={account === null || note.trim() === ""}
            onClick={() => add.mutate()}
          >
            {add.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </Card>
    </div>
  )
}
