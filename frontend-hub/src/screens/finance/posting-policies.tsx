import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ConfirmButton } from "@/components/ui/dialog"
import { Checkbox, Field, Input, Select } from "@/components/ui/field"
import { Fab } from "@/components/ui/fab"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { EmptyState, LoadingState, Problem } from "@/components/ui/states"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Tag } from "@/components/ui/tag"
import { count, label, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  financeKeys,
  listHeadOfficeAccounts,
  listSourceRules,
  postingSwitchesQuery,
  removeHeadOfficeAccount,
  removeSourceRule,
  setAutomaticPosting,
  setHeadOfficeAccount,
  setPostingSwitch,
  setSourceRule,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Code } from "@/screens/finance-final/parts"
import { useColumnFit } from "@/screens/finance/column-fit"
import { AccountPicker, type PickedAccount } from "@/screens/finance/parts"
import type {
  AccountSourceRule,
  HeadOfficeAccount,
  PostingSwitch,
} from "@itulah/contract"

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

const TABS: { value: Tab; label: string; add: string }[] = [
  { value: "switches", label: "Automatic posting", add: "Add a switch" },
  { value: "rules", label: "Account source rules", add: "Add a rule" },
  {
    value: "head-office",
    label: "Head-office accounts",
    add: "Keep an account",
  },
]

export function PostingPolicies() {
  const phone = useLayout() === "phone"
  const [tab, setTab] = useState<Tab>("switches")
  /// The tab's add form, a sheet from the head's action (the dock's + on a
  /// phone).
  const [adding, setAdding] = useState(false)
  const current = TABS.find((one) => one.value === tab) ?? TABS[0]
  const change = (next: Tab) => {
    setTab(next)
    setAdding(false)
  }
  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Settings"
        title="Posting Policies"
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={() => setAdding(true)}>
              {current.add}
            </Button>
          )
        }
      />
      <SubTabs
        // The three views are the status button in the dock on a phone.
        className="max-md:hidden"
        tabs={TABS.map((one) => ({ value: one.value, label: one.label }))}
        value={tab}
        onChange={(next) => change(next as Tab)}
      />
      <Fab label={current.add} onClick={() => setAdding(true)} />
      <DockTools
        status={{
          value: tab,
          options: TABS.map((one) => ({ value: one.value, label: one.label })),
          onChange: (next) => change(next as Tab),
        }}
      />
      {tab === "switches" && (
        <Suspense fallback={<LoadingState>Reading the switches…</LoadingState>}>
          <Switches adding={adding} setAdding={setAdding} />
        </Suspense>
      )}
      {tab === "rules" && <SourceRules adding={adding} setAdding={setAdding} />}
      {tab === "head-office" && (
        <HeadOfficeAccounts adding={adding} setAdding={setAdding} />
      )}
    </PageContent>
  )
}

/// The bar over a tab's table: its search and its columns.
function TabBar({
  needle,
  setNeedle,
  label: name,
  table,
}: {
  needle: string
  setNeedle: (value: string) => void
  label: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any
}) {
  return (
    <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
      <ExpandingSearch value={needle} onChange={setNeedle} label={name} />
      <BarSpacer />
      <ColumnsMenu table={table} />
    </div>
  )
}

