import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ConfirmButton } from "@/components/ui/dialog"
import { Fab } from "@/components/ui/fab"
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState, Problem } from "@/components/ui/states"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { queryState } from "@/lib/query-state"
import {
  bankRulesQuery,
  evaluateBankRules,
  financeKeys,
  listTransactionCategories,
  recordBankRule,
  retireBankRule,
  updateBankRule,
} from "@/lib/queries/finance"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Code } from "@/screens/finance-final/parts"
import { useMeaningLabel } from "@/screens/finance/hooks"
import { PhoneChoice, UnitName, UnitSelect } from "@/screens/finance/parts"
import { ScreenPending } from "@/screens/finance/pending"
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
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Banking" title="Bank Rules">
          Reading the rules…
        </ScreenPending>
      }
    >
      <BankRulesScreen />
    </Suspense>
  )
}

function BankRulesScreen() {
  const [showRetired, setShowRetired] = useState(false)
  const [editing, setEditing] = useState<BankRuleRow | "new" | null>(null)
  const [outcome, setOutcome] = useState<BankRuleRunOutcome | null>(null)
  const client = useQueryClient()
  const meaning = useMeaningLabel()
  const phone = useLayout() === "phone"

  // Ticking "Show retired" answers at once; the retired rules follow, and the
  // rules in hand stay on screen until they are read.
  const rules = useSuspenseQuery(bankRulesQuery(useDeferredValue(showRetired)))

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
  const rows = rules.data
  const active = rows.filter((row) => row.active).length

  /// The rules in the order they are tried. A row opens the rule to edit it
  /// (a retired one is a record and stays as it is); on a card the pattern
  /// names it, what it records as and where follow, and how often it was
  /// accepted stands beneath, with the rule's state at the right.
  const columns = useMemo<ColumnDef<TableSetup, BankRuleRow>[]>(
    () => [
      {
        id: "priority",
        accessorFn: (row) => row.priority,
        header: "Priority",
        size: 100,
        enableSorting: false,
        meta: { align: "right", card: "hide", priority: 2 },
      },
      {
        id: "pattern",
        accessorFn: (row) => row.pattern,
        header: "When the description…",
        size: 280,
        enableSorting: false,
        meta: { card: "title", grow: 240 },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col whitespace-normal">
            <span>
              <span className="font-normal text-mute">
                {MATCH_VERB[row.original.match_kind] ?? row.original.match_kind}
              </span>{" "}
              <span className="font-mono text-[0.9375rem] text-ink">
                {row.original.pattern}
              </span>
            </span>
            {row.original.party !== null && (
              <span className="text-[0.9375rem] font-normal text-mute">
                Party: {row.original.party}
              </span>
            )}
          </span>
        ),
      },
      {
        id: "direction",
        accessorFn: (row) => row.direction,
        header: "Direction",
        size: 110,
        enableSorting: false,
        meta: { card: "metric", priority: 2 },
        cell: ({ row }) =>
          DIRECTION[row.original.direction] ?? row.original.direction,
      },
      {
        id: "records_as",
        accessorFn: (row) => row.category_name ?? row.semantic_key,
        header: "Records as",
        size: 260,
        enableSorting: false,
        meta: { card: "meta" },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col whitespace-normal">
            <RecordsAs row={row.original} meaning={meaning} />
          </span>
        ),
      },
      {
        id: "unit",
        accessorFn: (row) => row.unit_id,
        header: "Unit",
        size: 130,
        enableSorting: false,
        meta: { card: "metric", priority: 3 },
        cell: ({ row }) => <UnitName id={row.original.unit_id} />,
      },
      {
        id: "used",
        accessorFn: (row) => row.accepted_count,
        header: "Used",
        size: 120,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        // A rule with proposals and no acceptances is one people keep saying
        // no to — say so in words, beside the figure.
        cell: ({ row }) =>
          row.original.proposed_count === 0 ? (
            <span className="text-mute">Never</span>
          ) : (
            <>
              {count(row.original.accepted_count)}
              <span className="text-mute">
                {" "}
                of {count(row.original.proposed_count)}
              </span>
            </>
          ),
      },
      {
        id: "active",
        accessorFn: (row) => row.active,
        header: "Active",
        size: 100,
        enableSorting: false,
        meta: { card: "status" },
        cell: ({ row }) =>
          row.original.active ? (
            <span className="text-mute">Active</span>
          ) : (
            <Pill tone="neutral">Retired</Pill>
          ),
      },
      {
        id: "actions",
        accessorFn: (row) => row.rule_id,
        header: "",
        size: 170,
        enableSorting: false,
        enableHiding: false,
        meta: { align: "right", card: "hide" },
        cell: ({ row }) =>
          row.original.active && (
            // A click in here is the button's, and a dialog it opens is part of
            // this cell as far as React is concerned: neither opens the rule.
            <span
              className="inline-flex items-center gap-1.5"
              onClick={(event) => event.stopPropagation()}
            >
              <Button size="sm" onClick={() => setEditing(row.original)}>
                Edit
              </Button>
              <ConfirmButton
                size="sm"
                variant="quiet"
                label="Retire"
                title={`Retire the rule for “${row.original.pattern}”?`}
                description="It stops proposing from the next run. Proposals it already made stay, and keep naming this rule."
                confirmLabel="Retire rule"
                tone="danger"
                onConfirm={() => retire.mutateAsync(row.original.rule_id)}
              />
            </span>
          ),
      },
    ],
    // `retire` is a mutation object that changes every render; its
    // `mutateAsync` is stable, which is all the cell holds on to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meaning, retire.mutateAsync]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: BankRuleRow) => row.rule_id,
      }),
      [rows, columns]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Banking"
        title="Bank Rules"
        // A phone has the + at the thumb and "Apply rules now" at the foot.
        actions={
          phone ? undefined : (
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
          )
        }
      />

      {/* A phone: "Show retired" is a chip in the dock and the new rule the
          round +; "Apply rules now" stands at the foot of the list. */}
      <PhoneChoice
        title="Show"
        value={showRetired ? "all" : "active"}
        onChange={(next) => setShowRetired(next === "all")}
        options={[
          { value: "active", label: "Active rules", short: "Active" },
          { value: "all", label: "Active and retired", short: "All" },
        ]}
      />
      <Fab label="New rule" onClick={() => setEditing("new")} />

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

        {!phone && (
          <Toolbar className="mb-0">
            <Checkbox
              label="Show retired"
              checked={showRetired}
              onChange={setShowRetired}
            />
            <Toolbar.Spacer />
            <span className="text-[0.9375rem] text-mute">
              {count(active)} active {active === 1 ? "rule" : "rules"} · lowest
              priority is tried first
            </span>
          </Toolbar>
        )}

        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          {queryState(rules, {
            render: () =>
              rows.length === 0 ? (
                <EmptyState
                  action={
                    <Button variant="primary" onClick={() => setEditing("new")}>
                      New rule
                    </Button>
                  }
                >
                  No rule yet.
                </EmptyState>
              ) : (
                <DataTable<BankRuleRow>
                  refresh={[rules]}
                  table={table}
                  onRowClick={(row) => row.active && setEditing(row)}
                  isSelected={(row) =>
                    editing !== null &&
                    editing !== "new" &&
                    editing.rule_id === row.rule_id
                  }
                  pageScroll
                  cardSort={false}
                  cardsApart
                />
              ),
          })}
        </Card>

        {phone && (
          <Button
            pending={apply.isPending}
            disabled={active === 0}
            onClick={() => apply.mutate()}
          >
            {apply.isPending ? "Applying…" : "Apply rules now"}
          </Button>
        )}
      </div>

      {editing !== null && (
        <RuleForm
          key={editing === "new" ? "new" : editing.rule_id}
          rule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null)
            refresh()
          }}
        />
      )}
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
      <span className="block text-[0.9375rem]">
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
  onClose,
  onDone,
}: {
  rule: BankRuleRow | null
  onClose: () => void
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
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={rule === null ? "New rule" : "Edit rule"}
      size="wide"
      footer={
        <SheetFooter
          onCancel={onClose}
          primary={{
            label: "Submit",
            pending: save.isPending,
            disabled: !ready,
            onClick: () => save.mutate(),
          }}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <Problem error={save.error} />

        <div className="grid gap-3 md:grid-cols-[11rem_minmax(0,1fr)]">
          <Field label="Match" required>
            <Select
              value={matchKind}
              onChange={setMatchKind}
              aria-label="Match"
            >
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
            <Select
              value={category}
              onChange={setCategory}
              aria-label="Category"
            >
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

        <Checkbox label="Active" checked={active} onChange={setActive} />
      </div>
    </Sheet>
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
