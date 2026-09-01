import { useState } from "react"

import { SheetShell, sheetButton } from "@/components/dashboard/sheet-shell"
import {
  ageOf,
  articleOf,
  colourName,
  locationOf,
  type MissingStatus,
  type MissingUnit,
} from "@/components/inventory/data"
import { shortDate } from "@/lib/day"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

const MISSING_COLUMNS = "216px minmax(0,1fr) 168px 132px 118px"

const STATUS: Record<MissingStatus, { label: string; hue: string }> = {
  open: { label: "Open", hue: "var(--ember)" },
  found: { label: "Found", hue: "var(--grass)" },
  "written-off": { label: "Written off", hue: "var(--ink-4)" },
}

/** Every unit the readers stopped seeing, oldest first — the tail is the problem. */
export function MissingList({
  onOpen,
  units = [],
}: {
  onOpen: (unit: MissingUnit) => void
  units?: MissingUnit[]
}) {
  const [status, setStatus] = useState<MissingStatus | "all">("open")

  const filteredUnits = units
    .filter((u) => status === "all" || u.status === status)
    .sort((a, b) => a.lastObserved.localeCompare(b.lastObserved))

  return (
    <div>
      <div className="flex h-11 items-center gap-2 border-b border-line px-3.5">
        {(["open", "found", "written-off", "all"] as const).map((option) => {
          const on = status === option
          const count =
            option === "all"
              ? units.length
              : units.filter((u) => u.status === option).length
          return (
            <button
              key={option}
              type="button"
              onClick={() => setStatus(option)}
              className={cn(
                "inline-flex h-[26px] items-center gap-1.5 rounded-control px-2.5 text-[11.5px] font-medium capitalize transition-colors",
                on
                  ? "bg-hover text-ink"
                  : "text-ink-3 hover:bg-hover hover:text-ink"
              )}
            >
              {option === "written-off" ? "Written off" : option}
              <span className="font-mono text-[10.5px] text-ink-4">
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {units.length === 0 ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 px-6 text-center text-ink-4">
          <span className="grid size-[34px] place-items-center rounded-panel bg-inset shadow-[inset_0_0_0_1px_var(--line-strong)]">
            <span className="font-mono text-[15px]">—</span>
          </span>
          <span className="text-xs">
            No short-count variances are open.
          </span>
          <span className="max-w-[420px] text-[11px] leading-[1.5]">
            A missing unit here is a Problem Inventory line: a blind receiving
            count that came up short. Balances alone are never converted into
            missing stock.
          </span>
        </div>
      ) : (
        <VirtualRows
          rows={filteredUnits}
          rowKey={(unit) => unit.epc}
          columns={MISSING_COLUMNS}
          rowHeight={46}
          onRowClick={(unit) => onOpen(unit)}
          header={
            <>
              <span className="pl-3.5">Unit</span>
              <span className="px-3">Article</span>
              <span className="px-3">Expected</span>
              <span className="px-3 text-right">Last observed</span>
              <span className="pr-3.5 pl-3">Status</span>
            </>
          }
          renderRow={(unit) => {
            const article = articleOf(unit.productId)
            const age = ageOf(unit.lastObserved)
            return (
              <>
                <span role="gridcell" className="min-w-0 pr-3 pl-3.5">
                  <span className="block truncate font-mono text-[11px] text-ink-2">
                    {unit.epc}
                  </span>
                  <span className="block text-[10.5px] text-ink-4">
                    {unit.history.length} events
                  </span>
                </span>

                <span role="gridcell" className="min-w-0 px-3">
                  <span className="flex items-center gap-2">
                    {article && (
                      <img
                        src={article.colorways[0].image}
                        alt=""
                        loading="lazy"
                        className="size-[28px] shrink-0 rounded-chip bg-inset object-cover"
                      />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-ink">
                        {article?.name ?? unit.name ?? unit.productId}
                      </span>
                      <span className="block truncate text-[10.5px] text-ink-4">
                        {article ? `${colourName(unit.colorwayId)} \u00b7 ${unit.size}` : unit.productId}
                      </span>
                    </span>
                  </span>
                </span>

                <span role="gridcell" className="min-w-0 px-3 text-[11.5px] text-ink-3">
                  <span className="block truncate">
                    {locationOf(unit.locationId)?.name ?? unit.locationName ?? unit.locationId}
                  </span>
                  <span className="block truncate text-[10.5px] text-ink-4">
                    {unit.expected}
                  </span>
                </span>

                <span role="gridcell" className="px-3 text-right">
                  <span className="block font-mono text-xs text-ink-2 tabular-nums">
                    {shortDate(unit.lastObserved)}
                  </span>
                  <span
                    className={cn(
                      "block font-mono text-[10.5px] tabular-nums",
                      (age ?? 0) > 30 ? "text-ember" : "text-ink-4"
                    )}
                  >
                    {age}d ago
                  </span>
                </span>

                <span role="gridcell" className="pr-3.5 pl-3">
                  <span
                    style={{ color: STATUS[unit.status].hue }}
                    className="flex items-center gap-1.5 text-[11px] font-medium"
                  >
                    <span
                      style={{ background: STATUS[unit.status].hue }}
                      className="size-1.5 rounded-full"
                    />
                    {STATUS[unit.status].label}
                  </span>
                </span>
              </>
            )
          }}
        />
      )}

    </div>
  )
}

/** What happened to one unit, in order — the history behind a missing number. */
export function MissingSheet({
  unit,
  onClose,
}: {
  unit: MissingUnit | null
  onClose: () => void
}) {
  const article = unit ? articleOf(unit.productId) : undefined

  return (
    <SheetShell
      open={Boolean(unit)}
      eyebrow="Missing unit"
      title={unit?.epc ?? ""}
      onRequestClose={onClose}
      footer={
        <>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className={sheetButton.secondary}
          >
            Close
          </button>
        </>
      }
    >
      {unit && (
        <div className="px-[18px] pt-4 pb-[18px]">
          <div className="flex items-center gap-3 pb-4">
            {article && (
              <img
                src={article.colorways[0].image}
                alt=""
                className="size-[52px] shrink-0 rounded-panel bg-inset object-cover"
              />
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">
                {article?.name ?? unit.name ?? unit.productId}
              </span>
              <span className="block truncate text-xs text-ink-4">
                {article
                  ? `${colourName(unit.colorwayId)} · ${unit.size} · ${unit.colorwayId}`
                  : unit.productId}
              </span>
            </span>
            <span
              style={{ color: STATUS[unit.status].hue }}
              className="ml-auto shrink-0 text-[11.5px] font-medium"
            >
              {STATUS[unit.status].label}
            </span>
          </div>

          {[
            {
              label: "Expected",
              value: `${
                locationOf(unit.locationId)?.name ??
                unit.locationName ??
                unit.locationId
              } · ${unit.expected}`,
            },
            {
              label: "Last observed",
              value: `${shortDate(unit.lastObserved)} · ${ageOf(unit.lastObserved)}d ago`,
            },
            {
              label: "Searches",
              value: String(
                unit.history.filter((e) => e.what.startsWith("Searched")).length
              ),
            },
          ].map((row) => (
            <div
              key={row.label}
              className="flex items-start gap-3 border-t border-line py-[9px]"
            >
              <span className="w-[104px] shrink-0 pt-px text-xs text-ink-4">
                {row.label}
              </span>
              <span className="min-w-0 flex-1 text-xs font-medium text-ink-2">
                {row.value}
              </span>
            </div>
          ))}

          <div className="pt-4 pb-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
            History
          </div>
          <ol className="relative pl-[18px]">
            <span className="absolute top-1.5 bottom-3 left-[4px] w-px bg-line-strong" />
            {unit.history.map((event, index) => (
              <li
                key={`${event.at}-${index}`}
                className="relative pb-3 last:pb-0"
              >
                <span
                  className={cn(
                    "absolute top-[5px] -left-[18px] size-[9px] rounded-full border-2 border-surface",
                    index === unit.history.length - 1 ? "bg-ink" : "bg-ink-4"
                  )}
                />
                <span className="block text-[12px] leading-[1.5] text-ink">
                  {event.what}
                </span>
                <span className="block text-[10.5px] text-ink-4">
                  {shortDate(event.at)} · {event.by}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </SheetShell>
  )
}
