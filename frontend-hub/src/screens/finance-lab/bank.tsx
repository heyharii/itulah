import { Menu } from "@base-ui/react/menu"
import { Printer, Upload } from "lucide-react"
import { useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Segmented } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { BANK_ACCOUNTS } from "@/screens/finance-lab/engine/bindings"
import { SAMPLE_CSV } from "@/screens/finance-lab/engine/bank"
import { PARTIES } from "@/screens/finance-lab/engine/data"
import {
  Amount,
  Cell,
  EntryView,
  Row,
  Section,
  SubHead,
  Table,
  rp,
  count,
  FILTER_W,
} from "@/screens/finance-lab/parts"
import {
  AccountCards,
  type MoneyAccount,
} from "@/screens/finance-lab/signature"
import { PrintSheet, StatementPrint } from "@/screens/finance-lab/print"
import { useBook } from "@/screens/finance-lab/state"

/// Bank reconciliation.
///
/// Signature visual is the mirror: the book balance against the statement
/// balance, and the gap stated once. Below it, one list — the statement — with
/// the three tabs as a filter over its status rather than three separate
/// stores, so a line that moves from pending to posted is the same row.
///
/// The categories a line can be posted to are deliberately few and named. A
/// free account picker here would let somebody post a bank charge to inventory
/// at two in the afternoon, and the trial balance would not notice.
type Kind = "ALL" | "IN" | "OUT" | "READY" | "MATCH" | "ATTENTION"

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Menu.Item
      onClick={onClick}
      className="flex min-h-8 cursor-default items-center rounded-inner px-2 text-[0.875rem] text-ink outline-none select-none data-[highlighted]:bg-soft-2"
    >
      {children}
    </Menu.Item>
  )
}

const CATEGORIES: readonly { role: string; label: string; type: string }[] = [
  { role: "BANK_CHARGE", label: "Bank charges", type: "Expense" },
  { role: "CARD_FEE", label: "Card fees", type: "Expense" },
  { role: "HOUSEKEEPING_EXPENSE", label: "Housekeeping", type: "Expense" },
  { role: "RENT_EXPENSE", label: "Rent", type: "Expense" },
  { role: "SALARY_EXPENSE", label: "Salaries", type: "Expense" },
  { role: "ALLOWANCE_EXPENSE", label: "Outside help", type: "Expense" },
  { role: "CARD_RECEIVABLE", label: "Card receivable", type: "Asset" },
  { role: "CASH_ON_HAND", label: "Cash on hand", type: "Asset" },
  { role: "PETTY_CASH", label: "Petty cash", type: "Asset" },
  {
    role: "AFFILIATE_GOODS_PAYABLE",
    label: "Due to head office — goods",
    type: "Liability",
  },
  { role: "PRINCIPAL_PAYABLE", label: "Due to principal", type: "Liability" },
  { role: "INTEREST_INCOME", label: "Bank interest", type: "Income" },
  { role: "SALES_REVENUE_CASH", label: "Cash sales", type: "Income" },
]

