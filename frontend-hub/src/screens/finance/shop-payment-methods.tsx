import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import {
  Banknote,
  Coins,
  CreditCard,
  Landmark,
  Plus,
  QrCode,
  Ticket,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { Fab } from "@/components/ui/fab"
import { Field, Input } from "@/components/ui/field"
import { Choices } from "@/components/ui/form"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import {
  BarSpacer,
  ColumnsMenu,
  ExpandingSearch,
} from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { MiniCell, MiniRow, MiniTable, SubHead } from "@/components/ui/rows"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { EmptyState } from "@/components/ui/states"
import { count } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  changeChart,
  edcMachinesQuery,
  financeKeys,
  paymentMethodsQuery,
  removeEdcMachine,
  saveEdcMachine,
  setShopOtherMethods,
} from "@/lib/queries/finance"
import { siteLabel, unitsQuery } from "@/lib/queries/organisation"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { useColumnFit } from "@/screens/finance/column-fit"
import { ScreenPending } from "@/screens/finance/pending"
import type {
  ChartAccountChoice,
  EdcMachine,
  EdcMachineBook,
  PaymentMethodSetting,
} from "@itulah/contract"

/// The kinds of site that sell: `STORE` today, `SHOP` in the premises
/// vocabulary the register is moving to. A site's kind is data; its id says
/// nothing.
const SELLING_SITE_KINDS = new Set(["STORE", "SHOP"])

/// Which payment methods each shop takes (ERPNext POS Profile → Payments),
/// machine first (owner, 24 Oct 2026).
///
/// A shop's cards and QRIS are its EDC machines: per bank, what the machine
/// takes — debit, credit, the bank's QRIS — and the Cash In Bank account each
/// of those lands in. The shop's debit, credit and QRIS methods are read off
/// the machines by the server, so the till's Bayar offers exactly them. Cash,
/// voucher, the employee balance and points are ticked beside the machines.
///
/// The list is the shops — the selling sites of the units register — and not
/// the units the books are kept for: a till stands at a site.
interface ShopRow {
  readonly site_id: string
  readonly label: string
  readonly unit_status: string
}

/// The tenders ticked beside the machines, and the word each goes by here.
const OTHER: Record<string, { word: string; icon: LucideIcon }> = {
  CASH: { word: "Cash", icon: Banknote },
  VOUCHER: { word: "Voucher", icon: Ticket },
  BENEFIT: { word: "Employee balance", icon: Wallet },
  POINTS: { word: "Points", icon: Coins },
}
const OTHER_ORDER = ["CASH", "VOUCHER", "BENEFIT", "POINTS"]

type Kind = "debit" | "credit" | "qris"
const KINDS: {
  kind: Kind
  word: string
  icon: LucideIcon
  takes: "takes_debit" | "takes_credit" | "takes_qris"
  account: "debit_account" | "credit_account" | "qris_account"
}[] = [
  {
    kind: "debit",
    word: "Debit",
    icon: CreditCard,
    takes: "takes_debit",
    account: "debit_account",
  },
  {
    kind: "credit",
    word: "Credit",
    icon: CreditCard,
    takes: "takes_credit",
    account: "credit_account",
  },
  {
    kind: "qris",
    word: "QRIS",
    icon: QrCode,
    takes: "takes_qris",
    account: "qris_account",
  },
]
const KIND = Object.fromEntries(KINDS.map((one) => [one.kind, one])) as Record<
  Kind,
  (typeof KINDS)[number]
>

/// The cash, voucher, employee-balance and points methods, in that order.
function otherMethods(
  methods: readonly PaymentMethodSetting[]
): PaymentMethodSetting[] {
  return methods
    .filter((one) => one.is_active && OTHER[one.tender_type] !== undefined)
    .sort(
      (a, b) =>
        OTHER_ORDER.indexOf(a.tender_type) -
          OTHER_ORDER.indexOf(b.tender_type) || a.code.localeCompare(b.code)
    )
}

