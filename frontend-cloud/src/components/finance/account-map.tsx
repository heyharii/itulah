import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { FinanceNav } from "@/components/finance/finance-nav"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { accountMap, financeKeys, searchAccounts, setAccountMapping } from "@/lib/finance"
import { cn } from "@/lib/utils"
import type { AccountMapping, LedgerAccount, SemanticKeyDoc } from "@itulah/contract"
import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Check, Search, TriangleAlert } from "lucide-react"
import { useMemo, useRef, useState } from "react"

/// Which client account carries each meaning, at each location.
///
/// # Why this screen exists at all
///
/// A posting rule says `trade_payable`. The client's chart says
/// `201200100107`. Nothing in the code can bridge those two, and nothing
/// should try: the bridge is a decision about somebody's books, made by
/// somebody who knows them. This screen is where that decision is recorded.
///
/// Until a meaning is mapped, every posting that needs it refuses — by design,
/// and with a message naming the key. So this screen is not configuration in
/// the optional sense. It is the thing that has to be finished before finance
/// does anything at all, which is why it leads with how much of it is left
/// rather than with a table.
export function AccountMapScreen() {
  const [site, setSite] = useState<string | null>(null)
  const map = useQuery({
    queryKey: financeKeys.accountMap(),
    queryFn: ({ signal }) => accountMap(undefined, signal),
  })

  const locations = map.data?.locations ?? []
  const active = site ?? locations[0]?.site_id ?? null

  if (map.isPending) {
    return (
      <Frame>
        <ScreenState>Loading the map…</ScreenState>
      </Frame>
    )
  }
  if (map.error !== null) {
    return (
      <Frame>
        <ScreenState tone="problem">
          {map.error instanceof Error ? map.error.message : "could not load the account map"}
        </ScreenState>
      </Frame>
    )
  }
  if (map.data.required_keys.length === 0) {
    return (
      <Frame>
        <ScreenState>No posting rule asks for an account yet.</ScreenState>
      </Frame>
    )
  }
  if (locations.length === 0) {
    return (
      <Frame>
        <ScreenState>
          There are no locations to keep books for. Seed the estate first.
        </ScreenState>
      </Frame>
    )
  }

  const byLocation = new Map<string, Map<string, AccountMapping>>()
  for (const mapping of map.data.rows) {
    const slot = byLocation.get(mapping.site_id) ?? new Map()
    slot.set(mapping.semantic_key, mapping)
    byLocation.set(mapping.site_id, slot)
  }
  const total = map.data.required_keys.length * locations.length
  // Distinct key-and-location pairs, not rows. `bank_savings` at the DC is one
  // meaning that is legitimately mapped five times — once per bank — and
  // counting rows would report the map as more complete than it is.
  const done = new Set(map.data.rows.map((m) => `${m.semantic_key} ${m.site_id}`)).size
  const here = byLocation.get(active ?? "") ?? new Map()

  return (
    <Frame
      subtitle={`${done} of ${total} set · ${map.data.required_keys.length} meanings × ${locations.length} locations`}
    >
      {/* Progress first, because "can finance post yet" is the only question
          this screen answers, and a table of 28 rows does not answer it. */}
      {done < total && (
        <div className="border-b px-3.5 py-2">
          <p className="flex items-center gap-1.5 text-[12px]">
            <TriangleAlert className="size-3.5 shrink-0 text-amber-600" />
            <span>
              <span className="font-medium">{total - done}</span> still unset. A posting
              that needs one of these refuses and names the key — it never picks an
              account for you.
            </span>
          </p>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b px-2.5 py-1.5">
          {locations.map((location) => {
            const set = byLocation.get(location.site_id)?.size ?? 0
            const complete = set === map.data.required_keys.length
            return (
              <button
                key={location.site_id}
                type="button"
                onClick={() => setSite(location.site_id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors",
                  location.site_id === active ? "bg-muted font-medium" : "hover:bg-muted/60",
                )}
              >
                {location.name}
                <span
                  className={cn(
                    "font-mono text-[10px]",
                    complete ? "text-emerald-600" : "text-amber-600",
                  )}
                >
                  {set}/{map.data.required_keys.length}
                </span>
              </button>
            )
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-card sticky top-0 border-b">
              <tr className="text-muted-foreground text-left text-[11px]">
                <th className="px-3.5 py-1.5 font-medium">Meaning</th>
                <th className="px-3 py-1.5 font-medium">Expected account</th>
                <th className="px-3 py-1.5 font-medium">Mapped to</th>
                <th className="px-3 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {map.data.required_keys.map((key) => (
                <MappingRow
                  key={key.key}
                  doc={key}
                  site={active as string}
                  mapping={here.get(key.key)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Frame>
  )
}

function Frame({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <AppShell nav={<Nav />} section={<FinanceNav />}>
      <ScreenHeader title="Account Map" subtitle={subtitle} />
      <ScreenBody>{children}</ScreenBody>
    </AppShell>
  )
}

/// One meaning, and the act of pointing it at an account.
///
/// # Why the picking is a form and the picker is not
///
/// What gets sent is two values that have to travel together — which bank or
/// scheme this is, and which account carries it — and the second is worthless
/// without the first. Holding them in two `useState`s meant the rule that ties
/// them ("a qualified meaning cannot be saved unqualified") was written twice:
/// once as a disabled flag on the picker and once as a sentence under it, with
/// nothing keeping the two in step. As one form it is a validator, and the
/// submit that would break the primary key cannot be reached.
///
/// Whether the picker is open stays `useState`, because it is not a value being
/// sent anywhere — it is whether this row is currently showing its underside.
function MappingRow({
  doc,
  site,
  mapping,
}: {
  doc: SemanticKeyDoc
  site: string
  mapping: AccountMapping | undefined
}) {
  const [picking, setPicking] = useState(false)
  const client = useQueryClient()
  const save = useMutation({
    mutationFn: (value: { qualifier: string; account_code: string }) =>
      setAccountMapping({
        semantic_key: doc.key,
        site_id: site,
        // Only meanings that take a qualifier ask for one, and for the rest it
        // stays the empty string the primary key expects.
        qualifier: doc.qualified ? value.qualifier.trim() : "",
        account_code: value.account_code,
      }),
    onSuccess: () => {
      setPicking(false)
      void client.invalidateQueries({ queryKey: ["finance", "account-map"] })
    },
  })

  const form = useForm({
    defaultValues: { qualifier: "", account_code: "" },
    onSubmit: ({ value }) => save.mutateAsync(value),
  })
  const qualifier = useStore(form.store, (state) => state.values.qualifier)
  const unnamed = doc.qualified && qualifier.trim() === ""

  return (
    <>
      <tr className={cn("border-b", mapping === undefined && "bg-amber-50/40")}>
        <td className="px-3.5 py-1.5 align-top">
          <p className="font-medium">{doc.label}</p>
          <p className="text-muted-foreground font-mono text-[10.5px]">
            {doc.key}
            {doc.qualified && " · needs a qualifier"}
          </p>
        </td>
        {/* The client's own account, quoted so the person mapping it is
            choosing between their books and a hint, not guessing from a key
            name written by a programmer. */}
        <td className="text-muted-foreground px-3 py-1.5 align-top font-mono text-[11px]">
          {doc.expects}
        </td>
        <td className="px-3 py-1.5 align-top">
          {mapping === undefined ? (
            <span className="text-amber-700">not set</span>
          ) : (
            <>
              <span className="font-mono text-[11px]">{mapping.account_code}</span>
              <p className="text-muted-foreground truncate">{mapping.account_name}</p>
            </>
          )}
        </td>
        <td className="px-3 py-1.5 text-right align-top">
          <Button
            size="sm"
            variant={mapping === undefined ? "default" : "ghost"}
            className="h-6 px-2 text-[11px]"
            onClick={() => setPicking((was) => !was)}
          >
            {picking ? "Cancel" : mapping === undefined ? "Set" : "Change"}
          </Button>
        </td>
      </tr>
      {picking && (
        <tr>
          <td colSpan={4} className="bg-muted/40 px-3.5 py-2">
            {doc.qualified && (
              <form.Field name="qualifier">
                {(field) => (
                  <div className="pb-1.5">
                    <label
                      htmlFor={field.name}
                      className="text-muted-foreground text-[11px]"
                    >
                      Which one? — this meaning has an account per bank or scheme
                    </label>
                    <Input
                      id={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder="BCA, Mandiri, VISA…"
                      className="mt-0.5 h-7 text-[12px]"
                    />
                  </div>
                )}
              </form.Field>
            )}
            <AccountPicker
              hint={doc.expects}
              onPick={(account) => {
                form.setFieldValue("account_code", account.account_code)
                void form.handleSubmit()
              }}
              busy={save.isPending || unnamed}
            />
            {unnamed && (
              <p className="text-muted-foreground pt-1 text-[11px]">
                Name the bank or scheme first — without it there is no way to say which
                of the client's several accounts this is.
              </p>
            )}
            {save.error !== null && (
              <p className="text-destructive pt-1.5 text-[11px]">
                {save.error instanceof Error ? save.error.message : "could not save"}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

/// How many accounts the picker asks for, and how tall one of them is.
///
/// Forty was a layout limit wearing a search limit's clothes. The hint seeds
/// the box with a heading code — `2012001` — which in this chart prefixes
/// hundreds of accounts, one per location and per counterparty; the right one
/// was routinely past row forty and there was nothing on the screen to say the
/// list had been cut. The server applies no ceiling of its own, so this is the
/// only limit there is. The list is virtualised, which is what makes a large
/// one free to draw, and a thousand is well past the largest family in the
/// client's chart without shipping the whole thing on every keystroke.
const CANDIDATES = 1000
const CANDIDATE = 24

/// Search the chart for the account to point a meaning at.
///
/// Seeded with the expected account's code, because the hint is usually right
/// and retyping twelve digits from the row above is not a decision, it is
/// transcription.
///
/// The box itself stays `useState` and not a form field: nothing is submitted
/// from it. It narrows a list, and the thing that gets sent is the row somebody
/// clicks.
function AccountPicker({
  hint,
  onPick,
  busy,
}: {
  hint: string
  onPick: (account: LedgerAccount) => void
  busy: boolean
}) {
  const seed = useMemo(() => hint.split(" ")[0]?.replace(/\*$/, "") ?? "", [hint])
  const [needle, setNeedle] = useState(seed)
  const scroller = useRef<HTMLDivElement>(null)
  const hits = useQuery({
    queryKey: ["finance", "account-picker", needle],
    queryFn: ({ signal }) =>
      searchAccounts(needle, { limit: CANDIDATES }, signal).then((page) => page.rows),
    enabled: needle.trim().length >= 2,
  })
  const accounts = hits.data ?? []

  const rows = useVirtualizer({
    count: accounts.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => CANDIDATE,
    overscan: 12,
  })

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
        <Input
          autoFocus
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
          placeholder="Account code or name…"
          className="h-7 pl-7 text-[12px]"
        />
      </div>
      {hits.data !== undefined && (
        <div ref={scroller} className="max-h-52 overflow-y-auto rounded-md border bg-white">
          {accounts.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-[11px]">
              Nothing matches. Headings cannot be mapped — only postable accounts.
            </p>
          ) : (
            <ul className="relative" style={{ height: rows.getTotalSize() }}>
              {rows.getVirtualItems().map((item) => {
                const account = accounts[item.index]
                if (account === undefined) return null
                return (
                  <li
                    key={account.account_code}
                    className="absolute top-0 left-0 w-full"
                    style={{ height: CANDIDATE, transform: `translateY(${item.start}px)` }}
                  >
                    <button
                      type="button"
                      disabled={account.is_group || busy}
                      onClick={() => onPick(account)}
                      className={cn(
                        "flex h-full w-full items-baseline gap-2 px-2 py-1 text-left text-[12px]",
                        account.is_group
                          ? "text-muted-foreground/50 cursor-not-allowed"
                          : "hover:bg-muted",
                      )}
                      // Headings are refused by the database too — the composite
                      // foreign key on (account_code, is_group) will not take one —
                      // so this is the explanation, not the enforcement.
                      title={account.is_group ? "A heading cannot be posted to" : undefined}
                    >
                      <span className="text-muted-foreground shrink-0 font-mono text-[10.5px]">
                        {account.account_code}
                      </span>
                      <span className="truncate">{account.name}</span>
                      {account.is_group && (
                        <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
                          heading
                        </span>
                      )}
                      {!account.is_group && account.site_id !== null && (
                        <span className="text-muted-foreground ml-auto shrink-0 font-mono text-[10px]">
                          {account.site_id}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
      {busy && (
        <p className="text-muted-foreground flex items-center gap-1 text-[11px]">
          <Check className="size-3" /> saving…
        </p>
      )}
    </div>
  )
}
