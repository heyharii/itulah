import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmButton, Panel } from "@/components/ui/dialog"
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { count } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  evaluateBankRules,
  financeKeys,
  listBankRules,
  listTransactionCategories,
  recordBankRule,
  retireBankRule,
  updateBankRule,
} from "@/lib/queries/finance"
import { Code, Grid, Td, Th } from "@/screens/finance-final/parts"
import { useMeaningLabel } from "@/screens/finance/hooks"
import { UnitName, UnitSelect } from "@/screens/finance/parts"
import type {
  BankRuleRow,
  BankRuleRunOutcome,
  RecordBankRuleRequest,
  TransactionCategoryRow,
} from "@itulah/contract"

/// The rules that recognise a bank line, in the order they are tried.
///
/// # What a rule is
///
/// "When the description contains BIAYA ADM, it is a bank charge." A rule
/// reads the narration of a line nobody has matched, and names what the line
/// MEANS — a transaction category, which already knows the account it books
/// to. It does not name an account itself: repoint the category the day the
/// account moves and every rule that uses it follows, where a rule holding its
/// own account would go on proposing the old one and still look reasonable.
///
/// # A rule proposes. Nothing here posts.
///
/// Applying the rules writes proposals and stops; a person accepts or ignores
/// each one on Bank Reconciliation, and accepting is what creates the cash
/// document. So this screen has no "post" anywhere on it, and "Apply rules
/// now" is safe to press as often as somebody likes.
///
/// # What is warned about on the row
///
/// Two things, because both are rules that look fine and do nothing useful: a
/// category nobody may choose from a bank line (the rule can only ever
/// produce refusals), and a meaning nobody has mapped to an account in that
/// unit's books yet (the proposal cannot say where it would book).
///
/// Retiring is the only way to stop a rule. A proposal names the rule that
/// made it, and "why was this booked there" has to keep an answer.
export function BankRules() {
  const [showRetired, setShowRetired] = useState(false)
  const [editing, setEditing] = useState<BankRuleRow | "new" | null>(null)
  const [outcome, setOutcome] = useState<BankRuleRunOutcome | null>(null)
  const client = useQueryClient()
  const meaning = useMeaningLabel()

  const rules = useQuery({
    queryKey: financeKeys.bankRules(showRetired),
    queryFn: ({ signal }) =>
      listBankRules({ include_retired: showRetired }, signal),
  })

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["finance", "bank-rules"] })
    // Proposals carry the rule's counts and the screens that list them are
    // the reconciliation ones.
    void client.invalidateQueries({ queryKey: ["finance", "bank-proposals"] })
  }

  const apply = useMutation({
    mutationFn: () => evaluateBankRules(),
    onSuccess: (result) => {
      setOutcome(result)
      refresh()
    },
  })

  const retire = useMutation({
    mutationFn: (ruleId: string) => retireBankRule(ruleId),
    onSuccess: refresh,
  })

  // The server orders active rules first, lowest priority first; a retired
  // rule shown on request sits after them, which is where it belongs.
  const rows = rules.data ?? []
  const active = rows.filter((row) => row.active).length

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Banking"
        title="Bank Rules"
        actions={
          <>
            <Button
              pending={apply.isPending}
              disabled={active === 0}
              onClick={() => apply.mutate()}
            >
              {apply.isPending ? "Applying…" : "Apply rules now"}
            </Button>
            <Button variant="primary" onClick={() => setEditing("new")}>
              New rule
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3">
        {/* Retire reports its own failure inside its confirmation. */}
        <Problem error={apply.error} />

        {outcome !== null && (
          <Banner
            tone={outcome.proposed > 0 ? "ok" : "info"}
            onDismiss={() => setOutcome(null)}
          >
            {outcome.proposed > 0 ? (
              <>
                {count(outcome.proposed)}{" "}
                {outcome.proposed === 1 ? "proposal" : "proposals"} made from{" "}
                {count(outcome.examined)} open{" "}
                {outcome.examined === 1 ? "line" : "lines"}.{" "}
                <AppLink
                  to="/finance/cash-bank/bank-reconciliation"
                  className="font-medium underline underline-offset-2"
                >
                  Review them in Bank Reconciliation
                </AppLink>
              </>
            ) : (
              <>
                No new proposals from {count(outcome.examined)} open{" "}
                {outcome.examined === 1 ? "line" : "lines"}.
              </>
            )}{" "}
            {outcome.unrecognised > 0 &&
              `${count(outcome.unrecognised)} not recognised by any rule.`}
          </Banner>
        )}

        <Toolbar className="mb-0">
          <Checkbox
            label="Show retired"
            checked={showRetired}
            onChange={setShowRetired}
          />
          <Toolbar.Spacer />
          <span className="text-[0.875rem] text-mute">
            {count(active)} active {active === 1 ? "rule" : "rules"} · lowest
            priority is tried first
          </span>
        </Toolbar>

        <Card className="overflow-hidden">
          {queryState(rules, {
            loading: "Reading the rules…",
            render: () =>
              rows.length === 0 ? (
                <EmptyState
                  action={
                    <Button variant="primary" onClick={() => setEditing("new")}>
                      New rule
                    </Button>
                  }
                >
                  No rule yet. A rule recognises a bank line you see every month
                  — a charge, interest, a tax — and proposes what it is.
                </EmptyState>
              ) : (
                <Grid>
                  <thead>
                    <tr>
                      <Th align="right" width="5.5rem">
                        Priority
                      </Th>
                      <Th>When the description…</Th>
                      <Th width="6.5rem">Direction</Th>
                      <Th>Records as</Th>
                      <Th width="9rem">Unit</Th>
                      <Th align="right" width="8rem">
                        Used
                      </Th>
                      <Th width="6.5rem">Active</Th>
                      <Th width="11rem" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.rule_id}>
                        <Td align="right">{row.priority}</Td>
                        <Td>
                          <span className="text-mute">
                            {MATCH_VERB[row.match_kind] ?? row.match_kind}
                          </span>{" "}
                          <span className="font-mono text-[0.875rem] text-ink">
                            {row.pattern}
                          </span>
                          {row.party !== null && (
                            <span className="block text-[0.875rem] text-mute">
                              Party: {row.party}
                            </span>
                          )}
                        </Td>
                        <Td>{DIRECTION[row.direction] ?? row.direction}</Td>
                        <Td>
                          <RecordsAs row={row} meaning={meaning} />
                        </Td>
                        <Td>
                          <UnitName id={row.unit_id} />
                        </Td>
                        <Td align="right">
                          {/* A rule with proposals and no acceptances is one
                              people keep saying no to — say so in words,
                              beside the figure. */}
                          {row.proposed_count === 0 ? (
                            <span className="text-mute">Never</span>
                          ) : (
                            <>
                              {count(row.accepted_count)}
                              <span className="text-mute">
                                {" "}
                                of {count(row.proposed_count)}
                              </span>
                            </>
                          )}
                        </Td>
                        <Td>
                          {row.active ? (
                            <span className="text-mute">Active</span>
                          ) : (
                            <Pill tone="neutral">Retired</Pill>
                          )}
                        </Td>
                        <Td align="right">
                          {row.active && (
                            <span className="inline-flex items-center gap-1.5">
                              <Button size="sm" onClick={() => setEditing(row)}>
                                Edit
                              </Button>
                              <ConfirmButton
                                size="sm"
                                variant="quiet"
                                label="Retire"
                                title={`Retire the rule for “${row.pattern}”?`}
                                description="It stops proposing from the next run. Proposals it already made stay, and keep naming this rule."
                                confirmLabel="Retire rule"
                                tone="danger"
                                onConfirm={() =>
                                  retire.mutateAsync(row.rule_id)
                                }
                              />
                            </span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Grid>
              ),
          })}
        </Card>
      </div>

      <Panel
        open={editing !== null}
        onOpenChange={(next) => !next && setEditing(null)}
        title={editing === "new" ? "New rule" : "Edit rule"}
        sub="When a bank line's description matches, propose what it is. Nothing posts until somebody accepts."
      >
        {editing !== null && (
          <RuleForm
            key={editing === "new" ? "new" : editing.rule_id}
            rule={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null)
              refresh()
            }}
          />
        )}
      </Panel>
    </PageContent>
  )
}