/// "Mandiri" for "Bank Mandiri"; the code when the bank is not in the book.
function bankWord(book: EdcMachineBook, code: string): string {
  const bank = book.banks.find((one) => one.code === code)
  return bank === undefined ? code : bank.name.replace(/^Bank\s+/i, "")
}

/// "EDC BCA", or "QRIS BCA" for a bank's QR stand with no card reader.
function machineName(
  book: EdcMachineBook,
  machine: Pick<EdcMachine, "bank_code" | "takes_debit" | "takes_credit">
): string {
  const card = machine.takes_debit || machine.takes_credit
  return `${card ? "EDC" : "QRIS"} ${bankWord(book, machine.bank_code)}`
}

/// "1005 · Giro BCA": the account short enough for a table cell.
function accountShort(book: EdcMachineBook, code: string): string {
  const account = book.accounts.find((one) => one.account_code === code)
  if (account === undefined) return code
  const short = account.name
    .replace(/^Cash In Bank\s+/i, "")
    .replace(/\bBank\s+/i, "")
  return `${code} · ${short}`
}

export function ShopPaymentMethods() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Setup" title="Shop Payment Methods">
          Reading the shops…
        </ScreenPending>
      }
    >
      <ShopPaymentMethodsScreen />
    </Suspense>
  )
}

