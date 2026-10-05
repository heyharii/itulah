import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, Problem } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { count, label } from "@/lib/format"
import {
  financeKeys,
  setSitePaymentMethods,
  sitePaymentMethods,
} from "@/lib/queries/finance"
import { siteLabel, useUnits } from "@/lib/queries/organisation"
import { queryState } from "@/lib/query-state"
import { usePaymentMethods } from "@/screens/finance/master-data"
import type { SitePaymentMethod } from "@itulah/contract"

/// The kinds of site that sell: `STORE` today, `SHOP` in the premises
/// vocabulary the register is moving to. A site's kind is data; its id says
/// nothing.
const SELLING_SITE_KINDS = new Set(["STORE", "SHOP"])

/// Which payment methods each shop takes (ERPNext POS Profile → Payments).
///
/// The company's methods are declared once on Payment Methods, with their MDR
/// and their account links; here each shop is given the ones its counter
/// actually has — a shop with a BCA EDC and no Mandiri one takes Debit BCA and
/// not Debit Mandiri. The shop's tills read the list from the store node, so a
/// method switched off here disappears from the payment screen and a sale that
/// names it is refused.
///
/// The list is the shops — the selling sites of the units register — and not
/// the units the books are kept for: a till stands at a site.
export function ShopPaymentMethods() {
  const units = useUnits()
  const methods = usePaymentMethods()
  const [site, setSite] = useState<string | null>(null)
  const [needle, setNeedle] = useState("")

  const allShops = useMemo(
    () =>
      (units.data ?? []).flatMap((unit) =>
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

  /// How many active methods each shop takes, from the company list.
  const taken = useMemo(() => {
    const table = new Map<string, number>()
    for (const method of methods.data ?? []) {
      if (!method.is_active) continue
      for (const id of method.site_ids) table.set(id, (table.get(id) ?? 0) + 1)
    }
    return table
  }, [methods.data])

  const chosen = site ?? shops[0]?.site_id ?? null
  const chosenName =
    allShops.find((one) => one.site_id === chosen)?.label ?? "…"

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Setup"
        title="Shop Payment Methods"
        sub="Which of the company's payment methods each shop takes. The shop's tills show only these, and refuse a sale paid any other way."
        actions={
          <Input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            className="h-8 w-48"
          />
        }
      />

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card className="overflow-hidden">
          {queryState(units, {
            loading: "Reading the shops…",
            render: () =>
              shops.length === 0 ? (
                <EmptyState>No shop matches the search.</EmptyState>
              ) : (
                <ul className="divide-line divide-y">
                  {shops.map((one) => (
                    <li key={one.site_id}>
                      <button
                        type="button"
                        onClick={() => setSite(one.site_id)}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-soft ${
                          one.site_id === chosen ? "bg-soft" : ""
                        }`}
                      >
                        <span>
                          <span className="block text-ink">{one.label}</span>
                          {one.unit_status === "CLOSED" && (
                            <span className="text-[0.75rem] text-faint">
                              Closed
                            </span>
                          )}
                        </span>
                        <span className="text-[0.875rem] text-mute">
                          {count(taken.get(one.site_id) ?? 0)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ),
          })}
        </Card>

        {chosen === null ? (
          <Card>
            <EmptyState>Pick a shop.</EmptyState>
          </Card>
        ) : (
          <ShopMethods key={chosen} site={chosen} name={chosenName} />
        )}
      </div>
    </PageContent>
  )
}

function ShopMethods({ site, name }: { site: string; name: string }) {
  const client = useQueryClient()
  const setup = useQuery({
    queryKey: financeKeys.sitePaymentMethods(site),
    queryFn: ({ signal }) => sitePaymentMethods(site, signal),
  })
  // The shop's ticks as edited; `null` until someone changes one, so a fresh
  // read is what the screen shows.
  const [draft, setDraft] = useState<Set<string> | null>(null)
  const [inactive, setInactive] = useState(false)

  const saved = useMemo(
    () =>
      new Set(
        (setup.data ?? []).filter((row) => row.enabled).map((row) => row.code)
      ),
    [setup.data]
  )
  const ticked = draft ?? saved
  const dirty =
    draft !== null &&
    (draft.size !== saved.size || [...draft].some((code) => !saved.has(code)))

  const save = useMutation({
    mutationFn: () => setSitePaymentMethods(site, { codes: [...ticked] }),
    onSuccess: (rows) => {
      client.setQueryData(financeKeys.sitePaymentMethods(site), rows)
      void client.invalidateQueries({ queryKey: financeKeys.paymentMethods() })
      setDraft(null)
    },
  })

  function toggle(code: string, on: boolean) {
    const next = new Set(ticked)
    if (on) next.add(code)
    else next.delete(code)
    setDraft(next)
  }

  const groups = useMemo(() => {
    const byTender = new Map<string, SitePaymentMethod[]>()
    for (const row of setup.data ?? []) {
      if (!inactive && !row.is_active) continue
      const list = byTender.get(row.tender_type) ?? []
      list.push(row)
      byTender.set(row.tender_type, list)
    }
    return [...byTender.entries()]
  }, [setup.data, inactive])

  return (
    <Card className="overflow-hidden">
      <Toolbar>
        <span className="text-ink">{name}</span>
        <Checkbox
          label="Show inactive"
          checked={inactive}
          onChange={setInactive}
        />
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute">
          {count(ticked.size)} taken
        </span>
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Undo
          </Button>
        )}
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={!dirty}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Submitting…" : "Submit"}
        </Button>
      </Toolbar>
      <Problem error={save.error} />
      {queryState(setup, {
        loading: "Reading the shop's payment methods…",
        render: () =>
          groups.length === 0 ? (
            <EmptyState>
              The company has no payment method yet. Add them on Payment Methods
              first.
            </EmptyState>
          ) : (
            <div className="divide-line divide-y">
              {groups.map(([tender, rows]) => (
                <section key={tender} className="px-4 py-3">
                  <h3 className="mb-2 text-[0.8125rem] font-medium text-mute">
                    {label(tender)}
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {rows.map((row) => (
                      <div
                        key={row.code}
                        className="border-line flex items-center gap-2 rounded-md border px-3 py-2"
                      >
                        <Checkbox
                          className="min-w-0 flex-1"
                          label={
                            <span className="block min-w-0">
                              <span className="block truncate text-ink">
                                {row.name}
                              </span>
                              <span className="font-mono text-[0.75rem] text-faint">
                                {row.code}
                              </span>
                            </span>
                          }
                          checked={ticked.has(row.code)}
                          onChange={(on) => toggle(row.code, on)}
                        />
                        {row.bank_code !== "" && <Tag>{row.bank_code}</Tag>}
                        {!row.is_active && <Pill tone="neutral">Inactive</Pill>}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ),
      })}
    </Card>
  )
}