const MATCH_VERB: Readonly<Record<string, string>> = {
  CONTAINS: "contains",
  STARTS_WITH: "starts with",
  REGEX: "matches",
}

/// As the bank reports the line: money in, money out, or either.
const DIRECTION: Readonly<Record<string, string>> = {
  IN: "In",
  OUT: "Out",
  ANY: "Any",
}

/// The category the rule means, and the account that resolves to in its
/// unit's books today — both read through the map on every fetch, so a
/// remapped account shows here without anybody editing the rule.
function RecordsAs({
  row,
  meaning,
}: {
  row: BankRuleRow
  meaning: (key: string | null | undefined) => string
}) {
  // A rule written before there was a category list may name a meaning
  // directly; it is shown the way the account map names it.
  const name =
    row.category_name ??
    (row.semantic_key === null ? "—" : meaning(row.semantic_key))
  return (
    <>
      <span className="text-ink">{name}</span>
      <span className="block text-[0.875rem]">
        {row.account_code === null ? (
          <span className="text-warn-fg">
            No account mapped in this unit yet
          </span>
        ) : (
          <>
            <Code>{row.account_code}</Code>
            <span className="text-mute"> · {row.account_name}</span>
          </>
        )}
        {row.category_refuses && (
          <span className="block text-warn-fg">
            A bank line cannot book this category, so every proposal is refused
          </span>
        )}
      </span>
    </>
  )
}