function ShopPaymentMethodsScreen() {
  const phone = useLayout() === "phone"
  const units = useSuspenseQuery(unitsQuery())
  const methods = useSuspenseQuery(paymentMethodsQuery())
  const book = useSuspenseQuery(edcMachinesQuery())
  /// The shop whose sheet is open.
  const [site, setSite] = useState<string | null>(null)
  /// A machine being added from the page's head, before a shop is chosen.
  const [adding, setAdding] = useState(0)
  const [needle, setNeedle] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])

  const allShops = useMemo<ShopRow[]>(
    () =>
      units.data.flatMap((unit) =>
        unit.sites
          .filter((one) => SELLING_SITE_KINDS.has(one.kind))
          .map((one) => ({
            site_id: one.id,
            label: siteLabel(unit, one),
            unit_status: unit.status,
          }))
      ),
    [units.data]
  )

  const shops = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return allShops.filter(
      (one) => text === "" || one.label.toLowerCase().includes(text)
    )
  }, [allShops, needle])

  /// Each shop's machines, in the book's order (by bank).
  const machinesOf = useMemo(() => {
    const table = new Map<string, EdcMachine[]>()
    for (const machine of book.data.machines) {
      const list = table.get(machine.site_id) ?? []
      list.push(machine)
      table.set(machine.site_id, list)
    }
    return table
  }, [book.data.machines])

  /// Each shop's cash, voucher, employee-balance and points methods.
  const othersOf = useMemo(() => {
    const table = new Map<string, string[]>()
    for (const method of otherMethods(methods.data)) {
      for (const id of method.site_ids) {
        const list = table.get(id) ?? []
        list.push(OTHER[method.tender_type]?.word ?? method.name)
        table.set(id, list)
      }
    }
    return table
  }, [methods.data])

  const figures = useMemo(() => {
    const ids = new Set(allShops.map((one) => one.site_id))
    const machines = book.data.machines.filter((one) => ids.has(one.site_id))
    return {
      machines: machines.length,
      qris: machines.filter((one) => one.takes_qris).length,
      without: allShops.filter(
        (one) => (machinesOf.get(one.site_id) ?? []).length === 0
      ).length,
    }
  }, [allShops, book.data.machines, machinesOf])

  /// One shop per row. On a phone the same columns are the card.
  const columns = useMemo<ColumnDef<TableSetup, ShopRow>[]>(
    () => [
      {
        id: "shop",
        accessorFn: (row) => row.label,
        header: "Shop",
        size: 240,
        meta: { card: "title" },
        cell: ({ row }) => (
          <span className="block">
            <span className="block text-ink">{row.original.label}</span>
            {row.original.unit_status === "CLOSED" && (
              <span className="text-[0.9375rem] font-normal text-faint">
                Closed
              </span>
            )}
          </span>
        ),
      },
      {
        id: "machines",
        accessorFn: (row) => (machinesOf.get(row.site_id) ?? []).length,
        header: "EDC machines",
        size: 320,
        meta: { card: "meta", grow: 200 },
        cell: ({ row }) => {
          const list = machinesOf.get(row.original.site_id) ?? []
          return list.length === 0 ? (
            <span className="text-faint">—</span>
          ) : (
            list
              .map((one) =>
                one.takes_debit || one.takes_credit
                  ? bankWord(book.data, one.bank_code)
                  : machineName(book.data, one)
              )
              .join(", ")
          )
        },
      },
      {
        id: "others",
        accessorFn: (row) => (othersOf.get(row.site_id) ?? []).join(", "),
        header: "Other methods",
        size: 320,
        meta: { card: "meta" },
        cell: ({ row }) => {
          const list = othersOf.get(row.original.site_id) ?? []
          return list.length === 0 ? (
            <span className="text-faint">—</span>
          ) : (
            list.join(", ")
          )
        },
      },
    ],
    [machinesOf, othersOf, book.data]
  )

  const [measure, fit] = useColumnFit(columns, phone)
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: shops,
        columns,
        getRowId: (row: ShopRow) => row.site_id,
        state: {
          sorting,
          columnVisibility: fit.visibility,
        },
        onSortingChange: setSorting,
        onColumnVisibilityChange: fit.onChange,
      }),
      // `fit` is new each render: the room is measured, and the columns the
      // card has no room for are given up.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [shops, columns, sorting, phone, fit]
    )
  )

  const chosen = allShops.find((one) => one.site_id === site)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Setup"
        title="Shop Payment Methods"
        actions={
          phone ? undefined : (
            <Button variant="primary" onClick={() => setAdding((n) => n + 1)}>
              <Plus />
              Add machine
            </Button>
          )
        }
      />
      {phone && (
        <Fab label="Add machine" onClick={() => setAdding((n) => n + 1)} />
      )}

      <KpiStrip>
        <Kpi label="Shops" value={count(allShops.length)} />
        <Kpi label="EDC machines" value={count(figures.machines)} />
        <Kpi label="With QRIS" value={count(figures.qris)} />
        <Kpi label="Without EDC" value={count(figures.without)} />
      </KpiStrip>

      <div className="group/bar mb-3 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
        <ExpandingSearch
          value={needle}
          onChange={setNeedle}
          label="Search shops"
        />
        <BarSpacer />
        <ColumnsMenu table={table} />
      </div>
      <DockTools
        search={{ value: needle, onChange: setNeedle, label: "Search shops" }}
        sort={dockSortOf(table)}
      />

      <div ref={measure}>
        <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          {queryState(units, {
            render: () =>
              allShops.length === 0 ? (
                <EmptyState>The company has no shop yet.</EmptyState>
              ) : (
                <DataTable<ShopRow>
                  table={table}
                  refresh={[units, methods, book]}
                  onRowClick={(row) => setSite(row.site_id)}
                  isSelected={(row) => row.site_id === site}
                  empty="No shop matches the search."
                  pageScroll
                  cardsApart
                  cardSort={false}
                  summary={{
                    shop: (
                      <span>
                        {count(shops.length)}{" "}
                        <span className="font-normal text-body">
                          {shops.length === 1 ? "shop" : "shops"}
                        </span>
                      </span>
                    ),
                  }}
                />
              ),
          })}
        </Card>
      </div>

      {chosen !== undefined && (
        <ShopSheet
          key={chosen.site_id}
          shop={chosen}
          book={book.data}
          methods={methods.data}
          shops={allShops}
          onClose={() => setSite(null)}
        />
      )}
      {adding > 0 && (
        <MachineSheet
          key={`add${adding}`}
          site={null}
          bank={null}
          book={book.data}
          shops={allShops}
          onClose={() => setAdding(0)}
        />
      )}
    </PageContent>
  )
}

