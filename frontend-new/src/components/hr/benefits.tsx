import { useMemo, useState } from "react"
import { z } from "zod"

import { useAppForm } from "@/shared/form"
import { Icon, paths } from "@/components/dashboard/parts"
import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import { Avatar } from "@/components/hr/parts"
import { allEmployees, locationOf, type Employee } from "@/components/hr/data"
import { rupiah, useHr, type DiscountUse } from "@/components/hr/store"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

const discountPolicyInput = z.object({
  rate: z.number().min(0).max(100),
  quota: z.number().min(0),
})

/** The staff discount. Head Office writes the rules and holds the reset;
 *  a store only watches its own team spend the allowance down. */
export function Benefits({
  scope,
  locationId,
}: {
  scope: "ho" | "store"
  locationId?: string
}) {
  const {
    discountPolicy,
    setDiscountPolicy,
    discountUses,
    discountUsedBy,
    resetDiscount,
    suspendedDiscounts,
    toggleDiscount,
  } = useHr()

  const canAct = scope === "ho"
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<Employee | null>(null)

  const policyForm = useAppForm({
    defaultValues: {
      rate: discountPolicy.rate,
      quota: discountPolicy.quota,
    },
    validators: { onChange: discountPolicyInput },
    onSubmit: async ({ value }) => {
      setDiscountPolicy({ rate: value.rate, quota: value.quota })
    },
  })

  const people = useMemo(() => {
    const pool = locationId
      ? allEmployees().filter((e) => e.locationId === locationId)
      : allEmployees()
    const needle = query.trim().toLowerCase()
    return pool
      .filter((e) => e.status !== "notice" || !locationId)
      .filter((e) => !needle || e.name.toLowerCase().includes(needle))
      .map((e) => ({ person: e, used: discountUsedBy(e.id) }))
      .sort((a, b) => b.used - a.used)
  }, [locationId, query, discountUsedBy])

  const spent = people.reduce((sum, row) => sum + row.used, 0)
  const nearLimit = people.filter(
    (row) => row.used >= discountPolicy.quota * 0.8
  ).length

  const benefitsColumns = [
    "minmax(0,1fr)",
    !locationId && "150px",
    "118px",
    "148px",
    canAct ? "168px" : "96px",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3.5">
      {/* the policy itself — one rate, one ceiling, set centrally */}
      <section className="mb-3 overflow-hidden rounded-panel border border-line-strong">
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
          <Icon path={paths.tag} size={14} width={1.9} className="text-ink-4" />
          <span className="text-[12.5px] font-semibold text-ink">Staff discount</span>
          <span className="ml-auto text-[11px] text-ink-4">
            {canAct ? "Set here, spent in stores" : "Set by Head Office"}
          </span>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void policyForm.handleSubmit()
          }}
          className="flex flex-wrap items-end gap-4 px-3.5 py-3"
        >
          <Field label="Rate">
            {canAct ? (
              <policyForm.AppField name="rate">
                {(field) => (
                  <span className="inline-flex items-center gap-1">
                    <input
                      value={field.state.value}
                      onChange={(e) =>
                        field.handleChange(Number(e.target.value.replace(/\D/g, "")) || 0)
                      }
                      onBlur={field.handleBlur}
                      inputMode="numeric"
                      className="h-[32px] w-[62px] rounded-control bg-field px-2 text-right font-mono text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
                    />
                    <span className="font-mono text-[13px] text-ink-3">%</span>
                  </span>
                )}
              </policyForm.AppField>
            ) : (
              <span className="font-mono text-[15px] text-ink">{discountPolicy.rate}%</span>
            )}
          </Field>

          <Field label="Yearly quota">
            {canAct ? (
              <policyForm.AppField name="quota">
                {(field) => (
                  <input
                    value={field.state.value}
                    onChange={(e) =>
                      field.handleChange(Number(e.target.value.replace(/\D/g, "")) || 0)
                    }
                    onBlur={field.handleBlur}
                    inputMode="numeric"
                    className="h-[32px] w-[128px] rounded-control bg-field px-2 text-right font-mono text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)]"
                  />
                )}
              </policyForm.AppField>
            ) : (
              <span className="font-mono text-[15px] text-ink">
                {rupiah(discountPolicy.quota)}
              </span>
            )}
          </Field>

          <Field label="Saved so far">
            <span className="font-mono text-[15px] text-ink">{rupiah(spent)}</span>
          </Field>

          <Field label="Near the ceiling">
            <span
              className={cn(
                "font-mono text-[15px]",
                nearLimit > 0 ? "text-honey" : "text-ink"
              )}
            >
              {nearLimit}
            </span>
          </Field>

          {canAct && (
            <policyForm.WhenDirty>
              <button
                type="submit"
                className="ml-auto inline-flex h-[32px] items-center gap-1.5 rounded-control bg-ink px-2.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Icon path={paths.check} size={14} width={2.2} />
                Save policy
              </button>
            </policyForm.WhenDirty>
          )}
        </form>
      </section>

      <div className="flex items-center gap-2 pb-2">
        <span className="relative">
          <Icon
            path={paths.search}
            size={14}
            width={1.9}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-4"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a person"
            className="h-[32px] w-[220px] rounded-control bg-field pr-2.5 pl-8 text-xs text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent)] placeholder:text-ink-4"
          />
        </span>
        <span className="ml-auto text-[11px] text-ink-4">{people.length} people</span>
      </div>

      <VirtualRows
        rows={people}
        rowKey={({ person }) => person.id}
        columns={benefitsColumns}
        rowHeight={34}
        empty={
          <p className="py-10 text-center text-xs text-ink-4">
            Nobody matches that.
          </p>
        }
        header={
          <>
            <span className="px-2.5 text-left">Person</span>
            {!locationId && <span className="px-2.5 text-left">Location</span>}
            <span className="px-2.5 text-right">Saved</span>
            <span className="px-2.5 text-left">Allowance left</span>
            <span className="px-2.5 text-right">{canAct ? "" : "Status"}</span>
          </>
        }
        renderRow={({ person, used }) => {
          const left = Math.max(0, discountPolicy.quota - used)
          const pct = discountPolicy.quota
            ? Math.min(100, (used / discountPolicy.quota) * 100)
            : 0
          const suspended = suspendedDiscounts.includes(person.id)
          return (
            <>
              <span role="gridcell" className="px-2.5">
                <button
                  type="button"
                  onClick={() => setOpen(person)}
                  className="group/row flex w-full items-center gap-2 text-left"
                >
                  <Avatar employee={person} size={22} />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-ink">
                      {person.name}
                    </span>
                  </span>
                  {suspended && (
                    <span className="ml-1 shrink-0 rounded-chip bg-red-tint px-1.5 py-px text-[10px] font-medium text-ember">
                      Suspended
                    </span>
                  )}
                </button>
              </span>
              {!locationId && (
                <span role="gridcell" className="px-2.5 text-xs text-ink-3">
                  <span className="block truncate">{locationOf(person.locationId)?.name}</span>
                </span>
              )}
              <span
                role="gridcell"
                className="px-2.5 text-right font-mono text-xs tabular-nums text-ink-2"
              >
                {used ? rupiah(used) : "—"}
              </span>
              <span role="gridcell" className="px-2.5">
                <span className="flex items-center gap-2">
                  <span className="h-[5px] flex-1 overflow-hidden rounded-full bg-inset">
                    <span
                      style={{ width: `${pct}%` }}
                      className={cn(
                        "block h-full rounded-full transition-[width] duration-[240ms]",
                        pct >= 100 ? "bg-ember" : pct >= 80 ? "bg-honey" : "bg-grass"
                      )}
                    />
                  </span>
                  <span className="w-[74px] shrink-0 text-right font-mono text-[11px] tabular-nums text-ink-4">
                    {rupiah(left)}
                  </span>
                </span>
              </span>
              <span role="gridcell" className="px-2.5 text-right">
                {canAct ? (
                  <span className="flex justify-end gap-1 opacity-0 transition-opacity group-hover/row:opacity-100">
                    <button
                      type="button"
                      onClick={() => toggleDiscount(person.id)}
                      className="inline-flex h-[24px] items-center rounded-control px-2 text-[11px] font-medium text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
                    >
                      {suspended ? "Restore" : "Suspend"}
                    </button>
                    <button
                      type="button"
                      disabled={used === 0}
                      onClick={() => resetDiscount(person.id)}
                      className="inline-flex h-[24px] items-center rounded-control px-2 text-[11px] font-medium text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink disabled:pointer-events-none disabled:opacity-35"
                    >
                      Reset
                    </button>
                  </span>
                ) : (
                  <span
                    className={cn(
                      "text-[11px]",
                      suspended ? "text-ember" : "text-ink-4"
                    )}
                  >
                    {suspended ? "Suspended" : "Active"}
                  </span>
                )}
              </span>
            </>
          )
        }}
      />

      <SheetShell
        open={Boolean(open)}
        eyebrow="Staff discount"
        title={open?.name ?? ""}
        onRequestClose={() => setOpen(null)}
        footer={
          <>
            {canAct && open && (
              <button
                type="button"
                onClick={() => {
                  resetDiscount(open.id)
                  setOpen(null)
                }}
                className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ember shadow-btn transition-colors hover:bg-hover"
              >
                Reset balance
              </button>
            )}
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setOpen(null)}
              className={sheetButton.secondary}
            >
              Close
            </button>
          </>
        }
      >
        {open && (
          <Usage
            employee={open}
            uses={discountUses.filter((u) => u.employeeId === open.id)}
            quota={discountPolicy.quota}
            used={discountUsedBy(open.id)}
          />
        )}
      </SheetShell>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="block">
      <span className="block pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
        {label}
      </span>
      {children}
    </span>
  )
}