export function BankReconciliation() {
  const [printing, setPrinting] = useState(false)
  const b = useBook()
  const [store, setStore] = useState("C006")
  const [account, setAccount] = useState("BCA-TAB-C006")
  const [tab, setTab] = useState<"PENDING" | "POSTED" | "EXCLUDED">("PENDING")
  /// The transaction-type filter QuickBooks puts beside the search box. Each
  /// option answers a different question about the SAME list, which is why it
  /// is one control and not seven tabs: "money out" and "ready to post" overlap
  /// heavily and a tab strip would imply they do not.
  const [kind, setKind] = useState<Kind>("ALL")
  const [open, setOpen] = useState<string | null>(null)
  const [imported, setImported] = useState<string | null>(null)
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set())
  const [showRegister, setShowRegister] = useState(false)
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const file = useRef<HTMLInputElement>(null)

  /// Bank accounts only. A statement is the whole premise of this screen.
  const cards: MoneyAccount[] = [
    ...BANK_ACCOUNTS.filter(
      (a) =>
        a.unit_id === store &&
        b.bankLines.some((l) => l.bank_account_id === a.bank_account_id)
    ).map((a) => {
      const lines = b.bankLines.filter(
        (l) => l.bank_account_id === a.bank_account_id
      )
      const binding = b.ledger
        .allBindings()
        .find(
          (x) =>
            x.role === "BANK" && x.narrows.bank_account_id === a.bank_account_id
        )
      return {
        id: a.bank_account_id,
        name: a.label,
        kind: a.product === "GIRO" ? "Giro" : "Tabungan",
        statement: lines
          .filter((l) => l.status !== "EXCLUDED")
          .reduce(
            (n, l) => n + (l.direction === "IN" ? l.amount : -l.amount),
            0
          ),
        posted: binding ? b.ledger.balance(binding.account_code) : 0,
        pending: lines.filter((l) => l.status === "PENDING").length,
      }
    }),
  ]

  const all = b.bankLines.filter((l) => l.bank_account_id === account)
  const rows = all
    .filter((l) => l.status === tab)
    .filter((l) => {
      if (kind === "ALL") return true
      if (kind === "IN") return l.direction === "IN"
      if (kind === "OUT") return l.direction === "OUT"
      const matches = l.status === "PENDING" ? b.matchesFor(l) : []
      if (kind === "MATCH") return matches.length > 0
      if (kind === "READY")
        return matches.length === 0 && Boolean(b.suggestFor(l))
      // ATTENTION: nothing matches and no rule has an opinion.
      return matches.length === 0 && !b.suggestFor(l)
    })

  const line = b.bankLines.find((l) => l.line_id === open)

  /// The account's own movements, with a running balance. QuickBooks puts this
  /// behind "Go to bank register"; it is the same account seen from the books'
  /// side rather than the bank's, and it belongs on this screen because the
  /// question it answers — *what did WE record* — is the other half of every
  /// reconciliation.
  const register = (() => {
    const bankBinding = b.ledger
      .allBindings()
      .find((x) => x.role === "BANK" && x.narrows.bank_account_id === account)
    const code =
      bankBinding?.account_code ?? (account.startsWith("1011") ? account : "")
    if (!code) return []
    const out: {
      entry: string
      on: string
      doc: string
      memo: string
      debit: number
      credit: number
      running: number
    }[] = []
    let running = 0
    for (const e of [...b.ledger.allEntries()].sort((x, y) =>
      x.dates.posting_on.localeCompare(y.dates.posting_on)
    )) {
      for (const l of e.lines) {
        if (l.account_code !== code) continue
        running += l.debit - l.credit
        out.push({
          entry: e.entry_number,
          on: e.dates.posting_on,
          doc: e.document_ref,
          memo: l.memo ?? e.memo ?? "",
          debit: l.debit,
          credit: l.credit,
          running,
        })
      }
    }
    return out
  })()

  async function onFile(f: File) {
    const text = await f.text()
    const r = b.importStatement(account, text)
    setImported(
      r.problems.length
        ? r.problems.join(" ")
        : `${count(r.added, "line")} added${r.duplicate ? `, ${r.duplicate} duplicates skipped` : ""}${r.skipped ? `, ${count(r.skipped, "line")} unreadable` : ""}.`
    )
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Cash & bank"
        title="Reconcile"
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={store}
              onChange={(v) => {
                setStore(v)
                const first = BANK_ACCOUNTS.find((a) => a.unit_id === v)
                if (first) setAccount(first.bank_account_id)
              }}
            >
              {[...new Set(BANK_ACCOUNTS.map((a) => a.unit_id))]
                .sort()
                .map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
            </Select>
            <input
              ref={file}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFile(f)
                e.target.value = ""
              }}
            />
            <button
              type="button"
              onClick={() => {
                const r = b.importStatement(account, SAMPLE_CSV)
                setImported(`Sample loaded: ${count(r.added, "line")} added.`)
              }}
              className="text-[0.875rem] font-medium whitespace-nowrap text-accent hover:underline"
            >
              Load sample
            </button>
            <Button onClick={() => setPrinting(true)}>
              <Printer className="size-3.5" />
              Print
            </Button>
            <Button variant="primary" onClick={() => file.current?.click()}>
              <Upload className="size-3.5" />
              Upload statement
            </Button>
          </div>
        }
      />

      {imported && (
        <Banner
          tone="info"
          className="mb-4"
          onDismiss={() => setImported(null)}
        >
          {imported}
        </Banner>
      )}

      <AccountCards accounts={cards} selected={account} onSelect={setAccount} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            {
              value: "PENDING",
              label: `Pending (${all.filter((l) => l.status === "PENDING").length})`,
            },
            {
              value: "POSTED",
              label: `Posted (${all.filter((l) => l.status === "POSTED").length})`,
            },
            {
              value: "EXCLUDED",
              label: `Excluded (${all.filter((l) => l.status === "EXCLUDED").length})`,
            },
          ]}
        />
        <button
          type="button"
          onClick={() => setShowRegister((v) => !v)}
          className="text-[0.875rem] font-medium text-accent hover:underline"
        >
          {showRegister ? "Back to transactions" : "Go to account register"}
        </button>
      </div>

      {showRegister ? (
        <Section title={`Register — ${count(register.length, "movement")}`}>
          {register.length === 0 ? (
            <EmptyState>No movements on this account.</EmptyState>
          ) : (
            <Table
              head={[
                "Date",
                "Journal",
                "Document",
                "Memo",
                ">In",
                ">Out",
                ">Balance",
              ]}
            >
              {register.map((m, i) => (
                <Row key={i}>
                  <Cell className="whitespace-nowrap">{m.on}</Cell>
                  <Cell mono>{m.entry}</Cell>
                  <Cell mono className="text-mute">
                    {m.doc}
                  </Cell>
                  <Cell className="text-body">{m.memo || "—"}</Cell>
                  <Cell right>
                    <Amount minor={m.debit} muted />
                  </Cell>
                  <Cell right>
                    <Amount minor={m.credit} muted />
                  </Cell>
                  <Cell right className="font-semibold text-ink">
                    <Amount minor={m.running} />
                  </Cell>
                </Row>
              ))}
              <Row tone="total">
                <Cell colSpan={4}>{count(register.length, "movement")}</Cell>
                <Cell right>
                  <Amount minor={register.reduce((n, m) => n + m.debit, 0)} />
                </Cell>
                <Cell right>
                  <Amount minor={register.reduce((n, m) => n + m.credit, 0)} />
                </Cell>
                <Cell right>
                  <Amount minor={register.at(-1)?.running ?? 0} />
                </Cell>
              </Row>
            </Table>
          )}
        </Section>
      ) : (
        <>
          {marked.size > 0 && (
            <Banner tone="info" className="mb-3">
              <span className="font-semibold">{marked.size} selected.</span>{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => {
                  for (const id of marked) {
                    const line = b.bankLines.find((l) => l.line_id === id)
                    const hint = line && b.suggestFor(line)
                    if (line && hint)
                      b.postLine(id, hint.role, line.description)
                  }
                  setMarked(new Set())
                }}
              >
                Post the ones with a suggested category
              </button>
              {" · "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => {
                  for (const id of marked) b.excludeLine(id, "Excluded in bulk")
                  setMarked(new Set())
                }}
              >
                Exclude
              </button>
            </Banner>
          )}

          <Section
            title={`Statement lines — ${rows.length}`}
            right={
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={kind}
                  onChange={(v) => setKind(v as Kind)}
                  className={FILTER_W}
                >
                  <option value="ALL">
                    All transactions (
                    {all.filter((l) => l.status === tab).length})
                  </option>
                  <option value="IN">Money in</option>
                  <option value="OUT">Money out</option>
                  <option value="READY">Ready to post</option>
                  <option value="MATCH">Suggested matches</option>
                  <option value="ATTENTION">Needs attention</option>
                </Select>
              </div>
            }
          >
            {rows.length === 0 ? (
              <EmptyState>
                {tab === "PENDING"
                  ? "Nothing pending. Import a statement to add lines."
                  : "Nothing in this tab."}
              </EmptyState>
            ) : (
              <Table
                head={[
                  "",
                  "Date",
                  "Bank description",
                  ">Spent",
                  ">Received",
                  "",
                  "From/To",
                  "Match/Categorize",
                  "Action",
                ]}
              >
                {rows.map((l) => {
                  const matches = l.status === "PENDING" ? b.matchesFor(l) : []
                  const hint = b.suggestFor(l)
                  return (
                    <Row
                      key={l.line_id}
                      className="hover:bg-soft-1 cursor-pointer"
                    >
                      <Cell className="w-8">
                        <input
                          type="checkbox"
                          checked={marked.has(l.line_id)}
                          onChange={(e) => {
                            const next = new Set(marked)
                            if (e.target.checked) next.add(l.line_id)
                            else next.delete(l.line_id)
                            setMarked(next)
                          }}
                        />
                      </Cell>
                      <Cell
                        className="whitespace-nowrap"
                        onClick={() => setOpen(l.line_id)}
                      >
                        {l.on}
                      </Cell>
                      <Cell onClick={() => setOpen(l.line_id)}>
                        <span className="text-ink">{l.description}</span>
                        {l.reference && (
                          <div className="font-mono text-eyebrow text-faint">
                            {l.reference}
                          </div>
                        )}
                      </Cell>
                      <Cell right>
                        <Amount
                          minor={l.direction === "OUT" ? l.amount : 0}
                          muted
                        />
                      </Cell>
                      <Cell right>
                        <Amount
                          minor={l.direction === "IN" ? l.amount : 0}
                          muted
                        />
                      </Cell>
                      <Cell className="w-8 text-center text-faint">＋</Cell>
                      <Cell>
                        {l.status === "PENDING" ? (
                          <Select
                            value={l.counterparty ?? ""}
                            onChange={(v) => b.setCounterparty(l.line_id, v)}
                            aria-label="From/To"
                            className="h-7 max-w-[11rem] bg-transparent px-1.5 text-[0.875rem]"
                          >
                            <option value="">Select name…</option>
                            {PARTIES.map((p) => (
                              <option key={p.id} value={p.name}>
                                {p.name} — {p.kind}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <span className="text-body">
                            {l.counterparty ?? "—"}
                          </span>
                        )}
                      </Cell>
                      <Cell>
                        {l.status === "EXCLUDED" ? (
                          <span className="text-mute">{l.excluded_reason}</span>
                        ) : l.entry_id ? (
                          <span className="flex items-center gap-1.5">
                            <Pill tone="ok">
                              {l.resolution === "MATCHED"
                                ? "matched"
                                : "posted"}
                            </Pill>
                            <span className="font-mono text-[0.875rem] text-mute">
                              {b.ledger.entry(l.entry_id)?.entry_number}
                            </span>
                          </span>
                        ) : matches.length ? (
                          <span className="flex items-start gap-1.5">
                            <Pill tone="info">match</Pill>
                            {matches.length === 1 ? (
                              <span className="min-w-0">
                                <span className="block truncate text-ink">
                                  {matches[0].entry_number} · {matches[0].on}
                                </span>
                                <span className="block truncate text-eyebrow text-mute">
                                  {matches[0].memo}
                                </span>
                                <span className="block text-eyebrow text-body tabular-nums">
                                  {rp(matches[0].amount)}
                                </span>
                              </span>
                            ) : (
                              <span className="text-body">
                                {matches.length} matches found
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            {hint?.from === "rule" && (
                              <span
                                title="Filled by a rule you created"
                                className="text-warn-fg"
                              >
                                ●
                              </span>
                            )}
                            <Select
                              value={chosen[l.line_id] ?? hint?.role ?? ""}
                              onChange={(v) =>
                                setChosen({ ...chosen, [l.line_id]: v })
                              }
                              aria-label="Category"
                              className="h-7 max-w-[13rem] bg-transparent px-1.5 text-[0.875rem]"
                            >
                              <option value="">Select category…</option>
                              {CATEGORIES.map((c) => (
                                <option key={c.role} value={c.role}>
                                  {c.label} — {c.type}
                                </option>
                              ))}
                            </Select>
                          </span>
                        )}
                      </Cell>
                      <Cell>
                        {l.status === "PENDING" ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                const role = chosen[l.line_id] ?? hint?.role
                                if (matches.length || !role) setOpen(l.line_id)
                                else b.postLine(l.line_id, role, l.description)
                              }}
                              className="font-medium text-accent hover:underline"
                            >
                              {matches.length ? "Match" : "Post"}
                            </button>
                            <span className="text-faint">|</span>
                            <Menu.Root>
                              <Menu.Trigger
                                aria-label="More actions"
                                className="rounded px-1 text-mute hover:bg-soft-2 data-[popup-open]:bg-soft-2"
                              >
                                ⌄
                              </Menu.Trigger>
                              <Menu.Portal>
                                <Menu.Positioner
                                  side="bottom"
                                  align="end"
                                  sideOffset={4}
                                  className="z-50"
                                >
                                  <Menu.Popup className="min-w-44 rounded-card border border-hairline bg-canvas p-1.5 shadow-pop">
                                    <MenuItem
                                      onClick={() => {
                                        setOpen(l.line_id)
                                      }}
                                    >
                                      Find match
                                    </MenuItem>
                                    <MenuItem
                                      onClick={() => {
                                        setOpen(l.line_id)
                                      }}
                                    >
                                      Split
                                    </MenuItem>
                                    <MenuItem
                                      onClick={() => {
                                        const role =
                                          chosen[l.line_id] ?? hint?.role
                                        if (role) {
                                          const cat = CATEGORIES.find(
                                            (c) => c.role === role
                                          )
                                          b.addBankRule({
                                            contains: l.description
                                              .split(" ")
                                              .slice(0, 2)
                                              .join(" "),
                                            role,
                                            label: cat?.label ?? role,
                                            counterparty: l.counterparty,
                                          })
                                        }
                                      }}
                                    >
                                      Create rule
                                    </MenuItem>
                                    <MenuItem
                                      onClick={() => {
                                        b.excludeLine(
                                          l.line_id,
                                          "Not our transaction"
                                        )
                                      }}
                                    >
                                      Exclude
                                    </MenuItem>
                                  </Menu.Popup>
                                </Menu.Positioner>
                              </Menu.Portal>
                            </Menu.Root>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => b.restoreLine(l.line_id)}
                            className="font-medium text-accent hover:underline"
                          >
                            Undo
                          </button>
                        )}
                      </Cell>
                    </Row>
                  )
                })}
                <Row tone="total">
                  <Cell colSpan={3} className="whitespace-nowrap">
                    {count(rows.length, "line")}
                  </Cell>
                  <Cell right>
                    <Amount
                      minor={rows
                        .filter((l) => l.direction === "OUT")
                        .reduce((n, l) => n + l.amount, 0)}
                    />
                  </Cell>
                  <Cell right>
                    <Amount
                      minor={rows
                        .filter((l) => l.direction === "IN")
                        .reduce((n, l) => n + l.amount, 0)}
                    />
                  </Cell>
                  <Cell colSpan={4} />
                </Row>
              </Table>
            )}
          </Section>
        </>
      )}

      <Sheet
        open={Boolean(line)}
        onOpenChange={(o) => !o && setOpen(null)}
        title={line?.description ?? ""}
        id={line?.on}
      >
        {line && (
          <LineDetail lineId={line.line_id} onDone={() => setOpen(null)} />
        )}
      </Sheet>

      <PrintSheet
        open={printing}
        onOpenChange={setPrinting}
        title="Rekening koran"
      >
        <StatementPrint
          account={
            BANK_ACCOUNTS.find((a) => a.bank_account_id === account)?.label ??
            account
          }
          bank_account_id={account}
          unit={store}
          lines={all.map((l) => ({
            on: l.on,
            description: l.description,
            direction: l.direction,
            amount: l.amount,
            status: l.status,
          }))}
        />
      </PrintSheet>
    </PageContent>
  )
}