/// A tile that is on or off, among others that are too — the many-answer
/// sibling of `Choices`, drawn the same.
function ToggleTile({
  on,
  icon: Icon,
  label,
  onToggle,
}: {
  on: boolean
  icon: LucideIcon
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        "choice-tile flex min-w-0 cursor-pointer items-center gap-2.5 rounded-inner border px-3 py-2.5 text-left text-[0.9375rem] text-ink transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        on
          ? "border-accent bg-accent-bg"
          : "border-hairline-2 bg-canvas hover:border-hairline-strong hover:bg-soft-2"
      )}
    >
      <span
        className={cn(
          "grid size-[1.875rem] shrink-0 place-items-center rounded-inner",
          on ? "bg-canvas text-accent" : "bg-soft-2 text-body"
        )}
      >
        <Icon className="size-4 stroke-[1.7]" />
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

/// One shop: its machines, and the methods ticked beside them.
function ShopSheet({
  shop,
  book,
  methods,
  shops,
  onClose,
}: {
  shop: ShopRow
  book: EdcMachineBook
  methods: readonly PaymentMethodSetting[]
  shops: readonly ShopRow[]
  onClose: () => void
}) {
  const client = useQueryClient()
  /// The machine open over the sheet: its bank, or "" for a new one.
  const [open, setOpen] = useState<string | null>(null)
  const machines = book.machines.filter((one) => one.site_id === shop.site_id)
  const others = useMemo(() => otherMethods(methods), [methods])
  const saved = useMemo(
    () =>
      new Set(
        others
          .filter((one) => one.site_ids.includes(shop.site_id))
          .map((one) => one.code)
      ),
    [others, shop.site_id]
  )
  // The ticks as edited; `null` until somebody changes one, so a fresh read is
  // what the sheet shows.
  const [draft, setDraft] = useState<Set<string> | null>(null)
  const ticked = draft ?? saved
  const dirty =
    draft !== null &&
    (draft.size !== saved.size || [...draft].some((code) => !saved.has(code)))

  const save = useMutation({
    mutationFn: () => setShopOtherMethods(shop.site_id, { codes: [...ticked] }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: financeKeys.paymentMethods() })
      setDraft(null)
    },
  })

  function toggle(code: string) {
    const next = new Set(ticked)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    setDraft(next)
  }

  const cell = (machine: EdcMachine, kind: Kind) => {
    if (!machine[KIND[kind].takes]) {
      return <span className="text-faint">—</span>
    }
    const code = machine[KIND[kind].account]
    return code === null ? (
      <span className="text-mute">Not set</span>
    ) : (
      accountShort(book, code)
    )
  }

  return (
    <>
      <Sheet
        open
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
        title={shop.label}
        context="Shop Payment Methods"
        dirty={dirty}
        stack
        footer={
          <SheetFooter
            error={save.error}
            primary={{
              label: "Save",
              pending: save.isPending,
              disabled: !dirty,
              onClick: () => save.mutate(),
            }}
          />
        }
      >
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <SubHead aside={count(machines.length)} className="mb-0">
              EDC machines
            </SubHead>
            <Button variant="primary" size="sm" onClick={() => setOpen("")}>
              <Plus />
              Add machine
            </Button>
          </div>
          {machines.length === 0 ? (
            <p className="text-[0.9375rem] text-mute">No EDC machine yet.</p>
          ) : (
            <MiniTable
              head={[
                "Machine",
                { label: "Debit", align: "left" },
                { label: "Credit", align: "left" },
                { label: "QRIS", align: "left" },
              ]}
            >
              {machines.map((machine) => (
                <MiniRow key={machine.bank_code}>
                  <MiniCell>
                    <button
                      type="button"
                      className="record-link text-left"
                      onClick={() => setOpen(machine.bank_code)}
                    >
                      {machineName(book, machine)}
                    </button>
                  </MiniCell>
                  {KINDS.map(({ kind }) => (
                    <MiniCell key={kind}>{cell(machine, kind)}</MiniCell>
                  ))}
                </MiniRow>
              ))}
            </MiniTable>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <SubHead className="mb-0">Other methods</SubHead>
          {others.length === 0 ? (
            <p className="text-[0.9375rem] text-mute">
              No cash, voucher or points method yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {others.map((one) => (
                <ToggleTile
                  key={one.code}
                  on={ticked.has(one.code)}
                  icon={OTHER[one.tender_type]?.icon ?? Wallet}
                  label={OTHER[one.tender_type]?.word ?? one.name}
                  onToggle={() => toggle(one.code)}
                />
              ))}
            </div>
          )}
        </section>
      </Sheet>
      {open !== null && (
        <MachineSheet
          key={open}
          site={shop.site_id}
          bank={open === "" ? null : open}
          book={book}
          shops={shops}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}

/// One machine: its bank first, then what it takes, then where each lands.
function MachineSheet({
  site: givenSite,
  bank: givenBank,
  book,
  shops,
  onClose,
}: {
  /// The shop, or `null` when it is added from the page's head.
  site: string | null
  /// The machine's bank, or `null` for a new machine.
  bank: string | null
  book: EdcMachineBook
  shops: readonly ShopRow[]
  onClose: () => void
}) {
  const client = useQueryClient()
  const existing =
    givenSite !== null && givenBank !== null
      ? (book.machines.find(
          (one) => one.site_id === givenSite && one.bank_code === givenBank
        ) ?? null)
      : null
  /// The account a kind starts on: the one most of this bank's machines use
  /// for it, else the bank's own Cash In Bank leaf.
  function usual(kind: Kind, forBank: string): string | null {
    const tally = new Map<string, number>()
    for (const machine of book.machines) {
      const code = machine[KIND[kind].account]
      if (machine.bank_code === forBank && code !== null) {
        tally.set(code, (tally.get(code) ?? 0) + 1)
      }
    }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
    if (best !== undefined) return best[0]
    const word = bankWord(book, forBank).toLowerCase()
    return (
      book.accounts.find((one) =>
        one.name.toLowerCase().includes(`giro bank ${word}`)
      )?.account_code ?? null
    )
  }

  const [site, setSite] = useState<string | null>(givenSite)
  const [bank, setBank] = useState<string | null>(givenBank)
  // A new machine takes nothing until somebody says what (owner, 24 Oct:
  // the bank first, then debit, credit, QRIS).
  const [takes, setTakes] = useState<Record<Kind, boolean>>({
    debit: existing?.takes_debit ?? false,
    credit: existing?.takes_credit ?? false,
    qris: existing?.takes_qris ?? false,
  })
  // A machine from before accounts were set (0989 made one for every bank a
  // shop took) opens on the usual account, so one Save sets it.
  const [accounts, setAccounts] = useState<Record<Kind, string | null>>(() => {
    const start = (kind: Kind) =>
      existing === null || !existing[KIND[kind].takes]
        ? null
        : (existing[KIND[kind].account] ?? usual(kind, existing.bank_code))
    return {
      debit: start("debit"),
      credit: start("credit"),
      qris: start("qris"),
    }
  })
  /// The kind a new account is being made for.
  const [making, setMaking] = useState<Kind | null>(null)

  const shopName = shops.find((one) => one.site_id === site)?.label ?? ""
  const taken = new Set(
    book.machines
      .filter((one) => one.site_id === site)
      .map((one) => one.bank_code)
  )
  const freeBanks = book.banks.filter(
    (one) => one.code === bank || !taken.has(one.code)
  )

  function toggle(kind: Kind) {
    const on = !takes[kind]
    setTakes({ ...takes, [kind]: on })
    if (on && accounts[kind] === null && bank !== null) {
      setAccounts({ ...accounts, [kind]: usual(kind, bank) })
    }
  }

  // The machine's own bank's accounts first, then the rest of the chart's.
  const choices = useMemo(() => {
    const word = bank === null ? "" : bankWord(book, bank).toLowerCase()
    const mine = (one: ChartAccountChoice) =>
      word !== "" && one.name.toLowerCase().includes(word)
    return [...book.accounts]
      .sort(
        (a, b) =>
          Number(mine(b)) - Number(mine(a)) ||
          a.account_code.localeCompare(b.account_code)
      )
      .map((one) => ({
        value: one.account_code,
        label: `${one.account_code} ${one.name}`,
      }))
  }, [book, bank])

  const chosenKinds = KINDS.filter(({ kind }) => takes[kind])
  const missing =
    site === null
      ? "Pick the shop"
      : bank === null
        ? "Pick the bank"
        : chosenKinds.length === 0
          ? "Pick what it takes"
          : chosenKinds.some(({ kind }) => accounts[kind] === null)
            ? "Pick where each settles"
            : null

  const done = () => {
    void client.invalidateQueries({ queryKey: financeKeys.edcMachines() })
    void client.invalidateQueries({ queryKey: financeKeys.paymentMethods() })
    onClose()
  }
  const save = useMutation({
    mutationFn: () =>
      saveEdcMachine(site!, bank!, {
        takes_debit: takes.debit,
        takes_credit: takes.credit,
        takes_qris: takes.qris,
        debit_account: takes.debit ? accounts.debit : null,
        credit_account: takes.credit ? accounts.credit : null,
        qris_account: takes.qris ? accounts.qris : null,
      }),
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: () => removeEdcMachine(site!, bank!),
    onSuccess: done,
  })

  const title =
    existing === null
      ? "Add machine"
      : machineName(book, {
          bank_code: existing.bank_code,
          takes_debit: takes.debit,
          takes_credit: takes.credit,
        })

  return (
    <>
      <Sheet
        open
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
        title={title}
        context={shopName === "" ? "Shop Payment Methods" : shopName}
        stack
        footer={
          <SheetFooter
            error={save.error ?? remove.error}
            start={
              existing !== null ? (
                <Button
                  variant="primary"
                  pending={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  Remove machine
                </Button>
              ) : undefined
            }
            primary={{
              label: existing === null ? "Add machine" : "Save",
              pending: save.isPending,
              disabled: missing !== null,
              onClick: () => save.mutate(),
            }}
          />
        }
      >
        {givenSite === null && (
          <Field label="Shop" required>
            <PickOne
              label="Shop"
              required
              choices={shops.map((one) => ({
                value: one.site_id,
                label: one.label,
              }))}
              value={site}
              onChange={(next) => {
                setSite(next)
                setBank(null)
              }}
            />
          </Field>
        )}

        {existing === null && site !== null && (
          <section className="flex flex-col gap-3">
            <SubHead className="mb-0">Bank</SubHead>
            {freeBanks.length === 0 ? (
              <p className="text-[0.9375rem] text-mute">
                Every bank already has a machine here.
              </p>
            ) : (
              <Choices
                label="Bank"
                columns={3}
                value={bank ?? ""}
                onChange={(next) => {
                  setBank(next)
                  setAccounts({
                    debit: takes.debit ? usual("debit", next) : null,
                    credit: takes.credit ? usual("credit", next) : null,
                    qris: takes.qris ? usual("qris", next) : null,
                  })
                }}
                options={freeBanks.map((one) => ({
                  value: one.code,
                  label: bankWord(book, one.code),
                  icon: Landmark,
                }))}
              />
            )}
          </section>
        )}

        {bank !== null && (
          <section className="flex flex-col gap-3">
            <SubHead className="mb-0">Takes</SubHead>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {KINDS.map(({ kind, word, icon }) => (
                <ToggleTile
                  key={kind}
                  on={takes[kind]}
                  icon={icon}
                  label={word}
                  onToggle={() => toggle(kind)}
                />
              ))}
            </div>
          </section>
        )}

        {bank !== null && chosenKinds.length > 0 && (
          <section className="flex flex-col gap-3">
            <SubHead className="mb-0">Settles to</SubHead>
            <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-4">
              {chosenKinds.map(({ kind, word, icon: Icon }) => (
                <div key={kind} className="contents">
                  <span className="flex items-center gap-2.5 text-[0.9375rem] text-ink">
                    <Icon className="size-4 shrink-0 stroke-[1.7] text-line-ico" />
                    {word}
                  </span>
                  <PickOne
                    label={`${word} settles to`}
                    required
                    placeholder="Pick an account"
                    choices={choices}
                    value={accounts[kind]}
                    onChange={(next) =>
                      setAccounts({ ...accounts, [kind]: next })
                    }
                    action={{
                      label: "New account",
                      onSelect: () => setMaking(kind),
                    }}
                  />
                </div>
              ))}
            </div>
          </section>
        )}
      </Sheet>
      {making !== null && bank !== null && (
        <NewAccountSheet
          heading={book.heading}
          accounts={book.accounts}
          suggested={`Cash In Bank Giro Bank ${bank} ${shopName}`.trim()}
          onClose={() => setMaking(null)}
          onCreated={(code) => {
            setAccounts({ ...accounts, [making]: code })
            setMaking(null)
          }}
        />
      )}
    </>
  )
}

/// A Cash In Bank leaf, made from inside the account pick: under the heading
/// the others sit under, typed Bank. The chart keeps it in its history like
/// any account made on Chart of Accounts.
function NewAccountSheet({
  heading,
  accounts,
  suggested,
  onClose,
  onCreated,
}: {
  heading: ChartAccountChoice | null
  accounts: readonly ChartAccountChoice[]
  suggested: string
  onClose: () => void
  onCreated: (code: string) => void
}) {
  const client = useQueryClient()
  // The next free code, as long as most bank leaves' codes are.
  const next = useMemo(() => {
    const codes = accounts
      .map((one) => one.account_code)
      .filter((code) => /^\d+$/.test(code))
    const lengths = new Map<number, number>()
    for (const code of codes) {
      lengths.set(code.length, (lengths.get(code.length) ?? 0) + 1)
    }
    const width = [...lengths.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    const top = codes
      .filter((code) => code.length === width)
      .reduce((most, code) => Math.max(most, Number(code)), 0)
    return top === 0 ? "" : String(top + 1)
  }, [accounts])
  const [code, setCode] = useState(next)
  const [name, setName] = useState(suggested)

  const create = useMutation({
    mutationFn: () =>
      changeChart({
        kind: "CREATE",
        account_code: code.trim(),
        name: name.trim(),
        parent_code: heading?.account_code ?? null,
        is_group: false,
        account_type: "BANK",
        statement_section: null,
        dimension: "unit",
        normal_balance: null,
        reason: null,
      }),
    onSuccess: (change) => {
      void client.invalidateQueries({ queryKey: ["finance", "accounts"] })
      void client.invalidateQueries({ queryKey: financeKeys.edcMachines() })
      onCreated(change.account_code)
    },
  })

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="New account"
      context="Chart of Accounts"
      stack
      footer={
        <SheetFooter
          error={create.error}
          primary={{
            label: "Save",
            pending: create.isPending,
            disabled:
              code.trim() === "" || name.trim() === "" || heading === null,
            onClick: () => create.mutate(),
          }}
        />
      }
    >
      <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-6 max-md:grid-cols-1">
        <Field label="Code" required>
          <Input
            value={code}
            inputMode="numeric"
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        <Field label="Name" required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      </div>
      <Facts>
        <Fact term="Under heading">
          {heading === null ? "—" : `${heading.account_code} · ${heading.name}`}
        </Fact>
        <Fact term="Account type">Bank</Fact>
      </Facts>
    </Sheet>
  )
}