function Usage({
  employee,
  uses,
  quota,
  used,
}: {
  employee: Employee
  uses: DiscountUse[]
  quota: number
  used: number
}) {
  const rule = "border-b border-b-[color-mix(in_srgb,var(--line)_78%,transparent)]"
  const ordered = [...uses].sort((a, b) => a.daysAgo - b.daysAgo)

  return (
    <div className="px-4 py-4">
      <div className="mb-3 grid grid-cols-3 gap-2">
        {[
          { label: "Purchases", value: String(uses.length) },
          { label: "Saved", value: rupiah(used) },
          { label: "Left", value: rupiah(Math.max(0, quota - used)) },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
          >
            <div className="pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
              {s.label}
            </div>
            <div className="truncate font-mono text-[15px] font-medium tracking-[-0.02em] text-ink">
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {ordered.length === 0 ? (
        <p className="rounded-panel bg-inset py-10 text-center text-xs text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]">
          {employee.name.split(" ")[0]} has not used the discount this year.
        </p>
      ) : (
        <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
          <colgroup>
            <col />
            <col style={{ width: 84 }} />
            <col style={{ width: 108 }} />
            <col style={{ width: 108 }} />
          </colgroup>
          <thead>
            <tr className="[&>th]:h-9 [&>th]:border-y [&>th]:border-y-line-strong [&>th]:bg-surface [&>th]:px-2.5 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:tracking-[0.04em] [&>th]:text-ink-3 [&>th]:uppercase">
              <th className="text-left">Item</th>
              <th className="text-right">When</th>
              <th className="text-right">Ticket</th>
              <th className="text-right">Saved</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((u) => (
              <tr key={u.id} className="hover:[&>td]:bg-hover">
                <td className={cn("h-row px-2.5 align-middle text-xs text-ink", rule)}>
                  <span className="block truncate">{u.item}</span>
                </td>
                <td
                  className={cn(
                    "px-2.5 text-right align-middle text-[11px] whitespace-nowrap text-ink-4",
                    rule
                  )}
                >
                  {u.daysAgo}d ago
                </td>
                <td
                  className={cn(
                    "px-2.5 text-right align-middle font-mono text-xs tabular-nums text-ink-3",
                    rule
                  )}
                >
                  {rupiah(u.ticket)}
                </td>
                <td
                  className={cn(
                    "px-2.5 text-right align-middle font-mono text-xs tabular-nums text-grass",
                    rule
                  )}
                >
                  {rupiah(u.saved)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