function RuleForm({
  rule,
  onDone,
}: {
  rule: BankRuleRow | null
  onDone: () => void
}) {
  const [matchKind, setMatchKind] = useState(rule?.match_kind ?? "CONTAINS")
  const [pattern, setPattern] = useState(rule?.pattern ?? "")
  const [direction, setDirection] = useState(rule?.direction ?? "ANY")
  const [category, setCategory] = useState(rule?.category_code ?? "")
  const [party, setParty] = useState(rule?.party ?? "")
  // "" is head office's books, which the server picks.
  const [unit, setUnit] = useState(rule?.unit_id ?? "")
  const [priority, setPriority] = useState(
    rule === null ? "" : String(rule.priority)
  )
  const [note, setNote] = useState(rule?.note ?? "")
  const [active, setActive] = useState(rule?.active ?? true)

  const categories = useQuery({
    queryKey: financeKeys.transactionCategories(),
    queryFn: ({ signal }) => listTransactionCategories({}, signal),
    staleTime: 5 * 60_000,
  })

  // A rule that reads money going out proposes an outflow category; offering
  // an inflow one beside it is a choice the server will accept and no line
  // will ever match. The current one stays in the list whatever the direction,
  // so editing never silently blanks it.
  const options = useMemo(
    () =>
      (categories.data ?? []).filter(
        (one) =>
          one.code === rule?.category_code || fitsDirection(one, direction)
      ),
    [categories.data, direction, rule?.category_code]
  )
  const chosen = options.find((one) => one.code === category)

  const client = useQueryClient()
  const save = useMutation({
    mutationFn: () => {
      // A category or a bare meaning, never both. Leaving the category empty
      // on a rule that has a meaning of its own keeps that meaning; choosing
      // a category replaces it.
      const meaningKey = category === "" ? (rule?.semantic_key ?? null) : null
      const request: RecordBankRuleRequest = {
        priority: parsePriority(priority),
        match_kind: matchKind,
        pattern: pattern.trim(),
        direction,
        category_code: category === "" ? null : category,
        semantic_key: meaningKey,
        qualifier: meaningKey === null ? "" : (rule?.qualifier ?? ""),
        unit_id: unit === "" ? null : unit,
        party: party.trim() === "" ? null : party.trim(),
        active,
        note: note.trim() === "" ? null : note.trim(),
      }
      return rule === null
        ? recordBankRule(request)
        : updateBankRule(rule.rule_id, request)
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["finance", "bank-rules"] })
      onDone()
    },
  })

  const priorityValid = priority === "" || parsePriority(priority) !== null
  const meaningOnly = category === "" && (rule?.semantic_key ?? null) !== null
  const ready =
    pattern.trim() !== "" && priorityValid && (category !== "" || meaningOnly)

  return (
    <div className="flex flex-col gap-3">
      <Problem error={save.error} />

      <div className="grid gap-3 md:grid-cols-[11rem_minmax(0,1fr)]">
        <Field label="Match" required>
          <Select value={matchKind} onChange={setMatchKind} aria-label="Match">
            <option value="CONTAINS">Contains</option>
            <option value="STARTS_WITH">Starts with</option>
            <option value="REGEX">Regex</option>
          </Select>
        </Field>
        <Field
          label="Text"
          required
          hint={
            matchKind === "REGEX"
              ? "A POSIX pattern, not case sensitive. One the database cannot read is refused when you save."
              : "Not case sensitive. Spaces and punctuation are ignored when comparing."
          }
        >
          <Input
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            className="font-mono"
          />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Direction" hint="As the bank reports the line.">
          <Select
            value={direction}
            onChange={setDirection}
            aria-label="Direction"
          >
            <option value="ANY">Any</option>
            <option value="IN">In — money received</option>
            <option value="OUT">Out — money paid</option>
          </Select>
        </Field>
        <Field
          label="Category"
          required
          aside={
            meaningOnly
              ? "Keeps its own meaning until you choose one"
              : undefined
          }
        >
          <Select value={category} onChange={setCategory} aria-label="Category">
            {options.map((one) => (
              <option key={one.code} value={one.code}>
                {one.display_name}
                {one.bank_postable ? "" : " — not for bank lines"}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {chosen !== undefined && !chosen.bank_postable && (
        <Banner tone="warn">
          {chosen.refusal ??
            "A person cannot book this category from a bank line, so every proposal from this rule will be refused."}
        </Banner>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label="Unit"
          hint="Whose books the line is booked in. Head office keeps the bank accounts."
        >
          <UnitSelect
            value={unit}
            onChange={setUnit}
            emptyLabel="Head office"
            aria-label="Unit"
          />
        </Field>
        <Field label="Party" hint="Put on the document when it is accepted.">
          <Input
            value={party}
            onChange={(event) => setParty(event.target.value)}
          />
        </Field>
        <Field
          label="Priority"
          problem={priorityValid ? undefined : "A whole number, 1 or more."}
          hint="Lowest runs first. Put the narrower rule above the wider one."
        >
          <Input
            value={priority}
            inputMode="numeric"
            onChange={(event) =>
              setPriority(event.target.value.replace(/\D/g, ""))
            }
          />
        </Field>
      </div>

      <Field label="Note">
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
        />
      </Field>

      <div className="flex items-center justify-between gap-3">
        <Checkbox label="Active" checked={active} onChange={setActive} />
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={!ready}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : rule === null ? "Submit" : "Submit"}
        </Button>
      </div>
    </div>
  )
}

/// Whether a category can describe a line that moves money this way.
function fitsDirection(category: TransactionCategoryRow, direction: string) {
  if (direction === "ANY" || category.direction === "BOTH") return true
  return direction === "IN"
    ? category.direction === "INFLOW"
    : category.direction === "OUTFLOW"
}

/// Blank is the server's default (100); anything else a whole number of 1 or
/// more, because the server clamps below that and a screen that said "0" and
/// saved "1" would be quietly changing what was typed.
function parsePriority(text: string): number | null {
  if (text.trim() === "") return null
  const value = Number.parseInt(text, 10)
  return Number.isSafeInteger(value) && value >= 1 ? value : null
}