function LineDetail({
  lineId,
  onDone,
}: {
  lineId: string
  onDone: () => void
}) {
  const b = useBook()
  const line = b.bankLines.find((l) => l.line_id === lineId)!
  const matches = b.matchesFor(line)
  const hint = b.suggestFor(line)
  const [role, setRole] = useState(hint?.role ?? "")
  const [hunt, setHunt] = useState("")
  const [said, setSaid] = useState<string | null>(null)
  const entry = line.entry_id ? b.ledger.entry(line.entry_id) : undefined

  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact term="Date">{line.on}</Fact>
        <Fact term="Direction">{line.direction === "OUT" ? "Out" : "In"}</Fact>
        <Fact term="Value">
          <Amount minor={line.amount} />
        </Fact>
        <Fact term="Rekening">{line.bank_account_id}</Fact>
        <Fact term="Reference">{line.reference ?? "—"}</Fact>
        <Fact term="Status">{line.status.toLowerCase()}</Fact>
      </Facts>

      {said && <Banner tone="info">{said}</Banner>}

      {line.status === "PENDING" && (
        <>
          <div>
            <SubHead>Find a match by hand</SubHead>
            <div className="mt-2">
              <Input
                value={hunt}
                onChange={(e) => setHunt(e.target.value)}
                placeholder="Search journal number, document or memo"
              />
            </div>
            {hunt.trim() && (
              <Table head={["Journal", "Date", "Memo", ">Amount", ""]}>
                {b.ledger
                  .allEntries()
                  .filter((e) =>
                    `${e.entry_number} ${e.document_ref} ${e.memo ?? ""}`
                      .toLowerCase()
                      .includes(hunt.trim().toLowerCase())
                  )
                  .slice(0, 8)
                  .map((e) => (
                    <Row
                      key={e.entry_id}
                      tone={e.total === line.amount ? undefined : "warn"}
                    >
                      <Cell mono>{e.entry_number}</Cell>
                      <Cell className="whitespace-nowrap">
                        {e.dates.posting_on}
                      </Cell>
                      <Cell className="text-body">
                        {e.memo ?? e.document_ref}
                      </Cell>
                      <Cell right>
                        <Amount minor={e.total} />
                      </Cell>
                      <Cell>
                        <button
                          type="button"
                          onClick={() => {
                            b.matchLine(line.line_id, e.entry_id)
                            onDone()
                          }}
                          className="font-medium text-accent hover:underline"
                        >
                          Match
                        </button>
                      </Cell>
                    </Row>
                  ))}
              </Table>
            )}
            <p className="mt-1.5 text-eyebrow text-mute">
              A row shaded amber is a different amount from the statement line.
              Matching it anyway leaves the account out by the difference, so it
              is shown rather than hidden.
            </p>
          </div>

          {matches.length > 0 && (
            <div>
              <SubHead>Possible matches</SubHead>
              <Table
                head={[
                  "Journal",
                  "Date",
                  "Description",
                  ">Value",
                  "Reason",
                  "",
                ]}
              >
                {matches.map((m) => (
                  <Row key={m.entry_id}>
                    <Cell mono>{m.entry_number}</Cell>
                    <Cell className="whitespace-nowrap">{m.on}</Cell>
                    <Cell className="text-body">{m.memo}</Cell>
                    <Cell right>
                      <Amount minor={m.amount} />
                    </Cell>
                    <Cell className="text-mute">{m.why}</Cell>
                    <Cell>
                      <button
                        type="button"
                        onClick={() => {
                          b.matchLine(line.line_id, m.entry_id)
                          onDone()
                        }}
                        className="font-medium text-accent hover:underline"
                      >
                        Match
                      </button>
                    </Cell>
                  </Row>
                ))}
              </Table>
            </div>
          )}

          <div>
            <SubHead>Post as new</SubHead>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Select value={role} onChange={setRole} className={FILTER_W}>
                <option value="">Select category…</option>
                {CATEGORIES.map((c) => (
                  <option key={c.role} value={c.role}>
                    {c.label}
                  </option>
                ))}
              </Select>
              <Button
                variant="primary"
                disabled={!role}
                onClick={() => {
                  const r = b.postLine(line.line_id, role, line.description)
                  if (r.ok) onDone()
                  else setSaid(`Ditolak: ${r.message}`)
                }}
              >
                Post
              </Button>
              <Button
                onClick={() => {
                  b.excludeLine(line.line_id, "Not our transaction")
                  onDone()
                }}
              >
                Exclude
              </Button>
            </div>
          </div>
        </>
      )}

      {entry && (
        <div>
          <SubHead>Journal</SubHead>
          <div className="mt-2">
            <EntryView entry={entry} />
          </div>
        </div>
      )}
    </div>
  )
}