/// The Remove button of a row: a quiet word on a desk, the tint button of a
/// card on a phone.
function RemoveButton({
  pending,
  onClick,
}: {
  pending: boolean
  onClick: () => void
}) {
  const phone = useLayout() === "phone"
  return (
    <Button
      size={phone ? "card" : "sm"}
      variant={phone ? "tint" : "quiet"}
      pending={pending}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      Remove
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Automatic posting
// ---------------------------------------------------------------------------

function Switches({
  adding,
  setAdding,
}: {
  adding: boolean
  setAdding: (open: boolean) => void
}) {
  const client = useQueryClient()
  const switches = useSuspenseQuery(postingSwitchesQuery())
  const [kind, setKind] = useState("")
  const [module, setModule] = useState<string>("FINANCE")
  const [needle, setNeedle] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])

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
      setAdding(false)
    },
  })

  const rows = switches.data.sources
  const automatic = switches.data.automatic_posting_enabled
  const columns = useMemo<ColumnDef<TableSetup, PostingSwitch>[]>(
    () => [
      {
        accessorKey: "source_kind",
        header: "Document kind",
        size: 280,
        meta: { card: "title" },
        cell: ({ row }) => <Code>{row.original.source_kind}</Code>,
      },
      {
        id: "module",
        accessorFn: (row) => label(row.module),
        header: "Module",
        size: 150,
        meta: { card: "meta" },
        cell: ({ row }) => label(row.original.module),
      },
      {
        id: "enabled",
        accessorFn: (row) => (row.enabled ? "On" : "Off"),
        header: "Posts",
        size: 130,
        meta: { card: "status" },
        cell: ({ row }) => (
          <Checkbox
            label={row.original.enabled ? "On" : "Off"}
            checked={row.original.enabled}
            disabled={one.isPending || !automatic}
            onChange={(enabled) => one.mutate({ ...row.original, enabled })}
          />
        ),
      },
      {
        id: "note",
        accessorFn: (row) => row.note ?? "",
        header: "Note",
        size: 360,
        meta: { card: "meta", grow: 240 },
        cell: ({ row }) => (
          <span className="font-normal whitespace-normal text-mute">
            {row.original.note ?? ""}
          </span>
        ),
      },
    ],
    // `one.mutate` is stable; the pending flag and the master switch are
    // what the checkboxes read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [one.isPending, automatic]
  )
  const phone = useLayout() === "phone"
  const [measure, fit] = useColumnFit(columns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: PostingSwitch) => row.source_kind,
        state: {
          globalFilter: needle,
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setNeedle,
        onColumnVisibilityChange: fit.onChange,
      }),
      // `fit` is new each render: the room is measured, and the columns the
      // card has no room for are given up.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [rows, columns, needle, sorting, phone, fit]
    )
  )

  return queryState(switches, {
    render: (data) => (
      <>
        <Card className="mb-4 flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <div className="text-card-title font-semibold text-ink">
              Automatic posting is{" "}
              {data.automatic_posting_enabled ? "on" : "off"}
            </div>
            <div className="text-[0.9375rem] text-mute">
              Every automatic flow at once. Last changed by {data.changed_by} ·{" "}
              {moment(data.changed_at)}
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

        <TabBar
          needle={needle}
          setNeedle={setNeedle}
          label="Search switches"
          table={table}
        />

        <div ref={measure}>
          <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
            <CardHeader className="max-md:px-0">
              <CardTitle>Per document kind</CardTitle>
            </CardHeader>
            {data.sources.length === 0 ? (
              <EmptyState>No document kind has a switch of its own.</EmptyState>
            ) : (
              <DataTable<PostingSwitch>
                table={table}
                refresh={[switches]}
                empty="No switch matches the search."
                pageScroll
                cardsApart
                cardSort={false}
                summary={{
                  source_kind: (
                    <span>
                      {count(table.getRowModel().rows.length)}{" "}
                      <span className="font-normal text-body">switches</span>
                    </span>
                  ),
                }}
              />
            )}
          </Card>
        </div>

        <Sheet
          open={adding}
          onOpenChange={setAdding}
          title="Add a switch"
          size="rail"
          footer={
            <SheetFooter
              onCancel={() => setAdding(false)}
              error={one.error}
              primary={{
                label: "Submit",
                pending: one.isPending,
                disabled: kind.trim() === "",
                onClick: () =>
                  one.mutate({
                    source_kind: kind.trim(),
                    module,
                    enabled: true,
                    note: null,
                  }),
              }}
            />
          }
        >
          <div className="flex flex-col gap-3">
            <Field label="Document kind" required>
              <Input
                value={kind}
                onChange={(event) => setKind(event.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Module">
              <Select value={module} onChange={setModule}>
                {MODULES.map((one) => (
                  <option key={one} value={one}>
                    {label(one)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Sheet>
      </>
    ),
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
      <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-ink">
        {value.name}
      </span>
      <Button size="sm" variant="quiet" onClick={() => onChange(null)}>
        Change
      </Button>
    </span>
  )
}

const ruleKey = (rule: AccountSourceRule) =>
  `${rule.account_code}\t${rule.source_kind}\t${rule.category_code ?? ""}`

function SourceRules({
  adding,
  setAdding,
}: {
  adding: boolean
  setAdding: (open: boolean) => void
}) {
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
  const [needle, setNeedle] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])

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
      setAdding(false)
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

  const columns = useMemo<ColumnDef<TableSetup, AccountSourceRule>[]>(
    () => [
      {
        accessorKey: "account_code",
        header: "Account",
        size: 150,
        meta: { card: "title" },
        cell: ({ row }) => <Code>{row.original.account_code}</Code>,
      },
      {
        accessorKey: "source_kind",
        header: "Document kind",
        size: 230,
        meta: { card: "meta" },
        cell: ({ row }) => <Code>{row.original.source_kind}</Code>,
      },
      {
        accessorKey: "effect",
        header: "Effect",
        size: 130,
        meta: { card: "lead" },
        cell: ({ row }) => (
          <Pill tone={row.original.effect === "DENY" ? "bad" : "ok"}>
            {label(row.original.effect)}
          </Pill>
        ),
      },
      {
        id: "category",
        accessorFn: (row) => row.category_code ?? "",
        header: "Category",
        size: 160,
        meta: { card: "meta", priority: 2 },
        cell: ({ row }) =>
          row.original.category_code ?? <span className="text-faint">Any</span>,
      },
      {
        id: "note",
        accessorFn: (row) => row.note ?? "",
        header: "Note",
        size: 280,
        meta: { card: "meta", grow: 200, priority: 2 },
        cell: ({ row }) => (
          <span className="font-normal whitespace-normal text-mute">
            {row.original.note ?? ""}
          </span>
        ),
      },
      {
        id: "remove",
        header: "",
        size: 110,
        enableSorting: false,
        enableHiding: false,
        meta: { align: "right", card: "status" },
        cell: ({ row }) => (
          <RemoveButton
            pending={remove.isPending}
            onClick={() => remove.mutate(row.original)}
          />
        ),
      },
    ],
    // `remove.mutate` is stable; the pending flag is what the button shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [remove.isPending]
  )
  const phone = useLayout() === "phone"
  const [measure, fit] = useColumnFit(columns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: sorted,
        columns,
        getRowId: ruleKey,
        state: {
          globalFilter: needle,
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setNeedle,
        onColumnVisibilityChange: fit.onChange,
      }),
      // `fit` is new each render: the room is measured, and the columns the
      // card has no room for are given up.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [sorted, columns, needle, sorting, phone, fit]
    )
  )

  return (
    <>
      <TabBar
        needle={needle}
        setNeedle={setNeedle}
        label="Search rules"
        table={table}
      />
      <div ref={measure}>
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          {queryState(rules, {
            loading: "Reading the rules…",
            render: () =>
              sorted.length === 0 ? (
                <EmptyState>
                  No rule: every document kind may reach every account.
                </EmptyState>
              ) : (
                <DataTable<AccountSourceRule>
                  table={table}
                  refresh={[rules]}
                  empty="No rule matches the search."
                  pageScroll
                  cardsApart
                  cardLead
                  cardSort={false}
                  summary={{
                    account_code: (
                      <span>
                        {count(table.getRowModel().rows.length)}{" "}
                        <span className="font-normal text-body">rules</span>
                      </span>
                    ),
                  }}
                />
              ),
          })}
          <Problem error={remove.error} className="m-3" />
        </Card>
      </div>

      <Sheet
        open={adding}
        onOpenChange={setAdding}
        title="Add a rule"
        size="rail"
        footer={
          <SheetFooter
            onCancel={() => setAdding(false)}
            error={add.error}
            primary={{
              label: "Submit",
              pending: add.isPending,
              disabled: account === null || kind.trim() === "",
              onClick: () => add.mutate(),
            }}
          />
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-[0.9375rem] text-body">
            An account with any ALLOW takes only the kinds allowed. A DENY keeps
            a kind out, and wins over an ALLOW.
          </p>
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
        </div>
      </Sheet>
    </>
  )
}

// ---------------------------------------------------------------------------
// Head-office accounts
// ---------------------------------------------------------------------------

function HeadOfficeAccounts({
  adding,
  setAdding,
}: {
  adding: boolean
  setAdding: (open: boolean) => void
}) {
  const client = useQueryClient()
  const accounts = useQuery({
    queryKey: financeKeys.headOfficeAccounts(),
    queryFn: ({ signal }) => listHeadOfficeAccounts(signal),
  })
  const [account, setAccount] = useState<PickedAccount | null>(null)
  const [kind, setKind] = useState<string>("SUPPLIER")
  const [note, setNote] = useState("")
  const [needle, setNeedle] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])

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
      setAdding(false)
    },
  })
  const remove = useMutation({
    mutationFn: removeHeadOfficeAccount,
    onSuccess: (rows) =>
      client.setQueryData(financeKeys.headOfficeAccounts(), rows),
  })

  const rows = useMemo(() => accounts.data ?? [], [accounts.data])
  const columns = useMemo<ColumnDef<TableSetup, HeadOfficeAccount>[]>(
    () => [
      {
        accessorKey: "account_code",
        header: "Account",
        size: 170,
        meta: { card: "title" },
        cell: ({ row }) => <Code>{row.original.account_code}</Code>,
      },
      {
        id: "kind",
        accessorFn: (row) => label(row.kind),
        header: "Kind",
        size: 160,
        meta: { card: "meta" },
        cell: ({ row }) => label(row.original.kind),
      },
      {
        accessorKey: "note",
        header: "Why",
        size: 420,
        meta: { card: "meta", grow: 240 },
        cell: ({ row }) => (
          <span className="font-normal whitespace-normal text-body">
            {row.original.note}
          </span>
        ),
      },
      {
        id: "remove",
        header: "",
        size: 110,
        enableSorting: false,
        enableHiding: false,
        meta: { align: "right", card: "status" },
        cell: ({ row }) => (
          <RemoveButton
            pending={remove.isPending}
            onClick={() => remove.mutate(row.original.account_code)}
          />
        ),
      },
    ],
    // `remove.mutate` is stable; the pending flag is what the button shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [remove.isPending]
  )
  const phone = useLayout() === "phone"
  const [measure, fit] = useColumnFit(columns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: HeadOfficeAccount) => row.account_code,
        state: {
          globalFilter: needle,
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setNeedle,
        onColumnVisibilityChange: fit.onChange,
      }),
      // `fit` is new each render: the room is measured, and the columns the
      // card has no room for are given up.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [rows, columns, needle, sorting, phone, fit]
    )
  )

  return (
    <>
      <TabBar
        needle={needle}
        setNeedle={setNeedle}
        label="Search accounts"
        table={table}
      />
      <div ref={measure}>
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          {queryState(accounts, {
            loading: "Reading the head-office accounts…",
            render: () =>
              rows.length === 0 ? (
                <EmptyState>
                  No account is kept for head office alone: a store's document
                  may post to any account.
                </EmptyState>
              ) : (
                <DataTable<HeadOfficeAccount>
                  table={table}
                  refresh={[accounts]}
                  empty="No account matches the search."
                  pageScroll
                  cardsApart
                  cardSort={false}
                  summary={{
                    account_code: (
                      <span>
                        {count(table.getRowModel().rows.length)}{" "}
                        <span className="font-normal text-body">accounts</span>
                      </span>
                    ),
                  }}
                />
              ),
          })}
          <Problem error={remove.error} className="m-3" />
        </Card>
      </div>

      <Sheet
        open={adding}
        onOpenChange={setAdding}
        title="Keep an account for head office"
        size="rail"
        footer={
          <SheetFooter
            onCancel={() => setAdding(false)}
            error={add.error}
            primary={{
              label: "Submit",
              pending: add.isPending,
              disabled: account === null || note.trim() === "",
              onClick: () => add.mutate(),
            }}
          />
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-[0.9375rem] text-body">
            A store's document that lands on it is refused: suppliers, banks,
            tax and lenders are head office's to settle.
          </p>
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
        </div>
      </Sheet>
    </>
  )
}
